/**
 * The Schematic Arena's "Draw it yourself" link (#1695): after a Both bad
 * Vote, a Voter opens either side's drawing as a new project of their own
 * (docs/specs/analog-arena.md#draw-it-yourself). The address alone: the
 * page entry reads it before anything loads, so it imports nothing.
 */
export interface ArenaEntry {
  readonly battle: string;
  readonly side: "a" | "b";
}

const BATTLE = /^[A-Za-z0-9_-]{1,128}$/u;

/** The entry a page address names, or null. */
export function arenaEntryOf(search: string): ArenaEntry | null {
  const params = new URLSearchParams(search);
  const battle = params.get("arena-battle") ?? "";
  const side = params.get("arena-side");
  return BATTLE.test(battle) && (side === "a" || side === "b")
    ? { battle, side }
    : null;
}

function arenaEntryEditorPath(entry: ArenaEntry): string {
  return `/editor?${new URLSearchParams({ "arena-battle": entry.battle, "arena-side": entry.side })}`;
}

/**
 * A sign-in that starts from the entry ends on the Gallery, so the entry
 * waits in this tab for a short while and continues there.
 */
const PENDING_KEY = "icm.arena-entry.pending";
const PENDING_FOR_MS = 15 * 60_000;

/**
 * The entry waits once the Voter chooses a GitHub or Google sign-in, and
 * not before: one who declines finds the Gallery as usual. An email
 * sign-in reloads the entry's own address.
 */
export function rememberArenaEntryOnSignIn(
  entry: ArenaEntry,
  page: Pick<Document, "addEventListener"> = document,
  storage: Pick<Storage, "setItem"> = sessionStorage,
  clock: () => number = Date.now,
): void {
  page.addEventListener(
    "click",
    (event) => {
      const target = event.target as Partial<Element> | null;
      if (target?.closest?.('a[href^="/api/auth/"]'))
        rememberPendingArenaEntry(entry, storage, clock());
    },
    { capture: true },
  );
}

function rememberPendingArenaEntry(
  entry: ArenaEntry,
  storage: Pick<Storage, "setItem"> = sessionStorage,
  now = Date.now(),
): void {
  try {
    storage.setItem(PENDING_KEY, JSON.stringify({ ...entry, at: now }));
  } catch {
    // Without storage the Voter follows the Arena's link again.
  }
}

function takePendingArenaEntry(
  storage: Pick<Storage, "getItem" | "removeItem">,
  now: number,
): ArenaEntry | null {
  try {
    const raw = storage.getItem(PENDING_KEY);
    if (raw === null) return null;
    storage.removeItem(PENDING_KEY);
    const pending = JSON.parse(raw) as Partial<ArenaEntry> & { at?: number };
    if (typeof pending.at !== "number" || now - pending.at > PENDING_FOR_MS)
      return null;
    return arenaEntryOf(
      `?${new URLSearchParams({ "arena-battle": String(pending.battle ?? ""), "arena-side": String(pending.side ?? "") })}`,
    );
  } catch {
    return null;
  }
}

/**
 * Where a page load goes instead, if anywhere: the Arena may link the
 * Gallery's address, and a sign-in begun from the entry returns to it.
 */
export function arenaEntryRedirect(
  location: Pick<Location, "pathname" | "search">,
  storage: Pick<Storage, "getItem" | "removeItem"> = sessionStorage,
  now = Date.now(),
): string | null {
  if (!/^\/?$/u.test(location.pathname)) return null;
  const entry =
    arenaEntryOf(location.search) ?? takePendingArenaEntry(storage, now);
  return entry ? arenaEntryEditorPath(entry) : null;
}
