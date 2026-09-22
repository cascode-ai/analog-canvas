import { useEffect, useRef, useState } from "react";
import { fetchSessionUser, type SessionUser } from "../../components/account";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import type { SharedComponent } from "./component-library-contract";
import { loadSharedComponents } from "./component-library-client";

export default function UserComponentsLibrary({
  open,
  onClose,
  onCreate,
  onEdit,
  onInsert,
  refresh,
}: {
  open: boolean;
  onClose(): void;
  onCreate(): void;
  onEdit(entry: SharedComponent): void;
  onInsert(entry: SharedComponent): void;
  refresh: number;
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
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setEntries([]);
    setCursor(null);
    const timer = setTimeout(() => {
      void loadSharedComponents(query, null, deleted, controller.signal)
        .then((page) => {
          if (controller.signal.aborted) return;
          setEntries(page.entries);
          setCursor(page.nextCursor);
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(String(error.message));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 150);
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
      setEntries((current) => [
        ...current,
        ...page.entries.filter(
          (next) => !current.some((item) => item.id === next.id),
        ),
      ]);
      setCursor(page.nextCursor);
    } catch (error) {
      if (currentGeneration === generation.current)
        setError(error instanceof Error ? error.message : String(error));
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
            <span>Couldn’t load user components.</span>
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
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
                <SymbolArtwork
                  symbol={entry.definition.symbol}
                  className="user-component-art"
                />
                <strong>{entry.definition.symbol.name}</strong>
                <small>
                  {entry.status === "official" ? "Official · " : ""}
                  {entry.author}
                </small>
              </button>
              <button
                type="button"
                className="user-component-edit"
                aria-label={`Edit ${entry.definition.symbol.name} definition`}
                onClick={() => {
                  onClose();
                  onEdit(entry);
                }}
              >
                {deleted ? "Review" : "Edit"}
              </button>
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
