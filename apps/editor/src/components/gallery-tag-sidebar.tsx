import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { GalleryTagOption } from "../gallery-client";
import { GalleryTagGroups } from "./gallery-tag-groups";

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

export function GalleryTagSidebar({
  tags,
  groupCounts,
  countsLoading = false,
  selected,
  onChange,
  search,
  onSearchChange,
  quickFilters,
  adminTools,
}: {
  tags: GalleryTagOption[];
  groupCounts?: Readonly<Record<string, number>>;
  countsLoading?: boolean;
  selected: string[];
  onChange: (tags: string[]) => void;
  search: string;
  onSearchChange: (search: string) => void;
  quickFilters: ReactNode;
  adminTools?: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
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
        <GalleryTagGroups
          tags={tags}
          {...(groupCounts ? { groupCounts } : {})}
          countsLoading={countsLoading}
          selected={selected}
          onChange={onChange}
        />
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
