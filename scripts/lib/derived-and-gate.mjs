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
  // Keep the reviewed body untouched. Electrical pin anchors remain on the
  // connection grid; only the four-input lead interiors fan into the body.
  const inputYs = inputCount === 3 ? [-10, 0, 10] : [-20, -10, 10, 20];
  const contactYs = inputCount === 3 ? inputYs : [-12, -4, 4, 12];
  const pins = [
    ...inputYs.map((y, index) => ({
      ...structuredClone(base.pins[0]),
      name: String.fromCharCode(65 + index),
      at: { x: -30, y },
    })),
    structuredClone(base.pins.at(-1)),
  ];
  const primitives = [
    ...inputYs.map((y, index) =>
      inputCount === 3
        ? {
            ...structuredClone(lead),
            from: { x: -30, y },
            to: { x: -20, y },
          }
        : {
            kind: "path",
            data: `M -30 ${y} L -26 ${y} L -20 ${contactYs[index]}`,
            bounds: {
              x: -30,
              y: Math.min(y, contactYs[index]),
              width: 10,
              height: Math.abs(y - contactYs[index]),
            },
            style: structuredClone(lead.style),
          },
    ),
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
