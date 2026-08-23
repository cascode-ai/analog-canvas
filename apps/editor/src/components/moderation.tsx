import { useEffect, useState } from "react";

import { fetchSessionUser, type SessionUser } from "./account";
import { GalleryChrome } from "./gallery-chrome";

/**
 * Moderation, the post-publication surface. Publishing is direct, so there
 * is nothing to approve in advance; what a curator needs is the ability to
 * take an entry down afterwards, put it back, and finally delete it. The
 * super-admin also appoints moderators by email from here.
 */

type ModerationState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "ready"; user: SessionUser };

export async function loadModerationAccess(
  fetchLike: typeof fetch = fetch,
): Promise<ModerationState> {
  const user = await fetchSessionUser(fetchLike);
  if (!user || (!user.isAdmin && user.role !== "moderator")) {
    return { status: "denied" };
  }
  return { status: "ready", user };
}

async function appointModerator(
  email: string,
  role: "moderator" | "user",
  fetchLike: typeof fetch = fetch,
): Promise<string> {
  try {
    const response = await fetchLike("/api/auth/users/role", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (response.ok) {
      return role === "moderator"
        ? `${email} can now moderate the gallery.`
        : `${email} is an ordinary user again.`;
    }
    if (response.status === 404) {
      return "No account with that email has signed in yet.";
    }
    return "Could not change the role.";
  } catch {
    return "Could not change the role.";
  }
}

interface RecycledEntry {
  id: string;
  name: string;
  recycledAt?: string | null;
}

/**
 * The recycle bin: the takedown surface. Restore returns an entry to the
 * public wall; Delete forever is the only hard deletion and asks for
 * confirmation first.
 */
function RecycleBin() {
  const [entries, setEntries] = useState<RecycledEntry[] | null>(null);

  async function refresh(): Promise<void> {
    try {
      const response = await fetch("/api/gallery/recycled", {
        credentials: "same-origin",
      });
      if (!response.ok) {
        setEntries([]);
        return;
      }
      const payload = (await response.json()) as {
        entries?: RecycledEntry[];
      };
      setEntries(payload.entries ?? []);
    } catch {
      setEntries([]);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, []);

  async function act(id: string, kind: "restore" | "delete"): Promise<void> {
    if (
      kind === "delete" &&
      !window.confirm("Delete this entry forever? This cannot be undone.")
    ) {
      return;
    }
    try {
      await fetch(
        kind === "restore"
          ? `/api/gallery/${id}/restore`
          : `/api/gallery/${id}`,
        {
          method: kind === "restore" ? "POST" : "DELETE",
          credentials: "same-origin",
        },
      );
    } catch {
      // The refresh below shows the true state either way.
    }
    void refresh();
  }

  if (entries === null) return null;
  return (
    <section className="review-bin" data-testid="review-bin">
      <h2>Recycle bin</h2>
      {entries.length === 0 ? (
        <p className="gallery-status" data-testid="bin-empty">
          The bin is empty.
        </p>
      ) : (
        <div className="mine-list">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className="mine-card"
              data-testid={`bin-card-${entry.id}`}
            >
              <div className="mine-card-copy">
                <h2>{entry.name}</h2>
                {entry.recycledAt ? (
                  <p className="review-card-meta">
                    Recycled {new Date(entry.recycledAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
              <div className="review-card-actions">
                <button
                  type="button"
                  data-testid={`bin-delete-${entry.id}`}
                  onClick={() => void act(entry.id, "delete")}
                >
                  Delete forever
                </button>
                <button
                  type="button"
                  className="review-approve"
                  data-testid={`bin-restore-${entry.id}`}
                  onClick={() => void act(entry.id, "restore")}
                >
                  Restore
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function Moderation() {
  const [state, setState] = useState<ModerationState>({ status: "loading" });
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadModerationAccess().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status !== "ready") {
    return (
      <main
        className="review-shell"
        data-testid={
          state.status === "denied" ? "review-denied" : "review-page"
        }
      >
        <GalleryChrome subtitle="Moderation" />
        <div className="page-body">
          <p className="gallery-status">
            {state.status === "loading"
              ? "Loading moderation…"
              : "Moderation is for the gallery owner and appointed moderators."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="review-shell" data-testid="moderation">
      <GalleryChrome subtitle="Moderation" />
      <div className="page-body">
        {state.user.isAdmin ? (
          <form
            className="review-appoint"
            data-testid="review-appoint"
            onSubmit={(event) => {
              event.preventDefault();
              if (!email.trim()) return;
              void appointModerator(email.trim(), "moderator").then(setNotice);
            }}
          >
            <input
              type="email"
              aria-label="Moderator email"
              placeholder="Appoint a moderator by email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <button type="submit">Appoint</button>
            {notice ? <span className="account-notice">{notice}</span> : null}
          </form>
        ) : null}
        {state.user.isAdmin ? (
          <RecycleBin />
        ) : (
          <p className="gallery-status">
            Withdraw an entry from its page; the owner and the admin can bring
            it back.
          </p>
        )}
      </div>
    </main>
  );
}
