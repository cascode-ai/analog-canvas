import { describe, expect, it } from "vitest";

import { buildManualWirePath, compileWireDraft } from "./routing-planner.js";

const at = (x: number, y: number) => ({
  connection: {
    contactPoint: { x, y },
    gridLanding: { x, y },
    escapePath: [],
    outward: null,
  },
});

describe("buildManualWirePath", () => {
  it("keeps a direct terminal right-angle at the exact electrical endpoint", () => {
    const path = buildManualWirePath(at(100, 100), at(100, 200));

    expect(path.points).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 200 },
    ]);
    expect(path.segmentModes).toEqual(["manual"]);
  });

  it("adds only the one necessary orthogonal bend", () => {
    const path = buildManualWirePath(at(100, 100), at(200, 200));

    expect(path.points).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
    ]);
    expect(path.segmentModes).toEqual(["manual", "manual"]);
  });

  it("normalizes redundant manual vertices without adding terminal geometry", () => {
    const path = buildManualWirePath(at(100, 100), at(300, 300), [
      { x: 100, y: 200 },
    ]);

    expect(path.points).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 300 },
      { x: 300, y: 300 },
    ]);
  });

  it("allows the editor's zero-length source preview", () => {
    expect(buildManualWirePath(at(100, 100), at(100, 100))).toEqual({
      points: [{ x: 100, y: 100 }],
      waypoints: [],
      segmentModes: [],
    });
  });

  it("compiles 45-degree authored legs through the same Route payload", () => {
    expect(
      compileWireDraft(at(100, 100), at(200, 160), [], "octilinear").points,
    ).toEqual([
      { x: 100, y: 100 },
      { x: 160, y: 160 },
      { x: 200, y: 160 },
    ]);
  });

  it("does not reinterpret earlier authored steps when mode changes", () => {
    const path = compileWireDraft(
      at(0, 0),
      at(200, 100),
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
  const from = at(0, 0);
  const to = at(100, 60);

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
    expect(compileWireDraft(at(0, 0), at(130, 40), [], "free").points).toEqual([
      { x: 0, y: 0 },
      { x: 130, y: 40 },
    ]);
  });

  it("keeps a free leg free while earlier legs stay as authored", () => {
    const steps = [
      { point: { x: 60, y: 0 }, routingMode: "orthogonal" as const },
    ];
    expect(
      compileWireDraft(at(0, 0), at(130, 40), steps, "free").points,
    ).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 130, y: 40 },
    ]);
  });
});

describe("free-angle routes follow their instances", () => {
  it("does not skip a leg that is neither axis-aligned nor 45 degrees", () => {
    // The follow-stretch used to require octilinear geometry, so a free-angle
    // Route silently stopped following the instance it was drawn from.
    expect(
      compileWireDraft(at(0, 0), at(90, 25), [], "free").segmentModes,
    ).toEqual(["manual"]);
  });
});

describe("doubled-back legs", () => {
  const step = (x: number, y: number) =>
    ({
      point: { x, y },
      routingMode: "orthogonal",
      cornerOrder: "auto",
    }) as never;

  it("drops a leg that folds back over the one before it", () => {
    // Pull left, then drift back right while heading down: the wire retraced
    // the line it had just drawn before turning.
    expect(
      compileWireDraft(at(100, 100), at(90, 150), [step(80, 100)]).points,
    ).toEqual([
      { x: 100, y: 100 },
      { x: 90, y: 100 },
      { x: 90, y: 150 },
    ]);
  });

  it("drops an overshoot that came back, stub and all", () => {
    // Down past the corner and back up left the overshoot hanging in mid-air.
    expect(
      compileWireDraft(at(100, 100), at(80, 150), [
        step(80, 100),
        step(80, 200),
      ]).points,
    ).toEqual([
      { x: 100, y: 100 },
      { x: 80, y: 100 },
      { x: 80, y: 150 },
    ]);
  });

  it("collapses a wander that crossed its own path twice", () => {
    expect(
      compileWireDraft(at(100, 100), at(120, 150), [
        step(60, 100),
        step(120, 100),
        step(120, 200),
      ]).points,
    ).toEqual([
      { x: 100, y: 100 },
      { x: 120, y: 100 },
      { x: 120, y: 150 },
    ]);
  });

  it("leaves an ordinary corner alone", () => {
    expect(compileWireDraft(at(100, 100), at(200, 200), []).points).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
    ]);
  });
});
