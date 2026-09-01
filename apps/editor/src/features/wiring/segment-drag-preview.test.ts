import { createRoutePath } from "@icm/model";
import { describe, expect, it } from "vitest";

import { segmentDragPreviewPolyline } from "./segment-drag-preview";

const route = (
  start: Parameters<typeof createRoutePath>[0]["start"],
  end: Parameters<typeof createRoutePath>[0]["end"],
) =>
  createRoutePath({
    id: "route-1",
    netId: "net-1",
    start,
    end,
    bends: [],
    modes: ["manual"],
  });

const junction = (junctionId: string) =>
  ({ kind: "junction", junctionId }) as const;
const terminal = (instanceId: string) =>
  ({ kind: "terminal", instanceId, pinName: "P" }) as const;

describe("what a segment drag draws while the pointer is down", () => {
  it("follows the endpoint the plan moves, so no slanted edge closes it", () => {
    // The reported shape: a wire from a terminal out to a free end, dragged
    // by its middle. The planner repairs the slant by moving the free end,
    // and the preview has to move with it or the last leg cuts across.
    const points = segmentDragPreviewPolyline(
      route(terminal("R1"), junction("j-free")),
      [
        { x: 230, y: 230 },
        { x: 510, y: 320 },
      ],
      [
        { x: 230, y: 350 },
        { x: 510, y: 350 },
      ],
      [{ junctionId: "j-free", position: { x: 510, y: 350 } }],
    );
    expect(points).toEqual([
      { x: 230, y: 230 },
      { x: 230, y: 350 },
      { x: 510, y: 350 },
      { x: 510, y: 350 },
    ]);
    // Every leg is axis-aligned: no triangle.
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index]!;
      const to = points[index + 1]!;
      expect(from.x === to.x || from.y === to.y).toBe(true);
    }
  });

  it("leaves an endpoint the plan does not move exactly where it is", () => {
    // Both ends on device terminals: the wire stretches between them and the
    // anchors are not the drag's to move.
    const points = segmentDragPreviewPolyline(
      route(terminal("R1"), terminal("R2")),
      [
        { x: 230, y: 230 },
        { x: 550, y: 230 },
      ],
      [
        { x: 230, y: 290 },
        { x: 550, y: 290 },
      ],
      [],
    );
    expect(points).toEqual([
      { x: 230, y: 230 },
      { x: 230, y: 290 },
      { x: 550, y: 290 },
      { x: 550, y: 230 },
    ]);
  });

  it("ignores a junction move that belongs to another Route", () => {
    const points = segmentDragPreviewPolyline(
      route(terminal("R1"), junction("j-free")),
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [{ x: 0, y: 40 }],
      [{ junctionId: "j-somewhere-else", position: { x: 999, y: 999 } }],
    );
    expect(points.at(-1)).toEqual({ x: 100, y: 0 });
  });
});
