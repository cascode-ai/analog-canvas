import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import {
  galleryFeedQueryKey,
  loadGalleryFeed,
  loadGalleryTagSummary,
} from "./gallery-client";
import {
  earlyGalleryFetch,
  galleryEarlyFetchScript,
  GALLERY_EARLY_FILTERS_KEY,
  GALLERY_EARLY_URLS,
} from "./gallery-early-fetch";
import { GALLERY_FILTERS_KEY, resolveGalleryFilters } from "./gallery-filters";

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

  /** The inline script on `pathname`, with `stored` as the remembered filters. */
  const run = (pathname: string, search = "", stored: string | null = null) => {
    const window: Record<string, unknown> = {};
    const fetch = vi.fn(() => Promise.resolve(new Response("{}")));
    runInNewContext(galleryEarlyFetchScript(), {
      window,
      location: { pathname, search },
      localStorage: {
        getItem: (key: string) => (key === GALLERY_FILTERS_KEY ? stored : null),
      },
      fetch,
    });
    return { window, fetch };
  };

  it("start on the landing route only", () => {
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

  it("start only for a wall that opens unfiltered, so none is wasted", () => {
    expect(GALLERY_EARLY_FILTERS_KEY).toBe(GALLERY_FILTERS_KEY);
    const saved = (narrowing: object) =>
      JSON.stringify({ ...resolveGalleryFilters("", null), ...narrowing });
    const cases: [search: string, stored: string | null, starts: boolean][] = [
      ["", null, true],
      ["", "{}", true],
      ["", "not json", true],
      // A reader who cleared every filter, or only chose the shelf view.
      ["", saved({}), true],
      ["", saved({ view: "shelf" }), true],
      ["", saved({ tags: ["amplifier"] }), false],
      ["", saved({ netlistable: true }), false],
      ["", saved({ liked: true }), false],
      ["", saved({ attention: true }), false],
      ["", saved({ parts: ["6-10"] }), false],
      ["", saved({ author: "Ada" }), false],
      ["", saved({ ownerUserId: "user-1" }), false],
      ["?netlist=1", null, false],
      ["?entry=abc", saved({}), false],
    ];
    for (const [search, stored, starts] of cases) {
      const fetched = run("/", search, stored).fetch.mock.calls.length > 0;
      expect(fetched, `${search} ${stored}`).toBe(starts);
      if (!fetched) continue;
      // What it starts is what the landing preload then asks for.
      const filters = resolveGalleryFilters(search, stored);
      expect(
        galleryFeedQueryKey({ ...filters, q: "", source: null }),
        `${search} ${stored}`,
      ).toBe("");
    }
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
