import { useCallback, useEffect, useRef, useState } from "react";
import "../styles/gallery-entry.css";

import {
  announceGalleryChange,
  galleryPreviewUrl,
  subscribeGalleryRefresh,
} from "../gallery-client";
import { fetchSessionUser } from "./account";
import { GalleryChrome } from "./gallery-chrome";
import { VersionHistoryDialog } from "./version-history-dialog";

/**
 * "My submissions" (roadmap phase G3): a signed-in user's gallery entries
 * with their review status; a rejection shows the Owner's required
 * reason, and every entry opens back into the editor for correction. Owners
 * can withdraw and restore their own public entries and browse version
 * history; an Owner rejection stays hidden until the Owner restores it.
 */

export interface MineEntry {
  id: string;
  name: string;
  createdAt: string;
  previewRevision?: string;
  status: string;
  rejectReason: string | null;
  recycledAt?: string | null;
}

/**
 * Mirrors the worker's GALLERY_RECYCLED_KEEP_PER_ACCOUNT. The cap is the
 * whole retention policy — nothing in the bin expires by time, so the card
 * states the rule instead of promising a date.
 */
export const RECYCLED_KEEP_COUNT = 25;

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
/**
 * Remove one of your own entries for good. The daily publish quota counts the
 * entries that still stand, so deleting hands the slot straight back — an
 * author is not rationed on changing their mind.
 */
export async function deleteMyEntry(
  id: string,
  fetchLike: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchLike(`/api/gallery/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    return response.ok;
  } catch {
    return false;
  }
}

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
    if (response.ok) announceGalleryChange({ entryId: id });
    return response.ok;
  } catch {
    return false;
  }
}

// Publishing is direct, so nothing new is ever "pending". Rejection is the
// Owner's post-publication takedown with an author-visible reason.
const STATUS_LABELS: Record<string, string> = {
  public: "Published",
  rejected: "Rejected",
  recycled: "Withdrawn",
};

export function MySubmissions() {
  const [state, setState] = useState<MineState>({ status: "loading" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<MineEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    const next = await loadMySubmissions();
    if (generation === loadGenerationRef.current) setState(next);
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [reload]);

  useEffect(() => subscribeGalleryRefresh(() => void reload()), [reload]);

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
        : `Restored "${entry.name}" to the gallery.`,
    );
    await reload();
  }

  async function remove(entry: MineEntry): Promise<void> {
    if (
      !window.confirm(
        `Delete "${entry.name}" permanently? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(entry.id);
    setNotice(null);
    const ok = await deleteMyEntry(entry.id);
    setBusy(null);
    if (!ok) {
      setNotice(`Could not delete "${entry.name}".`);
      return;
    }
    setNotice(`Deleted "${entry.name}".`);
    announceGalleryChange({ entryId: entry.id });
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
                    src={galleryPreviewUrl(entry.id, entry.previewRevision)}
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
                    {/* Withdrawing hides an entry and keeps it; deleting is
                        the author saying they are done with it, and returns
                        the day's publish slot. */}
                    <button
                      type="button"
                      className="account-link mine-card-delete"
                      data-testid={`mine-delete-${entry.id}`}
                      disabled={busy === entry.id}
                      onClick={() => void remove(entry)}
                    >
                      Delete
                    </button>
                    {entry.status === "recycled" && !entry.rejectReason ? (
                      <button
                        type="button"
                        className="account-link mine-card-restore"
                        data-testid={`mine-restore-${entry.id}`}
                        disabled={busy === entry.id}
                        onClick={() => void act(entry, "restore")}
                      >
                        Restore
                      </button>
                    ) : entry.status === "public" && confirming === entry.id ? (
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
                    ) : entry.status === "public" ? (
                      <button
                        type="button"
                        className="mine-withdraw"
                        data-testid={`mine-withdraw-${entry.id}`}
                        onClick={() => setConfirming(entry.id)}
                      >
                        Withdraw
                      </button>
                    ) : null}
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
                      You may correct it in the editor. It remains hidden until
                      the Owner restores it.
                    </p>
                  ) : null}
                  {entry.status === "recycled" ? (
                    <p className="mine-reason">
                      {entry.rejectReason
                        ? "Removed after rejection. Only the Owner can restore it."
                        : "Not shown in the Gallery. Restore republishes it."}
                      {` Kept while it is among your ${RECYCLED_KEEP_COUNT} most recent withdrawals.`}
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
              `Restored an earlier version of "${historyFor.name}". Its publication status did not change.`,
            );
            void reload();
          }}
          onClose={() => setHistoryFor(null)}
        />
      ) : null}
    </main>
  );
}
