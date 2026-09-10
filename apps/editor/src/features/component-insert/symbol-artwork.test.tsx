import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { requireRazaviCatalogSymbol } from "@icm/symbols";

import { ComponentPlacementPreview } from "./component-placement-preview";
import { renderSymbolPreviewPinNames, SymbolArtwork } from "./symbol-artwork";

function expectDffPinNames(markup: string): void {
  expect(markup).toContain('data-pin-name="D"');
  expect(markup).toContain('data-pin-name="CK"');
  expect(markup).toContain('data-pin-name="Q"');
  expect(markup).toContain('data-pin-name="QBAR"');
  expect(markup).toContain('data-text-run="overbar"');
  expect(markup).toContain("text-decoration:overline");
  expect(markup).toContain("font-style:italic;font-weight:700");
  expect(markup).not.toContain(">QBAR</");
}

function pinNameY(markup: string, pinName: string): number {
  const match = markup.match(
    new RegExp(`data-pin-name="${pinName}"[^>]* y="([^"]+)"`, "u"),
  );
  if (!match?.[1]) throw new Error(`Missing ${pinName} pin-name y coordinate`);
  return Number(match[1]);
}

describe("SymbolArtwork pin-name previews", () => {
  const dff = requireRazaviCatalogSymbol("d-flip-flop");
  const formulaSymbol = [
    "adder",
    "multiplier",
    "transconductance",
    "integrator",
    "unit-delay",
    "discrete-time-integrator",
    "quantizer",
  ]
    .map((id) => requireRazaviCatalogSymbol(id))
    .find((symbol) => symbol.formulaPresentation);

  it("renders DFF pin names in the Library and Insert artwork", () => {
    const markup = renderToStaticMarkup(
      <SymbolArtwork symbol={dff} className="test-artwork" />,
    );

    expectDffPinNames(markup);
  });

  it("renders the transconductance trapezoid and subscript formula in Library and placement previews", () => {
    const symbol = requireRazaviCatalogSymbol("transconductance");
    const artwork = renderToStaticMarkup(
      <SymbolArtwork symbol={symbol} className="test-artwork" />,
    );
    const placement = renderToStaticMarkup(
      <svg>
        <ComponentPlacementPreview
          styleProfileId="razavi-textbook-v1"
          symbolId={symbol.id}
          symbol={symbol}
          position={{ x: 100, y: 80 }}
          rotation={0}
        />
      </svg>,
    );

    for (const markup of [artwork, placement]) {
      expect(markup).toContain('data-role="signal-flow-frame"');
      expect(markup).toContain('data-role="formula-subscript"');
      expect(markup).toContain('points="-20,-35 20,-17.5 20,17.5 -20,35"');
      expect(markup).not.toContain(">+</text>");
    }
  });

  it("renders the differential transconductance with two signed inputs", () => {
    const symbol = requireRazaviCatalogSymbol("differential-transconductance");
    const markup = renderToStaticMarkup(
      <SymbolArtwork symbol={symbol} className="test-artwork" />,
    );

    expect(symbol.pins.map((pin) => pin.name)).toEqual(["IN+", "IN-", "OUT"]);
    expect(markup).toContain('x1="-40" y1="20" x2="-20" y2="20"');
    expect(markup).toContain('x1="-40" y1="-20" x2="-20" y2="-20"');
    expect(markup).toContain('x1="-14" y1="17" x2="-14" y2="23"');
    expect(markup).toContain('x1="-17" y1="-20" x2="-11" y2="-20"');
    expect(markup).toContain('data-role="formula-subscript"');
  });

  it("renders a definition-owned default formula in Library and placement previews", () => {
    expect(formulaSymbol).toBeDefined();
    const symbol = formulaSymbol!;
    const artwork = renderToStaticMarkup(
      <SymbolArtwork symbol={symbol} className="test-artwork" />,
    );
    const placement = renderToStaticMarkup(
      <svg>
        <ComponentPlacementPreview
          styleProfileId="razavi-textbook-v1"
          symbolId={symbol.id}
          symbol={symbol}
          position={{ x: 100, y: 80 }}
          rotation={90}
          mirror="x"
        />
      </svg>,
    );

    expect(artwork).toContain('data-role="signal-flow-formula"');
    expect(placement).toContain('data-role="signal-flow-formula"');
    expect(placement).toContain(
      'transform="translate(100 80) rotate(90) scale(-1 1)"',
    );
  });

  it.each([
    "voltage-source",
    "opamp",
    "comparator",
    "differential-transconductance",
    "opamp-differential",
    "opamp-differential-lettered",
  ])(
    "keeps %s negative polarity horizontal in a rotated mirrored placement preview",
    (symbolId) => {
      const symbol = requireRazaviCatalogSymbol(symbolId);
      const markup = renderToStaticMarkup(
        <svg>
          <ComponentPlacementPreview
            styleProfileId="razavi-textbook-v1"
            symbolId={symbol.id}
            symbol={symbol}
            position={{ x: 100, y: 80 }}
            rotation={90}
            mirror="x"
          />
        </svg>,
      );

      expect(markup).toContain(
        'transform="translate(100 80) rotate(90) scale(-1 1)"',
      );
      const negative = markup.match(
        /data-part="upright-[^"]*polarity-negative" x1="([^"]+)" y1="[^"]+" x2="([^"]+)"/u,
      );
      expect(negative).not.toBeNull();
      expect(Number(negative![1])).toBeCloseTo(Number(negative![2]), 6);
    },
  );

  it.each([0, 90, 180, 270] as const)(
    "keeps visible pin names and Q-bar upright at %d degrees",
    (rotation) => {
      const markup = renderToStaticMarkup(
        <svg>
          <ComponentPlacementPreview
            styleProfileId="razavi-textbook-v1"
            symbolId={dff.id}
            symbol={dff}
            position={{ x: 100, y: 80 }}
            rotation={rotation}
          />
        </svg>,
      );

      expectDffPinNames(markup);
      expect(markup).toContain('transform="translate(100 80)"');
    },
  );

  it("keeps rotated DFF pin-name baselines symmetric inside opposite edges", () => {
    const quarterTurn = renderSymbolPreviewPinNames(dff, [], 90);
    expect(pinNameY(quarterTurn, "D")).toBeCloseTo(-13.916336);
    expect(pinNameY(quarterTurn, "CK")).toBeCloseTo(-13.916336);
    expect(pinNameY(quarterTurn, "Q")).toBeCloseTo(21.916336);
    expect(pinNameY(quarterTurn, "QBAR")).toBeCloseTo(21.916336);

    const threeQuarterTurn = renderSymbolPreviewPinNames(dff, [], 270);
    expect(pinNameY(threeQuarterTurn, "D")).toBeCloseTo(21.916336);
    expect(pinNameY(threeQuarterTurn, "CK")).toBeCloseTo(21.916336);
    expect(pinNameY(threeQuarterTurn, "Q")).toBeCloseTo(-13.916336);
    // Q-bar's overline faces the north body edge at 270 degrees, so its
    // baseline needs one additional decoration clearance inside the body.
    expect(pinNameY(threeQuarterTurn, "QBAR")).toBeCloseTo(-12.271536);
  });
});
