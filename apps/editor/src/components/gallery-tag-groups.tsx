import taxonomy from "../../../../config/gallery-taxonomy.json";
import { useId, useState } from "react";
import type { GalleryTagOption } from "../gallery-client";
import {
  compareGalleryLabels,
  compareGalleryTagLabels,
  galleryTagLabel,
} from "../gallery-tag-label";
import "./gallery-tag-groups.css";

const TAG_GROUPS = Object.entries(taxonomy.tagsByGroup);
const TAG_ALIASES: Record<string, string> = {
  op: "operational amplifier",
  osc: "oscillator",
  bgr: "bandgap",
  dcdc: "dc-dc",
  "d-latch": "d latch",
  levelshifter: "level shifter",
  sha: "sample and hold",
  "switch capacitor": "switched capacitor",
  cts: "charge transfer switch",
  "v-i": "voltage to current",
  vtc: "voltage to time",
  tdc: "time to digital",
  "gain-boost": "gain boosting",
  "low-dropout": "ldo",
  dropout: "ldo",
  "linear regulator": "regulator",
  "bootstrapped cts": "charge transfer switch",
};

function tagGroup(tag: string): string {
  const key = TAG_ALIASES[tag.toLowerCase()] ?? tag.toLowerCase();
  return (
    TAG_GROUPS.find(([, values]) => values.includes(key))?.[0] ??
    "Custom & legacy"
  );
}

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
  const options = [
    ...tags,
    ...[
      ...new Set([...Object.values(taxonomy.tagsByGroup).flat(), ...selected]),
    ]
      .filter((tag) => !tags.some((option) => option.tag === tag))
      .map((tag) => ({ tag, count: 0 })),
  ];
  const groups = [...TAG_GROUPS.map(([name]) => name), "Custom & legacy"].sort(
    compareGalleryLabels,
  );
  return (
    <div className="gallery-tag-groups" aria-busy={countsLoading}>
      {groups.map((name) => {
        const group = options
          .filter(({ tag }) => tagGroup(tag) === name)
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
                <span className="gallery-tag-group-name">{name}</span>
                <span className="gallery-sidebar-count" aria-hidden="true">
                  {countsLoading ? "…" : circuitCount}
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
                  <span className="gallery-tag-name">
                    {galleryTagLabel(tag)}
                  </span>
                  <span className="gallery-sidebar-count">
                    {countsLoading ? "…" : count}
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
