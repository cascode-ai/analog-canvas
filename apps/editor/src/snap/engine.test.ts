import { describe, expect, it } from "vitest";

import {
  resolvePointSnap,
  resolveTranslationSnap,
  SNAP_PROFILES,
} from "./engine";
import type { SnapAnchor } from "./engine";

describe("unified Snap Engine", () => {
  it("keeps appended electrical projections with a retained canvas target set", () => {
    const moving: SnapAnchor = {
      id: "moving-pin",
      kind: "pin",
      point: { x: 0, y: 0 },
      electrical: {
        kind: "endpoint",
        endpoint: { kind: "terminal", instanceId: "R1", pinName: "1" },
        netId: null,
      },
    };
    const target: SnapAnchor = {
      id: "dynamic-route",
      kind: "route",
      point: { x: 20, y: 20 },
      acceptsMovingAnchorId: moving.id,
      electrical: {
        kind: "route",
        routeId: "wire",
        segmentIndex: 0,
        netId: "net-wire",
      },
    };
    const request = {
      movingAnchors: [moving],
      targetAnchors: [
        {
          id: "canvas-origin",
          kind: "instance-center" as const,
          point: { x: 100, y: 100 },
        },
      ],
      rawDelta: { x: 19, y: 19 },
      primaryAnchorId: moving.id,
      grid: 10,
      tolerance: 3,
      profile: SNAP_PROFILES.instancePlacement,
    };
    const combined = resolveTranslationSnap({
      ...request,
      targetAnchors: [...request.targetAnchors, target],
    });
    const separated = resolveTranslationSnap({
      ...request,
      ...{ additionalTargetAnchors: [target] },
    });
    expect(separated.electricalMatch?.target.id).toBe("dynamic-route");
    expect(separated.delta).toEqual({ x: 20, y: 20 });
    expect(separated).toEqual(combined);
  });

  it("invalidates coordinate indexing when a reused target array moves or reorders", () => {
    const targets: SnapAnchor[] = Array.from({ length: 100 }, (_, i) => ({
      id: `t${i}`,
      kind: "instance-center",
      point: { x: i === 0 ? 30 : 10000 + i * 100, y: 10000 },
    }));
    const request = {
      rawDelta: { x: 29, y: 12 },
      movingAnchors: [
        { id: "m", kind: "instance-center" as const, point: { x: 0, y: 0 } },
      ],
      targetAnchors: targets,
      primaryAnchorId: "m",
      grid: 10,
      tolerance: 3,
      profile: SNAP_PROFILES.instanceMove,
    };
    const captured = resolveTranslationSnap(request);
    expect(captured.xMatch?.targetAnchorId).toBe("t0");
    targets[0]!.point.x = 50;
    const released = resolveTranslationSnap(request, captured);
    expect(released.guides).toEqual([]);
    targets[1]!.point.x = 30;
    targets.reverse();
    expect(
      resolveTranslationSnap(request, released).xMatch?.targetAnchorId,
    ).toBe("t1");
  });
  it("keeps distant axis alignment without comparing every group anchor to far targets", () => {
    let reads = 0;
    const targetAnchors: SnapAnchor[] = Array.from({ length: 1000 }, (_, i) => {
      const point =
        i === 0
          ? { x: 30, y: 10000 }
          : { x: 50000 + i * 100, y: 60000 + i * 10 };
      return {
        id: `target-${i}`,
        kind: "instance-center",
        get point() {
          reads++;
          return point;
        },
      };
    });
    const result = resolveTranslationSnap({
      rawDelta: { x: 29, y: 12 },
      movingAnchors: Array.from({ length: 100 }, (_, i) => ({
        id: `moving-${i}`,
        kind: "instance-center" as const,
        point: { x: 0, y: 0 },
      })),
      targetAnchors,
      primaryAnchorId: "moving-0",
      grid: 10,
      tolerance: 3,
      profile: SNAP_PROFILES.instanceMove,
    });
    expect(result.delta).toEqual({ x: 30, y: 10 });
    expect(result.guides).toEqual([
      {
        axis: "x",
        coordinate: 30,
        from: 12,
        to: 10000,
        kind: "instance-center",
      },
    ]);
    expect(reads).toBeLessThan(5000);
  });
  it("keeps the retained contact when another equally close pin sorts first", () => {
    const pin = (id: string, x: number) => ({
      id,
      point: { x, y: 0 },
      kind: "pin" as const,
      electrical: {
        kind: "endpoint" as const,
        endpoint: { kind: "terminal" as const, instanceId: id, pinName: "1" },
        netId: null,
      },
    });
    const request = {
      rawDelta: { x: 30, y: 0 },
      movingAnchors: [pin("moving", 0)],
      targetAnchors: [pin("a-left", 20), pin("z-right", 30)],
      primaryAnchorId: "moving",
      grid: 10,
      tolerance: 14,
      profile: SNAP_PROFILES.instanceMove,
    };
    const captured = resolveTranslationSnap(request);
    const retained = resolveTranslationSnap(
      { ...request, rawDelta: { x: 25, y: 0 } },
      captured,
    );
    expect(retained.delta).toEqual({ x: 30, y: 0 });
    expect(retained.electricalMatch?.target.id).toBe("z-right");
  });

  it.each([
    { tolerance: 14, nudge: 4 },
    { tolerance: 2, nudge: 2.5 },
  ])(
    "keeps electrical contact while both captured axes are retained (tolerance $tolerance)",
    ({ tolerance, nudge }) => {
      const pin = (id: string, x: number, y: number) => ({
        id,
        point: { x, y },
        kind: "pin" as const,
        electrical: {
          kind: "endpoint" as const,
          endpoint: { kind: "terminal" as const, instanceId: id, pinName: "1" },
          netId: null,
        },
      });
      const request = {
        rawDelta: { x: 20, y: 20 },
        movingAnchors: [pin("moving", 0, 0)],
        targetAnchors: [pin("target", 20, 20)],
        primaryAnchorId: "moving",
        grid: 10,
        tolerance,
        profile: SNAP_PROFILES.instanceMove,
      };
      const captured = resolveTranslationSnap(request);
      expect(captured.electricalMatch?.target.id).toBe("target");
      const retained = resolveTranslationSnap(
        { ...request, rawDelta: { x: 20 + nudge, y: 20 + nudge } },
        captured,
      );
      expect(retained.delta).toEqual({ x: 20, y: 20 });
      expect(retained.electricalMatch?.target.id).toBe("target");
      const released = resolveTranslationSnap(
        { ...request, rawDelta: { x: 26, y: 26 } },
        retained,
      );
      expect(released.delta).toEqual({ x: 30, y: 30 });
      expect(released.electricalMatch).toBeUndefined();
    },
  );

  it("does not let an exact contact steal an axis before its release condition", () => {
    const request = {
      rawDelta: { x: 29, y: 10 },
      movingAnchors: [
        {
          id: "origin",
          point: { x: 0, y: 0 },
          kind: "instance-center" as const,
        },
        {
          id: "pin",
          point: { x: 0, y: 0 },
          kind: "pin" as const,
          electrical: {
            kind: "endpoint" as const,
            endpoint: {
              kind: "terminal" as const,
              instanceId: "R",
              pinName: "1",
            },
            netId: null,
          },
        },
      ],
      targetAnchors: [
        {
          id: "alignment",
          point: { x: 30, y: 1000 },
          kind: "instance-center" as const,
          axes: ["x" as const],
        },
        {
          id: "contact",
          point: { x: 20, y: 0 },
          kind: "pin" as const,
          electrical: {
            kind: "endpoint" as const,
            endpoint: {
              kind: "terminal" as const,
              instanceId: "other",
              pinName: "1",
            },
            netId: null,
          },
        },
      ],
      primaryAnchorId: "origin",
      grid: 10,
      tolerance: 14,
      profile: SNAP_PROFILES.instanceMove,
    };
    const captured = resolveTranslationSnap(request);
    const retained = resolveTranslationSnap(
      { ...request, rawDelta: { x: 25, y: 0 } },
      captured,
    );
    expect(retained.delta).toEqual({ x: 30, y: 0 });
    expect(retained.electricalMatch).toBeUndefined();
    const released = resolveTranslationSnap(
      { ...request, rawDelta: { x: 24, y: 0 } },
      retained,
    );
    expect(released.delta).toEqual({ x: 20, y: 0 });
    expect(released.electricalMatch?.target.id).toBe("contact");
  });

  it("can reach each next grid step even when zoomed-out alignment tolerance covers several steps", () => {
    const request = {
      rawDelta: { x: 10, y: 0 },
      movingAnchors: [
        {
          id: "moving",
          point: { x: 0, y: 0 },
          kind: "instance-center" as const,
        },
      ],
      targetAnchors: [
        {
          id: "alignment",
          point: { x: 10, y: 100 },
          kind: "instance-center" as const,
          axes: ["x" as const],
        },
      ],
      primaryAnchorId: "moving",
      grid: 10,
      tolerance: 28,
      profile: SNAP_PROFILES.instanceMove,
    };
    let previous = resolveTranslationSnap(request);
    const deltas = [previous.delta.x];
    for (const x of [20, 30, 40]) {
      previous = resolveTranslationSnap(
        { ...request, rawDelta: { x, y: 0 } },
        previous,
      );
      deltas.push(previous.delta.x);
    }
    expect(deltas).toEqual([10, 20, 30, 40]);
  });

  it("resolves independent x/y extension-line matches before the grid", () => {
    const result = resolveTranslationSnap({
      rawDelta: { x: 18, y: 27 },
      movingAnchors: [
        { id: "moving-center", point: { x: 0, y: 0 }, kind: "instance-center" },
      ],
      targetAnchors: [
        {
          id: "vertical-center",
          point: { x: 20, y: 100 },
          kind: "instance-center",
          axes: ["x"],
        },
        {
          id: "horizontal-center",
          point: { x: 100, y: 30 },
          kind: "instance-center",
          axes: ["y"],
        },
      ],
      primaryAnchorId: "moving-center",
      grid: 10,
      tolerance: 4,
      profile: SNAP_PROFILES.instanceMove,
    });

    expect(result.delta).toEqual({ x: 20, y: 30 });
    expect(result.xMatch?.targetAnchorId).toBe("vertical-center");
    expect(result.yMatch?.targetAnchorId).toBe("horizontal-center");
    expect(result.guides).toHaveLength(2);
  });

  it("keeps a captured axis until the larger release tolerance is exceeded", () => {
    const request = {
      rawDelta: { x: 9, y: 0 },
      movingAnchors: [
        {
          id: "moving",
          point: { x: 0, y: 0 },
          kind: "instance-center" as const,
        },
      ],
      targetAnchors: [
        {
          id: "target",
          point: { x: 10, y: 20 },
          kind: "instance-center" as const,
          axes: ["x" as const],
        },
      ],
      primaryAnchorId: "moving",
      grid: 10,
      tolerance: 2,
      profile: SNAP_PROFILES.instanceMove,
    };
    const first = resolveTranslationSnap(request);
    const retained = resolveTranslationSnap(
      { ...request, rawDelta: { x: 12.5, y: 0 } },
      first,
    );

    expect(first.delta.x).toBe(10);
    expect(retained.delta.x).toBe(10);
  });

  it("returns the same resolved delta when pointer-up reuses the preview result", () => {
    const request = {
      rawDelta: { x: 18, y: 19 },
      movingAnchors: [
        {
          id: "moving",
          point: { x: 0, y: 0 },
          kind: "instance-center" as const,
        },
      ],
      targetAnchors: [
        {
          id: "target",
          point: { x: 20, y: 20 },
          kind: "instance-center" as const,
        },
      ],
      primaryAnchorId: "moving",
      grid: 10,
      tolerance: 4,
      profile: SNAP_PROFILES.instanceMove,
    };
    const preview = resolveTranslationSnap(request);
    const commit = resolveTranslationSnap(request, preview);

    expect(commit.delta).toEqual(preview.delta);
    expect(commit.guides).toEqual(preview.guides);
  });

  it("uses the declared primary anchor for group grid snapping", () => {
    const result = resolveTranslationSnap({
      rawDelta: { x: 4, y: 4 },
      movingAnchors: [
        { id: "other", point: { x: 3, y: 3 }, kind: "instance-center" },
        { id: "primary", point: { x: 10, y: 10 }, kind: "instance-center" },
      ],
      targetAnchors: [],
      primaryAnchorId: "primary",
      grid: 10,
      tolerance: 2,
      profile: SNAP_PROFILES.instanceMove,
    });

    expect(result.delta).toEqual({ x: 0, y: 0 });
  });

  it("does not align an instance center to an unrelated pin axis", () => {
    const result = resolveTranslationSnap({
      rawDelta: { x: 18, y: 0 },
      movingAnchors: [
        { id: "center", point: { x: 0, y: 0 }, kind: "instance-center" },
      ],
      targetAnchors: [
        {
          id: "pin",
          point: { x: 20, y: 0 },
          kind: "pin",
          electrical: {
            kind: "endpoint",
            endpoint: { kind: "terminal", instanceId: "R1", pinName: "1" },
            netId: null,
          },
        },
      ],
      primaryAnchorId: "center",
      grid: 10,
      tolerance: 4,
      profile: SNAP_PROFILES.instanceMove,
    });

    expect(result.xMatch?.targetKind).toBe("grid");
  });

  it("rejects a boundary match that would move an instance off grid", () => {
    const result = resolveTranslationSnap({
      rawDelta: { x: 21, y: 0 },
      movingAnchors: [
        { id: "origin", point: { x: 0, y: 0 }, kind: "instance-center" },
        {
          id: "right-edge",
          point: { x: 5, y: 0 },
          kind: "instance-edge",
          axes: ["x"],
        },
      ],
      targetAnchors: [
        {
          id: "peer-edge",
          point: { x: 28, y: 0 },
          kind: "instance-edge",
          axes: ["x"],
        },
      ],
      primaryAnchorId: "origin",
      grid: 10,
      tolerance: 4,
      profile: SNAP_PROFILES.instanceMove,
    });

    expect(result.delta.x).toBe(20);
    expect(result.xMatch?.targetKind).toBe("grid");
  });

  it("returns an exact compatible electrical match for connection semantics", () => {
    const movingEndpoint = {
      kind: "terminal" as const,
      instanceId: "M1",
      pinName: "D",
    };
    const targetEndpoint = { kind: "junction" as const, junctionId: "j1" };
    const result = resolveTranslationSnap({
      rawDelta: { x: 9, y: 11 },
      movingAnchors: [
        {
          id: "moving-pin",
          point: { x: 0, y: 0 },
          kind: "pin",
          electrical: {
            kind: "endpoint",
            endpoint: movingEndpoint,
            netId: null,
          },
        },
      ],
      targetAnchors: [
        {
          id: "target-junction",
          point: { x: 10, y: 10 },
          kind: "junction",
          electrical: {
            kind: "endpoint",
            endpoint: targetEndpoint,
            netId: "n1",
          },
        },
      ],
      primaryAnchorId: "moving-pin",
      grid: 10,
      tolerance: 3,
      profile: SNAP_PROFILES.instanceMove,
    });

    expect(result.delta).toEqual({ x: 10, y: 10 });
    expect(result.electricalMatch?.moving.electrical).toMatchObject({
      kind: "endpoint",
      endpoint: movingEndpoint,
    });
    expect(result.electricalMatch?.target.electrical).toMatchObject({
      kind: "endpoint",
      endpoint: targetEndpoint,
    });
  });

  it("snaps one moving pin to its projected Route contact", () => {
    const result = resolveTranslationSnap({
      rawDelta: { x: 19, y: 20 },
      movingAnchors: [
        {
          id: "moving-pin",
          point: { x: 0, y: 0 },
          kind: "pin",
          electrical: {
            kind: "endpoint",
            endpoint: { kind: "terminal", instanceId: "M1", pinName: "D" },
            netId: null,
          },
        },
      ],
      targetAnchors: [
        {
          id: "route-contact",
          point: { x: 20, y: 20 },
          kind: "route",
          acceptsMovingAnchorId: "moving-pin",
          electrical: {
            kind: "route",
            routeId: "route-bias",
            segmentIndex: 0,
            netId: "net-bias",
          },
        },
      ],
      primaryAnchorId: "moving-pin",
      grid: 10,
      tolerance: 3,
      profile: SNAP_PROFILES.instanceMove,
    });

    expect(result.delta).toEqual({ x: 20, y: 20 });
    expect(result.electricalMatch?.target.electrical).toMatchObject({
      kind: "route",
      routeId: "route-bias",
    });
  });

  it("offers exact endpoint snap across Base Nets for the contact planner", () => {
    const result = resolveTranslationSnap({
      rawDelta: { x: 9, y: 10 },
      movingAnchors: [
        {
          id: "moving-pin",
          point: { x: 0, y: 0 },
          kind: "pin",
          electrical: {
            kind: "endpoint",
            endpoint: { kind: "terminal", instanceId: "A", pinName: "P" },
            netId: "net-a",
          },
        },
      ],
      targetAnchors: [
        {
          id: "target-pin",
          point: { x: 10, y: 10 },
          kind: "pin",
          electrical: {
            kind: "endpoint",
            endpoint: { kind: "terminal", instanceId: "B", pinName: "P" },
            netId: "net-b",
          },
        },
      ],
      primaryAnchorId: "moving-pin",
      grid: 10,
      tolerance: 3,
      profile: SNAP_PROFILES.instanceMove,
    });

    expect(result.delta).toEqual({ x: 10, y: 10 });
    expect(result.electricalMatch?.target.id).toBe("target-pin");
  });

  it("prefers an explicit endpoint over its coincident Route projection", () => {
    const moving = {
      id: "moving-pin",
      point: { x: 0, y: 0 },
      kind: "pin" as const,
      electrical: {
        kind: "endpoint" as const,
        endpoint: { kind: "terminal" as const, instanceId: "M1", pinName: "D" },
        netId: null,
      },
    };
    const result = resolveTranslationSnap({
      rawDelta: { x: 20, y: 20 },
      movingAnchors: [moving],
      targetAnchors: [
        {
          id: "aaa-route",
          point: { x: 20, y: 20 },
          kind: "route",
          electrical: {
            kind: "route",
            routeId: "r1",
            segmentIndex: 0,
            netId: "n1",
          },
        },
        {
          id: "zzz-junction",
          point: { x: 20, y: 20 },
          kind: "junction",
          electrical: {
            kind: "endpoint",
            endpoint: { kind: "junction", junctionId: "j1" },
            netId: "n1",
          },
        },
      ],
      primaryAnchorId: moving.id,
      grid: 10,
      tolerance: 3,
      profile: SNAP_PROFILES.instanceMove,
    });

    expect(result.electricalMatch?.target.id).toBe("zzz-junction");
  });

  it("does not turn drafting point snap into an electrical match", () => {
    const result = resolvePointSnap(
      { x: 12, y: 12 },
      [
        {
          id: "pin",
          point: { x: 10, y: 10 },
          kind: "pin",
          electrical: {
            kind: "endpoint",
            endpoint: { kind: "terminal", instanceId: "M1", pinName: "G" },
            netId: null,
          },
        },
      ],
      { grid: 10, tolerance: 4, profile: SNAP_PROFILES.draftingHandle },
    );

    expect(result.delta).toEqual({ x: -2, y: -2 });
    expect(result.electricalMatch).toBeUndefined();
    expect(result.pointMatch?.id).toBe("pin");
  });

  it("lets Wire snap to drafting geometry without creating an electrical match", () => {
    const result = resolvePointSnap(
      { x: 12, y: 12 },
      [{ id: "rectangle-edge", point: { x: 10, y: 10 }, kind: "drafting" }],
      { grid: 10, tolerance: 4, profile: SNAP_PROFILES.wire },
    );

    expect(result.delta).toEqual({ x: -2, y: -2 });
    expect(result.pointMatch?.id).toBe("rectangle-edge");
    expect(result.electricalMatch).toBeUndefined();
  });

  it("excludes the active Wire source and reports equal coincident targets", () => {
    const result = resolvePointSnap(
      { x: 10, y: 10 },
      [
        { id: "source", point: { x: 10, y: 10 }, kind: "pin" },
        { id: "target-a", point: { x: 10, y: 10 }, kind: "pin" },
        { id: "target-b", point: { x: 10, y: 10 }, kind: "pin" },
      ],
      {
        grid: 10,
        tolerance: 4,
        profile: SNAP_PROFILES.wire,
        excludedTargetIds: new Set(["source"]),
      },
    );

    expect(result.pointMatch?.id).toBe("target-a");
    expect(result.pointMatches?.map((target) => target.id)).toEqual([
      "target-a",
      "target-b",
    ]);
  });
});
