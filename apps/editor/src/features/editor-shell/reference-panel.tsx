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
): Promise<{ blob: Blob; label: string | null } | null> {
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
    label: source ? `Original · ${source.name}` : null,
  };
}

/**
 * A field's text: it follows the saved value (renamed on a tab, undone)
 * unless the reader has changed it here.
 */
function useDraft(saved: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(saved);
  const shown = useRef(saved);
  useEffect(() => {
    const before = shown.current;
    shown.current = saved;
    setDraft((current) => (current.trim() === before.trim() ? saved : current));
  }, [saved]);
  return [draft, setDraft];
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

/**
 * A box pulled wholly inside the browser window as far as it fits: after
 * the browser shrinks, the window's buttons stay within reach.
 */
function inside(box: Box): Box {
  return {
    ...box,
    left: Math.max(0, Math.min(box.left, window.innerWidth - box.width)),
    top: Math.max(0, Math.min(box.top, window.innerHeight - box.height)),
  };
}

/**
 * A folded window's box kept with its bottom edge on screen: folded, the
 * title bar sits on that edge and may go anywhere a title bar can.
 */
function foldedOnScreen(box: Box): Box {
  const kept = onScreen(box);
  const bottom = Math.min(
    Math.max(box.top + kept.height, 30),
    window.innerHeight,
  );
  return { ...kept, top: bottom - kept.height };
}

// Where the window was, whether it was folded and whether it showed only
// the picture, kept across tabs and closing.
const remembered: { box: Box | null; folded: boolean; pictureOnly: boolean } = {
  box: null,
  folded: false,
  pictureOnly: false,
};

/**
 * A window floating over the editor: it moves by its title bar, resizes
 * from any edge or corner, folds to its title bar and closes from it.
 * Folded, the title bar rests on the window's bottom edge, out of the way
 * where the window starts; unfolded, the window opens upward from there.
 */
function ReferenceFloat({
  title,
  onClose,
  actions,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  /** Buttons of the title bar, shown while the window is open. */
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [folded, setFolded] = useState(remembered.folded);
  // At first in the canvas's bottom-right corner, clear of the side panels.
  const [box, setBox] = useState<Box>(() => {
    if (remembered.box)
      return (remembered.folded ? foldedOnScreen : onScreen)(
        inside(remembered.box),
      );
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
  const inView = folded ? foldedOnScreen : onScreen;
  useEffect(() => {
    const keep = () => setBox((current) => inView(inside(current)));
    window.addEventListener("resize", keep);
    return () => window.removeEventListener("resize", keep);
  }, [inView]);
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
      setBox(inView(next));
    });
  };
  return (
    <div
      className={`reference-panel${folded ? " folded" : ""}`}
      data-testid="reference-panel"
      role="complementary"
      aria-label={title}
      style={{
        left: box.left,
        width: box.width,
        ...(folded
          ? { bottom: window.innerHeight - (box.top + box.height) }
          : { top: box.top, height: box.height }),
      }}
    >
      <div
        className="reference-panel-head"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          const from = box;
          follow(event, (dx, dy) =>
            setBox(
              inView({ ...from, left: from.left + dx, top: from.top + dy }),
            ),
          );
        }}
      >
        <span className="title">{title}</span>
        {folded ? null : actions}
        <button
          type="button"
          title={folded ? "Show the window" : "Fold to the title bar"}
          aria-label={folded ? "Unfold" : "Fold"}
          onClick={() => {
            setBox((current) => (folded ? onScreen : foldedOnScreen)(current));
            setFolded(!folded);
          }}
        >
          {folded ? "▢" : "–"}
        </button>
        <button
          type="button"
          title="Close (Project Info in the status bar or the File menu brings it back)"
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
  reviewFeedback?:
    | { identity: string; label: string; copy(comment: string): Promise<void> }
    | undefined;
  localDelivery?:
    | {
        source?: import("@icm/agent-adapter").AgentLocalSource;
        embeddedSource?: import("@icm/agent-adapter").EmbeddedReviewSource;
        rnlAppearance?: import("@icm/rnl").RnlAppearance;
        modified?: boolean;
        recovered?: boolean;
        reviewStatus?: string;
      }
    | undefined;
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

function ReviewFeedback({
  label,
  copy,
}: NonNullable<ReferenceWindowProps["reviewFeedback"]>) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function copyFeedback() {
    setBusy(true);
    try {
      await copy(comment);
      setStatus("Copied. Paste it into the original Agent chat.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Copy failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="reference-local-source">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Review feedback
      </button>
      {open ? (
        <>
          <p>{label}</p>
          <textarea
            className="reference-description"
            aria-label="Review comment"
            value={comment}
            onChange={(event) => setComment(event.currentTarget.value)}
          />
          <button
            type="button"
            disabled={busy || !comment.trim()}
            onClick={() => {
              void copyFeedback();
            }}
          >
            Copy review feedback
          </button>
          <p role="status">{status}</p>
        </>
      ) : null}
    </div>
  );
}

/**
 * Project Info, beside the canvas in every drawing from the start: the
 * drawing's name, a Gallery entry's contributor, the description and the
 * reference picture. The picture to trace over is pasted (⌘V / Ctrl+V),
 * dropped or chosen, and zooms with the wheel and pans with a drag. Save
 * keeps the name and description with an unpublished drawing (Publish
 * starts from them); for a Gallery
 * entry its owner or the Owner may change, it saves them, and the picture,
 * to the entry at once. Closed, Project Info in the status bar or the File
 * menu brings it back.
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
  localDelivery,
  reviewFeedback,
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

  const [figure, setFigure] = useState<{
    src: string;
    label: string | null;
  } | null>(null);
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
  const [name, setName] = useDraft(savedName);
  const [description, setDescription] = useDraft(savedDescription);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const textDirty =
    editsText &&
    (name.trim() !== savedName.trim() ||
      description.trim() !== savedDescription.trim());
  const imageDirty = image !== null && savesImage && !uploaded.has(image.file);
  const dirty = textDirty || imageDirty;

  const [pictureOnly, setPictureOnly] = useState(remembered.pictureOnly);
  useEffect(() => {
    remembered.pictureOnly = pictureOnly;
  }, [pictureOnly]);
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
      title="Project Info"
      onClose={onClose}
      actions={
        <button
          type="button"
          title={
            pictureOnly
              ? "Show the details above the picture"
              : "Show only the picture"
          }
          aria-label={pictureOnly ? "Show details" : "Picture only"}
          aria-pressed={pictureOnly}
          onClick={() => setPictureOnly((value) => !value)}
        >
          {pictureOnly ? "▾" : "▴"}
        </button>
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
        hidden={pictureOnly}
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
        {reviewFeedback ? (
          <ReviewFeedback key={reviewFeedback.identity} {...reviewFeedback} />
        ) : null}
        {localDelivery?.source ? (
          <details className="reference-local-source">
            <summary>Imported source</summary>
            <p>{localDelivery.source.entryPath}</p>
            <p>Source version (SHA-256)</p>
            <code data-testid="local-source-version">
              {localDelivery.source.version}
            </code>
            {localDelivery.reviewStatus ? (
              <p data-testid="local-review-status">
                {localDelivery.reviewStatus}
              </p>
            ) : null}
            {localDelivery.rnlAppearance ? (
              <p data-testid="local-source-appearance">
                {localDelivery.rnlAppearance === "canvas" &&
                !localDelivery.source.diagnostics.some(
                  ({ code }) => code === "RNL_IMPORT_SOURCE_APPEARANCE",
                )
                  ? "Canvas appearance"
                  : "Source appearance"}
              </p>
            ) : null}
            <p>
              {localDelivery.modified
                ? "Edited since import"
                : "At imported revision"}
            </p>
            {localDelivery.recovered ? (
              <p>Restored from this browser's saved tab snapshot.</p>
            ) : null}
            <p>
              {localDelivery.source.electrical === "verified"
                ? "Drawing checked against the imported netlist."
                : "Drawing correspondence has not been verified."}
            </p>
            {localDelivery.source.diagnostics.length > 0 ? (
              <ul aria-label="Import diagnostics">
                {[
                  ...new Set(
                    localDelivery.source.diagnostics.map(
                      ({ message }) => message,
                    ),
                  ),
                ].map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}
            <ul>
              {localDelivery.source.files.map((file) => (
                <li key={file.path}>
                  <span>{file.path}</span>
                  <br />
                  <code>{file.sha256}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {localDelivery?.embeddedSource ? (
          <details className="reference-local-source">
            <summary>Embedded netlist source</summary>
            <p>{localDelivery.embeddedSource.entryPath}</p>
            <p>Embedded source version (SHA-256)</p>
            <code data-testid="embedded-source-version">
              {localDelivery.embeddedSource.version}
            </code>
            <ul>
              {localDelivery.embeddedSource.files.map(({ path, sha256 }) => (
                <li key={path}>
                  <span>{path}</span>
                  <br />
                  <code>{sha256}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {entry ? (
          <dl className="reference-panel-facts">
            <div>
              <dt>Contributor</dt>
              <dd>{entry.author.trim() || "Unknown contributor"}</dd>
            </div>
          </dl>
        ) : null}
      </div>
      <div className="reference-panel-caption">
        <span className="title">
          {!image && figure?.label
            ? `Reference picture · ${figure.label}`
            : "Reference picture"}
        </span>
        <span className="hint">
          {onlyHere
            ? "your image · only on this page"
            : shown
              ? "wheel zooms · drag pans"
              : ""}
        </span>
        {shown ? (
          <button
            type="button"
            title="Use another image"
            aria-label="Use another image"
            onClick={choose}
          >
            ⟳
          </button>
        ) : null}
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
