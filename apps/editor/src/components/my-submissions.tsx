import { useCallback, useEffect, useState } from "react";

import { fetchSessionUser } from "./account";
import { GalleryChrome } from "./gallery-chrome";
import { VersionHistoryDialog } from "./version-history-dialog";

/**
 * "My submissions" (roadmap phase G3): a signed-in user's gallery entries
 * with their review status; a rejection shows the reviewer's optional
 * reason, and every entry opens back into the editor for another round
 * (an owner update re-enters review server-side). Owners can withdraw an
 * entry from the gallery, bring it back (through review for ordinary
 * accounts), and browse its version history.
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

/** Owner lifecycle action; the worker checks ownership per entry. */
export async function setMyEntryRecycled(
  id: string,
  action: "recycle" | "restore",
  fetchLike: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchLike(`/api/gallery/${id}/${action}`, {
      method: "POST",
      credentials: "same-origin",
    });
    return response.ok;
  } catch {
    return false;
  }
}

const STATUS_LABELS: Record<string, string> = {
  public: "Published",
  pending: "Waiting for review",
  rejected: "Rejected",
  recycled: "Withdrawn",
};

export function MySubmissions() {
  const [state, setState] = useState<MineState>({ status: "loading" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<MineEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setState(await loadMySubmissions());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadMySubmissions().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function act(
    entry: MineEntry,
    action: "recycle" | "restore",
  ): Promise<void> {
    setBusy(entry.id);
    setNotice(null);
    const ok = await setMyEntryRecycled(entry.id, action);
    setBusy(null);
    setConfirming(null);
    if (!ok) {
      setNotice(
        `Could not ${action === "recycle" ? "withdraw" : "restore"} "${entry.name}".`,
      );
      return;
    }
    setNotice(
      action === "recycle"
        ? `Withdrew "${entry.name}" from the gallery.`
        : `"${entry.name}" is on its way back — it re-enters review first.`,
    );
    await reload();
  }

  return (
    <main className="review-shell" data-testid="mine-page">
      <GalleryChrome subtitle="My submissions" />
      <div className="page-body">
        {notice ? (
          <p className="gallery-status" data-testid="mine-notice">
            {notice}
          </p>
        ) : null}
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
                  <div className="mine-card-actions">
                    <a
                      className="account-link mine-card-edit"
                      href={`/g/${entry.id}`}
                      data-testid={`mine-edit-${entry.id}`}
                    >
                      Open in editor
                    </a>
                    <button
                      type="button"
                      className="account-link mine-card-history"
                      data-testid={`mine-history-${entry.id}`}
                      onClick={() => setHistoryFor(entry)}
                    >
                      Version history
                    </button>
                    {entry.status === "recycled" ? (
                      <button
                        type="button"
                        className="account-link mine-card-restore"
                        data-testid={`mine-restore-${entry.id}`}
                        disabled={busy === entry.id}
                        onClick={() => void act(entry, "restore")}
                      >
                        Restore (re-enters review)
                      </button>
                    ) : confirming === entry.id ? (
                      <>
                        <button
                          type="button"
                          className="mine-withdraw mine-withdraw-confirm"
                          data-testid={`mine-withdraw-confirm-${entry.id}`}
                          disabled={busy === entry.id}
                          onClick={() => void act(entry, "recycle")}
                        >
                          Really withdraw
                        </button>
                        <button
                          type="button"
                          className="account-link"
                          onClick={() => setConfirming(null)}
                        >
                          Keep it
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="mine-withdraw"
                        data-testid={`mine-withdraw-${entry.id}`}
                        onClick={() => setConfirming(entry.id)}
                      >
                        Withdraw
                      </button>
                    )}
                  </div>
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
                  {entry.status === "recycled" ? (
                    <p className="mine-reason">
                      Not shown in the gallery. Restore sends it back through
                      review.
                    </p>
                  ) : null}
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
      {historyFor ? (
        <VersionHistoryDialog
          entryId={historyFor.id}
          entryName={historyFor.name}
          onRestored={() => {
            setHistoryFor(null);
            setNotice(
              `Restored an earlier version of "${historyFor.name}" — it re-enters review unless you are a reviewer.`,
            );
            void reload();
          }}
          onClose={() => setHistoryFor(null)}
        />
      ) : null}
    </main>
  );
}
