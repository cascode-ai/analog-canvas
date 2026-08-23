import { useEffect, useState } from "react";

/**
 * Gallery accounts (roadmap phase G2), dark-shipped: the worker reports
 * which sign-in providers are enabled; until any secret exists the whole
 * account area renders nothing. Sessions ride an HttpOnly cookie, so the
 * client only ever sees the public profile from `/api/auth/me`.
 */

export interface SessionUser {
  id: string;
  displayName: string;
  email: string | null;
  provider: string;
  /** "user" or "moderator" (appointed by the super-admin). */
  role: string;
  isAdmin: boolean;
}

export interface AuthProviders {
  github: boolean;
  google: boolean;
  email: boolean;
}

export interface AccountState {
  providers: AuthProviders;
  user: SessionUser | null;
}

const NO_PROVIDERS: AuthProviders = {
  github: false,
  google: false,
  email: false,
};

/** The signed-in user, or null (also on any failure). */
export async function fetchSessionUser(
  fetchLike: typeof fetch = fetch,
): Promise<SessionUser | null> {
  try {
    const response = await fetchLike("/api/auth/me", {
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { user?: SessionUser | null };
    return payload.user ?? null;
  } catch {
    return null;
  }
}

/** Providers plus session; a dark or unreachable worker reads as no-auth. */
export async function loadAccountState(
  fetchLike: typeof fetch = fetch,
): Promise<AccountState> {
  try {
    const response = await fetchLike("/api/auth/providers", {
      credentials: "same-origin",
    });
    if (!response.ok) return { providers: NO_PROVIDERS, user: null };
    const providers = (await response.json()) as AuthProviders;
    const anyProvider = providers.github || providers.google || providers.email;
    return {
      providers,
      user: anyProvider ? await fetchSessionUser(fetchLike) : null,
    };
  } catch {
    return { providers: NO_PROVIDERS, user: null };
  }
}

async function requestEmailLink(
  email: string,
  fetchLike: typeof fetch = fetch,
): Promise<string> {
  try {
    const response = await fetchLike("/api/auth/email/start", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (response.status === 202) return "Check your inbox for the link.";
    if (response.status === 429) return "Daily limit reached — try tomorrow.";
    if (response.status === 400) return "That email address looks invalid.";
    return "Could not send the link — try again later.";
  } catch {
    return "Could not send the link — try again later.";
  }
}

async function renameAccount(
  displayName: string,
  fetchLike: typeof fetch = fetch,
): Promise<SessionUser | null> {
  try {
    const response = await fetchLike("/api/auth/profile", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { user?: SessionUser };
    return payload.user ?? null;
  } catch {
    return null;
  }
}

async function signOut(fetchLike: typeof fetch = fetch): Promise<void> {
  try {
    await fetchLike("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    // The cookie may survive a network hiccup; the next load re-syncs.
  }
}

export interface AccountMenuViewProps {
  state: AccountState;
  notice: string | null;
  onEmailStart: (email: string) => void;
  onRename: (displayName: string) => void;
  onSignOut: () => void;
}

/** Presentational account area; all effects live in `AccountMenu`. */
export function AccountMenuView({
  state,
  notice,
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
          <div className="command-popover account-popover">
            {user.isAdmin || user.role === "moderator" ? (
              <a
                className="account-link"
                href="/moderation"
                data-testid="account-moderation-link"
              >
                Moderation
              </a>
            ) : null}
            <a className="account-link" href="/mine" data-testid="account-mine">
              My submissions
            </a>
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

/** Self-loading account area for the gallery chrome. */
export function AccountMenu() {
  const [state, setState] = useState<AccountState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (new URLSearchParams(window.location.search).get("auth") === "failed") {
      setNotice("Sign-in failed — try again.");
      window.history.replaceState(null, "", window.location.pathname);
    }
    void loadAccountState().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) return null;
  return (
    <AccountMenuView
      state={state}
      notice={notice}
      onEmailStart={(email) => {
        void requestEmailLink(email).then(setNotice);
      }}
      onRename={(displayName) => {
        void renameAccount(displayName).then((user) => {
          if (user) setState({ providers: state.providers, user });
        });
      }}
      onSignOut={() => {
        void signOut().then(() =>
          setState({ providers: state.providers, user: null }),
        );
      }}
    />
  );
}
