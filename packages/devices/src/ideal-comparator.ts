import type {
  BuiltInSubcircuitDescriptor,
  BuiltInSubcircuitPort,
} from "./contract.js";
import { IDEAL_COMPARATOR_TARGET } from "./contract.js";
import { isKeyword } from "./parameter-validation.js";

/**
 * The ideal comparator, V(OUT) = vlow + (high − vlow)·½(1 + tanh(V(IN+, IN−)
 * / vtransition)) from ground: the one table every package that treats its
 * high level reads. The high level, `vhigh`, is a number or `VDD`, the
 * comparator's own supply. The logic a comparator drives reads a high above
 * half its supply, so a fixed 1 V never reached it at a VDD of 2 V or more
 * (#1306). Each kind of high level has a body of its own, chosen at the
 * call as an adder's signs choose its body, so no call carries `vhigh=VDD`.
 */

/** The parameter that holds the comparator's high level. */
export const HIGH_LEVEL_PARAMETER = "vhigh";

/** The word the high level takes for the comparator's own VDD, in any case. */
export const SUPPLY_HIGH_LEVEL = "VDD";

/** The body a comparator whose high level is its own VDD calls. */
export const IDEAL_COMPARATOR_SUPPLY_TARGET = "icm_ideal_comparator_vdd";

/** Complementary-output extension; the existing single-ended bodies stay stable. */
export const DIFFERENTIAL_COMPARATOR_TARGET =
  "icm_ideal_comparator_differential";
const DIFFERENTIAL_COMPARATOR_SUPPLY_TARGET =
  "icm_ideal_comparator_differential_vdd";

/**
 * The ideal comparator's bodies, each a name it reserves: the numeric body a
 * comparator with a number in `vhigh` calls, exactly as before VDD was a
 * choice, and the body that reads VDD.
 */
export const IDEAL_COMPARATOR_BODIES = [
  IDEAL_COMPARATOR_TARGET,
  IDEAL_COMPARATOR_SUPPLY_TARGET,
  DIFFERENTIAL_COMPARATOR_TARGET,
  DIFFERENTIAL_COMPARATOR_SUPPLY_TARGET,
] as const;

export type IdealComparatorBody = (typeof IDEAL_COMPARATOR_BODIES)[number];

/** Whether a call names one of the ideal comparator's bodies. */
export function isIdealComparatorBody(
  target: string,
): target is IdealComparatorBody {
  return (IDEAL_COMPARATOR_BODIES as readonly string[]).includes(target);
}

/** Whether a comparator's call names one of the ideal comparator's bodies. */
export function callsIdealComparatorBody(
  descriptor: Pick<BuiltInSubcircuitDescriptor, "target">,
  target: string,
): target is IdealComparatorBody {
  return (
    isIdealComparatorBody(target) &&
    descriptor.target ===
      (idealComparatorModelTarget(target) === IDEAL_COMPARATOR_TARGET
        ? "comparator"
        : DIFFERENTIAL_COMPARATOR_TARGET)
  );
}

/**
 * The body a Library part with this subcircuit target calls as placed: a
 * comparator's symbol names its historical master `comparator`, and calls
 * the ideal comparator.
 */
export function placedSubcircuitTarget(target: string): string {
  return target === "comparator" ? IDEAL_COMPARATOR_TARGET : target;
}

/** The parameter contract shared by a comparator's numeric and supply bodies. */
export function idealComparatorModelTarget(body: IdealComparatorBody): string {
  return body === DIFFERENTIAL_COMPARATOR_TARGET ||
    body === DIFFERENTIAL_COMPARATOR_SUPPLY_TARGET
    ? DIFFERENTIAL_COMPARATOR_TARGET
    : IDEAL_COMPARATOR_TARGET;
}

export function idealComparatorReadsSupply(body: IdealComparatorBody): boolean {
  return (
    body === IDEAL_COMPARATOR_SUPPLY_TARGET ||
    body === DIFFERENTIAL_COMPARATOR_SUPPLY_TARGET
  );
}

/** Whether a high level, as typed, is the comparator's own VDD. */
export function isSupplyHighLevel(value: string): boolean {
  return isKeyword(value, [SUPPLY_HIGH_LEVEL]);
}

/**
 * The body an ideal comparator with these parameters calls, read as export
 * reads them. `VDD`, in any case, reads the supply; so does a comparator
 * with no `vhigh`, which has the default, as Properties shows it. Any other
 * value is a level for the numeric body, which export checks is a number.
 */
export function idealComparatorBodyFor(
  parameters: Readonly<Record<string, string>> | undefined,
  target: string = IDEAL_COMPARATOR_TARGET,
): IdealComparatorBody {
  const high = Object.entries(parameters ?? {}).find(
    ([name]) => name.toLowerCase() === HIGH_LEVEL_PARAMETER,
  )?.[1];
  const supply = high === undefined || isSupplyHighLevel(high);
  return target === DIFFERENTIAL_COMPARATOR_TARGET
    ? supply
      ? DIFFERENTIAL_COMPARATOR_SUPPLY_TARGET
      : DIFFERENTIAL_COMPARATOR_TARGET
    : supply
      ? IDEAL_COMPARATOR_SUPPLY_TARGET
      : IDEAL_COMPARATOR_TARGET;
}

/**
 * The ports of the comparator's interface a body's call lowers, in their
 * order: the signals, and VDD for the body that reads it. Neither body
 * reads VSS.
 */
export function idealComparatorBodyPorts(
  body: IdealComparatorBody,
  ports: readonly BuiltInSubcircuitPort[],
): readonly BuiltInSubcircuitPort[] {
  return ports.filter(
    (port) =>
      !port.supply ||
      (idealComparatorReadsSupply(body) && port.supply === "VDD"),
  );
}
