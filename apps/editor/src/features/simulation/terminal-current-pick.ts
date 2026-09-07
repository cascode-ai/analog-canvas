import { deviceDescriptor } from "@icm/devices";
import type { Instance } from "@icm/model";

/**
 * Return the second terminals that make a directionally meaningful current
 * gesture for the selected pin. The resulting measurement is still the
 * current entering the first terminal; the second click only makes that
 * direction explicit to the author.
 */
export function terminalCurrentDirectionPartners(
  instance: Instance,
  pinName: string,
  measurablePinNames: readonly string[],
): readonly string[] {
  const measurable = new Set(measurablePinNames);
  const descriptor = deviceDescriptor(instance.symbolId);
  if (descriptor?.mosBulkClass) {
    if (pinName === "D" && measurable.has("S")) return ["S"];
    if (pinName === "S" && measurable.has("D")) return ["D"];
    return [];
  }

  const unique = [...measurable];
  if (unique.length !== 2 || !measurable.has(pinName)) return [];
  return unique.filter((candidate) => candidate !== pinName);
}

export function sameSimulationOccurrence(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.length === right.length &&
    left.every((instanceId, index) => instanceId === right[index])
  );
}
