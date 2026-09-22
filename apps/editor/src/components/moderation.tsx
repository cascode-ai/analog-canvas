import { useEffect, useRef, useState } from "react";
import { InlineConfirm } from "./inline-confirm";
import "../styles/gallery-entry.css";
import "../styles/moderation.css";

import { announceGalleryChange, galleryPreviewUrl } from "../gallery-client";
import { fetchSessionUser, type SessionUser } from "./account";
import { GalleryChrome } from "./gallery-chrome";
import { Masonry } from "./masonry";
import { TilePreview } from "./tile-preview";

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

function EntryMenu({
  entry,
  kind,
  disabled,
  onAction,
}: {
  entry: ModerationEntry;
  kind: CollectionKind;
  disabled: boolean;
  onAction: (action: EntryAction) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const prefix = kind === "rejected" ? "rejected" : "bin";
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        ref.current?.removeAttribute("open");
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const act = (action: EntryAction) => {
    ref.current?.removeAttribute("open");
    ref.current?.querySelector("summary")?.focus();
    onAction(action);
  };
  return (
    <details
      ref={ref}
      name="moderation-entry-actions"
      className="moderation-entry-menu"
      data-testid={`${prefix}-menu-${entry.id}`}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        const details = ref.current;
        if (!details) return;
        if (event.key === "Escape") {
          details.open = false;
          details.querySelector("summary")?.focus();
          event.preventDefault();
        } else if (
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          details.open = true;
          const buttons = [
            ...details.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ];
          const current = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : current < 0
                  ? event.key === "ArrowUp"
                    ? buttons.length - 1
                    : 0
                  : (current +
                      (event.key === "ArrowUp" ? -1 : 1) +
                      buttons.length) %
                    buttons.length;
          buttons[next]?.focus();
        }
      }}
    >
      <summary
        aria-label={`Actions for ${entry.name}`}
        title={`Actions for ${entry.name}`}
        aria-haspopup="menu"
      >
        ⋯
      </summary>
      <div
        className="moderation-entry-popover"
        data-inline-confirm-menu
        role="menu"
        aria-label={`Actions for ${entry.name}`}
      >
        <button
          type="button"
          role="menuitem"
          disabled={disabled}
          data-testid={`${prefix}-restore-${entry.id}`}
          onClick={() => act("restore")}
        >
          Restore to Gallery
        </button>
        {kind === "recycled" ? (
          <InlineConfirm
            role="menuitem"
            disabled={disabled}
            className="moderation-delete"
            data-testid={`${prefix}-delete-${entry.id}`}
            onConfirm={() => act("delete")}
          >
            Delete forever
          </InlineConfirm>
        ) : (
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            data-testid={`${prefix}-recycle-${entry.id}`}
            onClick={() => act("recycle")}
          >
            Move to recycle bin
          </button>
        )}
      </div>
    </details>
  );
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
    try {
      const response = await fetch(
        action === "delete"
          ? `/api/gallery/${id}`
          : `/api/gallery/${id}/${action}`,
        {
          method: action === "delete" ? "DELETE" : "POST",
          credentials: "same-origin",
        },
      );
      if (!response.ok)
        throw new Error("Could not update this entry. Please try again.");
      setEntries(
        (current) => current?.filter((entry) => entry.id !== id) ?? null,
      );
      announceGalleryChange({ entryId: id });
      onChanged();
    } catch {
      setActionError({
        id,
        message: "Could not update this entry. Please try again.",
      });
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
                <article
                  className="moderation-card"
                  data-testid={`${prefix}-card-${entry.id}`}
                  aria-busy={busy === entry.id}
                >
                  <a
                    className="moderation-card-open"
                    href={`/g/${entry.id}`}
                    data-testid={`${prefix}-open-${entry.id}`}
                    title={`Open ${entry.name}`}
                  >
                    <TilePreview
                      src={galleryPreviewUrl(entry.id, entry.previewRevision)}
                      alt={`Preview of ${entry.name}`}
                      {...(entry.previewWidth === undefined
                        ? {}
                        : { width: entry.previewWidth })}
                      {...(entry.previewHeight === undefined
                        ? {}
                        : { height: entry.previewHeight })}
                    />
                    <h3>{entry.name}</h3>
                  </a>
                  {rejected && entry.rejectReason ? (
                    <p className="moderation-card-reason">
                      {entry.rejectReason}
                    </p>
                  ) : null}
                  <footer className="moderation-card-footer">
                    <span className="moderation-card-date">
                      {date ? (
                        <time
                          dateTime={date}
                          title={new Date(date).toLocaleString()}
                        >
                          {new Date(date).toLocaleDateString()}
                        </time>
                      ) : null}
                    </span>
                    <EntryMenu
                      entry={entry}
                      kind={kind}
                      disabled={busy !== null}
                      onAction={(action) => void act(entry.id, action)}
                    />
                  </footer>
                  {actionError?.id === entry.id ? (
                    <p className="moderation-card-error" role="alert">
                      {actionError.message}
                    </p>
                  ) : null}
                </article>
              ),
            };
          })}
        />
      ) : null}
    </section>
  );
}

export function Moderation() {
  const [state, setState] = useState<ModerationState>({ status: "loading" });
  const [inventoryVersion, setInventoryVersion] = useState(0);
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
        ) : state.user.isAdmin ? (
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
            Withdraw an entry from its page; the owner and the admin can bring
            it back.
          </p>
        )}
      </div>
    </main>
  );
}
