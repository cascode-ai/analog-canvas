import type { BuiltInSubcircuitDescriptor } from "./contract.js";
import { isKeyword } from "./parameter-validation.js";

/**
 * The ideal op-amp's output limits (#1463). Its output follows
 * gain·V(VIP, VIN) from ground exactly between a low and a high limit and
 * bends onto each within a ten-thousandth of their span. Without a limit,
 * an astable multivibrator's positive feedback diverged, a Wien-bridge or
 * phase-shift oscillator grew without bound, and a Schmitt trigger had no
 * ±Vsat to set its thresholds.
 *
 * Each limit is a number in volts from ground, or the op-amp's own supply:
 * `VDD` for the high limit and `VSS` for the low one, the defaults. An
 * op-amp is powered when its VDD is a Net: one selected in Properties, or
 * the Cell's one drawn positive supply. A powered op-amp's VSS is its own
 * VSS, usually ground. An op-amp with no supply of its own reads +5 V and
 * −5 V for them (owner decision, 2026-10-08), so a textbook figure drawn
 * without supplies still saturates. Each kind of limit has a body of its
 * own, chosen at the call as the comparator's high level chooses its body,
 * so no call carries `vhigh=VDD`.
 */

/** The op-amp's own target, also the body whose limits are both numbers. */
export const OPAMP_TARGET = "opamp";

/** The parameters that hold the op-amp's output limits. */
export const OPAMP_HIGH_LIMIT = "vhigh";
export const OPAMP_LOW_LIMIT = "vlow";

/** The words each limit takes for the op-amp's own supply, in any case. */
export const OPAMP_LIMIT_SUPPLIES = {
  [OPAMP_HIGH_LIMIT]: "VDD",
  [OPAMP_LOW_LIMIT]: "VSS",
} as const;

/** The levels a supply limit reads on an op-amp with no supply of its own. */
export const UNPOWERED_OPAMP_LIMITS = {
  [OPAMP_HIGH_LIMIT]: "5",
  [OPAMP_LOW_LIMIT]: "-5",
} as const;

export type OpampLimit = keyof typeof OPAMP_LIMIT_SUPPLIES;

/**
 * The op-amp's bodies: the numeric body under the op-amp's own name, and
 * one for each set of limits read from its supplies. Each reserves its name.
 */
export const IDEAL_OPAMP_BODIES = [
  OPAMP_TARGET,
  "icm_opamp_vdd",
  "icm_opamp_vss",
  "icm_opamp_vdd_vss",
] as const;

export type IdealOpampBody = (typeof IDEAL_OPAMP_BODIES)[number];

/** Whether a call names one of the ideal op-amp's bodies. */
export function isIdealOpampBody(target: string): target is IdealOpampBody {
  return (IDEAL_OPAMP_BODIES as readonly string[]).includes(target);
}

/** Whether an op-amp's call names one of the ideal op-amp's bodies. */
export function callsIdealOpampBody(
  descriptor: Pick<BuiltInSubcircuitDescriptor, "target">,
  target: string,
): target is IdealOpampBody {
  return descriptor.target === OPAMP_TARGET && isIdealOpampBody(target);
}

/** Whether a limit, as typed, is the op-amp's own supply. */
export function isSupplyLimit(limit: OpampLimit, value: string): boolean {
  return isKeyword(value, [OPAMP_LIMIT_SUPPLIES[limit]]);
}

/** Whether a parameter, by its name in any case, is a limit set to its supply. */
export function isSupplyLimitParameter(name: string, value: string): boolean {
  const limit = name.toLowerCase();
  return (
    (limit === OPAMP_HIGH_LIMIT || limit === OPAMP_LOW_LIMIT) &&
    isSupplyLimit(limit, value)
  );
}

/** A limit's value as the op-amp's parameters hold it, in any case. */
function opampLimitValue(
  parameters: Readonly<Record<string, string>> | undefined,
  limit: OpampLimit,
): string | undefined {
  return Object.entries(parameters ?? {}).find(
    ([name]) => name.toLowerCase() === limit,
  )?.[1];
}

/** Whether a limit is left at its default or set to its supply, any case. */
export function limitFollowsSupply(
  parameters: Readonly<Record<string, string>> | undefined,
  limit: OpampLimit,
): boolean {
  const value = opampLimitValue(parameters, limit);
  return value === undefined || isSupplyLimit(limit, value);
}

/**
 * The body an ideal op-amp with these parameters calls. A limit that
 * follows its supply reads that supply when the op-amp is powered; any
 * other value is a level for the numeric body, which export checks is a
 * number.
 */
export function idealOpampBodyFor(
  parameters: Readonly<Record<string, string>> | undefined,
  powered: boolean,
): IdealOpampBody {
  const vdd = powered && limitFollowsSupply(parameters, OPAMP_HIGH_LIMIT);
  const vss = powered && limitFollowsSupply(parameters, OPAMP_LOW_LIMIT);
  return vdd && vss
    ? "icm_opamp_vdd_vss"
    : vdd
      ? "icm_opamp_vdd"
      : vss
        ? "icm_opamp_vss"
        : OPAMP_TARGET;
}

/** The supplies a body reads in place of a numeric limit. */
export function idealOpampBodyReads(body: IdealOpampBody): {
  readonly vdd: boolean;
  readonly vss: boolean;
} {
  return {
    vdd: body === "icm_opamp_vdd" || body === "icm_opamp_vdd_vss",
    vss: body === "icm_opamp_vss" || body === "icm_opamp_vdd_vss",
  };
}
