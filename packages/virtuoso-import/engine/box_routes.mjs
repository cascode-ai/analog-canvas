import {
  createRoutePath,
  routeEnd,
  transformPoint,
} from "../../model/dist/index.js";
import {
  resolveEndpointConnection,
  resolveRouteGeometry,
  visibleSymbolInkBounds,
} from "../../derived/dist/index.js";
import { segmentIntersectsRect } from "./segment_geometry.mjs";

const same = (a, b) => a.x === b.x && a.y === b.y;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const terminal = (e) => e.kind === "terminal";
const junction = (e) => e.kind === "junction";
function clean(points) {
  const out = [];
  for (const p of points) {
    if (out.length && same(out.at(-1), p)) continue;
    while (out.length > 1) {
      const a = out.at(-2),
        b = out.at(-1);
      if (
        (a.x === b.x && b.x === p.x && (b.y - a.y) * (p.y - b.y) >= 0) ||
        (a.y === b.y && b.y === p.y && (b.x - a.x) * (p.x - b.x) >= 0)
      )
        out.pop();
      else break;
    }
    out.push(p);
  }
  return out;
}

function incidentRoutes(doc, j) {
  return doc.routes.filter((r) =>
    [r.start, routeEnd(r)].some((e) => junction(e) && e.junctionId === j.id),
  );
}

function routePoints(doc, resolver, route) {
  const geometry = resolveRouteGeometry(doc, resolver, route);
  return geometry?.segments.length
    ? [geometry.segments[0].from, ...geometry.segments.map((s) => s.to)]
    : null;
}

function clearLocalPath(doc, obstacles, route, j, points) {
  const peer = [route.start, routeEnd(route)].find((e) => terminal(e));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (same(a, b) || (a.x !== b.x && a.y !== b.y)) return false;
    if (
      obstacles.some((o) => {
        if (
          o.id === peer?.instanceId &&
          ((i === 1 && terminal(route.start)) ||
            (i === points.length - 1 && terminal(routeEnd(route))))
        )
          return false;
        return segmentIntersectsRect(a, b, o);
      })
    )
      return false;
    if (
      doc.junctions.some(
        (other) =>
          other.id !== j.id &&
          segmentIntersectsRect(a, b, {
            ...other.position,
            width: 0,
            height: 0,
          }),
      )
    )
      return false;
  }
  return true;
}

function replaceLocalRoutes(doc, j, proposals) {
  j.position = proposals.position;
  for (const { route, points } of proposals.routes) {
    const end = routeEnd(route);
    route.legs = createRoutePath({
      id: route.id,
      netId: route.netId,
      start: route.start,
      end,
      bends: points.slice(1, -1),
      modes: Array(points.length - 1).fill("manual"),
    }).legs;
  }
  doc.revision++;
}

function alignOpposedThreePinJunctions(doc, resolver, obstacles) {
  const changes = [];
  for (const j of doc.junctions) {
    const routes = incidentRoutes(doc, j);
    if (
      routes.length !== 3 ||
      routes.some(
        (r) => r.netId !== j.netId || r.presentation === "bulk-dashed",
      )
    )
      continue;
    const peers = routes.map((route) => {
      const peer = [route.start, routeEnd(route)].find((e) => terminal(e));
      const connection = peer && resolveEndpointConnection(doc, resolver, peer);
      const points = routePoints(doc, resolver, route);
      return peer && connection?.outward && points?.length === 2
        ? { route, peer, connection }
        : null;
    });
    if (peers.some((p) => !p)) continue;
    for (let middle = 0; middle < 3; middle++) {
      const center = peers[middle],
        sides = peers.filter((_, i) => i !== middle);
      const normal = sides[0].connection.outward;
      if (
        !same(normal, sides[1].connection.outward) ||
        !same(center.connection.outward, { x: -normal.x, y: -normal.y }) ||
        Math.abs(normal.x) + Math.abs(normal.y) !== 1
      )
        continue;
      const vertical = normal.y !== 0,
        along = (p) => (vertical ? p.y : p.x),
        across = (p) => (vertical ? p.x : p.y);
      const [a, b] = sides.map((p) => p.connection.contactPoint),
        c = center.connection.contactPoint;
      if (
        along(a) !== along(j.position) ||
        along(b) !== along(j.position) ||
        across(c) !== across(j.position) ||
        (across(a) - across(j.position)) * (across(b) - across(j.position)) >= 0
      )
        continue;
      const direction = vertical ? normal.y : normal.x;
      const gap = (along(c) - along(j.position)) * direction;
      if (gap < 3 * doc.presentation.grid) continue;
      const shift = Math.min(
        2 * doc.presentation.grid,
        gap - doc.presentation.grid,
      );
      const before = { ...j.position };
      const position = {
        x: j.position.x + normal.x * shift,
        y: j.position.y + normal.y * shift,
      };
      if (
        doc.junctions.some(
          (other) => other.id !== j.id && same(other.position, position),
        )
      )
        continue;
      const proposed = peers.map(({ route, connection }) => {
        const p = connection.contactPoint;
        const stub = vertical
          ? { x: p.x, y: position.y }
          : { x: position.x, y: p.y };
        const fromPin = clean([p, stub, position]);
        const startsAtJ =
          junction(route.start) && route.start.junctionId === j.id;
        return { route, points: startsAtJ ? fromPin.reverse() : fromPin };
      });
      if (
        proposed.some(
          ({ route, points }) =>
            !clearLocalPath(doc, obstacles, route, j, points),
        )
      )
        continue;
      replaceLocalRoutes(doc, j, { position, routes: proposed });
      changes.push({ junctionId: j.id, before, after: position });
      break;
    }
  }
  return changes;
}

function moveSharedPowerBranches(doc, resolver, boxes, obstacles) {
  const changes = [];
  for (const junction of doc.junctions) {
    const branches = doc.routes.filter((r) =>
      [r.start, routeEnd(r)].some(
        (e) => e.kind === "junction" && e.junctionId === junction.id,
      ),
    );
    if (branches.length < 3 || branches.some((r) => r.netId !== junction.netId))
      continue;
    const peers = branches.map((r) =>
      r.start.kind === "junction" && r.start.junctionId === junction.id
        ? routeEnd(r)
        : r.start,
    );
    // Keep inter-block nets and multi-junction trunks fixed. This is a local fan-in only.
    if (peers.some((e) => e.kind !== "terminal")) continue;
    const pins = peers.filter((e) => boxes.has(e.instanceId));
    const markers = peers.filter((e) => !boxes.has(e.instanceId));
    if (
      pins.length < 2 ||
      new Set(pins.map((e) => e.instanceId)).size !== 1 ||
      markers.length !== 1
    )
      continue;
    const marker = doc.instances.find((i) => i.id === markers[0].instanceId);
    if (!marker || !["ground", "vdd-port"].includes(marker.symbolId)) continue;
    if (
      doc.routes.filter((r) =>
        [r.start, routeEnd(r)].some(
          (e) => e.kind === "terminal" && e.instanceId === marker.id,
        ),
      ).length !== 1
    )
      continue;
    const connections = pins.map((e) =>
      resolveEndpointConnection(doc, resolver, e),
    );
    const normal = connections[0]?.outward;
    if (
      !normal ||
      connections.some((c) => !c?.outward || !same(c.outward, normal))
    )
      continue;
    const power = resolveEndpointConnection(doc, resolver, markers[0]);
    if (
      !power?.outward ||
      power.outward.x !== -normal.x ||
      power.outward.y !== -normal.y
    )
      continue;
    const dot = (p) => p.x * normal.x + p.y * normal.y;
    if (dot(power.contactPoint) <= dot(junction.position)) continue;
    const edge = Math.max(...connections.map((c) => dot(c.contactPoint)));
    if (dot(junction.position) > edge) continue;
    const grid = doc.presentation.grid;
    const shift =
      Math.ceil((edge + Math.max(20, grid) - dot(junction.position)) / grid) *
      grid;
    const delta = { x: normal.x * shift, y: normal.y * shift };
    const move = (p) => ({ x: p.x + delta.x, y: p.y + delta.y });
    const next = move(junction.position),
      markerBounds = obstacles.find((b) => b.id === marker.id);
    if (!markerBounds) continue;
    const movedBounds = { ...markerBounds, ...move(markerBounds) };
    if (
      obstacles.some(
        (b) =>
          b.id !== marker.id &&
          movedBounds.x < b.x + b.width &&
          movedBounds.x + movedBounds.width > b.x &&
          movedBounds.y < b.y + b.height &&
          movedBounds.y + movedBounds.height > b.y,
      )
    )
      continue;
    if (
      doc.junctions.some((j) => j.id !== junction.id && same(j.position, next))
    )
      continue;
    // Verify the proposed branches before moving anything; preserve all endpoint identities.
    const proposals = branches.map((r, index) => {
      const c = resolveEndpointConnection(doc, resolver, peers[index]);
      const point =
        peers[index].instanceId === marker.id
          ? move(c.contactPoint)
          : c.contactPoint;
      return {
        route: r,
        points: clean([
          point,
          normal.x ? { x: next.x, y: point.y } : { x: point.x, y: next.y },
          next,
        ]),
        peer: peers[index],
      };
    });
    if (
      proposals.some(({ points }) =>
        points.slice(1).some(
          (q, i) =>
            obstacles.some(
              (b) =>
                b.id !== marker.id &&
                b.id !== pins[0].instanceId &&
                segmentIntersectsRect(points[i], q, b),
            ) ||
            doc.junctions.some(
              (j) =>
                j.netId !== junction.netId &&
                segmentIntersectsRect(points[i], q, {
                  ...j.position,
                  width: 0,
                  height: 0,
                }),
            ),
        ),
      )
    )
      continue;
    const old = { ...junction.position };
    junction.position = next;
    marker.placement.position = move(marker.placement.position);
    Object.assign(markerBounds, movedBounds);
    for (const { route, points } of proposals) {
      if (route.start.kind === "junction") points.reverse();
      route.legs = createRoutePath({
        id: route.id,
        netId: route.netId,
        start: route.start,
        end: routeEnd(route),
        bends: points.slice(1, -1),
        modes: Array(points.length - 1).fill("manual"),
      }).legs;
    }
    for (const a of doc.annotations)
      if (
        a.netId === junction.netId &&
        a.anchor.kind === "free" &&
        distance(a.anchor.position, old) <= 80
      )
        a.anchor.position = move(a.anchor.position);
    changes.push({
      junctionId: junction.id,
      markerId: marker.id,
      before: old,
      after: next,
      routeIds: branches.map((r) => r.id),
    });
    doc.revision++;
  }
  return changes;
}
export function refineBoxRoutes(doc, resolver, { stubLength = 40 } = {}) {
  if (!Number.isFinite(stubLength) || stubLength <= 0)
    throw Error("Invalid box stub length");
  const boxes = new Set(
    doc.instances
      .filter((i) => resolver.resolve(i.symbolId)?.definition.hierarchicalBlock)
      .map((i) => i.id),
  );
  const obstacles = doc.instances
    .map((i) => {
      const resolved = resolver.resolve(i.symbolId, i.symbolVariantId);
      if (!resolved) return null;
      let b = visibleSymbolInkBounds(resolved);
      if (boxes.has(i.id)) {
        const v = resolved.definition.viewBox;
        b = {
          x: v.x - 1,
          y: v.y - 1,
          width: v.width + 2,
          height: v.height + 2,
        };
      }
      const points = [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x, b.y + b.height],
        [b.x + b.width, b.y + b.height],
      ].map(([x, y]) =>
        transformPoint({ x, y }, i.placement.position, i.placement),
      );
      const x = Math.min(...points.map((p) => p.x)),
        y = Math.min(...points.map((p) => p.y));
      return {
        id: i.id,
        x: x + 0.1,
        y: y + 0.1,
        width: Math.max(...points.map((p) => p.x)) - x - 0.2,
        height: Math.max(...points.map((p) => p.y)) - y - 0.2,
      };
    })
    .filter(Boolean);
  const opposedThreePinBranches = alignOpposedThreePinJunctions(
    doc,
    resolver,
    obstacles,
  );
  if (!boxes.size)
    return {
      changes: [],
      aligned: [],
      sharedPowerBranches: [],
      opposedThreePinBranches,
      unresolved: [],
    };
  const sharedPowerBranches = moveSharedPowerBranches(
    doc,
    resolver,
    boxes,
    obstacles,
  );
  const count = new Map();
  for (const r of doc.routes)
    for (const e of [r.start, routeEnd(r)])
      if (e.kind === "junction")
        count.set(e.junctionId, (count.get(e.junctionId) ?? 0) + 1);
  const instanceCount = new Map();
  for (const r of doc.routes)
    for (const e of [r.start, routeEnd(r)])
      if (e.kind === "terminal")
        instanceCount.set(
          e.instanceId,
          (instanceCount.get(e.instanceId) ?? 0) + 1,
        );
  const changes = [],
    aligned = [],
    unresolved = [];
  for (const route of doc.routes) {
    const end = routeEnd(route),
      eps = [route.start, end];
    const touchesBox = eps.some(
      (e) => e.kind === "terminal" && boxes.has(e.instanceId),
    );
    // Only a free, explicitly decorated wire end may move. Shared dots stay put.
    for (let side = 0; side < 2; side++) {
      const pin = eps[side],
        free = eps[1 - side];
      if (pin.kind !== "terminal" || !boxes.has(pin.instanceId)) continue;
      const j =
        free.kind === "junction" &&
        doc.junctions.find((j) => j.id === free.junctionId);
      const marker =
        free.kind === "terminal" &&
        doc.instances.find((i) => i.id === free.instanceId);
      if (j) {
        if (
          count.get(j.id) !== 1 ||
          !doc.drafting.objects.some(
            (o) =>
              o.kind === "floating-symbol" &&
              o.anchor.kind === "object" &&
              o.anchor.objectId === j.id,
          )
        )
          continue;
      } else if (
        !marker ||
        !["ground", "vdd-port", "port"].includes(marker.symbolId) ||
        instanceCount.get(marker.id) !== 1
      )
        continue;
      const p = resolveEndpointConnection(doc, resolver, pin),
        f = resolveEndpointConnection(doc, resolver, free);
      if (!p?.outward || !f) continue;
      // Only translate compatible end markers; never rotate a ground symbol sideways.
      if (
        marker &&
        f.outward &&
        (f.outward.x !== -p.outward.x || f.outward.y !== -p.outward.y)
      )
        continue;
      const old = { ...f.contactPoint },
        d = { x: old.x - p.contactPoint.x, y: old.y - p.contactPoint.y };
      if (d.x * p.outward.x + d.y * p.outward.y <= 0) continue;
      const length = Math.min(
        stubLength,
        Math.abs(d.x * p.outward.x + d.y * p.outward.y),
      );
      const next = {
        x: p.contactPoint.x + p.outward.x * length,
        y: p.contactPoint.y + p.outward.y * length,
      };
      if (
        obstacles.some(
          (b) =>
            b.id !== pin.instanceId &&
            b.id !== marker?.id &&
            segmentIntersectsRect(p.contactPoint, next, b),
        )
      )
        continue;
      if (doc.junctions.some((q) => q.id !== j?.id && same(q.position, next)))
        continue;
      const dx = next.x - old.x,
        dy = next.y - old.y;
      const obstacle = marker && obstacles.find((b) => b.id === marker.id);
      if (
        obstacle &&
        obstacles.some(
          (b) =>
            b.id !== marker.id &&
            obstacle.x + dx < b.x + b.width &&
            obstacle.x + dx + obstacle.width > b.x &&
            obstacle.y + dy < b.y + b.height &&
            obstacle.y + dy + obstacle.height > b.y,
        )
      )
        continue;
      if (j) j.position = next;
      if (marker) {
        marker.placement.position = {
          x: marker.placement.position.x + dx,
          y: marker.placement.position.y + dy,
        };
        if (obstacle) {
          obstacle.x += dx;
          obstacle.y += dy;
        }
      }
      for (const a of doc.annotations)
        if (
          a.netId === route.netId &&
          a.anchor.kind === "free" &&
          distance(a.anchor.position, old) <= 40
        ) {
          a.anchor.position = {
            x: a.anchor.position.x + next.x - old.x,
            y: a.anchor.position.y + next.y - old.y,
          };
        }
      if (!same(old, next)) {
        aligned.push({
          objectId: j?.id ?? marker.id,
          before: old,
          after: next,
        });
        doc.revision++;
      }
    }
    const from = resolveEndpointConnection(doc, resolver, route.start),
      to = resolveEndpointConnection(doc, resolver, end);
    const original = resolveRouteGeometry(doc, resolver, route);
    if (!from || !to || !original) continue;
    const a = from.contactPoint,
      b = to.contactPoint;
    // A coincident pin and junction is already connected; detouring back to the
    // same point would create a spurious closed conductor.
    if (same(a, b) && terminal(route.start) !== terminal(end)) continue;
    const valid = (points) => {
      if (points.length < 2) return false;
      for (const [g, p, q] of [
        [from, points[0], points[1]],
        [to, points.at(-1), points.at(-2)],
      ])
        if (
          g.outward &&
          ((q.x - p.x) * g.outward.x + (q.y - p.y) * g.outward.y <= 0 ||
            (g.outward.x ? q.y !== p.y : q.x !== p.x))
        )
          return false;
      for (let n = 1; n < points.length; n++) {
        const p = points[n - 1],
          q = points[n];
        if (p.x !== q.x && p.y !== q.y) return false;
        if (n > 1) {
          const prev = points[n - 2];
          if ((p.x - prev.x) * (q.x - p.x) + (p.y - prev.y) * (q.y - p.y) < 0)
            return false;
        }
        if (
          obstacles.some((o) => {
            if (
              (n === 1 && route.start.instanceId === o.id) ||
              (n === points.length - 1 && end.instanceId === o.id)
            )
              return false;
            return segmentIntersectsRect(p, q, o);
          })
        )
          return false;
        // Avoid placing a conductor over an unrelated existing junction.
        if (
          doc.junctions.some(
            (j) =>
              j.netId !== route.netId &&
              ((p.x === q.x &&
                j.position.x === p.x &&
                j.position.y >= Math.min(p.y, q.y) &&
                j.position.y <= Math.max(p.y, q.y)) ||
                (p.y === q.y &&
                  j.position.y === p.y &&
                  j.position.x >= Math.min(p.x, q.x) &&
                  j.position.x <= Math.max(p.x, q.x))),
          )
        )
          return false;
      }
      return true;
    };
    const old = [
      original.segments[0]?.from,
      ...original.segments.map((s) => s.to),
    ].filter(Boolean);
    if (
      !touchesBox &&
      (valid(old) ||
        old.some(
          (p, i) => i > 0 && p.x !== old[i - 1].x && p.y !== old[i - 1].y,
        ))
    )
      continue;
    const straight = clean([a, b]);
    let chosen = valid(straight) ? straight : null;
    if (!chosen && valid(old)) continue;
    if (!chosen) {
      const directCorners = [
        { x: a.x, y: b.y },
        { x: b.x, y: a.y },
      ];
      chosen =
        directCorners.map((corner) => clean([a, corner, b])).find(valid) ??
        null;
    }
    const extend = (g) =>
      g.outward
        ? {
            x: g.contactPoint.x + g.outward.x * 20,
            y: g.contactPoint.y + g.outward.y * 20,
          }
        : g.contactPoint;
    const s = extend(from),
      t = extend(to);
    const candidates = [];
    const add = (middle) => {
      const p = clean([a, s, ...middle, t, b]);
      if (valid(p)) candidates.push(p);
    };
    // Retain the original middle first; only endpoint connectors are replaced.
    if (old.length > 2) {
      const mid = old.slice(1, -1),
        first = mid[0],
        last = mid.at(-1);
      for (const x of [
        { x: first.x, y: s.y },
        { x: s.x, y: first.y },
      ])
        for (const y of [
          { x: t.x, y: last.y },
          { x: last.x, y: t.y },
        ])
          add([x, ...mid, y]);
    }
    if (candidates.length)
      chosen ??= candidates.sort((a, b) => a.length - b.length)[0];
    if (!chosen) {
      add([{ x: s.x, y: t.y }]);
      add([{ x: t.x, y: s.y }]);
      const nearby = obstacles.filter(
        (o) =>
          o.x <= Math.max(s.x, t.x) + 60 &&
          o.x + o.width >= Math.min(s.x, t.x) - 60 &&
          o.y <= Math.max(s.y, t.y) + 60 &&
          o.y + o.height >= Math.min(s.y, t.y) - 60,
      );
      const xs = new Set([
        s.x,
        t.x,
        ...nearby.flatMap((o) => [
          Math.floor(o.x / 10) * 10 - 20,
          Math.ceil((o.x + o.width) / 10) * 10 + 20,
        ]),
      ]);
      const ys = new Set([
        s.y,
        t.y,
        ...nearby.flatMap((o) => [
          Math.floor(o.y / 10) * 10 - 20,
          Math.ceil((o.y + o.height) / 10) * 10 + 20,
        ]),
      ]);
      for (const x of xs)
        add([
          { x, y: s.y },
          { x, y: t.y },
        ]);
      for (const y of ys)
        add([
          { x: s.x, y },
          { x: t.x, y },
        ]);
      const score = (p) =>
        p.reduce((sum, q, i) => sum + (i ? distance(p[i - 1], q) : 0), 0) +
        p.length * 20;
      chosen = candidates.sort((a, b) => score(a) - score(b))[0];
    }
    if (!chosen) {
      unresolved.push(route.id);
      continue;
    }
    if (chosen.length === old.length && chosen.every((p, i) => same(p, old[i])))
      continue;
    const replacement = createRoutePath({
      id: route.id,
      netId: route.netId,
      start: route.start,
      end,
      bends: chosen.slice(1, -1),
      modes: Array(chosen.length - 1).fill("manual"),
    });
    route.legs = replacement.legs;
    changes.push(route.id);
  }
  if (changes.length || aligned.length) doc.revision++;
  return {
    changes,
    aligned,
    sharedPowerBranches,
    opposedThreePinBranches,
    unresolved,
  };
}
