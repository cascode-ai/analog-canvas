import { useEffect, useState } from "react";

import { fetchSessionUser } from "./account";
import { GalleryChrome } from "./gallery-chrome";

/**
 * "My submissions" (roadmap phase G3): a signed-in user's gallery entries
 * with their review status; a rejection shows the reviewer's optional
 * reason, and every entry opens back into the editor for another round
 * (an owner update re-enters review server-side).
 */

export interface MineEntry {
  id: string;
  name: string;
  createdAt: string;
  status: string;
  rejectReason: string | null;
}

type MineState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "ready"; entries: MineEntry[] };

export async function loadMySubmissions(
  fetchLike: typeof fetch = fetch,
): Promise<MineState> {
  const user = await fetchSessionUser(fetchLike);
  if (!user) return { status: "signed-out" };
  try {
    const response = await fetchLike("/api/gallery/mine", {
      credentials: "same-origin",
    });
    if (!response.ok) return { status: "signed-out" };
    const payload = (await response.json()) as { entries?: MineEntry[] };
    return { status: "ready", entries: payload.entries ?? [] };
  } catch {
    return { status: "signed-out" };
  }
}

const STATUS_LABELS: Record<string, string> = {
  public: "Published",
  pending: "Waiting for review",
  rejected: "Rejected",
  recycled: "Removed",
};

export function MySubmissions() {
  const [state, setState] = useState<MineState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void loadMySubmissions().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="review-shell" data-testid="mine-page">
      <GalleryChrome subtitle="My submissions" showGalleryLink />
      <div className="page-body">
        {state.status === "loading" ? (
          <p className="gallery-status">Loading your submissions…</p>
        ) : state.status === "signed-out" ? (
          <p className="gallery-status" data-testid="mine-signed-out">
            Sign in (top right) to see your submissions.
          </p>
        ) : state.entries.length === 0 ? (
          <p className="gallery-status">
            Nothing yet — open the <a href="/editor">editor</a> and use the
            Publish button.
          </p>
        ) : (
          <section className="mine-list" data-testid="mine-list">
            {state.entries.map((entry) => (
              <article
                key={entry.id}
                className="mine-card"
                data-testid={`mine-card-${entry.id}`}
              >
                <a
                  className="mine-card-preview"
                  href={`/g/${entry.id}`}
                  title="Open in the editor"
                >
                  <img
                    src={`/api/gallery/${entry.id}/preview.svg`}
                    alt={`Preview of ${entry.name}`}
                    loading="lazy"
                  />
                </a>
                <div className="mine-card-copy">
                  <h2>{entry.name}</h2>
                  <p className="review-card-meta">
                    {new Date(entry.createdAt).toLocaleString()}
                  </p>
                  <a
                    className="account-link mine-card-edit"
                    href={`/g/${entry.id}`}
                    data-testid={`mine-edit-${entry.id}`}
                  >
                    Open in editor
                  </a>
                </div>
                <div className="mine-card-status">
                  <span
                    className={`mine-status mine-status-${entry.status}`}
                    data-testid={`mine-status-${entry.id}`}
                  >
                    {STATUS_LABELS[entry.status] ?? entry.status}
                  </span>
                  {entry.status === "rejected" && entry.rejectReason ? (
                    <p
                      className="mine-reason"
                      data-testid={`mine-reason-${entry.id}`}
                    >
                      Reason: {entry.rejectReason}
                    </p>
                  ) : null}
                  {entry.status === "rejected" ? (
                    <p className="mine-reason">
                      Edit it in the editor and publish again — the update
                      re-enters review.
                    </p>
                  ) : null}
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
