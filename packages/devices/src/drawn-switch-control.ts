import type { DeviceDescriptor } from "./contract.js";

/** A chopper's pins: two in, two out, passed straight or crossed (#1641). */
const CHOPPER_PINS = ["INP", "INN", "OUTP", "OUTN"];

/**
 * How a drawn switch is controlled: a two-terminal switch by the clock phase
 * its label names, a single-ended switch by its CTRL pin, and a chopper by
 * the clock its label names, straight while it is high and crossed while it
 * is low (#1641). All are read against ground. Switches bound to a model of
 * their own, and selectors SPICE has no primitive for, are not drawn
 * switches.
 */
export function drawnSwitchControl(
  definition: DeviceDescriptor,
): "phase" | "pin" | "chopper" | null {
  if (definition.deviceClass !== "switch" || definition.targetPolicy !== "none")
    return null;
  if (definition.pinOrder.length === 2) return "phase";
  if (definition.pinOrder.join() === CHOPPER_PINS.join()) return "chopper";
  return definition.pinOrder.length === 3 &&
    definition.pinOrder.includes("CTRL")
    ? "pin"
    : null;
}
