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

/** Its four paths: the straight pair, then the crossed pair. */
const CHOPPER_PATHS = [
  ["INP", "OUTP", "straight"],
  ["INN", "OUTN", "straight"],
  ["INP", "OUTN", "crossed"],
  ["INN", "OUTP", "crossed"],
] as const;

function idealSwitchValue(name: string): string {
  return IDEAL_SWITCH_MODEL.parameters.find(
    (parameter) => parameter.name === name,
  )!.rawValue;
}

/**
 * The ideal chopper for Spectre and VACASK: each path the ideal switch's hard
 * conductance, the straight pair closed while V(CK) is above the switch
 * threshold and the crossed pair while it is not, so one pair conducts at a
 * time. The crossed pair's complement is the part's own, not a signal the
 * netlist invents.
 */
export function chopperBehavioralDefinition(): BehavioralModel {
  return {
    name: IDEAL_CHOPPER_TARGET,
    ports: ["INP", "INN", "OUTP", "OUTN", "CK"],
    parameters: [
      { name: "ron", defaultValue: idealSwitchValue("RON") },
      { name: "roff", defaultValue: idealSwitchValue("ROFF") },
      { name: "vt", defaultValue: idealSwitchValue("VT") },
    ],
    elements: CHOPPER_PATHS.map(([from, to, pair], index) =>
      current(
        `s${index + 1}`,
        from,
        to,
        `V(${from},${to})/(V(CK)>vt ? ${pair === "straight" ? "ron : roff" : "roff : ron"})`,
      ),
    ),
  };
}

/**
 * The ideal chopper for SPICE: the same four paths as native S cards, as a
 * drawn switch is. The crossed pair reads its control reversed against the
 * negated threshold, so it closes below the threshold the straight pair
 * closes above.
 */
export function spiceChopperBody(): string[] {
  const model = (name: string, threshold: string) =>
    `.model ${name} SW(RON=${idealSwitchValue("RON")} ROFF=${idealSwitchValue("ROFF")} VT=${threshold} VH=${idealSwitchValue("VH")})`;
  return [
    `.subckt ${IDEAL_CHOPPER_TARGET} INP INN OUTP OUTN CK`,
    ...CHOPPER_PATHS.map(
      ([from, to, pair], index) =>
        `S${index + 1} ${from} ${to} ${pair === "straight" ? "CK 0 chopper_straight" : "0 CK chopper_crossed"}`,
    ),
    model("chopper_straight", idealSwitchValue("VT")),
    model("chopper_crossed", `-${idealSwitchValue("VT")}`),
    `.ends ${IDEAL_CHOPPER_TARGET}`,
  ];
}
