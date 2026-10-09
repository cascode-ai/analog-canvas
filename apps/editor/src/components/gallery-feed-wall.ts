/**
 * What the wall holds and how it loads: the first page and every later one,
 * the tag counts beside it, refreshes, likes, entries taken off it, and the
 * bundled examples that stand in on a development host.
 */
import { useEffect, useRef, useState } from "react";
import {
  announceGalleryChange,
  removeGalleryAuthorEntry,
  galleryFeedQueryKey,
  loadGalleryFeed,
  galleryTagScope,
  GALLERY_SIGN_IN_REQUIRED,
  loadGalleryTagSummary,
  subscribeGalleryRefresh,
  type GalleryFeedEntry,
  type GalleryFeedQuery,
  type GalleryFeedState,
  type GalleryLandingPreload,
  withLoadedTail,
  type GalleryQuickFilterCounts,
  type GalleryTagSummary,
} from "../gallery-client";
import type { BundledGalleryTile } from "./gallery-bundled-fallback";

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

/** The pair counts the Worker sent, with one entry taken off the wall. */
function pairCountsWithout(
  counts: GalleryQuickFilterCounts,
  entry: GalleryFeedEntry,
  removed: boolean,
): Pick<GalleryQuickFilterCounts, "withoutNetlist" | "ai" | "human"> {
  const less = (key: "withoutNetlist" | "ai" | "human", matches: boolean) =>
    counts[key] === undefined
      ? {}
      : { [key]: counts[key]! - Number(removed && matches) };
  return {
    ...less("withoutNetlist", entry.netlistable !== true),
    ...less("ai", entry.aiGenerated === true),
    ...less("human", entry.aiGenerated !== true),
  };
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

export function useGalleryWall({
  preload,
  feedQuery,
  searchQuery,
  serverSearch,
  likedOnly,
}: {
  preload: GalleryLandingPreload | undefined;
  feedQuery: GalleryFeedQuery;
  searchQuery: string;
  serverSearch: string;
  likedOnly: boolean;
}) {
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

  // Keyed by the scope, not the query: choosing a tag changes the wall but
  // not the counts beside it.
  useEffect(() => {
    let cancelled = false;
    const apply = (payload: GalleryTagSummary) => {
      setTagOptions(payload.tags);
      setTagGroupCounts(
        Object.fromEntries(
          payload.groups.map(({ group, count }) => [group, count]),
        ),
      );
      setTagCountsScope(tagScope);
    };
    const request =
      refreshSignal === 0 &&
      tagCountsRefresh === 0 &&
      preload &&
      (preload.tagsScope ?? "") === tagScope
        ? preload.tags
        : loadGalleryTagSummary(fetch, feedQuery);
    void request.then((payload) => {
      if (!cancelled) apply(payload);
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
  // The tiles on screen when the filters changed, held dimmed until the new
  // combination answers, so the wall never blanks between two of them.
  const [heldWall, setHeldWall] = useState<GalleryFeedEntry[]>([]);
  const shownWallRef = useRef<GalleryFeedEntry[]>([]);
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
                ...pairCountsWithout(previous.filterCounts, entry, removed),
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
      setHeldWall(shownWallRef.current);
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
      setHeldWall([]);
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
              ...pairCountsWithout(previous.filterCounts, entry, true),
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
  return {
    tagOptions,
    tagGroupCounts,
    tagCountsScope,
    tagScope,
    setRefreshSignal,
    state,
    setState,
    heldWall,
    shownWallRef,
    sentinelRef,
    toggleLike,
    removeManagedEntry,
  };
}

export function useBundledGalleryFallback(needsBundledFallback: boolean) {
  const [bundledFallback, setBundledFallback] = useState<{
    status: "idle" | "loading" | "ready" | "failed";
    tiles: BundledGalleryTile[];
  }>({ status: "idle", tiles: [] });

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
  return bundledFallback;
}
