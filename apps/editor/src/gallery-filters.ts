/**
 * The Gallery's "show me only…" state, in one shape.
 *
 * It lives in three places at once and this module owns the translation
 * between them: React state while the reader is on the wall, the URL so a
 * link and the Back button carry the same slice, and browser storage so
 * opening a circuit and coming back does not silently widen the wall again.
 * Narrowing by author, by tag, by text, and the two marks are all one kind
 * of thing to a reader, so they persist as one thing.
 */

export type GalleryView = "gallery" | "shelf";

export interface GalleryFilterState {
  /** Which wall: the community gallery, or the reader's own shelf. */
  view: GalleryView;
  attention: boolean;
  author: string | null;
  /** Stable identity for the selected author; null for legacy links/entries. */
  ownerUserId: string | null;
  tags: string[];
  /** Free text over name, author, description and tags. */
  search: string;
  /** Only circuits whose drawing extracts to a netlist. */
  netlistable: boolean;
  /** Only circuits this viewer has liked. */
  liked: boolean;
}

export const GALLERY_FILTERS_KEY = "icm.gallery-filters.v1";

/** Bounds on restored text, so a hand-edited store cannot grow a query. */
const MAX_FILTER_LENGTH = 200;
const MAX_FILTER_TAGS = 256;

/**
 * The narrowing parameters, as distinct from `view`. A link that names one of
 * them is a request for exactly that slice, so it replaces the stored
 * preference outright instead of intersecting with it.
 */
const NARROWING_PARAMS = [
  "author",
  "owner",
  "tags",
  "q",
  "netlist",
  "liked",
  "attention",
] as const;

export function createDefaultGalleryFilters(): GalleryFilterState {
  return {
    view: "gallery",
    attention: false,
    author: null,
    ownerUserId: null,
    tags: [],
    search: "",
    netlistable: false,
    liked: false,
  };
}

/** Whether the wall is a slice rather than everything published. */
export function galleryFiltersNarrowWall(filters: GalleryFilterState): boolean {
  return (
    filters.author !== null ||
    filters.ownerUserId !== null ||
    filters.tags.length > 0 ||
    filters.search.trim().length > 0 ||
    filters.netlistable ||
    filters.liked ||
    filters.attention
  );
}

/**
 * Whether the server does the narrowing. The text query is answered in the
 * browser over what has loaded, so it never speaks for the wall's total.
 */
export function galleryFiltersNarrowQuery(
  filters: GalleryFilterState,
): boolean {
  return (
    filters.author !== null ||
    filters.ownerUserId !== null ||
    filters.tags.length > 0 ||
    filters.netlistable ||
    filters.liked ||
    filters.attention
  );
}

function boundedTags(values: readonly unknown[]): string[] {
  const tags: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const tag = value.trim().slice(0, MAX_FILTER_LENGTH);
    if (tag.length === 0 || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length === MAX_FILTER_TAGS) break;
  }
  return tags;
}

export function parseGalleryFilterQuery(search: string): {
  filters: GalleryFilterState;
  /** The URL names at least one narrowing parameter. */
  narrowed: boolean;
  /** The URL names the wall, so the stored wall must not override it. */
  namesView: boolean;
} {
  const params = new URLSearchParams(search);
  const author = params.get("author")?.trim() ?? "";
  const ownerUserId = params.get("owner")?.trim() ?? "";
  return {
    filters: {
      view: params.get("view") === "shelf" ? "shelf" : "gallery",
      author: author.length > 0 ? author.slice(0, MAX_FILTER_LENGTH) : null,
      ownerUserId:
        ownerUserId.length > 0 ? ownerUserId.slice(0, MAX_FILTER_LENGTH) : null,
      tags: boundedTags((params.get("tags") ?? "").split(",")),
      search: (params.get("q") ?? "").slice(0, MAX_FILTER_LENGTH),
      netlistable: params.get("netlist") === "1",
      liked: params.get("liked") === "1",
      attention: params.get("attention") === "1",
    },
    narrowed: NARROWING_PARAMS.some((name) => (params.get(name) ?? "") !== ""),
    namesView: params.has("view"),
  };
}

/**
 * The filters written back over a location's own query, leaving every
 * unrelated parameter (a preview seed, a campaign tag) where it was.
 */
export function galleryFilterSearch(
  currentSearch: string,
  filters: GalleryFilterState,
): string {
  const params = new URLSearchParams(currentSearch);
  const set = (name: string, value: string | null): void => {
    if (value) params.set(name, value);
    else params.delete(name);
  };
  set("view", filters.view === "shelf" ? "shelf" : null);
  set("author", filters.author);
  set("owner", filters.ownerUserId);
  set("tags", filters.tags.length > 0 ? filters.tags.join(",") : null);
  set("q", filters.search.trim().length > 0 ? filters.search : null);
  set("netlist", filters.netlistable ? "1" : null);
  set("liked", filters.liked ? "1" : null);
  // Category filtering was retired in favor of one tag vocabulary. Remove
  // old links instead of preserving a parameter the Gallery no longer reads.
  params.delete("category");
  set("attention", filters.attention ? "1" : null);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

/** A stored preference, or null when there is nothing legible to restore. */
export function parseStoredGalleryFilters(
  raw: string | null,
): GalleryFilterState | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const author = typeof record.author === "string" ? record.author.trim() : "";
  const ownerUserId =
    typeof record.ownerUserId === "string" ? record.ownerUserId.trim() : "";
  return {
    view: record.view === "shelf" ? "shelf" : "gallery",
    author: author.length > 0 ? author.slice(0, MAX_FILTER_LENGTH) : null,
    ownerUserId:
      ownerUserId.length > 0 ? ownerUserId.slice(0, MAX_FILTER_LENGTH) : null,
    tags: boundedTags(Array.isArray(record.tags) ? record.tags : []),
    search:
      typeof record.search === "string"
        ? record.search.slice(0, MAX_FILTER_LENGTH)
        : "",
    netlistable: record.netlistable === true,
    liked: record.liked === true,
    attention: record.attention === true,
  };
}

/**
 * The filters the wall opens with. A link that narrows the wall wins outright
 * — it is somebody's request for that slice — and otherwise the reader's own
 * last choice is restored, including the empty one they cleared on purpose.
 */
export function resolveGalleryFilters(
  search: string,
  storedRaw: string | null,
): GalleryFilterState {
  const { filters, narrowed, namesView } = parseGalleryFilterQuery(search);
  const stored = parseStoredGalleryFilters(storedRaw);
  if (narrowed || !stored) return filters;
  return { ...stored, view: namesView ? filters.view : stored.view };
}
