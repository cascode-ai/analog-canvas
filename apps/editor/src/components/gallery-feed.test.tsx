import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GalleryFeed, loadGalleryFeed } from "./gallery-feed";

function fetchReturning(payload: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: ok ? 200 : 502,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

describe("loadGalleryFeed", () => {
  it("returns a page of entries with its cursor", async () => {
    const page = await loadGalleryFeed(
      fetchReturning({
        entries: [
          {
            id: "g1",
            name: "Ring",
            author: "tz",
            description: "",
            createdAt: "2026-08-21T00:00:00.000Z",
            schemaVersion: 23,
          },
        ],
        nextCursor: "2026-08-21T00:00:00.000Z|g1",
      }),
    );
    expect(page?.entries.map((entry) => entry.id)).toEqual(["g1"]);
    expect(page?.nextCursor).toBe("2026-08-21T00:00:00.000Z|g1");
  });

  it("builds the query only from the options that are set", async () => {
    const urls: string[] = [];
    const capturing = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ entries: [] }), { status: 200 });
    }) as typeof fetch;
    await loadGalleryFeed(capturing);
    await loadGalleryFeed(capturing, { author: "alice" });
    await loadGalleryFeed(capturing, { author: "alice", cursor: "c|1" });
    expect(urls).toEqual([
      "/api/gallery",
      "/api/gallery?author=alice",
      "/api/gallery?author=alice&cursor=c%7C1",
    ]);
  });

  it("degrades to null on errors and non-OK responses", async () => {
    expect(await loadGalleryFeed(fetchReturning({}, false))).toBeNull();
    const throwing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await loadGalleryFeed(throwing)).toBeNull();
  });
});

describe("GalleryFeed", () => {
  it("renders the landing chrome and editor entry point", () => {
    const markup = renderToStaticMarkup(createElement(GalleryFeed));
    expect(markup).toContain('data-testid="gallery-feed"');
    expect(markup).toContain("Analog Canvas");
    expect(markup).toContain('data-testid="gallery-new-circuit"');
    expect(markup).toContain('href="/editor"');
    expect(markup).toContain("Provided by");
    expect(markup).toContain('href="https://tokenzhang.com"');
    expect(markup).toContain('src="/tokenzhang-favicon.png"');
    expect(markup).toContain('data-testid="gallery-loading"');
  });
});
