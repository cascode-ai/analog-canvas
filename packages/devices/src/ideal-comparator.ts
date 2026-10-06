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

/**
 * The ideal comparator's bodies, each a name it reserves: the numeric body a
 * comparator with a number in `vhigh` calls, exactly as before VDD was a
 * choice, and the body that reads VDD.
 */
export const IDEAL_COMPARATOR_BODIES = [
  IDEAL_COMPARATOR_TARGET,
  IDEAL_COMPARATOR_SUPPLY_TARGET,
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
  return descriptor.target === "comparator" && isIdealComparatorBody(target);
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
): IdealComparatorBody {
  const high = Object.entries(parameters ?? {}).find(
    ([name]) => name.toLowerCase() === HIGH_LEVEL_PARAMETER,
  )?.[1];
  return high === undefined || isSupplyHighLevel(high)
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
      (body === IDEAL_COMPARATOR_SUPPLY_TARGET && port.supply === "VDD"),
  );
}
