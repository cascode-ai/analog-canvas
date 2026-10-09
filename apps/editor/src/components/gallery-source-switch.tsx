import { useEffect, useState } from "react";
import type { GallerySource } from "../gallery-sources";

type SourceCount = GallerySource & { count: number };

/** The datasets the switch lists: those with circuits, the open one, or all. */
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
 * Which wall the Gallery shows (#1510): the community's, or one reference
 * dataset's. A reader is offered only datasets that hold circuits, so it
 * stays out of sight until one is imported; the Owner, who imports them, is
 * offered every dataset, empty ones with their 0.
 */
export function GallerySourceSwitch({
  source,
  onChange,
  showEmpty = false,
  fetchLike = fetch,
}: {
  source: string | null;
  onChange: (source: string | null) => void;
  showEmpty?: boolean;
  fetchLike?: typeof fetch;
}) {
  const [sources, setSources] = useState<SourceCount[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetchLike("/api/gallery/sources", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { sources?: SourceCount[] } | null) => {
        if (!cancelled && Array.isArray(payload?.sources))
          setSources(payload.sources);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fetchLike]);
  const offered = offeredGallerySources(sources, source, showEmpty);
  if (offered.length === 0) return null;
  return (
    <label className="gallery-source-switch">
      <span className="gallery-source-switch-label">Source</span>
      <select
        data-testid="gallery-source-switch"
        value={source ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Community</option>
        {offered.map((item) => (
          <option key={item.key} value={item.key}>
            {item.name} · {item.count.toLocaleString()}
          </option>
        ))}
      </select>
    </label>
  );
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
