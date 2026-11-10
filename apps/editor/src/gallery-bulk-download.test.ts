import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  downloadGalleryZip,
  galleryZipFileName,
  GalleryListFailure,
  type GalleryZipProgress,
} from "./gallery-bulk-download";
import type { GalleryFeedQuery } from "./gallery-client";

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-11-09T08:00:00Z") });
});
afterEach(() => {
  vi.useRealTimers();
});

/** A list entry as GET /api/gallery sends it (worker/gallery-store.ts). */
function summary(id: string, minute: number) {
  return {
    curationRevision: 0,
    id,
    name: `Circuit ${id}`,
    author: id.startsWith("ct-") ? "CircuitThink (redrawn)" : "Ada",
    ownerUserId: null,
    description: "",
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString(),
    previewRevision: `rev-${id}`,
    previewWidth: 400,
    previewHeight: 300,
    schemaVersion: 78,
    tags: [],
    netlistable: true,
    componentCount: 9,
    likes: 0,
    likedByViewer: false,
  };
}

const projectOf = (id: string) => JSON.stringify({ format: "icproj", id });

interface Asked {
  url: URL;
  at: number;
}

/**
 * The Gallery's two public reads, in the Worker's shapes: the keyset list
 * (`{entries, nextCursor}`, its first page with `total`, `authors` and
 * `filterCounts`) and one circuit (`{entry, status, ownerUserId,
 * projectText}`). `reply` may answer a request first; null passes it on.
 */
function gallery(
  entries: ReturnType<typeof summary>[],
  {
    reply,
    latencyMs = 50,
    repeatAcrossPages = false,
  }: {
    reply?: (url: URL, attempt: number) => Response | Error | null;
    latencyMs?: number;
    repeatAcrossPages?: boolean;
  } = {},
) {
  const asked: Asked[] = [];
  const attempts = new Map<string, number>();
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchLike = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "https://gallery.test");
    asked.push({ url, at: Date.now() });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
      const key = url.pathname + url.search;
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      const early = reply?.(url, attempt);
      if (early instanceof Error) throw early;
      if (early) return early;
      if (url.pathname === "/api/gallery") {
        const limit = Number(url.searchParams.get("limit") ?? 60);
        const cursor = url.searchParams.get("cursor");
        let start = cursor
          ? entries.findIndex((entry) => entry.id === cursor.split("|")[1]) + 1
          : 0;
        if (cursor && repeatAcrossPages) start -= 1;
        const page = entries.slice(start, start + limit);
        const more = start + limit < entries.length;
        const last = page.at(-1);
        return Response.json({
          entries: page,
          nextCursor: more && last ? `o${last.createdAt}|${last.id}` : null,
          ...(cursor
            ? {}
            : {
                total: entries.length,
                authors: [],
                filterCounts: { attention: 0, netlistable: 0, liked: 0 },
              }),
          ...(url.searchParams.get("q")
            ? { search: url.searchParams.get("q") }
            : {}),
        });
      }
      const id = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      const entry = entries.find((each) => each.id === id);
      if (!entry) return Response.json({ error: "not-found" }, { status: 404 });
      return Response.json({
        entry,
        status: "public",
        ownerUserId: null,
        projectText: projectOf(id),
      });
    } finally {
      inFlight--;
    }
  }) as typeof fetch;
  return { fetchLike, asked, maxInFlight: () => maxInFlight };
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  const outcome = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const result = await outcome;
  if ("error" in result) throw result.error;
  return result.value;
}

async function unzipped(blob: Blob | null): Promise<Record<string, string>> {
  expect(blob).not.toBeNull();
  const files = unzipSync(new Uint8Array(await blob!.arrayBuffer()));
  return Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]),
  );
}

it("pages the wall's own query oldest first, keeps each circuit once and writes its Project and the manifest", async () => {
  const entries = [
    ...Array.from({ length: 125 }, (_, index) =>
      summary(`c${String(index).padStart(3, "0")}`, index),
    ),
    summary("ct-100", 200),
  ];
  const server = gallery(entries, { repeatAcrossPages: true });
  const query: GalleryFeedQuery = {
    tags: ["bias"],
    parts: ["6-10"],
    netlistable: true,
    order: "random",
    seed: "abc",
  };
  const progress: GalleryZipProgress[] = [];
  const result = await settle(
    downloadGalleryZip(query, {
      fetch: server.fetchLike,
      origin: "https://gallery.test",
      usage: "Free to use.",
      onProgress: (each) => progress.push(each),
    }),
  );

  const lists = server.asked.filter(
    ({ url }) => url.pathname === "/api/gallery",
  );
  expect(lists.map(({ url }) => url.search)).toEqual([
    "?tags=bias&netlistable=1&parts=6-10&order=oldest&limit=60",
    "?tags=bias&netlistable=1&parts=6-10&order=oldest&limit=60&cursor=o2026-10-01T00%3A59%3A00.000Z%7Cc059",
    "?tags=bias&netlistable=1&parts=6-10&order=oldest&limit=60&cursor=o2026-10-01T01%3A58%3A00.000Z%7Cc118",
  ]);
  // The repeated first tile of each later page is read once.
  const reads = server.asked.filter(({ url }) =>
    url.pathname.startsWith("/api/gallery/"),
  );
  expect(reads).toHaveLength(126);
  expect(result).toMatchObject({
    listed: 126,
    count: 126,
    failed: [],
    fileName: "analog-canvas-gallery-filtered-2026-11-09.zip",
  });

  const files = await unzipped(result.zip);
  expect(Object.keys(files)).toHaveLength(127);
  expect(files["c007.icproj.json"]).toBe(projectOf("c007"));
  expect(files["ct-100.icproj.json"]).toBe(projectOf("ct-100"));
  const manifest = JSON.parse(files["manifest.json"]!);
  expect(manifest).toMatchObject({
    query: {
      tags: "bias",
      netlistable: "1",
      parts: "6-10",
      order: "oldest",
    },
    generatedAt: "2026-11-09T08:00:00.000Z",
    origin: "https://gallery.test",
    usage: "Free to use.",
    count: 126,
    failed: [],
    sources: [
      {
        key: "circuitthink",
        name: "CircuitThink",
        license: "Apache-2.0",
        homepage: "https://github.com/7jiangyq/CircuitThink",
      },
    ],
  });
  expect(manifest.entries[0]).toEqual({
    id: "c000",
    name: "Circuit c000",
    author: "Ada",
    source: "community",
    previewRevision: "rev-c000",
    file: "c000.icproj.json",
  });
  expect(manifest.entries.at(-1)).toMatchObject({
    id: "ct-100",
    source: "circuitthink",
  });
  expect(progress.at(-1)).toEqual({
    phase: "reading",
    listed: 126,
    done: 126,
    failed: 0,
  });
});

it("stays at ten requests a second over four readers, retries what is transient and reports what still failed", async () => {
  const entries = Array.from({ length: 12 }, (_, index) =>
    summary(`e${index}`, index),
  );
  const server = gallery(entries, {
    latencyMs: 900,
    reply: (url, attempt) => {
      const id = url.pathname.split("/")[3];
      if (id === "e1" && attempt <= 2)
        return new Response("busy", { status: 503 });
      if (id === "e3" && attempt === 1) return new TypeError("network");
      if (id === "e4") return Response.json({ error: "x" }, { status: 500 });
      if (id === "e5")
        return Response.json({ error: "not-found" }, { status: 404 });
      if (id === "e6")
        return Response.json({ entry: { id: "e6" }, projectText: "" });
      return null;
    },
  });
  const result = await settle(
    downloadGalleryZip({}, { fetch: server.fetchLike }),
  );

  const starts = server.asked.map(({ at }) => at);
  for (let index = 1; index < starts.length; index++)
    expect(starts[index]! - starts[index - 1]!).toBeGreaterThanOrEqual(100);
  expect(server.maxInFlight()).toBe(4);
  // Four tries for a 500, one for a 404 or a reply without its Project.
  const tries = (id: string) =>
    server.asked.filter(({ url }) => url.pathname === `/api/gallery/${id}`)
      .length;
  expect([tries("e1"), tries("e3")]).toEqual([3, 2]);
  expect([tries("e4"), tries("e5"), tries("e6")]).toEqual([4, 1, 1]);

  expect(result.count).toBe(9);
  expect(result.failed).toEqual([
    { id: "e4", name: "Circuit e4", reason: "500 x" },
    { id: "e5", name: "Circuit e5", reason: "404 not-found" },
    { id: "e6", name: "Circuit e6", reason: "reply without its Project" },
  ]);
  const files = await unzipped(result.zip);
  expect(files["e1.icproj.json"]).toBe(projectOf("e1"));
  expect(files["e4.icproj.json"]).toBeUndefined();
  const manifest = JSON.parse(files["manifest.json"]!);
  expect(manifest.count).toBe(9);
  expect(manifest.failed).toEqual(result.failed);
  expect(manifest.sources).toEqual([]);
  // Missing circuits, the name says it is partial.
  expect(result.fileName).toMatch(/^analog-canvas-gallery-.*-partial\.zip$/u);
});

it("holds every reader, waiting ones too, for a 429's Retry-After", async () => {
  const entries = Array.from({ length: 6 }, (_, index) =>
    summary(`e${index}`, index),
  );
  let rateLimitedAt = 0;
  const server = gallery(entries, {
    latencyMs: 10,
    reply: (url, attempt) => {
      if (url.pathname !== "/api/gallery/e0" || attempt > 1) return null;
      rateLimitedAt = Date.now();
      return Response.json(
        { error: "too-many-requests", retryAfterSeconds: 3 },
        { status: 429, headers: { "retry-after": "3" } },
      );
    },
  });
  const result = await settle(
    downloadGalleryZip({}, { fetch: server.fetchLike }),
  );
  expect(rateLimitedAt).toBeGreaterThan(0);
  expect(
    server.asked.filter(
      ({ at }) => at > rateLimitedAt && at < rateLimitedAt + 3000,
    ),
  ).toEqual([]);
  expect(result).toMatchObject({ count: 6, failed: [] });
});

it("stops on Cancel and saves nothing", async () => {
  const entries = Array.from({ length: 40 }, (_, index) =>
    summary(`e${index}`, index),
  );
  const server = gallery(entries);
  const controller = new AbortController();
  const outcome = downloadGalleryZip(
    {},
    {
      fetch: server.fetchLike,
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.done === 5) controller.abort();
      },
    },
  );
  await expect(settle(outcome)).rejects.toMatchObject({ name: "AbortError" });
  // Only reads already under way finish; none starts after Cancel.
  expect(server.asked.length).toBeLessThanOrEqual(1 + 5 + 4);
});

it("says nothing matched rather than make an empty archive", async () => {
  const server = gallery([]);
  const result = await settle(
    downloadGalleryZip({ source: "circuitthink" }, { fetch: server.fetchLike }),
  );
  expect(result).toMatchObject({ zip: null, listed: 0, count: 0, failed: [] });
  expect(server.asked.map(({ url }) => url.search)).toEqual([
    "?source=circuitthink&order=oldest&limit=60",
  ]);
});

it("fails on a list the server refuses, with its error, untried again", async () => {
  const server = gallery([summary("a", 1)], {
    reply: () => Response.json({ error: "unknown-source" }, { status: 400 }),
  });
  await expect(
    settle(
      downloadGalleryZip({ source: "ams-net" }, { fetch: server.fetchLike }),
    ),
  ).rejects.toEqual(
    new GalleryListFailure("Could not list the circuits (400 unknown-source)."),
  );
  expect(server.asked).toHaveLength(1);
});

it("narrows by the Gallery's search rule when the server did not search", async () => {
  const entries = [summary("a", 1), summary("b", 2)];
  entries[1]!.name = "Folded cascode OTA";
  const server = gallery(entries, {
    reply: (url) =>
      url.pathname === "/api/gallery"
        ? Response.json({ entries, nextCursor: null, total: 2 })
        : null,
  });
  const result = await settle(
    downloadGalleryZip({ q: "cascode" }, { fetch: server.fetchLike }),
  );
  expect(result.count).toBe(1);
  expect(Object.keys(await unzipped(result.zip)).sort()).toEqual([
    "b.icproj.json",
    "manifest.json",
  ]);
});

it("names the archive by its dataset and whether it is filtered", () => {
  const date = new Date("2026-11-09T12:00:00Z");
  expect(galleryZipFileName({}, date)).toBe(
    "analog-canvas-gallery-2026-11-09.zip",
  );
  expect(galleryZipFileName({ order: "likes" }, date)).toBe(
    "analog-canvas-gallery-2026-11-09.zip",
  );
  expect(
    galleryZipFileName({ source: "circuitthink", parts: ["6-10"] }, date),
  ).toBe("analog-canvas-gallery-circuitthink-filtered-2026-11-09.zip");
  expect(galleryZipFileName({ hideDatasets: true }, date)).toBe(
    "analog-canvas-gallery-community-2026-11-09.zip",
  );
});
