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
        <GalleryChrome subtitle="Review queue" showGalleryLink />
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
      <GalleryChrome subtitle="Review queue" showGalleryLink />
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
      </div>
    </main>
  );
}
