import { useState } from "react";
import type { GalleryFeedEntry } from "../gallery-client";
import { InlineConfirm } from "./inline-confirm";

const OWNER_REJECT_REASONS = [
  "too ugly",
  "circuit incorrect",
  "too simple",
  "duplicate",
] as const;

function joinedRejectReason(reasons: readonly string[], note: string): string {
  const selected = reasons.join("; ");
  const detail = note.trim();
  if (selected && detail) return `${selected} — Note: ${detail}`;
  return selected || detail;
}

export function GalleryOwnerMenu({
  entry,
  busy,
  onWithdraw,
}: {
  entry: GalleryFeedEntry;
  busy: boolean;
  onWithdraw: () => void | Promise<void>;
}) {
  return (
    <details
      className="gallery-owner-menu"
      data-testid={`gallery-owner-menu-${entry.id}`}
    >
      <summary
        aria-label={`Manage ${entry.name}`}
        title={`Manage ${entry.name}`}
      >
        ⋯
      </summary>
      <div className="gallery-owner-popover" data-inline-confirm-menu>
        <a
          href={`/g/${entry.id}`}
          data-testid={`gallery-owner-edit-${entry.id}`}
        >
          Edit and replace
        </a>
        <InlineConfirm
          disabled={busy}
          data-testid={`gallery-owner-withdraw-${entry.id}`}
          confirmLabel="Really withdraw"
          onConfirm={onWithdraw}
        >
          Withdraw
        </InlineConfirm>
      </div>
    </details>
  );
}

export function GalleryOwnerRejectButton({
  entry,
  busy,
  onReject,
}: {
  entry: GalleryFeedEntry;
  busy: boolean;
  onReject: () => void;
}) {
  return (
    <button
      type="button"
      className="gallery-owner-reject-shortcut"
      aria-label={`Reject ${entry.name}`}
      title={`Reject ${entry.name}`}
      disabled={busy}
      data-testid={`gallery-owner-reject-${entry.id}`}
      onClick={onReject}
    >
      ×
    </button>
  );
}

export function RejectEntryDialog({
  entry,
  busy,
  onSubmit,
  onClose,
}: {
  entry: GalleryFeedEntry;
  busy: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const reason = joinedRejectReason(selectedReasons, note);

  function toggleReason(candidate: string): void {
    setSelectedReasons((previous) =>
      previous.includes(candidate)
        ? previous.filter((reason) => reason !== candidate)
        : [...previous, candidate],
    );
  }

  return (
    <div
      className="gallery-owner-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="gallery-owner-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gallery-reject-title"
        data-testid="gallery-owner-reject-dialog"
      >
        <h2 id="gallery-reject-title">Reject “{entry.name}”</h2>
        <p>
          The circuit will leave the Gallery immediately. The submitter will see
          this reason in My submissions.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (reason) onSubmit(reason);
          }}
        >
          <fieldset className="gallery-owner-reason-options">
            <legend>Common reasons (choose all that apply)</legend>
            <div>
              {OWNER_REJECT_REASONS.map((candidate, index) => (
                <label key={candidate}>
                  <input
                    type="checkbox"
                    checked={selectedReasons.includes(candidate)}
                    autoFocus={index === 0}
                    data-testid={`gallery-owner-reject-option-${candidate.replace(/\s/gu, "-")}`}
                    onChange={() => toggleReason(candidate)}
                  />
                  <span>{candidate}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor="gallery-reject-note">
            Additional note or other reason <span>(optional)</span>
          </label>
          <textarea
            id="gallery-reject-note"
            value={note}
            maxLength={360}
            placeholder="Add context for the submitter…"
            data-testid="gallery-owner-reject-note"
            onChange={(event) => setNote(event.currentTarget.value)}
          />
          <div className="gallery-owner-dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="gallery-owner-danger"
              disabled={busy || !reason}
              data-testid="gallery-owner-reject-confirm"
            >
              {busy ? "Rejecting…" : "Reject entry"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
