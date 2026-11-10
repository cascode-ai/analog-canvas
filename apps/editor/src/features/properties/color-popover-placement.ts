/** A screen rectangle in CSS pixels, as getBoundingClientRect gives it. */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where a swatch's color settings stand (#2181): under the swatch, right
 * edges aligned, else above it, and always inside the viewport's margin,
 * even when the window has shrunk since they opened. Null when the swatch
 * is no longer in `visible` (the part of the viewport its scrolling panels
 * show): settings beside nothing are closed, not left open off screen.
 */
export function colorPopoverPlacement({
  anchor,
  size,
  viewport,
  visible = { left: 0, top: 0, right: viewport.width, bottom: viewport.height },
  gap = 6,
  margin = 8,
}: {
  anchor: ScreenBox;
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  visible?: ScreenBox;
  gap?: number;
  margin?: number;
}): { left: number; top: number } | null {
  if (
    anchor.bottom <= visible.top ||
    anchor.top >= visible.bottom ||
    anchor.right <= visible.left ||
    anchor.left >= visible.right
  )
    return null;
  const within = (value: number, extent: number, span: number) =>
    Math.max(margin, Math.min(value, span - extent - margin));
  const below = anchor.bottom + gap;
  const above = anchor.top - size.height - gap;
  const top =
    below + size.height <= viewport.height - margin
      ? below
      : above >= margin
        ? above
        : within(below, size.height, viewport.height);
  return {
    left: within(anchor.right - size.width, size.width, viewport.width),
    top,
  };
}
