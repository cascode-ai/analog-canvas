import type { DesignNetlistModel } from "./ir.js";
import { current, type BehavioralModel } from "./behavioral-model.js";

/** The unchanged electrical contract of every drawn open/closed/controlled switch. */
export const IDEAL_SWITCH_MODEL: DesignNetlistModel = {
  name: "ideal_switch",
  type: "SW",
  parameters: [
    { name: "RON", rawValue: "1" },
    { name: "ROFF", rawValue: "1e12" },
    { name: "VT", rawValue: "0.5" },
    { name: "VH", rawValue: "0" },
  ],
};

/** Hard, non-hysteretic conductance. No hidden smoothing or parasitics. */
export function switchBehavioralDefinition(
  model: DesignNetlistModel,
): BehavioralModel {
  const values = new Map(
    model.parameters.map((p) => [p.name.toLowerCase(), p.rawValue]),
  );
  return {
    name: model.name,
    ports: ["p", "n", "cp", "cn"],
    parameters: [
      { name: "ron", defaultValue: values.get("ron") ?? "1" },
      { name: "roff", defaultValue: values.get("roff") ?? "1e12" },
      { name: "vt", defaultValue: values.get("vt") ?? "0" },
    ],
    elements: [current("core", "p", "n", "V(p,n)/(V(cp,cn)>vt ? ron : roff)")],
  };
}

/** The ideal chopper's body (#1641): four ideal switches on one clock. */
export const IDEAL_CHOPPER_TARGET = "ideal_chopper";

/** The ideal SPDT's body (#2440): two complementary switches on one clock. */
export const IDEAL_SPDT_TARGET = "ideal_spdt";

/**
 * A body of ideal switches on one clock: its ports, the clock last, and its
 * paths, each closed while the clock is high or while it is low, with the
 * SPICE model card each side switches through.
 */
interface ClockedSwitchBody {
  readonly ports: readonly string[];
  readonly paths: readonly (readonly [string, string, "high" | "low"])[];
  readonly cards: { readonly high: string; readonly low: string };
}

const CLOCKED_SWITCH_BODIES: Readonly<Record<string, ClockedSwitchBody>> = {
  // The straight pair, then the crossed pair.
  [IDEAL_CHOPPER_TARGET]: {
    ports: ["INP", "INN", "OUTP", "OUTN", "CK"],
    paths: [
      ["INP", "OUTP", "high"],
      ["INN", "OUTN", "high"],
      ["INP", "OUTN", "low"],
      ["INN", "OUTP", "low"],
    ],
    cards: { high: "chopper_straight", low: "chopper_crossed" },
  },
  // COM to A while the clock is high, to B while it is low.
  [IDEAL_SPDT_TARGET]: {
    ports: ["COM", "A", "B", "CK"],
    paths: [
      ["COM", "A", "high"],
      ["COM", "B", "low"],
    ],
    cards: { high: "spdt_a", low: "spdt_b" },
  },
};

/** The bodies of ideal switches on one clock. */
export const CLOCKED_SWITCH_TARGETS: readonly string[] = Object.keys(
  CLOCKED_SWITCH_BODIES,
);

/** Whether a name is a body of ideal switches on one clock. */
export function isClockedSwitchBody(target: string): boolean {
  return Object.hasOwn(CLOCKED_SWITCH_BODIES, target);
}

/** The body a chopper or a selector calls. */
export function clockedSwitchTarget(control: "chopper" | "selector"): string {
  return control === "chopper" ? IDEAL_CHOPPER_TARGET : IDEAL_SPDT_TARGET;
}

function clockedSwitchBody(target: string): ClockedSwitchBody {
  const body = CLOCKED_SWITCH_BODIES[target];
  if (!body) throw new Error(`No clocked switch body: ${target}`);
  return body;
}

function idealSwitchValue(name: string): string {
  return IDEAL_SWITCH_MODEL.parameters.find(
    (parameter) => parameter.name === name,
  )!.rawValue;
}

/**
 * A clocked switch body for Spectre and VACASK: each path the ideal switch's
 * hard conductance, the high side closed while V(CK) is above the switch
 * threshold and the low side while it is not, so one side conducts at a
 * time. The low side's complement is the part's own, not a signal the
 * netlist invents.
 */
export function clockedSwitchBehavioralDefinition(
  target: string,
): BehavioralModel {
  const body = clockedSwitchBody(target);
  return {
    name: target,
    ports: body.ports,
    parameters: [
      { name: "ron", defaultValue: idealSwitchValue("RON") },
      { name: "roff", defaultValue: idealSwitchValue("ROFF") },
      { name: "vt", defaultValue: idealSwitchValue("VT") },
    ],
    elements: body.paths.map(([from, to, side], index) =>
      current(
        `s${index + 1}`,
        from,
        to,
        `V(${from},${to})/(V(CK)>vt ? ${side === "high" ? "ron : roff" : "roff : ron"})`,
      ),
    ),
  };
}

/**
 * A clocked switch body for SPICE: the same paths as native S cards, as a
 * drawn switch is. The low side reads its control reversed against the
 * negated threshold, so it closes below the threshold the high side closes
 * above. `name` writes it under another name, where an author's definition
 * has its own (#1928).
 */
export function spiceClockedSwitchBody(
  target: string,
  name = target,
): string[] {
  const body = clockedSwitchBody(target);
  const model = (card: string, threshold: string) =>
    `.model ${card} SW(RON=${idealSwitchValue("RON")} ROFF=${idealSwitchValue("ROFF")} VT=${threshold} VH=${idealSwitchValue("VH")})`;
  return [
    `.subckt ${name} ${body.ports.join(" ")}`,
    ...body.paths.map(
      ([from, to, side], index) =>
        `S${index + 1} ${from} ${to} ${side === "high" ? `CK 0 ${body.cards.high}` : `0 CK ${body.cards.low}`}`,
    ),
    model(body.cards.high, idealSwitchValue("VT")),
    model(body.cards.low, `-${idealSwitchValue("VT")}`),
    `.ends ${name}`,
  ];
}
