/**
 * A link to one circuit on the Gallery wall: `/?entry=<id>`, as the editor's
 * "View in Gallery" sends it after a publish. The wall opens unfiltered and
 * shows that circuit at once: in its place when the first page holds it, and
 * otherwise first on the wall, looked up by its id rather than by paging down
 * to it. Its tile is brought into view and ringed.
 */

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
 * Where the wall shows the linked circuit: in its place when a loaded page
 * holds it, first on the wall when its lookup found it, or nowhere when it is
 * not on the public wall. Undefined while the lookup is still on its way.
 */
export function galleryFocusPlacement(
  loadedIds: readonly string[],
  focusId: string,
  found: boolean | undefined,
): "in-place" | "first" | "missing" | undefined {
  if (loadedIds.includes(focusId)) return "in-place";
  if (found === undefined) return undefined;
  return found ? "first" : "missing";
}
