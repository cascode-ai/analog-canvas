import type {
  ComponentCatalogQuery,
  ComponentLibrarySummaryPage,
} from "./component-library-contract";
import {
  loadSharedComponentSummaries,
  ComponentLibraryError,
} from "./component-library-client";

/** Resume incomplete reads; replace a refreshed catalog only when all its pages agree. */
export async function loadComponentCatalog(
  query: string,
  deleted: boolean,
  catalog: ComponentCatalogQuery,
  signal: AbortSignal,
  receive: (page: ComponentLibrarySummaryPage) => void,
  previous?: ComponentLibrarySummaryPage,
  progress?: {
    resume: ComponentLibrarySummaryPage | undefined;
    retain(page: ComponentLibrarySummaryPage | undefined): void;
  },
) {
  let page = progress?.resume ?? previous;
  let cursor = page?.nextCursor ?? null;
  let replacing = !!progress?.resume || (!!previous && !previous.nextCursor);
  let restarted = false;
  const visited = new Set<string>();
  do {
    if (cursor && visited.has(cursor))
      throw Error("Component library returned a repeated page. Try again.");
    if (cursor) visited.add(cursor);
    let next: ComponentLibrarySummaryPage;
    try {
      next = await loadSharedComponentSummaries(
        query,
        cursor,
        deleted,
        signal,
        fetch,
        catalog,
        replacing && !cursor ? previous?.catalogRevision : undefined,
      );
    } catch (cause) {
      if (
        !restarted &&
        cause instanceof ComponentLibraryError &&
        cause.code === "COMPONENT_CATALOG_CHANGED"
      ) {
        restarted = true;
        replacing = true;
        cursor = null;
        page = undefined;
        previous = undefined;
        progress?.retain(undefined);
        visited.clear();
        continue;
      }
      throw cause;
    }
    signal.throwIfAborted();
    if (next.notModified) {
      progress?.retain(undefined);
      return;
    }
    const entries = cursor ? (page?.entries ?? []) : [];
    page = {
      ...next,
      entries: [
        ...new Map(
          [...entries, ...next.entries].map((entry) => [entry.id, entry]),
        ).values(),
      ],
    };
    cursor = next.nextCursor;
    progress?.retain(replacing && cursor ? page : undefined);
    if (!replacing || !cursor) receive(page);
  } while (cursor || (restarted && !page));
}
