import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChunkLoadError, importChunk } from "./chunk-import";
import { ChunkLoadBanner } from "./chunk-load-fallback";

describe("importChunk", () => {
  it("wraps a redeploy-vanished chunk into a named ChunkLoadError", async () => {
    // The exact browser failure a stale tab produces: the SPA fallback
    // answered index.html where a content-hashed module used to live.
    const raw = new TypeError(
      "Failed to fetch dynamically imported module: https://analog-canvas.tokenzhang.com/assets/browser-pdf-D-HT6q.js",
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = await importChunk("PDF export", () =>
      Promise.reject(raw),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    spy.mockRestore();

    expect(failure).toBeInstanceOf(ChunkLoadError);
    const chunkError = failure as ChunkLoadError;
    expect(chunkError.feature).toBe("PDF export");
    expect(chunkError.cause).toBe(raw);
    // The user-facing message never contains the technical string.
    expect(chunkError.message).not.toContain("Failed to fetch");
    expect(chunkError.message).toContain("PDF export");
    expect(chunkError.message).not.toContain("has been updated");
    expect(chunkError.message).toContain("check your connection");
  });
});

describe("ChunkLoadBanner", () => {
  it("offers the refresh remedy and a dismissal", () => {
    const markup = renderToStaticMarkup(
      <ChunkLoadBanner feature="PDF export" onDismiss={() => {}} />,
    );
    expect(markup).toContain("PDF export could not load");
    expect(markup).toContain("restored automatically");
    expect(markup).toContain("Refresh app");
    expect(markup).toContain("Not now");
    expect(markup).not.toContain("Failed to fetch");
  });
});
