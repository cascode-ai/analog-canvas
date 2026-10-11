import { parseSharedComponentEntry } from "./component-library-entry";
import { useEffect, useRef, useState } from "react";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import { fetchSessionUser, type SessionUser } from "../../components/account";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import type {
  ComponentLibrarySummaryPage,
  SharedComponent,
} from "./component-library-contract";
import {
  loadSharedComponentSummaries,
  readSharedComponentRecord,
  ComponentLibraryError,
  checkSharedComponentRevision,
} from "./component-library-client";
import { LibraryCache } from "./library-cache";
import { LibraryPreview } from "./library-preview";

const capabilityLabel = (entry: ComponentLibrarySummary) =>
  entry.capability === "symbol-only"
    ? "Symbol only"
    : entry.capability === "needs-repair"
      ? "Needs repair"
      : null;
export default function UserComponentsLibrary({
  open,
  onClose,
  onCreate,
  onEdit,
  onInsert,
  refresh,
  drafts = [],
  onOpenDraft,
}: {
  open: boolean;
  onClose(): void;
  onCreate(): void;
  onEdit(entry: SharedComponent, intent: "new" | "update"): void;
  onInsert(entry: SharedComponent): void;
  refresh: number;
  drafts?: { id: string; label: string }[];
  onOpenDraft?(id: string): void;
}) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [query, setQuery] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [page, setPage] = useState<ComponentLibrarySummaryPage>({
    entries: [],
    nextCursor: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [detail, setDetail] = useState<{
    summary: ComponentLibrarySummary;
    entry: SharedComponent;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);
  const details = useRef(
    new LibraryCache<SharedComponent>(30, 2 * 1024 * 1024),
  );
  const cache = useRef(
    new LibraryCache<{ page: ComponentLibrarySummaryPage; scroll: number }>(
      8,
      1024 * 1024,
    ),
  );
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const selection = useRef<AbortController | null>(null);
  const failedCursor = useRef<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const scroll = useRef(0);
  const listIdentity = useRef("");
  const key = JSON.stringify([refresh, retry, query.trim().toLowerCase()]);
  useEffect(() => {
    if (open && detail) {
      // Do not retain old details while their current access and revision are checked.
      const summary = detail.summary;
      setDetail(null);
      void choose(summary, "details");
    }
  }, [open, refresh]);
  useEffect(() => {
    cache.current.clear();
    details.current.clear();
  }, [refresh, retry, user?.id]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const frame = requestAnimationFrame(() => search.current?.focus());
    void fetchSessionUser().then((next) => {
      if (active) setUser(next);
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      selection.current?.abort();
    };
  }, [open, refresh]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    request.current = controller;
    generation.current += 1;
    failedCursor.current = null;
    setError(null);
    setNotice(null);
    setBusy(false);
    const cached = !deleted ? cache.current.get(key) : undefined;
    const identity = JSON.stringify([query.trim().toLowerCase(), deleted]);
    if (cached) setPage(cached.page);
    else if (deleted || identity !== listIdentity.current)
      setPage({ entries: [], nextCursor: null });
    listIdentity.current = identity;
    scroll.current = cached?.scroll ?? 0;
    setLoading(!cached);
    if (cached)
      requestAnimationFrame(() => {
        if (grid.current) grid.current.scrollTop = scroll.current;
      });
    const timer = setTimeout(
      () => {
        if (cached) return;
        void loadSharedComponentSummaries(
          query.trim(),
          null,
          deleted,
          controller.signal,
        )
          .then((next) => {
            if (controller.signal.aborted) return;
            setPage(next);
            if (!deleted) cache.current.set(key, { page: next, scroll: 0 });
          })
          .catch((error: unknown) => {
            if (!controller.signal.aborted)
              setError(error instanceof Error ? error.message : String(error));
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      query ? 150 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
      selection.current?.abort();
      generation.current += 1;
    };
  }, [open, key, deleted]);
  async function more() {
    const current = generation.current;
    setLoading(true);
    setError(null);
    try {
      const next = await loadSharedComponentSummaries(
        query.trim(),
        page.nextCursor,
        deleted,
        request.current?.signal,
      );
      if (current !== generation.current) return;
      const merged = {
        entries: [
          ...page.entries,
          ...next.entries.filter(
            (entry) => !page.entries.some((item) => item.id === entry.id),
          ),
        ],
        nextCursor: next.nextCursor,
      };
      setPage(merged);
      if (!deleted)
        cache.current.set(key, { page: merged, scroll: scroll.current });
      failedCursor.current = null;
    } catch (error) {
      if (current === generation.current) {
        failedCursor.current = page.nextCursor;
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  async function choose(
    summary: ComponentLibrarySummary,
    action: "details" | "place" | "new" | "update" | "raw",
  ) {
    selection.current?.abort();
    const controller = new AbortController();
    selection.current = controller;
    setBusy(true);
    setNotice(null);
    try {
      const detailKey = `${summary.id}:${summary.revision}`;
      const cached =
        action === "details" && !deleted
          ? details.current.get(detailKey)
          : undefined;
      if (cached) {
        await checkSharedComponentRevision(summary, controller.signal);
        if (controller.signal.aborted) return;
        setDetail({ summary, entry: cached });
        return;
      }
      const record = await readSharedComponentRecord(
        summary,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (action === "raw") {
        await navigator.clipboard.writeText(JSON.stringify(record, null, 2));
        setNotice(
          "Copied raw record. Repair the source before creating a component.",
        );
        return;
      }
      const entry = parseSharedComponentEntry(record);
      if (!deleted) details.current.set(detailKey, entry);
      if (action === "details") setDetail({ summary, entry });
      else {
        onClose();
        if (action === "place") onInsert(entry);
        else onEdit(entry, action);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice(error instanceof Error ? error.message : String(error));
        setDetail(null);
        if (error instanceof ComponentLibraryError && error.status === 409) {
          cache.current.clear();
          details.current.clear();
          setDetail(null);
          // Refresh only this immutable selection; never silently place a newer revision.
          const updated = await loadSharedComponentSummaries(
            query.trim(),
            null,
            deleted,
            controller.signal,
          ).catch(() => null);
          if (updated && !controller.signal.aborted) setPage(updated);
        }
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const back = () => {
    setDetail(null);
    requestAnimationFrame(() => {
      if (grid.current) grid.current.scrollTop = scroll.current;
    });
  };
  const rejected = page.entries.filter(
    (entry) => entry.capability === "needs-repair",
  );
  if (!open) return null;
  return (
    <div
      className="insert-dialog-backdrop"
      data-testid="user-components-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="user-components-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-components-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (detail) back();
            else onClose();
          }
        }}
      >
        <header className="user-components-header">
          <div>
            <p>Component Library</p>
            <h2 id="user-components-title">User Components</h2>
          </div>
          <div className="user-components-actions">
            <button
              type="button"
              onClick={() => {
                onClose();
                onCreate();
              }}
            >
              Create Component…
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        {notice ? (
          <p role="status" className="component-definition-note">
            {notice}
          </p>
        ) : null}
        {detail ? (
          <section className="user-component-detail">
            <div className="user-components-actions">
              <button type="button" onClick={back}>
                Back to components
              </button>
              <button
                type="button"
                disabled={busy || deleted}
                onClick={() => void choose(detail.summary, "place")}
              >
                Place
              </button>
            </div>
            <h3>{detail.summary.name}</h3>
            <p className="component-definition-note">
              {detail.summary.author} ·{" "}
              {capabilityLabel(detail.summary) ?? detail.summary.capability} ·{" "}
              {detail.summary.pinCount} pins · {detail.summary.parameterCount}{" "}
              parameters
            </p>
            <div className="user-component-detail-preview">
              <SymbolArtwork
                symbol={detail.entry.definition.symbol}
                fitContent
                onPreviewWarning={setPreviewWarning}
                className="user-component-art"
              />
            </div>
            {previewWarning ? (
              <p className="component-definition-note" role="status">
                {previewWarning}
              </p>
            ) : null}
            <p className="component-definition-note">
              {detail.entry.circuit?.externalDefinition.terminals
                .map((pin) => pin.name)
                .join(" · ") ??
                detail.entry.definition.symbol.pins
                  .map((pin) => pin.name)
                  .join(" · ")}
            </p>
            <details>
              <summary>Definition</summary>
              <pre>
                {JSON.stringify(
                  {
                    definition: detail.entry.definition,
                    ...(detail.entry.circuit
                      ? { circuit: detail.entry.circuit }
                      : {}),
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </section>
        ) : (
          <>
            <input
              ref={search}
              aria-label="Search User Defined components"
              autoComplete="off"
              className="user-components-search"
              placeholder="Find a component…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {user?.isAdmin ? (
              <button
                type="button"
                className="user-components-deleted-toggle"
                aria-pressed={deleted}
                onClick={() => setDeleted((value) => !value)}
              >
                {deleted
                  ? "Show available components"
                  : "Review deleted components"}
              </button>
            ) : null}
            {error ? (
              <div className="user-components-message" role="status">
                <span>
                  {page.entries.length
                    ? "Couldn’t refresh components. Loaded components are still available."
                    : "Couldn’t load user components."}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (failedCursor.current) void more();
                    else setRetry((value) => value + 1);
                  }}
                >
                  Try Again
                </button>
              </div>
            ) : null}
            {rejected.length ? (
              <p className="component-definition-note" role="status">
                {rejected.length}{" "}
                {rejected.length === 1 ? "component needs" : "components need"}{" "}
                repair.
              </p>
            ) : null}
            <div
              className="user-components-grid"
              ref={grid}
              onScroll={(event) => {
                scroll.current = event.currentTarget.scrollTop;
                if (!deleted) {
                  const cached = cache.current.get(key);
                  if (cached) cached.scroll = scroll.current;
                }
              }}
            >
              {page.entries.map((entry) => (
                <article
                  className="user-component-tile"
                  key={entry.id + ":" + entry.revision}
                  data-testid={
                    entry.capability === "needs-repair"
                      ? "rejected-user-component"
                      : undefined
                  }
                >
                  {entry.capability === "needs-repair" ? (
                    <div className="user-component-caption">
                      <strong title={entry.name}>{entry.name}</strong>
                      <small>{entry.author}</small>
                      <small>Needs repair</small>
                      <small title={entry.diagnostic}>{entry.diagnostic}</small>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="user-component-place"
                      disabled={deleted || busy}
                      aria-label={"Place " + entry.name}
                      title={entry.name + " · " + entry.author}
                      onClick={() => void choose(entry, "place")}
                    >
                      <LibraryPreview entry={entry} />
                      <span className="user-component-caption">
                        <strong title={entry.name}>{entry.name}</strong>
                        <small title={entry.author}>
                          {entry.author.trim() || "Unknown author"}
                        </small>
                        {entry.status === "official" ? (
                          <small>Official</small>
                        ) : null}
                        {capabilityLabel(entry) ? (
                          <small>{capabilityLabel(entry)}</small>
                        ) : null}
                      </span>
                    </button>
                  )}
                  <div className="user-component-actions">
                    {entry.capability === "needs-repair" ? (
                      <button
                        type="button"
                        className="user-component-edit"
                        aria-label={"Copy raw record for " + entry.name}
                        disabled={busy}
                        onClick={() => void choose(entry, "raw")}
                      >
                        Copy raw record
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="user-component-edit"
                          aria-label={"Details for " + entry.name}
                          disabled={busy}
                          onClick={() => void choose(entry, "details")}
                        >
                          Details
                        </button>
                        <details className="user-component-menu">
                          <summary aria-label={"Actions for " + entry.name}>
                            •••
                          </summary>
                          <div>
                            {entry.authorId === user?.id &&
                            entry.status === "shared" ? (
                              <button
                                type="button"
                                className="user-component-edit"
                                aria-label={
                                  "Edit " + entry.name + " definition"
                                }
                                disabled={busy}
                                onClick={() => void choose(entry, "update")}
                              >
                                Edit
                              </button>
                            ) : null}
                            {!deleted ? (
                              <button
                                type="button"
                                className="user-component-edit"
                                aria-label={"Create from " + entry.name}
                                disabled={busy}
                                onClick={() => void choose(entry, "new")}
                              >
                                Create from…
                              </button>
                            ) : null}
                            {user?.isAdmin ? (
                              <button
                                type="button"
                                className="user-component-edit"
                                aria-label={
                                  (deleted ? "Review " : "Manage ") + entry.name
                                }
                                disabled={busy}
                                onClick={() => void choose(entry, "update")}
                              >
                                {deleted ? "Review" : "Manage (admin)"}
                              </button>
                            ) : null}
                          </div>
                        </details>
                      </>
                    )}
                  </div>
                </article>
              ))}
              {!loading && !page.entries.length && !error ? (
                <p className="user-components-empty">
                  {query
                    ? "No user components match this search."
                    : deleted
                      ? "No deleted components."
                      : "No user components yet."}
                </p>
              ) : null}
            </div>
          </>
        )}
        <footer className="user-components-footer">
          <button
            type="button"
            disabled={loading || busy}
            onClick={() => {
              setDetail(null);
              setRetry((value) => value + 1);
            }}
          >
            Refresh
          </button>
          {drafts.length ? (
            <details>
              <summary>Project drafts ({drafts.length})</summary>
              {drafts.map((draft) => (
                <button
                  type="button"
                  key={draft.id}
                  onClick={() => {
                    onClose();
                    onOpenDraft?.(draft.id);
                  }}
                >
                  {draft.label}
                </button>
              ))}
            </details>
          ) : null}
          {loading || busy ? (
            <small role="status">
              {busy ? "Reading component…" : "Loading components…"}
            </small>
          ) : (
            <span />
          )}
          {page.nextCursor && !loading && !detail ? (
            <button type="button" onClick={() => void more()}>
              Load More
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
