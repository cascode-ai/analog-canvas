import { useState } from "react";
import type { GalleryFeedEntry } from "../gallery-client";

/** Private curation controls: only rendered for the author or an administrator. */
export function GalleryAttentionReview({
  entry,
  onChange,
}: {
  entry: GalleryFeedEntry;
  onChange: (entry: GalleryFeedEntry) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = entry.attention?.status === "needs-attention";
  const stale =
    entry.assessedPreviewRevision &&
    entry.assessedPreviewRevision !== entry.previewRevision;
  async function save(status: "needs-attention" | "resolved") {
    setBusy(true);
    setError("");
    const issues = note.trim()
      ? [
          ...(entry.attention?.issues ?? []),
          { kind: "other", detail: note.trim() },
        ]
      : (entry.attention?.issues ?? []);
    try {
      const response = await fetch(`/api/gallery/${entry.id}/curation`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tags: entry.tags ?? [],
          attention: { status, issues },
          expectedPreviewRevision: entry.previewRevision ?? "legacy",
          expectedCurationRevision: entry.curationRevision ?? 0,
        }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? "The circuit or review changed. Refresh before saving."
            : "Could not save the review. Please retry.",
        );
      const result = (await response.json()) as { entry: GalleryFeedEntry };
      onChange({
        ...result.entry,
        likes: entry.likes ?? 0,
        likedByViewer: entry.likedByViewer ?? false,
      });
      setNote("");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="gallery-attention"
      data-testid={`gallery-attention-${entry.id}`}
    >
      <summary>
        {pending
          ? "Needs attention"
          : entry.attention
            ? "Reviewed · resolved"
            : "Review drawing"}
      </summary>
      {stale ? (
        <p>
          The drawing has changed since this visual review. Recheck the marked
          areas.
        </p>
      ) : null}
      {entry.attention?.issues.length ? (
        <ul>
          {entry.attention.issues.map((issue, index) => (
            <li key={index}>{issue.detail}</li>
          ))}
        </ul>
      ) : (
        <p>Flag a visible drawing problem for the author and administrators.</p>
      )}
      <textarea
        aria-label="Review note"
        placeholder="Describe the problem and its location…"
        maxLength={500}
        rows={2}
        value={note}
        onChange={(event) => setNote(event.currentTarget.value)}
      />
      {error ? <p role="alert">{error}</p> : null}
      <div className="gallery-attention-actions">
        {pending ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save("resolved")}
          >
            Mark resolved
          </button>
        ) : null}
        <button
          type="button"
          disabled={
            busy ||
            (pending && !note.trim()) ||
            (!note.trim() && !entry.attention?.issues.length)
          }
          onClick={() => void save("needs-attention")}
        >
          {pending
            ? "Add note"
            : entry.attention
              ? "Reopen"
              : "Mark for attention"}
        </button>
      </div>
    </details>
  );
}
