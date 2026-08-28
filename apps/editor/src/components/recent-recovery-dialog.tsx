import { useEffect, useRef } from "react";

import type {
  BrowserRecoveryGeneration,
  BrowserRecoverySource,
} from "../document/browser-recovery-contract";
import type { RecoverySessionSummary } from "../document/recovery-coordinator";

export interface RecentRecoveryDialogProps {
  sessions: RecoverySessionSummary[];
  onRestore(workingCopyId: string, generation: BrowserRecoveryGeneration): void;
  onDownloadBackup(
    workingCopyId: string,
    generation: BrowserRecoveryGeneration,
  ): void;
  onDeleteSession(workingCopyId: string): void;
  onClose(): void;
}

type ReviewStatus = "valid" | "corrupt" | "unsupported-schema" | "absent";

function reviewStatus(
  summary: RecoverySessionSummary,
  generation: BrowserRecoveryGeneration,
): ReviewStatus {
  const record = generation === "latest" ? summary.latest : summary.previous;
  if (record === null) return "absent";
  return record.review;
}

function reviewLabel(status: ReviewStatus): string {
  switch (status) {
    case "valid":
      return "Restorable";
    case "corrupt":
      return "Damaged";
    case "unsupported-schema":
      return "Newer Project schema";
    case "absent":
      return "None";
  }
}

function generationLine(
  summary: RecoverySessionSummary,
  generation: BrowserRecoveryGeneration,
): string {
  const record = generation === "latest" ? summary.latest : summary.previous;
  const label = reviewLabel(reviewStatus(summary, generation));
  if (
    record !== null &&
    record.review === "valid" &&
    record.revision !== null
  ) {
    return `${label} · revision ${record.revision}`;
  }
  return label;
}

const SOURCE_LABELS: Record<BrowserRecoverySource, string> = {
  new: "New Project",
  "opened-file": "Opened file",
  "spice-import": "SPICE import",
  "cloud-project": "Cloud Project",
  recovered: "Earlier restore",
};

/**
 * Pick the generation Restore installs: the newest valid one. A damaged
 * latest offers the previous generation; an incompatible schema is never
 * installable, only downloadable.
 */
export function restorableGeneration(
  summary: RecoverySessionSummary,
): BrowserRecoveryGeneration | null {
  if (reviewStatus(summary, "latest") === "valid") return "latest";
  if (reviewStatus(summary, "previous") === "valid") return "previous";
  return null;
}

export function downloadableGeneration(
  summary: RecoverySessionSummary,
): BrowserRecoveryGeneration | null {
  const latest = reviewStatus(summary, "latest");
  if (latest === "valid" || latest === "unsupported-schema") return "latest";
  const previous = reviewStatus(summary, "previous");
  if (previous === "valid" || previous === "unsupported-schema") {
    return "previous";
  }
  return null;
}

export function RecentRecoveryDialog({
  sessions,
  onRestore,
  onDownloadBackup,
  onDeleteSession,
  onClose,
}: RecentRecoveryDialogProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className="help-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recent-recovery-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <header className="help-dialog-header">
          <div>
            <p className="help-kicker">Browser safety copies</p>
            <h2 id="recent-recovery-title">Recover recent work</h2>
          </div>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label="Close recent work recovery"
          >
            Close
          </button>
        </header>
        <div className="help-dialog-content">
          <p>
            These copies live only in this browser and are not the formal
            Project. Save to Cloud or download a backup for durable storage.
          </p>
          <ul className="recovery-session-list">
            {sessions.map((session) => {
              const restorable = restorableGeneration(session);
              const downloadable = downloadableGeneration(session);
              const latestStatus = reviewStatus(session, "latest");
              const previousStatus = reviewStatus(session, "previous");
              return (
                <li
                  key={session.workingCopyId}
                  className="recovery-session-card"
                  data-testid="recovery-session-card"
                >
                  <div className="recovery-session-heading">
                    <strong>{session.projectName}</strong>
                    <span className="recovery-session-meta">
                      {SOURCE_LABELS[session.source]} ·{" "}
                      {new Date(session.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  <dl className="recovery-generation-list">
                    <div>
                      <dt>Latest copy</dt>
                      <dd>{generationLine(session, "latest")}</dd>
                    </div>
                    <div>
                      <dt>Previous copy</dt>
                      <dd>{generationLine(session, "previous")}</dd>
                    </div>
                  </dl>
                  {restorable === null ? (
                    <p className="recovery-session-note">
                      {latestStatus === "unsupported-schema" ||
                      previousStatus === "unsupported-schema"
                        ? "This copy uses a newer Project schema and cannot be restored here, but you can download it."
                        : "This copy is damaged and cannot be restored."}
                    </p>
                  ) : null}
                  <div className="recovery-session-actions">
                    <button
                      type="button"
                      disabled={restorable === null}
                      onClick={() => {
                        if (restorable !== null) {
                          onRestore(session.workingCopyId, restorable);
                        }
                      }}
                      aria-label={
                        restorable === "previous"
                          ? `Restore previous copy of ${session.projectName}`
                          : `Restore ${session.projectName}`
                      }
                    >
                      Restore
                      {restorable === "previous" ? " previous copy" : ""}
                    </button>
                    <button
                      type="button"
                      disabled={downloadable === null}
                      onClick={() => {
                        if (downloadable !== null) {
                          onDownloadBackup(session.workingCopyId, downloadable);
                        }
                      }}
                      aria-label={`Download backup of ${session.projectName}`}
                    >
                      Download backup
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSession(session.workingCopyId)}
                      aria-label={`Delete recovery copy of ${session.projectName}`}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}
