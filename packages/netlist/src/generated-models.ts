import {
  builtInModelContract,
  builtInModelDefaults,
  idealComparatorBodyContract,
  idealOpampBodyContract,
  isIdealComparatorBody,
  isIdealOpampBody,
  type IdealComparatorBody,
  type IdealOpampBody,
} from "@icm/devices";
import { idealLogicModel } from "./ideal-logic-gate-models.js";
import {
  chopperBehavioralDefinition,
  IDEAL_CHOPPER_TARGET,
  spiceChopperBody,
} from "./ideal-switch-model.js";
import { idealSignalModel } from "./ideal-signal-block-models.js";
import {
  passive,
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
  const differential = body.ports.some((port) => port.pinName === "OUT-");
  return {
    name: body.name,
    ports: body.ports.map((port) => port.name),
    parameters: body.parameters,
    elements: [
      voltage(
        "Bcmp",
        differential ? "VOP" : "VOUT",
        "0",
        `vlow+(${high}-vlow)*0.5*(1+tanh((V(VIP)-V(VIN))/vtransition))`,
      ),
      ...(differential
        ? [
            voltage(
              "Bcmpn",
              "VON",
              "0",
              `vlow+(${high}-vlow)*0.5*(1-tanh((V(VIP)-V(VIN))/vtransition))`,
            ),
          ]
        : []),
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

/**
 * The crystal's Butterworth-Van Dyke equivalent between its two pins: the
 * motional branch rm, lm, cm in series, and c0 across it. SPICE has no
 * crystal card, so a crystal prints as a call of this body.
 */
function crystalModel(target: string): BehavioralModel {
  const model = builtInModelContract(target)!;
  const [a, b] = model.ports.map((port) => port.name) as [string, string];
  return {
    name: target,
    ports: [a, b],
    comment: "Crystal: Butterworth-Van Dyke model, fs = 1/(2*pi*sqrt(lm*cm))",
    parameters: Object.entries(builtInModelDefaults(target)).map(
      ([name, defaultValue]) => ({ name, defaultValue }),
    ),
    elements: [
      passive("resistor", "Rm", a, "nr", "rm", true),
      passive("inductor", "Lm", "nr", "nl", "lm", true),
      passive("capacitor", "Cm", "nl", b, "cm", true),
      passive("capacitor", "C0", a, b, "c0", true),
    ],
  };
}

/**
 * One family dispatch; printers never own model equations or defaults.
 * `ports` prints the same body with its ports in another order (see
 * `withBodyPortOrder`); its elements name ports, never positions.
 */
export function generatedBehavioralDefinition(
  target: string,
  ports?: readonly string[],
): BehavioralModel {
  const model = familyDefinition(target);
  return ports ? { ...model, ports } : model;
}

function familyDefinition(target: string): BehavioralModel {
  if (target === IDEAL_CHOPPER_TARGET) return chopperBehavioralDefinition();
  if (isIdealComparatorBody(target)) return idealComparatorModel(target);
  if (isIdealOpampBody(target)) return idealOpampModel(target);
  const model = builtInModelContract(target);
  if (model?.family === "logic") return idealLogicModel(target);
  if (model?.family === "signal") return idealSignalModel(target);
  if (model?.family === "passive") return crystalModel(target);
  throw new Error(`No generated behavioral model: ${target}`);
}

export function generatedBehavioralModel(
  target: string,
  ports?: readonly string[],
): string[] {
  // SPICE switches the chopper's paths with its native S cards (#1641).
  if (target === IDEAL_CHOPPER_TARGET) {
    if (ports) throw new Error("The SPICE chopper body keeps its own ports");
    return spiceChopperBody();
  }
  return printSpiceBehavioralModel(
    generatedBehavioralDefinition(target, ports),
  );
}
