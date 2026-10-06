import { StableIdSchema } from "@icm/model";
import { describe, expect, it } from "vitest";

import { splitRoutePieceIds } from "./split-route-ids.js";

/** An Agent tap's marker: its `wire-<uuid>` intent and the side it taps. */
const agentMarker = (n: number) =>
  `wire-${n.toString(16).padStart(8, "0")}-7c3e-4f8a-9b1d-2e6f0a4c8d17-to`;

describe("split Route piece IDs", () => {
  it("names a short parent's pieces in the readable form", () => {
    expect(splitRoutePieceIds("route-ui-3", 7)).toEqual({
      firstRouteId: "route-ui-3-a-7",
      secondRouteId: "route-ui-3-b-7",
    });
    expect(splitRoutePieceIds("rail", agentMarker(1))).toEqual({
      firstRouteId: `rail-a-${agentMarker(1)}`,
      secondRouteId: `rail-b-${agentMarker(1)}`,
    });
  });

  it("keeps the readable form up to 128 characters, and no further", () => {
    // Up to 128 characters a split names its pieces in the readable form.
    expect(splitRoutePieceIds("r".repeat(124), "m")).toEqual({
      firstRouteId: `${"r".repeat(124)}-a-m`,
      secondRouteId: `${"r".repeat(124)}-b-m`,
    });
    const over = splitRoutePieceIds("r".repeat(125), "m");
    expect(over.firstRouteId).not.toBe(`${"r".repeat(125)}-a-m`);
    expect(over.secondRouteId).not.toBe(`${"r".repeat(125)}-b-m`);
  });

  it("gives a long parent short, deterministic IDs, distinct per side and marker", () => {
    // 256 characters: the longest ID a Document can already hold.
    const parent = "p".repeat(256);
    const pieces = splitRoutePieceIds(parent, agentMarker(5));
    expect(splitRoutePieceIds(parent, agentMarker(5))).toEqual(pieces);
    expect(pieces.firstRouteId).not.toBe(pieces.secondRouteId);
    expect(splitRoutePieceIds(parent, agentMarker(6)).firstRouteId).not.toBe(
      pieces.firstRouteId,
    );
    for (const id of [pieces.firstRouteId, pieces.secondRouteId]) {
      expect(id.length).toBeLessThanOrEqual(128);
      expect(StableIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("stays a valid, fresh ID however many times one wire is tapped", () => {
    // Left to right, every tap lands on the far piece the previous one left.
    let parent = "route-agent-rail-c81a48cce04ef203-rail";
    const seen = new Set([parent]);
    for (let tap = 1; tap <= 100; tap += 1) {
      const pieces = splitRoutePieceIds(parent, agentMarker(tap));
      for (const id of [pieces.firstRouteId, pieces.secondRouteId]) {
        expect(StableIdSchema.safeParse(id).success, id).toBe(true);
        expect(seen.has(id), id).toBe(false);
        seen.add(id);
      }
      parent = pieces.secondRouteId;
    }
  });
});
