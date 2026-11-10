import { useSyncExternalStore } from "react";
import { isOfficeDialog } from "../../app/office-messages";

// The reference window beside the canvas: whether it shows (from the start,
// until closed), and each drawing's image the reader brought to trace over,
// kept for the page's life. The Edit menu and the status bar open it; Publish offers to publish the image with the drawing. The window
// and the Publish dialog load apart from the editor's first payload and take
// what they need from here as props, so this stays in that payload's chunk.

export interface OwnReferenceImage {
  file: File;
  url: string;
}

// Closed stays closed in this browser until opened again.
const CLOSED_KEY = "icm.reference-window.v1";
function rememberClosed(closed: boolean): void {
  try {
    if (closed) localStorage.setItem(CLOSED_KEY, "closed");
    else localStorage.removeItem(CLOSED_KEY);
  } catch {
    // Without storage it opens with the next page.
  }
}
/** Phone widths, where the window is a sheet along the bottom (#2151). */
export const REFERENCE_SHEET_QUERY = "(max-width: 640px)";

// The PowerPoint dialog starts with the drawing alone, and so does a phone,
// whose screen is the drawing's; it opens there on request.
let open = (() => {
  if (isOfficeDialog()) return false;
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.(REFERENCE_SHEET_QUERY).matches
  )
    return false;
  try {
    return localStorage.getItem(CLOSED_KEY) !== "closed";
  } catch {
    return true;
  }
})();
/** By project tab session. */
const images = new Map<string, OwnReferenceImage>();
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// How often the person has asked for the window (File or the status bar):
// each time it shows unfolded, whatever it showed before.
let openings = 0;

export const openOwnReference = () => {
  open = true;
  openings += 1;
  rememberClosed(false);
  changed();
};
export const closeOwnReference = () => {
  open = false;
  rememberClosed(true);
  changed();
};

export function keepOwnReferenceImage(session: string, file: File): void {
  const before = images.get(session);
  if (before) URL.revokeObjectURL(before.url);
  images.set(session, { file, url: URL.createObjectURL(file) });
  changed();
}

export function useOwnReferenceOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}

export function useOwnReferenceOpenings(): number {
  return useSyncExternalStore(
    subscribe,
    () => openings,
    () => 0,
  );
}

export function useOwnReferenceImage(
  session: string,
): OwnReferenceImage | null {
  return useSyncExternalStore(
    subscribe,
    () => images.get(session) ?? null,
    () => null,
  );
}
