import {
  reviewedExternalDeviceBindings,
  sky130MicrometresToProjectLength,
} from "@icm/devices";
import { parseSpiceNumber } from "@icm/spice";
import type { DesignNetlistInstance } from "./ir.js";

/** Internal value projection, not an editable-policy or persisted contract. */
export type PrintedParameterConversion = "identity" | "sky130-micrometres";

const reviewedById = new Map(
  reviewedExternalDeviceBindings.map((binding) => [binding.id, binding]),
);

export function printedParameterConversion(
  instance: Pick<DesignNetlistInstance, "reviewedExternalBindingId">,
  parameter: string,
): PrintedParameterConversion {
  const binding = instance.reviewedExternalBindingId
    ? reviewedById.get(instance.reviewedExternalBindingId)
    : undefined;
  return binding?.parameters.find(
    (p) => p.name.toLowerCase() === parameter.toLowerCase(),
  )?.targetUnit === "micrometre"
    ? "sky130-micrometres"
    : "identity";
}

/** Native syntax decoding/validation belongs to the caller. Ordinary Netlist
 * also accepts authored SI literals; Circuit keeps its plain-um input policy. */
export function restorePrintedParameter(
  value: string,
  conversion: PrintedParameterConversion,
  allowSiLiteral = false,
): string {
  if (conversion === "identity") return value;
  if (allowSiLiteral) {
    const number = parseSpiceNumber(value);
    if (number?.suffix) return value;
  }
  return sky130MicrometresToProjectLength(value);
}
