import type { GalleryAttention } from "../../../worker/gallery-curation";
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
    ? `${path}?v=${encodeURIComponent(previewRevision)}&render=formula-sans-v2`
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
  likes?: number;
  likedByViewer?: boolean;
}

export interface GalleryQuickFilterCounts {
  attention: number;
  netlistable: number;
  liked: number;
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
}

export interface GalleryFeedState {
  status: "loading" | "ready" | "unavailable";
  entries: GalleryFeedEntry[];
  nextCursor: string | null;
  total: number | null;
  /** Counts across the filtered wall, before pagination, scoped to this viewer. */
  filterCounts?: GalleryQuickFilterCounts;
  /** Contributors to the filtered wall, before pagination. */
  authors?: GalleryAuthorOption[];
}

function normalizeGallerySearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** One insertion, deletion, replacement, or adjacent transposition. */
function galleryTokensWithinOneEdit(left: string, right: string): boolean {
  const lengthDifference = left.length - right.length;
  if (Math.abs(lengthDifference) > 1) return false;
  if (left === right) return true;
  if (lengthDifference === 0) {
    const mismatches: number[] = [];
    for (let index = 0; index < left.length; index++) {
      if (left[index] === right[index]) continue;
      mismatches.push(index);
      if (mismatches.length > 2) return false;
    }
    if (mismatches.length === 1) return true;
    const [first, second] = mismatches;
    return (
      second === first! + 1 &&
      left[first!] === right[second!] &&
      left[second!] === right[first!]
    );
  }
  const shorter = lengthDifference < 0 ? left : right;
  const longer = lengthDifference < 0 ? right : left;
  let shorterIndex = 0;
  let longerIndex = 0;
  let skipped = false;
  while (shorterIndex < shorter.length && longerIndex < longer.length) {
    if (shorter[shorterIndex] === longer[longerIndex]) {
      shorterIndex++;
      longerIndex++;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longerIndex++;
  }
  return true;
}

function gallerySearchTokenMatches(query: string, candidate: string): boolean {
  if (candidate.includes(query)) return true;
  // Keep short circuit acronyms precise: fuzzy matching OTA against every
  // three-letter neighbour creates more noise than it removes.
  if (query.length < 4 || candidate.length < 4) return false;
  if (!/^[a-z0-9]+$/u.test(query) || !/^[a-z0-9]+$/u.test(candidate)) {
    return false;
  }
  return galleryTokensWithinOneEdit(query, candidate);
}

/**
 * Whether one entry answers a search over its name, author, description and
 * tags. Exact case-insensitive containment wins first; otherwise every query
 * word may tolerate one small Latin-letter typo.
 */
export function galleryEntryMatchesQuery(
  entry: Pick<GalleryFeedEntry, "name" | "author" | "description" | "tags">,
  query: string,
): boolean {
  const normalizedQuery = normalizeGallerySearchText(query);
  if (!normalizedQuery) return true;
  const fields = [
    entry.name,
    entry.author,
    entry.description,
    ...(entry.tags ?? []),
  ]
    .filter((field): field is string => Boolean(field))
    .map(normalizeGallerySearchText)
    .filter(Boolean);
  if (fields.some((field) => field.includes(normalizedQuery))) return true;
  const candidates = fields.flatMap((field) => field.split(" "));
  return normalizedQuery
    .split(" ")
    .every((token) =>
      candidates.some((candidate) =>
        gallerySearchTokenMatches(token, candidate),
      ),
    );
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
  feed?: Promise<GalleryFeedPage | null>;
  tags: Promise<GalleryTagSummary>;
  tagsNetlistable?: boolean;
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

export async function loadGalleryFeed(
  fetchLike: typeof fetch = fetch,
  options: {
    cursor?: string | null;
    author?: string | null;
    ownerUserId?: string | null;
    tags?: readonly string[];
    /** Only circuits whose drawing extracts to a netlist. */
    netlistable?: boolean;
    /** Only circuits the signed-in viewer has liked. */
    liked?: boolean;
    limit?: number;
    attention?: boolean;
  } = {},
): Promise<GalleryFeedPage | null> {
  const params = new URLSearchParams();
  if (options.attention) params.set("attention", "1");
  if (options.author) params.set("author", options.author);
  if (options.ownerUserId) params.set("owner", options.ownerUserId);
  if (options.tags && options.tags.length > 0) {
    params.set("tags", options.tags.join(","));
  }
  if (options.netlistable) params.set("netlistable", "1");
  if (options.liked) params.set("liked", "1");
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
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
      filterCounts?: GalleryQuickFilterCounts;
      authors?: GalleryAuthorOption[];
    };
    return {
      entries: payload.entries ?? [],
      nextCursor:
        typeof payload.nextCursor === "string" ? payload.nextCursor : null,
      total: typeof payload.total === "number" ? payload.total : null,
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
      ["attention", "netlistable", "liked"].every((key) => {
        const count =
          payload.filterCounts![key as keyof GalleryQuickFilterCounts];
        return Number.isSafeInteger(count) && count >= 0;
      })
        ? { filterCounts: payload.filterCounts }
        : {}),
    };
  } catch {
    return null;
  }
}

/** The public contributors ranked by how many circuits they have shared. */
export async function loadGalleryAuthors(
  fetchLike: typeof fetch = fetch,
): Promise<GalleryAuthorOption[] | null> {
  try {
    const response = await fetchLike("/api/gallery/authors", {
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      authors?: GalleryAuthorOption[];
    };
    return payload.authors ?? [];
  } catch {
    return null;
  }
}

/** The grouped tag menu. An unreachable worker leaves the menu empty. */
export async function loadGalleryTagSummary(
  fetchLike: typeof fetch = fetch,
  options: { netlistable?: boolean } = {},
): Promise<GalleryTagSummary> {
  try {
    const response = await fetchLike(
      `/api/gallery/tags${options.netlistable ? "?netlistable=1" : ""}`,
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
export function galleryCountLabel(
  total: number | null,
  options: {
    filtered?: boolean;
    search?: { visible: number; settled: boolean } | null;
  } = {},
): string | null {
  if (total === null) return null;
  const noun = total === 1 ? "circuit" : "circuits";
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
