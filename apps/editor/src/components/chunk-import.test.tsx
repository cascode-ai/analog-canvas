import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChunkLoadError, chunkLoadStatus, importChunk } from "./chunk-import";
import { ChunkLoadBanner } from "./chunk-load-fallback";

describe("importChunk", () => {
  it("passes a resolved module through untouched", async () => {
    const module = { render: () => "ok" };
    await expect(
      importChunk("PDF export", () => Promise.resolve(module)),
    ).resolves.toBe(module);
  });

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
  });

  it("phrases the status line as remedy, not stack trace", () => {
    const status = chunkLoadStatus("PDF export");
    expect(status).toContain("PDF export could not load");
    expect(status).toContain("Refresh");
    expect(status).toContain("restored automatically");
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
