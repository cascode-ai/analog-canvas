import {
  builtInModelContract,
  builtInModelDefaults,
  IDEAL_COMPARATOR_TARGET,
} from "@icm/devices";
import { idealLogicModel } from "./ideal-logic-gate-models.js";
import { idealSignalModel } from "./ideal-signal-block-models.js";
import {
  voltage,
  printSpiceBehavioralModel,
  type BehavioralModel,
} from "./behavioral-model.js";

/** One family dispatch; printers never own model equations or defaults. */
export function generatedBehavioralDefinition(target: string): BehavioralModel {
  const model = builtInModelContract(target);
  if (model?.family === "logic") return idealLogicModel(target);
  if (model?.family === "signal") return idealSignalModel(target);
  if (model?.family === "comparator")
    return {
      name: IDEAL_COMPARATOR_TARGET,
      ports: model.ports.map((port) => port.name),
      parameters: Object.entries(builtInModelDefaults(target)).map(
        ([name, defaultValue]) => ({ name, defaultValue }),
      ),
      elements: [
        voltage(
          "Bcmp",
          "VOUT",
          "0",
          "vlow+(vhigh-vlow)*0.5*(1+tanh((V(VIP)-V(VIN))/vtransition))",
        ),
      ],
    };
  throw new Error(`No generated behavioral model: ${target}`);
}

export function generatedBehavioralModel(target: string): string[] {
  return printSpiceBehavioralModel(generatedBehavioralDefinition(target));
}
