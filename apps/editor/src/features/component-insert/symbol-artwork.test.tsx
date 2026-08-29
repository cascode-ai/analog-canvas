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

  it("renders DFF pin names in the Library and Insert artwork", () => {
    const markup = renderToStaticMarkup(
      <SymbolArtwork symbol={dff} className="test-artwork" />,
    );

    expectDffPinNames(markup);
  });

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
