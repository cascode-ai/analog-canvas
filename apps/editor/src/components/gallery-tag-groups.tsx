import { galleryTagGroups, galleryTagGroup } from "../gallery-taxonomy";
import { useId, useState } from "react";
import type { GalleryTagOption } from "../gallery-client";
import {
  compareGalleryLabels,
  compareGalleryTagLabels,
  galleryTagLabel,
} from "../gallery-tag-label";
import { galleryOriginTagMark } from "../gallery-origin-tags";
import "./gallery-tag-groups.css";

/** Shared taxonomy selection for the Gallery wall and a widened Editor dock. */
export function GalleryTagGroups({
  tags,
  groupCounts,
  countsLoading = false,
  selected,
  onChange,
}: {
  tags: GalleryTagOption[];
  groupCounts?: Readonly<Record<string, number>>;
  countsLoading?: boolean;
  selected: string[];
  onChange: (tags: string[]) => void;
}) {
  const id = useId();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // A restored link can select a tag that has since disappeared from the
  // catalogue. Keep it visible and removable instead of hiding that filter.
  // Origin tags (Virtuoso) are quick filters, not circuit tags.
  const options = [
    ...tags,
    ...[
      ...new Set([
        ...galleryTagGroups.flatMap(([, tags]) => tags),
        ...selected,
      ]),
    ]
      .filter((tag) => !tags.some((option) => option.tag === tag))
      .map((tag) => ({ tag, count: 0 })),
  ].filter(({ tag }) => !galleryOriginTagMark(tag));
  const groups = [
    ...galleryTagGroups.map(([name]) => name),
    "Custom & legacy",
  ].sort(compareGalleryLabels);
  // New counts on their way keep the last ones, dimmed, until they arrive
  // (#2160); only the first load has none to show.
  const countsUnknown =
    countsLoading &&
    tags.length === 0 &&
    Object.keys(groupCounts ?? {}).length === 0;
  return (
    <div className="gallery-tag-groups" aria-busy={countsLoading}>
      {groups.map((name) => {
        const group = options
          .filter(({ tag }) => galleryTagGroup(tag) === name)
          .sort((a, b) => compareGalleryTagLabels(a.tag, b.tag));
        if (!group.length) return null;
        const circuitCount =
          groupCounts?.[name] ??
          group.reduce((total, option) => total + option.count, 0);
        const groupTags = group.map(({ tag }) => tag);
        const selectedCount = groupTags.filter((tag) =>
          selected.includes(tag),
        ).length;
        const allSelected = selectedCount === groupTags.length;
        const expanded = !(collapsed[name] ?? selectedCount === 0);
        const groupId = `${id}-tag-group-${groups.indexOf(name)}`;
        return (
          <div key={name} className="gallery-tag-group" data-open={expanded}>
            <div className="gallery-tag-group-heading">
              <button
                type="button"
                role="checkbox"
                aria-label={name}
                aria-checked={
                  allSelected ? true : selectedCount ? "mixed" : false
                }
                className="gallery-tag-group-select"
                onClick={() => {
                  onChange(
                    allSelected
                      ? selected.filter((tag) => !groupTags.includes(tag))
                      : [...new Set([...selected, ...groupTags])],
                  );
                  setCollapsed((previous) => ({
                    ...previous,
                    [name]: false,
                  }));
                }}
              >
                <span className="gallery-tag-check" aria-hidden="true">
                  {allSelected ? "✓" : selectedCount ? "−" : ""}
                </span>
                <span className="gallery-tag-group-name" title={name}>
                  {name}
                </span>
                <span className="gallery-sidebar-count" aria-hidden="true">
                  {countsUnknown ? "…" : circuitCount}
                </span>
              </button>
              <button
                type="button"
                className="gallery-tag-group-expand"
                aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`}
                aria-expanded={expanded}
                aria-controls={groupId}
                onClick={() =>
                  setCollapsed((previous) => ({
                    ...previous,
                    [name]: expanded,
                  }))
                }
              >
                <span aria-hidden="true">›</span>
              </button>
            </div>
            <div id={groupId} hidden={!expanded}>
              {group.map(({ tag, count }) => (
                <button
                  key={tag}
                  type="button"
                  className="gallery-sidebar-option gallery-sidebar-tag"
                  data-testid={`gallery-tag-option-${tag.replace(/\s/gu, "-")}`}
                  aria-pressed={selected.includes(tag)}
                  onClick={() =>
                    onChange(
                      selected.includes(tag)
                        ? selected.filter((item) => item !== tag)
                        : [...selected, tag],
                    )
                  }
                >
                  <span className="gallery-tag-check" aria-hidden="true">
                    {selected.includes(tag) ? "✓" : ""}
                  </span>
                  <span
                    className="gallery-tag-name"
                    title={galleryTagLabel(tag)}
                  >
                    {galleryTagLabel(tag)}
                  </span>
                  <span className="gallery-sidebar-count">
                    {countsUnknown ? "…" : count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {!options.length ? (
        <p className="gallery-sidebar-empty">No tags yet.</p>
      ) : null}
    </div>
  );
}
