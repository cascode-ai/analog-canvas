import { createRoutePath, routeEnd } from "../../model/dist/index.js";
import { resolveRouteGeometry } from "../../derived/dist/index.js";

const same = (a, b) => a.x === b.x && a.y === b.y;
const length = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const points = (doc, resolver, r) => {
  const g = resolveRouteGeometry(doc, resolver, r);
  return g?.segments.length
    ? [g.segments[0].from, ...g.segments.map((s) => s.to)]
    : [];
};
function hit(a, b, c, d) {
  const horizontal = a.y === b.y,
    otherHorizontal = c.y === d.y;
  if ((!horizontal && a.x !== b.x) || (!otherHorizontal && c.x !== d.x))
    return null;
  if (horizontal === otherHorizontal) {
    const axis = horizontal ? "x" : "y",
      fixed = horizontal ? "y" : "x";
    if (a[fixed] !== c[fixed]) return null;
    const lo = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
    const hi = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
    if (lo > hi) return null;
    return { ...a, [axis]: b[axis] >= a[axis] ? lo : hi };
  }
  const p = horizontal ? { x: c.x, y: a.y } : { x: a.x, y: c.y };
  return [
    [a, b],
    [c, d],
  ].every(
    ([u, v]) =>
      p.x >= Math.min(u.x, v.x) &&
      p.x <= Math.max(u.x, v.x) &&
      p.y >= Math.min(u.y, v.y) &&
      p.y <= Math.max(u.y, v.y),
  )
    ? p
    : null;
}
function replace(route, start, end, ps, id = route.id) {
  const clean = ps.filter((p, i) => !i || !same(p, ps[i - 1]));
  return {
    ...route,
    ...createRoutePath({
      id,
      netId: route.netId,
      start,
      end,
      bends: clean.slice(1, -1),
      modes: Array(clean.length - 1).fill("manual"),
    }),
  };
}

export function trimBulkRoutes(doc, resolver) {
  const changes = [];
  for (const bulk of [...doc.routes]) {
    if (bulk.presentation !== "bulk-dashed") continue;
    const reverse =
      routeEnd(bulk).kind === "terminal" && routeEnd(bulk).pinName === "B";
    const start = reverse ? routeEnd(bulk) : bulk.start;
    if (start.kind !== "terminal" || start.pinName !== "B") continue;
    const ps = points(doc, resolver, bulk);
    if (reverse) ps.reverse();
    let best = null,
      walk = 0;
    for (let i = 1; i < ps.length; i++) {
      for (const main of doc.routes) {
        if (main.netId !== bulk.netId || main.presentation === "bulk-dashed")
          continue;
        const qs = points(doc, resolver, main);
        for (let j = 1; j < qs.length; j++) {
          const p = hit(ps[i - 1], ps[i], qs[j - 1], qs[j]);
          if (!p) continue;
          const along = walk + length(ps[i - 1], p);
          if (along > 0 && (!best || along < best.along))
            best = { p, along, i, j, main, qs };
        }
      }
      walk += length(ps[i - 1], ps[i]);
    }
    if (!best || best.along >= walk) continue;
    const { p, i, j, main, qs } = best;
    // Never introduce a connection dot on a foreign net.
    if (
      doc.junctions.some((q) => q.netId !== bulk.netId && same(q.position, p))
    )
      continue;
    let endpoint;
    if (same(p, qs[0])) endpoint = main.start;
    else if (same(p, qs.at(-1))) endpoint = routeEnd(main);
    else {
      let junction = doc.junctions.find(
        (q) => q.netId === bulk.netId && same(q.position, p),
      );
      if (!junction) {
        let id = bulk.id + "-join";
        while (doc.junctions.some((q) => q.id === id)) id += "-next";
        junction = { id, netId: bulk.netId, position: p, role: "route-anchor" };
        doc.junctions.push(junction);
      }
      endpoint = { kind: "junction", junctionId: junction.id };
      let id = main.id + "-tail";
      while (doc.routes.some((r) => r.id === id)) id += "-next";
      doc.routes.splice(
        doc.routes.indexOf(main),
        1,
        replace(main, main.start, endpoint, [...qs.slice(0, j), p]),
        replace(main, endpoint, routeEnd(main), [p, ...qs.slice(j)], id),
      );
    }
    doc.routes[doc.routes.indexOf(bulk)] = replace(bulk, start, endpoint, [
      ...ps.slice(0, i),
      p,
    ]);
    doc.revision++;
    changes.push({
      routeId: bulk.id,
      mainRouteId: main.id,
      contact: p,
      removedLength: walk - best.along,
    });
  }
  return changes;
}
