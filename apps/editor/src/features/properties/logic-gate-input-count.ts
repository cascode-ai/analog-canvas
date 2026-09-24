export type LogicGateInputCount = 2 | 3 | 4;

export const configurableLogicGateIds = [
  "and-gate",
  "nand-gate",
  "or-gate",
  "nor-gate",
  "xor-gate",
  "xnor-gate",
] as const;

export type ConfigurableLogicGateId = (typeof configurableLogicGateIds)[number];

export function logicGateInputInfo(
  symbolId: string,
): { family: ConfigurableLogicGateId; count: LogicGateInputCount } | null {
  for (const family of configurableLogicGateIds) {
    if (symbolId === family) return { family, count: 2 };
    if (symbolId === `${family}-3`) return { family, count: 3 };
    if (symbolId === `${family}-4`) return { family, count: 4 };
  }
  return null;
}

export function logicGateSymbolId(
  family: ConfigurableLogicGateId,
  count: LogicGateInputCount,
): string {
  return count === 2 ? family : `${family}-${count}`;
}
