import { lazy, Suspense, useEffect, useRef, useState } from "react";
import "./examples-panel.css";

import type { LibraryProjectExample } from "../../examples/library-examples";
import {
  galleryCountLabel,
  galleryPreviewUrl,
  GALLERY_SIGN_IN_REQUIRED,
  loadGalleryFeed,
  localhostExamplesEnabled,
  subscribeGalleryRefresh,
  type GalleryFeedEntry,
} from "../../gallery-client";
import { galleryEntryMatchesQuery } from "../../gallery-search";
import { requestSignIn } from "../../components/sign-in-request";

const ExamplesPanelTags = lazy(() =>
  import("./examples-panel-tags").then((module) => ({
    default: module.ExamplesPanelTags,
  })),
);
const LocalExamplesCards = lazy(() =>
  import("./local-examples-cards").then((module) => ({
    default: module.LocalExamplesCards,
  })),
);

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
  status: "loading" | "ready" | "unavailable" | "signed-out";
  entries: GalleryFeedEntry[];
  nextCursor: string | null;
  total: number | null;
  /** The search the server answered for these entries; "" for none. */
  search?: string;
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
  feed: Pick<
    FeedState,
    "status" | "entries" | "nextCursor" | "total" | "search"
  >,
  options: { searchQuery: string; selectedTags?: readonly string[] },
): GalleryPanelView {
  const normalizedQuery = options.searchQuery.trim().toLowerCase();
  const selectedTags = options.selectedTags ?? [];
  // The server answered this search over the whole Gallery: its total is
  // the matches and nothing older is left to read.
  const answered =
    !!normalizedQuery && feed.search === options.searchQuery.trim();
  const showGallery =
    feed.status === "ready" && (feed.entries.length > 0 || answered);
  const filtering = (!!normalizedQuery && !answered) || selectedTags.length > 0;
  const visibleEntries = feed.entries.filter(
    (entry) =>
      (!normalizedQuery || galleryEntryMatchesQuery(entry, normalizedQuery)) &&
      (!selectedTags.length ||
        selectedTags.some((tag) => entry.tags?.includes(tag))),
  );
  const exhausted = feed.nextCursor === null;
  return {
    showGallery,
    visibleEntries,
    countLabel: showGallery
      ? galleryCountLabel(feed.total, {
          searched: answered && !selectedTags.length,
          search: filtering
            ? { visible: visibleEntries.length, settled: exhausted }
            : null,
        })
      : null,
    emptyMessage:
      showGallery && (filtering || answered) && visibleEntries.length === 0
        ? exhausted || (answered && !selectedTags.length)
          ? selectedTags.length
            ? "No circuits match these filters."
            : `No circuits match “${options.searchQuery.trim()}”.`
          : "No matches yet — searching older circuits…"
        : null,
  };
}

/**
 * Insert from Gallery, docked beside the canvas: Gallery circuits to place in
 * this drawing. Browsing the Gallery itself is the header's Gallery; the
 * panel links there. Every card carries a preview of the circuit itself: a
 * name and a sentence do not tell you whether a circuit is the one you want
 * to borrow from.
 *
 * It reads the same feed as the Gallery wall through the same shared data
 * layer, so paging and free-text search behave identically in both places.
 * Search is always available; the shared tag tree takes one column only when
 * the dock is wide enough for more than three circuit columns.
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
  const searchTextRef = useRef("");
  searchTextRef.current = searchQuery.trim();
  // The same server search as the Gallery wall, asked a moment after typing.
  const [serverSearch, setServerSearch] = useState("");
  useEffect(() => {
    const next = searchQuery.trim();
    if (next === serverSearch) return;
    const handle = window.setTimeout(() => setServerSearch(next), 250);
    return () => window.clearTimeout(handle);
  }, [searchQuery, serverSearch]);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const loadGenerationRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    return subscribeGalleryRefresh(() => {
      setRefreshSignal((previous) => previous + 1);
    });
  }, [open]);

  // The first page of the current Gallery, or of the circuits a search
  // finds: the server searches the whole Gallery before it pages.
  useEffect(() => {
    if (!open) return;
    const generation = ++loadGenerationRef.current;
    setFeed(EMPTY_FEED);
    const query = serverSearch ? { q: serverSearch } : {};
    void loadGalleryFeed(fetcher, query).then((page) => {
      if (generation !== loadGenerationRef.current) return;
      setFeed(
        page === GALLERY_SIGN_IN_REQUIRED
          ? { ...EMPTY_FEED, status: "signed-out" }
          : page === null
            ? { ...EMPTY_FEED, status: "unavailable" }
            : {
                status: "ready",
                entries: page.entries,
                nextCursor: page.nextCursor,
                total: page.total,
                // Only a server that says it searched has answered it.
                search: page.search ?? "",
              },
      );
    });
  }, [open, fetcher, refreshSignal, serverSearch]);

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
      // Words the server has not been asked yet: it answers them whole.
      if (searchTextRef.current !== serverSearch) return;
      loadingMoreRef.current = true;
      const generation = loadGenerationRef.current;
      void loadGalleryFeed(fetcher, {
        ...(serverSearch ? { q: serverSearch } : {}),
        cursor,
      })
        .then((page) => {
          if (
            page === null ||
            page === GALLERY_SIGN_IN_REQUIRED ||
            generation !== loadGenerationRef.current
          )
            return;
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
  }, [open, fetcher, feed.nextCursor, serverSearch]);

  const { showGallery, visibleEntries, countLabel, emptyMessage } =
    deriveGalleryPanelView(feed, { searchQuery, selectedTags });
  const exhausted = feed.nextCursor === null;

  return (
    <aside
      id="examples-panel"
      className={
        open ? "shapes-panel examples-panel" : "shapes-panel collapsed"
      }
      aria-label="Insert from Gallery"
      aria-hidden={!open}
      inert={!open ? true : undefined}
      data-testid="examples-panel"
      data-open={open ? "true" : "false"}
    >
      <div className="shapes-panel-body">
        <div className="examples-panel-header">
          <h2 className="examples-panel-title">Insert from Gallery</h2>
          <a
            className="examples-panel-open-gallery"
            href="/"
            target="_blank"
            rel="noopener"
            data-testid="examples-panel-open-gallery"
            title="Open the Community Gallery in a new tab"
          >
            Open Gallery ↗
          </a>
        </div>
        {showGallery ? (
          <div className="examples-panel-controls">
            <input
              autoComplete="off"
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
            {selectedTags.length ? (
              <button
                type="button"
                className="examples-panel-clear-tags"
                data-testid="examples-panel-clear-tags"
                onClick={() => setSelectedTags([])}
                aria-label={`Clear ${selectedTags.length} selected tags`}
              >
                Tags · {selectedTags.length} ×
              </button>
            ) : null}
          </div>
        ) : null}
        <div
          className="examples-panel-browser"
          data-tags-available={showGallery}
        >
          {showGallery ? (
            <aside
              className="examples-panel-tags"
              aria-label="Gallery tags"
              data-testid="examples-panel-tags"
            >
              <h2>Tags</h2>
              <Suspense fallback={null}>
                <ExamplesPanelTags
                  fetcher={fetcher}
                  open={open}
                  refreshSignal={refreshSignal}
                  selected={selectedTags}
                  onChange={setSelectedTags}
                />
              </Suspense>
            </aside>
          ) : null}
          <div className="examples-panel-results">
            {/* Signed out, the Gallery shows no circuit here either: grey
            stand-ins under a veil, and the way to sign in. */}
            {feed.status === "signed-out" ? (
              <div
                className="examples-panel-sign-in"
                data-testid="examples-panel-sign-in"
              >
                <div className="examples-panel-sign-in-veil" aria-hidden="true">
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <span key={index} className="examples-panel-sign-in-tile" />
                  ))}
                </div>
                <div className="examples-panel-sign-in-card">
                  <p>Sign in to insert circuits from the Gallery.</p>
                  <button
                    type="button"
                    className="examples-panel-sign-in-button"
                    data-testid="examples-panel-sign-in-button"
                    onClick={requestSignIn}
                  >
                    Sign in
                  </button>
                </div>
              </div>
            ) : null}
            {/* Columns follow the panel's dragged width, the same way the Library
            tiles do; a separate control for the same thing is one knob too
            many. */}
            <div className="shapes-example-list">
              {showGallery ? (
                visibleEntries.map((example) => (
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
                      <span className="shapes-example-name">
                        {example.name}
                      </span>
                    </span>
                  </button>
                ))
              ) : localhostExamplesEnabled() && feed.status !== "signed-out" ? (
                <Suspense fallback={null}>
                  <LocalExamplesCards onOpenExample={onOpenExample} />
                </Suspense>
              ) : null}
            </div>
            {!showGallery &&
            !localhostExamplesEnabled() &&
            feed.status !== "signed-out" ? (
              <p className="examples-panel-empty">
                {feed.status === "unavailable"
                  ? "Gallery is unavailable. Try again later."
                  : "No published circuits yet."}
              </p>
            ) : null}
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
        </div>
      </div>
    </aside>
  );
}
