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
