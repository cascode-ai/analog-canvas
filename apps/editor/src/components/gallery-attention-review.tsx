import { useState } from "react";
import type { GalleryFeedEntry } from "../gallery-client";

/** Private curation controls: only rendered for the author or an administrator. */
export function GalleryAttentionReview({
  entry,
  reasons,
  onChange,
}: {
  entry: GalleryFeedEntry;
  /** Every reason with its name, in the Gallery's order. */
  reasons: readonly { kind: string; label: string }[];
  onChange: (entry: GalleryFeedEntry) => void;
}) {
  const labelOf = (kind: string) =>
    reasons.find((reason) => reason.kind === kind)?.label ?? kind;
  const [note, setNote] = useState("");
  const [kind, setKind] = useState("other");
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
      ? [...(entry.attention?.issues ?? []), { kind, detail: note.trim() }]
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
            <li key={index}>
              <strong>{labelOf(issue.kind)}</strong> · {issue.detail}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          Flag a drawing or netlist problem for the author and administrators.
        </p>
      )}
      <select
        aria-label="Reason"
        value={kind}
        onChange={(event) => setKind(event.currentTarget.value)}
      >
        {reasons.map((reason) => (
          <option key={reason.kind} value={reason.kind}>
            {reason.label}
          </option>
        ))}
      </select>
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
