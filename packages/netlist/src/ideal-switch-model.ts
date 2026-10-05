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
