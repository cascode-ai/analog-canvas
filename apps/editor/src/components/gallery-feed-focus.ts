/**
 * A "View in Gallery" link on the wall: the circuit it names shown at once,
 * brought into view and ringed for a moment, or said to be missing.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  loadGalleryEntry,
  type GalleryFeedEntry,
  type GalleryFeedState,
  type GalleryLandingPreload,
} from "../gallery-client";
import {
  galleryFocusEntryId,
  galleryFocusPlacement,
  withoutGalleryFocus,
} from "../gallery-focus";

export function useGalleryFocusLink({
  preload,
  state,
  setState,
  visibleEntries,
}: {
  preload: GalleryLandingPreload | undefined;
  state: GalleryFeedState;
  setState: Dispatch<SetStateAction<GalleryFeedState>>;
  visibleEntries: GalleryFeedEntry[];
}) {
  // A "View in Gallery" link names one circuit. The wall shows it at once: in
  // its place when the first page holds it, otherwise first on the wall,
  // looked up by its id (an updated circuit can sit hundreds of tiles down).
  // Its tile is brought into view and ringed for a moment.
  const [focusId, setFocusId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : galleryFocusEntryId(window.location.search),
  );
  const [focusEntry, setFocusEntry] = useState<
    GalleryFeedEntry | null | undefined
  >(undefined);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [focusMissing, setFocusMissing] = useState(false);
  useEffect(() => {
    if (focusId === null) return;
    let cancelled = false;
    const request =
      preload?.focus?.id === focusId
        ? preload.focus.entry
        : loadGalleryEntry(fetch, focusId);
    void request.then((entry) => {
      if (!cancelled) setFocusEntry(entry);
    });
    return () => {
      cancelled = true;
    };
  }, [focusId, preload]);
  useEffect(() => {
    if (focusId === null || state.status !== "ready") return;
    const placement = galleryFocusPlacement(
      visibleEntries.map((entry) => entry.id),
      focusId,
      focusEntry === undefined ? undefined : focusEntry !== null,
    );
    if (placement === undefined) return;
    setFocusId(null);
    window.history.replaceState(
      null,
      "",
      window.location.pathname + withoutGalleryFocus(window.location.search),
    );
    if (placement === "missing") {
      setFocusMissing(true);
      return;
    }
    if (placement === "first" && focusEntry)
      setState((previous) => ({
        ...previous,
        entries: [focusEntry, ...previous.entries],
      }));
    setLinkedId(focusId);
  }, [focusId, focusEntry, state, visibleEntries]);
  useEffect(() => {
    if (linkedId === null) return;
    // Masonry measures tiles and moves them as previews arrive, so a single
    // scroll lands where the tile was, not where it ends up. Keep the tile
    // centred until it has stayed put, and stop at the reader's first scroll.
    const tileSelector = `[data-testid="gallery-tile-${linkedId}"]`;
    let frame = 0;
    let lastTop: number | null = null;
    let stillFrames = 0;
    let readerScrolled = false;
    const readerScroll = () => {
      readerScrolled = true;
    };
    const listeners = ["wheel", "touchstart", "keydown"] as const;
    for (const type of listeners)
      window.addEventListener(type, readerScroll, {
        capture: true,
        passive: true,
      });
    const started = performance.now();
    const aim = () => {
      if (readerScrolled) return;
      const tile = document.querySelector<HTMLElement>(tileSelector);
      const shell = tile?.closest<HTMLElement>(".gallery-shell");
      if (tile && shell) {
        // The tile's place on the wall, whatever the wall's scroll.
        const top =
          tile.getBoundingClientRect().top -
          shell.getBoundingClientRect().top +
          shell.scrollTop;
        if (lastTop === null || Math.abs(top - lastTop) > 1) {
          lastTop = top;
          stillFrames = 0;
          tile.scrollIntoView({ block: "center", behavior: "auto" });
          tile.focus({ preventScroll: true });
        } else stillFrames += 1;
      }
      if (stillFrames < 12 && performance.now() - started < 2_500)
        frame = window.requestAnimationFrame(aim);
    };
    frame = window.requestAnimationFrame(aim);
    const timer = window.setTimeout(() => setLinkedId(null), 6_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      for (const type of listeners)
        window.removeEventListener(type, readerScroll, { capture: true });
    };
  }, [linkedId]);
  return { linkedId, focusMissing };
}
