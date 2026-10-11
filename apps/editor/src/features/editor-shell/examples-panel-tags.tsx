import "./examples-panel-tags.css";
import { useEffect, useState } from "react";
import { GalleryTagGroups } from "../../components/gallery-tag-groups";
import { type GalleryTagSummary } from "../../gallery-client";
import type { createGalleryPanelLoader } from "./gallery-panel-loader";

/** Load the taxonomy only when the Gallery is opened, outside editor startup. */
export function ExamplesPanelTags({
  loader,
  open,
  refreshSignal,
  selected,
  onChange,
}: {
  loader: ReturnType<typeof createGalleryPanelLoader>;
  open: boolean;
  refreshSignal: number;
  selected: string[];
  onChange: (tags: string[]) => void;
}) {
  const [summary, setSummary] = useState<GalleryTagSummary>({
    tags: [],
    groups: [],
  });
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void loader.tags().then((next) => {
      if (cancelled) return;
      setSummary(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, loader, refreshSignal]);
  return (
    <GalleryTagGroups
      tags={summary.tags}
      groupCounts={Object.fromEntries(
        summary.groups.map((group) => [group.group, group.count]),
      )}
      countsLoading={loading}
      selected={selected}
      onChange={onChange}
    />
  );
}
