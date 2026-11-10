/**
 * The Gallery wall's order (#1615): a shuffle by default, so older and
 * less-liked circuits are seen too; by time, newest or oldest first; by
 * part count, most or fewest first; or by likes, most first. A reader's own
 * choice is remembered in this browser; random is never stored. A shuffle
 * keeps its seed for the browser tab, so a reader who opens a circuit and
 * comes back finds the same wall; a new tab, or Shuffle, deals a new one.
 * No imports: the build reads this module too (gallery-early-fetch.ts).
 */
export type GalleryOrder =
  "random" | "newest" | "oldest" | "parts" | "fewest" | "likes";

/** The orders a reader may keep; random is the default and is not stored. */
export const STORED_GALLERY_ORDERS = [
  "newest",
  "oldest",
  "parts",
  "fewest",
  "likes",
] as const;

export const GALLERY_ORDER_KEY = "icm.gallery.order";

/** Where index.html's early request leaves the seed it shuffled by. */
export const GALLERY_SEED_GLOBAL = "__icmGallerySeed";

/** The tab's shuffle seed, kept so coming back finds the same wall. */
export const GALLERY_SEED_KEY = "icm.gallery.seed";

const SEED = /^[a-z0-9]{1,16}$/u;

export function galleryOrderPreference(
  read: () => string | null = () => localStorage.getItem(GALLERY_ORDER_KEY),
): GalleryOrder {
  try {
    const stored = read();
    return (STORED_GALLERY_ORDERS as readonly string[]).includes(stored ?? "")
      ? (stored as GalleryOrder)
      : "random";
  } catch {
    return "random";
  }
}

export function rememberGalleryOrder(
  order: GalleryOrder,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): void {
  try {
    if (order === "random") storage.removeItem(GALLERY_ORDER_KEY);
    else storage.setItem(GALLERY_ORDER_KEY, order);
  } catch {
    // The wall still sorts; only the memory of the choice is lost.
  }
}

/** A fresh shuffle: eight base-36 characters. */
export function newGalleryShuffleSeed(): string {
  return Math.random().toString(36).slice(2, 10) || "s0";
}

let sessionSeed: string | undefined;

/**
 * This tab's shuffle: the seed index.html's early request used, when it made
 * one, so the wall takes that answer; else the one the tab kept; otherwise one
 * made here and kept for the tab.
 */
export function galleryShuffleSeed(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = tabStorage(),
): string {
  const early = (globalThis as Record<string, unknown>)[GALLERY_SEED_GLOBAL];
  if (typeof early === "string" && SEED.test(early)) return early;
  if (sessionSeed) return sessionSeed;
  let kept: string | null = null;
  try {
    kept = storage?.getItem(GALLERY_SEED_KEY) ?? null;
  } catch {
    // Unreadable storage: the wall shuffles afresh.
  }
  sessionSeed =
    kept && SEED.test(kept) ? kept : keepGallerySeed(newGalleryShuffleSeed());
  return sessionSeed;
}

/** Keeps `seed` as the tab's shuffle (Shuffle chose it, or a first visit). */
export function keepGallerySeed(
  seed: string,
  storage: Pick<Storage, "setItem"> | undefined = tabStorage(),
): string {
  sessionSeed = seed;
  try {
    storage?.setItem(GALLERY_SEED_KEY, seed);
  } catch {
    // Unwritable storage: only coming back reshuffles.
  }
  return seed;
}

function tabStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
