import { describe, expect, it } from "vitest";

import { buildManualWirePath, compileWireDraft } from "./routing-planner.js";

describe("buildManualWirePath", () => {
  it("keeps a direct terminal right-angle at the exact electrical endpoint", () => {
    const path = buildManualWirePath(
      { point: { x: 100, y: 100 } },
      { point: { x: 100, y: 200 } },
    );

    expect(path.points).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 200 },
    ]);
    expect(path.segmentModes).toEqual(["manual"]);
  });

  it("adds only the one necessary orthogonal bend", () => {
    const path = buildManualWirePath(
      { point: { x: 100, y: 100 } },
      { point: { x: 200, y: 200 } },
    );

    expect(path.points).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
    ]);
    expect(path.segmentModes).toEqual(["manual", "manual"]);
  });

  it("normalizes redundant manual vertices without adding terminal geometry", () => {
    const path = buildManualWirePath(
      { point: { x: 100, y: 100 } },
      { point: { x: 300, y: 300 } },
      [{ x: 100, y: 200 }],
    );

    expect(path.points).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 300 },
      { x: 300, y: 300 },
    ]);
  });

  it("allows the editor's zero-length source preview", () => {
    expect(
      buildManualWirePath(
        { point: { x: 100, y: 100 } },
        { point: { x: 100, y: 100 } },
      ),
    ).toEqual({
      points: [{ x: 100, y: 100 }],
      waypoints: [],
      segmentModes: [],
    });
  });

  it("compiles 45-degree authored legs through the same Route payload", () => {
    expect(
      compileWireDraft(
        { point: { x: 100, y: 100 } },
        { point: { x: 200, y: 160 } },
        [],
        "octilinear",
      ).points,
    ).toEqual([
      { x: 100, y: 100 },
      { x: 160, y: 160 },
      { x: 200, y: 160 },
    ]);
  });

  it("does not reinterpret earlier authored steps when mode changes", () => {
    const path = compileWireDraft(
      { point: { x: 0, y: 0 } },
      { point: { x: 200, y: 100 } },
      [{ point: { x: 100, y: 0 }, routingMode: "orthogonal" }],
      "octilinear",
    );
    expect(path.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 100 },
    ]);
  });
});

describe("orthogonal corner order", () => {
  const from = { point: { x: 0, y: 0 } };
  const to = { point: { x: 100, y: 60 } };

  it("turns horizontally first by default", () => {
    expect(compileWireDraft(from, to).points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 60 },
    ]);
  });

  it("turns vertically first when the corner is flipped", () => {
    expect(
      compileWireDraft(from, to, [], "orthogonal", "vertical-first").points,
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 60 },
      { x: 100, y: 60 },
    ]);
  });

  it("keeps the flip explicit against the incoming direction", () => {
    // Auto would carry the incoming vertical leg through; horizontal-first
    // must win over that inherited direction.
    const steps = [
      { point: { x: 0, y: 40 }, routingMode: "orthogonal" as const },
    ];
    expect(
      compileWireDraft(from, to, steps, "orthogonal", "horizontal-first")
        .points,
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 100, y: 40 },
      { x: 100, y: 60 },
    ]);
  });
});

describe("free-angle authoring", () => {
  it("draws the straight line that reaches the click", () => {
    // ADR 0039: no elbow is inserted, so the wire lands at whatever angle
    // reaches the endpoint.
    expect(
      compileWireDraft(
        { point: { x: 0, y: 0 } },
        { point: { x: 130, y: 40 } },
        [],
        "free",
      ).points,
    ).toEqual([
      { x: 0, y: 0 },
      { x: 130, y: 40 },
    ]);
  });

  it("keeps a free leg free while earlier legs stay as authored", () => {
    const steps = [
      { point: { x: 60, y: 0 }, routingMode: "orthogonal" as const },
    ];
    expect(
      compileWireDraft(
        { point: { x: 0, y: 0 } },
        { point: { x: 130, y: 40 } },
        steps,
        "free",
      ).points,
    ).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 130, y: 40 },
    ]);
  });
});
