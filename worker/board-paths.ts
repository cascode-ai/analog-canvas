// Selection boards' pages (docs/specs/selection-boards.md): routing (boards.ts) and
// the sign-in return (auth-do.ts) read them here, so they never disagree.

/** A board page: /boards itself or a board below it. */
export function isBoardPagePath(pathname: string): boolean {
  return pathname === "/boards" || pathname.startsWith("/boards/");
}
