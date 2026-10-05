import { useEffect, useState } from "react";
import "../styles/gallery-entry.css";
import "../styles/moderation.css";

import { announceGalleryChange } from "../gallery-client";
import { fetchSessionUser, type SessionUser } from "./account";
import { EntryCard } from "./entry-card";
import { GalleryChrome } from "./gallery-chrome";
import { Masonry } from "./masonry";

/** Post-publication curation. Operational maintenance belongs in scripts. */
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

type CollectionKind = "rejected" | "recycled";
type EntryAction = "restore" | "recycle" | "delete";
interface ModerationEntry {
  id: string;
  name: string;
  previewRevision?: string;
  previewWidth?: number;
  previewHeight?: number;
  recycledAt?: string | null;
  rejectReason?: string | null;
  reviewedAt?: string | null;
}

function ModerationCollection({
  kind,
  refreshVersion,
  onChanged,
}: {
  kind: CollectionKind;
  refreshVersion: number;
  onChanged: () => void;
}) {
  const [entries, setEntries] = useState<ModerationEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const rejected = kind === "rejected";
  const prefix = rejected ? "rejected" : "bin";

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    void (async () => {
      try {
        const response = await fetch(`/api/gallery/${kind}`, {
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("Could not load entries");
        const payload = (await response.json()) as {
          entries: ModerationEntry[];
        };
        if (!cancelled) setEntries(payload.entries);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, refreshVersion, retry]);

  async function act(id: string, action: EntryAction) {
    if (busy) return;
    setBusy(id);
    setActionError(null);
    setNotice(null);
    const call = (path: string, method: "POST" | "DELETE") =>
      fetch(path, { method, credentials: "same-origin" });
    const gone = () => {
      setEntries(
        (current) => current?.filter((entry) => entry.id !== id) ?? null,
      );
      announceGalleryChange({ entryId: id });
      onChanged();
    };
    let binned = false;
    try {
      // Only what is in the bin can be deleted, so a rejected circuit goes
      // there first: one click either way.
      if (action === "delete" && rejected) {
        if (!(await call(`/api/gallery/${id}/recycle`, "POST")).ok)
          throw new Error("Could not move this entry to the bin.");
        binned = true;
      }
      const response = await call(
        action === "delete"
          ? `/api/gallery/${id}`
          : `/api/gallery/${id}/${action}`,
        action === "delete" ? "DELETE" : "POST",
      );
      if (!response.ok)
        throw new Error("Could not update this entry. Please try again.");
      gone();
    } catch {
      if (binned) {
        gone();
        setNotice(
          "Moved to the recycle bin, but deleting it failed. Delete it from the bin.",
        );
      } else {
        setActionError({
          id,
          message: "Could not update this entry. Please try again.",
        });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className="moderation-collection"
      data-testid={rejected ? "rejected-list" : "review-bin"}
      aria-labelledby={`${prefix}-heading`}
    >
      <header className="moderation-collection-heading">
        <h2 id={`${prefix}-heading`}>
          {rejected ? "Rejected entries" : "Recycle bin"}
        </h2>
        {entries ? (
          <span className="moderation-count">{entries.length}</span>
        ) : null}
      </header>
      {notice ? (
        <p className="moderation-load-error" role="alert">
          {notice}
        </p>
      ) : null}
      {loadError ? (
        <p className="moderation-load-error" role="alert">
          Could not load {rejected ? "rejected entries" : "the recycle bin"}.{" "}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </p>
      ) : null}
      {entries === null && !loadError ? (
        <p className="gallery-status" role="status">
          Loading…
        </p>
      ) : null}
      {entries?.length === 0 && !loadError ? (
        <p className="gallery-status" data-testid={`${prefix}-empty`}>
          {rejected ? "No rejected entries." : "The bin is empty."}
        </p>
      ) : null}
      {entries?.length ? (
        <Masonry
          minColumnWidth={260}
          gap={18}
          aria-label={rejected ? "Rejected circuits" : "Recycled circuits"}
          items={entries.map((entry) => {
            const date = rejected ? entry.reviewedAt : entry.recycledAt;
            return {
              key: entry.id,
              node: (
                <EntryCard
                  entry={entry}
                  status={rejected ? "rejected" : "recycled"}
                  date={date}
                  busy={busy === entry.id}
                  testId={`${prefix}-card-${entry.id}`}
                  openTestId={`${prefix}-open-${entry.id}`}
                  actions={
                    // Every action at hand, one click each, without a menu or
                    // a second question: restoring and recycling undo each
                    // other, and deleting is the Owner's own call.
                    <>
                      <button
                        type="button"
                        className="entry-action"
                        disabled={busy !== null}
                        data-testid={`${prefix}-restore-${entry.id}`}
                        onClick={() => void act(entry.id, "restore")}
                      >
                        Restore
                      </button>
                      {rejected ? (
                        <button
                          type="button"
                          className="entry-action"
                          disabled={busy !== null}
                          data-testid={`${prefix}-recycle-${entry.id}`}
                          onClick={() => void act(entry.id, "recycle")}
                        >
                          Recycle
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="entry-action entry-action-danger"
                        disabled={busy !== null}
                        data-testid={`${prefix}-delete-${entry.id}`}
                        onClick={() => void act(entry.id, "delete")}
                      >
                        Delete
                      </button>
                    </>
                  }
                  notes={
                    <>
                      {rejected && entry.rejectReason ? (
                        <p className="entry-card-note">
                          Reason: {entry.rejectReason}
                        </p>
                      ) : null}
                      {actionError?.id === entry.id ? (
                        <p
                          className="entry-card-note entry-card-error"
                          role="alert"
                        >
                          {actionError.message}
                        </p>
                      ) : null}
                    </>
                  }
                />
              ),
            };
          })}
        />
      ) : null}
    </section>
  );
}

/** What the gallery owner reviews, or a moderator's note, wherever shown. */
export function ModerationContent({ isAdmin }: { isAdmin: boolean }) {
  const [inventoryVersion, setInventoryVersion] = useState(0);
  return isAdmin ? (
    <>
      <ModerationCollection
        kind="rejected"
        refreshVersion={inventoryVersion}
        onChanged={() => setInventoryVersion((version) => version + 1)}
      />
      <ModerationCollection
        kind="recycled"
        refreshVersion={inventoryVersion}
        onChanged={() => setInventoryVersion((version) => version + 1)}
      />
    </>
  ) : (
    <p className="gallery-status">
      As a moderator you can edit any circuit from its page and restore its
      earlier versions. Rejecting and withdrawing stay with the Owner.
    </p>
  );
}

export function Moderation() {
  const [state, setState] = useState<ModerationState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    void loadModerationAccess().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <main
      className="review-shell"
      data-testid={
        state.status === "ready"
          ? "moderation"
          : state.status === "denied"
            ? "review-denied"
            : "review-page"
      }
    >
      <GalleryChrome subtitle="Moderation" />
      <div className="page-body moderation-body">
        {state.status !== "ready" ? (
          <p className="gallery-status">
            {state.status === "loading"
              ? "Loading moderation…"
              : "Moderation is for the gallery owner and appointed moderators."}
          </p>
        ) : (
          <ModerationContent isAdmin={state.user.isAdmin} />
        )}
      </div>
    </main>
  );
}
