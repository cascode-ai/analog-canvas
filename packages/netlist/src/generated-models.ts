import {
  builtInModelContract,
  idealComparatorBodyContract,
  idealOpampBodyContract,
  isIdealComparatorBody,
  isIdealOpampBody,
  type IdealComparatorBody,
  type IdealOpampBody,
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

/**
 * One of the ideal op-amp's bodies (#1463): V(nlin) = gain·V(VIP, VIN), then
 * a smooth clamp of it between the low and the high limit, from ground. Each
 * corner is the smooth maximum or minimum (a + b ± √((a − b)² + w²))/2, so
 * between the limits the output is gain·V(VIP, VIN) to within w²/4d at d
 * volts from a limit, and it bends onto a limit within w, a ten-thousandth
 * of their span. A floor keeps w² above zero, so a supply ramping up from
 * 0 V never divides by zero. A limit is `vhigh` or `vlow`, or V(VDD) or
 * V(VSS) for a body that reads the op-amp's own supply.
 *
 * The layout is what ngspice solves. Across astable, Wien-bridge,
 * phase-shift and Schmitt circuits at gains up to 1e8, a tanh limit around
 * the gain stopped the Wien bridge with "timestep too small", the clamp
 * around the gain failed its start from initial conditions, and a node of
 * its own between the corners failed half the astable and Schmitt runs.
 * The gain in a stage of its own, the clamp in one source, failed none.
 */
function idealOpampModel(target: IdealOpampBody): BehavioralModel {
  const body = idealOpampBodyContract(target);
  const high = body.readsVdd ? "V(VDD)" : "vhigh";
  const low = body.readsVss ? "V(VSS)" : "vlow";
  const corner = `(1e-4*(${high}-${low}))*(1e-4*(${high}-${low}))+1e-12`;
  const above = `(0.5*(${low}+V(nlin)+sqrt((V(nlin)-${low})*(V(nlin)-${low})+${corner})))`;
  return {
    name: body.name,
    ports: body.ports.map((port) => port.name),
    parameters: body.parameters,
    elements: [
      voltage("Blin", "nlin", "0", "gain*(V(VIP)-V(VIN))"),
      voltage(
        "Bcore",
        "VOUT",
        "0",
        `0.5*(${high}+${above}-sqrt((${high}-${above})*(${high}-${above})+${corner}))`,
      ),
    ],
  };
}

/** One family dispatch; printers never own model equations or defaults. */
export function generatedBehavioralDefinition(target: string): BehavioralModel {
  if (isIdealComparatorBody(target)) return idealComparatorModel(target);
  if (isIdealOpampBody(target)) return idealOpampModel(target);
  const model = builtInModelContract(target);
  if (model?.family === "logic") return idealLogicModel(target);
  if (model?.family === "signal") return idealSignalModel(target);
  throw new Error(`No generated behavioral model: ${target}`);
}

export function generatedBehavioralModel(target: string): string[] {
  return printSpiceBehavioralModel(generatedBehavioralDefinition(target));
}
