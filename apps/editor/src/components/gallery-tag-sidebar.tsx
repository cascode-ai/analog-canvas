import taxonomy from "../../../../config/gallery-taxonomy.json";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { GalleryTagOption } from "../gallery-client";
import {
  compareGalleryLabels,
  compareGalleryTagLabels,
  galleryTagLabel,
} from "../gallery-tag-label";

const WIDTH_KEY = "icm.gallery.sidebarWidth";
const MIN_WIDTH = 180;
const MAX_WIDTH = 420;

function readSidebarWidth(): number | null {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(saved) && saved >= MIN_WIDTH
      ? Math.min(saved, MAX_WIDTH)
      : null;
  } catch {
    return null;
  }
}

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

export function GalleryTagSidebar({
  tags,
  groupCounts,
  selected,
  onChange,
  search,
  onSearchChange,
  quickFilters,
  adminTools,
}: {
  tags: GalleryTagOption[];
  groupCounts?: Readonly<Record<string, number>>;
  selected: string[];
  onChange: (tags: string[]) => void;
  search: string;
  onSearchChange: (search: string) => void;
  quickFilters: ReactNode;
  adminTools?: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const slotRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    width: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preferredWidth, setPreferredWidth] = useState(readSidebarWidth);
  const [containerWidth, setContainerWidth] = useState(1024);
  useEffect(() => {
    const container = slotRef.current?.parentElement;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  // Preserve the user's preference when the window temporarily becomes narrow.
  const maxWidth = Math.max(
    MIN_WIDTH,
    Math.min(MAX_WIDTH, Math.floor(containerWidth * 0.45)),
  );
  const width = Math.max(
    MIN_WIDTH,
    Math.min(maxWidth, preferredWidth ?? (containerWidth <= 900 ? 204 : 238)),
  );
  const resize = (next: number) => {
    const bounded = Math.max(MIN_WIDTH, Math.min(maxWidth, Math.round(next)));
    setPreferredWidth(bounded);
    try {
      localStorage.setItem(WIDTH_KEY, String(bounded));
    } catch {
      // Resizing remains available when browser storage is disabled.
    }
  };
  const finishDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };
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
    <div
      ref={slotRef}
      className="gallery-sidebar-slot"
      style={{ "--gallery-sidebar-width": `${width}px` } as CSSProperties}
    >
      <div className="gallery-sidebar-search">
        <input
          className="gallery-search-input"
          type="search"
          value={search}
          placeholder="Name, author, tag…"
          aria-label="Search circuits"
          data-testid="gallery-search"
          onChange={(event) => onSearchChange(event.currentTarget.value)}
        />
      </div>
      <button
        type="button"
        className="gallery-sidebar-toggle"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-expanded={mobileOpen}
        aria-controls="gallery-tag-sidebar"
      >
        Search & filters
        {selected.length ? ` · ${selected.length} selected` : ""}
        <span aria-hidden="true">{mobileOpen ? "−" : "+"}</span>
      </button>
      <aside
        id="gallery-tag-sidebar"
        className="gallery-tag-sidebar"
        data-testid="gallery-tag-sidebar"
        data-open={mobileOpen}
        aria-label="Gallery filters"
      >
        <div className="gallery-sidebar-quick">{quickFilters}</div>
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
        <div className="gallery-tag-groups">
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
            const groupId = `gallery-tag-group-${groups.indexOf(name)}`;
            return (
              <div
                key={name}
                className="gallery-tag-group"
                data-open={expanded}
              >
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
                      {circuitCount}
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
                      <span className="gallery-sidebar-count">{count}</span>
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
        {adminTools ? (
          <div className="gallery-sidebar-admin">{adminTools}</div>
        ) : null}
      </aside>
      <div
        className="gallery-sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Gallery filters"
        aria-controls="gallery-tag-sidebar"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize"
        data-dragging={dragging}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            width,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag?.pointerId === event.pointerId)
            resize(drag.width + event.clientX - drag.x);
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          finishDrag();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 32 : 8;
          const next = {
            ArrowLeft: width - step,
            ArrowRight: width + step,
            Home: MIN_WIDTH,
            End: maxWidth,
          }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          resize(next);
        }}
      />
    </div>
  );
}
