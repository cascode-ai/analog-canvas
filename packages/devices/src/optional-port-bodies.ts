import type {
  BuiltInSubcircuitDescriptor,
  BuiltInSubcircuitPort,
} from "./contract.js";
import { builtInSubcircuitDescriptors } from "./registry.js";

/**
 * Built-in subcircuit parts whose optional pin selects a widened generated
 * body when wired (#2443, #2444), keeping the base call interface compact
 * whenever the optional pin is left unwired or marked No Connect.
 */
export interface OptionalPortBodySpec {
  readonly target: string;
  readonly optionalPort: string;
  readonly kind: "cell" | "behavioral";
}

export const OPTIONAL_PORT_BODY_SPECS: Readonly<
  Record<string, OptionalPortBodySpec>
> = {
  icm_center_tap_xfmr_dual: {
    target: "center_tap_xfmr",
    optionalPort: "PC",
    kind: "cell",
  },
  icm_opamp_compensated_2: {
    target: "opamp_compensated",
    optionalPort: "COMP2",
    kind: "behavioral",
  },
  icm_opamp_enable_gnd: {
    target: "opamp_enable",
    optionalPort: "GND",
    kind: "behavioral",
  },
  icm_opamp_bias_en: {
    target: "opamp_bias",
    optionalPort: "EN",
    kind: "behavioral",
  },
};

export const OPTIONAL_PORT_BEHAVIORAL_BODIES = Object.entries(
  OPTIONAL_PORT_BODY_SPECS,
)
  .filter(([, spec]) => spec.kind === "behavioral")
  .map(([body]) => body);

export function optionalPortBodySpec(
  body: string,
): OptionalPortBodySpec | undefined {
  return Object.hasOwn(OPTIONAL_PORT_BODY_SPECS, body)
    ? OPTIONAL_PORT_BODY_SPECS[body]
    : undefined;
}

export function isOptionalPortBody(body: string): boolean {
  return optionalPortBodySpec(body) !== undefined;
}

export function isOptionalPortBehavioralBody(body: string): boolean {
  return optionalPortBodySpec(body)?.kind === "behavioral";
}

/**
 * The widened body name for `target` when its optional port `optionalPort`
 * is connected, or undefined when the base body applies.
 */
export function optionalPortBodyFor(
  target: string,
  optionalPort: string | undefined,
): string | undefined {
  if (!optionalPort) return undefined;
  return Object.entries(OPTIONAL_PORT_BODY_SPECS).find(
    ([, spec]) => spec.target === target && spec.optionalPort === optionalPort,
  )?.[0];
}

/** Whether a descriptor+target pair uses one of the optional-port body families. */
export function callsOptionalPortBody(
  descriptor: Pick<BuiltInSubcircuitDescriptor, "target">,
  target: string,
): boolean {
  const spec = optionalPortBodySpec(target);
  if (spec) return spec.target === descriptor.target;
  return Object.values(OPTIONAL_PORT_BODY_SPECS).some(
    (entry) => entry.target === descriptor.target && entry.target === target,
  );
}

/** Full ordered ports of an optional-port body (base ports + optional port). */
export function optionalPortBodyPorts(
  body: string,
): readonly BuiltInSubcircuitPort[] | undefined {
  const spec = optionalPortBodySpec(body);
  if (!spec) return undefined;
  const descriptor = builtInSubcircuitDescriptors.find(
    (candidate) => candidate.target === spec.target,
  );
  if (!descriptor) return undefined;
  return descriptor.ports.filter(
    (port) => !port.optional || port.name === spec.optionalPort,
  );
}
