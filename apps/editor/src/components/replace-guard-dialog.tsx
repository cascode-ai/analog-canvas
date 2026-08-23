import { useEffect, useRef } from "react";

export interface ReplaceGuardDialogProps {
  /** What is about to replace the dirty work, e.g. "Open amp.icproj.json". */
  intent: string;
  onCancel(): void;
  onConfirm(): void;
  onDownload(): void;
}

/**
 * Outgoing dirty-work protection. Recovery is a safety copy, not permission to
 * discard the foreground Project, so every dirty replacement pauses here.
 * Defaults to Cancel; Escape cancels; the download action keeps the dialog open
 * so the user can still decide.
 */
export function ReplaceGuardDialog({
  intent,
  onCancel,
  onConfirm,
  onDownload,
}: ReplaceGuardDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => cancelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      className="help-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-guard-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <header className="help-dialog-header">
          <div>
            <p className="help-kicker">Unsaved work</p>
            <h2 id="replace-guard-title">Protect the current Project</h2>
          </div>
        </header>
        <div className="help-dialog-content">
          <p>
            The current Project has unsaved changes. Browser recovery is only a
            safety copy. Choose what happens before <strong>{intent}</strong>{" "}
            continues.
          </p>
          <div className="replace-guard-actions">
            <button type="button" ref={cancelRef} onClick={onCancel}>
              Cancel (keep editing)
            </button>
            <button type="button" onClick={onDownload}>
              Download current Project
            </button>
            <button type="button" onClick={onConfirm}>
              Discard and continue
            </button>
          </div>
          <p>
            The formal <code>.icproj.json</code> file remains the authoritative
            copy of your work.
          </p>
        </div>
      </section>
    </div>
  );
}
