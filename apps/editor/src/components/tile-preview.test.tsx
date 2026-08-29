import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TilePreview } from "./tile-preview";

describe("TilePreview", () => {
  it("renders the image markup with lazy loading", () => {
    const html = renderToStaticMarkup(
      <TilePreview src="/p.svg" alt="Preview of Amp" />,
    );
    expect(html).toContain('src="/p.svg"');
    expect(html).toContain('alt="Preview of Amp"');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain("gallery-tile-placeholder");
  });
});
