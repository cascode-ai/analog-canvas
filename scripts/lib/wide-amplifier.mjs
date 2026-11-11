import {
  ANALOG_TRIANGLE,
  ANALOG_TRIANGLE_SUPPLY_PINS,
  analogTriangleSupplyPins,
} from "./analog-triangle.mjs";
import { withSupplyPins, withoutSupplyPins } from "./supply-pins.mjs";

/**
 * A Wide differential form's outputs leave the slanted edges at +/-20 and
 * cross x 0 and -10, so its supplies stand at x -20, clear of them (#1941).
 * A single-ended form keeps them where the compact form draws them.
 */
const WIDE_DIFFERENTIAL_SUPPLY_PINS = analogTriangleSupplyPins(-20);

// Wide is a drawing choice. Derive the complete definition so its electrical
// interface and options cannot drift from the compact amplifier it names.
function wideAmplifierId(sourceId) {
  return sourceId.replace(/^opamp(?:-differential)?/u, "$&-wide");
}

export function deriveWideAmplifier(source) {
  const symbol = withoutSupplyPins(source.symbol);
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
  const differential = symbol.pins.some((pin) => pin.name === "OUT+");
  return {
    ...structuredClone(source),
    symbol: withSupplyPins(
      wideSymbol,
      differential
        ? WIDE_DIFFERENTIAL_SUPPLY_PINS
        : ANALOG_TRIANGLE_SUPPLY_PINS,
    ),
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
        converterVersion: differential ? 2 : 1,
      },
    },
  };
}
