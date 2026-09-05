import type {
  CircuitProject,
  SchematicDocument,
  SimulationProbeSpec,
} from "@icm/model";
import { resolveDocumentLogicalNets } from "@icm/derived";

type VoltageProbeTarget = Omit<
  Extract<SimulationProbeSpec, { kind: "net-voltage" }>,
  "id"
>;
type SourceCurrentProbeTarget = Omit<
  Extract<SimulationProbeSpec, { kind: "source-current" }>,
  "id"
>;
type ProbeTarget = VoltageProbeTarget | SourceCurrentProbeTarget;

export interface SimulationProbeOption<
  Target extends ProbeTarget = ProbeTarget,
> {
  readonly key: string;
  readonly label: string;
  readonly target: Target;
}

export interface SimulationProbeOptions {
  readonly voltage: readonly SimulationProbeOption<VoltageProbeTarget>[];
  readonly sourceCurrent: readonly SimulationProbeOption<SourceCurrentProbeTarget>[];
}

export function simulationProbeTargetKey(target: ProbeTarget): string {
  const occurrence = target.occurrence.join("/");
  return target.kind === "net-voltage"
    ? `voltage:${occurrence}:${target.documentId}:${target.netId}`
    : `current:${occurrence}:${target.documentId}:${target.instanceId}`;
}

/**
 * Enumerate concrete probe targets below one simulation root. An occurrence
 * is kept for every hierarchy call, so two instances of one Cell remain two
 * different choices. This is an editor projection of the persisted probe
 * contract; it does not invent a second measurement object.
 */
export function deriveSimulationProbeOptions(
  project: CircuitProject,
  rootDocumentId: string,
): SimulationProbeOptions {
  const documents = new Map(
    project.documents.map((document) => [document.id, document]),
  );
  const root = documents.get(rootDocumentId);
  const voltage: SimulationProbeOption<VoltageProbeTarget>[] = [];
  const sourceCurrent: SimulationProbeOption<SourceCurrentProbeTarget>[] = [];
  if (!root) return { voltage, sourceCurrent };

  const visit = (
    document: SchematicDocument,
    occurrence: readonly string[],
    displayPath: readonly string[],
    ancestry: ReadonlySet<string>,
  ) => {
    const logicalNets = resolveDocumentLogicalNets(document);
    const prefix = displayPath.length
      ? `${displayPath.join("/")} · ${document.name}`
      : document.name;
    // One visible choice per electrical Logical Net. Several Base Nets may be
    // joined by the same scoped label (notably repeated Ground markers); the
    // user should not have to choose among indistinguishable aliases.
    for (const net of logicalNets.groups) {
      const target: VoltageProbeTarget = {
        kind: "net-voltage",
        documentId: document.id,
        netId: net.id,
        occurrence: [...occurrence],
      };
      voltage.push({
        key: simulationProbeTargetKey(target),
        label: `${prefix} · ${net.name ?? net.id}`,
        target,
      });
    }
    for (const instance of document.instances) {
      const binding = instance.netlist?.binding;
      if (
        (binding?.kind === "primitive" || binding?.kind === "model") &&
        binding.deviceClass === "voltage-source"
      ) {
        const target: SourceCurrentProbeTarget = {
          kind: "source-current",
          documentId: document.id,
          instanceId: instance.id,
          occurrence: [...occurrence],
        };
        sourceCurrent.push({
          key: simulationProbeTargetKey(target),
          label: `${prefix} · ${instance.reference ?? instance.id} current`,
          target,
        });
      }
      if (binding?.kind !== "subcircuit") continue;
      const child = documents.get(binding.childDocumentId);
      if (!child || ancestry.has(child.id) || occurrence.length >= 64) continue;
      visit(
        child,
        [...occurrence, instance.id],
        [...displayPath, instance.reference ?? instance.id],
        new Set([...ancestry, child.id]),
      );
    }
  };
  visit(root, [], [], new Set([root.id]));
  return { voltage, sourceCurrent };
}
