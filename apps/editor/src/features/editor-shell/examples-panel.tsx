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
  loadGalleryTags,
  subscribeGalleryRefresh,
  type GalleryFeedEntry,
  type GalleryTagOption,
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
  options: { searchQuery: string; selectedTags: readonly string[] },
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
          filtered: options.selectedTags.length > 0,
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
 * layer, so paging, search and tag filtering behave identically in both
 * places. Only the presentation differs: the panel is narrow, so its tags live
 * in a menu rather than a chip row.
 */
export function ExamplesPanel({
  open,
  onOpenGalleryExample,
  onOpenExample,
  fetchImpl,
}: ExamplesPanelProps) {
  const fetcher = fetchImpl ?? fetch;
  const [feed, setFeed] = useState<FeedState>(EMPTY_FEED);
  const [tagOptions, setTagOptions] = useState<GalleryTagOption[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadGalleryTags(fetcher).then((tags) => {
      if (!cancelled) setTagOptions(tags);
    });
    return () => {
      cancelled = true;
    };
  }, [open, fetcher, refreshSignal]);

  // The first page for the current server-side filter. A changed tag selection
  // is a new query, not more of the old one, so the list restarts.
  useEffect(() => {
    if (!open) return;
    const generation = ++loadGenerationRef.current;
    setFeed(EMPTY_FEED);
    void loadGalleryFeed(fetcher, { tags: selectedTags }).then((page) => {
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
  }, [open, fetcher, selectedTags, refreshSignal]);

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
      void loadGalleryFeed(fetcher, { cursor, tags: selectedTags })
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
  }, [open, fetcher, feed.nextCursor, selectedTags]);

  const bundledPreviews = useMemo(
    () =>
      new Map(
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
      ),
    [],
  );

  const { showGallery, visibleEntries, countLabel, emptyMessage } =
    deriveGalleryPanelView(feed, { searchQuery, selectedTags });
  const exhausted = feed.nextCursor === null;

  function toggleTag(tag: string): void {
    setSelectedTags((previous) =>
      previous.includes(tag)
        ? previous.filter((candidate) => candidate !== tag)
        : [...previous, tag],
    );
  }

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
              placeholder="Name, author, tag…"
              aria-label="Search circuits"
              data-testid="examples-panel-search"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {tagOptions.length > 0 ? (
              <div className="examples-panel-tag-menu">
                <button
                  type="button"
                  className="examples-panel-tag-toggle"
                  aria-expanded={tagMenuOpen}
                  data-testid="examples-panel-tag-toggle"
                  onClick={() => setTagMenuOpen((previous) => !previous)}
                >
                  {selectedTags.length > 0
                    ? `Tags (${selectedTags.length})`
                    : "Tags"}
                </button>
                {tagMenuOpen ? (
                  <div
                    className="examples-panel-tag-options"
                    role="group"
                    aria-label="Filter by tag"
                    data-testid="examples-panel-tag-options"
                  >
                    {tagOptions.map((option) => (
                      <label
                        key={option.tag}
                        className="examples-panel-tag-option"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTags.includes(option.tag)}
                          data-testid={`examples-panel-tag-${option.tag}`}
                          onChange={() => toggleTag(option.tag)}
                        />
                        <span>{option.tag}</span>
                        <span className="examples-panel-tag-count">
                          {option.count}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
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
