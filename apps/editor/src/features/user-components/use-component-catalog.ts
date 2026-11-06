import { useEffect, useRef, useState } from "react";
import type {
  ComponentCatalogQuery,
  ComponentLibrarySummaryPage,
} from "./component-library-contract";
import { loadComponentCatalog as loadCatalog } from "./component-catalog-loading";
import { LibraryCache } from "./library-cache";

const EMPTY: ComponentLibrarySummaryPage = { entries: [], nextCursor: null };
type KeyedPage = { key: string; page: ComponentLibrarySummaryPage };

/** Outlives the panel: visiting the tree and returning reuses these lists. */
const pages = new LibraryCache<ComponentLibrarySummaryPage>(
  8,
  1024 * 1024,
  Infinity,
);
let pagesAccount: string | null | undefined;

/** @internal Tests start each case from an empty session cache. */
export function clearComponentCatalogPages(): void {
  pages.clear();
  pagesAccount = undefined;
}

/** One independently loaded list of the catalog: Community, mine or deleted. */
export function useComponentCatalog({
  active,
  accountId,
  query,
  catalog,
  deleted = false,
  refresh,
}: {
  active: boolean;
  accountId: string | null;
  query: string;
  catalog: ComponentCatalogQuery;
  deleted?: boolean;
  refresh: number;
}) {
  const [page, setPage] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retained = useRef<KeyedPage | null>(null);
  const buffered = useRef<KeyedPage | null>(null);
  const request = useRef<AbortController | null>(null);
  const listIdentity = useRef("");
  const term = query.trim();
  const key = JSON.stringify([accountId, term.toLowerCase(), deleted, catalog]);

  function progress(signal: AbortSignal) {
    return {
      resume: buffered.current?.key === key ? buffered.current.page : undefined,
      retain(next: ComponentLibrarySummaryPage | undefined) {
        if (signal.aborted) return;
        if (next) buffered.current = { key, page: next };
        else if (buffered.current?.key === key) buffered.current = null;
      },
    };
  }
  /** Reads every page, keeping what is shown until a new list agrees. */
  function read(signal: AbortSignal, previous?: ComponentLibrarySummaryPage) {
    return loadCatalog(
      term,
      deleted,
      catalog,
      signal,
      show,
      previous,
      progress(signal),
    ).catch((failure: unknown) => {
      if (!signal.aborted)
        setError(failure instanceof Error ? failure.message : String(failure));
    });
  }
  function show(next: ComponentLibrarySummaryPage) {
    setPage(next);
    if (deleted) return;
    retained.current = { key, page: next };
    pages.set(key, next);
  }
  useEffect(() => {
    // Only an account's own lists set whose lists the cache holds.
    if (!active || accountId === null || pagesAccount === accountId) return;
    if (pagesAccount !== undefined) pages.clear();
    pagesAccount = accountId;
    retained.current = null;
    buffered.current = null;
  }, [accountId, active]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    request.current = controller;
    setError(null);
    const cached = !deleted
      ? (pages.get(key) ??
        (retained.current?.key === key ? retained.current.page : undefined))
      : undefined;
    if (cached) setPage(cached);
    else if (deleted || key !== listIdentity.current) setPage(EMPTY);
    listIdentity.current = key;
    setLoading(!cached || !!cached.nextCursor);
    const timer = setTimeout(
      () => {
        void read(controller.signal, cached).finally(() => {
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
    };
  }, [active, key, attempt, refresh]);
  return {
    page,
    loading,
    error,
    retry: () => setAttempt((value) => value + 1),
    /** A refresh waits for any read already running. */
    refreshIfIdle() {
      if (!request.current) setAttempt((value) => value + 1);
    },
    /** Replace the list after a selection found it stale. */
    reload(signal: AbortSignal) {
      request.current?.abort();
      setLoading(false);
      return read(signal, page);
    },
    /** Drop a record its lifecycle moved elsewhere, then confirm the list. */
    forget(id: string) {
      request.current?.abort();
      pages.clear();
      retained.current = null;
      buffered.current = null;
      setPage((current) => ({
        ...current,
        entries: current.entries.filter((entry) => entry.id !== id),
      }));
      setAttempt((value) => value + 1);
    },
  };
}
