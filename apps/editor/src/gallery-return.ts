/**
 * Where a reader left the Gallery wall: the circuit they opened from it, and
 * how many circuits the wall had loaded. Coming back to the same wall (same
 * filters, order and shuffle) in the same tab finds that circuit again,
 * paging down to it, instead of starting at the first tile.
 */

export const GALLERY_RETURN_KEY = "icm.gallery.return";

/** How far past the loaded count the wall pages before it gives up. */
const RETURN_PAGING_MARGIN = 120;

export interface GalleryReturn {
  /** The wall's query key (galleryFeedQueryKey). */
  wall: string;
  entryId: string;
  /** Circuits loaded when the reader left. */
  loaded: number;
}

type ReturnStorage = Pick<Storage, "getItem" | "setItem">;

export function rememberGalleryReturn(
  record: GalleryReturn,
  storage: ReturnStorage | undefined = tabStorage(),
): void {
  try {
    storage?.setItem(GALLERY_RETURN_KEY, JSON.stringify(record));
  } catch {
    // Unwritable storage: coming back starts at the top.
  }
}

/** Forgets where the reader left: found once, the wall then opens at its top. */
export function forgetGalleryReturn(
  storage: Pick<Storage, "removeItem"> | undefined = tabStorage(),
): void {
  try {
    storage?.removeItem(GALLERY_RETURN_KEY);
  } catch {
    // Unwritable storage: the record is overwritten by the next open.
  }
}

/** The circuit to find again on `wall`, if the reader left this wall. */
export function galleryReturnTo(
  wall: string,
  storage: ReturnStorage | undefined = tabStorage(),
): GalleryReturn | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(GALLERY_RETURN_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as Partial<GalleryReturn>;
    return record.wall === wall &&
      typeof record.entryId === "string" &&
      /^[A-Za-z0-9_-]{1,64}$/u.test(record.entryId) &&
      typeof record.loaded === "number" &&
      Number.isFinite(record.loaded)
      ? { wall, entryId: record.entryId, loaded: record.loaded }
      : null;
  } catch {
    return null;
  }
}

/**
 * What the wall does next to find the circuit again: show it, load another
 * page, or stop (the circuit left the wall, or lies past where the reader
 * had paged).
 */
export function galleryReturnStep(
  target: GalleryReturn,
  loadedIds: readonly string[],
  morePages: boolean,
): "found" | "page" | "stop" {
  if (loadedIds.includes(target.entryId)) return "found";
  return morePages && loadedIds.length < target.loaded + RETURN_PAGING_MARGIN
    ? "page"
    : "stop";
}

/** The circuit a click on the wall opens, read from its tile's link. */
export function galleryTileOpened(target: EventTarget | null): string | null {
  const tile =
    target instanceof Element
      ? target.closest<HTMLAnchorElement>("a.gallery-tile")
      : null;
  const id = tile?.getAttribute("href")?.match(/^\/g\/([A-Za-z0-9_-]{1,64})$/u);
  return id?.[1] ?? null;
}

function tabStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
