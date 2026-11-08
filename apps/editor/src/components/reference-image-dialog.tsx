import { useEffect, useRef, useState } from "react";

import "./reference-image-dialog.css";
import { REFERENCE_SAVED, uploadReferenceImage } from "../reference-image";

/** The first image among pasted or dropped files. */
function imageAmong(files: FileList | null | undefined): File | null {
  return (
    [...(files ?? [])].find((file) => file.type.startsWith("image/")) ?? null
  );
}

/**
 * Puts a drawing's reference image. A screenshot pasted from the clipboard
 * is the usual way in; a dropped image or a chosen file works too. The image
 * shows before it goes up, and its sharer confirms they may share it.
 */
export function ReferenceImageDialog({
  entryId,
  entryName,
  onClose,
}: {
  entryId: string;
  entryName: string;
  onClose: () => void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rights, setRights] = useState(false);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const take = (candidate: File | null) => {
    if (!candidate) {
      setNote("That is not an image.");
      return;
    }
    setFile(candidate);
    setNote("");
  };

  useEffect(() => {
    const dialog = modal.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  // Anywhere while it is open, ⌘V / Ctrl+V takes the clipboard's image.
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const image = imageAmong(event.clipboardData?.files);
      if (!image) return;
      event.preventDefault();
      take(image);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, []);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // The clipboard read on request, for a browser whose ⌘V reaches no page.
  async function pasteFromClipboard() {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((each) => each.startsWith("image/"));
        if (!type) continue;
        take(new File([await item.getType(type)], "pasted", { type }));
        return;
      }
      setNote("The clipboard holds no image.");
    } catch {
      setNote("Press ⌘V / Ctrl+V to paste.");
    }
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    const result = await uploadReferenceImage(entryId, file);
    setBusy(false);
    setNote(result);
    if (result === REFERENCE_SAVED) window.setTimeout(onClose, 900);
  }

  return (
    <dialog
      ref={modal}
      className="version-history-backdrop"
      aria-label={`Reference image for ${entryName}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // The dialog sits inside a tile: its clicks and keys stay here.
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div
        className="version-history-dialog reference-dialog"
        data-testid="reference-image-dialog"
      >
        <header className="version-history-header">
          <p>Reference image</p>
          <h2>{entryName}</h2>
        </header>
        <button
          type="button"
          className={`reference-drop${over ? " is-over" : ""}${preview ? " has-image" : ""}`}
          data-testid="reference-image-drop"
          onClick={() => chooser.current?.click()}
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
          {preview ? (
            <img src={preview} alt="The image to upload" />
          ) : (
            <span>
              <strong>Paste a screenshot</strong> (⌘V / Ctrl+V)
              <br />
              or drop an image here, or click to choose a file
            </span>
          )}
        </button>
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
        <label className="reference-rights">
          <input
            type="checkbox"
            checked={rights}
            onChange={(event) => setRights(event.currentTarget.checked)}
          />
          I may share this image. Anyone sees it beside the drawing in Review.
        </label>
        <footer className="reference-actions">
          <button type="button" onClick={() => void pasteFromClipboard()}>
            Paste
          </button>
          <span role="status">{note}</span>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="is-primary"
            data-testid="reference-image-upload"
            disabled={!file || !rights || busy}
            onClick={() => void upload()}
          >
            {busy ? "Uploading…" : "Upload"}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
