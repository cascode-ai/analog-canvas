import registry from "../../../config/gallery-sources.json";

/**
 * Reference datasets the Gallery opens beside the community wall (#1510),
 * one at a time: other datasets' circuits, redrawn as Analog Canvas
 * schematics, each in a read-only store of its own. An entry's id starts
 * with its dataset's prefix and a hyphen (`ag-308`).
 */
export interface GallerySource {
  key: string;
  prefix: string;
  name: string;
  byline: string;
  license: string;
  homepage: string;
  paper?: string;
}

export const GALLERY_SOURCES: readonly GallerySource[] = registry.sources;

export function gallerySourceByKey(
  key: string | null | undefined,
): GallerySource | null {
  return GALLERY_SOURCES.find((source) => source.key === key) ?? null;
}

/** The dataset an entry id belongs to, or null for a community entry. */
export function gallerySourceOfEntryId(id: string): GallerySource | null {
  const prefix = /^([a-z][a-z0-9]*)-/u.exec(id)?.[1];
  return GALLERY_SOURCES.find((source) => source.prefix === prefix) ?? null;
}
