import type { SchematicEdit } from "@icm/edit-engine";
import { drawnSwitchPhase } from "@icm/derived";
import { deviceDescriptor, drawnSwitchControl } from "@icm/devices";
import type { CircuitProject, SchematicDocument } from "@icm/model";

import { planDisplayAlias, type GroupNamingInput } from "./group-naming";

type Instance = SchematicDocument["instances"][number];

/**
 * A switch clocked by the phase its label names (a two-terminal switch or a
 * chopper; one with a CTRL pin is wired instead): the phase as written, Φ_A_bar
 * for Φ̄_A, or null when the label names none and the switch is clocked by its
 * own name. Undefined for every other part. The label is the one record of the
 * phase, shown or hidden; Properties and the Agent edit it as `control`.
 */
export function switchControlOf(
  project: CircuitProject,
  document: SchematicDocument,
  instance: Instance,
): string | null | undefined {
  const definition = deviceDescriptor(instance.symbolId, project);
  const kind = definition ? drawnSwitchControl(definition) : null;
  if (kind !== "phase" && kind !== "chopper") return undefined;
  const phase = drawnSwitchPhase(document, instance);
  return phase ? (phase.drawnName ?? phase.name) : null;
}

/**
 * The switch's label made to name `control` (null: the switch's own name),
 * shown or hidden as `visible` says: the phase stays the switch's control
 * whether or not the figure prints it, as a phase drawn once over ganged
 * switches does.
 */
export function planSwitchControl(input: {
  document: SchematicDocument;
  instanceId: string;
  control: string | null;
  visible: boolean;
  labelFor: GroupNamingInput["labelFor"];
  newLabelFor: GroupNamingInput["newLabelFor"];
}): { ok: true; edits: SchematicEdit[] } | { ok: false; message: string } {
  const existing = input.labelFor(input.document, input.instanceId);
  const plan = planDisplayAlias({
    document: input.document,
    instanceId: input.instanceId,
    alias: input.control,
    labelFor: input.labelFor,
    newLabelFor: input.newLabelFor,
  });
  if (!plan.ok) return plan;
  // The alias planner shows the label; a phase keeps the visibility asked for.
  const edits = (
    plan.edits.length > 0
      ? plan.edits
      : existing
        ? [
            {
              kind: "upsert_schematic_annotation" as const,
              annotation: existing,
            },
          ]
        : []
  ).map((edit) => {
    if (edit.kind !== "upsert_schematic_annotation") return edit;
    const { visible: _visible, ...annotation } = edit.annotation;
    return {
      ...edit,
      annotation: input.visible
        ? annotation
        : { ...annotation, visible: false },
    };
  });
  return {
    ok: true,
    edits: edits.filter(
      (edit) =>
        edit.kind !== "upsert_schematic_annotation" ||
        JSON.stringify(edit.annotation) !== JSON.stringify(existing),
    ),
  };
}
