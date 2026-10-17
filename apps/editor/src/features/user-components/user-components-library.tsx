import { parseSharedComponentEntry } from "./component-library-entry";
import { useEffect, useRef, useState } from "react";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import { readSessionUser, type SessionUser } from "../../components/account";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import type {
  ComponentLibrarySummaryPage,
  SharedComponent,
} from "./component-library-contract";
import {
  readSharedComponentRecord,
  ComponentLibraryError,
  checkSharedComponentRevision,
  changeComponentLifecycle,
} from "./component-library-client";
import { LibraryCache } from "./library-cache";
import { ComponentLibraryCard } from "./component-library-card";
import { ComponentDraftList } from "./component-draft-list";
import type {
  ComponentDraftCatalog,
  ComponentDraftTarget,
} from "@icm/edit-engine";
import { loadComponentCatalog as loadCatalog } from "./component-catalog-loading";
import { ComponentCatalogControls } from "./component-catalog-controls";
import type { ComponentCatalogQuery } from "./component-library-contract";

const capabilityLabel = (entry: ComponentLibrarySummary) =>
  entry.capability === "symbol-only"
    ? "Symbol only"
    : entry.capability === "needs-repair"
      ? "Needs repair"
      : "With circuit";

export default function UserComponentsLibrary({
  open,
  onClose,
  onCreate,
  onEdit,
  onInsert,
  refresh,
  drafts,
  onDeleteDrafts,
  previewDraftDeletion,
  onOpenDraft,
}: {
  open: boolean;
  onClose(): void;
  onCreate(): void;
  onEdit(
    entry: SharedComponent,
    intent: "new" | "update",
  ): void | Promise<void>;
  onInsert(entry: SharedComponent): void | Promise<void>;
  refresh: number;
  drafts?: ComponentDraftCatalog;
  onOpenDraft?(target: ComponentDraftTarget): void;
  onDeleteDrafts?(targets: ComponentDraftTarget[]): string | null;
  previewDraftDeletion?(targets: ComponentDraftTarget[]): number;
}) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const accountIdentity = useRef<string | null>(null);
  accountIdentity.current = user?.id ?? null;
  const [authReady, setAuthReady] = useState(false);
  const [queries, setQueries] = useState({ library: "", shelf: "" });
  const [view, setView] = useState<
    "library" | "published" | "drafts" | "deleted"
  >("library");
  const deleted = view === "deleted";
  const shelf = view !== "library";
  const [page, setPage] = useState<ComponentLibrarySummaryPage>({
    entries: [],
    nextCursor: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    text: string;
    transient: boolean;
  } | null>(null);
  function showNotice(text: string | null, transient = false) {
    setNotice(text === null ? null : { text, transient });
  }
  const [restorable, setRestorable] = useState<
    Awaited<ReturnType<typeof changeComponentLifecycle>>["entry"] | null
  >(null);
  const [attempt, setAttempt] = useState(0);
  const [catalogs, setCatalogs] = useState<
    Record<"library" | "shelf", ComponentCatalogQuery>
  >({
    library: { version: 1, type: "all", order: "circuit-first" },
    shelf: { version: 1, type: "all", order: "circuit-first" },
  });
  const scope = shelf ? "shelf" : "library";
  const query = queries[scope];
  const catalog = catalogs[scope];
  const setQuery = (value: string) =>
    setQueries((current) => ({ ...current, [scope]: value }));
  const setCatalog = (value: ComponentCatalogQuery) =>
    setCatalogs((current) => ({ ...current, [scope]: value }));
  const catalogQuery =
    view === "published" && user ? { ...catalog, authorId: user.id } : catalog;
  function switchView(next: typeof view) {
    selection.current?.abort();
    setBusy(false);
    setDetail(null);
    setView(next);
  }
  useEffect(() => {
    if (!notice?.transient) return;
    const timer = setTimeout(() => {
      showNotice(null);
      setRestorable(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [notice, restorable]);
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
      Infinity,
    ),
  );
  const retained = useRef<{
    key: string;
    value: { page: ComponentLibrarySummaryPage; scroll: number };
  } | null>(null);
  const request = useRef<AbortController | null>(null);
  const bufferedRefresh = useRef<{
    key: string;
    page: ComponentLibrarySummaryPage;
  } | null>(null);
  const selection = useRef<AbortController | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const scroll = useRef(0);
  const listIdentity = useRef("");
  const key = JSON.stringify([
    user?.id ?? null,
    query.trim().toLowerCase(),
    catalogQuery,
  ]);
  function catalogProgress(signal: AbortSignal) {
    const identity = JSON.stringify([key, deleted]);
    return {
      resume:
        bufferedRefresh.current?.key === identity
          ? bufferedRefresh.current.page
          : undefined,
      retain(next: ComponentLibrarySummaryPage | undefined) {
        if (signal.aborted) return;
        if (next) bufferedRefresh.current = { key: identity, page: next };
        else if (bufferedRefresh.current?.key === identity)
          bufferedRefresh.current = null;
      },
    };
  }
  function showPage(next: ComponentLibrarySummaryPage) {
    setPage(next);
    if (!deleted) {
      const value = { page: next, scroll: scroll.current };
      retained.current = { key, value };
      cache.current.set(key, value);
    }
  }
  useEffect(() => {
    if (open && detail) {
      // Do not retain old details while their current access and revision are checked.
      const summary = detail.summary;
      setDetail(null);
      void choose(summary, "details");
    }
  }, [open, refresh]);
  useEffect(() => {
    details.current.clear();
  }, [refresh]);
  useEffect(() => {
    cache.current.clear();
    details.current.clear();
    selection.current?.abort();
    setDetail(null);
    retained.current = null;
    bufferedRefresh.current = null;
    setRestorable(null);
    showNotice(null);
  }, [user?.id]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const refreshVisible = () => {
      if (document.visibilityState !== "visible") return;
      void readSessionUser(fetch, true).then((result) => {
        if (!active) return;
        if (result.available) {
          setUser(result.user);
          if (!result.user)
            setView((current) =>
              current === "published" || current === "deleted"
                ? "library"
                : current,
            );
        }
        if (!request.current) setAttempt((value) => value + 1);
      });
    };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const frame = requestAnimationFrame(() => search.current?.focus());
    void readSessionUser(fetch, true).then((result) => {
      if (active) {
        if (result.available) {
          setUser(result.user);
          if (!result.user)
            setView((current) =>
              current === "published" || current === "deleted"
                ? "library"
                : current,
            );
        }
        setAuthReady(true);
      }
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      selection.current?.abort();
    };
  }, [open, refresh]);
  useEffect(() => {
    if (!open || !authReady || view === "drafts") return;
    const controller = new AbortController();
    request.current = controller;
    setError(null);
    setBusy(false);
    const cached = !deleted
      ? (cache.current.get(key) ??
        (retained.current?.key === key ? retained.current.value : undefined))
      : undefined;
    const identity = JSON.stringify([
      query.trim().toLowerCase(),
      deleted,
      catalogQuery,
      user?.id ?? null,
    ]);
    if (cached) setPage(cached.page);
    else if (deleted || identity !== listIdentity.current)
      setPage({ entries: [], nextCursor: null });
    listIdentity.current = identity;
    scroll.current = cached?.scroll ?? 0;
    setLoading(!cached || !!cached.page.nextCursor);
    if (cached)
      requestAnimationFrame(() => {
        if (grid.current) grid.current.scrollTop = scroll.current;
      });
    const timer = setTimeout(
      () => {
        void loadCatalog(
          query.trim(),
          deleted,
          catalogQuery,
          controller.signal,
          showPage,
          cached?.page,
          catalogProgress(controller.signal),
        )
          .catch((error: unknown) => {
            if (!controller.signal.aborted)
              setError(error instanceof Error ? error.message : String(error));
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
            if (request.current === controller) request.current = null;
          });
      },
      query ? 150 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (request.current === controller) request.current = null;
      selection.current?.abort();
    };
  }, [open, key, view, attempt, authReady, refresh]);
  async function choose(
    summary: ComponentLibrarySummary,
    action: "details" | "place" | "new" | "update" | "raw",
  ) {
    selection.current?.abort();
    const controller = new AbortController();
    selection.current = controller;
    setBusy(true);
    showNotice(null);
    setRestorable(null);
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
        showNotice(
          "Copied raw record. Repair the source before creating a component.",
        );
        return;
      }
      const entry = parseSharedComponentEntry(record);
      if (!deleted) details.current.set(detailKey, entry);
      if (action === "details") setDetail({ summary, entry });
      else {
        onClose();
        if (action === "place") await onInsert(entry);
        else await onEdit(entry, action);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        showNotice(error instanceof Error ? error.message : String(error));
        setDetail(null);
        if (error instanceof ComponentLibraryError && error.status === 409) {
          request.current?.abort();
          setLoading(false);
          details.current.clear();
          setDetail(null);
          // Refresh only this immutable selection; never silently place a newer revision.
          await loadCatalog(
            query.trim(),
            deleted,
            catalogQuery,
            controller.signal,
            showPage,
            page,
            catalogProgress(controller.signal),
          ).catch((error: unknown) => {
            if (!controller.signal.aborted)
              setError(error instanceof Error ? error.message : String(error));
          });
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
          <div
            className="component-library-tabs"
            role="tablist"
            aria-label="Component library views"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!shelf}
              onClick={() => switchView("library")}
            >
              Library
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={shelf}
              onClick={() => switchView(user ? "published" : "drafts")}
            >
              My shelf
            </button>
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
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close"
            >
              ×
            </button>
          </div>
        </header>
        {shelf ? (
          <div
            className="component-library-tabs component-shelf-tabs"
            role="tablist"
            aria-label="My shelf"
          >
            {user ? (
              <button
                type="button"
                role="tab"
                aria-selected={view === "published"}
                onClick={() => switchView("published")}
              >
                Published
              </button>
            ) : null}
            <button
              type="button"
              role="tab"
              aria-selected={view === "drafts"}
              onClick={() => switchView("drafts")}
            >
              Project drafts
            </button>
            {user ? (
              <button
                type="button"
                role="tab"
                aria-selected={deleted}
                onClick={() => switchView("deleted")}
              >
                {user.isAdmin ? "Deleted (all)" : "Deleted"}
              </button>
            ) : null}
          </div>
        ) : null}
        {notice ? (
          <div role="status" className="component-library-feedback">
            <span>{notice.text}</span>
            <button
              type="button"
              aria-label="Dismiss message"
              title="Dismiss"
              onClick={() => {
                showNotice(null);
                setRestorable(null);
              }}
            >
              ×
            </button>
            {restorable ? (
              <button
                type="button"
                onClick={() => {
                  void changeComponentLifecycle(restorable, "restore")
                    .then(() => {
                      cache.current.clear();
                      retained.current = null;
                      setRestorable(null);
                      showNotice("Restored to library.", true);
                      setAttempt((value) => value + 1);
                    })
                    .catch((e) => showNotice(String(e)));
                }}
              >
                Restore
              </button>
            ) : null}
          </div>
        ) : null}
        {view === "drafts" ? (
          <section
            className="component-shelf-drafts"
            aria-label="Project drafts"
          >
            {drafts ? (
              <ComponentDraftList
                expanded
                catalog={drafts}
                onOpen={(target) => {
                  onClose();
                  onOpenDraft?.(target);
                }}
                onDelete={onDeleteDrafts}
                previewDeletion={previewDraftDeletion}
              />
            ) : (
              <p>No project drafts.</p>
            )}
          </section>
        ) : detail ? (
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
            <div className="component-catalog-controls">
              <input
                ref={search}
                aria-label="Search User Defined components"
                autoComplete="off"
                className="user-components-search"
                placeholder="Find a component…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <ComponentCatalogControls
                value={catalog}
                authors={page.authors}
                hideAuthors={view === "published"}
                onChange={setCatalog}
              />
              {query || catalog.type !== "all" || catalog.authorId ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setCatalog({
                      version: 1,
                      type: "all",
                      order: catalog.order,
                    });
                  }}
                >
                  Clear filters
                </button>
              ) : null}
            </div>
            {error ? (
              <div className="user-components-message" role="status">
                <span>
                  {page.entries.length
                    ? "Couldn’t refresh components. Loaded components are still available."
                    : "Couldn’t load user components."}
                </span>
                <button
                  type="button"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  Try Again
                </button>
              </div>
            ) : null}
            <div
              className="user-components-grid"
              ref={grid}
              onScroll={(event) => {
                scroll.current = event.currentTarget.scrollTop;
                if (!deleted) {
                  if (retained.current?.key === key)
                    retained.current.value.scroll = scroll.current;
                  const cached = cache.current.get(key);
                  if (cached) cached.scroll = scroll.current;
                }
              }}
            >
              {page.entries.map((entry) => (
                <ComponentLibraryCard
                  key={entry.id + ":" + entry.revision}
                  entry={entry}
                  user={user}
                  busy={busy}
                  choose={(action) => void choose(entry, action)}
                  filter={() => {
                    switchView("library");
                    setCatalogs((current) => ({
                      ...current,
                      library: { ...current.library, authorId: entry.authorId },
                    }));
                  }}
                  manage={async (action) => {
                    const account = accountIdentity.current;
                    const result = await changeComponentLifecycle(
                      entry,
                      action,
                    );
                    if (accountIdentity.current !== account) return;
                    request.current?.abort();
                    details.current.clear();
                    cache.current.clear();
                    retained.current = null;
                    bufferedRefresh.current = null;
                    setPage((current) => ({
                      ...current,
                      entries: current.entries.filter((e) => e.id !== entry.id),
                    }));
                    showNotice(
                      action === "delete"
                        ? "Removed from library."
                        : "Restored to library.",
                      true,
                    );
                    setRestorable(action === "delete" ? result.entry : null);
                    setAttempt((value) => value + 1);
                  }}
                />
              ))}
              {!loading && !page.entries.length && !error ? (
                <p className="user-components-empty">
                  {query
                    ? "No user components match this search."
                    : catalog.type !== "all" || catalog.authorId
                      ? "No components match these filters."
                      : deleted
                        ? "No deleted components."
                        : "No user components yet."}
                </p>
              ) : null}
            </div>
          </>
        )}
        {(loading || busy) && view !== "drafts" ? (
          <footer className="user-components-footer">
            <small role="status">
              {busy ? "Reading component…" : "Loading components…"}
            </small>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
