import { useEffect, useRef } from "react";

export interface CloudSaveSignInProps {
  /** Opens the page header's sign-in choices (GitHub, Google, email). */
  onSignIn(): void;
  /** Keeps the Project as a file instead. */
  onExport(): void;
  exportLabel: string;
  busy?: boolean;
}

/**
 * What a signed-out Cloud Save offers instead of failing quietly: an
 * account to save with, or the Project as a file. The dialog holding this
 * closes before the sign-in choices open, as they sit underneath it.
 */
export function CloudSaveSignIn({
  onSignIn,
  onExport,
  exportLabel,
  busy = false,
}: CloudSaveSignInProps) {
  return (
    <div className="cloud-save-sign-in" data-testid="cloud-save-sign-in">
      <p role="alert">
        Saving to the Cloud needs an account. Sign in, or keep this Project as a
        file.
      </p>
      <div className="cloud-save-sign-in-actions">
        <button
          type="button"
          className="cloud-save-sign-in-primary"
          data-testid="cloud-save-sign-in-button"
          onClick={onSignIn}
          disabled={busy}
        >
          Sign in
        </button>
        <button
          type="button"
          data-testid="cloud-save-export"
          onClick={onExport}
          disabled={busy}
        >
          {exportLabel}
        </button>
      </div>
    </div>
  );
}

export interface SaveSignInDialogProps {
  /** Closes this dialog, opens the sign-in choices; the Save follows. */
  onSignIn(): void;
  /** Closes this dialog and downloads the Project file. */
  onDownload(): void;
  onClose(): void;
}

/**
 * File > Save or Ctrl/Cmd+S without an account (#2161): sign in and the
 * Save continues, or download the Project file. Escape and Not now leave
 * the work as it was, unsaved.
 */
export function SaveSignInDialog({
  onSignIn,
  onDownload,
  onClose,
}: SaveSignInDialogProps) {
  const dialog = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      dialog.current
        ?.querySelector<HTMLButtonElement>(".cloud-save-sign-in-primary")
        ?.focus(),
    );
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
        ref={dialog}
        className="replace-guard-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-sign-in-title"
        data-testid="save-sign-in-dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="replace-guard-copy">
          <h2 id="save-sign-in-title">Sign in to save</h2>
          <CloudSaveSignIn
            onSignIn={onSignIn}
            onExport={onDownload}
            exportLabel="Download project file"
          />
        </div>
        <div className="replace-guard-actions">
          <button
            type="button"
            className="replace-guard-stay save-sign-in-close"
            onClick={onClose}
          >
            Not now
          </button>
        </div>
      </section>
    </div>
  );
}
