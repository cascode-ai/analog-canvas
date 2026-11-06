import {
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";

/**
 * One record on the Library's working surface. Click or Enter places it and
 * dragging it onto the canvas places it there; its actions appear only where
 * the pointer or focus is, and its large preview beside the panel.
 */
export function ComponentLibraryRow({
  entry,
  artwork,
  busy,
  reading = false,
  tabbable,
  variant = false,
  authorImplied = false,
  count = 0,
  expanded = false,
  onPlace,
  onDragStart,
  onToggleGroup,
  onMenu,
  onPreview,
  onPreviewEnd,
}: {
  entry: ComponentLibrarySummary;
  artwork: ReactNode;
  busy: boolean;
  reading?: boolean;
  tabbable: boolean;
  /** A record listed under its group's row, told apart by date and Pins. */
  variant?: boolean;
  /** The list's author goes without saying, so rows say when they were published. */
  authorImplied?: boolean;
  count?: number;
  expanded?: boolean;
  onPlace(): void;
  onDragStart(event: ReactPointerEvent<HTMLButtonElement>): void;
  onToggleGroup?(): void;
  onMenu(anchor: { x: number; y: number }): void;
  onPreview(row: HTMLElement): void;
  onPreviewEnd(): void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const invalid = entry.capability === "needs-repair";
  const deleted = entry.status === "deleted";
  const unavailable = invalid || deleted;
  // Records of one name are often published minutes apart.
  const published = entry.createdAt.slice(0, 16).replace("T", " ");
  return (
    <div
      ref={row}
      className="component-row"
      data-testid={invalid ? "rejected-user-component" : undefined}
      data-component-id={entry.id}
      data-variant={variant || undefined}
      onPointerEnter={() => onPreview(row.current!)}
      onPointerLeave={onPreviewEnd}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <button
        type="button"
        className="component-row-main"
        aria-disabled={unavailable || busy}
        aria-label={
          invalid
            ? `${entry.name} needs repair`
            : `Place ${entry.name}${variant ? ` from ${published}` : ""}`
        }
        aria-expanded={count > 0 ? expanded : undefined}
        tabIndex={tabbable ? 0 : -1}
        onKeyDown={(event) => {
          // Arrows open and close a name's other records, as in a tree.
          if (count && event.key === (expanded ? "ArrowLeft" : "ArrowRight")) {
            event.preventDefault();
            onToggleGroup?.();
          }
        }}
        onFocus={() => onPreview(row.current!)}
        onBlur={onPreviewEnd}
        onPointerDown={(event) => {
          if (!unavailable) onDragStart(event);
        }}
        onClick={(event) => {
          // Rotation and the other placement keys belong to the canvas now.
          event.currentTarget.blur();
          if (!unavailable && !busy) onPlace();
        }}
      >
        {artwork}
        <span className="component-row-text">
          <span className="component-row-name">{entry.name}</span>
          <small>
            {reading
              ? "Reading component…"
              : invalid
                ? `Needs repair · ${entry.author.trim() || "Unknown author"}`
                : variant
                  ? `${published} · ${entry.pinCount} pins`
                  : authorImplied
                    ? `${published} · r${entry.revision}`
                    : entry.author.trim() || "Unknown author"}
          </small>
        </span>
      </button>
      {entry.status === "official" ? (
        <span className="component-row-mark">Official</span>
      ) : entry.capability === "circuit" ? (
        <span className="component-row-mark">Circuit</span>
      ) : null}
      {count > 0 ? (
        <button
          type="button"
          tabIndex={-1}
          className="hierarchy-uses"
          aria-expanded={expanded}
          aria-label={`${count + 1} records of ${entry.name}`}
          onClick={onToggleGroup}
        >
          ×{count + 1}
        </button>
      ) : null}
      <button
        type="button"
        tabIndex={-1}
        className="component-row-actions"
        aria-label={`Actions for ${entry.name}`}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onMenu({ x: box.left, y: box.bottom });
        }}
      >
        ⋯
      </button>
    </div>
  );
}
