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
  options: { cursor?: string | null; author?: string | null } = {},
): Promise<GalleryFeedPage | null> {
  const params = new URLSearchParams();
  if (options.author) params.set("author", options.author);
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
  const [state, setState] = useState<GalleryFeedState>({
    status: "loading",
    entries: [],
    nextCursor: null,
  });
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", entries: [], nextCursor: null });
    void loadGalleryFeed(fetch, { author }).then((page) => {
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
  }, [author]);

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
      void loadGalleryFeed(fetch, { author, cursor: nextCursor }).then(
        (page) => {
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
        },
      );
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, author]);

  function selectAuthor(next: string | null): void {
    setAuthor(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("author", next);
    else url.searchParams.delete("author");
    window.history.replaceState(null, "", url.pathname + url.search);
  }

  const entries = state.entries;

  return (
    <main className="gallery-shell" data-testid="gallery-feed">
      <GalleryChrome subtitle="Community gallery" />

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
                      <span className="gallery-tile-name">{entry.name}</span>
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
                      </span>
                      {entry.description ? (
                        <span className="gallery-tile-description">
                          {entry.description}
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
