import { useEffect, useRef } from "react";

import type { SaveProblem } from "../document/use-project-file-lifecycle";
import { CloudSaveSignIn } from "./cloud-save-sign-in";

export interface ReplaceGuardDialogProps {
  /** What is about to replace the dirty work, e.g. "Open amp.icproj.json". */
  intent: string;
  exportOnly?: boolean;
  nativeSave?: boolean;
  /**
   * How many Cloud Projects one account may keep. The composition root hands
   * in the shared limit so this copy can never fall behind it.
   */
  cloudProjectLimit: number;
  saving: boolean;
  /** Why the last Save did not continue, said here and not only behind the
   * dialog in the status bar. */
  problem?: SaveProblem | null | undefined;
  onCancel(): void;
  onSaveAndContinue(): void;
  onDiscard(): void;
  /** Signed out: Stay, and open the page's sign-in choices. */
  onSignIn?(): void;
  /** Signed out: export the Project file, then continue. */
  onExportAndContinue?(): void;
}

/**
 * Outgoing dirty-work protection. Recovery is a safety copy, not permission to
 * discard the foreground Project, so every dirty replacement pauses here.
 * Defaults to Stay; Escape stays. Cloud Save must succeed before the
 * replacement is allowed to continue.
 */
export function ReplaceGuardDialog({
  intent,
  exportOnly = false,
  nativeSave = false,
  cloudProjectLimit,
  saving,
  problem = null,
  onCancel,
  onSaveAndContinue,
  onDiscard,
  onSignIn,
  onExportAndContinue,
}: ReplaceGuardDialogProps) {
  const signedOut =
    problem?.kind === "signed-out" && onSignIn && onExportAndContinue
      ? { onSignIn, onExportAndContinue }
      : null;
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
        className="replace-guard-dialog"
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
        <div className="replace-guard-lede">
          <span className="replace-guard-glyph" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="20" height="20">
              <path
                d="M10 3.2 18 17H2Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <line
                x1="10"
                y1="8.4"
                x2="10"
                y2="12.2"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <circle cx="10" cy="14.6" r="0.9" fill="currentColor" />
            </svg>
          </span>
          <div className="replace-guard-copy">
            <h2 id="replace-guard-title">Unsaved changes</h2>
            <p>
              Continuing to <strong>{intent}</strong> will drop your latest
              edits.
            </p>
            {signedOut ? null : (
              <p className="replace-guard-hint">
                {nativeSave ? (
                  <>
                    Save updates this Project's file. A new Project asks where
                    to save it.
                  </>
                ) : exportOnly ? (
                  <>
                    Export a Project file before continuing. This preview does
                    not save files in place.
                  </>
                ) : (
                  <>
                    Save keeps this Project in Cloud Projects (up to{" "}
                    {cloudProjectLimit}). Prefer a file?{" "}
                    <strong>File → Export Project File…</strong> downloads{" "}
                    <code>.icproj.json</code>.
                  </>
                )}
              </p>
            )}
            {problem?.kind === "failed" ? (
              <p
                className="replace-guard-warning"
                role="alert"
                data-testid="replace-guard-problem"
              >
                {problem.message}
              </p>
            ) : null}
            {signedOut ? (
              <CloudSaveSignIn
                onSignIn={signedOut.onSignIn}
                onExport={signedOut.onExportAndContinue}
                exportLabel={saving ? "Exporting…" : "Export and continue"}
                busy={saving}
              />
            ) : null}
          </div>
        </div>
        <div className="replace-guard-actions">
          <button
            type="button"
            className="replace-guard-discard"
            onClick={onDiscard}
            disabled={saving}
          >
            Continue without saving
          </button>
          <button
            type="button"
            className="replace-guard-stay"
            ref={cancelRef}
            onClick={onCancel}
            disabled={saving}
          >
            Stay
          </button>
          {signedOut ? null : (
            <button
              type="button"
              className="replace-guard-save"
              onClick={onSaveAndContinue}
              disabled={saving}
            >
              {nativeSave
                ? saving
                  ? "Saving…"
                  : "Save and continue"
                : exportOnly
                  ? saving
                    ? "Exporting…"
                    : "Export and continue"
                  : saving
                    ? "Saving to Cloud…"
                    : "Save to Cloud and continue"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
