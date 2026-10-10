/**
 * The Gallery wall's order (#1615): a shuffle by default, so older and
 * less-liked circuits are seen too; by time, newest or oldest first; or by
 * part count, most or fewest first. A reader's own choice is remembered in
 * this browser; random is never stored, so the wall reshuffles on each visit.
 * No imports: the build reads this module too (gallery-early-fetch.ts).
 */
export type GalleryOrder = "random" | "newest" | "oldest" | "parts" | "fewest";

/** The orders a reader may keep; random is the default and is not stored. */
export const STORED_GALLERY_ORDERS = [
  "newest",
  "oldest",
  "parts",
  "fewest",
] as const;

export const GALLERY_ORDER_KEY = "icm.gallery.order";

/** Where index.html's early request leaves the seed it shuffled by. */
export const GALLERY_SEED_GLOBAL = "__icmGallerySeed";

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
 * This page's shuffle: the seed index.html's early request used, when it
 * made one, so the wall takes that answer; otherwise one made once here.
 */
export function galleryShuffleSeed(): string {
  const early = (globalThis as Record<string, unknown>)[GALLERY_SEED_GLOBAL];
  if (typeof early === "string" && SEED.test(early)) return early;
  sessionSeed ??= newGalleryShuffleSeed();
  return sessionSeed;
}
