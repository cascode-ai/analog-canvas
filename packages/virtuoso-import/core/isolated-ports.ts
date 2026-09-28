import type { Snapshot } from "./contracts.js";

type Point = [number, number];
const point = (v: unknown): v is Point =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((n) => typeof n === "number" && Number.isFinite(n));
function onSegment(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = Math.hypot(dx, dy);
  if (length < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]) < 1e-6;
  return (
    Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / length < 1e-6 &&
    (p[0] - a[0]) * dx + (p[1] - a[1]) * dy >= -1e-6 &&
    (p[0] - b[0]) * dx + (p[1] - b[1]) * dy <= 1e-6
  );
}

// A name shared with a remote wire is not a geometric connection at this port.
export function isolatedPortInstances(source: Snapshot): Set<string> {
  const removed = new Set<string>();
  for (const inst of source.instances) {
    if (
      inst.library !== "basic" ||
      !["ipin", "opin", "iopin"].includes(inst.cell)
    )
      continue;
    const formals = source.terminals.filter((t) =>
      t.pins.some((p) => p.instanceId === inst.id),
    );
    if (!formals.length) continue;
    let connected = false,
      unknown = false;
    for (const formal of formals)
      for (const pin of formal.pins.filter((p) => p.instanceId === inst.id)) {
        const p = pin.worldCenter;
        for (const shape of source.shapes.filter(
          (s) => s.netId === formal.netId,
        )) {
          if (["label", "textDisplay"].includes(shape.type)) continue;
          if (
            !["line", "path"].includes(shape.type) ||
            !Array.isArray(shape.points) ||
            !shape.points.every(point)
          ) {
            unknown = true;
            continue;
          }
          const ps = shape.points as Point[];
          for (let n = 1; n < ps.length; n++)
            if (onSegment(p, ps[n - 1]!, ps[n]!)) connected = true;
        }
        if (
          source.instances.some(
            (other) =>
              other.id !== inst.id &&
              other.terminals.some(
                (t) =>
                  t.netId === formal.netId &&
                  t.pins.some(
                    (q) =>
                      Math.hypot(
                        q.worldCenter[0] - p[0],
                        q.worldCenter[1] - p[1],
                      ) < 1e-6,
                  ),
              ),
          )
        )
          connected = true;
      }
    // Preserve uncertain geometry rather than silently removing a connected port.
    if (!connected && !unknown) removed.add(inst.id);
  }
  return removed;
}
