import type { GalleryAttention } from "../../../worker/gallery-curation";

/** Bundled teaching circuits are a loopback fallback, not hosted Gallery data. */
export function localhostExamplesEnabled(
  hostname = globalThis.location?.hostname ?? "",
): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

const GALLERY_CHANGE_CHANNEL = "analog-canvas-gallery-change-v1";

export interface GalleryChange {
  entryId: string;
  previewRevision?: string;
}

interface GalleryChangeMessage extends GalleryChange {
  type: "gallery-changed";
  sourceId: string;
}

const SOURCE_ID =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

function validPreviewRevision(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function galleryChangeOf(
  value: unknown,
): { change: GalleryChange; sourceId: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Partial<GalleryChangeMessage>;
  if (message.type !== "gallery-changed") return null;
  if (typeof message.sourceId !== "string") return null;
  if (typeof message.entryId !== "string" || message.entryId.length === 0) {
    return null;
  }
  if (
    message.previewRevision !== undefined &&
    !validPreviewRevision(message.previewRevision)
  ) {
    return null;
  }
  return {
    sourceId: message.sourceId,
    change: {
      entryId: message.entryId,
      ...(message.previewRevision === undefined
        ? {}
        : { previewRevision: message.previewRevision }),
    },
  };
}

/** One immutable address for each stored rendering of a Gallery entry. */
export function galleryPreviewUrl(
  entryId: string,
  previewRevision?: string,
): string {
  const path = `/api/gallery/${entryId}/preview.svg`;
  return validPreviewRevision(previewRevision)
    ? `${path}?v=${encodeURIComponent(previewRevision)}&render=formula-label-v5`
    : path;
}

/**
 * Warm the publisher's browser cache without delaying the completed publish.
 * A missing revision means an older server is still active during a rollout;
 * its mutable URL must not be prefetched as though it were immutable.
 */
export async function primeGalleryPreview(
  entryId: string,
  previewRevision: string | undefined,
  fetchLike: typeof fetch = fetch,
): Promise<void> {
  if (!validPreviewRevision(previewRevision)) return;
  try {
    const response = await fetchLike(
      galleryPreviewUrl(entryId, previewRevision),
      {
        credentials: "same-origin",
        cache: "reload",
      },
    );
    if (response.ok) await response.arrayBuffer();
  } catch {
    // Publishing already succeeded; cache warming must never turn that into an
    // apparent failure. The Gallery's <img> will retry the same URL normally.
  }
}

/** Tell other same-origin tabs that their no-store Gallery list is stale. */
export function announceGalleryChange(change: GalleryChange): void {
  if (typeof BroadcastChannel === "undefined" || !change.entryId) return;
  try {
    const channel = new BroadcastChannel(GALLERY_CHANGE_CHANNEL);
    channel.postMessage({
      type: "gallery-changed",
      sourceId: SOURCE_ID,
      ...change,
    });
    channel.close();
  } catch {
    // Focus/visibility refresh remains the fallback in unsupported contexts.
  }
}

/**
 * Refresh on a local publication message and whenever this tab becomes the
 * active view again. Remote visitors are intentionally not polled.
 */
export function subscribeGalleryRefresh(
  listener: (change: GalleryChange | null) => void,
): () => void {
  let channel: BroadcastChannel | null = null;
  const onMessage = (event: MessageEvent<unknown>) => {
    const message = galleryChangeOf(event.data);
    if (message && message.sourceId !== SOURCE_ID) listener(message.change);
  };
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(GALLERY_CHANGE_CHANNEL);
      channel.addEventListener("message", onMessage);
    }
  } catch {
    channel = null;
  }

  let activationTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleActivationRefresh = () => {
    if (activationTimer !== null) return;
    activationTimer = setTimeout(() => {
      activationTimer = null;
      listener(null);
    }, 50);
  };
  const onFocus = () => scheduleActivationRefresh();
  const onVisible = () => {
    if (document.visibilityState === "visible") scheduleActivationRefresh();
  };
  if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible);
  }

  return () => {
    if (activationTimer !== null) clearTimeout(activationTimer);
    channel?.removeEventListener("message", onMessage);
    channel?.close();
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", onFocus);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

/**
 * The community feed's data layer, shared by every surface that shows the
 * Gallery: the wall itself and the panel docked beside the canvas. It lives
 * here rather than in either component so the two cannot drift — a circuit
 * that a search finds on the wall must be found by the same search in the
 * panel, or people reasonably conclude the software is broken.
 */

export interface GalleryFeedEntry {
  curationRevision?: number;
  attention?: GalleryAttention;
  assessedPreviewRevision?: string;
  id: string;
  name: string;
  author: string;
  /** Stable identity for contributor filtering; absent on an older API. */
  ownerUserId?: string | null;
  description: string;
  createdAt: string;
  /** Absent only while a newer client is rolling out against an older API. */
  previewRevision?: string;
  /** Intrinsic SVG viewBox size, used to reserve the tile before image load. */
  previewWidth?: number;
  previewHeight?: number;
  schemaVersion: number;
  tags?: string[];
  /**
   * Whether the circuit extracts to a design netlist. A mark of extra
   * completeness, never a gate — a schematic is allowed to be abbreviated,
   * and one without this is listed exactly like one with it.
   */
  netlistable?: boolean;
  /** The publisher says an AI made it; absent otherwise. */
  aiGenerated?: boolean;
  /** Parts the top Cell draws; absent until the Worker has counted it. */
  componentCount?: number;
  likes?: number;
  likedByViewer?: boolean;
}

export interface GalleryQuickFilterCounts {
  attention: number;
  netlistable: number;
  liked: number;
  /** Entries under Needs attention per reason; only with that filter on. */
  attentionKinds?: Record<string, number>;
  /**
   * Entries per size in parts, with every other filter applied, so each
   * size says what choosing it would show.
   */
  componentRanges?: Record<string, number>;
}

export interface GalleryFeedPage {
  entries: GalleryFeedEntry[];
  nextCursor: string | null;
  /** Whole filtered wall's size; null while a pre-totals API answers. */
  total: number | null;
  /** Counts across the filtered wall, before pagination, scoped to this viewer. */
  filterCounts?: GalleryQuickFilterCounts;
  /** Contributors to the filtered wall, before pagination. */
  authors?: GalleryAuthorOption[];
  /**
   * The search the server applied, echoed: then entries, totals and counts
   * are its answer. Absent, the server did not search.
   */
  search?: string;
}

/** A Gallery read's answer when only signed-in readers may see the Gallery. */
export const GALLERY_SIGN_IN_REQUIRED = "sign-in-required";
export type GalleryFeedResult =
  GalleryFeedPage | null | typeof GALLERY_SIGN_IN_REQUIRED;

export interface GalleryFeedState {
  status: "loading" | "ready" | "unavailable" | "signed-out";
  entries: GalleryFeedEntry[];
  nextCursor: string | null;
  total: number | null;
  /** Counts across the filtered wall, before pagination, scoped to this viewer. */
  filterCounts?: GalleryQuickFilterCounts;
  /** Contributors to the filtered wall, before pagination. */
  authors?: GalleryAuthorOption[];
  /** The search the server answered for these entries; "" for none. */
  search?: string;
}

/** Tag menu entries, newest count first, as the wall's tag bar shows them. */
export interface GalleryTagOption {
  tag: string;
  count: number;
}

export interface GalleryTagGroupOption {
  group: string;
  count: number;
}

export interface GalleryTagSummary {
  tags: GalleryTagOption[];
  groups: GalleryTagGroupOption[];
}

export interface GalleryLandingPreload {
  feed?: Promise<GalleryFeedResult>;
  /** The query the preloaded feed answers; see galleryFeedQueryKey. */
  feedQuery?: string;
  tags: Promise<GalleryTagSummary>;
  /** The filters the preloaded tag counts answer; see galleryTagScope. */
  tagsScope?: string;
  /** The circuit a "View in Gallery" link names, looked up by its id. */
  focus?: { id: string; entry: Promise<GalleryFeedEntry | null> };
}

/**
 * One stable key per combination of the filters that narrow tag counts: every
 * filter of the wall's query but its tag choice, which would otherwise zero
 * the tags beside the ones chosen. Taking the wall's own query means a filter
 * added to the wall narrows its tag counts too.
 */
export function galleryTagScope(query: GalleryFeedQuery): string {
  return galleryFeedParams({ ...query, tags: [] }).toString();
}

/** One public byline and its contribution to the current Gallery results. */
export interface GalleryAuthorOption {
  author: string;
  ownerUserId?: string | null;
  count: number;
}

function contributorKey(
  entry: Pick<GalleryAuthorOption, "author" | "ownerUserId">,
): string {
  return entry.ownerUserId
    ? `owner:${entry.ownerUserId}`
    : `legacy:${entry.author}`;
}

function rankContributors(
  authors: GalleryAuthorOption[],
): GalleryAuthorOption[] {
  return authors.sort(
    (a, b) => b.count - a.count || a.author.localeCompare(b.author),
  );
}

/** Search uses the same matching entries as the cards, including on older APIs. */
export function galleryAuthorsOf(
  entries: readonly GalleryFeedEntry[],
): GalleryAuthorOption[] {
  const authors = new Map<string, GalleryAuthorOption>();
  for (const entry of entries) {
    if (!entry.author.trim()) continue;
    const key = contributorKey(entry);
    const previous = authors.get(key);
    authors.set(key, {
      author:
        previous && previous.author > entry.author
          ? previous.author
          : entry.author,
      ownerUserId: entry.ownerUserId ?? null,
      count: (previous?.count ?? 0) + 1,
    });
  }
  return rankContributors([...authors.values()]);
}

/**
 * The name a wall narrowed to one contributor shows: the account's current
 * byline once the contributors answer for it, since a remembered filter or an
 * older link keeps the name the account had then; otherwise the filter's.
 */
export function galleryNarrowedByline(
  filter: { author: string | null; ownerUserId: string | null },
  authors: readonly GalleryAuthorOption[],
): string | null {
  const current = filter.ownerUserId
    ? authors.find((option) => option.ownerUserId === filter.ownerUserId)
    : undefined;
  return current?.author ?? filter.author;
}

/** Keep full-page aggregates current while a local removal awaits a refresh. */
export function removeGalleryAuthorEntry(
  authors: readonly GalleryAuthorOption[],
  entry: GalleryFeedEntry,
): GalleryAuthorOption[] {
  return rankContributors(
    authors
      .map((author) =>
        entry.author.trim() && contributorKey(author) === contributorKey(entry)
          ? { ...author, count: author.count - 1 }
          : author,
      )
      .filter((author) => author.count > 0),
  );
}

/** The server filters one wall asks for. */
export interface GalleryFeedQuery {
  /**
   * Words the server searches names, bylines, descriptions and tags for,
   * before it pages, so an older match comes back on the first page.
   */
  q?: string;
  author?: string | null;
  ownerUserId?: string | null;
  tags?: readonly string[];
  /** Only circuits whose drawing extracts to a netlist. */
  netlistable?: boolean;
  /** Only circuits the signed-in viewer has liked. */
  liked?: boolean;
  attention?: boolean;
  /** One reason Needs attention narrows to. */
  attentionKind?: string | null;
  /** Sizes by part count; any of them matches. */
  parts?: readonly string[];
}

function galleryFeedParams(query: GalleryFeedQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.attention) params.set("attention", "1");
  if (query.attention && query.attentionKind)
    params.set("reason", query.attentionKind);
  // An account narrows by its id; its byline then only labels the wall and
  // may be a former one, so it is sent only on its own.
  if (query.author && !query.ownerUserId) params.set("author", query.author);
  if (query.ownerUserId) params.set("owner", query.ownerUserId);
  if (query.tags && query.tags.length > 0) {
    params.set("tags", query.tags.join(","));
  }
  if (query.netlistable) params.set("netlistable", "1");
  if (query.liked) params.set("liked", "1");
  if (query.parts && query.parts.length > 0)
    params.set("parts", query.parts.join(","));
  return params;
}

/**
 * One key per first-page request: the landing preload and the wall compare
 * keys, so a preloaded page is reused only for the exact query it answers.
 */
export function galleryFeedQueryKey(query: GalleryFeedQuery): string {
  return galleryFeedParams(query).toString();
}

export async function loadGalleryFeed(
  fetchLike: typeof fetch = fetch,
  options: GalleryFeedQuery & {
    cursor?: string | null;
    limit?: number;
  } = {},
): Promise<GalleryFeedResult> {
  const params = galleryFeedParams(options);
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const query = params.toString();
  try {
    const response = await fetchLike(
      `/api/gallery${query ? `?${query}` : ""}`,
      { credentials: "same-origin" },
    );
    // The Gallery is for signed-in readers; say so instead of "unavailable".
    if (response.status === 401) return GALLERY_SIGN_IN_REQUIRED;
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      entries?: GalleryFeedEntry[];
      nextCursor?: unknown;
      total?: unknown;
      search?: unknown;
      filterCounts?: GalleryQuickFilterCounts;
      authors?: GalleryAuthorOption[];
    };
    return {
      entries: payload.entries ?? [],
      nextCursor:
        typeof payload.nextCursor === "string" ? payload.nextCursor : null,
      total: typeof payload.total === "number" ? payload.total : null,
      ...(typeof payload.search === "string" ? { search: payload.search } : {}),
      ...(Array.isArray(payload.authors) &&
      payload.authors.every(
        (author) =>
          author &&
          typeof author.author === "string" &&
          (author.ownerUserId == null ||
            typeof author.ownerUserId === "string") &&
          Number.isSafeInteger(author.count) &&
          author.count > 0,
      )
        ? { authors: payload.authors }
        : {}),
      ...(payload.filterCounts &&
      (["attention", "netlistable", "liked"] as const).every((key) => {
        const count = payload.filterCounts![key];
        return Number.isSafeInteger(count) && count >= 0;
      })
        ? {
            filterCounts: {
              attention: payload.filterCounts.attention,
              netlistable: payload.filterCounts.netlistable,
              liked: payload.filterCounts.liked,
              ...(payload.filterCounts.attentionKinds &&
              typeof payload.filterCounts.attentionKinds === "object" &&
              Object.values(payload.filterCounts.attentionKinds).every(
                (count) => Number.isSafeInteger(count) && count >= 0,
              )
                ? { attentionKinds: payload.filterCounts.attentionKinds }
                : {}),
              ...(payload.filterCounts.componentRanges &&
              typeof payload.filterCounts.componentRanges === "object" &&
              Object.values(payload.filterCounts.componentRanges).every(
                (count) => Number.isSafeInteger(count) && count >= 0,
              )
                ? { componentRanges: payload.filterCounts.componentRanges }
                : {}),
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * One circuit on the public wall, found by its id: what a "View in Gallery"
 * link shows at once, however far down the wall it would sit. Null when the
 * circuit is not on the public wall (withdrawn, rejected, unknown) or cannot
 * be read.
 */
export async function loadGalleryEntry(
  fetchLike: typeof fetch,
  id: string,
): Promise<GalleryFeedEntry | null> {
  try {
    const response = await fetchLike(`/api/gallery/${encodeURIComponent(id)}`, {
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      entry?: GalleryFeedEntry;
      status?: string;
    };
    return payload.status === "public" && payload.entry?.id === id
      ? payload.entry
      : null;
  } catch {
    return null;
  }
}

/** The grouped tag menu. An unreachable worker leaves the menu empty. */
export async function loadGalleryTagSummary(
  fetchLike: typeof fetch = fetch,
  options: GalleryFeedQuery = {},
): Promise<GalleryTagSummary> {
  try {
    const scope = galleryTagScope(options);
    const response = await fetchLike(
      `/api/gallery/tags${scope ? `?${scope}` : ""}`,
      {
        credentials: "same-origin",
      },
    );
    if (!response.ok) return { tags: [], groups: [] };
    const payload = (await response.json()) as Partial<GalleryTagSummary>;
    return { tags: payload.tags ?? [], groups: payload.groups ?? [] };
  } catch {
    return { tags: [], groups: [] };
  }
}

/** Backward-compatible tag-only reader for the Editor's narrow Gallery dock. */
export async function loadGalleryTags(
  fetchLike: typeof fetch = fetch,
): Promise<GalleryTagOption[]> {
  return (await loadGalleryTagSummary(fetchLike)).tags;
}

/**
 * The wall's size in words, said only when the server has said it: a
 * pre-totals API or a still-loading feed renders nothing rather than a guess.
 * "Filtered" names the server-side narrowing (author, tags); "match" belongs
 * to the text query, whose clause counts VISIBLE entries and says "so far"
 * until the feed is exhausted.
 */
/**
 * A refresh of the wall already on screen answers only its newest page. The
 * older pages already loaded stay behind it, so a search over them does not
 * blink out and back while the loader pages through the wall again. Entries
 * older than the new page's cursor are kept, in the server's order.
 */
export function withLoadedTail<
  T extends { entries: GalleryFeedEntry[]; nextCursor: string | null },
>(
  previous: { entries: readonly GalleryFeedEntry[]; nextCursor: string | null },
  page: T,
): T {
  if (page.nextCursor === null) return page;
  const boundary = page.nextCursor;
  const tail = previous.entries.filter(
    (entry) => `${entry.createdAt}|${entry.id}` < boundary,
  );
  return tail.length === 0
    ? page
    : {
        ...page,
        entries: [...page.entries, ...tail],
        nextCursor: previous.nextCursor,
      };
}

export function galleryCountLabel(
  total: number | null,
  options: {
    filtered?: boolean;
    search?: { visible: number; settled: boolean } | null;
    /** The server answered the search: the total is its matches. */
    searched?: boolean;
  } = {},
): string | null {
  if (total === null) return null;
  const noun = total === 1 ? "circuit" : "circuits";
  if (options.searched) return `${total.toLocaleString()} matching ${noun}`;
  const base = `${total.toLocaleString()} ${
    options.filtered ? `filtered ${noun}` : noun
  }`;
  const search = options.search ?? null;
  const clause = search
    ? ` · ${search.visible} ${search.visible === 1 ? "match" : "matches"}${
        search.settled ? "" : " so far"
      }`
    : "";
  return `${base}${clause}`;
}
