import { useEffect, useRef, useState, type ReactNode } from "react";

import "../../styles/review-page.css";
import "./reference-panel.css";
import { MarkablePicture } from "../../components/review-picture";
import { gallerySourceOfEntryId } from "../../gallery-sources";
import type { GalleryEntryContext } from "./gallery-example-commands";

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
 * A figure floating over the editor: it moves by its title bar, resizes
 * from its corner, folds to its title bar and closes from it.
 */
function ReferenceFloat({
  title,
  hint,
  closeTitle,
  onClose,
  actions,
  start,
  compact = false,
  testId,
  children,
}: {
  title: string;
  hint: string;
  closeTitle: string;
  onClose: () => void;
  actions?: ReactNode;
  start: () => Place;
  /** Text alone: the panel sizes to it. */
  compact?: boolean;
  testId: string;
  children: ReactNode;
}) {
  const [folded, setFolded] = useState(false);
  const [place, setPlace] = useState<Place>(start);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; from: Place } | null>(null);
  return (
    <div
      ref={panel}
      className={`reference-panel${folded ? " folded" : ""}${compact ? " compact" : ""}`}
      data-testid={testId}
      role="complementary"
      aria-label={title}
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
        <span className="title">{title}</span>
        <span className="hint">{hint}</span>
        {actions}
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
          title={closeTitle}
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {folded ? null : children}
    </div>
  );
}

/**
 * Beside the canvas, the opened Gallery circuit's name and description and
 * the figure it was drawn from, if any, to redraw or fix it against; the
 * figure zooms with the wheel and pans with a drag. Closed, a small button at
 * the corner brings it back.
 */
export function ReferencePanel({
  entry,
  fetchLike = fetch,
}: {
  entry: Pick<GalleryEntryContext, "id" | "name" | "description">;
  fetchLike?: typeof fetch;
}) {
  // Undefined while the figure loads, null when there is none.
  const [figure, setFigure] = useState<
    { src: string; label: string } | null | undefined
  >(undefined);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    void referenceOf(entry.id, fetchLike).then((found) => {
      if (cancelled) return;
      if (found) url = URL.createObjectURL(found.blob);
      setFigure(found && url ? { src: url, label: found.label } : null);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // A publication renews the entry: read its figure again, which Publish
    // may just have given it.
  }, [entry, fetchLike]);

  if (figure === undefined) return null;
  const description = entry.description.trim();
  if (!open)
    return (
      <button
        type="button"
        className="reference-panel-reopen"
        data-testid="reference-panel-reopen"
        title={
          figure
            ? "Show the figure this drawing was drawn from"
            : "Show this circuit's name and description"
        }
        onClick={() => setOpen(true)}
      >
        {figure ? "Reference" : "About"}
      </button>
    );
  return (
    <ReferenceFloat
      title={figure ? figure.label : "About"}
      hint={figure ? "wheel zooms · drag pans" : ""}
      closeTitle={`Close (the ${figure ? "Reference" : "About"} button brings it back)`}
      onClose={() => setOpen(false)}
      // Bottom right of the window at first, above the status bar.
      start={() => ({
        left: Math.max(8, window.innerWidth - 404),
        top: Math.max(60, window.innerHeight - (figure ? 376 : 270)),
      })}
      compact={!figure}
      testId="reference-panel"
    >
      <div
        className="reference-panel-about"
        data-testid="reference-panel-about"
      >
        <strong>{entry.name}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {figure ? (
        <MarkablePicture
          src={figure.src}
          alt="Reference figure"
          side="original"
          marks={[]}
          zoomed
        />
      ) : null}
    </ReferenceFloat>
  );
}

/** The first image among pasted, dropped or chosen files. */
const imageAmong = (files: FileList | null | undefined) =>
  [...(files ?? [])].find((file) => file.type.startsWith("image/")) ?? null;

/**
 * The reader's own figure to trace over, opened from Edit: a screenshot
 * pasted (⌘V / Ctrl+V), an image dropped, or a file chosen. It stays in
 * this page unless Publish is asked to publish it with the drawing.
 */
export function OwnReferencePanel({
  src,
  onImage,
  takesPaste,
  onClose,
}: {
  /** The image shown, or null for the drop target. */
  src: string | null;
  onImage: (file: File) => void;
  /** Whether a paste may be the figure (no text field or circuit takes it). */
  takesPaste: (event: ClipboardEvent) => boolean;
  onClose: () => void;
}) {
  const [over, setOver] = useState(false);
  const chooser = useRef<HTMLInputElement>(null);
  const take = (file: File | null) => {
    if (file) onImage(file);
  };
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (!takesPaste(event)) return;
      const image = imageAmong(event.clipboardData?.files);
      if (!image) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onImage(image);
    };
    window.addEventListener("paste", paste, true);
    return () => window.removeEventListener("paste", paste, true);
  }, [onImage, takesPaste]);
  return (
    <ReferenceFloat
      title="Reference image"
      hint={src ? "wheel zooms · drag pans" : "paste, drop or choose"}
      closeTitle="Close (Edit › Reference image… brings it back)"
      onClose={onClose}
      actions={
        src ? (
          <button
            type="button"
            title="Use another image"
            aria-label="Use another image"
            onClick={() => chooser.current?.click()}
          >
            ⟳
          </button>
        ) : null
      }
      // Bottom left of the canvas at first, clear of the Gallery's panel.
      start={() => ({
        left: Math.min(300, Math.max(8, window.innerWidth - 404)),
        top: Math.max(60, window.innerHeight - 376),
      })}
      testId="own-reference-panel"
    >
      <div
        className={`own-reference-body${over ? " over" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          take(imageAmong(event.dataTransfer.files));
        }}
      >
        {src ? (
          <MarkablePicture
            src={src}
            alt="Reference image"
            side="original"
            marks={[]}
            zoomed
          />
        ) : (
          <button
            type="button"
            className="own-reference-empty"
            data-testid="own-reference-choose"
            onClick={() => chooser.current?.click()}
          >
            <strong>Paste a screenshot</strong> (⌘V / Ctrl+V)
            <br />
            or drop an image here, or click to choose a file
          </button>
        )}
      </div>
      <input
        ref={chooser}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const chosen = imageAmong(event.currentTarget.files);
          event.currentTarget.value = "";
          take(chosen);
        }}
      />
    </ReferenceFloat>
  );
}
