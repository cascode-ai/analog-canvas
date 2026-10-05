import { useCallback, useEffect, useRef, useState } from "react";
import "../styles/gallery-entry.css";

import {
  announceGalleryChange,
  subscribeGalleryRefresh,
} from "../gallery-client";
import { fetchSessionUser } from "./account";
import { EntryCard } from "./entry-card";
import { GalleryChrome } from "./gallery-chrome";
import { Masonry } from "./masonry";
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
  previewWidth?: number;
  previewHeight?: number;
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

/**
 * What a withdrawn entry's card says about how long it stays in the bin. The
 * answer is not a date, so the sentence names the rule that decides it: newer
 * withdrawals are what push an entry out, and nothing else does.
 */
export function recycledRetentionNote(wasRejected: boolean): string {
  const lead = wasRejected
    ? "Removed after rejection. Only the Owner can restore it."
    : "Not shown in the Gallery. Restore republishes it.";
  return `${lead} Kept while it is among your ${RECYCLED_KEEP_COUNT} most recent withdrawals.`;
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

/** The list of the signed-in account's circuits, wherever it is shown. */
export function MySubmissionsContent() {
  const [state, setState] = useState<MineState>({ status: "loading" });
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
    setBusy(entry.id);
    setNotice(null);
    const ok = await deleteMyEntry(entry.id);
    setBusy(null);
    if (!ok) {
      setNotice(`Could not delete "${entry.name}". Try again.`);
      return;
    }
    setNotice(`Deleted "${entry.name}".`);
    announceGalleryChange({ entryId: entry.id });
    await reload();
  }

  return (
    <>
      <div className="mine-content" data-testid="mine-content">
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
            <Masonry
              minColumnWidth={260}
              gap={16}
              aria-label="Your circuits"
              items={state.entries.map((entry) => ({
                key: entry.id,
                node: (
                  <EntryCard
                    entry={entry}
                    status={entry.status}
                    date={entry.createdAt}
                    busy={busy === entry.id}
                    testId={`mine-card-${entry.id}`}
                    statusTestId={`mine-status-${entry.id}`}
                    actions={
                      // One step at a time: a published circuit is withdrawn
                      // first, which hides it and keeps it; only what is off
                      // the wall can be deleted for good, which also returns
                      // the day's publish slot.
                      <>
                        <button
                          type="button"
                          className="entry-action"
                          data-testid={`mine-history-${entry.id}`}
                          onClick={() => setHistoryFor(entry)}
                        >
                          History
                        </button>
                        {entry.status === "public" ? (
                          // Withdrawing is undone by Restore: it asks nothing.
                          <button
                            type="button"
                            className="entry-action"
                            data-testid={`mine-withdraw-${entry.id}`}
                            disabled={busy === entry.id}
                            onClick={() => void act(entry, "recycle")}
                          >
                            Withdraw
                          </button>
                        ) : (
                          <>
                            {entry.status === "recycled" &&
                            !entry.rejectReason ? (
                              <button
                                type="button"
                                className="entry-action"
                                data-testid={`mine-restore-${entry.id}`}
                                disabled={busy === entry.id}
                                onClick={() => void act(entry, "restore")}
                              >
                                Restore
                              </button>
                            ) : null}
                            {/* The click is the decision: no second question. */}
                            <button
                              type="button"
                              className="entry-action entry-action-danger"
                              data-testid={`mine-delete-${entry.id}`}
                              disabled={busy === entry.id}
                              onClick={() => void remove(entry)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </>
                    }
                    notes={
                      <>
                        {entry.status === "rejected" && entry.rejectReason ? (
                          <p
                            className="entry-card-note"
                            data-testid={`mine-reason-${entry.id}`}
                          >
                            Reason: {entry.rejectReason}
                          </p>
                        ) : null}
                        {entry.status === "rejected" ? (
                          <p className="entry-card-note">
                            You may correct it in the editor. It remains hidden
                            until the Owner restores it.
                          </p>
                        ) : null}
                        {entry.status === "recycled" ? (
                          <p className="entry-card-note">
                            {recycledRetentionNote(Boolean(entry.rejectReason))}
                          </p>
                        ) : null}
                      </>
                    }
                  />
                ),
              }))}
            />
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
    </>
  );
}

/** `/mine`, the list on a page of its own. */
export function MySubmissions() {
  return (
    <main className="review-shell" data-testid="mine-page">
      <GalleryChrome subtitle="My submissions" />
      <div className="page-body">
        <MySubmissionsContent />
      </div>
    </main>
  );
}
