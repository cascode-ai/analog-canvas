import {
  createRoutePath,
  routeEnd,
  transformPoint,
} from "../../model/dist/index.js";
import {
  resolveEndpointConnection,
  visibleSymbolInkBounds,
} from "../../derived/dist/index.js";
import { segmentIntersectsRect } from "./segment_geometry.mjs";

const same = (a, b) => a.x === b.x && a.y === b.y;
const dot = (a, b) => a.x * b.x + a.y * b.y;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a, n) => ({ x: a.x * n, y: a.y * n });
const isGeneratedMarker = (e) =>
  e.kind === "terminal" && e.instanceId.startsWith("end-marker-");

function instanceBounds(instance, resolver) {
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  const ink = resolved && visibleSymbolInkBounds(resolved);
  if (!ink) return null;
  const points = [
    [ink.x, ink.y],
    [ink.x + ink.width, ink.y],
    [ink.x, ink.y + ink.height],
    [ink.x + ink.width, ink.y + ink.height],
  ].map(([x, y]) =>
    transformPoint({ x, y }, instance.placement.position, instance.placement),
  );
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function groundRotation(outward) {
  if (outward.x === 0 && outward.y === -1) return 0;
  if (outward.x === 1 && outward.y === 0) return 90;
  if (outward.x === 0 && outward.y === 1) return 180;
  if (outward.x === -1 && outward.y === 0) return 270;
  return null;
}

// Only direct, single-route end markers may move; shared junctions remain fixed.
export function alignEndMarkers(doc, resolver) {
  const useCount = new Map();
  for (const route of doc.routes)
    for (const end of [route.start, routeEnd(route)])
      if (end.kind === "terminal")
        useCount.set(end.instanceId, (useCount.get(end.instanceId) ?? 0) + 1);
  const changes = [];
  for (const route of doc.routes) {
    const end = routeEnd(route),
      markerEnd = isGeneratedMarker(route.start)
        ? route.start
        : isGeneratedMarker(end)
          ? end
          : null;
    const peer = markerEnd === route.start ? end : route.start;
    if (
      !markerEnd ||
      peer.kind !== "terminal" ||
      isGeneratedMarker(peer) ||
      useCount.get(markerEnd.instanceId) !== 1
    )
      continue;
    const marker = doc.instances.find((i) => i.id === markerEnd.instanceId);
    const peerInstance = doc.instances.find((i) => i.id === peer.instanceId);
    if (
      !marker ||
      !peerInstance ||
      !["port", "ground"].includes(marker.symbolId)
    )
      continue;
    const markerPin = resolveEndpointConnection(doc, resolver, markerEnd);
    const devicePin = resolveEndpointConnection(doc, resolver, peer);
    if (!markerPin || !devicePin) continue;
    const oldPlacement = structuredClone(marker.placement);
    let desired;
    if (marker.symbolId === "port") {
      const direction = markerPin.outward;
      if (
        !direction ||
        dot(
          subtract(devicePin.contactPoint, markerPin.contactPoint),
          direction,
        ) <=
          2 * doc.presentation.grid
      )
        continue;
      const offset = dot(
        subtract(devicePin.contactPoint, markerPin.contactPoint),
        direction,
      );
      desired = subtract(devicePin.contactPoint, scale(direction, offset));
    } else {
      const direction = devicePin.outward;
      if (!direction) continue;
      const displacement = subtract(
        markerPin.contactPoint,
        devicePin.contactPoint,
      );
      const distance = dot(displacement, direction);
      if (distance <= 2 * doc.presentation.grid) continue;
      desired = add(devicePin.contactPoint, scale(direction, distance));
      const rotation = groundRotation(scale(direction, -1));
      if (rotation === null) continue;
      marker.placement.rotation = rotation;
    }
    if (
      Math.abs(desired.x - markerPin.contactPoint.x) +
        Math.abs(desired.y - markerPin.contactPoint.y) >
      2 * doc.presentation.grid
    ) {
      marker.placement = oldPlacement;
      continue;
    }
    const rotated = resolveEndpointConnection(doc, resolver, markerEnd);
    if (!rotated) {
      marker.placement = oldPlacement;
      continue;
    }
    marker.placement.position = add(
      marker.placement.position,
      subtract(desired, rotated.contactPoint),
    );
    const nextMarker = resolveEndpointConnection(doc, resolver, markerEnd);
    const nextPeer = resolveEndpointConnection(doc, resolver, peer);
    const a = nextMarker?.contactPoint,
      b = nextPeer?.contactPoint;
    const markerBounds = instanceBounds(marker, resolver);
    const blocked =
      !a ||
      !b ||
      (a.x !== b.x && a.y !== b.y) ||
      doc.instances.some((i) => {
        if (i.id === marker.id || i.id === peer.instanceId) return false;
        const bounds = instanceBounds(i, resolver);
        return (
          bounds &&
          ((markerBounds && overlaps(markerBounds, bounds)) ||
            segmentIntersectsRect(a, b, bounds))
        );
      }) ||
      doc.junctions.some(
        (j) =>
          j.netId !== route.netId &&
          segmentIntersectsRect(a, b, { ...j.position, width: 0, height: 0 }),
      );
    if (blocked) {
      marker.placement = oldPlacement;
      continue;
    }
    const start = resolveEndpointConnection(
      doc,
      resolver,
      route.start,
    )?.contactPoint;
    const finish = resolveEndpointConnection(doc, resolver, end)?.contactPoint;
    if (!start || !finish) {
      marker.placement = oldPlacement;
      continue;
    }
    const oldLegs = route.legs;
    if (
      same(oldPlacement.position, marker.placement.position) &&
      oldPlacement.rotation === marker.placement.rotation &&
      oldLegs.length === 1
    )
      continue;
    route.legs = createRoutePath({
      id: route.id,
      netId: route.netId,
      start: route.start,
      end,
      bends: [],
      modes: ["manual"],
    }).legs;
    changes.push({
      markerId: marker.id,
      routeId: route.id,
      before: oldPlacement,
      after: structuredClone(marker.placement),
    });
    doc.revision++;
  }
  return changes;
}
