import { useEffect, useState } from "react";

import { fetchSessionUser, type SessionUser } from "./account";
import { GalleryChrome } from "./gallery-chrome";

/**
 * Review queue (roadmap phase G3): the super-admin and appointed
 * moderators approve pending community submissions into the public feed
 * or reject them with an optional reason the submitter sees. The admin
 * additionally appoints moderators by email from this page.
 */

export interface PendingEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  createdAt: string;
}

type QueueState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "ready"; user: SessionUser; entries: PendingEntry[] };

export async function loadReviewQueue(
  fetchLike: typeof fetch = fetch,
): Promise<QueueState> {
  const user = await fetchSessionUser(fetchLike);
  if (!user || (!user.isAdmin && user.role !== "moderator")) {
    return { status: "denied" };
  }
  try {
    const response = await fetchLike("/api/gallery/review", {
      credentials: "same-origin",
    });
    if (!response.ok) return { status: "denied" };
    const payload = (await response.json()) as { entries?: PendingEntry[] };
    return { status: "ready", user, entries: payload.entries ?? [] };
  } catch {
    return { status: "denied" };
  }
}

async function decide(
  id: string,
  decision: "approve" | "reject",
  reason: string,
  fetchLike: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchLike(`/api/gallery/${id}/${decision}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(decision === "reject" ? { reason } : {}),
    });
    return response.ok;
  } catch {
    return false;
  }
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
        ? `${email} can now review submissions.`
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

function ReviewCard({
  entry,
  onDecided,
}: {
  entry: PendingEntry;
  onDecided: (id: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(decision: "approve" | "reject"): Promise<void> {
    setBusy(true);
    const ok = await decide(entry.id, decision, reason.trim());
    setBusy(false);
    if (ok) onDecided(entry.id);
  }

  return (
    <article className="review-card" data-testid={`review-card-${entry.id}`}>
      <a
        className="review-card-preview"
        href={`/g/${entry.id}`}
        title="Open in the editor"
      >
        <img
          src={`/api/gallery/${entry.id}/preview.svg`}
          alt={`Preview of ${entry.name}`}
          loading="lazy"
        />
      </a>
      <div className="review-card-copy">
        <h2>{entry.name}</h2>
        <p className="review-card-meta">
          {entry.author ? `${entry.author} · ` : ""}
          {new Date(entry.createdAt).toLocaleString()}
        </p>
        {entry.description ? <p>{entry.description}</p> : null}
        <input
          aria-label="Rejection reason"
          data-testid={`review-reason-${entry.id}`}
          placeholder="Optional rejection reason"
          value={reason}
          maxLength={300}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
        <div className="review-card-actions">
          <button
            type="button"
            data-testid={`review-reject-${entry.id}`}
            disabled={busy}
            onClick={() => void act("reject")}
          >
            Reject
          </button>
          <button
            type="button"
            className="review-approve"
            data-testid={`review-approve-${entry.id}`}
            disabled={busy}
            onClick={() => void act("approve")}
          >
            Approve
          </button>
        </div>
      </div>
    </article>
  );
}

interface RecycledEntry {
  id: string;
  name: string;
  recycledAt?: string | null;
}

/**
 * In-feed admin recycle bin (G4): the post-approval takedown surface.
 * Restore returns an entry to the public wall; Delete forever is the
 * only hard deletion and asks for confirmation first.
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

export function ReviewQueue() {
  const [state, setState] = useState<QueueState>({ status: "loading" });
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadReviewQueue().then((next) => {
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
        <GalleryChrome subtitle="Review queue" />
        <div className="page-body">
          <p className="gallery-status">
            {state.status === "loading"
              ? "Loading review queue…"
              : "The review queue is for the gallery owner and appointed moderators."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="review-shell" data-testid="review-queue">
      <GalleryChrome subtitle="Review queue" />
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
        {state.entries.length === 0 ? (
          <p className="gallery-status" data-testid="review-empty">
            Nothing waiting for review.
          </p>
        ) : (
          <section className="review-list">
            {state.entries.map((entry) => (
              <ReviewCard
                key={entry.id}
                entry={entry}
                onDecided={(id) =>
                  setState((previous) =>
                    previous.status === "ready"
                      ? {
                          ...previous,
                          entries: previous.entries.filter(
                            (candidate) => candidate.id !== id,
                          ),
                        }
                      : previous,
                  )
                }
              />
            ))}
          </section>
        )}
        {state.user.isAdmin ? <RecycleBin /> : null}
      </div>
    </main>
  );
}
