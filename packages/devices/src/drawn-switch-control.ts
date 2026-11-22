import type { DeviceDescriptor } from "./contract.js";

/** A chopper's pins: two in, two out, passed straight or crossed (#1641). */
const CHOPPER_PINS = ["INP", "INN", "OUTP", "OUTN"];

/** A single-pole double-throw selector's pins: COM thrown to A or B (#2440). */
const SELECTOR_PINS = ["COM", "A", "B"];

/** How a drawn switch is controlled; see drawnSwitchControl. */
export type DrawnSwitchControl = "phase" | "pin" | "chopper" | "selector";

/**
 * How a drawn switch is controlled: a two-terminal switch by the clock phase
 * its label names, a single-ended switch by its CTRL pin, a chopper by the
 * clock its label names, straight while it is high and crossed while it is
 * low (#1641), and a selector by the clock its label names, COM to A while it
 * is high and to B while it is low (#2440). All are read against ground.
 * Switches bound to a model of their own are not drawn switches.
 */
export function drawnSwitchControl(
  definition: DeviceDescriptor,
): DrawnSwitchControl | null {
  if (definition.deviceClass !== "switch" || definition.targetPolicy !== "none")
    return null;
  if (definition.pinOrder.length === 2) return "phase";
  if (definition.pinOrder.join() === CHOPPER_PINS.join()) return "chopper";
  if (definition.pinOrder.join() === SELECTOR_PINS.join()) return "selector";
  return definition.pinOrder.length === 3 &&
    definition.pinOrder.includes("CTRL")
    ? "pin"
    : null;
}

/**
 * Whether a drawn switch calls a generated body of switches on the clock its
 * label names, that clock last: a chopper or a selector.
 */
export function callsClockedSwitchBody(
  control: DrawnSwitchControl | null,
): control is "chopper" | "selector" {
  return control === "chopper" || control === "selector";
}
