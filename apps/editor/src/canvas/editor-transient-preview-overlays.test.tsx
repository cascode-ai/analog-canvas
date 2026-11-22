import { resolveDocumentStyleProfile } from "@icm/derived";
import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EditorPlacementPreview } from "./editor-transient-preview-overlays";

describe("editor transient preview overlays", () => {
  it("previews a turned text reading up the page, and polarity glyphs upright", () => {
    const styleProfile = resolveDocumentStyleProfile(
      createEmptyDocument("cell", "Cell").presentation,
    );
    const glyph = renderToStaticMarkup(
      <svg>
        <EditorPlacementPreview
          vddRailMode={false}
          vddRailStart={null}
          previewPoint={{ x: 100, y: 80 }}
          powerRailStrokeWidth={3}
          styleProfileId="razavi-textbook-v1"
          pendingSymbolId="text"
          draftingText=">"
          styleProfile={styleProfile}
          rotation={90}
          mirror="none"
        />
      </svg>,
    );
    // As it will land: a quarter turn reads up the page.
    expect(glyph).toContain('transform="translate(100 80) rotate(270)"');
    expect(glyph).toContain("&gt;");

    const polarity = renderToStaticMarkup(
      <svg>
        <EditorPlacementPreview
          vddRailMode={false}
          vddRailStart={null}
          previewPoint={{ x: 100, y: 80 }}
          powerRailStrokeWidth={3}
          styleProfileId="razavi-textbook-v1"
          pendingSymbolId="annotation-polarity-both"
          draftingPolarity="both"
          styleProfile={styleProfile}
          rotation={90}
          mirror="none"
        />
      </svg>,
    );
    const positive = polarity.match(
      /data-role="polarity-positive-horizontal" x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/u,
    );
    const negative = polarity.match(
      /data-role="polarity-negative" x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/u,
    );
    expect(polarity).not.toContain("rotate(");
    expect(positive).not.toBeNull();
    expect(negative).not.toBeNull();
    expect((Number(positive![1]) + Number(positive![3])) / 2).toBeGreaterThan(
      0,
    );
    expect((Number(negative![1]) + Number(negative![3])) / 2).toBeLessThan(0);
    expect(Number(positive![2])).toBeCloseTo(Number(positive![4]));
    expect(Number(negative![2])).toBeCloseTo(Number(negative![4]));
  });

  it("draws a written formula in the text placement preview (#1549)", () => {
    const styleProfile = resolveDocumentStyleProfile(
      createEmptyDocument("cell", "Cell").presentation,
    );
    const markup = renderToStaticMarkup(
      <svg>
        <EditorPlacementPreview
          vddRailMode={false}
          vddRailStart={null}
          previewPoint={{ x: 100, y: 80 }}
          powerRailStrokeWidth={3}
          styleProfileId="razavi-textbook-v1"
          pendingSymbolId="text"
          draftingContent={{
            runs: [
              {
                kind: "math",
                latex: String.raw`\lambda=\gamma=0`,
                display: "inline",
              },
            ],
          }}
          styleProfile={styleProfile}
          rotation={0}
          mirror="none"
        />
      </svg>,
    );
    expect(markup).toContain('data-testid="text-placement-preview"');
    expect(markup).toContain('data-role="formula"');
    expect(markup).toContain("λ");
    expect(markup).toContain("γ");
  });
});
