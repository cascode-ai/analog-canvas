import {
  planInstanceContactTransform,
  planMoveRouteClearance,
  type ExpectedElectricalEffect,
  type RoutingOperationIntent,
  type SchematicEdit,
} from "@icm/edit-engine";
import type { Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

export type PropertyContactMove =
  | {
      ok: true;
      edits: SchematicEdit[];
      intent: RoutingOperationIntent;
      expectedElectricalEffect: ExpectedElectricalEffect;
    }
  | { ok: false; message: string };

/**
 * A part moved by typing its coordinate lands as if dragged there: its wires
 * follow it, and a pin that now lies on another pin, a wire end or a Junction
 * joins it. A bare move left such a pin lying on the other unconnected.
 *
 * Returns null when the edits move nothing, or also turn or mirror the part —
 * then the contacts a move would plan no longer describe where its pins end
 * up, and the edits stand as they are.
 */
export function planPropertyContactMove(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instance: Instance,
  edits: readonly SchematicEdit[],
): PropertyContactMove | null {
  const move = edits.find(
    (edit): edit is Extract<SchematicEdit, { kind: "move_instance" }> =>
      edit.kind === "move_instance" && edit.instanceId === instance.id,
  );
  if (!move || !instance.placement) return null;
  if (
    edits.some(
      (edit) =>
        (edit.kind === "rotate_instance" || edit.kind === "mirror_instance") &&
        edit.instanceId === instance.id,
    )
  )
    return null;
  const plan = planInstanceContactTransform(
    document,
    resolver,
    { instanceIds: [instance.id], routeIds: [], junctionIds: [] },
    {
      x: move.position.x - instance.placement.position.x,
      y: move.position.y - instance.placement.position.y,
    },
    true,
  );
  const blocking = plan.diagnostics.find((item) => item.severity === "error");
  if (blocking) return { ok: false, message: blocking.message };
  const moved = [...plan.edits, ...edits.filter((edit) => edit !== move)];
  return {
    ok: true,
    // A wire the stretch lays over a part or another Net's pin or wire is
    // drawn clear of it, as the Agent's connect draws it (#1344).
    edits: [
      ...moved,
      ...planMoveRouteClearance(document, resolver, [instance.id], moved),
    ],
    intent: plan.intent,
    expectedElectricalEffect: plan.expectedElectricalEffect,
  };
}
