import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * True masonry (Pinterest-style) layout: equal-width columns derived from
 * the container, every item keeping its natural height, each item placed
 * greedily into the currently shortest column so rows read left-to-right
 * and column bottoms stay balanced. The layout is imperative (widths,
 * transforms, and the container height are written straight to the DOM),
 * so image loads and window resizes re-run it through one ResizeObserver
 * without React re-renders; the first pass runs before paint.
 */

export function masonryColumnCount(
  containerWidth: number,
  minColumnWidth: number,
  gap: number,
): number {
  return Math.max(
    1,
    Math.floor((containerWidth + gap) / (minColumnWidth + gap)),
  );
}

/** Index of the shortest column; the leftmost wins ties (reading order). */
export function shortestColumn(heights: readonly number[]): number {
  let column = 0;
  for (let index = 1; index < heights.length; index += 1) {
    if (heights[index]! < heights[column]! - 0.5) column = index;
  }
  return column;
}

/** Collapse any number of observer notifications into one animation frame. */
export function createFrameCoalescer(
  callback: () => void,
  requestFrame: (
    callback: FrameRequestCallback,
  ) => number = requestAnimationFrame,
  cancelFrame: (handle: number) => void = cancelAnimationFrame,
): { schedule: () => void; cancel: () => void } {
  let frame: number | null = null;
  return {
    schedule() {
      if (frame !== null) return;
      frame = requestFrame(() => {
        frame = null;
        callback();
      });
    },
    cancel() {
      if (frame === null) return;
      cancelFrame(frame);
      frame = null;
    },
  };
}

export interface MasonryItem {
  key: string;
  node: ReactNode;
}

export interface MasonryProps {
  items: readonly MasonryItem[];
  minColumnWidth?: number;
  gap?: number;
  "aria-label"?: string;
}

export function Masonry({
  items,
  minColumnWidth = 250,
  gap = 14,
  "aria-label": ariaLabel,
}: MasonryProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const relayout = () => {
      const tiles = [...container.children].filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      );
      const width = container.clientWidth;
      if (width <= 0) return;
      const count = masonryColumnCount(width, minColumnWidth, gap);
      const columnWidth = (width - gap * (count - 1)) / count;
      const heights = new Array<number>(count).fill(0);
      const widthStyle = `${columnWidth}px`;
      // Write every width before measuring any height. This produces one
      // layout flush instead of alternating N writes with N reads.
      for (const tile of tiles) {
        if (tile.style.width !== widthStyle) tile.style.width = widthStyle;
      }
      const tileHeights = tiles.map((tile) => tile.offsetHeight);
      const placements = tileHeights.map((height) => {
        const column = shortestColumn(heights);
        const transform = `translate(${column * (columnWidth + gap)}px, ${heights[column]}px)`;
        heights[column] = heights[column]! + height + gap;
        return transform;
      });
      for (const [index, tile] of tiles.entries()) {
        const transform = placements[index]!;
        if (tile.style.transform !== transform)
          tile.style.transform = transform;
      }
      const heightStyle = `${Math.max(0, Math.max(...heights) - gap)}px`;
      if (container.style.height !== heightStyle) {
        container.style.height = heightStyle;
      }
    };
    const coalescer = createFrameCoalescer(relayout);
    const observer = new ResizeObserver(coalescer.schedule);
    observer.observe(container);
    for (const child of container.children) observer.observe(child);
    relayout();
    return () => {
      observer.disconnect();
      coalescer.cancel();
    };
  }, [items, minColumnWidth, gap]);

  return (
    <div
      ref={containerRef}
      className="masonry"
      {...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel })}
    >
      {items.map((item) => (
        <div key={item.key} className="masonry-item">
          {item.node}
        </div>
      ))}
    </div>
  );
}
