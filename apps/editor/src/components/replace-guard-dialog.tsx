import { useEffect, useRef } from "react";

export interface ReplaceGuardDialogProps {
  /** What is about to replace the dirty work, e.g. "Open amp.icproj.json". */
  intent: string;
  saving: boolean;
  recoveryProtected: boolean;
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
  recoveryProtected,
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
            <p className="help-kicker">Unsaved changes</p>
            <h2 id="replace-guard-title">Protect the current Project</h2>
          </div>
        </header>
        <div className="help-dialog-content">
          <p>
            The current Project has unsaved changes. Browser recovery is only a
            safety copy. Choose what happens before <strong>{intent}</strong>{" "}
            continues.
          </p>
          {recoveryProtected ? (
            <p>
              A temporary recovery copy is available while you decide. Choosing
              Discard removes this working copy before continuing.
            </p>
          ) : null}
          {!recoveryProtected ? (
            <p className="replace-guard-warning" role="alert">
              A current browser recovery copy could not be confirmed. Saving is
              strongly recommended before continuing.
            </p>
          ) : null}
          <div className="replace-guard-actions">
            <button
              type="button"
              ref={cancelRef}
              onClick={onCancel}
              disabled={saving}
            >
              Cancel (keep editing)
            </button>
            <button type="button" onClick={onSaveAndContinue} disabled={saving}>
              {saving ? "Saving…" : "Save and continue"}
            </button>
            <button
              type="button"
              className="danger"
              onClick={onDiscard}
              disabled={saving}
            >
              Discard and continue
            </button>
          </div>
          <p>
            Cloud Project is the formal saved copy. Browser recovery and local
            exports remain safety and interchange copies; neither is a hidden
            project history.
          </p>
        </div>
      </section>
    </div>
  );
}
