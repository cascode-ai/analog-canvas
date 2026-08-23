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
}

export interface GalleryFeedState {
  status: "loading" | "ready" | "unavailable";
  entries: GalleryFeedEntry[];
  nextCursor: string | null;
}

const resolver = new InMemorySymbolResolver(builtInSymbols);

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
  } = {},
): Promise<GalleryFeedPage | null> {
  const params = new URLSearchParams();
  if (options.author) params.set("author", options.author);
  if (options.tags && options.tags.length > 0) {
    params.set("tags", options.tags.join(","));
  }
  if (options.cursor) params.set("cursor", options.cursor);
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
    };
    return {
      entries: payload.entries ?? [],
      nextCursor:
        typeof payload.nextCursor === "string" ? payload.nextCursor : null,
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
  const [state, setState] = useState<GalleryFeedState>({
    status: "loading",
    entries: [],
    nextCursor: null,
  });
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
    setState({ status: "loading", entries: [], nextCursor: null });
    void loadGalleryFeed(fetch, { author, tags: selectedTags }).then((page) => {
      if (cancelled) return;
      setState(
        page
          ? { status: "ready", ...page }
          : { status: "unavailable", entries: [], nextCursor: null },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [author, selectedTags]);

  // Infinite scroll: while a cursor remains, the sentinel below the wall
  // appends the next page whenever it scrolls into view.
  const nextCursor = state.nextCursor;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || nextCursor === null) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((observed) => {
      if (!observed.some((entry) => entry.isIntersecting)) return;
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      void loadGalleryFeed(fetch, {
        author,
        tags: selectedTags,
        cursor: nextCursor,
      }).then((page) => {
        loadingMoreRef.current = false;
        if (!page) return;
        setState((previous) =>
          previous.status === "ready"
            ? {
                status: "ready",
                entries: [...previous.entries, ...page.entries],
                nextCursor: page.nextCursor,
              }
            : previous,
        );
      });
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, author, selectedTags]);

  function syncQuery(nextAuthor: string | null, nextTags: string[]): void {
    const url = new URL(window.location.href);
    if (nextAuthor) url.searchParams.set("author", nextAuthor);
    else url.searchParams.delete("author");
    if (nextTags.length > 0) url.searchParams.set("tags", nextTags.join(","));
    else url.searchParams.delete("tags");
    window.history.replaceState(null, "", url.pathname + url.search);
  }

  function selectAuthor(next: string | null): void {
    setAuthor(next);
    syncQuery(next, selectedTags);
  }

  function toggleTag(tag: string): void {
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
              ...entries.map((entry) => ({
                key: entry.id,
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
                              ? "Take back your thumbs up"
                              : "Thumbs up this circuit"
                          }
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void toggleLike(entry.id);
                          }}
                        >
                          <span aria-hidden="true">👍</span>
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
