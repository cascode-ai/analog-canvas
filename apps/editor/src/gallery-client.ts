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
    ? `${path}?v=${encodeURIComponent(previewRevision)}`
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
  id: string;
  name: string;
  author: string;
  description: string;
  createdAt: string;
  /** Absent only while a newer client is rolling out against an older API. */
  previewRevision?: string;
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

export interface GalleryFeedPage {
  entries: GalleryFeedEntry[];
  nextCursor: string | null;
  /** Whole filtered wall's size; null while a pre-totals API answers. */
  total: number | null;
}

export interface GalleryFeedState {
  status: "loading" | "ready" | "unavailable";
  entries: GalleryFeedEntry[];
  nextCursor: string | null;
  total: number | null;
}

/**
 * Whether one entry answers a search. Case-insensitive substring over the
 * fields a person would search by: what it is called, who drew it, what it
 * says about itself, and how it is tagged.
 */
export function galleryEntryMatchesQuery(
  entry: Pick<GalleryFeedEntry, "name" | "author" | "description" | "tags">,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  return [entry.name, entry.author, entry.description, ...(entry.tags ?? [])]
    .filter((field): field is string => Boolean(field))
    .some((field) => field.toLowerCase().includes(normalizedQuery));
}

/** Tag menu entries, newest count first, as the wall's tag bar shows them. */
export interface GalleryTagOption {
  tag: string;
  count: number;
}

export async function loadGalleryFeed(
  fetchLike: typeof fetch = fetch,
  options: {
    cursor?: string | null;
    author?: string | null;
    tags?: readonly string[];
  } = {},
): Promise<GalleryFeedPage | null> {
  const params = new URLSearchParams();
  if (options.author) params.set("author", options.author);
  if (options.tags && options.tags.length > 0) {
    params.set("tags", options.tags.join(","));
  }
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
      total?: unknown;
    };
    return {
      entries: payload.entries ?? [],
      nextCursor:
        typeof payload.nextCursor === "string" ? payload.nextCursor : null,
      total: typeof payload.total === "number" ? payload.total : null,
    };
  } catch {
    return null;
  }
}

/** The tag menu's options. An unreachable worker leaves the menu empty. */
export async function loadGalleryTags(
  fetchLike: typeof fetch = fetch,
): Promise<GalleryTagOption[]> {
  try {
    const response = await fetchLike("/api/gallery/tags", {
      credentials: "same-origin",
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      tags?: GalleryTagOption[];
    };
    return payload.tags ?? [];
  } catch {
    return [];
  }
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
