import { useEffect, useMemo, useRef, useState } from "react";

import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import {
  libraryProjectExamples,
  type LibraryProjectExample,
} from "../../examples/library-examples";
import {
  galleryCountLabel,
  galleryEntryMatchesQuery,
  galleryPreviewUrl,
  loadGalleryFeed,
  subscribeGalleryRefresh,
  type GalleryFeedEntry,
} from "../../gallery-client";

export interface GalleryExampleSummary {
  id: string;
  name: string;
  author: string;
  description: string;
  previewRevision?: string;
}

export interface ExamplesPanelProps {
  open: boolean;
  onOpenGalleryExample?(id: string): void;
  onOpenExample(example: LibraryProjectExample): void;
  /** Injected in tests; production uses the global. */
  fetchImpl?: typeof fetch;
}

interface FeedState {
  status: "loading" | "ready" | "unavailable";
  entries: GalleryFeedEntry[];
  nextCursor: string | null;
  total: number | null;
}

const EMPTY_FEED: FeedState = {
  status: "loading",
  entries: [],
  nextCursor: null,
  total: null,
};

export interface GalleryPanelView {
  /** False while the feed is loading or unreachable: bundled circuits stand in. */
  showGallery: boolean;
  visibleEntries: GalleryFeedEntry[];
  /** Null when the server has not said the size; never a guess. */
  countLabel: string | null;
  /**
   * Null unless a query hides every loaded circuit. While pages remain it says
   * the search is still running, because a wall paged 30 at a time cannot yet
   * deny a circuit it has not fetched.
   */
  emptyMessage: string | null;
}

/**
 * Everything the panel shows, derived from the feed and the two filters. It is
 * a pure function so the panel's behaviour can be asserted against the same
 * rule table as the Gallery wall — the two surfaces share their matcher and
 * their count wording, and this is where that sharing is proved rather than
 * assumed.
 */
export function deriveGalleryPanelView(
  feed: Pick<FeedState, "status" | "entries" | "nextCursor" | "total">,
  options: { searchQuery: string },
): GalleryPanelView {
  const normalizedQuery = options.searchQuery.trim().toLowerCase();
  const showGallery = feed.status === "ready" && feed.entries.length > 0;
  const visibleEntries = normalizedQuery
    ? feed.entries.filter((entry) =>
        galleryEntryMatchesQuery(entry, normalizedQuery),
      )
    : feed.entries;
  const exhausted = feed.nextCursor === null;
  return {
    showGallery,
    visibleEntries,
    countLabel: showGallery
      ? galleryCountLabel(feed.total, {
          search: normalizedQuery
            ? { visible: visibleEntries.length, settled: exhausted }
            : null,
        })
      : null,
    emptyMessage:
      showGallery && normalizedQuery && visibleEntries.length === 0
        ? exhausted
          ? `No circuits match “${options.searchQuery.trim()}”.`
          : "No matches yet — searching older circuits…"
        : null,
  };
}

/**
 * The circuit gallery, docked beside the canvas. Every card carries a preview
 * of the circuit itself: a name and a sentence do not tell you whether a
 * circuit is the one you want to borrow from.
 *
 * It reads the same feed as the Gallery wall through the same shared data
 * layer, so paging and free-text search behave identically in both places.
 * The dock is intentionally search-only: its narrow width cannot present the
 * Gallery wall's complete tag navigation legibly, while the shared search
 * already reaches entry tags.
 */
export function ExamplesPanel({
  open,
  onOpenGalleryExample,
  onOpenExample,
  fetchImpl,
}: ExamplesPanelProps) {
  const fetcher = fetchImpl ?? fetch;
  const [feed, setFeed] = useState<FeedState>(EMPTY_FEED);
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshSignal, setRefreshSignal] = useState(0);
  const loadGenerationRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    return subscribeGalleryRefresh(() => {
      setRefreshSignal((previous) => previous + 1);
    });
  }, [open]);

  // The first page of the current Gallery. Text search is local over loaded
  // entries, so opening the dock or a Gallery refresh is the only restart.
  useEffect(() => {
    if (!open) return;
    const generation = ++loadGenerationRef.current;
    setFeed(EMPTY_FEED);
    void loadGalleryFeed(fetcher).then((page) => {
      if (generation !== loadGenerationRef.current) return;
      setFeed(
        page === null
          ? { ...EMPTY_FEED, status: "unavailable" }
          : {
              status: "ready",
              entries: page.entries,
              nextCursor: page.nextCursor,
              total: page.total,
            },
      );
    });
  }, [open, fetcher, refreshSignal]);

  // More pages arrive as the sentinel comes into view. A filtered list stays
  // short, so the sentinel keeps showing and the feed keeps arriving until it
  // is exhausted — which is what lets the empty state below tell the truth.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!open || !sentinel || feed.nextCursor === null) return;
    if (typeof IntersectionObserver === "undefined") return;
    const cursor = feed.nextCursor;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      const generation = loadGenerationRef.current;
      void loadGalleryFeed(fetcher, { cursor })
        .then((page) => {
          if (page === null || generation !== loadGenerationRef.current) return;
          setFeed((previous) => ({
            ...previous,
            entries: [...previous.entries, ...page.entries],
            nextCursor: page.nextCursor,
            total: page.total ?? previous.total,
          }));
        })
        .finally(() => {
          loadingMoreRef.current = false;
        });
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open, fetcher, feed.nextCursor]);

  const { showGallery, visibleEntries, countLabel, emptyMessage } =
    deriveGalleryPanelView(feed, { searchQuery });
  const previewCache = useRef<Map<string, string> | null>(null);
  const bundledPreviews = useMemo(() => {
    if (!open || showGallery) return new Map<string, string>();
    if (previewCache.current) return previewCache.current;
    return (previewCache.current = new Map(
      libraryProjectExamples.map((example) => {
        const topDocument = example.project.documents.find(
          (candidate) => candidate.id === example.project.topDocumentId,
        )!;
        // A Cell instance draws with artwork derived from the Project, not
        // from the built-in library, so the preview needs the same
        // Project-aware resolver the canvas uses.
        return [
          example.id,
          renderDocumentSvg(
            topDocument,
            createProjectSymbolResolver(example.project, builtInSymbols),
          ),
        ];
      }),
    ));
  }, [open, showGallery]);
  const exhausted = feed.nextCursor === null;

  return (
    <aside
      id="examples-panel"
      className={
        open ? "shapes-panel examples-panel" : "shapes-panel collapsed"
      }
      aria-label="Gallery"
      aria-hidden={!open}
      inert={!open ? true : undefined}
      data-testid="examples-panel"
      data-open={open ? "true" : "false"}
    >
      <div className="shapes-panel-body">
        {showGallery ? (
          <div className="examples-panel-controls">
            <input
              type="search"
              className="examples-panel-search"
              value={searchQuery}
              placeholder="Search Gallery…"
              aria-label="Search circuits"
              data-testid="examples-panel-search"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {countLabel ? (
              <span
                className="examples-panel-count"
                data-testid="examples-panel-count"
              >
                {countLabel}
              </span>
            ) : null}
          </div>
        ) : null}
        {/* Columns follow the panel's dragged width, the same way the Library
            tiles do; a separate control for the same thing is one knob too
            many. */}
        <div className="shapes-example-list">
          {showGallery
            ? visibleEntries.map((example) => (
                <button
                  key={example.id}
                  type="button"
                  className="shapes-example-card"
                  data-testid={`gallery-example-${example.id}`}
                  aria-label={`Insert gallery circuit ${example.name}`}
                  title={`Insert ${example.name}`}
                  onClick={() => onOpenGalleryExample?.(example.id)}
                >
                  <span className="shapes-example-preview">
                    <img
                      src={galleryPreviewUrl(
                        example.id,
                        example.previewRevision,
                      )}
                      alt=""
                      loading="lazy"
                    />
                  </span>
                  <span className="shapes-example-copy">
                    <span className="shapes-example-kicker">
                      {example.author || "Gallery"}
                    </span>
                    <span className="shapes-example-name">{example.name}</span>
                  </span>
                </button>
              ))
            : libraryProjectExamples.map((example) => (
                <button
                  key={example.id}
                  type="button"
                  className="shapes-example-card"
                  data-testid={`shapes-example-${example.id}`}
                  aria-label={`Insert example ${example.name}`}
                  title={`Insert ${example.name}`}
                  onClick={() => onOpenExample(example)}
                >
                  <span
                    className="shapes-example-preview"
                    // Server-free preview: our own renderer's escaped output.
                    dangerouslySetInnerHTML={{
                      __html: bundledPreviews.get(example.id) ?? "",
                    }}
                  />
                  <span className="shapes-example-copy">
                    <span className="shapes-example-kicker">Example</span>
                    <span className="shapes-example-name">{example.name}</span>
                  </span>
                </button>
              ))}
        </div>
        {/* Says "still looking" while pages remain, and only claims nothing
            matches once the feed is exhausted — a wall of 120 circuits paged
            30 at a time would otherwise deny a circuit that is simply not
            loaded yet. */}
        {emptyMessage ? (
          <p
            className="examples-panel-empty"
            data-testid="examples-panel-empty"
          >
            {emptyMessage}
          </p>
        ) : null}
        {showGallery && !exhausted ? (
          <div
            ref={sentinelRef}
            className="examples-panel-sentinel"
            data-testid="examples-panel-sentinel"
            aria-hidden="true"
          />
        ) : null}
      </div>
    </aside>
  );
}
