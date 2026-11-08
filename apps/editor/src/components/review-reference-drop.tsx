import { useEffect, useRef, useState } from "react";

import { putReferenceImage } from "../reference-image";

/** The first image among pasted, dropped or chosen files. */
const imageAmong = (files: FileList | null | undefined) =>
  [...(files ?? [])].find((file) => file.type.startsWith("image/")) ?? null;

/**
 * Review's empty Reference pane, for a reader who may give the drawing its
 * reference image (the Owner; reviewers never see their own drawings): a
 * screenshot pasted anywhere on the page (⌘V / Ctrl+V, unless a text field
 * takes it), dropped here or chosen shows first, then uploads once they
 * confirm they may share it.
 */
export function ReviewReferenceDrop({
  entryId,
  onAttached,
  fetchLike = fetch,
}: {
  entryId: string;
  onAttached: (revision: string) => void;
  fetchLike?: typeof fetch;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const take = (next: File | null) => {
    if (!next) return;
    setFile(next);
    setNote(null);
  };
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable]")
      )
        return;
      const image = imageAmong(event.clipboardData?.files);
      if (!image) return;
      event.preventDefault();
      take(image);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, []);

  async function upload(): Promise<void> {
    if (!file) return;
    setBusy(true);
    const result = await putReferenceImage(entryId, file, fetchLike);
    setBusy(false);
    if ("revision" in result) onAttached(result.revision);
    else setNote(result.message);
  }

  return (
    <div
      className={`review-pic review-reference-drop${over ? " over" : ""}`}
      data-testid="review-reference-drop"
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
        <>
          <img src={preview} alt="The reference image to upload" />
          <div className="review-reference-confirm">
            <span>{note ?? "I may share this image."}</span>
            <button type="button" disabled={busy} onClick={() => setFile(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="is-primary"
              data-testid="review-reference-upload"
              disabled={busy}
              onClick={() => void upload()}
            >
              {busy ? "Uploading…" : "Use as reference"}
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="review-reference-empty"
          onClick={() => chooser.current?.click()}
        >
          No reference figure yet.
          <br />
          <strong>Paste a screenshot</strong> (⌘V / Ctrl+V), drop an image here,
          or click to choose a file
        </button>
      )}
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
    </div>
  );
}
