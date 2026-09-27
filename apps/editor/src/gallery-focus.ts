/**
 * A link to one circuit on the Gallery wall: `/?entry=<id>`, as the editor's
 * "View in Gallery" sends it after a publish. The wall opens unfiltered, pages
 * newest-first until the circuit is loaded, and brings its tile into view.
 */

/** Newest-first pages the wall loads while looking before it gives up. */
export const GALLERY_FOCUS_MAX_PAGES = 60;

/** The circuit a link asks the wall to find, if it names a legible one. */
export function galleryFocusEntryId(search: string): string | null {
  const id = new URLSearchParams(search).get("entry")?.trim() ?? "";
  return /^[A-Za-z0-9-]{1,64}$/u.test(id) ? id : null;
}

/** The address with the link's `entry` removed, once the wall has found it. */
export function withoutGalleryFocus(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("entry");
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

/**
 * What the wall does next while it looks for the linked circuit: show it,
 * load the next page, or stop because the wall ended (or the page budget ran
 * out) without it.
 */
export function galleryFocusStep(
  loadedIds: readonly string[],
  focusId: string,
  nextCursor: string | null,
  pagesSought: number,
  maxPages: number = GALLERY_FOCUS_MAX_PAGES,
): "found" | "load-more" | "missing" {
  if (loadedIds.includes(focusId)) return "found";
  if (nextCursor !== null && pagesSought < maxPages) return "load-more";
  return "missing";
}
