/**
 * The pages the app shell serves, by path: the Gallery at `/`, the named
 * pages, the editor at `/editor` and one Gallery circuit at `/g/<id>`, each
 * with or without a trailing slash. The browser routes them
 * (entries/web.tsx); the Worker answers every other path with 404 (#2159).
 * Imports nothing, so the Worker can read it as it is.
 */

/** The pages besides the Gallery and the editor. */
const NAMED_PAGES = [
  "analytics",
  "moderation",
  "privacy",
  "changelog",
  "account",
  "mine",
  "datasets",
  "review",
] as const;

const NAMED_PAGE = new RegExp(`^/(?:${NAMED_PAGES.join("|")})?/?$`, "u");

/**
 * The id a `/g/<id>` path names, or null: a community id, or a dataset's
 * prefix and its own id, which may hold `_` (worker/gallery-sources.ts).
 */
export function galleryEntryIdOfPath(pathname: string): string | null {
  return /^\/g\/([A-Za-z0-9_-]{1,64})\/?$/u.exec(pathname)?.[1] ?? null;
}

/** `/` or a named page: a page that is not the editor. */
function isNamedPagePath(pathname: string): boolean {
  return NAMED_PAGE.test(pathname);
}

/** `/editor` or `/g/<id>`: the editor's pages. */
export function isEditorPath(pathname: string): boolean {
  return (
    /^\/editor\/?$/u.test(pathname) || galleryEntryIdOfPath(pathname) !== null
  );
}

/** Whether the app shell serves a page at this path. */
export function isAppPagePath(pathname: string): boolean {
  return isNamedPagePath(pathname) || isEditorPath(pathname);
}
