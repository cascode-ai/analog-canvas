import { useEffect, useState } from "react";
import type { GallerySource } from "../gallery-sources";

/** A reference dataset with the number of circuits its wall holds. */
export type GalleryDatasetCount = GallerySource & { count: number };

/** The datasets the contributor list names: those with circuits, the open one, or all. */
export function offeredGallerySources<T extends { key: string; count: number }>(
  sources: readonly T[],
  source: string | null,
  showEmpty: boolean,
): T[] {
  return sources.filter(
    (item) => showEmpty || item.count > 0 || item.key === source,
  );
}

/**
 * The reference datasets the Gallery can open beside the community wall
 * (#1510), listed among its contributors (#1574). A reader sees only
 * datasets that hold circuits, so none shows until one is imported; the
 * Owner, who imports them, sees every dataset, empty ones with their 0.
 */
export function useGalleryDatasets(
  source: string | null,
  showEmpty: boolean,
  fetchLike: typeof fetch = fetch,
): GalleryDatasetCount[] {
  const [sources, setSources] = useState<GalleryDatasetCount[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetchLike("/api/gallery/sources", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { sources?: GalleryDatasetCount[] } | null) => {
        if (!cancelled && Array.isArray(payload?.sources))
          setSources(payload.sources);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fetchLike]);
  return offeredGallerySources(sources, source, showEmpty);
}

/** What a reference dataset's wall says about where its circuits come from. */
export function GallerySourceNote({ source }: { source: GallerySource }) {
  return (
    <p className="gallery-source-note" data-testid="gallery-source-note">
      Circuits of the {source.name} dataset, redrawn as Analog Canvas schematics
      · {source.license}
      {source.paper ? (
        <>
          {" · "}
          <a href={source.paper} target="_blank" rel="noreferrer">
            Paper
          </a>
        </>
      ) : null}
      {" · "}
      <a href={source.homepage} target="_blank" rel="noreferrer">
        Dataset
      </a>
    </p>
  );
}
