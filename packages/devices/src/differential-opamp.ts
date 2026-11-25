import type {
  BuiltInSubcircuitDescriptor,
  BuiltInSubcircuitPort,
} from "./contract.js";
import {
  OPAMP_GBW,
  OPAMP_ROUT,
  opampHasDynamicParameter,
} from "./ideal-opamp.js";

/**
 * The ideal fully differential op-amp (#2443): OUT± = level ±
 * gain·V(IN+, IN−)/2 from ground. Its level is the `vocm` parameter, or, on
 * a part whose VOCM pin has a Net, that pin: an ideal CMFB holding the
 * outputs about it. Optional `gbw` and `rout` select dynamic body variants
 * while leaving default calls bit-for-bit unchanged (#2615).
 */
export const DIFFERENTIAL_OPAMP_TARGET = "opamp_differential";

/** The body a part whose VOCM pin has a Net calls (without gbw/rout). */
export const DIFFERENTIAL_OPAMP_VOCM_BODY = "icm_opamp_differential_vocm";

/** The parameter the VOCM pin stands in for. */
export const DIFFERENTIAL_OPAMP_LEVEL = "vocm";

export const DIFFERENTIAL_OPAMP_BODIES = [
  DIFFERENTIAL_OPAMP_TARGET,
  DIFFERENTIAL_OPAMP_VOCM_BODY,
  "icm_opamp_differential_gbw",
  "icm_opamp_differential_rout",
  "icm_opamp_differential_gbw_rout",
  "icm_opamp_differential_vocm_gbw",
  "icm_opamp_differential_vocm_rout",
  "icm_opamp_differential_vocm_gbw_rout",
] as const;

export type IdealDifferentialOpampBody =
  (typeof DIFFERENTIAL_OPAMP_BODIES)[number];

/** Whether a target names one of the ideal differential op-amp's bodies. */
export function isIdealDifferentialOpampBody(
  target: string,
): target is IdealDifferentialOpampBody {
  return (DIFFERENTIAL_OPAMP_BODIES as readonly string[]).includes(target);
}

/** Whether a call names one of the ideal fully differential op-amp's bodies. */
export function callsIdealDifferentialOpampBody(
  descriptor: Pick<BuiltInSubcircuitDescriptor, "target">,
  target: string,
): boolean {
  return (
    descriptor.target === DIFFERENTIAL_OPAMP_TARGET &&
    isIdealDifferentialOpampBody(target)
  );
}

/** The body a differential op-amp with these parameters and VOCM connection calls. */
export function differentialOpampBodyFor(
  parameters: Readonly<Record<string, string>> | undefined,
  vocmConnected: boolean,
): IdealDifferentialOpampBody {
  const gbw = opampHasDynamicParameter(parameters, OPAMP_GBW);
  const rout = opampHasDynamicParameter(parameters, OPAMP_ROUT);
  const dynamicSuffix =
    gbw && rout ? "_gbw_rout" : gbw ? "_gbw" : rout ? "_rout" : "";
  if (vocmConnected) {
    return `${DIFFERENTIAL_OPAMP_VOCM_BODY}${dynamicSuffix}` as IdealDifferentialOpampBody;
  }
  return dynamicSuffix
    ? (`icm_opamp_differential${dynamicSuffix}` as IdealDifferentialOpampBody)
    : DIFFERENTIAL_OPAMP_TARGET;
}

/** Which optional features a differential op-amp body models. */
export function differentialOpampBodyTraits(body: IdealDifferentialOpampBody): {
  readonly vocmPin: boolean;
  readonly gbw: boolean;
  readonly rout: boolean;
} {
  return {
    vocmPin: body.includes("_vocm"),
    gbw: body.includes("_gbw"),
    rout: body.includes("_rout"),
  };
}

/**
 * The ports a call lowers, in order: every port but an optional one whose
 * pin `connected` says has no Net.
 */
export function callPorts(
  ports: readonly BuiltInSubcircuitPort[],
  connected: (pinName: string) => boolean,
): readonly BuiltInSubcircuitPort[] {
  return ports.filter((port) => !port.optional || connected(port.pinName));
}
