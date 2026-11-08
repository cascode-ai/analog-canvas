import { useSyncExternalStore } from "react";

// The reader's own reference image, a figure they paste, drop or choose to
// trace over: whether the editor shows it, and the image itself, kept for the
// page's life across closing and reopening its panel. The Edit menu opens
// it; Publish offers to publish the image with the drawing. Its panel loads
// apart from the editor's first payload.

export interface OwnReferenceImage {
  file: File;
  url: string;
}

let open = false;
let image: OwnReferenceImage | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const openOwnReference = () => {
  open = true;
  changed();
};
export const closeOwnReference = () => {
  open = false;
  changed();
};

export function keepOwnReferenceImage(file: File): void {
  if (image) URL.revokeObjectURL(image.url);
  image = { file, url: URL.createObjectURL(file) };
  changed();
}

export function useOwnReferenceOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => open,
  );
}

export function useOwnReferenceImage(): OwnReferenceImage | null {
  return useSyncExternalStore(
    subscribe,
    () => image,
    () => image,
  );
}
