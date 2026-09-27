/** Screen-space selection: distance, not SVG paint order, chooses a terminal.
 * Nearly coincident candidates are deliberately ambiguous rather than silently
 * attaching the current probe to the wrong device. */
export function nearestTerminal<T>(
  candidates: readonly T[],
  point: { x: number; y: number },
  position: (candidate: T) => { x: number; y: number },
  radius: number,
): T | null {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      distance: Math.hypot(
        position(candidate).x - point.x,
        position(candidate).y - point.y,
      ),
    }))
    .filter((item) => item.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
  if (
    !ranked[0] ||
    (ranked[1] && ranked[1].distance - ranked[0].distance < 0.75)
  )
    return null;
  return ranked[0].candidate;
}
