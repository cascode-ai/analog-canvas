import type { CircuitProject } from "@icm/model";
import type {
  ProjectTransaction,
  ProjectTransactionResult,
  ProjectStructureEdit,
  SchematicEdit,
} from "@icm/edit-engine";
import type { ProjectSimulationFileHost } from "@icm/simulation-service/files";
import { initialInstanceNetlist } from "../netlist-export/netlist-authoring";

/** Human and Agent File Resources share this adapter to normal atomic Project history. */
export function createSimulationProjectFileHost(options: {
  getProject(): CircuitProject;
  getProjectSessionId(): string;
  dispatch(request: ProjectTransaction): ProjectTransactionResult;
  actor: ProjectTransaction["actor"];
}): ProjectSimulationFileHost {
  const read = (setupId: string) => {
    const project = options.getProject();
    const setup = project.simulationSetups.find(
      (setup) => setup.id === setupId,
    );
    return setup
      ? {
          projectSessionId: options.getProjectSessionId(),
          structureRevision: project.structureRevision,
          project,
          setup,
        }
      : undefined;
  };
  return {
    read,
    commit(expected, setup, parameters = []) {
      const project = options.getProject();
      const fail = (code: string, message: string) => ({
        ok: false as const,
        error: {
          code,
          message,
          stage: "input" as const,
          recovery: "fix-input" as const,
        },
      });
      if (
        options.getProjectSessionId() !== expected.projectSessionId ||
        project.structureRevision !== expected.structureRevision
      )
        return fail(
          "PROJECT_REVISION_CONFLICT",
          "The Project changed while editing source; your draft was not applied",
        );
      const documents = new Map<
        string,
        { revision: number; edits: SchematicEdit[] }
      >();
      const instances = new Map<string, typeof parameters>();
      for (const p of parameters) {
        const key = JSON.stringify([p.documentId, p.instanceId]);
        instances.set(key, [...(instances.get(key) ?? []), p]);
      }
      for (const group of instances.values()) {
        const first = group[0]!;
        const document = project.documents.find(
          (d) => d.id === first.documentId,
        );
        const instance = document?.instances.find(
          (i) => i.id === first.instanceId,
        );
        if (
          !document ||
          !instance ||
          document.revision !== first.expectedRevision
        )
          return fail(
            "SIMULATION_CIRCUIT_STALE",
            "The mapped Circuit changed; reload its generated source",
          );
        const set = Object.fromEntries(
          group.map((p) => [p.parameter, p.value]),
        );
        let edit: SchematicEdit;
        if (instance.netlist)
          edit = {
            kind: "patch_instance_netlist_parameters",
            instanceId: instance.id,
            set,
          };
        else {
          const initial = initialInstanceNetlist(instance.symbolId, {});
          if (!initial)
            return fail(
              "SIMULATION_PARAMETER_UNAVAILABLE",
              "This instance has no editable electrical parameter binding",
            );
          edit = {
            kind: "set_instance_netlist",
            instanceId: instance.id,
            netlist: {
              ...initial,
              parameters: { ...initial.parameters, ...set },
            },
          };
        }
        const target = documents.get(document.id) ?? {
          revision: document.revision,
          edits: [],
        };
        target.edits.push(edit);
        documents.set(document.id, target);
      }
      const edits: ProjectStructureEdit[] = [
        { kind: "upsert_simulation_setup", setup },
        ...[...documents].map(([documentId, value]) => ({
          kind: "transact_document" as const,
          documentId,
          expectedRevision: value.revision,
          edits: value.edits,
        })),
      ];
      const result = options.dispatch({
        transactionId: `source-${crypto.randomUUID()}`,
        projectId: project.id,
        expectedStructureRevision: expected.structureRevision,
        actor: options.actor,
        edits,
      });
      if (!result.ok)
        return fail(
          result.error.code,
          result.diagnostics[0]?.message ?? result.error.message,
        );
      const snapshot = read(setup.id);
      return snapshot
        ? { ok: true, snapshot }
        : fail(
            "SIMULATION_SETUP_UNAVAILABLE",
            "The setup is no longer present",
          );
    },
  };
}
