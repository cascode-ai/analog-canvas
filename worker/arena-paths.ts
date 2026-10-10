// AnalogArena's host and paths (docs/specs/analog-arena.md#routing).
// Forwarding and the redirects (arena.ts) and the sign-in return and handoff
// (auth-do.ts) all read them here, so they never disagree about which paths
// are Arena's. wrangler.jsonc lists the same pages in run_worker_first.

/** AnalogArena's own host, served by this Worker. */
export const ARENA_HOST = "chip-arena.com";

/** Its origin: sign-in returns and handoffs name it in full. */
export const ARENA_ORIGIN = `https://${ARENA_HOST}`;

/** Analog Canvas's host. */
export const CANVAS_HOST = "analog-canvas.tokenzhang.com";

/** Where the Schematic Arena's pages live. */
export const SCHEMATIC_ARENA_PATH = "/schematic";

/** A page of the Schematic Arena: /schematic itself or anything below it. */
export function isArenaPagePath(pathname: string): boolean {
  return (
    pathname === SCHEMATIC_ARENA_PATH ||
    pathname.startsWith(`${SCHEMATIC_ARENA_PATH}/`)
  );
}

/** The Schematic Arena's former address, /arena or anything below it. */
export function isLegacyArenaPagePath(pathname: string): boolean {
  return pathname === "/arena" || pathname.startsWith("/arena/");
}

/** The Schematic Arena page that a former /arena… path became. */
export function schematicArenaPathOf(legacyPathname: string): string {
  return SCHEMATIC_ARENA_PATH + legacyPathname.slice("/arena".length);
}

/** A path this Worker forwards to Arena: its pages and /api/arena/…. */
export function isArenaForwardedPath(pathname: string): boolean {
  return isArenaPagePath(pathname) || pathname.startsWith("/api/arena/");
}
