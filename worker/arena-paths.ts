// The "/arena path" rule (docs/specs/analog-arena.md#routing). Forwarding
// (arena.ts) and the sign-in return (auth-do.ts) both read it here, so the
// two never disagree about which paths are Arena's. wrangler.jsonc lists the
// same pages in run_worker_first.

/** A page of AnalogArena: /arena itself or anything below it. */
export function isArenaPagePath(pathname: string): boolean {
  return pathname === "/arena" || pathname.startsWith("/arena/");
}

/** A path this Worker forwards to Arena: its pages and /api/arena/…. */
export function isArenaForwardedPath(pathname: string): boolean {
  return isArenaPagePath(pathname) || pathname.startsWith("/api/arena/");
}
