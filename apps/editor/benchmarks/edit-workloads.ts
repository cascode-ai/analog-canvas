import {
  CircuitProjectSchema,
  createEmptyProject,
  type CircuitProject,
} from "@icm/model";
import {
  EditorDocumentController,
  EDITOR_PROJECT_TRANSACTION_OPTIONS,
} from "../src/document/document-controller";
import { planBrowserAgentCommand } from "../src/agent/browser-agent-command";
import {
  captureProjectCopy,
  planProjectCopyPlacement,
  applyProjectCopyPlacement,
} from "../src/features/clipboard/project-copy";

/** The release baseline's existing 500-instance fixture. */
export function createEditPerformanceProject(): CircuitProject {
  const base = createEmptyProject("phase-7-large", "Phase 7 Large Project");
  return CircuitProjectSchema.parse({
    ...base,
    documents: [
      {
        ...base.documents[0],
        instances: Array.from({ length: 500 }, (_, index) => ({
          id: `R${index + 1}`,
          symbolId: "resistor",
          placement: {
            position: {
              x: 60 + (index % 25) * 80,
              y: 60 + Math.floor(index / 25) * 80,
            },
            rotation: index % 2 === 0 ? 0 : 90,
            mirror: "none",
          },
          reference: `R${index + 1}`,
          netlist: {
            binding: { kind: "primitive", deviceClass: "resistor" },
            parameters: { value: `${index + 1}k` },
          },
        })),
      },
    ],
  });
}

export const editWorkloadNames = [
  "rotate",
  "undo",
  "paste",
  "wireCommit",
] as const;
export type EditWorkloadName = (typeof editWorkloadNames)[number];

export function createEditWorkload(
  project: CircuitProject,
  name: EditWorkloadName,
) {
  const controller = new EditorDocumentController(project);
  const clipboard =
    name === "paste"
      ? captureProjectCopy(controller.project, controller.document, {
          instanceIds: controller.document.instances
            .slice(0, 12)
            .map((item) => item.id),
          routeIds: [],
          junctionIds: [],
          annotationIds: [],
          draftingIds: [],
        })
      : undefined;
  function rotate() {
    const plan = planBrowserAgentCommand(
      controller.project,
      controller.document.id,
      controller.resolver,
      {
        kind: "transform",
        selection: {
          instanceIds: ["R1"],
          routeIds: [],
          junctionIds: [],
          annotationIds: [],
          draftingIds: [],
        },
        transform: { kind: "rotate", degrees: 90 },
      },
    );
    if (
      !("edits" in plan) ||
      !plan.edits.length ||
      !controller.transact(plan.edits).ok
    )
      throw new Error(`${name} workload failed`);
  }
  if (name === "undo") rotate();
  return {
    controller,
    run() {
      if (name === "rotate") rotate();
      else if (name === "paste") {
        if (!clipboard) throw new Error("Paste workload has no clipboard");
        const plan = planProjectCopyPlacement(
          controller.project,
          controller.document,
          clipboard,
          { x: 0, y: 1800 },
          1,
        );
        controller.commitProjectStructure(
          applyProjectCopyPlacement(
            plan,
            undefined,
            EDITOR_PROJECT_TRANSACTION_OPTIONS,
          ),
          controller.document.id,
        );
      } else if (name === "wireCommit") {
        const plan = planBrowserAgentCommand(
          controller.project,
          controller.document.id,
          controller.resolver,
          {
            kind: "route-net",
            target: {
              kind: "pins",
              pins: [
                { instanceId: "R1", pinName: "1" },
                { instanceId: "R2", pinName: "1" },
              ],
            },
          },
        );
        if (
          !("edits" in plan) ||
          !plan.edits.length ||
          !controller.transact(plan.edits).ok
        )
          throw new Error("Wire commit workload failed");
      } else if (!controller.transact([{ kind: "undo" }]).ok)
        throw new Error("Undo workload failed");
    },
    verify() {
      const document = controller.document;
      const expectedCount = name === "paste" ? 512 : 500;
      if (
        document.instances.length !== expectedCount ||
        new Set(document.instances.map((item) => item.id)).size !==
          expectedCount ||
        controller.canUndo !== (name !== "undo")
      )
        throw new Error(`${name} workload lost objects or history`);
      if (
        (name === "rotate" &&
          document.instances[0]!.placement?.rotation !== 90) ||
        (name === "undo" &&
          (document.instances[0]!.placement?.rotation !== 0 ||
            !controller.canRedo))
      )
        throw new Error(`${name} workload did not change placement`);
      if (
        name === "wireCommit" &&
        (!document.routes.length ||
          !document.nets.some(
            (net) =>
              net.terminals.some(
                (pin) => pin.instanceId === "R1" && pin.pinName === "1",
              ) &&
              net.terminals.some(
                (pin) => pin.instanceId === "R2" && pin.pinName === "1",
              ),
          ))
      )
        throw new Error("Wire workload did not connect its pins");
    },
  };
}
