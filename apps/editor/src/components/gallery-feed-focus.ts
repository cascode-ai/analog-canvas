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
import {
  forgetGalleryReturn,
  galleryReturnStep,
  galleryReturnTo,
  type GalleryReturn,
} from "../gallery-return";
import { isRequestFailure, type RequestFailure } from "../request-failure";

export function useGalleryFocusLink({
  preload,
  state,
  setState,
  visibleEntries,
  wallKey,
  loadNextPage,
}: {
  preload: GalleryLandingPreload | undefined;
  state: GalleryFeedState;
  setState: Dispatch<SetStateAction<GalleryFeedState>>;
  visibleEntries: GalleryFeedEntry[];
  /** The wall's query key: a return is found only on the wall it left. */
  wallKey: string;
  /** Asks for the next page; false when none could start now. */
  loadNextPage: () => boolean;
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
    GalleryFeedEntry | RequestFailure | undefined
  >(undefined);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  // Why the linked circuit is not shown, once that is known.
  const [focusFailure, setFocusFailure] = useState<string | null>(null);
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
  // Coming back from a circuit opened on this wall finds it again: the wall
  // pages down to it, then brings it into view and rings it. Undefined until
  // the first answer says which wall this is.
  const [returning, setReturning] = useState<GalleryReturn | null>();
  useEffect(() => {
    if (state.status !== "ready") return;
    let target = returning;
    if (target === undefined) {
      const record = galleryReturnTo(wallKey);
      // A "View in Gallery" link to another circuit wins over the return.
      target =
        record && (focusId === null || focusId === record.entryId)
          ? record
          : null;
      setReturning(target);
    }
    if (!target) return;
    const step = galleryReturnStep(
      target,
      visibleEntries.map((entry) => entry.id),
      state.nextCursor !== null,
    );
    if (step === "page") {
      loadNextPage();
      return;
    }
    setReturning(null);
    if (step === "stop") return;
    forgetGalleryReturn();
    if (focusId === target.entryId) {
      setFocusId(null);
      window.history.replaceState(
        null,
        "",
        window.location.pathname + withoutGalleryFocus(window.location.search),
      );
    }
    setLinkedId(target.entryId);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- loadNextPage and the wall key are read when the wall answers; a new page re-runs this
  }, [state, visibleEntries, returning, focusId]);
  useEffect(() => {
    // A return being found holds a link until it is found or given up.
    if (returning !== null) return;
    if (focusId === null || state.status !== "ready") return;
    const placement = galleryFocusPlacement(
      visibleEntries.map((entry) => entry.id),
      focusId,
      focusEntry === undefined ? undefined : !isRequestFailure(focusEntry),
    );
    if (placement === undefined) return;
    setFocusId(null);
    window.history.replaceState(
      null,
      "",
      window.location.pathname + withoutGalleryFocus(window.location.search),
    );
    if (placement === "missing") {
      setFocusFailure(isRequestFailure(focusEntry) ? focusEntry.message : null);
      return;
    }
    if (placement === "first" && focusEntry && !isRequestFailure(focusEntry))
      setState((previous) => ({
        ...previous,
        entries: [focusEntry, ...previous.entries],
      }));
    setLinkedId(focusId);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- setState is the wall's useState setter, the same function on every render
  }, [focusId, focusEntry, state, visibleEntries, returning]);
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
  return { linkedId, focusFailure };
}
