import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TilePreview } from "./tile-preview";

describe("TilePreview", () => {
  it("reserves known preview dimensions while loading lazily", () => {
    const html = renderToStaticMarkup(
      <TilePreview
        src="/p.svg"
        alt="Preview of Amp"
        width={640}
        height={360}
      />,
    );
    expect(html).toContain('src="/p.svg"');
    expect(html).toContain('alt="Preview of Amp"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('width="640"');
    expect(html).toContain('height="360"');
    expect(html).not.toContain("gallery-tile-placeholder");
  });

  it("omits incomplete dimensions for an older Gallery response", () => {
    const html = renderToStaticMarkup(
      <TilePreview src="/legacy.svg" alt="Legacy preview" width={640} />,
    );
    expect(html).not.toContain('width="640"');
    expect(html).not.toContain("height=");
  });

  it("shows the stored vector drawing, which the screen draws at its own density (#2619)", () => {
    const html = renderToStaticMarkup(
      <TilePreview
        src="/api/gallery/e1/preview.svg?v=r1"
        alt="Preview of Amp"
        width={640}
        height={360}
      />,
    );
    // No raster to pick between: a 2x screen draws the SVG at 2x.
    expect(html).toContain('src="/api/gallery/e1/preview.svg?v=r1"');
    expect(html).not.toContain("srcset");
  });
});
