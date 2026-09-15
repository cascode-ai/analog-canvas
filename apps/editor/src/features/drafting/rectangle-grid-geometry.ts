import { snapGridPoint, type DerivedPoint } from "@icm/model";

/**
 * Anchor a rectangle at its first corner. Persisted centers are integers, so
 * odd annotation pitches need even spans; preview and commit share that rule.
 * The center itself must not be snapped again: an odd count of 10-unit cells
 * correctly puts it on a 5-unit coordinate while both edges stay on the grid.
 */
export function rectangleGridGeometry(
  from: DerivedPoint,
  to: DerivedPoint,
  grid: number,
) {
  const start = snapGridPoint(from, grid);
  const spanGrid = grid % 2 === 0 ? grid : grid * 2;
  const span = snapGridPoint(
    { x: to.x - start.x, y: to.y - start.y },
    spanGrid,
  );
  const end = { x: start.x + span.x, y: start.y + span.y };
  return {
    start,
    end,
    center: { x: start.x + span.x / 2, y: start.y + span.y / 2 },
    width: Math.abs(span.x),
    height: Math.abs(span.y),
  };
}
