import {
  resolveReviewedExternalBinding,
  reviewedExternalBindingForMaster,
  reviewedExternalModelSuggestions,
} from "@icm/devices";

import { isRazaviProductSymbolId } from "./razavi-catalog.js";

export interface PdkSymbolMapping {
  symbolId: string;
  pinNames: readonly string[];
  source: "exact" | "pdk-rule";
  registryId: string;
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
  return reviewedExternalModelSuggestions(symbolId).filter(
    (name) => symbolId === "nmos" || symbolId === "pmos",
  );
}

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
  const reviewed = reviewedExternalBindingForMaster(modelName);
  return reviewed &&
    reviewed.terminals.length === terminalCount &&
    isRazaviProductSymbolId(reviewed.symbolId)
    ? {
        symbolId: reviewed.symbolId,
        pinNames: reviewed.terminals.map((terminal) => terminal.pinName),
        source: "exact",
        registryId: reviewed.id,
      }
    : undefined;
}

export function resolvePdkSymbolMappingForTerminalOrder(
  modelName: string,
  terminalNames: readonly string[],
  exactOverrides: readonly PdkSymbolMappingOverride[] = [],
): PdkSymbolMapping | undefined {
  const exact = resolvePdkSymbolMapping(
    modelName,
    terminalNames.length,
    exactOverrides,
  );
  if (exactOverrides.length > 0 && exact?.source === "exact") {
    const override = exactOverrides.find(
      (candidate) =>
        candidate.registryId === exact.registryId &&
        candidate.modelName.toLowerCase() === modelName.toLowerCase(),
    );
    if (override) {
      return terminalNames.every(
        (name, index) =>
          name.toLowerCase() === override.pinNames[index]?.toLowerCase(),
      )
        ? exact
        : undefined;
    }
  }
  const reviewed = resolveReviewedExternalBinding(modelName, terminalNames);
  return reviewed && exact
    ? {
        ...exact,
        pinNames: reviewed.terminals.map((terminal) => terminal.pinName),
      }
    : undefined;
}
