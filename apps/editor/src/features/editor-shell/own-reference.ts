import { useSyncExternalStore } from "react";

// Whether the editor shows the reader's own reference image, a figure they
// paste, drop or choose to trace over. The Edit menu opens it; its panel
// loads apart from the editor's first payload.

let open = false;
const listeners = new Set<() => void>();
const changed = (next: boolean) => {
  open = next;
  for (const listener of listeners) listener();
};

export const openOwnReference = () => changed(true);
export const closeOwnReference = () => changed(false);

export function useOwnReferenceOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => false,
  );
}
