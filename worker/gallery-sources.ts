import registry from "../config/gallery-sources.json";

/**
 * Reference datasets the Gallery opens beside the community wall (#1510):
 * circuits of another dataset, redrawn as Analog Canvas schematics. Each
 * lives in a read-only store of its own, a GalleryDO instance apart from the
 * community one, so its size never touches the community wall's speed or
 * backups. Its entries' ids start with its prefix and a hyphen, `ag-308`,
 * which community ids never contain, so an id alone names its store.
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

/** The store of the community wall, and of each reference dataset. */
export function galleryStoreName(source: GallerySource | null): string {
  return source ? `source:${source.key}` : "gallery";
}

export function gallerySourceByKey(
  key: string | null | undefined,
): GallerySource | null {
  return GALLERY_SOURCES.find((source) => source.key === key) ?? null;
}

/** An id of a reference dataset's entry: its prefix, a hyphen, its own id. */
const SOURCE_ENTRY_ID = /^([a-z][a-z0-9]*)-([A-Za-z0-9][A-Za-z0-9_-]{0,47})$/u;

export function gallerySourceOfEntryId(id: string): GallerySource | null {
  const prefix = SOURCE_ENTRY_ID.exec(id)?.[1];
  return GALLERY_SOURCES.find((source) => source.prefix === prefix) ?? null;
}
