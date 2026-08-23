import { useEffect, useRef, useState } from "react";

import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { libraryProjectExamples } from "../examples/library-examples";
import { GalleryChrome } from "./gallery-chrome";
import { Masonry } from "./masonry";

export interface GalleryFeedEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  createdAt: string;
  schemaVersion: number;
  tags?: string[];
  /**
   * Whether the circuit extracts to a design netlist. A mark of extra
   * completeness, never a gate — a schematic is allowed to be abbreviated,
   * and one without this is listed exactly like one with it.
   */
  netlistable?: boolean;
  likes?: number;
  likedByViewer?: boolean;
}

export interface GalleryFeedPage {
  entries: GalleryFeedEntry[];
  nextCursor: string | null;
  /** How many circuits this round covers; 0 means there is nothing to loop. */
  total: number;
}

export interface GalleryFeedState {
  status: "loading" | "ready" | "unavailable";
  entries: GalleryFeedEntry[];
  nextCursor: string | null;
  /** The shuffle this round is ordered by. */
  seed: string;
  /** Which pass over the wall these entries came from, counting from 0. */
  round: number;
  /** Circuits in the round; 0 means there is nothing to come back to. */
  total: number;
}

/**
 * A fresh shuffle. The wall is browsed rather than read newest-first, so each
 * visit gets its own order, and each pass over it gets another one — which is
 * what keeps scrolling worthwhile once the wall is smaller than the scroll.
 */
/**
 * How many circuits a round needs before the feed comes back around.
 *
 * Repeating is only invisible when the repeat lands well off-screen. A wall of
 * two circuits looped would stack the same two down the page, which reads as
 * a fault rather than as more to look at, so a small wall simply ends. Roughly
 * a screenful of tiles is the point where a second pass reads as more feed.
 */
const ENDLESS_MIN_ROUND = 8;

function newFeedSeed(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

const resolver = new InMemorySymbolResolver(builtInSymbols);

/**
 * The like mark, drawn rather than typed.
 *
 * An emoji is a different picture on every platform and carries its own
 * colour, which on a wall of circuit drawings reads as a sticker. This is one
 * path that inherits the button's colour: outlined until the circuit is
 * liked, filled once it is, so the state is legible without reading a count.
 */
function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20.5 4.2 13a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1A4.8 4.8 0 0 1 19.8 13Z" />
    </svg>
  );
}

function savedAtLabel(createdAt: string): string {
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime())
    ? createdAt
    : parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

/** Bundled examples double as never-empty starter tiles for the feed. */
function bundledTiles() {
  return libraryProjectExamples.map((example) => {
    const topDocument = example.project.documents.find(
      (document) => document.id === example.project.topDocumentId,
    )!;
    return {
      id: example.id,
      name: example.name,
      description: example.description,
      svg: renderDocumentSvg(topDocument, resolver),
    };
  });
}

/** One feed page; the plain first request stays exactly `/api/gallery`. */
export async function loadGalleryFeed(
  fetchLike: typeof fetch = fetch,
  options: {
    cursor?: string | null;
    author?: string | null;
    tags?: readonly string[];
    /** Asks for a shuffled round instead of newest-first. */
    seed?: string | null;
  } = {},
): Promise<GalleryFeedPage | null> {
  const params = new URLSearchParams();
  if (options.author) params.set("author", options.author);
  if (options.tags && options.tags.length > 0) {
    params.set("tags", options.tags.join(","));
  }
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.seed) params.set("seed", options.seed);
  const query = params.toString();
  try {
    const response = await fetchLike(
      `/api/gallery${query ? `?${query}` : ""}`,
      { credentials: "same-origin" },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      entries?: GalleryFeedEntry[];
      nextCursor?: unknown;
      total?: unknown;
    };
    const entries = payload.entries ?? [];
    return {
      entries,
      nextCursor:
        typeof payload.nextCursor === "string" ? payload.nextCursor : null,
      total: typeof payload.total === "number" ? payload.total : entries.length,
    };
  } catch {
    return null;
  }
}

/**
 * Full-screen landing feed: every tile is one published circuit that opens
 * in the editor at `/g/<id>`. Bundled Library examples fill the wall while
 * the community gallery is empty or unreachable (development hosts have no
 * worker), so the landing page is never blank.
 */
export function GalleryFeed() {
  const [author, setAuthor] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("author"),
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(() =>
    typeof window === "undefined"
      ? []
      : (new URLSearchParams(window.location.search).get("tags") ?? "")
          .split(",")
          .filter((tag) => tag.length > 0),
  );
  const [tagOptions, setTagOptions] = useState<
    { tag: string; count: number }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/gallery/tags", {
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          tags?: { tag: string; count: number }[];
        };
        if (!cancelled) setTagOptions(payload.tags ?? []);
      } catch {
        // No menu without the worker; the wall itself still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  /**
   * The shuffle a reload starts from. Held here rather than made inside the
   * effect so that running the effect twice — as StrictMode does — reloads
   * the same order instead of throwing the first one away. Rounds advance
   * `state.seed`, which deliberately does not feed back into the reload.
   */
  const [reloadSeed, setReloadSeed] = useState(newFeedSeed);
  const [state, setState] = useState<GalleryFeedState>(() => ({
    status: "loading",
    entries: [],
    nextCursor: null,
    seed: reloadSeed,
    round: 0,
    total: 0,
  }));
  const loadingMoreRef = useRef(false);

  /**
   * One thumb per account, taken back by pressing again. The server owns the
   * count; this applies what it returns rather than guessing, so two tabs
   * cannot drift apart.
   */
  async function toggleLike(entryId: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`/api/gallery/${entryId}/like`, {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      return;
    }
    if (response.status === 401) {
      window.location.href = "/api/auth/github/start";
      return;
    }
    if (!response.ok) return;
    const result = (await response.json().catch(() => null)) as {
      likes?: number;
      likedByViewer?: boolean;
    } | null;
    if (!result) return;
    setState((previous) => ({
      ...previous,
      entries: previous.entries.map((entry): GalleryFeedEntry =>
        entry.id === entryId
          ? {
              ...entry,
              likes: result.likes ?? entry.likes ?? 0,
              likedByViewer: result.likedByViewer === true,
            }
          : entry,
      ),
    }));
  }

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const seed = reloadSeed;
    setState({
      status: "loading",
      entries: [],
      nextCursor: null,
      seed,
      round: 0,
      total: 0,
    });
    void loadGalleryFeed(fetch, { author, tags: selectedTags, seed }).then(
      (page) => {
        if (cancelled) return;
        setState(
          page
            ? { status: "ready", seed, round: 0, ...page }
            : {
                status: "unavailable",
                entries: [],
                nextCursor: null,
                seed,
                round: 0,
                total: 0,
              },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [author, selectedTags, reloadSeed]);

  // Endless scroll: the sentinel below the wall appends the next page as it
  // comes into view, and when a round runs out it starts another one under a
  // fresh shuffle rather than stopping. The wall is smaller than the scroll,
  // so ending at the last upload would end the browsing too; coming back
  // around in a different order is the point. A wall too small for a repeat
  // to land off-screen ends instead — see ENDLESS_MIN_ROUND.
  const { nextCursor, seed, round, total } = state;
  const exhausted = nextCursor === null;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (exhausted && total < ENDLESS_MIN_ROUND) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((observed) => {
      if (!observed.some((entry) => entry.isIntersecting)) return;
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      const nextRoundSeed = exhausted ? newFeedSeed() : seed;
      void loadGalleryFeed(fetch, {
        author,
        tags: selectedTags,
        seed: nextRoundSeed,
        cursor: exhausted ? null : nextCursor,
      }).then((page) => {
        loadingMoreRef.current = false;
        if (!page) return;
        setState((previous) =>
          previous.status === "ready"
            ? {
                ...previous,
                entries: [...previous.entries, ...page.entries],
                nextCursor: page.nextCursor,
                seed: nextRoundSeed,
                round: exhausted ? previous.round + 1 : previous.round,
                total: page.total,
              }
            : previous,
        );
      });
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, exhausted, seed, round, total, author, selectedTags]);

  function syncQuery(nextAuthor: string | null, nextTags: string[]): void {
    const url = new URL(window.location.href);
    if (nextAuthor) url.searchParams.set("author", nextAuthor);
    else url.searchParams.delete("author");
    if (nextTags.length > 0) url.searchParams.set("tags", nextTags.join(","));
    else url.searchParams.delete("tags");
    window.history.replaceState(null, "", url.pathname + url.search);
  }

  function selectAuthor(next: string | null): void {
    setReloadSeed(newFeedSeed());
    setAuthor(next);
    syncQuery(next, selectedTags);
  }

  function toggleTag(tag: string): void {
    setReloadSeed(newFeedSeed());
    setSelectedTags((previous) => {
      const next = previous.includes(tag)
        ? previous.filter((candidate) => candidate !== tag)
        : [...previous, tag];
      syncQuery(author, next);
      return next;
    });
  }

  const entries = state.entries;

  return (
    <main className="gallery-shell" data-testid="gallery-feed">
      <GalleryChrome subtitle="Community gallery" />

      {tagOptions.length > 0 ? (
        <div className="gallery-tag-bar" data-testid="gallery-tag-bar">
          {tagOptions.map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              className={
                selectedTags.includes(tag)
                  ? "gallery-tag-option gallery-tag-selected"
                  : "gallery-tag-option"
              }
              data-testid={`gallery-tag-option-${tag.replace(/\s/gu, "-")}`}
              aria-pressed={selectedTags.includes(tag)}
              onClick={() => toggleTag(tag)}
            >
              {tag} <span>{count}</span>
            </button>
          ))}
          {selectedTags.length > 0 ? (
            <button
              type="button"
              className="gallery-tag-option gallery-tag-clear"
              data-testid="gallery-tags-clear"
              onClick={() => {
                setSelectedTags([]);
                syncQuery(author, []);
              }}
            >
              Clear tags
            </button>
          ) : null}
        </div>
      ) : null}
      {author ? (
        <div className="gallery-filter" data-testid="gallery-filter">
          <span>Circuits by {author}</span>
          <button
            type="button"
            data-testid="gallery-filter-clear"
            onClick={() => selectAuthor(null)}
          >
            Show everyone
          </button>
        </div>
      ) : null}
      {state.status === "loading" ? (
        <p className="gallery-status" data-testid="gallery-loading">
          Loading gallery…
        </p>
      ) : (
        <section className="gallery-wall">
          <Masonry
            aria-label="Published circuits"
            items={[
              // A circuit can come round again in a later shuffle, so the key
              // is its place in the feed rather than its id. Entries are only
              // ever appended, so the index is stable.
              ...entries.map((entry, feedIndex) => ({
                key: `${feedIndex}-${entry.id}`,
                node: (
                  <a
                    className="gallery-tile"
                    href={`/g/${entry.id}`}
                    data-testid={`gallery-tile-${entry.id}`}
                  >
                    <span className="gallery-tile-preview">
                      <img
                        src={`/api/gallery/${entry.id}/preview.svg`}
                        alt={`Preview of ${entry.name}`}
                        loading="lazy"
                      />
                    </span>
                    <span className="gallery-tile-copy">
                      <span className="gallery-tile-name">
                        {entry.name}
                        {entry.netlistable ? (
                          <span
                            className="gallery-tile-star"
                            data-testid={`gallery-star-${entry.id}`}
                            title="Extracts to a SPICE netlist"
                            aria-label="Extracts to a SPICE netlist"
                          >
                            ★
                          </span>
                        ) : null}
                      </span>
                      <span className="gallery-tile-meta">
                        {entry.author ? (
                          <>
                            <button
                              type="button"
                              className="gallery-tile-author"
                              data-testid={`gallery-author-${entry.id}`}
                              title={`Show circuits by ${entry.author}`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                selectAuthor(entry.author);
                              }}
                            >
                              {entry.author}
                            </button>
                            {" · "}
                          </>
                        ) : null}
                        {savedAtLabel(entry.createdAt)}
                        {" · "}
                        <button
                          type="button"
                          className="gallery-tile-like"
                          data-testid={`gallery-like-${entry.id}`}
                          aria-pressed={entry.likedByViewer === true}
                          title={
                            entry.likedByViewer
                              ? "Remove your like"
                              : "Like this circuit"
                          }
                          aria-label={
                            entry.likedByViewer
                              ? `Remove your like from ${entry.name}`
                              : `Like ${entry.name}`
                          }
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void toggleLike(entry.id);
                          }}
                        >
                          <HeartIcon filled={entry.likedByViewer === true} />
                          {entry.likes ?? 0}
                        </button>
                      </span>
                      {entry.description ? (
                        <span className="gallery-tile-description">
                          {entry.description}
                        </span>
                      ) : null}
                      {entry.tags && entry.tags.length > 0 ? (
                        <span className="gallery-tile-tags">
                          {entry.tags.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              className="gallery-tile-tag"
                              data-testid={`gallery-tile-tag-${entry.id}-${tag.replace(/\s/gu, "-")}`}
                              title={`Filter by ${tag}`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (!selectedTags.includes(tag)) toggleTag(tag);
                              }}
                            >
                              {tag}
                            </button>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </a>
                ),
              })),
              ...(entries.length === 0 && author === null
                ? bundledTiles().map((tile) => ({
                    key: `bundled-${tile.id}`,
                    node: (
                      <a
                        className="gallery-tile gallery-tile-bundled"
                        href={`/editor?example=${tile.id}`}
                        data-testid={`gallery-bundled-${tile.id}`}
                      >
                        <span
                          className="gallery-tile-preview"
                          // Server-free preview: our own renderer's escaped SVG output.
                          dangerouslySetInnerHTML={{ __html: tile.svg }}
                        />
                        <span className="gallery-tile-copy">
                          <span className="gallery-tile-kicker">
                            Built-in example
                          </span>
                          <span className="gallery-tile-name">{tile.name}</span>
                          <span className="gallery-tile-description">
                            {tile.description}
                          </span>
                        </span>
                      </a>
                    ),
                  }))
                : []),
            ]}
          />
          {entries.length === 0 && author !== null ? (
            <p className="gallery-status" data-testid="gallery-filter-empty">
              No public circuits by {author} yet.
            </p>
          ) : null}
        </section>
      )}
      <div
        ref={sentinelRef}
        className="gallery-sentinel"
        data-testid="gallery-sentinel"
        aria-hidden="true"
      />
      <footer className="gallery-footnote">
        Browse freely; open any circuit and edit your own copy. Publishing joins
        in a later release with sign-in.
      </footer>
    </main>
  );
}
