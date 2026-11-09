import type { SourceBundle } from "./source-types.js";

export const SPICE_DIALECT_IDS = [
  "ngspice-46-core",
  "spice3f5-core",
  "ltspice-24-structural",
  "xyce-7-structural",
] as const;

export type SupportedSpiceDialectId = (typeof SPICE_DIALECT_IDS)[number];

export interface SpiceDialectEvidence {
  dialect: SupportedSpiceDialectId;
  confidence: "explicit" | "high" | "compatible";
  evidence: string[];
}

export interface SpiceCompileOptions {
  dialect?: SupportedSpiceDialectId | "auto";
  /** Includes can use any path within a preselected virtual workspace. */
  includeRoot?: "workspace";
}

export function detectSpiceDialect(
  bundle: SourceBundle,
  override: SpiceCompileOptions["dialect"] = "auto",
): SpiceDialectEvidence {
  if (override && override !== "auto") {
    return {
      dialect: override,
      confidence: "explicit",
      evidence: [`caller override: ${override}`],
    };
  }
  const evidence = new Set<string>();
  let ltspice = false;
  let xyce = false;
  for (const syntaxFile of bundle.syntaxFiles) {
    for (const statement of syntaxFile.statements) {
      const normalizedRaw = statement.rawText.trim().toLowerCase();
      if (/^\.(?:backanno|wave|netlist)/u.test(normalizedRaw)) ltspice = true;
      if (/^\.(?:print|measure)\s+(?:tran|dc|ac)\b/u.test(normalizedRaw)) {
        xyce = true;
      }
      if (statement.kind === "control_boundary") evidence.add(".control");
      if (statement.kind === "conditional") evidence.add(`.${statement.form}`);
      if (statement.kind === "function") evidence.add(".func");
      if (
        statement.kind === "directive" &&
        ["csparam", "incpslt", "pss", "sp"].includes(statement.name)
      ) {
        evidence.add(`.${statement.name}`);
      }
    }
  }
  if (ltspice) {
    return {
      dialect: "ltspice-24-structural",
      confidence: "high",
      evidence: ["LTspice structural marker"],
    };
  }
  if (xyce) {
    return {
      dialect: "xyce-7-structural",
      confidence: "high",
      evidence: ["Xyce analysis-qualified output marker"],
    };
  }
  return evidence.size > 0
    ? {
        dialect: "ngspice-46-core",
        confidence: "high",
        evidence: [...evidence].sort((left, right) =>
          left.localeCompare(right, "en"),
        ),
      }
    : {
        dialect: "spice3f5-core",
        confidence: "compatible",
        evidence: ["no ngspice-specific structural syntax detected"],
      };
}
