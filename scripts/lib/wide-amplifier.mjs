import { ANALOG_TRIANGLE } from "./analog-triangle.mjs";

// Wide is a drawing choice. Derive the complete definition so its electrical
// interface and options cannot drift from the compact amplifier it names.
export function wideAmplifierId(sourceId) {
  return sourceId.replace(/^opamp(?:-differential)?/u, "$&-wide");
}

export function deriveWideAmplifier(source) {
  const symbol = source.symbol;
  const id = wideAmplifierId(symbol.id);
  const name = symbol.name.replace(
    /^(Operational Amplifier|Differential Op Amp)/u,
    (base) => `${base === "Operational Amplifier" ? "Op Amp" : "FD Amp"} Wide`,
  );
  // The textbook FD pair spans 2/3 of its triangle's vertical base. Keep the
  // existing 60-unit equilateral body and six-unit signs, and spread the pins
  // to +/-20. The signs at +/-14 now sit inward from their associated wires.
  const pairY = (y) => Math.sign(y) * 20;
  const { leftX, apexX, bottomY } = ANALOG_TRIANGLE;
  const contactX = (y) =>
    Number((apexX - (Math.abs(y) / bottomY) * (apexX - leftX)).toFixed(6));
  const wideSymbol = {
    ...structuredClone(symbol),
    id,
    name,
    pins: symbol.pins.map((pin) => ({
      ...structuredClone(pin),
      at: { ...pin.at, y: pairY(pin.at.y) },
    })),
    primitives: symbol.primitives.map((original) => {
      const primitive = structuredClone(original);
      if (primitive.kind !== "line" || primitive.part?.includes("polarity")) {
        return primitive;
      }
      const y = pairY(primitive.from.y);
      return primitive.from.x < leftX
        ? { ...primitive, from: { ...primitive.from, y }, to: { x: leftX, y } }
        : {
            ...primitive,
            from: { x: contactX(y), y },
            to: { ...primitive.to, y },
          };
    }),
  };
  return {
    ...structuredClone(source),
    symbol: wideSymbol,
    subcircuit: { ...structuredClone(source.subcircuit), id, symbolId: id },
    catalog: {
      ...structuredClone(source.catalog),
      symbolId: id,
      name,
      assetPath: `${id}.json`,
      generation: {
        kind: "derived-wide-amplifier",
        sourceSymbolId: symbol.id,
        converterPath: "scripts/generate-component-library.mjs",
        converterVersion: 1,
      },
    },
  };
}
