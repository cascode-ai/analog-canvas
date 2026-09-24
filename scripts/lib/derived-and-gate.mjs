import { isDeepStrictEqual } from "node:util";

/** Extend the reviewed two-input AND outline without claiming new PDF evidence. */
export function deriveMultiInputAndGate(source, inputCount) {
  if (source?.symbol?.id !== "and-gate" || ![3, 4].includes(inputCount)) {
    throw new Error("Multi-input AND requires the reviewed two-input source");
  }
  const base = source.symbol;
  const body = base.primitives.find((primitive) => primitive.kind === "path");
  if (!body || !body.bounds) throw new Error("AND body path is missing");
  const lead = base.primitives.find((primitive) => primitive.kind === "line");
  const output = base.primitives.at(-1);
  if (!lead || !output || output.kind !== "line") {
    throw new Error("AND pin leads are missing");
  }
  // Keep the reviewed body untouched. Four straight leads use the common
  // two-unit electrical lattice while ordinary placement stays ten-unit.
  const inputYs = inputCount === 3 ? [-10, 0, 10] : [-12, -4, 4, 12];
  const pins = [
    ...inputYs.map((y, index) => ({
      ...structuredClone(base.pins[0]),
      name: String.fromCharCode(65 + index),
      at: { x: -30, y },
    })),
    structuredClone(base.pins.at(-1)),
  ];
  const primitives = [
    ...inputYs.map((y) => ({
      ...structuredClone(lead),
      from: { x: -30, y },
      to: { x: -20, y },
    })),
    structuredClone(body),
    structuredClone(output),
  ];
  const symbol = {
    ...structuredClone(base),
    id: `and-gate-${inputCount}`,
    name: `AND Gate (${inputCount} inputs)`,
    pins,
    primitives,
  };
  if (isDeepStrictEqual(symbol, base))
    throw new Error("AND derivation did not change geometry");
  return symbol;
}
