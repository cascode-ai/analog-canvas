import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/gallery-entry.css";

import {
  ACCOUNT_CHANGED_EVENT,
  accountInitial,
  cacheSessionUser,
  deleteAccount,
  fetchSessionUser,
  renameAccount,
  signOut,
  type DeleteAccountResult,
  type SessionUser,
} from "./account";
import { GalleryChrome } from "./gallery-chrome";
import { ModerationContent } from "./moderation";
import { MySubmissionsContent } from "./my-submissions";

type Deleted = Extract<DeleteAccountResult, { ok: true }>["deleted"];

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
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

/**
 * Deleting an account says exactly what goes and that it cannot come back,
 * and goes ahead only once the name is typed. Afterwards it says what went.
 */
export function AccountDeleteDialog({
  user,
  onDelete,
  onClose,
  onDone,
}: {
  user: SessionUser;
  onDelete: () => Promise<DeleteAccountResult>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<Deleted | null>(null);
  const [typed, setTyped] = useState("");
  const input = useRef<HTMLInputElement | null>(null);
  const done = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    (deleted ? done : input).current?.focus();
  }, [deleted]);
  const confirmed = typed.trim() === user.displayName.trim();
  const confirm = async () => {
    if (!confirmed) return;
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
          if (deleted) onDone();
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
                onClick={onDone}
              >
                OK
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
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
            <label className="account-delete-typed">
              <span>
                Type <strong>{user.displayName}</strong> to confirm
              </span>
              <input
                ref={input}
                autoComplete="off"
                data-testid="account-delete-typed"
                value={typed}
                onChange={(event) => setTyped(event.currentTarget.value)}
              />
            </label>
            {error ? (
              <p className="account-delete-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="account-delete-actions">
              <button type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="submit"
                className="account-delete-confirm"
                data-testid="account-delete-confirm"
                disabled={busy || !confirmed}
              >
                {busy ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>,
    document.body,
  );
}

export type AccountTab = "circuits" | "moderation" | "settings";

const TAB_LABELS: Record<AccountTab, string> = {
  circuits: "Circuits",
  moderation: "Moderation",
  settings: "Settings",
};

/**
 * The tabs this account has. Moderation is the Owner's: a moderator's tools
 * are on each circuit's own page, so there is nothing for them to open here.
 */
export function accountTabs(user: SessionUser): AccountTab[] {
  return user.isAdmin
    ? ["circuits", "moderation", "settings"]
    : ["circuits", "settings"];
}

/** The tab a link names (`?tab=…`), or the circuits. */
export function accountTabFromSearch(search: string): AccountTab {
  const tab = new URLSearchParams(search).get("tab");
  return tab === "moderation" || tab === "settings" ? tab : "circuits";
}

interface AccountActions {
  onRename: (displayName: string) => void;
  onSignOut: () => void;
  onDeleteAccount: () => Promise<DeleteAccountResult>;
  onDeleted: () => void;
}

/** Display name, signing out and, last, deleting the account. */
function AccountSettings({
  user,
  onRename,
  onSignOut,
  onDeleteAccount,
  onDeleted,
}: AccountActions & { user: SessionUser }) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(user.displayName);
  const [deleting, setDeleting] = useState(false);
  const saveName = () => {
    const name = draftName.trim();
    if (name && name !== user.displayName) onRename(name);
    setRenaming(false);
  };
  return (
    <div className="account-settings">
      <section
        className="account-page-section"
        aria-labelledby="account-profile"
      >
        <h3 id="account-profile">Profile</h3>
        {renaming ? (
          <form
            className="account-page-rename"
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
                setDraftName(user.displayName);
                setRenaming(false);
              }}
            />
            <div className="account-page-actions">
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
                className="account-page-primary"
                disabled={!draftName.trim()}
              >
                Save
              </button>
            </div>
          </form>
        ) : (
          <div className="account-page-row">
            <div>
              <span className="account-page-label">Display name</span>
              <span className="account-page-value">{user.displayName}</span>
            </div>
            <button
              type="button"
              data-testid="account-rename"
              onClick={() => {
                setDraftName(user.displayName);
                setRenaming(true);
              }}
            >
              Change
            </button>
          </div>
        )}
        <p className="account-page-note">Shown on the circuits you publish.</p>
      </section>

      <section
        className="account-page-section"
        aria-labelledby="account-session"
      >
        <h3 id="account-session">Sign out</h3>
        <div className="account-page-row">
          <span className="account-page-note">
            Signs this browser out. Drawings kept in it stay.
          </span>
          <button
            type="button"
            data-testid="account-signout"
            onClick={onSignOut}
          >
            Sign out
          </button>
        </div>
      </section>

      <section
        className="account-page-section account-page-danger"
        aria-labelledby="account-danger"
      >
        <h3 id="account-danger">Delete account</h3>
        <div className="account-page-row">
          <span className="account-page-note">
            Permanently deletes this account and everything the site keeps for
            it. You will be asked to type your name.
          </span>
          <button
            type="button"
            className="account-page-delete"
            data-testid="account-delete"
            aria-haspopup="dialog"
            onClick={() => setDeleting(true)}
          >
            Delete account…
          </button>
        </div>
      </section>

      {deleting ? (
        <AccountDeleteDialog
          user={user}
          onDelete={onDeleteAccount}
          onClose={() => setDeleting(false)}
          onDone={onDeleted}
        />
      ) : null}
    </div>
  );
}

/**
 * The account, laid out as a dashboard: who is signed in and the tabs at the
 * left, the open tab at the right. It opens on the account's circuits, all
 * of them at once; nothing is nested deeper than one tab.
 */
export function AccountDashboard({
  user,
  initialTab = "circuits",
  ...actions
}: AccountActions & { user: SessionUser; initialTab?: AccountTab }) {
  const tabs = accountTabs(user);
  const [tab, setTab] = useState<AccountTab>(
    tabs.includes(initialTab) ? initialTab : "circuits",
  );
  const select = (next: AccountTab) => {
    setTab(next);
    // The address names the open tab, so a reload or a link returns to it.
    try {
      const url = new URL(window.location.href);
      if (next === "circuits") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // A sandboxed frame may refuse; the tab is open either way.
    }
  };
  const role = user.isAdmin
    ? { label: "Owner", testId: "account-owner" }
    : user.role === "moderator"
      ? { label: "Moderator", testId: "account-mod" }
      : null;
  return (
    <div className="account-dashboard">
      <aside className="account-dashboard-side">
        <div className="account-dashboard-identity">
          <span className="account-page-avatar" aria-hidden="true">
            {accountInitial(user.displayName)}
          </span>
          <div>
            <h1 data-testid="account-menu-name">{user.displayName}</h1>
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
        </div>
        <nav
          className="account-dashboard-tabs"
          role="tablist"
          aria-label="Account"
        >
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-testid={`account-tab-${id}`}
              onClick={() => select(id)}
            >
              {TAB_LABELS[id]}
            </button>
          ))}
        </nav>
      </aside>
      <section
        className="account-dashboard-main"
        role="tabpanel"
        aria-label={TAB_LABELS[tab]}
        data-testid={`account-panel-${tab}`}
      >
        <h2>{TAB_LABELS[tab]}</h2>
        {tab === "circuits" ? (
          <MySubmissionsContent />
        ) : tab === "moderation" ? (
          <ModerationContent isAdmin={user.isAdmin} />
        ) : (
          <AccountSettings user={user} {...actions} />
        )}
      </section>
    </div>
  );
}

type AccountPageState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "ready"; user: SessionUser };

/** `/account`: the signed-in account's own page. */
export function AccountPage() {
  const [state, setState] = useState<AccountPageState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    void fetchSessionUser().then((user) => {
      if (!cancelled)
        setState(user ? { status: "ready", user } : { status: "signed-out" });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <main className="review-shell account-shell" data-testid="account-page">
      <GalleryChrome subtitle="Account" />
      <div className="page-body account-page-body">
        {state.status === "loading" ? (
          <p className="gallery-status">Loading your account…</p>
        ) : state.status === "signed-out" ? (
          <p className="gallery-status" data-testid="account-signed-out">
            Sign in (top right) to see your account.
          </p>
        ) : (
          <AccountDashboard
            user={state.user}
            initialTab={accountTabFromSearch(window.location.search)}
            onRename={(displayName) => {
              void renameAccount(displayName).then((user) => {
                if (!user) return;
                cacheSessionUser(fetch, user);
                setState({ status: "ready", user });
                window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
              });
            }}
            onSignOut={() => {
              void signOut().then(() => {
                cacheSessionUser(fetch, null);
                window.location.assign("/");
              });
            }}
            onDeleteAccount={async () => {
              const result = await deleteAccount();
              if (result.ok) cacheSessionUser(fetch, null);
              return result;
            }}
            onDeleted={() => window.location.assign("/")}
          />
        )}
      </div>
    </main>
  );
}
