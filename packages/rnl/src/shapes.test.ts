import { describe, expect, it } from "vitest";

import { outlineShape, pathShape, symbolShapes } from "./shapes.js";

describe("RNL shapes", () => {
  it("writes a straight path as a line, ten units to one and y up", () => {
    expect(
      pathShape([
        { x: 0, y: 0 },
        { x: 30, y: -20 },
      ]),
    ).toEqual({
      shape: "line",
      points: [
        [0, 0],
        [3, 2],
      ],
    });
  });

  it("raises a quadratic leg to the cubic that draws it, and a straight one to thirds", () => {
    const shape = pathShape(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 60, y: 0 },
      ],
      [{ x: 15, y: -30 }, null],
    );
    expect(shape).toEqual({
      shape: "bezier",
      points: [
        [0, 0],
        [1, 2],
        [2, 2],
        [3, 0],
        [4, 0],
        [5, 0],
        [6, 0],
      ],
    });
  });

  it("writes an axis-aligned outline as a rectangle and any other as a closed line", () => {
    expect(
      outlineShape([
        { x: -40, y: -20 },
        { x: 40, y: -20 },
        { x: 40, y: 20 },
        { x: -40, y: 20 },
      ]),
    ).toEqual({
      shape: "rectangle",
      points: [[0, 0]],
      params: { width: 8, height: 4 },
    });
    const slanted = outlineShape([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 20 },
      { x: -10, y: 10 },
    ]);
    expect(slanted.shape).toBe("line");
    expect(slanted.points.at(-1)).toEqual(slanted.points[0]);
  });

  it("takes a symbol's lines, outlines, circles and absolute SVG paths", () => {
    expect(
      symbolShapes([
        { kind: "line", from: { x: 0, y: 0 }, to: { x: 10, y: 0 } },
        {
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: -10 },
          ],
          fill: "foreground",
          stroke: "none",
        },
        { kind: "circle", center: { x: 0, y: 0 }, radius: 5 },
      ]),
    ).toEqual([
      {
        shape: "line",
        points: [
          [0, 0],
          [1, 0],
        ],
      },
      {
        shape: "line",
        points: [
          [0, 0],
          [1, 0],
          [0.5, 1],
          [0, 0],
        ],
        params: { fill: "linecolor" },
        style: { linestyle: "none" },
      },
      { shape: "circle", points: [[0, 0]], params: { radius: 0.5 } },
    ]);
    expect(symbolShapes([{ kind: "path", data: "M 0 0 L 10 0" }])).toEqual([
      {
        shape: "line",
        points: [
          [0, 0],
          [1, 0],
        ],
      },
    ]);
    expect(
      symbolShapes([{ kind: "path", data: "M 0 0 L 10 0 L 0 10 Z" }]),
    ).toEqual([
      {
        shape: "line",
        points: [
          [0, 0],
          [1, 0],
          [0, -1],
          [0, 0],
        ],
      },
    ]);
    // A cubic leg is drawn as it is; a straight leg beside it is a cubic
    // with its controls on the leg, and Z closes the outline.
    expect(
      symbolShapes([
        { kind: "path", data: "M 0 0 C 10 20 30 40 50 60 L 0 0 Z" },
      ]),
    ).toEqual([
      {
        shape: "bezier",
        points: [
          [0, 0],
          [1, -2],
          [3, -4],
          [5, -6],
          [3.333333, -4],
          [1.666667, -2],
          [0, 0],
        ],
      },
    ]);
    expect(
      symbolShapes([{ kind: "path", data: "M 0 0 A 5 5 0 0 1 10 0" }]),
    ).toBeNull();
    expect(
      symbolShapes([{ kind: "path", data: "m 0 0 c 1 2 3 4 5 6" }]),
    ).toBeNull();
  });
});
