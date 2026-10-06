import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { TilePreview } from "./tile-preview";
import "../styles/gallery-entry.css";

import {
  announceGalleryChange,
  galleryCountLabel,
  galleryAuthorsOf,
  removeGalleryAuthorEntry,
  galleryFeedQueryKey,
  galleryPreviewUrl,
  loadGalleryEntry,
  loadGalleryFeed,
  galleryTagScope,
  GALLERY_SIGN_IN_REQUIRED,
  loadGalleryTagSummary,
  loadGalleryTags,
  localhostExamplesEnabled,
  subscribeGalleryRefresh,
  type GalleryAuthorOption,
  type GalleryFeedEntry,
  type GalleryFeedPage,
  type GalleryFeedQuery,
  type GalleryFeedState,
  type GalleryTagOption,
  type GalleryLandingPreload,
  withLoadedTail,
} from "../gallery-client";
import { galleryEntryMatchesQuery } from "../gallery-search";
import {
  GALLERY_FILTERS_KEY,
  createDefaultGalleryFilters,
  galleryFilterSearch,
  galleryFiltersNarrowQuery,
  resolveGalleryFilters,
  type GalleryFilterState,
} from "../gallery-filters";
import {
  galleryFocusEntryId,
  galleryFocusPlacement,
  withoutGalleryFocus,
} from "../gallery-focus";
import {
  GALLERY_COMPONENT_RANGES,
  galleryComponentRangeOf,
} from "../gallery-component-ranges";
import type { BundledGalleryTile } from "./gallery-bundled-fallback";
import { galleryTagLabel } from "../gallery-tag-label";
import {
  GALLERY_ISSUE_KINDS,
  galleryIssueKindLabel,
} from "../gallery-issue-kinds";

// The wall and the canvas-side panel share one data layer, so a search that
// finds a circuit here finds it there too. These re-exports keep every
// existing importer of this module working unchanged.
export { galleryEntryMatchesQuery } from "../gallery-search";
export {
  loadGalleryFeed,
  loadGalleryTags,
  type GalleryAuthorOption,
  type GalleryFeedEntry,
  type GalleryFeedPage,
  type GalleryFeedState,
  type GalleryTagOption,
};
import { fetchSessionUser } from "./account";
import { requestSignIn } from "./sign-in-request";
import { GalleryChrome } from "./gallery-chrome";
import { GalleryTagSidebar } from "./gallery-tag-sidebar";
import { Masonry } from "./masonry";
import type { GalleryDuplicateReport } from "../gallery-duplicates";

/**
 * Heights of the grey stand-in tiles behind the sign-in invitation. Signed
 * out, the Gallery shows no circuit at all, only the shape of its wall.
 */
const SIGNED_OUT_TILE_HEIGHTS = [
  190, 250, 160, 220, 270, 180, 240, 200, 160, 260, 210, 180,
];

const ShelfWall = lazy(() =>
  import("./shelf-wall").then((module) => ({ default: module.ShelfWall })),
);
const GalleryReviewDialog = lazy(() =>
  import("./gallery-attention-review").then((module) => ({
    default: module.GalleryReviewDialog,
  })),
);
const GalleryDuplicateCheck = lazy(() =>
  import("./gallery-duplicate-check").then((module) => ({
    default: module.GalleryDuplicateCheck,
  })),
);

const GalleryTileMenu = lazy(() =>
  import("./gallery-owner-controls").then((module) => ({
    default: module.GalleryTileMenu,
  })),
);
const GalleryOwnerRejectButton = lazy(() =>
  import("./gallery-owner-controls").then((module) => ({
    default: module.GalleryOwnerRejectButton,
  })),
);
const RejectEntryDialog = lazy(() =>
  import("./gallery-owner-controls").then((module) => ({
    default: module.RejectEntryDialog,
  })),
);

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

/**
 * The netlist mark, drawn rather than typed.
 *
 * A star said "rating" on a wall of circuits and sat beside the like heart,
 * where two accents competed for the same meaning. This says what it marks:
 * the SPICE deck this circuit extracts to. Absence is not a verdict — a
 * sketch publishes exactly the same way — so the mark is quiet and only ever
 * appears, never crosses anything out.
 */
function NetlistIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4.5" y="3" width="15" height="18" rx="2.5" />
      <path d="M8 8.5h8M8 12.5h8M8 16.5h5" />
    </svg>
  );
}

/**
 * One search string against one circuit. The query arrives normalized
 * (trimmed, lowercased); fields answer case-insensitively. A tag counts as
 * content, so a query matching a tag matches the circuits that carry it.
 */
/**
 * The wall's size, said only when the server has said it: a pre-totals API
 * or a still-loading feed renders nothing rather than a guess. "Filtered"
 * names the server-side narrowing; "match" belongs to the text query, whose
 * clause counts VISIBLE tiles (true at every instant by construction) and
 * says "so far" until the feed is exhausted.
 */
function contributionLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "circuit" : "circuits"}`;
}

function GalleryContributorRow({
  option,
  rank,
  partial,
  onSelectAuthor,
}: {
  option: GalleryAuthorOption;
  rank: number;
  partial: boolean;
  onSelectAuthor: (option: GalleryAuthorOption) => void;
}) {
  return (
    <li
      className="gallery-contributor-row"
      data-testid={`gallery-contributor-row-${rank}`}
    >
      <span className="gallery-contributor-rank">{rank}</span>
      <button
        type="button"
        className="gallery-contributor-author"
        data-testid={`gallery-contributor-author-${rank}`}
        aria-label={`View ${option.author}'s gallery`}
        onClick={() => onSelectAuthor(option)}
      >
        {option.author}
      </button>
      <span className="gallery-contributor-count">
        {contributionLabel(option.count)}
        {partial ? " so far" : ""}
      </span>
    </li>
  );
}

/**
 * A search reads the wall page by page in this browser; this says how far it
 * has read, so a short list is never mistaken for the answer.
 */
function GallerySearchProgress({
  checked,
  total,
  matches,
  settled,
}: {
  checked: number;
  total: number | null;
  matches: number;
  settled: boolean;
}) {
  const of = total ?? checked;
  const found = `${matches.toLocaleString()} ${matches === 1 ? "match" : "matches"}`;
  return (
    <div
      className="gallery-search-progress"
      role="status"
      data-testid="gallery-search-progress"
      data-settled={settled}
    >
      <span>
        {settled
          ? `Searched all ${of.toLocaleString()} circuits · ${found}`
          : `Searching… ${checked.toLocaleString()} / ${of.toLocaleString()} circuits checked · ${found} so far`}
      </span>
      {settled ? null : (
        <progress value={checked} max={Math.max(of, checked, 1)} />
      )}
    </div>
  );
}

export function GalleryCountPanel({
  total,
  filtered = false,
  searched = false,
  search = null,
  authors = [],
  partial = false,
  author = null,
  onSelectAuthor = () => undefined,
  onShowAllAuthors = () => undefined,
}: {
  total: number | null;
  filtered?: boolean;
  searched?: boolean;
  search?: { visible: number; settled: boolean } | null;
  authors?: GalleryAuthorOption[];
  partial?: boolean;
  /** The byline the wall is narrowed to, if any. */
  author?: string | null;
  onSelectAuthor?: (option: GalleryAuthorOption) => void;
  onShowAllAuthors?: () => void;
}) {
  const label = galleryCountLabel(total, { filtered, search, searched });
  const rootRef = useRef<HTMLDetailsElement | null>(null);
  if (label === null) return null;
  return (
    <details
      ref={rootRef}
      className="gallery-contributor-menu"
      data-testid="gallery-contributor-menu"
    >
      <summary
        className="gallery-count-panel"
        data-testid="gallery-count-panel"
        aria-label={`${label}. Show contributor leaderboard`}
      >
        <span className="gallery-count-label">{label}</span>
      </summary>
      <div
        className="gallery-contributor-popover"
        data-testid="gallery-contributor-popover"
      >
        <div className="gallery-contributor-heading">
          <strong>Contributors</strong>
          <span>
            {authors.length.toLocaleString()}{" "}
            {authors.length === 1 ? "author" : "authors"}
            {partial ? " so far" : ""}
          </span>
        </div>
        {author ? (
          // Narrowed to one byline, the board lists only that author; the
          // way back to everyone sits where readers look for the others.
          <div className="gallery-contributor-status">
            <p>Circuits by {author}</p>
            <button
              type="button"
              data-testid="gallery-contributor-all"
              onClick={() => {
                rootRef.current?.removeAttribute("open");
                onShowAllAuthors();
              }}
            >
              All authors
            </button>
          </div>
        ) : null}
        {authors.length === 0 ? (
          <p className="gallery-contributor-status">
            {partial
              ? "No matching contributors in circuits loaded so far."
              : "No contributors match the current filters."}
          </p>
        ) : (
          <ol className="gallery-contributor-list">
            {authors.map((option, index) => (
              <GalleryContributorRow
                key={`${option.ownerUserId ?? "legacy"}:${option.author}`}
                option={option}
                rank={index + 1}
                partial={partial}
                onSelectAuthor={(option) => {
                  rootRef.current?.removeAttribute("open");
                  onSelectAuthor(option);
                }}
              />
            ))}
          </ol>
        )}
      </div>
    </details>
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

/**
 * The eager landing request is one-use: the wall takes it only for its first
 * load, and only when it asks exactly the query the preload asked (an older
 * preload with no recorded query asked the unfiltered wall). Never replay it
 * after the reader changes the wall query or the wall refreshes.
 */
export function canReuseGalleryLandingFeed(
  refreshSignal: number,
  loadedQuery: string | null,
  preloadedQuery: string | undefined,
  query: GalleryFeedQuery,
): boolean {
  return (
    refreshSignal === 0 &&
    loadedQuery === null &&
    (preloadedQuery ?? "") === galleryFeedQueryKey(query)
  );
}

/** Every attention reason with its name, for the lazy review dialog. */
const GALLERY_ATTENTION_REASONS = GALLERY_ISSUE_KINDS.map((kind) => ({
  kind,
  label: galleryIssueKindLabel(kind),
}));

/** Entries still needing attention, per reason they carry. */
/** Circuits per part-count size, over what has loaded. */
function countComponentRanges(
  entries: readonly GalleryFeedEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.componentCount === undefined) continue;
    const key = galleryComponentRangeOf(entry.componentCount);
    if (key) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countAttentionKinds(
  entries: readonly GalleryFeedEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.attention?.status !== "needs-attention") continue;
    for (const kind of new Set(entry.attention.issues.map((i) => i.kind)))
      counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

/** The reason counts once one entry has left the wall. */
function attentionKindsWithout(
  counts: Record<string, number> | undefined,
  entry: GalleryFeedEntry,
  removed: boolean,
): { attentionKinds?: Record<string, number> } {
  if (!counts) return {};
  if (!removed || entry.attention?.status !== "needs-attention")
    return { attentionKinds: counts };
  const next = { ...counts };
  for (const kind of new Set(entry.attention.issues.map((i) => i.kind)))
    if (next[kind]) next[kind] -= 1;
  return { attentionKinds: next };
}

/** One feed page; the plain first request stays exactly `/api/gallery`. */
/**
 * Full-screen landing feed: every tile is one published circuit that opens
 * in the editor at `/g/<id>`. Bundled Library examples fill the wall while
 * the community gallery is empty or unreachable (development hosts have no
 * worker), so the landing page is never blank.
 */
export function GalleryFeed({
  visitStats,
  preload,
}: {
  visitStats?: { pv: number; uv: number } | null | undefined;
  preload?: GalleryLandingPreload;
}) {
  // Which wall, whose circuits, which tags, which words, which marks: one
  // state, because a reader changes them for one reason. It rides in the URL
  // so a link and the Back button carry the same slice, and in browser
  // storage so opening a circuit and coming back does not widen the wall.
  const [filters, setFilters] = useState<GalleryFilterState>(() => {
    if (typeof window === "undefined") return createDefaultGalleryFilters();
    try {
      return resolveGalleryFilters(
        window.location.search,
        window.localStorage.getItem(GALLERY_FILTERS_KEY),
      );
    } catch {
      // Private-mode storage throws on read; the link still decides.
      return resolveGalleryFilters(window.location.search, null);
    }
  });
  const {
    view,
    author,
    ownerUserId,
    tags: selectedTags,
    search: searchQuery,
    netlistable: netlistableOnly,
    liked: likedOnly,
    attention: attentionOnly,
    attentionKind,
    parts: selectedParts,
  } = filters;
  function updateFilters(patch: Partial<GalleryFilterState>): void {
    setFilters((previous) => ({ ...previous, ...patch }));
  }
  // The server answers a search over the whole Gallery. Typing waits a
  // moment before asking it, and the wall narrows what it has meanwhile.
  const [serverSearch, setServerSearch] = useState(() => searchQuery.trim());
  useEffect(() => {
    const next = searchQuery.trim();
    if (next === serverSearch) return;
    const handle = window.setTimeout(() => setServerSearch(next), 250);
    return () => window.clearTimeout(handle);
  }, [searchQuery, serverSearch]);
  // One query for the first page, every later page and the landing preload.
  const feedQuery = useMemo<GalleryFeedQuery>(
    () => ({
      author,
      ownerUserId,
      tags: selectedTags,
      netlistable: netlistableOnly,
      liked: likedOnly,
      attention: attentionOnly,
      attentionKind,
      parts: selectedParts,
      ...(serverSearch ? { q: serverSearch } : {}),
    }),
    [
      author,
      ownerUserId,
      selectedTags,
      netlistableOnly,
      likedOnly,
      attentionOnly,
      attentionKind,
      selectedParts,
      serverSearch,
    ],
  );
  const [duplicateReport, setDuplicateReport] =
    useState<GalleryDuplicateReport | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [ownerBusy, setOwnerBusy] = useState<string | null>(null);
  const [ownerNotice, setOwnerNotice] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<GalleryFeedEntry | null>(null);
  const [reviewing, setReviewing] = useState<GalleryFeedEntry | null>(null);
  const [tagOptions, setTagOptions] = useState<
    { tag: string; count: number }[]
  >([]);
  const [tagGroupCounts, setTagGroupCounts] = useState<Record<string, number>>(
    {},
  );
  // Which wall filters the shown tag counts answer; counts for any other
  // combination show as loading rather than as stale numbers.
  const [tagCountsScope, setTagCountsScope] = useState<string | null>(null);
  const tagScope = galleryTagScope(feedQuery);
  const [refreshSignal, setRefreshSignal] = useState(0);
  // A like taken back under Liked removes its drawing from the wall without
  // reloading it; this recounts the tags beside it.
  const [tagCountsRefresh, setTagCountsRefresh] = useState(0);
  const [bundledFallback, setBundledFallback] = useState<{
    status: "idle" | "loading" | "ready" | "failed";
    tiles: BundledGalleryTile[];
  }>({ status: "idle", tiles: [] });

  // Remembered at once: a reader who narrows the wall and immediately opens a
  // circuit must come back to the same slice, so this write cannot wait.
  useEffect(() => {
    try {
      window.localStorage.setItem(GALLERY_FILTERS_KEY, JSON.stringify(filters));
    } catch {
      // The wall works without storage; only the memory of it is lost.
    }
  }, [filters]);

  const previousUrlFilters = useRef(filters);
  // Discrete choices must reach the URL immediately: on refresh an explicit
  // URL filter takes precedence over the saved preference. Only search typing
  // is debounced to avoid excessive browser history writes.
  useEffect(() => {
    const previous = previousUrlFilters.current;
    previousUrlFilters.current = filters;
    const searchOnly =
      filters.search !== previous.search &&
      (Object.keys(filters) as Array<keyof GalleryFilterState>).every(
        (key) => key === "search" || filters[key] === previous[key],
      );
    const updateAddress = () => {
      window.history.replaceState(
        null,
        "",
        window.location.pathname +
          galleryFilterSearch(window.location.search, filters),
      );
    };
    if (!searchOnly) {
      updateAddress();
      return;
    }
    const handle = window.setTimeout(updateAddress, 150);
    return () => window.clearTimeout(handle);
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    void fetchSessionUser().then((user) => {
      if (cancelled) return;
      setSignedIn(user !== null);
      setViewerId(user?.id ?? null);
      setIsOwner(user?.isAdmin === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keyed by the scope, not the query: choosing a tag changes the wall but
  // not the counts beside it.
  useEffect(() => {
    let cancelled = false;
    const request =
      refreshSignal === 0 &&
      tagCountsRefresh === 0 &&
      preload &&
      (preload.tagsScope ?? "") === tagScope
        ? preload.tags
        : loadGalleryTagSummary(fetch, feedQuery);
    void request.then((payload) => {
      if (!cancelled) {
        setTagOptions(payload.tags);
        setTagGroupCounts(
          Object.fromEntries(
            payload.groups.map(({ group, count }) => [group, count]),
          ),
        );
        setTagCountsScope(tagScope);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [preload, refreshSignal, tagCountsRefresh, tagScope]);
  const [state, setState] = useState<GalleryFeedState>({
    status: "loading",
    entries: [],
    nextCursor: null,
    total: null,
  });
  const loadingMoreRef = useRef(false);
  const firstPageLoadingRef = useRef(true);
  const feedGenerationRef = useRef(0);
  const loadedQueryRef = useRef<string | null>(null);

  useEffect(
    () =>
      subscribeGalleryRefresh((change) => {
        // Invalidate an older first-page or cursor request immediately. The
        // effect triggered below will claim a fresh generation.
        feedGenerationRef.current += 1;
        firstPageLoadingRef.current = true;
        loadingMoreRef.current = false;
        const previewRevision = change?.previewRevision;
        if (change && previewRevision !== undefined) {
          setState((previous) => ({
            ...previous,
            entries: previous.entries.map((entry) =>
              entry.id === change.entryId
                ? { ...entry, previewRevision }
                : entry,
            ),
          }));
        }
        setRefreshSignal((previous) => previous + 1);
      }),
    [],
  );

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
    setState((previous) => {
      const entry = previous.entries.find((item) => item.id === entryId);
      if (!entry) return previous;
      const liked = result.likedByViewer === true;
      const removed = likedOnly && !liked;
      return {
        ...previous,
        entries: removed
          ? previous.entries.filter((item) => item.id !== entryId)
          : previous.entries.map((item): GalleryFeedEntry =>
              item.id === entryId
                ? {
                    ...item,
                    likes: result.likes ?? item.likes ?? 0,
                    likedByViewer: liked,
                  }
                : item,
            ),
        total:
          removed && previous.total !== null
            ? previous.total - 1
            : previous.total,
        ...(removed && previous.authors
          ? { authors: removeGalleryAuthorEntry(previous.authors, entry) }
          : {}),
        ...(previous.filterCounts
          ? {
              filterCounts: {
                attention:
                  previous.filterCounts.attention -
                  Number(
                    removed && entry.attention?.status === "needs-attention",
                  ),
                netlistable:
                  previous.filterCounts.netlistable -
                  Number(removed && entry.netlistable === true),
                liked:
                  previous.filterCounts.liked +
                  Number(liked) -
                  Number(entry.likedByViewer === true),
                ...attentionKindsWithout(
                  previous.filterCounts.attentionKinds,
                  entry,
                  removed,
                ),
              },
            }
          : {}),
      };
    });
    if (likedOnly) setTagCountsRefresh((previous) => previous + 1);
    announceGalleryChange({ entryId });
  }

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const generation = ++feedGenerationRef.current;
    firstPageLoadingRef.current = true;
    loadingMoreRef.current = false;
    const queryKey = galleryFeedQueryKey(feedQuery);
    const changingQuery = loadedQueryRef.current !== queryKey;
    if (changingQuery) {
      setState({
        status: "loading",
        entries: [],
        nextCursor: null,
        total: null,
      });
    }
    const request =
      preload?.feed &&
      canReuseGalleryLandingFeed(
        refreshSignal,
        loadedQueryRef.current,
        preload.feedQuery,
        feedQuery,
      )
        ? preload.feed
        : loadGalleryFeed(fetch, feedQuery);
    void request.then((page) => {
      if (cancelled || generation !== feedGenerationRef.current) return;
      firstPageLoadingRef.current = false;
      if (page === GALLERY_SIGN_IN_REQUIRED) {
        loadedQueryRef.current = queryKey;
        setState({
          status: "signed-out",
          entries: [],
          nextCursor: null,
          total: null,
        });
      } else if (page) {
        loadedQueryRef.current = queryKey;
        // Only a server that says it searched has answered the search; any
        // other page is narrowed here, by the same rule, as it loads.
        const search = page.search ?? "";
        // The same wall refreshed (the window came back into focus, another
        // tab published) keeps the older pages it had loaded.
        setState((previous) =>
          !changingQuery && previous.status === "ready"
            ? {
                status: "ready",
                ...withLoadedTail(
                  {
                    entries: previous.entries,
                    nextCursor: previous.nextCursor,
                  },
                  page,
                ),
                search,
              }
            : { status: "ready", ...page, search },
        );
      } else if (changingQuery) {
        loadedQueryRef.current = queryKey;
        setState({
          status: "unavailable",
          entries: [],
          nextCursor: null,
          total: null,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [feedQuery, preload, refreshSignal]);

  // Appends the page after `cursor` unless a page is already on its way, and
  // says whether it started one. The sentinel calls it as the wall's end comes
  // into view; a linked circuit's search calls it until that circuit loads.
  const loadPageAfterRef = useRef<(cursor: string) => boolean>(() => false);
  loadPageAfterRef.current = (cursor: string): boolean => {
    if (firstPageLoadingRef.current) return false;
    if (loadingMoreRef.current) return false;
    // Words the server has not been asked yet: it will answer them over the
    // whole Gallery, so reading older pages for them now is wasted.
    if (searchQuery.trim() !== serverSearch) return false;
    loadingMoreRef.current = true;
    const generation = feedGenerationRef.current;
    void loadGalleryFeed(fetch, { ...feedQuery, cursor }).then((page) => {
      if (generation !== feedGenerationRef.current) return;
      loadingMoreRef.current = false;
      if (page === GALLERY_SIGN_IN_REQUIRED) {
        // The session ended while the reader scrolled.
        setState({
          status: "signed-out",
          entries: [],
          nextCursor: null,
          total: null,
        });
        return;
      }
      if (!page) return;
      setState((previous) =>
        previous.status === "ready" && previous.nextCursor === cursor
          ? {
              ...previous,
              // A linked circuit shown first stays only there when its own
              // page arrives.
              entries: [
                ...previous.entries,
                ...page.entries.filter(
                  (entry) =>
                    !previous.entries.some((shown) => shown.id === entry.id),
                ),
              ],
              nextCursor: page.nextCursor,
              total: page.total ?? previous.total,
              ...(page.authors ? { authors: page.authors } : {}),
              ...(page.filterCounts ? { filterCounts: page.filterCounts } : {}),
            }
          : previous,
      );
    });
    return true;
  };

  // The sentinel appends the next newest-first page as it comes into view.
  // Once the server returns no cursor, the wall is complete and stops.
  const { nextCursor } = state;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (nextCursor === null) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((observed) => {
      if (!observed.some((entry) => entry.isIntersecting)) return;
      loadPageAfterRef.current(nextCursor);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, feedQuery]);

  function selectAuthor(
    nextAuthor: string | null,
    nextOwnerUserId: string | null = null,
  ): void {
    updateFilters({ author: nextAuthor, ownerUserId: nextOwnerUserId });
  }

  function selectContributor(option: GalleryAuthorOption): void {
    updateFilters({
      author: option.author,
      ownerUserId: option.ownerUserId ?? null,
    });
  }

  function toggleTag(tag: string): void {
    setFilters((previous) => ({
      ...previous,
      tags: previous.tags.includes(tag)
        ? previous.tags.filter((candidate) => candidate !== tag)
        : [...previous.tags, tag],
    }));
  }

  function removeManagedEntry(entry: GalleryFeedEntry): void {
    setState((previous) => ({
      ...previous,
      entries: previous.entries.filter(
        (candidate) => candidate.id !== entry.id,
      ),
      total: previous.total === null ? null : previous.total - 1,
      ...(previous.authors
        ? { authors: removeGalleryAuthorEntry(previous.authors, entry) }
        : {}),
      ...(previous.filterCounts
        ? {
            filterCounts: {
              attention:
                previous.filterCounts.attention -
                Number(entry.attention?.status === "needs-attention"),
              netlistable:
                previous.filterCounts.netlistable -
                Number(entry.netlistable === true),
              liked:
                previous.filterCounts.liked -
                Number(entry.likedByViewer === true),
              ...attentionKindsWithout(
                previous.filterCounts.attentionKinds,
                entry,
                true,
              ),
            },
          }
        : {}),
    }));
    const removedTags = new Set(entry.tags ?? []);
    if (removedTags.size > 0) {
      setTagOptions((previous) =>
        previous
          .map((option) =>
            removedTags.has(option.tag)
              ? { ...option, count: option.count - 1 }
              : option,
          )
          .filter((option) => option.count > 0),
      );
    }
  }

  async function withdrawEntry(entry: GalleryFeedEntry): Promise<void> {
    setOwnerBusy(entry.id);
    setOwnerNotice(null);
    try {
      const response = await fetch(`/api/gallery/${entry.id}/recycle`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error();
      removeManagedEntry(entry);
      announceGalleryChange({ entryId: entry.id });
      setOwnerNotice(
        isOwner
          ? `“${entry.name}” was moved to the recycle bin.`
          : `“${entry.name}” was withdrawn. Restore it from My submissions.`,
      );
    } catch {
      setOwnerNotice(`Could not withdraw “${entry.name}”. Try again.`);
    } finally {
      setOwnerBusy(null);
    }
  }

  async function rejectEntry(reason: string): Promise<void> {
    if (!rejecting || !reason.trim()) return;
    setOwnerBusy(rejecting.id);
    setOwnerNotice(null);
    try {
      const response = await fetch(`/api/gallery/${rejecting.id}/reject`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!response.ok) throw new Error();
      removeManagedEntry(rejecting);
      announceGalleryChange({ entryId: rejecting.id });
      setOwnerNotice(
        `“${rejecting.name}” was rejected and hidden from the Gallery.`,
      );
      setRejecting(null);
    } catch {
      setOwnerNotice(`Could not reject “${rejecting.name}”.`);
    } finally {
      setOwnerBusy(null);
    }
  }

  const entries = state.entries;
  const needsBundledFallback =
    localhostExamplesEnabled() &&
    state.status !== "loading" &&
    entries.length === 0 &&
    !galleryFiltersNarrowQuery(filters) &&
    !searchQuery.trim();

  useEffect(() => {
    if (!needsBundledFallback || bundledFallback.status !== "idle") return;
    let cancelled = false;
    setBundledFallback({ status: "loading", tiles: [] });
    void import("./gallery-bundled-fallback")
      .then(({ loadBundledGalleryTiles }) => loadBundledGalleryTiles())
      .then((tiles) => {
        if (!cancelled) setBundledFallback({ status: "ready", tiles });
      })
      .catch(() => {
        if (!cancelled) setBundledFallback({ status: "failed", tiles: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [needsBundledFallback]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  // Once the server has answered this search, its totals, tags and
  // contributors are the search's and nothing older is left to read; until
  // then the wall narrows what it has loaded, by the same rule.
  const searchAnswered =
    Boolean(normalizedSearchQuery) && state.search === searchQuery.trim();
  const searchingLoaded = Boolean(normalizedSearchQuery) && !searchAnswered;
  const visibleEntries = normalizedSearchQuery
    ? entries.filter((entry) =>
        galleryEntryMatchesQuery(entry, normalizedSearchQuery),
      )
    : entries;

  // A "View in Gallery" link names one circuit. The wall shows it at once: in
  // its place when the first page holds it, otherwise first on the wall,
  // looked up by its id (an updated circuit can sit hundreds of tiles down).
  // Its tile is brought into view and ringed for a moment.
  const [focusId, setFocusId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : galleryFocusEntryId(window.location.search),
  );
  const [focusEntry, setFocusEntry] = useState<
    GalleryFeedEntry | null | undefined
  >(undefined);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [focusMissing, setFocusMissing] = useState(false);
  useEffect(() => {
    if (focusId === null) return;
    let cancelled = false;
    const request =
      preload?.focus?.id === focusId
        ? preload.focus.entry
        : loadGalleryEntry(fetch, focusId);
    void request.then((entry) => {
      if (!cancelled) setFocusEntry(entry);
    });
    return () => {
      cancelled = true;
    };
  }, [focusId, preload]);
  useEffect(() => {
    if (focusId === null || state.status !== "ready") return;
    const placement = galleryFocusPlacement(
      visibleEntries.map((entry) => entry.id),
      focusId,
      focusEntry === undefined ? undefined : focusEntry !== null,
    );
    if (placement === undefined) return;
    setFocusId(null);
    window.history.replaceState(
      null,
      "",
      window.location.pathname + withoutGalleryFocus(window.location.search),
    );
    if (placement === "missing") {
      setFocusMissing(true);
      return;
    }
    if (placement === "first" && focusEntry)
      setState((previous) => ({
        ...previous,
        entries: [focusEntry, ...previous.entries],
      }));
    setLinkedId(focusId);
  }, [focusId, focusEntry, state, visibleEntries]);
  useEffect(() => {
    if (linkedId === null) return;
    // Masonry measures tiles and moves them as previews arrive, so a single
    // scroll lands where the tile was, not where it ends up. Keep the tile
    // centred until it has stayed put, and stop at the reader's first scroll.
    const tileSelector = `[data-testid="gallery-tile-${linkedId}"]`;
    let frame = 0;
    let lastTop: number | null = null;
    let stillFrames = 0;
    let readerScrolled = false;
    const readerScroll = () => {
      readerScrolled = true;
    };
    const listeners = ["wheel", "touchstart", "keydown"] as const;
    for (const type of listeners)
      window.addEventListener(type, readerScroll, {
        capture: true,
        passive: true,
      });
    const started = performance.now();
    const aim = () => {
      if (readerScrolled) return;
      const tile = document.querySelector<HTMLElement>(tileSelector);
      const shell = tile?.closest<HTMLElement>(".gallery-shell");
      if (tile && shell) {
        // The tile's place on the wall, whatever the wall's scroll.
        const top =
          tile.getBoundingClientRect().top -
          shell.getBoundingClientRect().top +
          shell.scrollTop;
        if (lastTop === null || Math.abs(top - lastTop) > 1) {
          lastTop = top;
          stillFrames = 0;
          tile.scrollIntoView({ block: "center", behavior: "auto" });
          tile.focus({ preventScroll: true });
        } else stillFrames += 1;
      }
      if (stillFrames < 12 && performance.now() - started < 2_500)
        frame = window.requestAnimationFrame(aim);
    };
    frame = window.requestAnimationFrame(aim);
    const timer = window.setTimeout(() => setLinkedId(null), 6_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      for (const type of listeners)
        window.removeEventListener(type, readerScroll, { capture: true });
    };
  }, [linkedId]);
  const localAuthors = searchingLoaded || !state.authors;
  const authors = localAuthors
    ? galleryAuthorsOf(visibleEntries)
    : state.authors!;
  const localQuickCounts = searchingLoaded || !state.filterCounts;
  const quickCounts = localQuickCounts
    ? {
        attention: visibleEntries.filter(
          (entry) => entry.attention?.status === "needs-attention",
        ).length,
        netlistable: visibleEntries.filter((entry) => entry.netlistable).length,
        liked: visibleEntries.filter((entry) => entry.likedByViewer).length,
      }
    : state.filterCounts!;
  const quickCountsPartial = localQuickCounts && state.nextCursor !== null;
  // The reason menu counts the same wall the Needs attention count does.
  const attentionKindCounts: Record<string, number> = localQuickCounts
    ? countAttentionKinds(visibleEntries)
    : (state.filterCounts?.attentionKinds ?? {});
  // Each size says what choosing it would show, every other filter applied.
  const componentRangeCounts: Record<string, number> = localQuickCounts
    ? countComponentRanges(visibleEntries)
    : (state.filterCounts?.componentRanges ?? {});
  const sizeFilters = GALLERY_COMPONENT_RANGES.map((range) => {
    const chosen = selectedParts.includes(range.key);
    const span =
      range.max === null
        ? `${range.min} or more`
        : range.min === 0
          ? `at most ${range.max}`
          : `${range.min} to ${range.max}`;
    return (
      <button
        key={range.key}
        type="button"
        className="gallery-sidebar-option gallery-sidebar-tag"
        data-testid={`gallery-filter-parts-${range.key}`}
        aria-pressed={chosen}
        title={`Circuits with ${span} components (Ports and supply markers are not counted)`}
        onClick={() =>
          updateFilters({
            parts: GALLERY_COMPONENT_RANGES.map((each) => each.key).filter(
              (key) =>
                key === range.key ? !chosen : selectedParts.includes(key),
            ),
          })
        }
      >
        <span className="gallery-tag-check" aria-hidden="true">
          {chosen ? "✓" : ""}
        </span>
        <span className="gallery-tag-name">{range.label}</span>
        <span className="gallery-sidebar-count">
          {state.status === "loading"
            ? "…"
            : state.status === "unavailable"
              ? "—"
              : `${(componentRangeCounts[range.key] ?? 0).toLocaleString()}${quickCountsPartial ? "+" : ""}`}
        </span>
      </button>
    );
  });
  const quickCount = (key: "attention" | "netlistable" | "liked") => (
    <span
      className="gallery-sidebar-count"
      title={
        quickCountsPartial ? "Matches in circuits loaded so far" : undefined
      }
    >
      {state.status === "loading"
        ? "…"
        : state.status === "unavailable"
          ? "—"
          : `${quickCounts[key].toLocaleString()}${quickCountsPartial ? "+" : ""}`}
    </span>
  );
  const duplicates = new Map(
    duplicateReport?.groups.flatMap((group, index) =>
      group.map(
        (entry) =>
          [
            entry.id,
            {
              group: index + 1,
              count: group.length,
              revision: entry.previewRevision,
            },
          ] as const,
      ),
    ) ?? [],
  );

  return (
    <main className="gallery-shell" data-testid="gallery-feed">
      <GalleryChrome
        subtitle={view === "shelf" ? "My shelf" : "Community gallery"}
        visitStats={visitStats}
      />

      <div className="gallery-view-tabs">
        <div
          className="gallery-view-tablist"
          role="tablist"
          aria-label="Circuits"
        >
          {(
            [
              ["gallery", "Community gallery"],
              ["shelf", "My shelf"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="gallery-view-tab"
              data-testid={`gallery-view-${id}`}
              aria-selected={view === id}
              onClick={() => updateFilters({ view: id })}
            >
              {label}
            </button>
          ))}
        </div>
        {/* The shelf states its own count ("N of 20 saved"); this one
            describes the community wall and leaves with it. */}
        {view === "gallery" ? (
          <GalleryCountPanel
            total={state.total}
            filtered={galleryFiltersNarrowQuery(filters)}
            authors={authors}
            partial={localAuthors && state.nextCursor !== null}
            author={author}
            onSelectAuthor={selectContributor}
            onShowAllAuthors={() => selectAuthor(null)}
            searched={searchAnswered}
            search={
              searchingLoaded
                ? {
                    visible: visibleEntries.length,
                    settled:
                      state.nextCursor === null && state.status === "ready",
                  }
                : null
            }
          />
        ) : null}
      </div>
      {view === "shelf" ? (
        <Suspense
          fallback={
            <p className="gallery-status" data-testid="shelf-loading">
              Loading your shelf…
            </p>
          }
        >
          <ShelfWall />
        </Suspense>
      ) : null}

      {view === "gallery" && state.status === "signed-out" ? (
        <section
          className="gallery-sign-in"
          data-testid="gallery-sign-in"
          aria-labelledby="gallery-sign-in-title"
        >
          <div className="gallery-sign-in-veil" aria-hidden="true">
            {SIGNED_OUT_TILE_HEIGHTS.map((height, index) => (
              <span
                key={index}
                className="gallery-sign-in-tile"
                style={{ height }}
              />
            ))}
          </div>
          <div className="gallery-sign-in-card">
            <h2 id="gallery-sign-in-title">
              The Gallery is for signed-in members
            </h2>
            <p>
              Sign in to browse its circuits, open them in the editor and
              publish your own.
            </p>
            <button
              type="button"
              className="gallery-unlock"
              data-testid="gallery-unlock"
              onClick={requestSignIn}
            >
              <svg
                className="gallery-unlock-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 11V8a5 5 0 0 1 9.6-2M5 11h14v10H5z M12 15v2"
                />
              </svg>
              Sign in
            </button>
          </div>
        </section>
      ) : null}
      {view === "gallery" && state.status !== "signed-out" ? (
        <div className="gallery-browser">
          <GalleryTagSidebar
            tags={tagOptions}
            groupCounts={tagGroupCounts}
            countsLoading={tagCountsScope !== tagScope}
            selected={selectedTags}
            onChange={(tags) => updateFilters({ tags })}
            search={searchQuery}
            onSearchChange={(search) => updateFilters({ search })}
            sizeFilters={sizeFilters}
            sizeSelected={selectedParts.length}
            onClearSizes={() => updateFilters({ parts: [] })}
            quickFilters={
              <>
                {signedIn || attentionOnly ? (
                  <button
                    type="button"
                    className="gallery-sidebar-option"
                    aria-pressed={attentionOnly}
                    onClick={() =>
                      updateFilters({
                        attention: !attentionOnly,
                        attentionKind: null,
                      })
                    }
                    data-testid="gallery-filter-attention"
                  >
                    <span>
                      Needs attention{signedIn && !isOwner ? " · Mine" : ""}
                    </span>
                    {quickCount("attention")}
                  </button>
                ) : null}
                {attentionOnly ? (
                  <label className="gallery-attention-reason">
                    <span>Reason</span>
                    <select
                      value={attentionKind ?? ""}
                      onChange={(event) =>
                        updateFilters({
                          attentionKind: event.currentTarget.value || null,
                        })
                      }
                      data-testid="gallery-filter-attention-reason"
                    >
                      <option value="">Every reason</option>
                      {GALLERY_ISSUE_KINDS.filter(
                        (kind) =>
                          kind === attentionKind ||
                          (attentionKindCounts[kind] ?? 0) > 0,
                      ).map((kind) => (
                        <option key={kind} value={kind}>
                          {galleryIssueKindLabel(kind)} (
                          {(attentionKindCounts[kind] ?? 0).toLocaleString()})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <button
                  type="button"
                  className={
                    netlistableOnly
                      ? "gallery-tag-option gallery-tag-mark gallery-tag-selected"
                      : "gallery-tag-option gallery-tag-mark"
                  }
                  data-testid="gallery-filter-netlistable"
                  aria-pressed={netlistableOnly}
                  title={
                    netlistableOnly
                      ? "Stop filtering by netlist"
                      : "Show only circuits that extract to a netlist"
                  }
                  onClick={() =>
                    updateFilters({ netlistable: !netlistableOnly })
                  }
                >
                  <NetlistIcon /> <span>With netlist</span>
                  {quickCount("netlistable")}
                </button>
                {signedIn || likedOnly ? (
                  <button
                    type="button"
                    className={
                      likedOnly
                        ? "gallery-tag-option gallery-tag-mark gallery-tag-selected"
                        : "gallery-tag-option gallery-tag-mark"
                    }
                    data-testid="gallery-filter-liked"
                    aria-pressed={likedOnly}
                    title={
                      likedOnly
                        ? "Stop filtering by your likes"
                        : "Show only circuits you have liked"
                    }
                    onClick={() => updateFilters({ liked: !likedOnly })}
                  >
                    <HeartIcon filled={true} /> <span>Liked</span>
                    {quickCount("liked")}
                  </button>
                ) : null}
              </>
            }
            adminTools={
              isOwner ? (
                <Suspense fallback={null}>
                  <GalleryDuplicateCheck
                    onReport={setDuplicateReport}
                    onRecycled={(ids) => {
                      // The scan covers the whole library, while this feed may
                      // be filtered. Let the server recalculate its counts.
                      setRefreshSignal((signal) => signal + 1);
                      if (ids[0]) announceGalleryChange({ entryId: ids[0] });
                    }}
                  />
                </Suspense>
              ) : null
            }
          />
          <div className="gallery-main">
            {author ? (
              <div className="gallery-filter" data-testid="gallery-filter">
                <span>Circuits by {author}</span>
                <button
                  type="button"
                  data-testid="gallery-filter-clear"
                  onClick={() => selectAuthor(null)}
                >
                  All authors
                </button>
              </div>
            ) : null}
            {ownerNotice ? (
              <p className="gallery-status" data-testid="gallery-owner-notice">
                {ownerNotice}
              </p>
            ) : null}
            {focusMissing ? (
              <p className="gallery-status" data-testid="gallery-focus-missing">
                That circuit is not on the wall. It may have been removed.
              </p>
            ) : null}
            {state.status === "loading" ||
            (needsBundledFallback &&
              (bundledFallback.status === "idle" ||
                bundledFallback.status === "loading")) ? (
              <p className="gallery-status" data-testid="gallery-loading">
                Loading gallery…
              </p>
            ) : (
              <section className="gallery-wall">
                {searchingLoaded && state.status === "ready" ? (
                  <GallerySearchProgress
                    checked={entries.length}
                    total={state.total}
                    matches={visibleEntries.length}
                    settled={state.nextCursor === null}
                  />
                ) : null}
                <Masonry
                  aria-label="Published circuits"
                  items={[
                    ...visibleEntries.map((entry) => ({
                      key: entry.id,
                      node: (
                        <div
                          className={
                            entry.id === linkedId
                              ? "gallery-tile-wrap is-linked"
                              : "gallery-tile-wrap"
                          }
                        >
                          <a
                            className="gallery-tile"
                            href={`/g/${entry.id}`}
                            data-testid={`gallery-tile-${entry.id}`}
                          >
                            <TilePreview
                              key={`${entry.id}-${entry.previewRevision}`}
                              src={galleryPreviewUrl(
                                entry.id,
                                entry.previewRevision,
                              )}
                              alt={`Preview of ${entry.name}`}
                              {...(entry.previewWidth !== undefined &&
                              entry.previewHeight !== undefined
                                ? {
                                    width: entry.previewWidth,
                                    height: entry.previewHeight,
                                  }
                                : {})}
                            />
                            <span className="gallery-tile-copy">
                              <span className="gallery-tile-name">
                                {entry.name}
                                {duplicates.has(entry.id) &&
                                duplicates.get(entry.id)!.revision ===
                                  entry.previewRevision ? (
                                  <span
                                    className="gallery-duplicate-badge"
                                    title={`Same netlist as ${duplicates.get(entry.id)!.count - 1} other circuits. See duplicate group ${duplicates.get(entry.id)!.group}.`}
                                  >
                                    Duplicate · group{" "}
                                    {duplicates.get(entry.id)!.group}
                                  </span>
                                ) : null}
                                {entry.netlistable ? (
                                  <span
                                    className="gallery-tile-netlist"
                                    data-testid={`gallery-netlist-${entry.id}`}
                                    title="Extracts to a SPICE netlist"
                                    aria-label="Extracts to a SPICE netlist"
                                  >
                                    <NetlistIcon />
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
                                        selectAuthor(
                                          entry.author,
                                          entry.ownerUserId ?? null,
                                        );
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
                                  <HeartIcon
                                    filled={entry.likedByViewer === true}
                                  />
                                  {entry.likes ?? 0}
                                </button>
                              </span>
                              {entry.description ? (
                                <span
                                  className="gallery-tile-description"
                                  title={entry.description}
                                >
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
                                      title={`Filter by ${galleryTagLabel(tag)}`}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        if (!selectedTags.includes(tag))
                                          toggleTag(tag);
                                      }}
                                    >
                                      {galleryTagLabel(tag)}
                                    </button>
                                  ))}
                                </span>
                              ) : null}
                            </span>
                          </a>
                          {isOwner ||
                          (!!viewerId && viewerId === entry.ownerUserId) ? (
                            <Suspense fallback={null}>
                              {isOwner ? (
                                <GalleryOwnerRejectButton
                                  entry={entry}
                                  busy={ownerBusy === entry.id}
                                  onReject={() => setRejecting(entry)}
                                />
                              ) : null}
                              <GalleryTileMenu
                                entry={entry}
                                busy={ownerBusy === entry.id}
                                administrator={isOwner}
                                onReview={() => setReviewing(entry)}
                                onWithdraw={() => void withdrawEntry(entry)}
                              />
                            </Suspense>
                          ) : null}
                        </div>
                      ),
                    })),
                    ...(needsBundledFallback
                      ? bundledFallback.tiles
                          .filter((tile) =>
                            galleryEntryMatchesQuery(
                              { ...tile, author: "", tags: [] },
                              normalizedSearchQuery,
                            ),
                          )
                          .map((tile) => ({
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
                                  <span className="gallery-tile-name">
                                    {tile.name}
                                  </span>
                                  <span
                                    className="gallery-tile-description"
                                    title={tile.description}
                                  >
                                    {tile.description}
                                  </span>
                                </span>
                              </a>
                            ),
                          }))
                      : []),
                  ]}
                />
                {entries.length === 0 &&
                selectedTags.length > 0 &&
                author === null ? (
                  <p
                    className="gallery-status"
                    data-testid="gallery-tags-empty"
                  >
                    No circuits match the selected tags.
                  </p>
                ) : null}
                {entries.length === 0 && author !== null ? (
                  <p
                    className="gallery-status"
                    data-testid="gallery-filter-empty"
                  >
                    No public circuits by {author} yet.
                  </p>
                ) : null}
                {entries.length === 0 &&
                author === null &&
                selectedTags.length === 0 &&
                !netlistableOnly &&
                !likedOnly &&
                selectedParts.length > 0 ? (
                  <p
                    className="gallery-status"
                    data-testid="gallery-parts-empty"
                  >
                    No circuits of the chosen sizes.
                  </p>
                ) : null}
                {entries.length === 0 &&
                author === null &&
                (netlistableOnly || likedOnly) ? (
                  <p
                    className="gallery-status"
                    data-testid="gallery-mark-empty"
                  >
                    {likedOnly && !signedIn
                      ? "Sign in to collect the circuits you like."
                      : likedOnly && netlistableOnly
                        ? "None of the circuits you liked extracts to a netlist yet."
                        : likedOnly
                          ? "You have not liked any circuits yet."
                          : "No circuits here extract to a netlist yet."}
                  </p>
                ) : null}
                {!localhostExamplesEnabled() &&
                entries.length === 0 &&
                !galleryFiltersNarrowQuery(filters) ? (
                  <p className="gallery-status" data-testid="gallery-empty">
                    {state.status === "unavailable"
                      ? "Gallery is unavailable. Try again later."
                      : "No published circuits yet."}
                  </p>
                ) : null}
                {/* Two empty states, because only one of them is a verdict:
                  while the cursor chain is unexhausted the true sentence is
                  "nothing in what has loaded", not "nothing". The sentinel
                  below keeps pulling pages whenever the thin wall leaves it
                  in view, so the pending state resolves itself. */}
                {normalizedSearchQuery &&
                visibleEntries.length === 0 &&
                (searchAnswered || entries.length > 0) ? (
                  searchingLoaded && state.nextCursor !== null ? (
                    <p
                      className="gallery-status"
                      data-testid="gallery-search-pending"
                    >
                      No matches yet — searching older circuits…
                    </p>
                  ) : (
                    <p
                      className="gallery-status"
                      data-testid="gallery-search-empty"
                    >
                      No circuits match “{searchQuery.trim()}”.
                    </p>
                  )
                ) : null}
              </section>
            )}
            <div
              ref={sentinelRef}
              className="gallery-sentinel"
              data-testid="gallery-sentinel"
              aria-hidden="true"
            />
          </div>
        </div>
      ) : null}
      {state.status === "signed-out" ? null : (
        <footer className="gallery-footnote" data-testid="gallery-footnote">
          Open any circuit to edit your own copy; publish your own from the
          editor.
        </footer>
      )}
      {rejecting ? (
        <Suspense fallback={null}>
          <RejectEntryDialog
            entry={rejecting}
            busy={ownerBusy === rejecting.id}
            onSubmit={(reason) => void rejectEntry(reason)}
            onClose={() => setRejecting(null)}
          />
        </Suspense>
      ) : null}
      {reviewing ? (
        <Suspense fallback={null}>
          <GalleryReviewDialog
            entry={reviewing}
            reasons={GALLERY_ATTENTION_REASONS}
            onChange={(updated) => {
              setReviewing(updated);
              setState((previous) => ({
                ...previous,
                entries: previous.entries.map((item) =>
                  item.id === updated.id ? updated : item,
                ),
              }));
              setRefreshSignal((signal) => signal + 1);
              announceGalleryChange({ entryId: updated.id });
            }}
            onClose={() => setReviewing(null)}
          />
        </Suspense>
      ) : null}
    </main>
  );
}
