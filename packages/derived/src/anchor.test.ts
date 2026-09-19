import { createEmptyDocument, createRoutePath } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { expect, it } from "vitest";
import { resolveVisualAnchor } from "./anchor.js";

it.each([8, -8, 0])(
  "preserves signed offset %s independently of horizontal text orientation",
  (normalOffset) => {
    const document = createEmptyDocument("labels", "Labels");
    document.nets.push({ id: "n", terminals: [] });
    document.junctions.push(
      {
        id: "a",
        netId: "n",
        position: { x: 210, y: 180 },
        role: "route-anchor",
      },
      {
        id: "b",
        netId: "n",
        position: { x: 210, y: 280 },
        role: "route-anchor",
      },
    );
    const route = createRoutePath({
      id: "r",
      netId: "n",
      start: { kind: "junction", junctionId: "a" },
      end: { kind: "junction", junctionId: "b" },
      bends: [],
      modes: ["manual"],
    });
    document.routes.push(route);
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    for (const orientation of ["horizontal", "follow"] as const) {
      const anchor = {
        kind: "route" as const,
        routeId: route.id,
        legId: route.legs[0]!.id,
        t: 0.4,
        normalOffset,
        direction: "forward" as const,
        orientation,
        fallbackPosition: { x: 0, y: 0 },
      };
      expect(resolveVisualAnchor(document, resolver, anchor)).toMatchObject({
        resolved: true,
        position: { x: 210 - normalOffset, y: 220 },
        rotation: orientation === "horizontal" ? 0 : 90,
      });
    }
  },
);
