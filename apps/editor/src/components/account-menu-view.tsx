import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type {
  AccountMenuViewProps,
  DeleteAccountResult,
  SessionUser,
} from "./account";
import { GitHubMark, GoogleMark } from "./provider-marks";
import { OPEN_SIGN_IN_EVENT, takeSignInRequest } from "./sign-in-request";
import { SITE_PRIVACY_PATH } from "./site-resource-links";

type Deleted = Extract<DeleteAccountResult, { ok: true }>["deleted"];

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Deleting an account says exactly what goes, and that it cannot come back.
 * Afterwards it says what went, and the page starts over signed out.
 */
function AccountDeleteDialog({
  user,
  onDelete,
  onClose,
}: {
  user: SessionUser;
  onDelete: () => Promise<DeleteAccountResult>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<Deleted | null>(null);
  const cancel = useRef<HTMLButtonElement | null>(null);
  const done = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    (deleted ? done : cancel).current?.focus();
  }, [deleted]);
  const finish = () => window.location.reload();
  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await onDelete();
    setBusy(false);
    if (result.ok) setDeleted(result.deleted);
    else setError(result.message);
  };
  return createPortal(
    <div
      className="account-delete-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy && !deleted)
          onClose();
      }}
    >
      <section
        className="account-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-delete-title"
        data-testid="account-delete-dialog"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || busy) return;
          event.preventDefault();
          if (deleted) finish();
          else onClose();
        }}
      >
        {deleted ? (
          <>
            <h2 id="account-delete-title">Account deleted</h2>
            <p>
              Your account and everything kept for it are gone:{" "}
              {plural(deleted.circuits, "published circuit")},{" "}
              {plural(deleted.projects, "Cloud Project")},{" "}
              {plural(deleted.components, "shared component")} and{" "}
              {plural(deleted.likes, "like")}.
            </p>
            <div className="account-delete-actions">
              <button
                type="button"
                ref={done}
                className="account-delete-done"
                onClick={finish}
              >
                OK
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="account-delete-title">Delete your account?</h2>
            <p>
              This permanently deletes <strong>{user.displayName}</strong>
              {user.email ? ` (${user.email})` : ""} and everything the site
              keeps for it:
            </p>
            <ul>
              <li>your Cloud Projects and their saved versions;</li>
              <li>
                the circuits you published to the Gallery, with their history;
              </li>
              <li>the components you shared;</li>
              <li>your likes, your display name and your sign-in.</li>
            </ul>
            <p className="account-delete-hint">
              It cannot be undone, so export anything you want to keep first.
              Drawings kept only in this browser stay.
            </p>
            {error ? (
              <p className="account-delete-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="account-delete-actions">
              <button
                type="button"
                ref={cancel}
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="account-delete-confirm"
                data-testid="account-delete-confirm"
                onClick={() => void confirm()}
                disabled={busy}
              >
                {busy ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}

/** Presentational account area; all effects live in `AccountMenu`. */
export default function AccountMenuView({
  state,
  notice,
  showGalleryLinks = true,
  onEmailStart,
  onEmailVerify,
  onRename,
  onSignOut,
  onDeleteAccount,
}: AccountMenuViewProps) {
  const [email, setEmail] = useState("");
  // Signing in by email is two steps: the address, then the emailed code,
  // typed here whichever browser or device read the email.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const signIn = useRef<HTMLDetailsElement | null>(null);
  const more = useRef<HTMLDetailsElement | null>(null);
  const { providers, user } = state;

  // An invitation to sign in anywhere on the page opens these choices, also
  // one made while they were still loading.
  useEffect(() => {
    const open = () => {
      const details = signIn.current;
      if (!details || !takeSignInRequest()) return;
      details.open = true;
      details.scrollIntoView({ block: "nearest" });
      details
        .querySelector<HTMLElement>(
          ".account-signin-panel a, .account-signin-panel input",
        )
        ?.focus();
    };
    window.addEventListener(OPEN_SIGN_IN_EVENT, open);
    open();
    return () => window.removeEventListener(OPEN_SIGN_IN_EVENT, open);
  }, []);

  const sendCode = async (address: string) => {
    setBusy(true);
    setMessage(null);
    const result = await onEmailStart(address);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    if (sentTo === address)
      setMessage("A new code is on its way; the one before no longer works.");
    setSentTo(address);
    setCode("");
  };
  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    if (email.trim() && !busy) void sendCode(email.trim());
  };
  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!sentTo || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await onEmailVerify(sentTo, code.trim());
    setBusy(false);
    if (!result.ok) setMessage(result.message);
  };

  if (user) {
    return (
      <div className="account-menu" data-testid="account-menu">
        {renaming ? (
          <input
            className="account-rename-input"
            autoComplete="off"
            aria-label="Display name"
            data-testid="account-rename-input"
            value={draftName}
            maxLength={40}
            autoFocus
            onChange={(event) => setDraftName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draftName.trim()) {
                onRename(draftName.trim());
                setRenaming(false);
              }
              if (event.key === "Escape") setRenaming(false);
            }}
            onBlur={() => setRenaming(false)}
          />
        ) : (
          <button
            type="button"
            className="account-name"
            data-testid="account-name"
            title="Click to change your display name"
            onClick={() => {
              setDraftName(user.displayName);
              setRenaming(true);
            }}
          >
            {user.displayName}
          </button>
        )}
        {/* One disclosure instead of a row of links: at half-screen width the
            badge, Review, My submissions, and Sign out each wrapped onto two
            lines and the header became unreadable. */}
        <details className="account-more" ref={more}>
          <summary aria-label="Account menu">
            <span aria-hidden="true">⋯</span>
          </summary>
          <div className="account-popover">
            <div className="account-menu-identity">
              <strong data-testid="account-menu-name">
                {user.displayName}
              </strong>
              {user.isAdmin ? (
                <span
                  className="account-owner-badge"
                  data-testid="account-owner"
                >
                  Owner
                </span>
              ) : user.role === "moderator" ? (
                <span className="account-owner-badge" data-testid="account-mod">
                  Moderator
                </span>
              ) : null}
            </div>
            {showGalleryLinks && (user.isAdmin || user.role === "moderator") ? (
              <a
                className="account-link"
                href="/moderation"
                data-testid="account-moderation-link"
              >
                Moderation
              </a>
            ) : null}
            {showGalleryLinks ? (
              <a
                className="account-link"
                href="/mine"
                data-testid="account-mine"
              >
                My submissions
              </a>
            ) : null}
            <a
              className="account-link"
              href={SITE_PRIVACY_PATH}
              data-testid="account-privacy"
            >
              Privacy and cookies
            </a>
            <button
              type="button"
              className="account-signout"
              data-testid="account-signout"
              onClick={onSignOut}
            >
              Sign out
            </button>
            <button
              type="button"
              className="account-delete-open"
              data-testid="account-delete"
              aria-haspopup="dialog"
              onClick={() => {
                if (more.current) more.current.open = false;
                setDeletingAccount(true);
              }}
            >
              Delete account…
            </button>
          </div>
        </details>
        {deletingAccount ? (
          <AccountDeleteDialog
            user={user}
            onDelete={onDeleteAccount}
            onClose={() => setDeletingAccount(false)}
          />
        ) : null}
      </div>
    );
  }

  if (!providers.github && !providers.google && !providers.email) {
    // Dark ship: with no provider configured, sign-in does not exist.
    return null;
  }

  const notes = message ?? notice;
  return (
    <details
      ref={signIn}
      className="account-signin"
      data-testid="account-signin"
    >
      <summary>Sign in</summary>
      <div className="account-signin-panel">
        {providers.github ? (
          <a
            className="account-provider"
            href="/api/auth/github/start"
            data-testid="signin-github"
          >
            <GitHubMark />
            Continue with GitHub
          </a>
        ) : null}
        {providers.google ? (
          <a
            className="account-provider"
            href="/api/auth/google/start"
            data-testid="signin-google"
          >
            <GoogleMark />
            Continue with Google
          </a>
        ) : null}
        {providers.email && (providers.github || providers.google) ? (
          <div className="account-signin-divider" aria-hidden="true">
            <span>or</span>
          </div>
        ) : null}
        {providers.email && sentTo === null ? (
          <form className="account-signin-email" onSubmit={submitEmail}>
            <input
              type="email"
              autoComplete="email"
              aria-label="Email address"
              data-testid="signin-email-input"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <button
              type="submit"
              data-testid="signin-email-send"
              disabled={busy}
            >
              Email me a code
            </button>
          </form>
        ) : null}
        {providers.email && sentTo !== null ? (
          <form
            className="account-signin-email"
            onSubmit={(event) => void submitCode(event)}
          >
            <p className="account-signin-hint" data-testid="signin-code-hint">
              Enter the 6-digit code sent to <strong>{sentTo}</strong>.
            </p>
            <input
              className="account-signin-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Sign-in code"
              data-testid="signin-code-input"
              placeholder="123456"
              maxLength={9}
              autoFocus
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
            />
            <button
              type="submit"
              data-testid="signin-code-verify"
              disabled={busy || code.replace(/[\s-]/gu, "").length !== 6}
            >
              Sign in
            </button>
            <div className="account-signin-links">
              <button
                type="button"
                data-testid="signin-email-change"
                onClick={() => {
                  setSentTo(null);
                  setCode("");
                  setMessage(null);
                }}
              >
                Use another email
              </button>
              <button
                type="button"
                data-testid="signin-code-resend"
                disabled={busy}
                onClick={() => void sendCode(sentTo)}
              >
                Send a new code
              </button>
            </div>
          </form>
        ) : null}
        {notes ? (
          <p className="account-notice" data-testid="account-notice">
            {notes}
          </p>
        ) : null}
        <a
          className="account-signin-privacy"
          href={SITE_PRIVACY_PATH}
          data-testid="signin-privacy"
        >
          What signing in keeps: Privacy and cookies
        </a>
      </div>
    </details>
  );
}
