import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import "../../styles/review-page.css";
import "./reference-panel.css";
import type { SessionUser } from "../../components/account";
import { MarkablePicture } from "../../components/review-picture";
import { gallerySourceOfEntryId } from "../../gallery-sources";
import { REFERENCE_SAVED, uploadReferenceImage } from "../../reference-image";
import type { GalleryEntryContext } from "./gallery-example-commands";
import type { OwnReferenceImage } from "./own-reference";

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

type Box = { left: number; top: number; width: number; height: number };
type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const EDGES: readonly Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const MIN_WIDTH = 240;
const MIN_HEIGHT = 160;

/**
 * Follow one pointer from its press to its release, the page selecting
 * nothing meanwhile: a drag over the canvas or text must not select it.
 */
function follow(
  event: ReactPointerEvent<HTMLElement>,
  move: (dx: number, dy: number) => void,
): void {
  event.preventDefault();
  window.getSelection()?.removeAllRanges();
  const target = event.currentTarget;
  target.setPointerCapture(event.pointerId);
  const x = event.clientX;
  const y = event.clientY;
  document.documentElement.classList.add("reference-gesture");
  const onMove = (next: PointerEvent) =>
    move(next.clientX - x, next.clientY - y);
  const end = () => {
    document.documentElement.classList.remove("reference-gesture");
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", end);
    target.removeEventListener("pointercancel", end);
  };
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
}

/** A box kept on screen, at least its minimum size. */
function onScreen(box: Box): Box {
  const width = Math.min(Math.max(box.width, MIN_WIDTH), window.innerWidth);
  const height = Math.min(Math.max(box.height, MIN_HEIGHT), window.innerHeight);
  return {
    width,
    height,
    left: Math.min(Math.max(box.left, 60 - width), window.innerWidth - 60),
    top: Math.min(Math.max(box.top, 0), window.innerHeight - 30),
  };
}

// Where the window was and whether it was folded, kept across tabs and
// closing.
const remembered: { box: Box | null; folded: boolean } = {
  box: null,
  folded: false,
};

/**
 * A window floating over the editor: it moves by its title bar, resizes
 * from any edge or corner, folds to its title bar and closes from it.
 */
function ReferenceFloat({
  title,
  hint,
  onClose,
  actions,
  children,
  footer,
}: {
  title: string;
  hint: string;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [folded, setFolded] = useState(remembered.folded);
  // At first in the canvas's bottom-right corner, clear of the side panels.
  const [box, setBox] = useState<Box>(() => {
    if (remembered.box) return onScreen(remembered.box);
    const canvas = document
      .querySelector('[data-testid="schematic-canvas"]')
      ?.getBoundingClientRect();
    const area = canvas ?? {
      left: 0,
      top: 60,
      right: window.innerWidth,
      bottom: window.innerHeight - 40,
      width: window.innerWidth,
      height: window.innerHeight - 100,
    };
    const width = Math.min(380, Math.max(MIN_WIDTH, area.width * 0.45));
    const height = Math.min(420, Math.max(MIN_HEIGHT, area.height - 24));
    return onScreen({
      left: area.right - width - 12,
      top: area.bottom - height - 12,
      width,
      height,
    });
  });
  useEffect(() => {
    remembered.box = box;
    remembered.folded = folded;
  }, [box, folded]);
  // A smaller browser window keeps it in view.
  useEffect(() => {
    const keep = () => setBox((current) => onScreen(current));
    window.addEventListener("resize", keep);
    return () => window.removeEventListener("resize", keep);
  }, []);
  const resize = (edge: Edge) => (event: ReactPointerEvent<HTMLElement>) => {
    const from = box;
    follow(event, (dx, dy) => {
      const next = { ...from };
      if (edge.includes("e")) next.width = from.width + dx;
      if (edge.includes("s")) next.height = from.height + dy;
      if (edge.includes("w")) {
        next.width = Math.max(MIN_WIDTH, from.width - dx);
        next.left = from.left + from.width - next.width;
      }
      if (edge.includes("n")) {
        next.height = Math.max(MIN_HEIGHT, from.height - dy);
        next.top = from.top + from.height - next.height;
      }
      setBox(onScreen(next));
    });
  };
  return (
    <div
      className={`reference-panel${folded ? " folded" : ""}`}
      data-testid="reference-panel"
      role="complementary"
      aria-label="Reference"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        ...(folded ? {} : { height: box.height }),
      }}
    >
      <div
        className="reference-panel-head"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          const from = box;
          follow(event, (dx, dy) =>
            setBox(
              onScreen({ ...from, left: from.left + dx, top: from.top + dy }),
            ),
          );
        }}
      >
        <span className="title">{title}</span>
        <span className="hint">{hint}</span>
        {actions}
        <button
          type="button"
          title={folded ? "Show the window" : "Fold to the title bar"}
          aria-label={folded ? "Unfold" : "Fold"}
          onClick={() => setFolded((value) => !value)}
        >
          {folded ? "▢" : "–"}
        </button>
        <button
          type="button"
          title="Close (Reference in the status bar brings it back)"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {folded ? null : children}
      {folded ? null : footer}
      {EDGES.filter((edge) => !folded || edge === "e" || edge === "w").map(
        (edge) => (
          <div
            key={edge}
            className={`reference-resize ${edge}`}
            aria-hidden="true"
            onPointerDown={resize(edge)}
          />
        ),
      )}
    </div>
  );
}

/** The first image among pasted, dropped or chosen files. */
const imageAmong = (files: FileList | null | undefined) =>
  [...(files ?? [])].find((file) => file.type.startsWith("image/")) ?? null;

// Images already saved as their entry's reference image.
const uploaded = new WeakSet<File>();

export interface ReferenceWindowProps {
  open: boolean;
  onClose: () => void;
  /** The Gallery entry the drawing came from or was published as, if any. */
  entry: GalleryEntryContext | null;
  session: Pick<SessionUser, "id" | "isAdmin" | "role" | "isOwner"> | null;
  /** An unpublished drawing's name and description, as last saved. */
  draft: { name: string; description: string };
  /** The image the reader brought for this drawing, if any. */
  image: OwnReferenceImage | null;
  onImage: (file: File) => void;
  /** Whether a paste may be the image (no text field or circuit takes it). */
  takesPaste: (event: ClipboardEvent) => boolean;
  /** Saved: the editor keeps the name and description with the drawing. */
  onSaved: (fields: { name: string; description: string }) => void;
  fetchLike?: typeof fetch;
}

/**
 * Beside the canvas, the drawing's name, description and reference image,
 * in every drawing from the start: the image to trace over is pasted
 * (⌘V / Ctrl+V), dropped or chosen, and zooms with the wheel and pans with
 * a drag. Save keeps the name and description with an unpublished drawing
 * (Publish starts from them); for a Gallery entry its owner or the Owner
 * may change, it saves them, and the image, to the entry at once. Closed,
 * the status bar's Reference button brings it back.
 */
export function ReferenceWindow({
  open,
  onClose,
  entry,
  session,
  draft,
  image,
  onImage,
  takesPaste,
  onSaved,
  fetchLike = fetch,
}: ReferenceWindowProps) {
  const dataset = entry ? gallerySourceOfEntryId(entry.id) : null;
  const owner =
    entry !== null &&
    session !== null &&
    entry.ownerUserId !== null &&
    entry.ownerUserId === session.id;
  // A dataset's entries are read-only; a community entry's details are its
  // owner's, an admin's or a moderator's, its image its owner's or the
  // Owner's, as the server rules.
  const editsText =
    entry === null ||
    (!dataset &&
      (owner || session?.isAdmin === true || session?.role === "moderator"));
  const savesImage =
    entry !== null && !dataset && (owner || session?.isOwner === true);

  const [figure, setFigure] = useState<{ src: string; label: string } | null>(
    null,
  );
  useEffect(() => {
    if (!entry) return;
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
    // A save or publication renews the entry: read its figure again.
  }, [entry, fetchLike]);

  const savedName = entry?.name ?? draft.name;
  const savedDescription = entry?.description ?? draft.description;
  const [name, setName] = useState(savedName);
  const [description, setDescription] = useState(savedDescription);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const textDirty =
    editsText &&
    (name.trim() !== savedName.trim() ||
      description.trim() !== savedDescription.trim());
  // What was saved elsewhere shows here unless it is being edited.
  const editing = useRef(false);
  editing.current = textDirty;
  useEffect(() => {
    if (editing.current) return;
    setName(savedName);
    setDescription(savedDescription);
  }, [savedName, savedDescription]);
  const imageDirty = image !== null && savesImage && !uploaded.has(image.file);
  const dirty = textDirty || imageDirty;

  const [over, setOver] = useState(false);
  const chooser = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const paste = (event: ClipboardEvent) => {
      if (!takesPaste(event)) return;
      const pasted = imageAmong(event.clipboardData?.files);
      if (!pasted) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onImage(pasted);
      setNote(null);
    };
    window.addEventListener("paste", paste, true);
    return () => window.removeEventListener("paste", paste, true);
  }, [open, onImage, takesPaste]);

  async function save(): Promise<void> {
    const savedAs = { name: name.trim(), description: description.trim() };
    if (!savedAs.name) {
      setNote("Give it a name first.");
      return;
    }
    setBusy(true);
    setNote(null);
    if (entry && textDirty) {
      const response = await fetchLike(
        `/api/gallery/${encodeURIComponent(entry.id)}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(savedAs),
        },
      ).catch(() => null);
      if (!response?.ok) {
        setBusy(false);
        setNote("The name and description could not be saved.");
        return;
      }
    }
    if (entry && imageDirty && image) {
      const result = await uploadReferenceImage(
        entry.id,
        image.file,
        fetchLike,
      );
      if (result !== REFERENCE_SAVED) {
        setBusy(false);
        setNote(result);
        return;
      }
      uploaded.add(image.file);
    }
    setBusy(false);
    setNote("Saved");
    onSaved(savedAs);
  }

  if (!open) return null;

  const shown = image?.url ?? figure?.src ?? null;
  const onlyHere = image !== null && entry !== null && !savesImage;
  const shownDescription = description.trim();
  const choose = () => chooser.current?.click();
  const take = (file: File | null) => {
    if (!file) return;
    onImage(file);
    setNote(null);
  };
  const saveOnEnter = (event: ReactKeyboardEvent) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    if (dirty && !busy) void save();
  };

  return (
    <ReferenceFloat
      title={!image && figure ? figure.label : "Reference"}
      hint={
        onlyHere
          ? "your image · only on this page"
          : shown
            ? "wheel zooms · drag pans"
            : ""
      }
      onClose={onClose}
      actions={
        shown ? (
          <button
            type="button"
            title="Use another image"
            aria-label="Use another image"
            onClick={choose}
          >
            ⟳
          </button>
        ) : null
      }
      footer={
        dirty || note ? (
          <div className="reference-panel-foot">
            <span role="status">{note}</span>
            {dirty ? (
              <button
                type="button"
                className="is-primary"
                data-testid="reference-save"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save"}
              </button>
            ) : null}
          </div>
        ) : null
      }
    >
      <div
        className="reference-panel-about"
        data-testid="reference-panel-about"
      >
        {editsText ? (
          <>
            <input
              className="reference-name"
              data-testid="reference-name"
              aria-label="Circuit name"
              placeholder="Circuit name"
              value={name}
              maxLength={120}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setNote(null);
              }}
              onKeyDown={saveOnEnter}
            />
            <textarea
              className="reference-description"
              data-testid="reference-description"
              aria-label="Description"
              placeholder="Add a description"
              rows={2}
              value={description}
              onChange={(event) => {
                setDescription(event.currentTarget.value);
                setNote(null);
              }}
              onKeyDown={saveOnEnter}
            />
          </>
        ) : (
          <>
            <strong>{name}</strong>
            {shownDescription ? <p>{shownDescription}</p> : null}
          </>
        )}
      </div>
      <div
        className={`reference-panel-figure${over ? " over" : ""}`}
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
        {shown ? (
          <MarkablePicture
            src={shown}
            alt="Reference image"
            side="original"
            marks={[]}
            zoomed
          />
        ) : (
          <button
            type="button"
            className="reference-panel-empty"
            data-testid="reference-choose"
            onClick={choose}
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
