import { useEffect, useRef, useState } from "react";
import { fetchSessionUser, type SessionUser } from "../../components/account";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import type { SharedComponent } from "./component-library-contract";
import { loadSharedComponents } from "./component-library-client";

export default function UserComponentsLibrary({
  onCreate,
  onEdit,
  onInsert,
  refresh,
}: {
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
  useEffect(() => {
    let active = true;
    void fetchSessionUser().then((next) => {
      if (active) setUser(next);
    });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
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
  }, [query, deleted, refresh, retry]);
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
  return (
    <details
      className="shapes-category user-components-library"
      open
      data-testid="shapes-category-user-defined"
    >
      <summary className="shapes-category-header">
        <span>User Defined</span>
      </summary>
      <div className="user-components-tools">
        <button type="button" onClick={onCreate}>
          + Create component
        </button>
        <input
          aria-label="Search User Defined components"
          placeholder="Search components"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {user?.isAdmin ? (
          <label>
            <input
              type="checkbox"
              checked={deleted}
              onChange={(event) => setDeleted(event.target.checked)}
            />{" "}
            Deleted
          </label>
        ) : null}
      </div>
      {error ? (
        <p role="status">
          {error}{" "}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </p>
      ) : null}
      <div className="shapes-grid">
        {entries.map((entry) => (
          <div className="user-component-tile" key={entry.id}>
            <button
              type="button"
              className="shapes-chip"
              disabled={deleted}
              aria-label={`Place ${entry.definition.symbol.name}`}
              title={`${entry.definition.symbol.name} · ${entry.author}${entry.status === "official" ? " · Official" : ""}`}
              onClick={() => onInsert(entry)}
              onContextMenu={(event) => {
                event.preventDefault();
                onEdit(entry);
              }}
            >
              <SymbolArtwork
                symbol={entry.definition.symbol}
                className="shapes-chip-art"
              />
              <span>{entry.definition.symbol.name}</span>
            </button>
            <button
              type="button"
              className="user-component-edit"
              aria-label={`Edit ${entry.definition.symbol.name} definition`}
              onClick={() => onEdit(entry)}
            >
              {entry.status === "official" ? "Official · Edit" : "Edit"}
            </button>
          </div>
        ))}
      </div>
      {loading ? (
        <small role="status">Loading components…</small>
      ) : cursor ? (
        <button type="button" onClick={() => void more()}>
          Load more
        </button>
      ) : !entries.length && !error ? (
        <small>No shared components yet.</small>
      ) : null}
    </details>
  );
}
