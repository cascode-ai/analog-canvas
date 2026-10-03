import {
  createProjectSymbolResolver,
  externalSubcircuitSymbolId,
} from "@icm/symbols";
import { type ExternalSubcircuitDefinition } from "@icm/model";
import { digest, type Snapshot, type Mapping } from "../core/index.js";

function artworkSide(shapes: unknown, p: [number, number]) {
  if (!Array.isArray(shapes)) return undefined;
  const near = (a: number[], b: number[]) =>
    Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 1e-6;
  for (const shape of shapes) {
    if (shape.layer !== "device" || !Array.isArray(shape.points)) continue;
    const points = shape.points as number[][];
    for (const [end, other] of [
      [points[0], points[1]],
      [points.at(-1), points.at(-2)],
    ]) {
      if (!end || !other || !near(end, p)) continue;
      const dx = end[0]! - other[0]!,
        dy = end[1]! - other[1]!;
      if (Math.abs(dx) > 1e-6 && Math.abs(dy) < 1e-6)
        return dx > 0 ? "east" : "west";
      if (Math.abs(dy) > 1e-6 && Math.abs(dx) < 1e-6)
        return dy > 0 ? "north" : "south";
    }
  }
  const bodies = shapes.filter(
    (s) => s.layer === "device" && s.type === "rect" && Array.isArray(s.bbox),
  );
  bodies.sort(
    (a, b) =>
      (b.bbox[1][0] - b.bbox[0][0]) * (b.bbox[1][1] - b.bbox[0][1]) -
      (a.bbox[1][0] - a.bbox[0][0]) * (a.bbox[1][1] - a.bbox[0][1]),
  );
  const b = bodies[0]?.bbox;
  if (!b) return undefined;
  return [
    { side: "west", d: Math.abs(p[0] - b[0][0]) },
    { side: "east", d: Math.abs(p[0] - b[1][0]) },
    { side: "south", d: Math.abs(p[1] - b[0][1]) },
    { side: "north", d: Math.abs(p[1] - b[1][1]) },
  ].sort((a, b) => a.d - b.d)[0]!.side;
}

export function createGenericBoxes(
  snapshot: Snapshot,
  mappings: Map<string, Mapping>,
  _scale: number,
) {
  const definitions: ExternalSubcircuitDefinition[] = [];
  const instances: Record<string, { definitionId: string; label: string }> = {};
  for (const inst of snapshot.instances) {
    const mapping = mappings.get(inst.id)!;
    if (mapping.symbol !== "generic-box") continue;
    const master = snapshot.symbols.find((s) => s.id === inst.symbolId)!;
    const definitionId =
      "box-" + digest([inst.library, inst.cell, inst.id]).slice(0, 20);
    const sourceTerminals = [...master.terminals];
    for (const t of inst.terminals) {
      if (!sourceTerminals.some((p) => p.name === t.name))
        sourceTerminals.push(t);
    }
    const terminals = sourceTerminals.map((t, index) => {
      const direction =
        inst.terminals.find((p) => p.name === t.name)?.direction ?? t.direction;
      return {
        id: "pin-" + index,
        name: t.name,
        direction:
          direction === "input"
            ? ("input" as const)
            : direction === "output"
              ? ("output" as const)
              : direction === "inputOutput"
                ? ("inout" as const)
                : ("passive" as const),
      };
    });
    const points = sourceTerminals.map(
      (t) => t.pins[0]?.localCenter ?? t.pins[0]?.worldCenter,
    );
    const valid = points.filter((p): p is [number, number] => Boolean(p));
    const minX = Math.min(...valid.map((p) => p[0])),
      maxX = Math.max(...valid.map((p) => p[0]));
    const minY = Math.min(...valid.map((p) => p[1])),
      maxY = Math.max(...valid.map((p) => p[1]));
    const groups: Record<string, Array<{ index: number; order: number }>> = {
      west: [],
      east: [],
      north: [],
      south: [],
    };
    points.forEach((p, index) => {
      const fallback =
        terminals[index]!.direction === "output" ? "east" : "west";
      const side =
        (p && artworkSide(master.shapes, p)) ??
        (p && valid.length > 1
          ? ([
              { side: "west", distance: Math.abs(p[0] - minX) },
              { side: "east", distance: Math.abs(p[0] - maxX) },
              { side: "north", distance: Math.abs(p[1] - maxY) },
              { side: "south", distance: Math.abs(p[1] - minY) },
            ]
              .filter((a) =>
                a.side === "west" || a.side === "east"
                  ? maxX > minX
                  : maxY > minY,
              )
              .sort(
                (a, b) =>
                  a.distance - b.distance ||
                  Number(b.side === fallback) - Number(a.side === fallback),
              )[0]?.side ?? fallback)
          : fallback);
      groups[side]!.push({
        index,
        order: p ? (side === "west" || side === "east" ? -p[1] : p[0]) : index,
      });
    });
    const pinPlacements = Object.entries(groups).flatMap(([side, items]) =>
      items
        .sort((a, b) => a.order - b.order)
        .map((p, index) => ({
          terminalId: terminals[p.index]!.id,
          side: side as "west" | "east" | "north" | "south",
          offset: (index - (items.length - 1) / 2) * 40,
        })),
    );
    // Fixed pin pitch; source scale determines placement, not frame size.
    const depth = (side: string) =>
      Math.max(
        0,
        ...groups[side]!.map((p) => terminals[p.index]!.name.length * 8),
      );
    const width = 100;
    const sideBand = Math.max(groups.west!.length, groups.east!.length) * 40;
    const height =
      Math.ceil(
        Math.max(
          80,
          2 * Math.max(depth("north"), depth("south")) + sideBand + 20,
        ) / 20,
      ) * 20;
    definitions.push({
      id: definitionId,
      name:
        inst.cell.slice(0, 80) +
        "_" +
        digest([inst.library, inst.id]).slice(0, 12),
      terminals,
      formalParameters: [],
      interfaceStatus: "declared",
      presentation: { minimumBodySize: { width, height }, pinPlacements },
    });
    mapping.symbol = externalSubcircuitSymbolId(definitionId);
    instances[inst.id] = { definitionId, label: inst.cell };
  }
  const resolver = createProjectSymbolResolver(
    {
      documents: [],
      topDocumentId: "unused",
      externalSubcircuitDefinitions: definitions,
    },
    [],
  );
  const symbols = Object.fromEntries(
    definitions.map((d) => {
      const id = externalSubcircuitSymbolId(d.id);
      return [id, resolver.resolve(id)!.definition];
    }),
  );
  return { definitions, instances, symbols };
}
