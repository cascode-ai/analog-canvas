/**
 * The wall's filters as React state, remembered for the tab and in the
 * URL, and the search words the server is asked once typing pauses.
 */
import { useEffect, useRef, useState } from "react";
import {
  GALLERY_FILTERS_KEY,
  createDefaultGalleryFilters,
  galleryFilterSearch,
  isPageReload,
  resolveGalleryFilters,
  storedGalleryFilters,
  type GalleryFilterState,
} from "../gallery-filters";

export function useGalleryFilters() {
  // Which wall, whose circuits, which tags, which words, which marks: one
  // state, because a reader changes them for one reason. It rides in the URL
  // so a link and the Back button carry the same slice, and in the tab's
  // session storage so opening a circuit and coming back does not widen the
  // wall. A new visit opens the whole wall, never last week's slice.
  // The words are the exception: storage never keeps them, and a reload
  // opens without them (#1675); the address effect below then drops `q`.
  const [filters, setFilters] = useState<GalleryFilterState>(() => {
    if (typeof window === "undefined") return createDefaultGalleryFilters();
    const opening = { reload: isPageReload() };
    try {
      return resolveGalleryFilters(
        window.location.search,
        window.sessionStorage.getItem(GALLERY_FILTERS_KEY),
        opening,
      );
    } catch {
      // Private-mode storage throws on read; the link still decides.
      return resolveGalleryFilters(window.location.search, null, opening);
    }
  });
  const { search: searchQuery } = filters;
  function updateFilters(patch: Partial<GalleryFilterState>): void {
    setFilters((previous) => ({ ...previous, ...patch }));
  }
  // The server answers a search over the whole Gallery. Typing waits a
  // moment before asking it, and the wall narrows what it has meanwhile.
  const [serverSearch, setServerSearch] = useState(() => searchQuery.trim());
  useEffect(() => {
    const next = searchQuery.trim();
    if (next === serverSearch) return;
    const handle = window.setTimeout(() => setServerSearch(next), 250);
    return () => window.clearTimeout(handle);
  }, [searchQuery, serverSearch]);

  // Remembered at once: a reader who narrows the wall and immediately opens a
  // circuit must come back to the same slice, so this write cannot wait.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        GALLERY_FILTERS_KEY,
        storedGalleryFilters(filters),
      );
    } catch {
      // The wall works without storage; only the memory of it is lost.
    }
  }, [filters]);

  const previousUrlFilters = useRef(filters);
  // Discrete choices must reach the URL immediately: on refresh an explicit
  // URL filter takes precedence over the saved preference. Only search typing
  // is debounced to avoid excessive browser history writes.
  useEffect(() => {
    const previous = previousUrlFilters.current;
    previousUrlFilters.current = filters;
    const searchOnly =
      filters.search !== previous.search &&
      (Object.keys(filters) as Array<keyof GalleryFilterState>).every(
        (key) => key === "search" || filters[key] === previous[key],
      );
    const updateAddress = () => {
      window.history.replaceState(
        null,
        "",
        window.location.pathname +
          galleryFilterSearch(window.location.search, filters),
      );
    };
    if (!searchOnly) {
      updateAddress();
      return;
    }
    const handle = window.setTimeout(updateAddress, 150);
    return () => window.clearTimeout(handle);
  }, [filters]);
  return { filters, setFilters, updateFilters, serverSearch };
}
