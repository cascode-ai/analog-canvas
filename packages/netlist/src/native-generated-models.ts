import { generatedBehavioralDefinition } from "./generated-models.js";
import { projectBehavioralExpression } from "./behavioral-model.js";

/** Native syntax projection, with no SPICE card parsing or model equations. */
export function nativeBehavioralModel(
  target: string,
  scalar: (raw: string) => string,
  models: ReadonlyMap<string, string>,
): string[] {
  const model = generatedBehavioralDefinition(target);
  return [
    `subckt ${target} (${model.ports.join(" ")})`,
    ...model.parameters.map(
      (p) => `parameters ${p.name}=${scalar(p.defaultValue)}`,
    ),
    ...model.elements.map((element) => {
      // OSDI module loading canonicalizes names in VACASK 0.3.4. Keep only
      // compiler-owned internal references lowercase; Canvas names stay exact.
      if (element.kind === "voltage" || element.kind === "current")
        return `${element.name.toLowerCase()} (${element.nodes.join(" ")}) ${element.kind === "voltage" ? "v" : "i"}=${projectBehavioralExpression(element.expression, scalar)}`;
      const master = models.get(element.kind);
      if (!master) throw new Error(`Missing native primitive for ${target}`);
      return `${element.name} (${element.nodes.join(" ")}) ${master} ${element.kind === "capacitor" ? "c" : "r"}=${scalar(element.value)}`;
    }),
    "ends",
  ];
}
