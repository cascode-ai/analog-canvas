import {
  defaultInstanceLabelPlacement,
  resolveDocumentStyleProfile,
  resolveRouteGeometry,
} from "../../derived/dist/index.js";

function labelClearOfSharedMosRail(doc, resolver, instance, position) {
  if (!["nmos", "pmos"].includes(instance.symbolId)) return position;
  const tiedNet = doc.nets.find((net) =>
    ["D", "S", "B"].every((pin) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === instance.id && terminal.pinName === pin,
      ),
    ),
  );
  if (!tiedNet) return position;
  for (const route of doc.routes) {
    if (route.netId !== tiedNet.id || route.presentation === "bulk-dashed")
      continue;
    const geometry = resolveRouteGeometry(doc, resolver, route);
    const rail = geometry?.segments.find(
      (segment) =>
        segment.from.y === segment.to.y &&
        segment.from.y === position.y &&
        Math.min(segment.from.x, segment.to.x) <= position.x &&
        position.x <= Math.max(segment.from.x, segment.to.x),
    );
    if (rail) {
      const away = rail.from.y < instance.placement.position.y ? -1 : 1;
      return { ...position, y: rail.from.y + away * 3 * doc.presentation.grid };
    }
  }
  return position;
}

// Use the editor's shared placer while preserving source names and bindings.
export function placeNativeInstanceLabels(doc, resolver) {
  const profile = resolveDocumentStyleProfile(doc.presentation);
  const changes = [];
  for (const annotation of doc.annotations) {
    if (
      annotation.locked ||
      annotation.anchor.kind !== "object" ||
      !["instance-reference", "cell-terminal-name"].includes(
        annotation.binding?.kind,
      )
    )
      continue;
    const instance = doc.instances.find(
      (i) => i.id === annotation.anchor.objectId,
    );
    if (!instance?.placement) continue;
    const symbol = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!symbol) throw Error("Missing label symbol: " + instance.symbolId);
    const placement = defaultInstanceLabelPlacement(
      instance,
      symbol,
      profile,
      doc.presentation.grid,
      "reference",
    );
    if (!placement)
      throw Error("Missing native label placement: " + instance.id);
    const position = labelClearOfSharedMosRail(
      doc,
      resolver,
      instance,
      placement.position,
    );
    const before = structuredClone(annotation.anchor);
    annotation.anchor = {
      kind: "object",
      objectId: instance.id,
      localOffset: {
        x: position.x - instance.placement.position.x,
        y: position.y - instance.placement.position.y,
      },
      fallbackPosition: position,
    };
    annotation.alignment = placement.alignment;
    annotation.rotation = 0;
    changes.push({
      id: annotation.id,
      before,
      after: structuredClone(annotation.anchor),
    });
  }
  return changes;
}
