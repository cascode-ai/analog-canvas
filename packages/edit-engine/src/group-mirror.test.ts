/**
 * Mirroring a selection as one drawing: wires with no parts, the mirror's
 * own axis, and the labels a mirrored wire carries.
 */
import {
  createEmptyDocument,
  createRoutePath,
  routeBends,
  routeEnd,
  type Annotation,
  type SchematicDocument,
} from "@icm/model";
import {
  resolveAnnotationPresentation,
  resolveDocumentRoutingGeometry,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { executeTransaction } from "./transaction.js";
import { planRoutingTransform } from "./routing-transform-planner.js";
import { proposeGroupReflectionEdits } from "./routing-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const context = { symbolResolver: resolver };

function apply(document: SchematicDocument, edits: readonly unknown[]) {
  const result = executeTransaction(
    document,
    {
      transactionId: `mirror-${document.revision}`,
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human" as const, id: "group-mirror-test" },
      edits,
    },
    context,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.document;
}

/** A loose wire between two Junctions, optionally through bends. */
function looseWire(
  points: { from: { x: number; y: number }; to: { x: number; y: number } },
  bends: { x: number; y: number }[] = [],
): SchematicDocument {
  const document = createEmptyDocument("doc", "Mirror");
  document.nets.push({ id: "net-w", terminals: [] });
  document.junctions.push(
    { id: "J1", netId: "net-w", position: points.from },
    { id: "J2", netId: "net-w", position: points.to },
  );
  document.routes.push(
    createRoutePath({
      id: "wire",
      netId: "net-w",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends,
      modes: Array.from({ length: bends.length + 1 }, () => "manual" as const),
    }),
  );
  return document;
}

/** A Net Label on the wire's first leg, named through a name claim. */
function labelOnWire(
  document: SchematicDocument,
  normalOffset: number,
  alignment: Annotation["alignment"],
): void {
  const legId = document.routes[0]!.legs[0]!.id;
  document.annotations.push({
    id: "label-x",
    kind: "net-label",
    binding: { kind: "net-name", netId: "net-w" },
    netId: "net-w",
    anchor: {
      kind: "route",
      routeId: "wire",
      legId,
      t: 0.5,
      normalOffset,
      direction: "forward",
      orientation: "follow",
      fallbackPosition: { x: 0, y: 0 },
    },
    alignment,
    rotation: 0,
    locked: false,
  });
  document.connectivityEvidence.push({
    id: "claim-x",
    kind: "name-claim",
    netId: "net-w",
    name: "X",
    scope: "local",
    owner: { kind: "net-label", annotationId: "label-x" },
  });
}

function labelBox(document: SchematicDocument) {
  const annotation = document.annotations.find(
    (candidate) => candidate.id === "label-x",
  )!;
  return resolveAnnotationPresentation(
    document,
    resolver,
    annotation,
    resolveDocumentStyleProfile(document.presentation),
  ).bounds;
}

const wireOnly = {
  instanceIds: [],
  routeIds: ["wire"],
  junctionIds: [],
  annotationIds: [],
};

describe("group mirror", () => {
  it("mirrors a selection of wire alone and keeps its connections", () => {
    // An L: right along the top, then down.
    const document = looseWire({ from: { x: 0, y: 0 }, to: { x: 40, y: 30 } }, [
      { x: 40, y: 0 },
    ]);
    const plan = planRoutingTransform(document, resolver, wireOnly, {
      kind: "mirror",
      axis: "y",
    });
    expect(plan.diagnostics).toEqual([]);
    const mirrored = apply(document, plan.edits);

    const junction = (id: string) =>
      mirrored.junctions.find((candidate) => candidate.id === id)!.position;
    // Mirrored about the wire's own centre line, x = 20: the L now runs left
    // along the top and then down.
    expect(junction("J1")).toEqual({ x: 40, y: 0 });
    expect(junction("J2")).toEqual({ x: 0, y: 30 });
    const wire = mirrored.routes.find((route) => route.id === "wire")!;
    expect(routeBends(wire)).toEqual([{ x: 0, y: 0 }]);
    expect(wire.start).toEqual({ kind: "junction", junctionId: "J1" });
    expect(routeEnd(wire)).toEqual({ kind: "junction", junctionId: "J2" });
    expect(mirrored.nets).toEqual(document.nets);
  });

  it("leaves the drawing alone when the selection is one Junction", () => {
    // A tee: three wires meet at J, each running out to its own loose end.
    const document = createEmptyDocument("doc", "Tee");
    document.nets.push({ id: "net-t", terminals: [] });
    document.junctions.push(
      { id: "J", netId: "net-t", position: { x: 40, y: 0 } },
      { id: "A", netId: "net-t", position: { x: 0, y: 0 } },
      { id: "B", netId: "net-t", position: { x: 80, y: 0 } },
      { id: "C", netId: "net-t", position: { x: 40, y: 40 } },
    );
    for (const end of ["A", "B", "C"]) {
      document.routes.push(
        createRoutePath({
          id: `arm-${end}`,
          netId: "net-t",
          start: { kind: "junction", junctionId: "J" },
          end: { kind: "junction", junctionId: end },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    for (const axis of ["x", "y"] as const) {
      const plan = planRoutingTransform(
        document,
        resolver,
        {
          instanceIds: [],
          routeIds: [],
          junctionIds: ["J"],
          annotationIds: [],
        },
        { kind: "mirror", axis },
      );
      const mirrored = apply(document, plan.edits);
      expect(mirrored.junctions).toEqual(document.junctions);
      expect(mirrored.routes).toEqual(document.routes);
    }
  });

  it("mirrors parts in place, so a second mirror restores them", () => {
    const document = createEmptyDocument("doc", "Pair");
    for (const [id, x] of [
      ["R1", 0],
      ["R2", 30],
    ] as const) {
      document.instances.push({
        id,
        symbolId: "resistor",
        placement: { position: { x, y: 0 }, rotation: 0, mirror: "none" },
        reference: id,
        netlist: { parameters: {} },
      });
    }
    const position = (current: SchematicDocument, id: string) =>
      current.instances.find((instance) => instance.id === id)!.placement!
        .position;

    const once = apply(
      document,
      proposeGroupReflectionEdits(
        document,
        resolver,
        ["R1", "R2"],
        "left-right",
      ).edits,
    );
    // The pair spans an odd number of half steps; the axis still sits on its
    // centre, x = 15, so the two exchange places exactly.
    expect(position(once, "R1")).toEqual({ x: 30, y: 0 });
    expect(position(once, "R2")).toEqual({ x: 0, y: 0 });

    const twice = apply(
      once,
      proposeGroupReflectionEdits(once, resolver, ["R1", "R2"], "left-right")
        .edits,
    );
    expect(position(twice, "R1")).toEqual({ x: 0, y: 0 });
    expect(position(twice, "R2")).toEqual({ x: 30, y: 0 });
  });

  it("flips a label above a wire to below it, clear of the wire", () => {
    const document = looseWire({ from: { x: 0, y: 0 }, to: { x: 60, y: 0 } });
    labelOnWire(document, -8, "middle");
    const before = labelBox(document);
    expect(before.y + before.height).toBeLessThan(0);

    const plan = planRoutingTransform(document, resolver, wireOnly, {
      kind: "mirror",
      axis: "x",
    });
    const mirrored = apply(document, plan.edits);
    const after = labelBox(mirrored);
    // The wire stays on y = 0. The text box is the mirror image of the old
    // one: the same gap, now under the wire instead of above it.
    expect(after.y).toBeGreaterThan(0);
    expect(after.y).toBeCloseTo(-(before.y + before.height), 0);
    expect(after.height).toBeCloseTo(before.height, 5);
  });

  it("moves a label beside a vertical wire to the mirrored side", () => {
    const document = looseWire({ from: { x: 0, y: 0 }, to: { x: 0, y: 60 } });
    // Right of a downward wire, growing rightward from its anchor.
    labelOnWire(document, -8, "start");
    const before = labelBox(document);
    expect(before.x).toBeGreaterThan(0);

    const plan = planRoutingTransform(document, resolver, wireOnly, {
      kind: "mirror",
      axis: "y",
    });
    const mirrored = apply(document, plan.edits);
    const label = mirrored.annotations.find(
      (candidate) => candidate.id === "label-x",
    )!;
    // Left of the wire now, so the text grows leftward from its anchor.
    expect(label.alignment).toBe("end");
    const after = labelBox(mirrored);
    expect(after.x + after.width).toBeCloseTo(-before.x, 0);
    expect(after.width).toBeCloseTo(before.width, 5);
  });

  it("moves, turns and mirrors parts older versions joined pin to pin", () => {
    // R2's top pin sits on R1's bottom pin, and an older version drew a
    // zero-length wire between them; R1's top pin has a wire whose first
    // bend sits on the pin itself. Rewriting either as it was is refused.
    const document = createEmptyDocument("doc", "Contacts");
    for (const [id, y] of [
      ["R1", 0],
      ["R2", 40],
    ] as const) {
      document.instances.push({
        id,
        symbolId: "resistor",
        placement: { position: { x: 0, y }, rotation: 0, mirror: "none" },
        reference: id,
        netlist: { parameters: { value: "1k" } },
      });
    }
    document.nets.push(
      {
        id: "net-mid",
        terminals: [
          { instanceId: "R1", pinName: "2" },
          { instanceId: "R2", pinName: "1" },
        ],
      },
      { id: "net-top", terminals: [{ instanceId: "R1", pinName: "1" }] },
    );
    document.junctions.push({
      id: "J",
      netId: "net-top",
      position: { x: 40, y: -20 },
    });
    document.routes.push(
      createRoutePath({
        id: "contact",
        netId: "net-mid",
        start: { kind: "terminal", instanceId: "R1", pinName: "2" },
        end: { kind: "terminal", instanceId: "R2", pinName: "1" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "stub",
        netId: "net-top",
        start: { kind: "terminal", instanceId: "R1", pinName: "1" },
        end: { kind: "junction", junctionId: "J" },
        bends: [{ x: 0, y: -20 }],
        modes: ["manual", "manual"],
      }),
    );
    const seed = {
      instanceIds: ["R1", "R2"],
      routeIds: ["contact", "stub"],
      junctionIds: ["J"],
      annotationIds: [],
    };
    for (const operation of [
      { kind: "translate" as const, delta: { x: 20, y: 0 } },
      { kind: "rotate" as const, degrees: 90 as const },
      { kind: "mirror" as const, axis: "y" as const },
    ]) {
      const plan = planRoutingTransform(document, resolver, seed, operation);
      const moved = apply(document, plan.edits);
      // The contact keeps both pins on one Net without its empty wire.
      expect(moved.routes.map((route) => route.id)).toEqual(["stub"]);
      expect(moved.nets).toEqual(document.nets);
      expect(routeBends(moved.routes[0]!)).toEqual([]);
    }
  });

  it("rotates an RC group with its route-anchored and free Net labels clear of wires through 360°", () => {
    const document = createEmptyDocument("rc-group", "RC group rotation");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        reference: "R1",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 270,
          mirror: "none",
        },
        netlist: { parameters: { value: "10k" } },
      },
      {
        id: "C1",
        symbolId: "capacitor",
        reference: "C1",
        placement: {
          position: { x: 240, y: 120 },
          rotation: 0,
          mirror: "none",
        },
        netlist: { parameters: { value: "10n" } },
      },
    );
    document.nets.push({
      id: "net-out",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "C1", pinName: "1" },
      ],
    });
    const wire = createRoutePath({
      id: "W1",
      netId: "net-out",
      start: { kind: "terminal", instanceId: "R1", pinName: "2" },
      end: { kind: "terminal", instanceId: "C1", pinName: "1" },
      bends: [],
      modes: ["manual"],
    });
    document.routes.push(wire);
    document.annotations.push(
      {
        id: "net-label-out",
        kind: "net-label",
        netId: "net-out",
        binding: { kind: "net-name", netId: "net-out" },
        anchor: {
          kind: "route",
          routeId: "W1",
          legId: wire.legs[0]!.id,
          t: 0.5,
          normalOffset: -10,
          direction: "forward",
          orientation: "horizontal",
          fallbackPosition: { x: 180, y: 90 },
        },
        alignment: "start",
        rotation: 0,
        locked: false,
      },
      {
        id: "free-label-out",
        kind: "net-label",
        netId: "net-out",
        binding: { kind: "net-name", netId: "net-out" },
        anchor: { kind: "free", position: { x: 190, y: 60 } },
        alignment: "start",
        rotation: 0,
        locked: false,
      },
    );
    document.connectivityEvidence.push({
      id: "claim-out",
      kind: "name-claim",
      netId: "net-out",
      name: "Vout",
      scope: "local",
      owner: { kind: "net-label", annotationId: "net-label-out" },
    });

    const seed = {
      instanceIds: ["R1", "C1"],
      routeIds: ["W1"],
      junctionIds: [],
      annotationIds: ["net-label-out", "free-label-out"],
    };
    const styleProfile = resolveDocumentStyleProfile(document.presentation);
    let current = document;
    for (let step = 0; step < 4; step += 1) {
      const plan = planRoutingTransform(current, resolver, seed, {
        kind: "rotate",
        degrees: 90,
      });
      expect(plan.diagnostics).toEqual([]);
      current = apply(current, plan.edits);

      const geometry = resolveDocumentRoutingGeometry(current, resolver);
      const segment = geometry.routes.get("W1")!.segments[0]!;
      const routeLabel = current.annotations.find(
        (annotation) => annotation.id === "net-label-out",
      )!;
      const ink = resolveAnnotationPresentation(
        current,
        resolver,
        routeLabel,
        styleProfile,
        geometry,
      ).inkBounds;
      const wireMinX = Math.min(segment.from.x, segment.to.x);
      const wireMaxX = Math.max(segment.from.x, segment.to.x);
      const wireMinY = Math.min(segment.from.y, segment.to.y);
      const wireMaxY = Math.max(segment.from.y, segment.to.y);
      // The wire label must stay clear of its wire at every quarter turn.
      const crossesWire =
        ink.x <= wireMaxX &&
        ink.x + ink.width >= wireMinX &&
        ink.y <= wireMaxY &&
        ink.y + ink.height >= wireMinY;
      expect(crossesWire, `step ${step + 1}`).toBe(false);
    }

    expect(current.instances.map((instance) => instance.placement)).toEqual(
      document.instances.map((instance) => instance.placement),
    );
    const freeAfter = current.annotations.find(
      (annotation) => annotation.id === "free-label-out",
    )!;
    const freeBefore = document.annotations.find(
      (annotation) => annotation.id === "free-label-out",
    )!;
    expect(freeAfter.alignment).toBe(freeBefore.alignment);
    expect(freeAfter.anchor).toEqual(freeBefore.anchor);
  });

  it("rotates a 270° vertical wire label cleanly with its wire without crossing it", () => {
    const document = createEmptyDocument("vert-wire-rot", "Vertical wire rot");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        reference: "R1",
        placement: {
          position: { x: 200, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "C1",
        symbolId: "capacitor",
        reference: "C1",
        placement: {
          position: { x: 200, y: 240 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-v",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "C1", pinName: "1" },
      ],
    });
    const wire = createRoutePath({
      id: "W_vert",
      netId: "net-v",
      start: { kind: "terminal", instanceId: "R1", pinName: "2" },
      end: { kind: "terminal", instanceId: "C1", pinName: "1" },
      bends: [],
      modes: ["manual"],
    });
    document.routes.push(wire);
    document.annotations.push({
      id: "net-label-vert",
      kind: "net-label",
      netId: "net-v",
      binding: { kind: "net-name", netId: "net-v" },
      anchor: {
        kind: "route",
        routeId: "W_vert",
        legId: wire.legs[0]!.id,
        t: 0.5,
        normalOffset: -10,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 190, y: 170 },
      },
      alignment: "middle",
      rotation: 270,
      locked: false,
    });
    document.connectivityEvidence.push({
      id: "claim-v",
      kind: "name-claim",
      netId: "net-v",
      name: "Vmid",
      scope: "local",
      owner: { kind: "net-label", annotationId: "net-label-vert" },
    });

    const seed = {
      instanceIds: ["R1", "C1"],
      routeIds: ["W_vert"],
      junctionIds: [],
      annotationIds: ["net-label-vert"],
    };
    const styleProfile = resolveDocumentStyleProfile(document.presentation);
    let current = document;
    for (let step = 0; step < 4; step += 1) {
      const plan = planRoutingTransform(current, resolver, seed, {
        kind: "rotate",
        degrees: 90,
      });
      expect(plan.diagnostics).toEqual([]);
      current = apply(current, plan.edits);

      const geometry = resolveDocumentRoutingGeometry(current, resolver);
      const segment = geometry.routes.get("W_vert")!.segments[0]!;
      const label = current.annotations.find((a) => a.id === "net-label-vert")!;
      expect(label.rotation, `step ${step + 1}`).toBe(0);
      const ink = resolveAnnotationPresentation(
        current,
        resolver,
        label,
        styleProfile,
        geometry,
      ).inkBounds;
      const wireMinX = Math.min(segment.from.x, segment.to.x);
      const wireMaxX = Math.max(segment.from.x, segment.to.x);
      const wireMinY = Math.min(segment.from.y, segment.to.y);
      const wireMaxY = Math.max(segment.from.y, segment.to.y);
      const crossesWire =
        ink.x <= wireMaxX &&
        ink.x + ink.width >= wireMinX &&
        ink.y <= wireMaxY &&
        ink.y + ink.height >= wireMinY;
      expect(crossesWire, `step ${step + 1}`).toBe(false);
    }

    const halfTurnPlan = planRoutingTransform(document, resolver, seed, {
      kind: "rotate",
      degrees: 180,
    });
    expect(halfTurnPlan.diagnostics).toEqual([]);
    const halfTurned = apply(document, halfTurnPlan.edits);
    const halfTurnLabel = halfTurned.annotations.find(
      (a) => a.id === "net-label-vert",
    )!;
    expect(halfTurnLabel.rotation).toBe(270);
    expect(halfTurnLabel.alignment).toBe("end");
  });
});
