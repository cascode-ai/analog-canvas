import { useState } from "react";
import type { GalleryFeedEntry } from "../gallery-client";
import { ReferenceImageDialog } from "./reference-image-dialog";

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

/**
 * The one menu on a tile its viewer may manage, an administrator's or the
 * submitter's own; the tile itself looks as it does to everyone. Review
 * drawing opens the drawing's review. Withdraw takes the tile off the Gallery
 * at once, and the recycle bin or My submissions brings it back. Verify
 * simulation, for the Owner's accounts alone, queues the server's check of
 * its testbench (#1545).
 */
export function GalleryTileMenu({
  entry,
  busy,
  administrator,
  manage = true,
  onReview,
  onWithdraw,
  onVerifySimulation,
}: {
  entry: GalleryFeedEntry;
  busy: boolean;
  /** An administrator may also edit and replace the drawing. */
  administrator: boolean;
  /** Its author or an administrator; anyone else gets Copy address alone. */
  manage?: boolean;
  onReview: () => void;
  onWithdraw: () => void;
  onVerifySimulation?: () => void;
}) {
  const scope = administrator ? "owner" : manage ? "author" : "reader";
  const [copied, setCopied] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const close = (element: HTMLElement) =>
    element.closest("details")?.removeAttribute("open");
  const path = `/g/${entry.id}`;
  return (
    <>
      <details
        className="gallery-owner-menu"
        data-testid={`gallery-${scope}-menu-${entry.id}`}
      >
        <summary
          aria-label={`${manage ? "Manage" : "More for"} ${entry.name}`}
          title={`${manage ? "Manage" : "More for"} ${entry.name}`}
        >
          ⋯
        </summary>
        <div className="gallery-owner-popover">
          {/* Everyone's first item: the circuit's own address. */}
          <button
            type="button"
            data-testid={`gallery-copy-address-${entry.id}`}
            title={path}
            onClick={(event) => {
              const menu = event.currentTarget;
              const address = `${window.location.origin}${path}`;
              void navigator.clipboard?.writeText(address).then(() => {
                setCopied(true);
                window.setTimeout(() => {
                  setCopied(false);
                  close(menu);
                }, 900);
              });
            }}
          >
            {copied ? "Copied" : "Copy address"}
          </button>
          {manage ? (
            <>
              {/* What it was drawn from, shown beside it in /review. */}
              <button
                type="button"
                data-testid={`gallery-reference-${entry.id}`}
                title="An image you may share, such as the figure you drew it from. Signed-in readers see it beside the drawing in Review."
                onClick={(event) => {
                  close(event.currentTarget);
                  setReferenceOpen(true);
                }}
              >
                Reference image…
              </button>
              <button
                type="button"
                data-testid={`gallery-${scope}-review-${entry.id}`}
                onClick={(event) => {
                  close(event.currentTarget);
                  onReview();
                }}
              >
                Review drawing
              </button>
              {administrator ? (
                <a
                  href={`/g/${entry.id}`}
                  data-testid={`gallery-owner-edit-${entry.id}`}
                >
                  Edit and replace
                </a>
              ) : null}
              {onVerifySimulation ? (
                <button
                  type="button"
                  disabled={busy}
                  data-testid={`gallery-verify-simulation-${entry.id}`}
                  onClick={(event) => {
                    close(event.currentTarget);
                    onVerifySimulation();
                  }}
                >
                  Verify simulation
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                data-testid={`gallery-${scope}-withdraw-${entry.id}`}
                onClick={(event) => {
                  close(event.currentTarget);
                  onWithdraw();
                }}
              >
                Withdraw
              </button>
            </>
          ) : null}
        </div>
      </details>
      {referenceOpen ? (
        <ReferenceImageDialog
          entryId={entry.id}
          entryName={entry.name}
          onClose={() => setReferenceOpen(false)}
        />
      ) : null}
    </>
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
  onSubmit: (reason: string, notify: boolean) => void;
  onClose: () => void;
}) {
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");
  // Emailing the author is the default; a bot's or a spam entry needs none.
  const [notify, setNotify] = useState(true);
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
          this reason in My submissions and, if you choose, by email.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (reason) onSubmit(reason, notify);
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
          <label className="gallery-owner-reject-email">
            <input
              type="checkbox"
              checked={notify}
              data-testid="gallery-owner-reject-email"
              onChange={(event) => setNotify(event.currentTarget.checked)}
            />
            <span>Email the author this reason (replies come to you)</span>
          </label>
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
