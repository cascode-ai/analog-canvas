export type AndGateInputCount = 2 | 3 | 4;

const symbolIds = {
  2: "and-gate",
  3: "and-gate-3",
  4: "and-gate-4",
} as const;

export function andGateInputCount(symbolId: string): AndGateInputCount | null {
  if (symbolId === symbolIds[2]) return 2;
  if (symbolId === symbolIds[3]) return 3;
  if (symbolId === symbolIds[4]) return 4;
  return null;
}

export function andGateSymbolId(inputCount: AndGateInputCount): string {
  return symbolIds[inputCount];
}
