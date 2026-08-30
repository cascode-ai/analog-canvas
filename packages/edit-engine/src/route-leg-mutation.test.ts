import { createRoutePath, routeBends } from "@icm/model";
import { describe, expect, it } from "vitest";

import { rebuildRoutePathWithRemap } from "./route-leg-mutation.js";

const start = { kind: "junction" as const, junctionId: "J1" };
const end = { kind: "junction" as const, junctionId: "J2" };

function sourceRoute() {
  return createRoutePath({
    id: "route-identity",
    netId: "net-1",
    start,
    end,
    bends: [
      { x: 40, y: 0 },
      { x: 80, y: 40 },
    ],
    modes: ["manual", "trunk", "manual"],
    styleOverride: { color: "#123456" },
  });
}

describe("stable Route leg mutation", () => {
  it("retains all leg and bend identities across a geometry-only transform", () => {
    const source = sourceRoute();
    const rebuilt = rebuildRoutePathWithRemap(
      source,
      start,
      end,
      [
        { x: 50, y: 10 },
        { x: 90, y: 50 },
      ],
      ["manual", "trunk", "manual"],
      "move",
    );

    expect(rebuilt.route.legs.map((leg) => leg.id)).toEqual(
      source.legs.map((leg) => leg.id),
    );
    expect(
      rebuilt.route.legs.flatMap((leg) =>
        leg.to.kind === "bend" ? [leg.to.bendId] : [],
      ),
    ).toEqual(
      source.legs.flatMap((leg) =>
        leg.to.kind === "bend" ? [leg.to.bendId] : [],
      ),
    );
    expect(rebuilt.identityRemap.createdLegIds.size).toBe(0);
    expect(rebuilt.identityRemap.removedLegIds.size).toBe(0);
    expect(rebuilt.route.styleOverride).toEqual({ color: "#123456" });
  });

  it("keeps the start-side leg when inserting a bend before an existing bend", () => {
    const source = sourceRoute();
    const rebuilt = rebuildRoutePathWithRemap(
      source,
      start,
      end,
      [{ x: 20, y: 0 }, ...routeBends(source)],
      ["manual", "manual", "trunk", "manual"],
      "split",
    );

    expect(rebuilt.route.legs[0]!.id).toBe(source.legs[0]!.id);
    expect(rebuilt.route.legs[1]!.id).not.toBe(source.legs[1]!.id);
    expect(rebuilt.route.legs[2]!.id).toBe(source.legs[1]!.id);
    expect(rebuilt.route.legs[3]!.id).toBe(source.legs[2]!.id);
    expect(rebuilt.identityRemap.createdLegIds.size).toBe(1);
  });

  it("keeps the start-side leg when merging across a removed bend", () => {
    const source = sourceRoute();
    const rebuilt = rebuildRoutePathWithRemap(
      source,
      start,
      end,
      [routeBends(source)[1]!],
      ["manual", "manual"],
      "merge",
    );

    expect(rebuilt.route.legs[0]!.id).toBe(source.legs[0]!.id);
    expect(rebuilt.route.legs[1]!.id).toBe(source.legs[2]!.id);
    expect(rebuilt.identityRemap.removedLegIds).toEqual(
      new Set([source.legs[1]!.id]),
    );
    expect(rebuilt.identityRemap.removedBendIds).toEqual(
      new Set([
        source.legs[0]!.to.kind === "bend"
          ? source.legs[0]!.to.bendId
          : "unreachable",
      ]),
    );
  });
});
