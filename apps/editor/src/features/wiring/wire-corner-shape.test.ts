import { describe, expect, it } from "vitest";
import { compileWireDraft, type WireDraftStep } from "@icm/edit-engine";
import { nextWireCornerShape } from "./wire-corner-shape";

const at = (x: number, y: number) => ({
  connection: {
    contactPoint: { x, y },
    gridLanding: { x, y },
    escapePath: [],
    outward: null,
  },
});
const source = at(0, 0);
const target = at(160, 100);

describe("wire corner cycle", () => {
  it.each([
    { name: "a new wire", steps: [] },
    {
      name: "an incoming vertical leg",
      steps: [{ point: { x: 0, y: 40 }, routingMode: "orthogonal" }],
    },
    {
      name: "an incoming horizontal leg",
      steps: [{ point: { x: 40, y: 0 }, routingMode: "orthogonal" }],
    },
    {
      name: "an implicit elbow between clicks",
      steps: [{ point: { x: 40, y: 30 }, routingMode: "orthogonal" }],
    },
  ] satisfies { name: string; steps: WireDraftStep[] }[])(
    "flips $name once, then reaches diagonal and free geometry",
    ({ steps }) => {
      const original = compileWireDraft(source, target, steps).points;
      const flipped = nextWireCornerShape("orthogonal", "auto", source, steps);
      expect(flipped.routingMode).toBe("orthogonal");
      expect(
        compileWireDraft(
          source,
          target,
          steps,
          flipped.routingMode,
          flipped.cornerOrder,
        ).points,
      ).not.toEqual(original);

      const diagonal = nextWireCornerShape(
        flipped.routingMode,
        flipped.cornerOrder,
        source,
        steps,
      );
      expect(diagonal.routingMode).toBe("octilinear");
      const diagonalPoints = compileWireDraft(
        source,
        target,
        steps,
        diagonal.routingMode,
        diagonal.cornerOrder,
      ).points;
      expect(
        diagonalPoints.some(
          (point, i) =>
            i > 0 &&
            point.x !== diagonalPoints[i - 1]!.x &&
            Math.abs(point.x - diagonalPoints[i - 1]!.x) ===
              Math.abs(point.y - diagonalPoints[i - 1]!.y),
        ),
      ).toBe(true);

      const free = nextWireCornerShape(
        diagonal.routingMode,
        diagonal.cornerOrder,
        source,
        steps,
      );
      expect(free.routingMode).toBe("free");
      const reset = nextWireCornerShape(
        free.routingMode,
        free.cornerOrder,
        source,
        steps,
      );
      expect(
        compileWireDraft(
          source,
          target,
          steps,
          reset.routingMode,
          reset.cornerOrder,
        ).points,
      ).toEqual(original);
    },
  );

  it("can choose a shape before starting a wire", () => {
    expect(nextWireCornerShape("orthogonal", "auto", null, [])).toMatchObject({
      routingMode: "orthogonal",
      cornerOrder: "vertical-first",
    });
  });
});
