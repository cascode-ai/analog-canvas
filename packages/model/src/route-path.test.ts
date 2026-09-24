import { describe, expect, it } from "vitest";

import { createdRouteChildIds, createRoutePath } from "./route-path.js";

describe("new Route child identities", () => {
  it("names exactly the Leg and Bend IDs createRoutePath allocates", () => {
    const route = createRoutePath({
      id: "wire-copy-1",
      netId: "n",
      start: { kind: "junction", junctionId: "a" },
      end: { kind: "junction", junctionId: "b" },
      bends: [
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      modes: ["manual", "manual", "manual"],
    });
    expect(createdRouteChildIds("wire-copy-1", 3)).toEqual(
      route.legs.flatMap((leg) => [
        leg.id,
        ...(leg.to.kind === "bend" ? [leg.to.bendId] : []),
      ]),
    );
    expect(createdRouteChildIds("wire-copy-2", 3)).not.toContain(
      route.legs[0]!.id,
    );
  });
});
