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

/** The first letter a name starts with, for the round mark beside it. */
function initialOf(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? "?";
}

function signedInWith(user: SessionUser): string {
  const provider =
    user.provider === "github"
      ? "GitHub"
      : user.provider === "google"
        ? "Google"
        : "email";
  return `Signed in with ${provider}`;
}

interface AccountPanelProps {
  user: SessionUser;
  showGalleryLinks: boolean;
  onRename: (displayName: string) => void;
  onSignOut: () => void;
  onClose: () => void;
}

/**
 * The account, opened from the name in the header: who is signed in, a plain
 * menu of what an account can do, and deleting it kept apart at the bottom.
 */
export function AccountPanelContent({
  user,
  showGalleryLinks,
  onRename,
  onSignOut,
  onClose,
  onDelete,
}: AccountPanelProps & { onDelete: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(user.displayName);
  const close = useRef<HTMLButtonElement | null>(null);
  useEffect(() => close.current?.focus(), []);
  const saveName = () => {
    const name = draftName.trim();
    if (name && name !== user.displayName) onRename(name);
    setRenaming(false);
  };
  const role = user.isAdmin
    ? { label: "Owner", testId: "account-owner" }
    : user.role === "moderator"
      ? { label: "Moderator", testId: "account-mod" }
      : null;
  return (
    <section
      className="account-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-panel-title"
      data-testid="account-panel"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || renaming) return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className="account-panel-header">
        <span className="account-panel-avatar" aria-hidden="true">
          {initialOf(user.displayName)}
        </span>
        <div className="account-panel-identity">
          <h2 id="account-panel-title" data-testid="account-menu-name">
            {user.displayName}
          </h2>
          <p>
            {signedInWith(user)}
            {user.email ? <span> · {user.email}</span> : null}
          </p>
          {role ? (
            <span className="account-owner-badge" data-testid={role.testId}>
              {role.label}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          ref={close}
          className="account-panel-close"
          aria-label="Close"
          data-testid="account-panel-close"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <nav className="account-panel-menu" aria-label="Account">
        {renaming ? (
          <form
            className="account-panel-rename"
            onSubmit={(event) => {
              event.preventDefault();
              saveName();
            }}
          >
            <label htmlFor="account-rename-input">Display name</label>
            <input
              id="account-rename-input"
              className="account-rename-input"
              autoComplete="off"
              data-testid="account-rename-input"
              value={draftName}
              maxLength={40}
              autoFocus
              onChange={(event) => setDraftName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                setDraftName(user.displayName);
                setRenaming(false);
              }}
            />
            <div className="account-panel-rename-actions">
              <button
                type="button"
                onClick={() => {
                  setDraftName(user.displayName);
                  setRenaming(false);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="account-panel-save"
                disabled={!draftName.trim()}
              >
                Save
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="account-panel-item"
            data-testid="account-rename"
            onClick={() => {
              setDraftName(user.displayName);
              setRenaming(true);
            }}
          >
            <span>Display name</span>
            <span className="account-panel-value">{user.displayName}</span>
          </button>
        )}
        {showGalleryLinks ? (
          <a
            className="account-panel-item"
            href="/mine"
            data-testid="account-mine"
          >
            <span>My submissions</span>
          </a>
        ) : null}
        {showGalleryLinks && (user.isAdmin || user.role === "moderator") ? (
          <a
            className="account-panel-item"
            href="/moderation"
            data-testid="account-moderation-link"
          >
            <span>Moderation</span>
          </a>
        ) : null}
        <button
          type="button"
          className="account-panel-item"
          data-testid="account-signout"
          onClick={() => {
            onClose();
            onSignOut();
          }}
        >
          <span>Sign out</span>
        </button>
      </nav>
      <footer className="account-panel-danger">
        <button
          type="button"
          className="account-delete-open"
          data-testid="account-delete"
          aria-haspopup="dialog"
          onClick={onDelete}
        >
          Delete account…
        </button>
      </footer>
    </section>
  );
}

/** The panel over the page, or the delete confirmation in its place. */
function AccountPanel({
  onDeleteAccount,
  ...props
}: AccountPanelProps & {
  onDeleteAccount: () => Promise<DeleteAccountResult>;
}) {
  const [deleting, setDeleting] = useState(false);
  if (deleting)
    return (
      <AccountDeleteDialog
        user={props.user}
        onDelete={onDeleteAccount}
        onClose={() => setDeleting(false)}
      />
    );
  return createPortal(
    <div
      className="account-panel-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <AccountPanelContent {...props} onDelete={() => setDeleting(true)} />
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
  const [panelOpen, setPanelOpen] = useState(false);
  const signIn = useRef<HTMLDetailsElement | null>(null);
  const nameButton = useRef<HTMLButtonElement | null>(null);
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
    // One button, the name: it opens the account. Clicking the name used to
    // rename on the spot, and the menu hid behind a separate ⋯.
    return (
      <div className="account-menu" data-testid="account-menu">
        <button
          type="button"
          ref={nameButton}
          className="account-name"
          data-testid="account-name"
          data-initial={initialOf(user.displayName)}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          title="Your account"
          onClick={() => setPanelOpen(true)}
        >
          {user.displayName}
        </button>
        {panelOpen ? (
          <AccountPanel
            user={user}
            showGalleryLinks={showGalleryLinks}
            onRename={onRename}
            onSignOut={onSignOut}
            onDeleteAccount={onDeleteAccount}
            onClose={() => {
              setPanelOpen(false);
              nameButton.current?.focus();
            }}
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
