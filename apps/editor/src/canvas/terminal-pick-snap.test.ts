import { describe, it, expect } from "vitest";
import { nearestTerminal } from "./terminal-pick-snap";
describe("terminal current snap", () => {
  it("chooses nearest rather than last painted, within screen-space reach", () => {
    const points = [
      { x: 20, y: 20 },
      { x: 32, y: 20 },
    ];
    expect(nearestTerminal(points, { x: 23, y: 26 }, (p) => p, 10)).toBe(
      points[0],
    );
    expect(
      nearestTerminal([...points].reverse(), { x: 23, y: 26 }, (p) => p, 10),
    ).toBe(points[0]);
    expect(nearestTerminal(points, { x: 20, y: 31 }, (p) => p, 10)).toBeNull();
  });
  it("does not guess coincident or equally close terminals", () => {
    expect(
      nearestTerminal(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        { x: 1, y: 1 },
        (p) => p,
        10,
      ),
    ).toBeNull();
    expect(
      nearestTerminal(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        { x: 5, y: 0 },
        (p) => p,
        10,
      ),
    ).toBeNull();
  });
});
