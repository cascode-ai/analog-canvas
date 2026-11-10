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
