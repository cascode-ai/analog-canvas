/**
 * A Gallery wall's circuits, or every public one, as one `.zip` (#2148), for
 * anyone, signed out too: each circuit's Project as `<id>.icproj.json`, which
 * File → Open reads, beside a `manifest.json`. It pages the wall's own query
 * oldest first, so the cursor walk is stable, reads each circuit and deflates
 * it into the archive at once, so memory holds about the compressed archive,
 * never every Project. Requests stay at most 10 a second, half the site's
 * flood limit (docs/specs/community-gallery.md#crawlers-ai-and-floods).
 */
import { strToU8, Zip, ZipDeflate } from "fflate";

import {
  galleryFeedQueryKey,
  type GalleryFeedEntry,
  type GalleryFeedQuery,
} from "./gallery-client";
import { galleryEntryMatchesQuery } from "./gallery-search";
import { gallerySourceOfEntryId } from "./gallery-sources";

const PAGE_SIZE = 60;
const CONCURRENCY = 4;
/** Between request starts: at most 10 a second, all readers together. */
const SPACING_MS = 100;
const ATTEMPTS = 4;
/** Archive bytes held as one array before they become a Blob part. */
const PART_BYTES = 4 * 1024 * 1024;

export interface GalleryZipProgress {
  phase: "listing" | "reading";
  /** Circuits listed so far; once reading, all of them. */
  listed: number;
  /** Circuits read so far, saved or failed. */
  done: number;
  failed: number;
}

export interface GalleryZipFailure {
  id: string;
  name: string;
  reason: string;
}

export interface GalleryZipResult {
  /** Null when nothing matched or nothing could be read. */
  zip: Blob | null;
  fileName: string;
  /** Circuits listed, and those saved in the archive. */
  listed: number;
  count: number;
  failed: GalleryZipFailure[];
}

/** Time, injectable so a test runs the throttle on a virtual clock. */
export interface GalleryZipClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface GalleryZipOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (progress: GalleryZipProgress) => void;
  /** The site the manifest names; the page's own by default. */
  origin?: string;
  clock?: GalleryZipClock;
  /** When the archive is made, for its manifest and file name. */
  date?: Date;
  /**
   * The usage policy the manifest repeats; the caller's, so this lazy chunk
   * shares no module with the wall's first paint.
   */
  usage?: string;
}

/** The list itself failed, so no archive could say it holds every circuit. */
export class GalleryListFailure extends Error {}

function abortError(): DOMException {
  return new DOMException("The download was cancelled.", "AbortError");
}

const systemClock: GalleryZipClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(abortError());
        },
        { once: true },
      );
    }),
};

/** The list request's filters: the wall's own query, oldest first. */
function galleryZipListParams(query: GalleryFeedQuery): URLSearchParams {
  return new URLSearchParams(
    galleryFeedQueryKey({ ...query, order: "oldest" }),
  );
}

/** `analog-canvas-gallery[-<source>][-filtered]-<yyyy-mm-dd>.zip`. */
export function galleryZipFileName(
  query: GalleryFeedQuery,
  date: Date,
): string {
  const params = galleryZipListParams(query);
  const words = ["analog-canvas-gallery"];
  const source = params.get("source");
  if (source) words.push(source.replace(/[^a-z0-9-]/giu, ""));
  if ([...params.keys()].some((key) => key !== "source" && key !== "order"))
    words.push("filtered");
  words.push(date.toISOString().slice(0, 10));
  return `${words.join("-")}.zip`;
}

type Reply = { ok: true; body: unknown } | { ok: false; reason: string };

/**
 * GETs on one shared schedule: request starts spaced SPACING_MS apart, a
 * transient failure (network, 408, 429, 5xx) retried, a 429 pausing every
 * reader for its Retry-After.
 */
function scheduledReader(
  fetchLike: typeof fetch,
  clock: GalleryZipClock,
  signal: AbortSignal | undefined,
) {
  let nextStart = 0;
  let pausedUntil = 0;
  async function turn(): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw abortError();
      const now = clock.now();
      if (pausedUntil > now) {
        await clock.sleep(pausedUntil - now, signal);
        continue;
      }
      const start = Math.max(nextStart, now);
      nextStart = start + SPACING_MS;
      if (start > now) await clock.sleep(start - now, signal);
      if (signal?.aborted) throw abortError();
      // A 429 that came while this reader waited holds it too.
      if (pausedUntil <= clock.now()) return;
    }
  }
  return async function read(path: string): Promise<Reply> {
    for (let attempt = 1; ; attempt++) {
      await turn();
      let response: Response | null = null;
      try {
        response = await fetchLike(path, {
          credentials: "same-origin",
          ...(signal ? { signal } : {}),
        });
      } catch {
        if (signal?.aborted) throw abortError();
      }
      let body: unknown = null;
      let readable = false;
      if (response) {
        try {
          body = await response.json();
          readable = true;
        } catch {
          if (signal?.aborted) throw abortError();
        }
      }
      if (response?.ok && readable) return { ok: true, body };
      const status = response?.status ?? 0;
      const transient =
        !response ||
        response.ok ||
        status === 408 ||
        status === 429 ||
        status >= 500;
      const error = (body as { error?: unknown } | null)?.error;
      const reason = !response
        ? "network error"
        : response.ok
          ? "unreadable reply"
          : `${status}${typeof error === "string" ? ` ${error}` : ""}`;
      if (!transient || attempt === ATTEMPTS) return { ok: false, reason };
      if (status === 429) {
        const header = Number(response?.headers.get("retry-after"));
        const fromBody = Number(
          (body as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds,
        );
        const seconds = header > 0 ? header : fromBody > 0 ? fromBody : 60;
        pausedUntil = Math.max(pausedUntil, clock.now() + seconds * 1000);
      } else {
        await clock.sleep(1000 * 2 ** (attempt - 1), signal);
      }
    }
  };
}

/** Archive bytes as Blob parts, a few megabytes each. */
function zipWriter() {
  const parts: Blob[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let failure: Error | null = null;
  let ended = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failure = error;
      return;
    }
    pending.push(chunk);
    pendingBytes += chunk.byteLength;
    if (pendingBytes >= PART_BYTES || final) {
      parts.push(new Blob(pending as BlobPart[]));
      pending = [];
      pendingBytes = 0;
    }
    if (final) ended = true;
  });
  return {
    add(name: string, text: string): void {
      const file = new ZipDeflate(name, { level: 6 });
      zip.add(file);
      file.push(strToU8(text), true);
    },
    finish(): Blob {
      zip.end();
      if (failure) throw failure;
      if (!ended) throw new Error("The archive did not finish.");
      return new Blob(parts, { type: "application/zip" });
    },
  };
}

const ENTRY_ID = /^[A-Za-z0-9_-]{1,64}$/u;

/**
 * Every circuit the query selects, across all its pages, each once, as one
 * archive. Cancelling rejects with an AbortError and saves nothing; a list
 * page that cannot be read rejects with GalleryListFailure; a circuit that
 * cannot be read after its retries is left out and reported, in the result
 * and the manifest.
 */
export async function downloadGalleryZip(
  query: GalleryFeedQuery,
  options: GalleryZipOptions = {},
): Promise<GalleryZipResult> {
  const fetchLike = options.fetch ?? fetch;
  const clock = options.clock ?? systemClock;
  const { signal } = options;
  const date = options.date ?? new Date();
  const read = scheduledReader(fetchLike, clock, signal);
  const params = galleryZipListParams(query);
  const search = params.get("q") ?? "";
  const fileName = galleryZipFileName(query, date);

  const listed: GalleryFeedEntry[] = [];
  const seen = new Set<string>();
  const progress: GalleryZipProgress = {
    phase: "listing",
    listed: 0,
    done: 0,
    failed: 0,
  };
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = new URLSearchParams(params);
    page.set("limit", String(PAGE_SIZE));
    if (cursor) page.set("cursor", cursor);
    const reply = await read(`/api/gallery?${page}`);
    if (!reply.ok)
      throw new GalleryListFailure(
        `Could not list the circuits (${reply.reason}).`,
      );
    const body = reply.body as {
      entries?: GalleryFeedEntry[];
      nextCursor?: unknown;
      search?: unknown;
    };
    // A server that did not search answers unsearched; narrow by the
    // Gallery's one search rule, as the wall does.
    const searched = !search || typeof body.search === "string";
    for (const entry of body.entries ?? []) {
      if (seen.has(entry.id)) continue;
      if (!searched && !galleryEntryMatchesQuery(entry, search)) continue;
      seen.add(entry.id);
      listed.push(entry);
    }
    progress.listed = listed.length;
    options.onProgress?.({ ...progress });
    const next: unknown = body.nextCursor;
    cursor = typeof next === "string" && next ? next : null;
    if (cursor && cursors.has(cursor))
      throw new GalleryListFailure("The list repeated a page.");
    if (cursor) cursors.add(cursor);
  } while (cursor);

  const empty = { fileName, listed: listed.length, count: 0 };
  if (listed.length === 0) return { ...empty, zip: null, failed: [] };

  progress.phase = "reading";
  options.onProgress?.({ ...progress });
  const writer = zipWriter();
  const saved = new Map<string, string>();
  const failed: GalleryZipFailure[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let entry; (entry = listed[next++]);) {
        const reason = await (async () => {
          if (!ENTRY_ID.test(entry.id)) return "unexpected id";
          const reply = await read(
            `/api/gallery/${encodeURIComponent(entry.id)}?download=1`,
          );
          if (!reply.ok) return reply.reason;
          const { entry: held, projectText } = reply.body as {
            entry?: { id?: unknown };
            projectText?: unknown;
          };
          if (
            held?.id !== entry.id ||
            typeof projectText !== "string" ||
            !projectText
          )
            return "reply without its Project";
          const file = `${entry.id}.icproj.json`;
          writer.add(file, projectText);
          saved.set(entry.id, file);
          return null;
        })();
        if (reason) {
          failed.push({ id: entry.id, name: entry.name, reason });
          progress.failed++;
        }
        progress.done++;
        options.onProgress?.({ ...progress });
      }
    }),
  );
  const order = new Map(listed.map((entry, index) => [entry.id, index]));
  failed.sort(
    (left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0),
  );
  if (saved.size === 0) return { ...empty, zip: null, failed };

  const entries = listed.flatMap((entry) => {
    const file = saved.get(entry.id);
    return file
      ? [
          {
            id: entry.id,
            name: entry.name,
            author: entry.author,
            source: gallerySourceOfEntryId(entry.id)?.key ?? "community",
            previewRevision: entry.previewRevision ?? null,
            file,
          },
        ]
      : [];
  });
  // Each dataset's circuits keep its license.
  const sources = [
    ...new Map(
      listed.flatMap((entry) => {
        const source = gallerySourceOfEntryId(entry.id);
        return source ? [[source.key, source] as const] : [];
      }),
    ).values(),
  ].map(({ key, name, license, homepage }) => ({
    key,
    name,
    license,
    homepage,
  }));
  writer.add(
    "manifest.json",
    `${JSON.stringify(
      {
        query: Object.fromEntries(params),
        generatedAt: date.toISOString(),
        origin: options.origin ?? globalThis.location?.origin ?? "",
        ...(options.usage ? { usage: options.usage } : {}),
        sources,
        count: entries.length,
        entries,
        failed,
      },
      null,
      2,
    )}\n`,
  );
  return {
    zip: writer.finish(),
    // An archive missing circuits says so in its name, never passing for
    // the whole package (#2148).
    fileName: failed.length
      ? fileName.replace(/\.zip$/u, "-partial.zip")
      : fileName,
    listed: listed.length,
    count: entries.length,
    failed,
  };
}
