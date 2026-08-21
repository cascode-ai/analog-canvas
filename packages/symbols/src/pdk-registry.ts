import { isRazaviProductSymbolId } from "./razavi-catalog.js";

export interface PdkSymbolMapping {
  symbolId: string;
  pinNames: readonly string[];
  source: "exact" | "pdk-rule";
  registryId: string;
}

interface PdkMappingRule {
  id: string;
  pattern: RegExp;
  terminalCount: number;
  symbolId: string;
  pinNames: readonly string[];
}

export interface PdkSymbolMappingOverride {
  modelName: string;
  terminalCount: number;
  symbolId: string;
  pinNames: readonly string[];
  registryId: string;
}

export const reviewedSky130MosModels = {
  nmos: "sky130_fd_pr__nfet_01v8",
  pmos: "sky130_fd_pr__pfet_01v8",
} as const;

export function reviewedSky130MosModelSuggestions(
  symbolId: string,
): readonly string[] {
  return symbolId === "nmos"
    ? [reviewedSky130MosModels.nmos]
    : symbolId === "pmos"
      ? [reviewedSky130MosModels.pmos]
      : [];
}

const pdkRules: readonly PdkMappingRule[] = [
  {
    id: "sky130-nfet-four-terminal",
    pattern: /^sky130_fd_pr__nfet_[a-z0-9_]+$/u,
    terminalCount: 4,
    symbolId: "nmos",
    pinNames: ["D", "G", "S", "B"],
  },
  {
    id: "sky130-pfet-four-terminal",
    pattern: /^sky130_fd_pr__pfet_[a-z0-9_]+$/u,
    terminalCount: 4,
    symbolId: "pmos",
    pinNames: ["D", "G", "S", "B"],
  },
];

export function resolvePdkSymbolMapping(
  modelName: string,
  terminalCount: number,
  exactOverrides: readonly PdkSymbolMappingOverride[] = [],
): PdkSymbolMapping | undefined {
  const normalized = modelName.toLowerCase();
  const exact = exactOverrides.find(
    (candidate) =>
      candidate.modelName.toLowerCase() === normalized &&
      candidate.terminalCount === terminalCount &&
      candidate.pinNames.length === terminalCount,
  );
  if (exact && isRazaviProductSymbolId(exact.symbolId)) {
    return {
      symbolId: exact.symbolId,
      pinNames: [...exact.pinNames],
      registryId: exact.registryId,
      source: "exact",
    };
  }
  const rule = pdkRules.find(
    (candidate) =>
      candidate.terminalCount === terminalCount &&
      candidate.pattern.test(normalized),
  );
  return rule && isRazaviProductSymbolId(rule.symbolId)
    ? {
        symbolId: rule.symbolId,
        pinNames: [...rule.pinNames],
        source: "pdk-rule",
        registryId: rule.id,
      }
    : undefined;
}
