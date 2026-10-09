import { lazy, Suspense, useEffect, useState } from "react";

const AccountMenuView = lazy(() => import("./account-menu-view"));

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
  /** An AI account's seat, such as ai-designer-1. */
  seat?: string;
  /** One of the Owner's own accounts, which open the Data tab (#1446). */
  isOwner?: boolean;
  /** The Owner who switched this browser to the AI account, and can switch back. */
  switchedFrom?: { displayName: string };
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

const SESSION_CACHE_MS = 30_000;
const sessionRequests = new WeakMap<
  typeof fetch,
  { expiresAt: number; request: Promise<SessionUser | null> }
>();

export function cacheSessionUser(
  fetchLike: typeof fetch,
  user: SessionUser | null,
): void {
  sessionRequests.set(fetchLike, {
    expiresAt: Date.now() + SESSION_CACHE_MS,
    request: Promise.resolve(user),
  });
}

/** The signed-in user, or null (also on any failure). */
export async function fetchSessionUser(
  fetchLike: typeof fetch = fetch,
): Promise<SessionUser | null> {
  const cached = sessionRequests.get(fetchLike);
  if (cached && cached.expiresAt > Date.now()) return cached.request;
  const request = (async (): Promise<SessionUser | null> => {
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
  })();
  sessionRequests.set(fetchLike, {
    expiresAt: Date.now() + SESSION_CACHE_MS,
    request,
  });
  return request;
}

/** Providers plus session; a dark or unreachable worker reads as no-auth. */
async function loadAccountState(
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

/** What asking for, or typing, an emailed sign-in code came to. */
export type EmailCodeResult = { ok: true } | { ok: false; message: string };

/** Emails a six-digit sign-in code to `email`. */
export async function requestEmailCode(
  email: string,
  fetchLike: typeof fetch = fetch,
): Promise<EmailCodeResult> {
  try {
    const response = await fetchLike("/api/auth/email/start", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (response.status === 202) return { ok: true };
    if (response.status === 429)
      return { ok: false, message: "Daily limit reached — try tomorrow." };
    if (response.status === 400)
      return { ok: false, message: "That email address looks invalid." };
    return { ok: false, message: "Could not send the code — try again later." };
  } catch {
    return { ok: false, message: "Could not send the code — try again later." };
  }
}

/**
 * Signs this browser in with the code emailed to `email`; the session
 * cookie comes back with the answer.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
  fetchLike: typeof fetch = fetch,
): Promise<EmailCodeResult> {
  try {
    const response = await fetchLike("/api/auth/email/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    if (response.ok) return { ok: true };
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      attemptsLeft?: number;
    };
    if (payload.error === "too-many-attempts")
      return {
        ok: false,
        message: "Too many wrong codes — send a new one.",
      };
    if (payload.error === "expired-code")
      return {
        ok: false,
        message: "That code has expired or was used — send a new one.",
      };
    if (payload.error === "invalid-code")
      return {
        ok: false,
        message:
          payload.attemptsLeft === undefined
            ? "Enter the 6-digit code from the email."
            : `That code is not right — ${payload.attemptsLeft} ${payload.attemptsLeft === 1 ? "try" : "tries"} left.`,
      };
    return { ok: false, message: "Could not sign in — try again." };
  } catch {
    return { ok: false, message: "Could not sign in — try again." };
  }
}

export async function renameAccount(
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

export type DeleteAccountResult =
  | {
      ok: true;
      deleted: {
        circuits: number;
        likes: number;
        projects: number;
        components: number;
      };
    }
  | { ok: false; message: string };

/** Deletes the signed-in account and everything the site keeps for it. */
export async function deleteAccount(
  fetchLike: typeof fetch = fetch,
): Promise<DeleteAccountResult> {
  try {
    const response = await fetchLike("/api/auth/account/delete", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "delete-account" }),
    });
    if (response.ok) {
      const payload = (await response.json()) as {
        deleted: Extract<DeleteAccountResult, { ok: true }>["deleted"];
      };
      return { ok: true, deleted: payload.deleted };
    }
    if (response.status === 401)
      return { ok: false, message: "You are signed out. Sign in again." };
    return {
      ok: false,
      message:
        "Could not delete the account. You are still signed in; try again in a moment.",
    };
  } catch {
    return {
      ok: false,
      message:
        "Could not reach the site. You are still signed in; try again in a moment.",
    };
  }
}

/** Switches this browser back from an AI account to the Owner's own. */
async function returnToOwner(
  fetchLike: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchLike("/api/auth/ai-accounts/return", {
      method: "POST",
      credentials: "same-origin",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function signOut(fetchLike: typeof fetch = fetch): Promise<void> {
  try {
    await fetchLike("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    // The cookie may survive a network hiccup; the next load re-syncs.
  }
}

/** Fired on the page after the account changes, so the header reads it again. */
export const ACCOUNT_CHANGED_EVENT = "icm-account-changed";

/** The first letter a name starts with, for the round mark beside it. */
export function accountInitial(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? "?";
}

export interface AccountMenuViewProps {
  state: AccountState;
  notice: string | null;
  /** Where a drawing is open, the account opens in a new tab beside it. */
  inEditor?: boolean;
  /** Emails a sign-in code. */
  onEmailStart: (email: string) => Promise<EmailCodeResult>;
  /** Signs in with the emailed code. */
  onEmailVerify: (email: string, code: string) => Promise<EmailCodeResult>;
  /** Switches a browser the Owner switched to an AI account back. */
  onReturnToOwner: () => void;
}

/** Self-loading account area shared by Gallery and Editor chrome. */
export function AccountMenu({
  inEditor = false,
  alwaysVisible = false,
}: {
  /** Where a drawing is open, the account opens in a new tab beside it. */
  inEditor?: boolean;
  /** Keep the account affordance mounted while identity data is loading. */
  alwaysVisible?: boolean;
}) {
  const [state, setState] = useState<AccountState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (new URLSearchParams(window.location.search).get("auth") === "failed") {
      setNotice("Sign-in failed — try again.");
      window.history.replaceState(null, "", window.location.pathname);
    }
    const load = () =>
      void loadAccountState().then((next) => {
        if (!cancelled) setState(next);
      });
    load();
    window.addEventListener(ACCOUNT_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(ACCOUNT_CHANGED_EVENT, load);
    };
  }, []);

  if (!state) return alwaysVisible ? <AccountMenuFallback /> : null;
  if (
    alwaysVisible &&
    !state.user &&
    !state.providers.github &&
    !state.providers.google &&
    !state.providers.email
  ) {
    return <AccountMenuFallback />;
  }
  return (
    <Suspense fallback={null}>
      <AccountMenuView
        state={state}
        notice={notice}
        inEditor={inEditor}
        onEmailStart={(email) => requestEmailCode(email)}
        onEmailVerify={async (email, code) => {
          const result = await verifyEmailCode(email, code);
          // Signed in: the page starts over with the session, as a GitHub or
          // Google sign-in returns to a freshly loaded page.
          if (result.ok) window.location.reload();
          return result;
        }}
        onReturnToOwner={() => {
          // Back, or signed out when the way back had gone: either way the
          // page starts over with what the browser now is.
          void returnToOwner().then(() => window.location.reload());
        }}
      />
    </Suspense>
  );
}

function AccountMenuFallback() {
  return (
    <details className="account-signin account-menu-fallback">
      <summary aria-label="Account menu">
        <span aria-hidden="true">⋯</span>
      </summary>
      <div className="account-popover">
        <div className="account-menu-identity">
          <strong>Account</strong>
          <span>Sign in to manage your account.</span>
        </div>
      </div>
    </details>
  );
}
