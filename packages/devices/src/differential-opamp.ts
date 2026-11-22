import type {
  BuiltInSubcircuitDescriptor,
  BuiltInSubcircuitPort,
} from "./contract.js";

/**
 * The ideal fully differential op-amp (#2443): OUT± = level ±
 * gain·V(IN+, IN−)/2 from ground. Its level is the `vocm` parameter, or, on
 * a part whose VOCM pin has a Net, that pin: an ideal CMFB holding the
 * outputs about it. Each has a body of its own, chosen at the call as the
 * op-amp's supplies choose its body, so a part leaving VOCM undrawn calls
 * `opamp_differential` exactly as before VOCM was a pin.
 */
export const DIFFERENTIAL_OPAMP_TARGET = "opamp_differential";

/** The body a part whose VOCM pin has a Net calls. */
export const DIFFERENTIAL_OPAMP_VOCM_BODY = "icm_opamp_differential_vocm";

/** The parameter the VOCM pin stands in for. */
export const DIFFERENTIAL_OPAMP_LEVEL = "vocm";

/** Whether a call names one of the ideal fully differential op-amp's bodies. */
export function callsIdealDifferentialOpampBody(
  descriptor: Pick<BuiltInSubcircuitDescriptor, "target">,
  target: string,
): boolean {
  return (
    descriptor.target === DIFFERENTIAL_OPAMP_TARGET &&
    (target === DIFFERENTIAL_OPAMP_TARGET ||
      target === DIFFERENTIAL_OPAMP_VOCM_BODY)
  );
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
