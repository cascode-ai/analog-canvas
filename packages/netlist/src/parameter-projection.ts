import {
  reviewedExternalBindingById,
  projectLengthToSky130Micrometres,
  sky130MicrometresToProjectLength,
} from "@icm/devices";
import type { DesignNetlistInstance } from "./ir.js";

/** Internal value projection, not an editable-policy or persisted contract. */
export type PrintedParameterConversion = "identity" | "sky130-micrometres";

export function printedParameterConversion(
  instance: Pick<DesignNetlistInstance, "reviewedExternalBindingId">,
  parameter: string,
): PrintedParameterConversion {
  const binding = reviewedExternalBindingById(
    instance.reviewedExternalBindingId,
  );
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
  if (allowSiLiteral && /[a-z]$/iu.test(value.trim())) {
    // Use the same geometry grammar as forward export, including "250 n".
    // A suffix candidate is not proof: the owner rejects invalid/unknown units.
    projectLengthToSky130Micrometres(value);
    return value;
  }
  return sky130MicrometresToProjectLength(value);
}
