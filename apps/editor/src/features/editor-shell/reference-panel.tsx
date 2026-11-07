import { useEffect, useRef, useState } from "react";

import "../../styles/review-page.css";
import "./reference-panel.css";
import { MarkablePicture } from "../../components/review-picture";
import { gallerySourceOfEntryId } from "../../gallery-sources";

/**
 * The figure a Gallery drawing was drawn from: a dataset's original figure,
 * or the reference image a community circuit's author gave. Null when it
 * has none (or the reader may not see it).
 */
async function referenceOf(
  id: string,
  fetchLike: typeof fetch,
): Promise<{ blob: Blob; label: string } | null> {
  const source = gallerySourceOfEntryId(id);
  if (source && !source.comparisons) return null;
  const response = await fetchLike(
    source
      ? `/api/gallery/sources/${source.key}/comparisons/${encodeURIComponent(id)}/figure`
      : `/api/gallery/${encodeURIComponent(id)}/reference`,
    { credentials: "same-origin" },
  ).catch(() => null);
  if (!response?.ok) return null;
  return {
    blob: await response.blob(),
    label: source ? `Original · ${source.name}` : "Reference image",
  };
}

type Place = { left: number; top: number };

/**
 * Beside the canvas, the figure the opened Gallery drawing was drawn from,
 * to redraw or fix it against: it floats over the editor, moves by its
 * title bar, resizes from its corner, zooms with the wheel and pans with a
 * drag. Closed, a small Reference button at the corner brings it back.
 */
export function ReferencePanel({
  entryId,
  fetchLike = fetch,
}: {
  entryId: string;
  fetchLike?: typeof fetch;
}) {
  const [figure, setFigure] = useState<{ src: string; label: string } | null>(
    null,
  );
  const [open, setOpen] = useState(true);
  const [folded, setFolded] = useState(false);
  // Bottom right of the window at first, above the status bar.
  const [place, setPlace] = useState<Place>(() => ({
    left: Math.max(8, window.innerWidth - 404),
    top: Math.max(60, window.innerHeight - 376),
  }));
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; from: Place } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    void referenceOf(entryId, fetchLike).then((found) => {
      if (cancelled || !found) return;
      url = URL.createObjectURL(found.blob);
      setFigure({ src: url, label: found.label });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [entryId, fetchLike]);

  if (!figure) return null;
  if (!open)
    return (
      <button
        type="button"
        className="reference-panel-reopen"
        data-testid="reference-panel-reopen"
        title="Show the figure this drawing was drawn from"
        onClick={() => setOpen(true)}
      >
        Reference
      </button>
    );
  return (
    <div
      ref={panel}
      className={`reference-panel${folded ? " folded" : ""}`}
      data-testid="reference-panel"
      role="complementary"
      aria-label="Reference figure"
      style={{ left: place.left, top: place.top }}
    >
      <div
        className="reference-panel-head"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          const rect = panel.current!.getBoundingClientRect();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            from: { left: rect.left, top: rect.top },
          };
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (!from) return;
          const width = panel.current?.offsetWidth ?? 0;
          setPlace({
            left: Math.min(
              window.innerWidth - 60,
              Math.max(60 - width, from.from.left + event.clientX - from.x),
            ),
            top: Math.min(
              window.innerHeight - 30,
              Math.max(0, from.from.top + event.clientY - from.y),
            ),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <span className="title">{figure.label}</span>
        <span className="hint">wheel zooms · drag pans</span>
        <button
          type="button"
          title={folded ? "Show the figure" : "Fold to the title bar"}
          aria-label={folded ? "Show the figure" : "Fold"}
          onClick={() => setFolded((value) => !value)}
        >
          {folded ? "▢" : "–"}
        </button>
        <button
          type="button"
          title="Close (the Reference button brings it back)"
          aria-label="Close"
          onClick={() => setOpen(false)}
        >
          ×
        </button>
      </div>
      {folded ? null : (
        <MarkablePicture
          src={figure.src}
          alt="Reference figure"
          side="original"
          marks={[]}
          zoomed
        />
      )}
    </div>
  );
}
