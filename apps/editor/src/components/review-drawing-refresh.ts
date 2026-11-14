import { subscribeGalleryRefresh } from "../gallery-client";

/** A Review card's drawing as the Gallery now holds it. */
export interface ReviewDrawingChange {
  previewRevision: string;
  fixedBy?: string[];
}

interface EntrySummary {
  entry?: { previewRevision?: unknown; fixedBy?: unknown };
}

/**
 * Keep one Review card on the drawing the Gallery holds (#2304). Open puts the
 * drawing in an editor tab, often a window beside Review: its publication
 * reaches Review at once by the same-browser Gallery change message, and
 * Review becoming the active view again (focus or visibility) reads the entry.
 * `revision` reads the card's current revision. A revision the card has left
 * is never shown again, so a read answered before the publication arrived
 * cannot bring the old drawing back.
 */
export function followReviewDrawing(
  entryId: string,
  revision: () => string,
  onChange: (change: ReviewDrawingChange) => void,
  fetchLike: typeof fetch = fetch,
): () => void {
  let closed = false;
  const left = new Set<string>();
  // Shown, though the card may not hold it yet.
  let shown: string | null = null;
  // A publication shows its revision before the entry's details are read.
  let detailsOf: string | null = null;
  const isNew = (next: string) =>
    next !== revision() && next !== shown && !left.has(next);
  const show = (change: ReviewDrawingChange) => {
    left.add(revision());
    if (shown) left.add(shown);
    shown = change.previewRevision;
    onChange(change);
  };
  const read = () =>
    fetchLike(`/api/gallery/${encodeURIComponent(entryId)}?summary=1`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: EntrySummary | null) => {
        const entry = payload?.entry;
        const next = entry?.previewRevision;
        if (closed || typeof next !== "string" || !next || left.has(next))
          return;
        const fixedBy = Array.isArray(entry?.fixedBy)
          ? entry.fixedBy.filter(
              (name): name is string => typeof name === "string",
            )
          : undefined;
        if (isNew(next))
          show({ previewRevision: next, ...(fixedBy ? { fixedBy } : {}) });
        else if (detailsOf === next && fixedBy)
          onChange({ previewRevision: next, fixedBy });
        if (detailsOf === next) detailsOf = null;
      })
      .catch(() => undefined);
  const unsubscribe = subscribeGalleryRefresh((change) => {
    if (change && change.entryId !== entryId) return;
    const published = change?.previewRevision;
    if (published && isNew(published)) {
      show({ previewRevision: published });
      detailsOf = published;
    }
    void read();
  });
  return () => {
    closed = true;
    unsubscribe();
  };
}
