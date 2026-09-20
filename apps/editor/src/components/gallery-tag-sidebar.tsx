import { useState, type ReactNode } from "react";
import type { GalleryTagOption } from "../gallery-client";

const TAG_GROUPS = [
  [
    "Amplifiers & filters",
    "amplifier,ota,op,lna,buffer,class ab,differential,common source,gain-boost,cmfb,filter,equalizer",
  ],
  ["Data converters", "adc,dac,comparator,tdc,vtc,v-i,mixed-signal"],
  [
    "Timing & logic",
    "oscillator,osc,vco,pll,cdr,frequency divider,cml divider,logic,latch,d-latch,tspc,timing",
  ],
  [
    "Power & bias",
    "power,power management,bias,current mirror,bandgap,bgr,ldo,low-dropout,dropout,linear regulator,regulator,dc-dc,dcdc,charge pump,rectifier,voltage multiplier",
  ],
  [
    "Switching & sampling",
    "switch,bootstrap,cts,bootstrapped cts,charge transfer switch,sample and hold,sha,switch capacitor",
  ],
] as const;

/** Group presentation only: authored tags and shareable filter values stay intact. */
function tagGroup(tag: string): string {
  return (
    TAG_GROUPS.find(([, tags]) =>
      tags.split(",").includes(tag.toLowerCase()),
    )?.[0] ?? "Devices & other"
  );
}

export function GalleryTagSidebar({
  tags,
  selected,
  onChange,
  quickFilters,
}: {
  tags: GalleryTagOption[];
  selected: string[];
  onChange: (tags: string[]) => void;
  quickFilters: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // A restored link can select a tag that has since disappeared from the
  // catalogue. Keep it visible and removable instead of hiding that filter.
  const options = [
    ...tags,
    ...selected
      .filter((tag) => !tags.some((option) => option.tag === tag))
      .map((tag) => ({ tag, count: 0 })),
  ];
  const visible = options.filter(
    ({ tag }) =>
      selected.includes(tag) ||
      tag.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const groups = [...TAG_GROUPS.map(([name]) => name), "Devices & other"];
  const everyTagSelected =
    tags.length > 0 && tags.every(({ tag }) => selected.includes(tag));
  return (
    <div className="gallery-sidebar-slot">
      <button
        type="button"
        className="gallery-sidebar-toggle"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-expanded={mobileOpen}
        aria-controls="gallery-tag-sidebar"
      >
        Filters & tags{selected.length ? ` · ${selected.length} selected` : ""}
        <span aria-hidden="true">{mobileOpen ? "−" : "+"}</span>
      </button>
      <aside
        id="gallery-tag-sidebar"
        className="gallery-tag-sidebar"
        data-testid="gallery-tag-sidebar"
        data-open={mobileOpen}
        aria-label="Gallery filters"
      >
        <div className="gallery-sidebar-quick">
          <h2>Browse</h2>
          <button
            type="button"
            className="gallery-sidebar-option"
            aria-pressed={selected.length === 0}
            onClick={() => onChange([])}
          >
            All tags
          </button>
          {quickFilters}
          {tags.length ? (
            <button
              type="button"
              className="gallery-sidebar-option"
              data-testid="gallery-tags-any"
              aria-pressed={everyTagSelected}
              onClick={() =>
                onChange(everyTagSelected ? [] : tags.map(({ tag }) => tag))
              }
            >
              Tagged circuits
            </button>
          ) : null}
        </div>
        <div className="gallery-sidebar-heading">
          <h2>Tags</h2>
          {selected.length ? (
            <button
              type="button"
              className="gallery-sidebar-clear"
              data-testid="gallery-tags-clear"
              onClick={() => onChange([])}
            >
              Clear {selected.length} selected
            </button>
          ) : null}
        </div>
        <input
          className="gallery-tag-search"
          type="search"
          value={query}
          placeholder="Find a tag…"
          aria-label="Find a tag"
          data-testid="gallery-tag-search"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <div className="gallery-tag-groups">
          {groups.map((name) => {
            const group = visible
              .filter(({ tag }) => tagGroup(tag) === name)
              .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
            if (!group.length) return null;
            return (
              <details
                key={name}
                className="gallery-tag-group"
                open={query.trim().length > 0 || !collapsed[name]}
                onToggle={(event) => {
                  if (query.trim()) return;
                  const closed = !event.currentTarget.open;
                  setCollapsed((previous) =>
                    previous[name] === closed
                      ? previous
                      : { ...previous, [name]: closed },
                  );
                }}
              >
                <summary>
                  {name}
                  <span>{group.length}</span>
                </summary>
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
                    <span className="gallery-tag-name">{tag}</span>
                    <span className="gallery-sidebar-count">{count}</span>
                  </button>
                ))}
              </details>
            );
          })}
          {!visible.length ? (
            <p className="gallery-sidebar-empty">
              {query ? "No matching tags." : "No tags yet."}
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
