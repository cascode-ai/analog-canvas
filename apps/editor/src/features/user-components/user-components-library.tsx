import { useEffect, useRef, useState } from "react";
import { fetchSessionUser, type SessionUser } from "../../components/account";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import type {
  ComponentLibraryPage,
  SharedComponent,
} from "./component-library-contract";
import { loadSharedComponents } from "./component-library-client";

const LIBRARY_CACHE_MS = 60_000;

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
  const [entries, setEntries] = useState<SharedComponent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const loadedPage = useRef<{
    query: string;
    deleted: boolean;
    refresh: number;
    retry: number;
    loadedAt: number;
    page: ComponentLibraryPage;
  } | null>(null);
  const failedCursor = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetchSessionUser().then((next) => {
      if (active) setUser(next);
    });
    return () => {
      active = false;
    };
  }, [open, refresh]);
  useEffect(() => {
    if (!open) return;
    generation.current += 1;
    const cached = loadedPage.current;
    const sameList =
      !deleted && cached?.query === query && cached.deleted === deleted;
    setError(null);
    failedCursor.current = null;
    setEntries(sameList ? cached.page.entries : []);
    setCursor(sameList ? cached.page.nextCursor : null);
    if (
      sameList &&
      cached.refresh === refresh &&
      cached.retry === retry &&
      Date.now() - cached.loadedAt < LIBRARY_CACHE_MS
    ) {
      setLoading(false);
      return () => {
        generation.current += 1;
      };
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(
      () => {
        void loadSharedComponents(query, null, deleted, controller.signal)
          .then((page) => {
            if (controller.signal.aborted) return;
            setEntries(page.entries);
            setCursor(page.nextCursor);
            loadedPage.current = {
              query,
              deleted,
              refresh,
              retry,
              loadedAt: Date.now(),
              page,
            };
          })
          .catch((error) => {
            if (!controller.signal.aborted) setError(String(error.message));
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      query ? 150 : 0,
    );
    return () => {
      generation.current += 1;
      clearTimeout(timer);
      controller.abort();
    };
  }, [deleted, open, query, refresh, retry]);
  async function more() {
    const currentGeneration = generation.current;
    setLoading(true);
    setError(null);
    try {
      const page = await loadSharedComponents(query, cursor, deleted);
      if (currentGeneration !== generation.current) return;
      const current = loadedPage.current?.page.entries ?? entries;
      const nextEntries = [
        ...current,
        ...page.entries.filter(
          (next) => !current.some((item) => item.id === next.id),
        ),
      ];
      setEntries(nextEntries);
      if (loadedPage.current) {
        loadedPage.current = {
          ...loadedPage.current,
          loadedAt: Date.now(),
          page: { entries: nextEntries, nextCursor: page.nextCursor },
        };
      }
      setCursor(page.nextCursor);
    } catch (error) {
      if (currentGeneration === generation.current) {
        failedCursor.current = cursor;
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (currentGeneration === generation.current) setLoading(false);
    }
  }
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
            onClose();
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
        <input
          ref={searchRef}
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
            onClick={() => setDeleted((current) => !current)}
          >
            {deleted
              ? "Show available components"
              : "Review deleted components"}
          </button>
        ) : null}
        {error ? (
          <div className="user-components-message" role="status">
            <span>
              {entries.length
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
        <div className="user-components-grid">
          {entries.map((entry) => (
            <article className="user-component-tile" key={entry.id}>
              <button
                type="button"
                className="user-component-place"
                disabled={deleted}
                aria-label={`Place ${entry.definition.symbol.name}`}
                title={`${entry.definition.symbol.name} · ${entry.author}${entry.status === "official" ? " · Official" : ""}`}
                onClick={() => {
                  onClose();
                  onInsert(entry);
                }}
              >
                <span className="user-component-preview">
                  <SymbolArtwork
                    symbol={entry.definition.symbol}
                    className="user-component-art"
                  />
                </span>
                <span className="user-component-caption">
                  <strong title={entry.definition.symbol.name}>
                    {entry.definition.symbol.name}
                  </strong>
                  <small title={entry.author}>
                    {entry.author.trim() || "Unknown author"}
                  </small>
                  {entry.status === "official" ? <small>Official</small> : null}
                  {entry.definition.subcircuit && !entry.circuit ? (
                    <small>Implementation missing</small>
                  ) : null}
                </span>
              </button>
              <div className="user-component-actions">
                {entry.authorId === user?.id && entry.status === "shared" ? (
                  <button
                    type="button"
                    className="user-component-edit"
                    aria-label={`Edit ${entry.definition.symbol.name} definition`}
                    onClick={() => {
                      onClose();
                      onEdit(entry, "update");
                    }}
                  >
                    Edit
                  </button>
                ) : null}
                {!deleted ? (
                  <button
                    type="button"
                    className="user-component-edit"
                    aria-label={`Create from ${entry.definition.symbol.name}`}
                    onClick={() => {
                      onClose();
                      onEdit(entry, "new");
                    }}
                  >
                    Create from…
                  </button>
                ) : null}
                {user?.isAdmin ? (
                  <button
                    type="button"
                    className="user-component-edit"
                    aria-label={`${deleted ? "Review" : "Manage"} ${entry.definition.symbol.name}`}
                    onClick={() => {
                      onClose();
                      onEdit(entry, "update");
                    }}
                  >
                    {deleted ? "Review" : "Manage (admin)"}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
          {!loading && !entries.length && !error ? (
            <p className="user-components-empty">
              {query
                ? "No user components match this search."
                : deleted
                  ? "No deleted components."
                  : "No user components yet."}
            </p>
          ) : null}
        </div>
        <footer className="user-components-footer">
          <button
            type="button"
            disabled={loading}
            onClick={() => setRetry((value) => value + 1)}
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
          {loading ? (
            <small role="status">Loading components…</small>
          ) : (
            <span />
          )}
          {cursor && !loading ? (
            <button type="button" onClick={() => void more()}>
              Load More
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
