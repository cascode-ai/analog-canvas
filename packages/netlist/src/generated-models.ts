import {
  builtInModelContract,
  idealComparatorBodyContract,
  isIdealComparatorBody,
  type IdealComparatorBody,
} from "@icm/devices";
import { idealLogicModel } from "./ideal-logic-gate-models.js";
import { idealSignalModel } from "./ideal-signal-block-models.js";
import {
  voltage,
  printSpiceBehavioralModel,
  type BehavioralModel,
} from "./behavioral-model.js";

/**
 * One of the ideal comparator's bodies, from one equation:
 * V(VOUT) = vlow + (high − vlow)·½(1 + tanh(V(VIP, VIN)/vtransition)) from
 * ground, where the high level is `vhigh`, or V(VDD) for the body that reads
 * the comparator's own supply.
 */
function idealComparatorModel(target: IdealComparatorBody): BehavioralModel {
  const body = idealComparatorBodyContract(target);
  const high = body.readsSupply ? "V(VDD)" : "vhigh";
  return {
    name: body.name,
    ports: body.ports.map((port) => port.name),
    parameters: body.parameters,
    elements: [
      voltage(
        "Bcmp",
        "VOUT",
        "0",
        `vlow+(${high}-vlow)*0.5*(1+tanh((V(VIP)-V(VIN))/vtransition))`,
      ),
    ],
  };
}

/** One family dispatch; printers never own model equations or defaults. */
export function generatedBehavioralDefinition(target: string): BehavioralModel {
  if (isIdealComparatorBody(target)) return idealComparatorModel(target);
  const model = builtInModelContract(target);
  if (model?.family === "logic") return idealLogicModel(target);
  if (model?.family === "signal") return idealSignalModel(target);
  throw new Error(`No generated behavioral model: ${target}`);
}

export function generatedBehavioralModel(target: string): string[] {
  return printSpiceBehavioralModel(generatedBehavioralDefinition(target));
}
