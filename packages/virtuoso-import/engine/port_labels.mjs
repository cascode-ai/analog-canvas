import { transformPoint } from "../../model/dist/index.js";
import { resolveEndpointConnection } from "../../derived/dist/index.js";

export function portLabelPlacement(point, direction) {
  const left = direction.x < 0,
    down = direction.y > 0;
  return {
    position: {
      x: point.x + (left ? -10 : 10),
      y: point.y + (down ? 24 : -12),
    },
    alignment: left ? "end" : "start",
  };
}

export function supplyLabelPlacement(point, direction) {
  if (direction.x !== 0) return null;
  return {
    position: { x: point.x - 16, y: point.y + (direction.y < 0 ? -14 : 26) },
    alignment: "end",
  };
}

// Only external ports and explicitly decorated open ends; never internal pin names.
export function placePortLabels(doc, resolver) {
  const changes = [],
    candidates = [];
  const netByInstance = new Map();
  for (const net of doc.nets ?? [])
    for (const terminal of net.terminals ?? [])
      netByInstance.set(terminal.instanceId, net.id);
  const supplies = (doc.instances ?? [])
    .filter((i) => ["vdd-port", "ground"].includes(i.symbolId))
    .map((i) => {
      const direction = transformPoint(
        i.symbolId === "vdd-port" ? { x: 0, y: -1 } : { x: 0, y: 1 },
        { x: 0, y: 0 },
        i.placement,
      );
      return {
        id: i.id,
        netId: netByInstance.get(i.id),
        point: i.placement.position,
        direction,
        labelPlacement: supplyLabelPlacement(i.placement.position, direction),
      };
    })
    .filter((i) => i.netId && i.labelPlacement);
  for (const o of doc.drafting.objects) {
    if (
      o.kind !== "floating-symbol" ||
      o.symbolId !== "port" ||
      o.anchor.kind !== "object"
    )
      continue;
    const j = doc.junctions.find((j) => j.id === o.anchor.objectId);
    if (!j) continue;
    const direction = transformPoint(
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      o.transform,
    );
    candidates.push({ id: j.id, netId: j.netId, point: j.position, direction });
  }
  const used = new Set();
  for (const a of doc.annotations) {
    if (a.locked || a.visible === false) continue;
    let target;
    if (
      a.binding?.kind === "cell-terminal-name" &&
      a.anchor.kind === "object"
    ) {
      const i = doc.instances.find((i) => i.id === a.anchor.objectId);
      if (i?.symbolId !== "port") continue;
      const pin = resolver.resolve(i.symbolId)?.definition.pins[0];
      if (!pin) continue;
      const c = resolveEndpointConnection(doc, resolver, {
        kind: "terminal",
        instanceId: i.id,
        pinName: pin.name,
      });
      if (c?.outward)
        target = {
          id: i.id,
          point: c.contactPoint,
          direction: { x: -c.outward.x, y: -c.outward.y },
          origin: i.placement.position,
        };
    } else if (a.kind === "net-label" && a.anchor.kind === "free") {
      const p = a.anchor.position;
      target = supplies
        .filter((c) => c.netId === a.netId && !used.has(c.id))
        .map((c) => ({
          ...c,
          distance: Math.hypot(c.point.x - p.x, c.point.y - p.y),
        }))
        .filter((c) => c.distance <= 80)
        .sort((a, b) => a.distance - b.distance)[0];
      if (!target)
        target = candidates
          .filter((c) => c.netId === a.netId && !used.has(c.id))
          .map((c) => ({
            ...c,
            distance: Math.hypot(c.point.x - p.x, c.point.y - p.y),
          }))
          .filter((c) => c.distance <= 80)
          .sort((a, b) => a.distance - b.distance)[0];
    }
    if (!target) continue;
    const before = structuredClone(a.anchor),
      placement =
        target.labelPlacement ??
        portLabelPlacement(target.point, target.direction);
    const origin = target.origin ?? target.point;
    a.anchor = {
      kind: "object",
      objectId: target.id,
      localOffset: {
        x: placement.position.x - origin.x,
        y: placement.position.y - origin.y,
      },
      fallbackPosition: placement.position,
    };
    a.alignment = placement.alignment;
    a.rotation = 0;
    used.add(target.id);
    changes.push({ id: a.id, before, after: structuredClone(a.anchor) });
  }
  return changes;
}
