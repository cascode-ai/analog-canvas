import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  canReuseGalleryLandingFeed,
  galleryEntryMatchesQuery,
  GalleryCountPanel,
  GalleryFeed,
  loadGalleryAuthors,
  loadGalleryFeed,
} from "./gallery-feed";

describe("Gallery landing preload", () => {
  const defaultFilters = {
    author: null,
    ownerUserId: null,
    tags: [] as string[],
    netlistable: false,
    liked: false,
    attention: false,
  };

  it("is consumed only for the first unfiltered wall request", () => {
    expect(canReuseGalleryLandingFeed(0, null, defaultFilters)).toBe(true);
    expect(canReuseGalleryLandingFeed(0, "default", defaultFilters)).toBe(
      false,
    );
    expect(canReuseGalleryLandingFeed(1, null, defaultFilters)).toBe(false);
    for (const filters of [
      { ...defaultFilters, author: "alice" },
      { ...defaultFilters, ownerUserId: "account-alice" },
      { ...defaultFilters, tags: ["amplifier"] },
      { ...defaultFilters, netlistable: true },
      { ...defaultFilters, liked: true },
      { ...defaultFilters, attention: true },
    ]) {
      expect(canReuseGalleryLandingFeed(0, null, filters)).toBe(false);
    }
  });
});

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
    await loadGalleryFeed(capturing, {
      author: "alice",
      ownerUserId: "account-alice",
    });
    await loadGalleryFeed(capturing, { author: "alice", cursor: "c|1" });
    await loadGalleryFeed(capturing, { author: "alice", limit: 4 });
    await loadGalleryFeed(capturing, { netlistable: true, liked: true });
    // An unasked mark leaves the query alone, so the wall's own cache key and
    // the worker's fast path stay what they were.
    await loadGalleryFeed(capturing, { netlistable: false, liked: false });
    expect(urls).toEqual([
      "/api/gallery",
      "/api/gallery?author=alice",
      "/api/gallery?author=alice&owner=account-alice",
      "/api/gallery?author=alice&cursor=c%7C1",
      "/api/gallery?author=alice&limit=4",
      "/api/gallery?netlistable=1&liked=1",
      "/api/gallery",
    ]);
  });

  it("passes the server's total through and tolerates its absence", async () => {
    const withTotal = await loadGalleryFeed(
      fetchReturning({ entries: [], nextCursor: null, total: 42 }),
    );
    expect(withTotal?.total).toBe(42);
    // An older worker without totals must read as "unknown", never as zero.
    const withoutTotal = await loadGalleryFeed(fetchReturning({ entries: [] }));
    expect(withoutTotal?.total).toBeNull();
  });

  it("degrades to null on errors and non-OK responses", async () => {
    expect(await loadGalleryFeed(fetchReturning({}, false))).toBeNull();
    const throwing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await loadGalleryFeed(throwing)).toBeNull();
  });
});

describe("loadGalleryAuthors", () => {
  it("loads the full public contributor ranking", async () => {
    const urls: string[] = [];
    const capturing = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          authors: [
            { author: "Alice", ownerUserId: "account-alice", count: 12 },
            { author: "Bob", ownerUserId: "account-bob", count: 3 },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    expect(await loadGalleryAuthors(capturing)).toEqual([
      { author: "Alice", ownerUserId: "account-alice", count: 12 },
      { author: "Bob", ownerUserId: "account-bob", count: 3 },
    ]);
    expect(urls).toEqual(["/api/gallery/authors"]);
  });

  it("distinguishes an empty ranking from an unavailable one", async () => {
    expect(await loadGalleryAuthors(fetchReturning({ authors: [] }))).toEqual(
      [],
    );
    expect(await loadGalleryAuthors(fetchReturning({}, false))).toBeNull();
  });
});

describe("galleryEntryMatchesQuery", () => {
  const entry = {
    name: "Ring Oscillator",
    author: "Mei Chen",
    description: "Three-stage loop",
    tags: ["clocking"],
  };
  it("reaches name, author, description, and tags, case-insensitively", () => {
    expect(galleryEntryMatchesQuery(entry, "RING")).toBe(true);
    expect(galleryEntryMatchesQuery(entry, "mei")).toBe(true);
    expect(galleryEntryMatchesQuery(entry, "three-stage")).toBe(true);
    expect(galleryEntryMatchesQuery(entry, "clock")).toBe(true);
    expect(galleryEntryMatchesQuery(entry, "zzz")).toBe(false);
  });
  it("tolerates one ordinary typo per word without fuzzing short acronyms", () => {
    for (const query of [
      "rign",
      "oscilltor",
      "stgae",
      "clockign",
      "rign chne",
    ]) {
      expect(galleryEntryMatchesQuery(entry, query)).toBe(true);
    }
    expect(galleryEntryMatchesQuery({ ...entry, tags: ["ota"] }, "otb")).toBe(
      false,
    );
    expect(galleryEntryMatchesQuery(entry, "unrelated")).toBe(false);
  });
  it("treats an empty query as no filter and missing fields as absent", () => {
    expect(galleryEntryMatchesQuery(entry, "")).toBe(true);
    expect(
      galleryEntryMatchesQuery(
        { name: "R1", author: "", description: "" },
        "clock",
      ),
    ).toBe(false);
  });
});

describe("GalleryCountPanel", () => {
  it("shows the wall size, marks a filtered count, and hides an unknown one", () => {
    const render = (total: number | null, filtered = false) =>
      renderToStaticMarkup(
        createElement(GalleryCountPanel, { total, filtered }),
      );
    expect(render(1280)).toContain(`${(1280).toLocaleString()} circuits`);
    expect(render(1)).toContain("1 circuit");
    expect(render(1)).not.toContain("circuits");
    expect(render(1)).toContain("Show contributor leaderboard");
    // "Filtered" names the state; "match" belongs to the text query alone.
    expect(render(3, true)).toContain("3 filtered circuits");
    expect(render(1, true)).toContain("1 filtered circuit");
    // No total (older API, still loading): say nothing rather than guess.
    expect(render(null)).toBe("");
  });

  it("adds a visible-match clause while a search narrows the wall", () => {
    const render = (visible: number, settled: boolean) =>
      renderToStaticMarkup(
        createElement(GalleryCountPanel, {
          total: 128,
          filtered: false,
          search: { visible, settled },
        }),
      );
    // Mid-fetch the clause says it may still grow; settled it stops saying so.
    expect(render(3, false)).toContain("128 circuits · 3 matches so far");
    expect(render(3, true)).toContain("128 circuits · 3 matches");
    expect(render(3, true)).not.toContain("so far");
    expect(render(1, true)).toContain("· 1 match");
    expect(render(1, true)).not.toContain("1 matches");
    expect(render(0, false)).toContain("· 0 matches so far");
  });
});

describe("GalleryFeed", () => {
  it("renders the landing chrome and editor entry point", () => {
    const markup = renderToStaticMarkup(
      createElement(GalleryFeed, { visitStats: { pv: 42, uv: 17 } }),
    );
    expect(markup).toContain('data-testid="gallery-feed"');
    expect(markup).toContain("Analog Canvas");
    expect(markup).toContain('data-testid="gallery-new-circuit"');
    expect(markup).toContain('data-testid="gallery-report-bug"');
    expect(markup).toContain("Report bug");
    expect(markup).toContain('href="/editor"');
    expect(markup).toContain("Presented by");
    expect(markup).toContain('href="https://tokenzhang.com"');
    expect(markup).toContain('src="/tokenzhang-favicon.png"');
    expect(markup).toContain('class="gallery-credit-group"');
    expect(markup).toContain('data-testid="gallery-analytics"');
    expect(markup).toContain('href="/analytics"');
    expect(markup).toContain("17 visitors");
    expect(markup).toContain("42 views");
    expect(markup.indexOf("Presented by")).toBeLessThan(
      markup.indexOf('data-testid="gallery-analytics"'),
    );
    expect(markup).toContain('data-testid="gallery-loading"');
  });
});
