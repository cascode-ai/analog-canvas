import {
  createEmptyDocument,
  createEmptyProject,
  type Instance,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { describe, expect, it } from "vitest";
import { type SchematicEdit } from "@icm/edit-engine";
import { EditorDocumentController } from "./document-controller";

// Generator v1: eight seeds, eight batches per seed, two independent parts.
// Replay a reported batch list with ICM_HISTORY_BATCHES='<JSON>' and -t replay.
function batches(seed: number) {
  let state = seed;
  const next = (limit: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * limit);
  };
  return Array.from({ length: 8 }, (_, index) => ({
    kind: (["combined", "netlist", "signal-flow", "geometry"] as const)[
      index % 4
    ]!,
    instanceId: index % 2 ? "R2" : "R1",
    placement: {
      position: { x: (next(41) - 20) * 10, y: (next(41) - 20) * 10 },
      rotation: ([0, 90, 180, 270] as const)[next(4)]!,
      mirror: (["none", "horizontal", "vertical", "both"] as const)[next(4)]!,
    },
    value: `${1 + index * 100 + next(100)}k`,
    formula: (["z^-1", "a_0", "1/(s+1)"] as const)[next(3)]!,
    coefficient: `a${index}`,
  }));
}

const cases = process.env.ICM_HISTORY_BATCHES
  ? [
      {
        seed: "replay",
        batches: JSON.parse(process.env.ICM_HISTORY_BATCHES) as ReturnType<
          typeof batches
        >,
      },
    ]
  : [1, 7, 42, 257, 1024, 65535, 123456, 0xffffffff].map((seed) => ({
      seed: String(seed),
      batches: batches(seed),
    }));

function fixture() {
  const document = createEmptyDocument("document-main", "Main");
  document.instances = ["R1", "R2"].map((id) => ({
    id,
    reference: id,
    symbolId: "resistor",
    placement: null,
    netlist: {
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: {},
    },
  }));
  return document;
}

describe("Project history sequence invariants", () => {
  it.each(cases)(
    "restores every batch and keeps rejected/dry-run batches out of history (v1 seed=$seed)",
    ({ seed, batches }) => {
      expect(batches.length).toBeGreaterThan(0);
      expect(batches.length).toBeLessThanOrEqual(12);
      const project = createEmptyProject("sequence", "Sequence");
      project.documents = [fixture()];
      const history = new EditorDocumentController(project);
      const states: Instance[][] = [
        structuredClone(history.document.instances),
      ];
      let revision = 0;
      const transact = (edits: SchematicEdit[], dryRun = false) =>
        history.dispatchTransaction({
          transactionId: `sequence-${revision}`,
          documentId: history.document.id,
          expectedRevision: revision,
          expectedStructureRevision: history.project.structureRevision,
          actor: { kind: "human", id: "sequence-test" },
          dryRun,
          edits,
        });
      const context = JSON.stringify({ generator: 1, seed, batches });

      for (const [index, batch] of batches.entries()) {
        const geometry = batch.kind === "combined" || batch.kind === "geometry";
        const netlist = batch.kind === "combined" || batch.kind === "netlist";
        const signalFlow =
          batch.kind === "combined" || batch.kind === "signal-flow";
        const edits: SchematicEdit[] = [
          ...(geometry &&
          history.document.instances.find(
            (instance) => instance.id === batch.instanceId,
          )!.placement
            ? [
                {
                  kind: "unplace_instance" as const,
                  instanceId: batch.instanceId,
                },
              ]
            : []),
          ...(geometry
            ? [
                {
                  kind: "place_instance",
                  instanceId: batch.instanceId,
                  placement: batch.placement,
                } as const,
              ]
            : []),
          ...(netlist
            ? [
                {
                  kind: "patch_instance_netlist_parameters",
                  instanceId: batch.instanceId,
                  set: { value: batch.value },
                } as const,
              ]
            : []),
          ...(signalFlow
            ? [
                {
                  kind: "set_instance_signal_flow_parameters",
                  instanceId: batch.instanceId,
                  parameters: {
                    formula: batch.formula,
                    coefficient: batch.coefficient,
                  },
                } as const,
              ]
            : []),
        ];
        const beforeProject = structuredClone(history.project);
        const invalid = [...edits];
        invalid.splice(index % (edits.length + 1), 0, {
          kind: "move_instance",
          instanceId: "missing",
          position: { x: 0, y: 0 },
        });
        const rejection = transact(invalid);
        expect(
          rejection,
          `${context}\n${JSON.stringify(rejection.ok ? null : rejection.error)}`,
        ).toMatchObject({
          ok: false,
          applied: false,
          error: { code: "OBJECT_NOT_FOUND" },
        });
        expect(history.project, context).toEqual(beforeProject);
        const preview = transact(edits, true);
        expect(
          preview,
          `${context}\n${JSON.stringify(preview.ok ? null : preview.error)}`,
        ).toMatchObject({
          ok: true,
          applied: false,
          revision,
          proposedRevision: revision + 1,
        });
        expect(history.project, context).toEqual(beforeProject);
        expect(transact(edits), context).toMatchObject({
          ok: true,
          applied: true,
          revision: ++revision,
        });

        // The oracle assigns the requested fields; it does not execute edits or
        // derive expected state from the transaction's returned Document.
        const expected = structuredClone(states.at(-1)!);
        const target = expected.find(
          (instance) => instance.id === batch.instanceId,
        )!;
        if (geometry) target.placement = structuredClone(batch.placement);
        if (netlist) target.netlist!.parameters.value = batch.value;
        if (signalFlow)
          target.signalFlowParameters = {
            formula: batch.formula,
            coefficient: batch.coefficient,
          };
        expect(history.document.instances, context).toEqual(expected);
        states.push(expected);
        expect(history.canUndo, context).toBe(true);
        expect(history.canRedo, context).toBe(false);
        const saved = serializeProject(history.project);
        const loaded = parseProject(saved);
        expect(loaded.documents[0]!.instances, context).toEqual(expected);
        expect(serializeProject(loaded), context).toBe(saved);
      }

      for (let index = states.length - 2; index >= 0; index--) {
        const before = structuredClone(history.document);
        expect(transact([{ kind: "undo" }], true), context).toMatchObject({
          ok: true,
          applied: false,
          revision,
          proposedRevision: revision + 1,
        });
        expect(history.document, context).toEqual(before);
        expect(transact([{ kind: "undo" }]), context).toMatchObject({
          ok: true,
          applied: true,
          revision: ++revision,
        });
        expect(history.document.instances, context).toEqual(states[index]);
        expect(history.canRedo, context).toBe(true);
      }
      expect(history.canUndo, context).toBe(false);
      expect(transact([{ kind: "undo" }]), context).toMatchObject({
        ok: false,
        error: { code: "HISTORY_EMPTY" },
      });
      for (const state of states.slice(1)) {
        expect(transact([{ kind: "redo" }]), context).toMatchObject({
          ok: true,
          applied: true,
          revision: ++revision,
        });
        expect(history.document.instances, context).toEqual(state);
      }
      expect(history.canRedo, context).toBe(false);
      expect(transact([{ kind: "redo" }]), context).toMatchObject({
        ok: false,
        error: { code: "HISTORY_EMPTY" },
      });
    },
  );
});
