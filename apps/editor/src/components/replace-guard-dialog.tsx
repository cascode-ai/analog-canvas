import { useEffect, useRef } from "react";

export interface ReplaceGuardDialogProps {
  /** What is about to replace the dirty work, e.g. "Open amp.icproj.json". */
  intent: string;
  saving: boolean;
  onCancel(): void;
  onSaveAndContinue(): void;
  onDiscard(): void;
}

/**
 * Outgoing dirty-work protection. Recovery is a safety copy, not permission to
 * discard the foreground Project, so every dirty replacement pauses here.
 * Defaults to Cancel; Escape cancels. Cloud Save must succeed before the
 * replacement is allowed to continue.
 */
export function ReplaceGuardDialog({
  intent,
  saving,
  onCancel,
  onSaveAndContinue,
  onDiscard,
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
        if (!saving && event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-guard-title"
        onKeyDown={(event) => {
          if (!saving && event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <header className="help-dialog-header">
          <div>
            <h2 id="replace-guard-title">Unsaved changes</h2>
          </div>
        </header>
        <div className="help-dialog-content">
          <p>
            If you continue to <strong>{intent}</strong>, your latest changes
            will not be saved.
          </p>
          <p>
            <strong>Save</strong> stores this Project in Cloud Projects (up to
            3). <strong>File / Export Project File…</strong> downloads a local
            <code>.icproj.json</code> file.
          </p>
          <div className="replace-guard-actions">
            <button
              type="button"
              ref={cancelRef}
              onClick={onCancel}
              disabled={saving}
            >
              Stay
            </button>
            <button type="button" onClick={onSaveAndContinue} disabled={saving}>
              {saving ? "Saving to Cloud…" : "Save to Cloud and continue"}
            </button>
            <button
              type="button"
              className="danger"
              onClick={onDiscard}
              disabled={saving}
            >
              Continue without saving
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
