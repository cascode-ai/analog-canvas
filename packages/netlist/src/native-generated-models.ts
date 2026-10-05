import { builtInModelContract } from "@icm/devices";
import { generatedBehavioralModel } from "./generated-models.js";

/** Project only our reviewed family equations, never arbitrary user SPICE programs. */
export function nativeBehavioralModel(
  target: string,
  scalar: (raw: string) => string,
  models: ReadonlyMap<string, string>,
): string[] {
  const metadata = builtInModelContract(target);
  if (!metadata) throw new Error(`No model contract: ${target}`);
  const body = generatedBehavioralModel(target);
  const header = body.find((line) => line.startsWith(".subckt "))!;
  const ports = header.split(" params:")[0]!.split(/\s+/u).slice(2);
  const expression = (raw: string) => {
    const accesses: string[] = [];
    const protectedExpression = raw.replace(
      /V\(([^()]+)\)/gu,
      (_, nodes: string) => {
        const index = accesses.push(`v(${nodes})`) - 1;
        return `__access${index}`;
      },
    );
    return scalar(protectedExpression).replace(
      /__access(\d+)/gu,
      (_, index: string) => accesses[Number(index)]!,
    );
  };
  return [
    `subckt ${target} (${ports.join(" ")})`,
    ...metadata.parameters.map(
      (p) => `parameters ${p.name}=${scalar(p.defaultValue!)}`,
    ),
    ...body.flatMap((line) => {
      if (line.startsWith("*") || line.startsWith(".")) return [];
      const behavioral = /^(\S+) (\S+) (\S+) ([VI])=\{(.+)\}$/u.exec(line);
      // OSDI module loading canonicalizes names in VACASK 0.3.4. Keep only
      // compiler-owned internal references lowercase; Canvas names stay exact.
      if (behavioral)
        return [
          `${behavioral[1]!.toLowerCase()} (${behavioral[2]} ${behavioral[3]}) ${behavioral[4]!.toLowerCase()}=${expression(behavioral[5]!)}`,
        ];
      const passive = /^([RC]\S*) (\S+) (\S+) (.+)$/u.exec(line);
      if (passive) {
        const capacitor = passive[1]!.startsWith("C");
        const master = models.get(capacitor ? "capacitor" : "resistor");
        if (!master) throw new Error(`Missing native primitive for ${target}`);
        return [
          `${passive[1]} (${passive[2]} ${passive[3]}) ${master} ${capacitor ? "c" : "r"}=${scalar(passive[4]!)}`,
        ];
      }
      throw new Error(`Unmapped reviewed model card: ${target}: ${line}`);
    }),
    "ends",
  ];
}
