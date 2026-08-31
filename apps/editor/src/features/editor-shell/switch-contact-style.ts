import type { SchematicEdit } from "@icm/edit-engine";

/**
 * How a switch draws its contacts, as a state of one component rather than a
 * shelf of near-duplicate parts.
 *
 * Each pair is two Symbols with identical pin names at identical anchors and
 * only the contact circles differing, so exchanging them keeps every terminal
 * identity — and with it every Net and every drawn wire. This is the same
 * mechanism the differential outputs use, for the same reason.
 *
 * Terminal COUNT is deliberately not on this axis. A two-terminal switch and
 * a selector are different devices, and expressing that as a Symbol variant
 * with `hiddenPinNames` would keep a wired terminal attached while removing
 * it from the drawing: the Project would still carry the connection that the
 * schematic no longer shows.
 */
const CONTACT_STYLE_SIBLINGS: Readonly<Record<string, string>> = {
  "ideal-switch": "simple-switch",
  "simple-switch": "ideal-switch",
  "spdt-switch": "simple-spdt-switch",
  "simple-spdt-switch": "spdt-switch",
};

export function switchContactStyleSibling(
  symbolId: string,
): string | undefined {
  return CONTACT_STYLE_SIBLINGS[symbolId];
}

/** Whether the sibling draws contact circles, for naming the action. */
export function drawsContactCircles(symbolId: string): boolean {
  return symbolId === "ideal-switch" || symbolId === "spdt-switch";
}

export function planSwitchContactStyleSwap(
  instanceId: string,
  symbolId: string,
): SchematicEdit[] {
  const sibling = switchContactStyleSibling(symbolId);
  return sibling
    ? [{ kind: "set_instance_symbol", instanceId, symbolId: sibling }]
    : [];
}
