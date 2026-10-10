import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import "../styles/gallery-entry.css";

import {
  announceGalleryChange,
  galleryAuthorsOf,
  galleryNarrowedByline,
  galleryPreviewUrl,
  loadGalleryFeed,
  loadGalleryTags,
  localhostExamplesEnabled,
  type GalleryAuthorOption,
  type GalleryFeedEntry,
  type GalleryFeedPage,
  type GalleryFeedQuery,
  type GalleryFeedState,
  type GalleryTagOption,
  type GalleryLandingPreload,
} from "../gallery-client";
import { galleryEntryMatchesQuery } from "../gallery-search";
import { galleryFiltersNarrowQuery } from "../gallery-filters";
import {
  GALLERY_COMPONENT_RANGES,
  galleryComponentRangeOf,
} from "../gallery-component-ranges";
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
import { GallerySourceNote, useGalleryDatasets } from "./gallery-datasets";
import { GalleryOrderMenu } from "./gallery-order-menu";
import {
  galleryOrderPreference,
  galleryShuffleSeed,
  newGalleryShuffleSeed,
  rememberGalleryOrder,
  type GalleryOrder,
} from "../gallery-order";
import { gallerySourceByKey } from "../gallery-sources";
import { useGalleryFilters } from "./gallery-feed-filters";
import { useBundledGalleryFallback, useGalleryWall } from "./gallery-feed-wall";
import { useGalleryOwnerTools } from "./gallery-feed-owner-tools";
import { useGalleryFocusLink } from "./gallery-feed-focus";
import {
  GalleryCountPanel,
  GallerySearchProgress,
} from "./gallery-feed-count-panel";
import { GalleryQuickFilters } from "./gallery-feed-quick-filters";
import { GalleryBundledTile, GalleryWallTile } from "./gallery-feed-tile";

/**
 * Heights of the grey stand-in tiles behind the sign-in invitation, for a
 * signed-out visitor the server shows no circuit at all; otherwise the veil
 * draws the wall's first circuits it shows, dimmed and closed.
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
const GallerySimulationChecks = lazy(() =>
  import("./gallery-simulation-checks-panel").then((module) => ({
    default: module.GallerySimulationChecks,
  })),
);
const GalleryDuplicateCheck = lazy(() =>
  import("./gallery-duplicate-check").then((module) => ({
    default: module.GalleryDuplicateCheck,
  })),
);

const RejectEntryDialog = lazy(() =>
  import("./gallery-owner-controls").then((module) => ({
    default: module.RejectEntryDialog,
  })),
);

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
  const { filters, setFilters, updateFilters, serverSearch } =
    useGalleryFilters();
  const {
    view,
    author,
    ownerUserId,
    tags: selectedTags,
    search: searchQuery,
    netlistable: netlistableOnly,
    withoutNetlist: withoutNetlistOnly,
    ai: aiFilter,
    liked: likedOnly,
    attention: attentionOnly,
    attentionKind,
    parts: selectedParts,
    source,
  } = filters;
  // A reference dataset's wall is read-only: no likes, no owner tools.
  const datasetWall = gallerySourceByKey(source);
  // An account narrows by its id. Its byline is then only the label, and
  // possibly a former one, so rewriting it must not reload the wall.
  const queriedAuthor = ownerUserId ? null : author;
  // The wall's order (#1615): the reader's kept choice, else a shuffle,
  // seeded as the landing preload was so it can reuse that first page.
  const [order, setOrder] = useState<GalleryOrder>(galleryOrderPreference);
  const [seed, setSeed] = useState(galleryShuffleSeed);
  function chooseOrder(next: GalleryOrder): void {
    rememberGalleryOrder(next);
    // Random again shuffles anew.
    if (next === "random") setSeed(newGalleryShuffleSeed());
    setOrder(next);
  }
  // One query for the first page, every later page and the landing preload.
  const feedQuery = useMemo<GalleryFeedQuery>(
    () => ({
      source,
      author: queriedAuthor,
      ownerUserId,
      tags: selectedTags,
      netlistable: netlistableOnly,
      withoutNetlist: withoutNetlistOnly,
      ai: aiFilter,
      liked: likedOnly,
      attention: attentionOnly,
      attentionKind,
      parts: selectedParts,
      ...(serverSearch ? { q: serverSearch } : {}),
      order,
      seed,
    }),
    [
      order,
      seed,
      queriedAuthor,
      ownerUserId,
      selectedTags,
      netlistableOnly,
      withoutNetlistOnly,
      aiFilter,
      likedOnly,
      attentionOnly,
      attentionKind,
      selectedParts,
      serverSearch,
      source,
    ],
  );
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  // One of the Owner's own accounts, not every administrator: its tools
  // gate on OWNER_ACCOUNT_IDS (#1545).
  const [ownerAccount, setOwnerAccount] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchSessionUser().then((user) => {
      if (cancelled) return;
      setSignedIn(user !== null);
      setViewerId(user?.id ?? null);
      setIsOwner(user?.isAdmin === true);
      setOwnerAccount(user?.isOwner === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const {
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
  } = useGalleryWall({
    preload,
    feedQuery,
    searchQuery,
    serverSearch,
    likedOnly,
  });
  const {
    duplicateReport,
    setDuplicateReport,
    ownerBusy,
    ownerNotice,
    setOwnerNotice,
    rejecting,
    setRejecting,
    reviewing,
    setReviewing,
    withdrawEntry,
    rejectEntry,
    verifySimulation,
  } = useGalleryOwnerTools({ isOwner, removeManagedEntry });

  function selectAuthor(
    nextAuthor: string | null,
    nextOwnerUserId: string | null = null,
  ): void {
    updateFilters({
      author: nextAuthor,
      ownerUserId: nextOwnerUserId,
      // "All authors" is the community wall, whichever wall is open.
      ...(nextAuthor === null && nextOwnerUserId === null
        ? { source: null }
        : {}),
    });
  }

  // A reference dataset is listed among the contributors (#1574) and opens
  // its own wall. An author, a like or a review is the community's; the
  // other filters carry over.
  function selectDataset(key: string): void {
    updateFilters({
      source: key,
      author: null,
      ownerUserId: null,
      liked: false,
      attention: false,
      attentionKind: null,
    });
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

  const entries = state.entries;
  const needsBundledFallback =
    localhostExamplesEnabled() &&
    !datasetWall &&
    state.status !== "loading" &&
    entries.length === 0 &&
    !galleryFiltersNarrowQuery(filters) &&
    !searchQuery.trim();

  const bundledFallback = useBundledGalleryFallback(needsBundledFallback);

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
  const refreshing = state.status === "loading" && heldWall.length > 0;
  shownWallRef.current = refreshing ? heldWall : visibleEntries;

  const { linkedId, focusMissing } = useGalleryFocusLink({
    preload,
    state,
    setState,
    visibleEntries,
  });
  const localAuthors = searchingLoaded || !state.authors;
  const authors = localAuthors
    ? galleryAuthorsOf(visibleEntries)
    : state.authors!;
  const narrowedToAuthor = author !== null || ownerUserId !== null;
  const byline = galleryNarrowedByline({ author, ownerUserId }, authors);
  // Who the wall shows: one author, else a dataset as its contributor.
  const narrowedName = narrowedToAuthor
    ? (byline ?? "this contributor")
    : (datasetWall?.name ?? null);
  const datasets = useGalleryDatasets(source, isOwner);
  // A remembered filter or an older link may carry the account's former
  // byline; once its contributors name it, the wall remembers the current one.
  useEffect(() => {
    if (ownerUserId && byline && byline !== author)
      updateFilters({ author: byline });
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- updateFilters only merges a patch into the filter state; a new byline, not a new render, runs this
  }, [ownerUserId, author, byline]);
  const localQuickCounts = searchingLoaded || !state.filterCounts;
  const loadedCount = (keep: (entry: GalleryFeedEntry) => boolean) =>
    visibleEntries.filter(keep).length;
  // The loaded circuits answer what the server has not: a text search, or a
  // Worker from before a count existed.
  const loadedQuickCounts = {
    attention: loadedCount(
      (entry) => entry.attention?.status === "needs-attention",
    ),
    netlistable: loadedCount((entry) => entry.netlistable === true),
    withoutNetlist: loadedCount((entry) => entry.netlistable !== true),
    ai: loadedCount((entry) => entry.aiGenerated === true),
    human: loadedCount((entry) => entry.aiGenerated !== true),
    liked: loadedCount((entry) => entry.likedByViewer === true),
  };
  const quickCounts = localQuickCounts
    ? loadedQuickCounts
    : { ...loadedQuickCounts, ...state.filterCounts! };
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
  const quickCount = (key: keyof typeof loadedQuickCounts) => (
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
        {view === "gallery" ? (
          <GalleryOrderMenu order={order} onChoose={chooseOrder} />
        ) : null}
        {/* The shelf states its own count ("N of 20 saved"); this one
            describes the community wall and leaves with it. */}
        {view === "gallery" ? (
          <GalleryCountPanel
            total={state.total}
            filtered={galleryFiltersNarrowQuery(filters)}
            authors={datasetWall && !narrowedToAuthor ? [] : authors}
            partial={localAuthors && state.nextCursor !== null}
            author={narrowedName}
            onSelectAuthor={selectContributor}
            onShowAllAuthors={() => selectAuthor(null)}
            datasets={datasets}
            currentDataset={source}
            onSelectDataset={selectDataset}
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
            {state.entries.length > 0
              ? state.entries.map((entry) => (
                  <span
                    key={entry.id}
                    className="gallery-sign-in-tile gallery-sign-in-circuit"
                    data-testid="gallery-sign-in-circuit"
                  >
                    <img
                      src={galleryPreviewUrl(entry.id, entry.previewRevision)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                    <span className="gallery-sign-in-circuit-name">
                      {entry.name}
                    </span>
                  </span>
                ))
              : SIGNED_OUT_TILE_HEIGHTS.map((height, index) => (
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
              <GalleryQuickFilters
                signedIn={signedIn}
                isOwner={isOwner}
                attentionOnly={attentionOnly}
                attentionKind={attentionKind}
                attentionKindCounts={attentionKindCounts}
                aiFilter={aiFilter}
                netlistableOnly={netlistableOnly}
                withoutNetlistOnly={withoutNetlistOnly}
                likedOnly={likedOnly}
                updateFilters={updateFilters}
                quickCount={quickCount}
              />
            }
            adminTools={
              isOwner || (ownerAccount && !datasetWall) ? (
                <Suspense fallback={null}>
                  {isOwner ? (
                    <GalleryDuplicateCheck
                      onReport={setDuplicateReport}
                      onRecycled={(ids) => {
                        // The scan covers the whole library, while this feed may
                        // be filtered. Let the server recalculate its counts.
                        setRefreshSignal((signal) => signal + 1);
                        if (ids[0]) announceGalleryChange({ entryId: ids[0] });
                      }}
                    />
                  ) : null}
                  {ownerAccount && !datasetWall ? (
                    <GallerySimulationChecks />
                  ) : null}
                </Suspense>
              ) : null
            }
          />
          <div className="gallery-main">
            {narrowedName !== null ? (
              <div className="gallery-filter" data-testid="gallery-filter">
                <span>Circuits by {narrowedName}</span>
                <button
                  type="button"
                  data-testid="gallery-filter-clear"
                  onClick={() => selectAuthor(null)}
                >
                  All authors
                </button>
              </div>
            ) : null}
            {datasetWall ? <GallerySourceNote source={datasetWall} /> : null}
            {ownerNotice ? (
              <aside
                className="gallery-owner-toast"
                data-testid="gallery-owner-notice"
                data-ok={ownerNotice.ok}
              >
                <span role="status">
                  <span className="gallery-owner-toast-mark" aria-hidden="true">
                    {ownerNotice.ok ? "✓" : "!"}
                  </span>{" "}
                  {ownerNotice.text}
                </span>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => setOwnerNotice(null)}
                >
                  ×
                </button>
              </aside>
            ) : null}
            {focusMissing ? (
              <p className="gallery-status" data-testid="gallery-focus-missing">
                That circuit is not on the wall. It may have been removed.
              </p>
            ) : null}
            {(state.status === "loading" && !refreshing) ||
            (needsBundledFallback &&
              (bundledFallback.status === "idle" ||
                bundledFallback.status === "loading")) ? (
              <p className="gallery-status" data-testid="gallery-loading">
                Loading gallery…
              </p>
            ) : (
              <section
                className={
                  refreshing ? "gallery-wall is-refreshing" : "gallery-wall"
                }
                aria-busy={refreshing}
                inert={refreshing}
              >
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
                    ...shownWallRef.current.map((entry) => ({
                      key: entry.id,
                      node: (
                        <GalleryWallTile
                          entry={entry}
                          linkedId={linkedId}
                          duplicates={duplicates}
                          datasetWall={datasetWall}
                          isOwner={isOwner}
                          viewerId={viewerId}
                          ownerBusy={ownerBusy}
                          selectedTags={selectedTags}
                          selectAuthor={selectAuthor}
                          toggleLike={toggleLike}
                          toggleTag={toggleTag}
                          setRejecting={setRejecting}
                          setReviewing={setReviewing}
                          withdrawEntry={withdrawEntry}
                          verifySimulation={
                            ownerAccount ? verifySimulation : undefined
                          }
                        />
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
                            node: <GalleryBundledTile tile={tile} />,
                          }))
                      : []),
                  ]}
                />
                {refreshing ? null : (
                  <>
                    {entries.length === 0 &&
                    selectedTags.length > 0 &&
                    !narrowedToAuthor ? (
                      <p
                        className="gallery-status"
                        data-testid="gallery-tags-empty"
                      >
                        No circuits match the selected tags.
                      </p>
                    ) : null}
                    {entries.length === 0 && narrowedToAuthor ? (
                      <p
                        className="gallery-status"
                        data-testid="gallery-filter-empty"
                      >
                        No public circuits by {narrowedName} yet.
                      </p>
                    ) : null}
                    {entries.length === 0 &&
                    !narrowedToAuthor &&
                    selectedTags.length === 0 &&
                    !netlistableOnly &&
                    !withoutNetlistOnly &&
                    aiFilter === null &&
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
                    !narrowedToAuthor &&
                    (netlistableOnly ||
                      withoutNetlistOnly ||
                      aiFilter !== null ||
                      likedOnly) ? (
                      <p
                        className="gallery-status"
                        data-testid="gallery-mark-empty"
                      >
                        {likedOnly && !signedIn
                          ? "Sign in to collect the circuits you like."
                          : likedOnly && netlistableOnly
                            ? "None of the circuits you liked extracts to a netlist yet."
                            : likedOnly &&
                                !withoutNetlistOnly &&
                                aiFilter === null
                              ? "You have not liked any circuits yet."
                              : likedOnly ||
                                  [
                                    netlistableOnly,
                                    withoutNetlistOnly,
                                    aiFilter !== null,
                                  ].filter(Boolean).length > 1
                                ? "No circuits match these filters."
                                : netlistableOnly
                                  ? "No circuits here extract to a netlist yet."
                                  : withoutNetlistOnly
                                    ? "Every circuit here extracts to a netlist."
                                    : aiFilter === "ai"
                                      ? "No AI-generated circuits here yet."
                                      : "No circuits made by hand here yet."}
                      </p>
                    ) : null}
                    {(!localhostExamplesEnabled() || datasetWall) &&
                    entries.length === 0 &&
                    !galleryFiltersNarrowQuery(filters) ? (
                      <p className="gallery-status" data-testid="gallery-empty">
                        {state.status === "unavailable"
                          ? "Gallery is unavailable. Try again later."
                          : datasetWall
                            ? `No ${datasetWall.name} circuits imported yet.`
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
                  </>
                )}
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
