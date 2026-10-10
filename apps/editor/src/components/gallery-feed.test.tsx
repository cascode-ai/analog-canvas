import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  galleryEntryMatchesQuery,
  GalleryFeed,
  loadGalleryFeed,
} from "./gallery-feed";
import { canReuseGalleryLandingFeed } from "./gallery-feed-wall";
import {
  contributorBoardRows,
  GalleryCountPanel,
} from "./gallery-feed-count-panel";
import { GalleryWallTile } from "./gallery-feed-tile";
import { GalleryTileMenu } from "./gallery-owner-controls";

import {
  GALLERY_SIGN_IN_REQUIRED,
  galleryAuthorsOf,
  galleryFeedQueryKey,
  galleryNarrowedByline,
  removeGalleryAuthorEntry,
  type GalleryFeedEntry,
} from "../gallery-client";

describe("Gallery landing preload", () => {
  const defaultFilters = {
    author: null,
    ownerUserId: null,
    tags: [] as string[],
    netlistable: false,
    liked: false,
    attention: false,
    parts: [] as string[],
  };

  it("is consumed only for the wall's first request, and only for its own query", () => {
    const unfiltered = galleryFeedQueryKey(defaultFilters);
    expect(
      canReuseGalleryLandingFeed(0, null, unfiltered, defaultFilters),
    ).toBe(true);
    // A preload from before queries were recorded asked the unfiltered wall.
    expect(canReuseGalleryLandingFeed(0, null, undefined, defaultFilters)).toBe(
      true,
    );
    expect(
      canReuseGalleryLandingFeed(0, "default", unfiltered, defaultFilters),
    ).toBe(false);
    expect(
      canReuseGalleryLandingFeed(1, null, unfiltered, defaultFilters),
    ).toBe(false);
    for (const filters of [
      { ...defaultFilters, author: "alice" },
      { ...defaultFilters, ownerUserId: "account-alice" },
      { ...defaultFilters, tags: ["amplifier"] },
      { ...defaultFilters, netlistable: true },
      { ...defaultFilters, liked: true },
      { ...defaultFilters, attention: true },
      { ...defaultFilters, parts: ["6-10"] },
    ]) {
      // A remembered or linked narrowing preloads its own query ...
      expect(
        canReuseGalleryLandingFeed(
          0,
          null,
          galleryFeedQueryKey(filters),
          filters,
        ),
      ).toBe(true);
      // ... and never answers another one.
      expect(canReuseGalleryLandingFeed(0, null, unfiltered, filters)).toBe(
        false,
      );
    }
  });
});

function fetchStatus(status: number): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ error: "x" }), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

function fetchReturning(payload: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: ok ? 200 : 502,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

/** A page, or null for anything that is not one. */
const pageOf = (result: Awaited<ReturnType<typeof loadGalleryFeed>>) =>
  typeof result === "string" ? null : result;

describe("loadGalleryFeed", () => {
  it("says a signed-out reader must sign in instead of calling the Gallery unavailable", async () => {
    expect(await loadGalleryFeed(fetchStatus(401))).toBe(
      GALLERY_SIGN_IN_REQUIRED,
    );
    expect(await loadGalleryFeed(fetchStatus(503))).toBeNull();
  });

  it("returns a page of entries with its cursor", async () => {
    const page = pageOf(
      await loadGalleryFeed(
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
      ),
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
      // An account narrows by its id; its byline may be a former one.
      "/api/gallery?owner=account-alice",
      "/api/gallery?author=alice&cursor=c%7C1",
      "/api/gallery?author=alice&limit=4",
      "/api/gallery?netlistable=1&liked=1",
      "/api/gallery",
    ]);
  });

  it("passes the server's total through and tolerates its absence", async () => {
    const withTotal = pageOf(
      await loadGalleryFeed(
        fetchReturning({ entries: [], nextCursor: null, total: 42 }),
      ),
    );
    expect(withTotal?.total).toBe(42);
    // An older worker without totals must read as "unknown", never as zero.
    const withoutTotal = pageOf(
      await loadGalleryFeed(fetchReturning({ entries: [] })),
    );
    expect(withoutTotal?.total).toBeNull();
  });

  it("keeps full quick-filter totals distinct from the loaded page", async () => {
    const filterCounts = { attention: 15, netlistable: 240, liked: 3 };
    const page = pageOf(
      await loadGalleryFeed(
        fetchReturning({
          entries: [],
          nextCursor: "next",
          total: 500,
          filterCounts,
        }),
      ),
    );
    expect(page?.filterCounts).toEqual(filterCounts);
    for (const invalid of [
      undefined,
      {},
      { ...filterCounts, liked: -1 },
      { ...filterCounts, liked: "3" },
    ]) {
      expect(
        pageOf(
          await loadGalleryFeed(
            fetchReturning({ entries: [], filterCounts: invalid }),
          ),
        )?.filterCounts,
      ).toBeUndefined();
    }
  });

  it("reads filtered contributor aggregates while tolerating older or invalid payloads", async () => {
    const authors = [{ author: "Alice", ownerUserId: "owner-a", count: 7 }];
    expect(
      pageOf(
        await loadGalleryFeed(
          fetchReturning({ entries: [], authors, nextCursor: "next" }),
        ),
      )?.authors,
    ).toEqual(authors);
    expect(
      pageOf(
        await loadGalleryFeed(fetchReturning({ entries: [], authors: [] })),
      )?.authors,
    ).toEqual([]);
    for (const invalid of [
      undefined,
      {},
      [null],
      [{ author: "Alice", count: -1 }],
      [{ author: "Alice", count: "1" }],
    ]) {
      expect(
        pageOf(
          await loadGalleryFeed(
            fetchReturning({ entries: [], authors: invalid }),
          ),
        )?.authors,
      ).toBeUndefined();
    }
  });

  it("degrades to null on errors and non-OK responses", async () => {
    expect(await loadGalleryFeed(fetchReturning({}, false))).toBeNull();
    const throwing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await loadGalleryFeed(throwing)).toBeNull();
  });
});

describe("contributors in matching entries", () => {
  const entry = (
    author: string,
    ownerUserId: string | null,
  ): GalleryFeedEntry => ({
    id: "entry",
    author,
    ownerUserId,
    name: "Circuit",
    description: "",
    createdAt: "",
    schemaVersion: 23,
  });
  it("groups stable accounts without merging same-name authors or blank bylines", () => {
    expect(
      galleryAuthorsOf([
        entry("Alice", "a"),
        entry("Alice", "b"),
        entry("Former name", "a"),
        entry("Alice", null),
        entry("Alice", null),
        entry("  ", "blank"),
      ]),
    ).toEqual([
      { author: "Alice", ownerUserId: null, count: 2 },
      { author: "Former name", ownerUserId: "a", count: 2 },
      { author: "Alice", ownerUserId: "b", count: 1 },
    ]);
  });
  it("drops empty contributors and re-ranks after a local removal without changing the prior snapshot", () => {
    const original = [
      { author: "Bob", ownerUserId: "b", count: 2 },
      { author: "Alice", ownerUserId: "a", count: 1 },
    ];
    const updated = removeGalleryAuthorEntry(original, entry("Bob", "b"));
    expect(updated.map((author) => author.author)).toEqual(["Alice", "Bob"]);
    expect(original[0]!.count).toBe(2);
    expect(removeGalleryAuthorEntry(original, entry(" ", "b"))).toEqual(
      original,
    );
    expect(removeGalleryAuthorEntry(updated, entry("Alice", "a"))).toEqual([
      { author: "Bob", ownerUserId: "b", count: 1 },
    ]);
  });
  it("names a wall narrowed to one account by its current byline", () => {
    const authors = [{ author: "Opus 5.5", ownerUserId: "a", count: 91 }];
    // A remembered filter or a link from before the account was renamed.
    expect(
      galleryNarrowedByline({ author: "Singh", ownerUserId: "a" }, authors),
    ).toBe("Opus 5.5");
    // A link naming only the account, once its contributors answer.
    expect(
      galleryNarrowedByline({ author: null, ownerUserId: "a" }, authors),
    ).toBe("Opus 5.5");
    expect(
      galleryNarrowedByline({ author: "Singh", ownerUserId: "a" }, []),
    ).toBe("Singh");
    // A byline alone, as an older link names a contributor.
    expect(
      galleryNarrowedByline({ author: "Bob", ownerUserId: null }, authors),
    ).toBe("Bob");
    expect(
      galleryNarrowedByline({ author: null, ownerUserId: null }, authors),
    ).toBeNull();
  });
});

describe("galleryEntryMatchesQuery", () => {
  const entry = {
    name: "Ring Oscillator",
    author: "Mei Chen",
    description: "Three-stage loop",
    tags: ["clocking"],
  };
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

  it("lists reference datasets among the contributors, ranked and marked, with a switch to hide them (#1574)", () => {
    const authors = [
      { author: "boboIC", ownerUserId: "u1", count: 86 },
      { author: "Rgeph", ownerUserId: "u2", count: 40 },
    ];
    const datasets = [{ key: "analoggenie", name: "AnalogGenie", count: 51 }];
    const names = (order: "count" | "name") =>
      contributorBoardRows(authors, datasets, order).map((row) =>
        row.kind === "author" ? row.option.author : row.dataset.name,
      );
    expect(names("count")).toEqual(["boboIC", "AnalogGenie", "Rgeph"]);
    expect(names("name")).toEqual(["AnalogGenie", "boboIC", "Rgeph"]);

    const community = renderToStaticMarkup(
      createElement(GalleryCountPanel, { total: 1161, authors, datasets }),
    );
    expect(community).toContain("2 authors · 1 dataset");
    expect(community).toContain(
      'data-testid="gallery-contributor-dataset-analoggenie"',
    );
    expect(community).toContain(">Dataset</span>");
    // The dataset takes its place in the ranking: boboIC 1, AnalogGenie 2, Rgeph 3.
    expect(community).toContain('data-testid="gallery-contributor-row-1"');
    expect(community).toContain('data-testid="gallery-contributor-row-3"');
    expect(community).toMatch(
      /gallery-contributor-dataset-analoggenie"><span class="gallery-contributor-rank">2</,
    );
    // Shown by default; the checkbox beside "A to Z" hides them.
    expect(community).toMatch(
      /data-testid="gallery-contributor-datasets"><input type="checkbox" checked=""/,
    );

    // On the dataset's own wall it is the contributor shown, with the way back.
    const datasetWall = renderToStaticMarkup(
      createElement(GalleryCountPanel, {
        total: 51,
        authors: [],
        datasets,
        author: "AnalogGenie",
        currentDataset: "analoggenie",
      }),
    );
    expect(datasetWall).toContain("1 dataset");
    expect(datasetWall).not.toContain("0 authors");
    expect(datasetWall).toContain("Circuits by AnalogGenie");
    expect(datasetWall).toContain('data-testid="gallery-contributor-all"');
    expect(datasetWall).toContain('aria-current="true"');
  });
});

describe("GalleryFeed", () => {
  it("renders the landing chrome and editor entry point", () => {
    const markup = renderToStaticMarkup(
      createElement(GalleryFeed, { visitStats: { pv: 42, uv: 17 } }),
    );
    expect(markup).toContain('data-testid="gallery-feed"');
    expect(markup).toContain("Analog Canvas");
    // Editor is the one way into the editor; there is no second New Circuit.
    expect(markup).toContain('data-testid="gallery-editor-switch"');
    expect(markup).not.toContain("gallery-new-circuit");
    // The way to Chip Arena beside it is hidden for now (#1608).
    expect(markup).not.toContain('data-testid="gallery-arena-link"');
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

describe("The Sim mark", () => {
  const entry: GalleryFeedEntry = {
    id: "divider01",
    name: "Divider",
    author: "Maker",
    ownerUserId: "maker",
    description: "",
    createdAt: "2026-10-09T08:00:00.000Z",
    previewRevision: "a".repeat(64),
    schemaVersion: 1,
    netlistable: true,
    aiGenerated: true,
  };
  const tile = (shown: GalleryFeedEntry) =>
    renderToStaticMarkup(
      createElement(GalleryWallTile, {
        entry: shown,
        linkedId: null,
        duplicates: new Map(),
        datasetWall: null,
        isOwner: false,
        viewerId: null,
        ownerBusy: null,
        selectedTags: [],
        selectAuthor: () => {},
        toggleLike: async () => {},
        toggleTag: () => {},
        setRejecting: () => {},
        setReviewing: () => {},
        withdrawEntry: async () => {},
      }),
    );

  it("follows Netlist and AI for a viewer the server sends it to, and is absent for anyone else", () => {
    // The server sends `simVerified` only to a viewer who may see it.
    const allowed = tile({ ...entry, simVerified: true });
    expect(allowed).toContain('data-testid="gallery-sim-divider01"');
    expect(allowed.indexOf("gallery-netlist-")).toBeLessThan(
      allowed.indexOf("gallery-ai-"),
    );
    expect(allowed.indexOf("gallery-ai-")).toBeLessThan(
      allowed.indexOf("gallery-sim-"),
    );
    expect(tile(entry)).not.toContain("gallery-sim-");
  });

  it("is verified from the tile's menu by the Owner's accounts alone", () => {
    const menu = (onVerifySimulation?: () => void) =>
      renderToStaticMarkup(
        createElement(GalleryTileMenu, {
          entry,
          busy: false,
          administrator: true,
          onReview: () => {},
          onWithdraw: () => {},
          ...(onVerifySimulation ? { onVerifySimulation } : {}),
        }),
      );
    expect(menu(() => {})).toContain("Verify simulation");
    expect(menu()).not.toContain("Verify simulation");
  });
});
