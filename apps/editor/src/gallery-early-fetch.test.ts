import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { loadGalleryFeed, loadGalleryTagSummary } from "./gallery-client";
import {
  earlyGalleryFetch,
  galleryEarlyFetchScript,
  GALLERY_EARLY_URLS,
} from "./gallery-early-fetch";

/** The query the landing preload builds for an unfiltered wall. */
const UNFILTERED = {
  author: null,
  ownerUserId: null,
  tags: [],
  netlistable: false,
  liked: false,
  attention: false,
  attentionKind: null,
  parts: [],
};

describe("the landing page's early Gallery requests (#1592)", () => {
  it("are the URLs the unfiltered wall's loaders ask for", async () => {
    const asked: string[] = [];
    const fetchLike = vi.fn(async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response("{}", { status: 401 });
    }) as unknown as typeof fetch;
    await loadGalleryFeed(fetchLike, UNFILTERED);
    await loadGalleryTagSummary(fetchLike, UNFILTERED);
    expect(asked).toEqual([...GALLERY_EARLY_URLS]);
  });

  it("start on the landing route only", () => {
    const run = (pathname: string) => {
      const window: Record<string, unknown> = {};
      const fetch = vi.fn(() => Promise.resolve(new Response("{}")));
      runInNewContext(galleryEarlyFetchScript(), {
        window,
        location: { pathname },
        fetch,
      });
      return { window, fetch };
    };
    const landing = run("/");
    expect(landing.fetch.mock.calls).toEqual(
      GALLERY_EARLY_URLS.map((url) => [url, { credentials: "same-origin" }]),
    );
    expect(Object.keys(landing.window.__icmGalleryEarly as object)).toEqual([
      ...GALLERY_EARLY_URLS,
    ]);
    for (const path of ["/editor", "/g/abc", "/analytics"])
      expect(run(path).fetch).not.toHaveBeenCalled();
  });

  it("answer a loader's same request once; anything else goes out", async () => {
    const early = new Response("early");
    const fallback = vi.fn(async () => new Response("network"));
    const fetchLike = earlyGalleryFetch(
      { "/api/gallery": Promise.resolve(early) },
      fallback as unknown as typeof fetch,
    );
    expect(await fetchLike("/api/gallery")).toBe(early);
    expect(await (await fetchLike("/api/gallery")).text()).toBe("network");
    expect(await (await fetchLike("/api/gallery?tags=a")).text()).toBe(
      "network",
    );
    expect(fallback).toHaveBeenCalledTimes(2);
    // Without the inline script, every request goes out.
    const plain = earlyGalleryFetch(
      undefined,
      fallback as unknown as typeof fetch,
    );
    await plain("/api/gallery");
    expect(fallback).toHaveBeenCalledTimes(3);
  });
});
