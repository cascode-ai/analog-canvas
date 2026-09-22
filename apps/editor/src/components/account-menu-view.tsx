import { useState } from "react";
import type { AccountMenuViewProps } from "./account";

/** Presentational account area; all effects live in `AccountMenu`. */
export default function AccountMenuView({
  state,
  notice,
  showGalleryLinks = true,
  onEmailStart,
  onRename,
  onSignOut,
}: AccountMenuViewProps) {
  const [email, setEmail] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const { providers, user } = state;

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
        <details className="account-more">
          <summary aria-label="Account menu">
            {user.isAdmin ? (
              <span className="account-owner-badge" data-testid="account-owner">
                Owner
              </span>
            ) : user.role === "moderator" ? (
              <span className="account-owner-badge" data-testid="account-mod">
                Moderator
              </span>
            ) : null}
            <span aria-hidden="true">⋯</span>
          </summary>
          <div className="account-popover">
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
            <button
              type="button"
              className="account-signout"
              data-testid="account-signout"
              onClick={onSignOut}
            >
              Sign out
            </button>
          </div>
        </details>
      </div>
    );
  }

  if (!providers.github && !providers.google && !providers.email) {
    // Dark ship: with no provider configured, sign-in does not exist.
    return null;
  }

  return (
    <details className="account-signin" data-testid="account-signin">
      <summary>Sign in</summary>
      <div className="account-signin-panel">
        {providers.github ? (
          <a href="/api/auth/github/start" data-testid="signin-github">
            Continue with GitHub
          </a>
        ) : null}
        {providers.google ? (
          <a href="/api/auth/google/start" data-testid="signin-google">
            Continue with Google
          </a>
        ) : null}
        {providers.email ? (
          <form
            className="account-signin-email"
            onSubmit={(event) => {
              event.preventDefault();
              if (email.trim()) onEmailStart(email.trim());
            }}
          >
            <input
              type="email"
              aria-label="Email address"
              data-testid="signin-email-input"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <button type="submit" data-testid="signin-email-send">
              Email me a link
            </button>
          </form>
        ) : null}
        {notice ? (
          <p className="account-notice" data-testid="account-notice">
            {notice}
          </p>
        ) : null}
      </div>
    </details>
  );
}
