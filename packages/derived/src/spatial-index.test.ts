import { createEmptyDocument, createRoutePath } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { resolveDocumentRoutingGeometry } from "./resolved-route-geometry";
import {
  buildBoundsSpatialIndex,
  buildDocumentSpatialIndex,
} from "./spatial-index";

describe("bounds spatial index", () => {
  it("keeps input order across buckets and includes exact boundaries", () => {
    const index = buildBoundsSpatialIndex(
      [
        { bounds: { x: -100, y: 0, width: 200, height: 0 }, value: "rail" },
        { bounds: { x: 100, y: 0, width: 0, height: 100 }, value: "edge" },
        { bounds: { x: 300, y: 300, width: 10, height: 10 }, value: "far" },
      ],
      40,
    );

    expect(index.queryPoint({ x: 100, y: 0 })).toEqual(["rail", "edge"]);
    expect(index.queryBounds({ x: -120, y: -1, width: 20, height: 2 })).toEqual(
      ["rail"],
    );
  });

  it("finds broad geometry and distant bounds in input order without enumerating their buckets", () => {
    const index = buildBoundsSpatialIndex(
      [
        { bounds: { x: 10, y: 10, width: 30, height: 30 }, value: "near" },
        {
          bounds: { x: 0, y: 0, width: 1e308, height: 1e308 },
          value: "wide body",
        },
        { bounds: { x: 1e300, y: 0, width: 4, height: 4 }, value: "distant" },
        { bounds: { x: 80, y: 80, width: 30, height: 30 }, value: "far" },
      ],
      40,
    );

    expect(index.size).toBe(4);
    expect(index.queryPoint({ x: 40, y: 40 })).toEqual(["near", "wide body"]);
    expect(index.queryPoint({ x: 1e300, y: 4 })).toEqual([
      "wide body",
      "distant",
    ]);
    expect(index.queryPoint({ x: -1, y: 1 })).toEqual([]);
    expect(
      index.queryBounds({ x: 1e308, y: 1e308, width: -1e308, height: -1e308 }),
    ).toEqual(["near", "wide body", "distant", "far"]);
  });

  it("indexes non-orthogonal segments without claiming their exact geometry", () => {
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const document = createEmptyDocument("spatial", "Spatial");
    document.junctions.push(
      { id: "a", netId: "n", position: { x: 0, y: 0 } },
      { id: "b", netId: "n", position: { x: 40, y: 40 } },
    );
    document.nets.push({ id: "n", terminals: [] });
    document.routes.push(
      createRoutePath({
        id: "diagonal",
        netId: "n",
        start: { kind: "junction", junctionId: "a" },
        end: { kind: "junction", junctionId: "b" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const geometry = resolveDocumentRoutingGeometry(document, resolver);
    const index = buildDocumentSpatialIndex(document, geometry);

    expect(index.routeSegments.queryPoint({ x: 20, y: 20 })).toEqual([
      expect.objectContaining({ routeId: "diagonal", orientation: "other" }),
    ]);
  });
});
