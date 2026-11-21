import type { DerivedPoint, DerivedRect } from "@icm/model";

/**
 * The circle through three points and the arc on it that starts at `start`,
 * passes `through` and ends at `end`. Angles are degrees in drawing
 * coordinates (y down), so a positive sweep turns clockwise on screen, as an
 * SVG arc with sweep-flag 1 does. Undefined for points on one line.
 */
export interface ArcGeometry {
  center: DerivedPoint;
  radius: number;
  startAngle: number;
  sweepAngle: number;
  /** The arc's own extent, without stroke padding. */
  bounds: DerivedRect;
}

const degrees = (radians: number) => (radians * 180) / Math.PI;
const turn = (angle: number) => ((angle % 360) + 360) % 360;

export function arcThroughPoints(
  start: DerivedPoint,
  through: DerivedPoint,
  end: DerivedPoint,
): ArcGeometry | undefined {
  const d =
    2 *
    (start.x * (through.y - end.y) +
      through.x * (end.y - start.y) +
      end.x * (start.y - through.y));
  if (d === 0) return undefined;
  const square = (point: DerivedPoint) => point.x ** 2 + point.y ** 2;
  const center = {
    x:
      (square(start) * (through.y - end.y) +
        square(through) * (end.y - start.y) +
        square(end) * (start.y - through.y)) /
      d,
    y:
      (square(start) * (end.x - through.x) +
        square(through) * (start.x - end.x) +
        square(end) * (through.x - start.x)) /
      d,
  };
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  const angle = (point: DerivedPoint) =>
    degrees(Math.atan2(point.y - center.y, point.x - center.x));
  const startAngle = turn(angle(start));
  const toThrough = turn(angle(through) - startAngle);
  const toEnd = turn(angle(end) - startAngle);
  const sweepAngle = toThrough < toEnd ? toEnd : toEnd - 360;
  const extremes = [start, end];
  for (let k = 0; k < 4; k += 1) {
    const offset = turn(k * 90 - startAngle);
    const reached =
      sweepAngle > 0 ? offset <= sweepAngle : 360 - offset <= -sweepAngle;
    if (reached || offset === 0)
      extremes.push({
        x: center.x + radius * Math.cos((k * Math.PI) / 2),
        y: center.y + radius * Math.sin((k * Math.PI) / 2),
      });
  }
  const xs = extremes.map((point) => point.x);
  const ys = extremes.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    center,
    radius,
    startAngle,
    sweepAngle,
    bounds: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
  };
}

/** The point on the arc at `fraction` of its sweep from the start. */
export function arcPointAt(arc: ArcGeometry, fraction: number): DerivedPoint {
  const radians =
    ((arc.startAngle + arc.sweepAngle * fraction) * Math.PI) / 180;
  return {
    x: arc.center.x + arc.radius * Math.cos(radians),
    y: arc.center.y + arc.radius * Math.sin(radians),
  };
}

/** SVG path data for the arc, one `A` command. */
export function arcPathData(
  start: DerivedPoint,
  end: DerivedPoint,
  arc: ArcGeometry,
): string {
  const large = Math.abs(arc.sweepAngle) > 180 ? 1 : 0;
  const sweep = arc.sweepAngle > 0 ? 1 : 0;
  const r = Number(arc.radius.toFixed(3));
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} ${sweep} ${end.x} ${end.y}`;
}

/** Distance from a point to the arc's stroke (its nearest point on the arc). */
export function distanceToArc(arc: ArcGeometry, point: DerivedPoint): number {
  const angle = turn(
    degrees(Math.atan2(point.y - arc.center.y, point.x - arc.center.x)) -
      arc.startAngle,
  );
  const onArc =
    arc.sweepAngle > 0
      ? angle <= arc.sweepAngle
      : 360 - angle <= -arc.sweepAngle;
  if (onArc || angle === 0)
    return Math.abs(
      Math.hypot(point.x - arc.center.x, point.y - arc.center.y) - arc.radius,
    );
  const ends = [arcPointAt(arc, 0), arcPointAt(arc, 1)];
  return Math.min(
    ...ends.map((end) => Math.hypot(point.x - end.x, point.y - end.y)),
  );
}
