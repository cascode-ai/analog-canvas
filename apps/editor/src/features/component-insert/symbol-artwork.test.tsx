import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { requireRazaviCatalogSymbol } from "@icm/symbols";

import { ComponentPlacementPreview } from "./component-placement-preview";
import { SymbolArtwork } from "./symbol-artwork";

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
});
