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
