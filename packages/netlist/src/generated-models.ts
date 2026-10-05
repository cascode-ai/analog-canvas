import {
  builtInModelContract,
  builtInModelDefaults,
  IDEAL_COMPARATOR_TARGET,
} from "@icm/devices";
import { spiceIdealLogicSubcircuit } from "./ideal-logic-gate-models.js";
import { spiceIdealSignalSubcircuit } from "./ideal-signal-block-models.js";

/** One family dispatch; printers never own model equations or defaults. */
export function generatedBehavioralModel(target: string): string[] {
  const model = builtInModelContract(target);
  if (model?.family === "logic") return spiceIdealLogicSubcircuit(target);
  if (model?.family === "signal") return spiceIdealSignalSubcircuit(target);
  if (model?.family === "comparator")
    return [
      `.subckt ${IDEAL_COMPARATOR_TARGET} VIP VIN VOUT params: ${Object.entries(
        builtInModelDefaults(target),
      )
        .map(([name, value]) => `${name}=${value}`)
        .join(" ")}`,
      "Bcmp VOUT 0 V={vlow+(vhigh-vlow)*0.5*(1+tanh((V(VIP)-V(VIN))/vtransition))}",
      `.ends ${IDEAL_COMPARATOR_TARGET}`,
    ];
  throw new Error(`No generated behavioral model: ${target}`);
}
