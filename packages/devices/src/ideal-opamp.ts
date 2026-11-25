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
/** Optional dynamic parameters: unity-gain bandwidth (Hz) and output resistance (Ω). */
export const OPAMP_GBW = "gbw";
export const OPAMP_ROUT = "rout";
export const OPAMP_GBW_DEFAULT = "1e7";
export const OPAMP_ROUT_DEFAULT = "100";

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
 * The op-amp's bodies: the numeric body under the op-amp's own name, one for
 * each set of limits read from its supplies, and optional dynamic variants
 * (`_gbw`, `_rout`, `_gbw_rout`) chosen only when the author sets `gbw` or
 * `rout` (#2615). Each reserves its name.
 */
export const IDEAL_OPAMP_BODIES = [
  OPAMP_TARGET,
  "icm_opamp_vdd",
  "icm_opamp_vss",
  "icm_opamp_vdd_vss",
  "icm_opamp_gbw",
  "icm_opamp_rout",
  "icm_opamp_gbw_rout",
  "icm_opamp_vdd_gbw",
  "icm_opamp_vdd_rout",
  "icm_opamp_vdd_gbw_rout",
  "icm_opamp_vss_gbw",
  "icm_opamp_vss_rout",
  "icm_opamp_vss_gbw_rout",
  "icm_opamp_vdd_vss_gbw",
  "icm_opamp_vdd_vss_rout",
  "icm_opamp_vdd_vss_gbw_rout",
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
function opampParameterValue(
  parameters: Readonly<Record<string, string>> | undefined,
  key: string,
): string | undefined {
  return Object.entries(parameters ?? {}).find(
    ([name]) => name.toLowerCase() === key,
  )?.[1];
}

/** Whether an optional dynamic op-amp parameter (`gbw` or `rout`) is set. */
export function opampHasDynamicParameter(
  parameters: Readonly<Record<string, string>> | undefined,
  key: typeof OPAMP_GBW | typeof OPAMP_ROUT,
): boolean {
  const value = opampParameterValue(parameters, key);
  return value !== undefined && value.trim().length > 0;
}

/** Whether a limit is left at its default or set to its supply, any case. */
export function limitFollowsSupply(
  parameters: Readonly<Record<string, string>> | undefined,
  limit: OpampLimit,
): boolean {
  const value = opampParameterValue(parameters, limit);
  return value === undefined || isSupplyLimit(limit, value);
}

/**
 * The body an ideal op-amp with these parameters calls. A limit that
 * follows its supply reads that supply when the op-amp is powered; any
 * other value is a level for the numeric body, which export checks is a
 * number. Setting `gbw` and/or `rout` selects the matching dynamic body so
 * existing memoryless op-amps stay bit-for-bit identical (#2615).
 */
export function idealOpampBodyFor(
  parameters: Readonly<Record<string, string>> | undefined,
  powered: boolean,
): IdealOpampBody {
  const vdd = powered && limitFollowsSupply(parameters, OPAMP_HIGH_LIMIT);
  const vss = powered && limitFollowsSupply(parameters, OPAMP_LOW_LIMIT);
  const gbw = opampHasDynamicParameter(parameters, OPAMP_GBW);
  const rout = opampHasDynamicParameter(parameters, OPAMP_ROUT);
  const dynamicSuffix =
    gbw && rout ? "_gbw_rout" : gbw ? "_gbw" : rout ? "_rout" : "";
  if (vdd && vss) return `icm_opamp_vdd_vss${dynamicSuffix}` as IdealOpampBody;
  if (vdd) return `icm_opamp_vdd${dynamicSuffix}` as IdealOpampBody;
  if (vss) return `icm_opamp_vss${dynamicSuffix}` as IdealOpampBody;
  return dynamicSuffix
    ? (`icm_opamp${dynamicSuffix}` as IdealOpampBody)
    : OPAMP_TARGET;
}

/** The supplies and dynamic stages a body models. */
export function idealOpampBodyReads(body: IdealOpampBody): {
  readonly vdd: boolean;
  readonly vss: boolean;
  readonly gbw: boolean;
  readonly rout: boolean;
} {
  return {
    vdd: body.includes("_vdd"),
    vss: body.includes("_vss"),
    gbw: body.includes("_gbw"),
    rout: body.includes("_rout"),
  };
}
