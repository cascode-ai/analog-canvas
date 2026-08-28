/**
 * Wire-transform audit, batch 2: leg-mode semantics in the stretch family.
 * Protected second legs survive byte-for-byte, fold-back residue cancels,
 * escape leads re-derive under rigid transforms, and degenerate collapse
 * fails with the contract's own message.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createRoutePath, routeEnd } from "@icm/model";
import type { Point, SchematicDocument, SegmentMode } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  proposeGroupMove,
  proposeJunctionGroupTranslation,
  proposeWireSegmentDrag,
} from "./route-operations.js";
import { executeTransaction } from "./transaction.js";
import { planRoutingTransform } from "./routing-transform-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function baseDocument(): SchematicDocument {
  const document = parseProject(
    readFileSync(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-3-routing/project.icproj.json",
      ),
      "utf8",
    ),
  ).documents[0]!;
  document.instances = document.instances.filter((instance) =>
    ["A", "B"].includes(instance.id),
  );
  document.nets = [
    {
      id: "net-1",
      terminals: [
        { instanceId: "A", pinName: "P" },
        { instanceId: "B", pinName: "P" },
      ],
    },
  ];
  document.netlist!.terminals = ["A", "B"].map((instanceId) => ({
    id: `cell-terminal-${instanceId.toLowerCase()}`,
    name: instanceId,
    netId: "net-1",
    direction: "passive" as const,
    interfaceInstanceIds: [instanceId],
  }));
  document.connectivityEvidence = [];
  document.junctions = [];
  document.routes = [];
  return document;
}

function seedRoute(
  document: SchematicDocument,
  options: {
    id?: string;
    bends: Point[];
    modes: SegmentMode[];
    start?: { kind: "junction"; junctionId: string };
    end?: { kind: "junction"; junctionId: string };
    presentation?: "power-rail" | "bulk-dashed";
  },
): void {
  const route = createRoutePath({
    id: options.id ?? "route-x",
    netId: "net-1",
    start: options.start ?? { kind: "terminal", instanceId: "A", pinName: "P" },
    end: options.end ?? { kind: "terminal", instanceId: "B", pinName: "P" },
    bends: options.bends,
    modes: options.modes,
  });
  if (options.presentation) route.presentation = options.presentation;
  document.routes.push(route);
}

function legSpans(points: readonly Point[]): [Point, Point][] {
  return points.slice(1).map((point, index) => [points[index]!, point]);
}

describe("protected second legs (finding #6)", () => {
  // A at (-10,300): pin (0,300). Route drops to y=200 then runs locked to
  // B's pin at (100,200) (B at (110,200), mirror x).
  function lockedFixture(): SchematicDocument {
    const document = baseDocument();
    document.instances.find((i) => i.id === "A")!.placement = {
      position: { x: -10, y: 300 },
      rotation: 0,
      mirror: "none",
    };
    document.instances.find((i) => i.id === "B")!.placement = {
      position: { x: 110, y: 200 },
      rotation: 0,
      mirror: "x",
    };
    seedRoute(document, {
      bends: [{ x: 0, y: 200 }],
      modes: ["manual", "locked"],
    });
    return document;
  }

  it("moving the far endpoint never rewrites the locked second leg", () => {
    for (const dx of [50, 100, 150]) {
      const document = lockedFixture();
      const proposal = proposeGroupMove(document, resolver, [
        { instanceId: "A", position: { x: -10 + dx, y: 300 } },
      ]);
      const stretched = proposal.routes.find((r) => r.routeId === "route-x")!;
      const full = [
        { x: dx, y: 300 },
        ...stretched.waypoints,
        { x: 100, y: 200 },
      ];
      // The locked leg (0,200)->(100,200) must survive byte-for-byte as one
      // of the final legs, and it must still be marked locked.
      const spans = legSpans(full);
      const lockedIndex = spans.findIndex(
        ([from, to]) =>
          from.x === 0 && from.y === 200 && to.x === 100 && to.y === 200,
      );
      expect(lockedIndex, `dx=${dx} locked leg vanished`).toBeGreaterThan(-1);
      expect(stretched.segmentModes[lockedIndex]).toBe("locked");
    }
  });

  it("trunk second legs get the same protection", () => {
    const document = lockedFixture();
    const route = document.routes[0]!;
    route.legs = route.legs.map((leg) =>
      leg.mode === "locked" ? { ...leg, mode: "trunk" } : leg,
    );
    const proposal = proposeGroupMove(document, resolver, [
      { instanceId: "A", position: { x: 40, y: 300 } },
    ]);
    const stretched = proposal.routes.find((r) => r.routeId === "route-x")!;
    const full = [
      { x: 50, y: 300 },
      ...stretched.waypoints,
      { x: 100, y: 200 },
    ];
    const spans = legSpans(full);
    expect(
      spans.some(
        ([from, to]) =>
          from.x === 0 && from.y === 200 && to.x === 100 && to.y === 200,
      ),
    ).toBe(true);
  });
});

describe("fold-back residue (finding #9)", () => {
  it("junction translation cancels a self-reversing collinear remnant", () => {
    const document = baseDocument();
    document.instances = [];
    document.nets = [{ id: "net-1", terminals: [] }];
    document.netlist!.terminals = [];
    document.junctions = [
      { id: "J1", netId: "net-1", position: { x: 30, y: 50 } },
      { id: "J2", netId: "net-1", position: { x: 60, y: 40 } },
    ];
    // Persisted fold: J1 (30,50) -> (30,20) -> (30,40) -> J2 (60,40); the
    // first two legs retrace the x=30 line.
    seedRoute(document, {
      bends: [
        { x: 30, y: 20 },
        { x: 30, y: 40 },
      ],
      modes: ["manual", "manual", "manual"],
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
    });
    const proposal = proposeJunctionGroupTranslation(document, resolver, [
      { junctionId: "J1", position: { x: 30, y: 60 } },
    ]);
    const stretched = proposal.routes.find((r) => r.routeId === "route-x")!;
    const full = [{ x: 30, y: 60 }, ...stretched.waypoints, { x: 60, y: 40 }];
    const spans = legSpans(full);
    for (let index = 1; index < spans.length; index += 1) {
      const [aFrom, aTo] = spans[index - 1]!;
      const [bFrom, bTo] = spans[index]!;
      const before = { x: aTo.x - aFrom.x, y: aTo.y - aFrom.y };
      const after = { x: bTo.x - bFrom.x, y: bTo.y - bFrom.y };
      const collinear = before.x * after.y - before.y * after.x === 0;
      const reverses = before.x * after.x + before.y * after.y < 0;
      expect(collinear && reverses, "fold-back survived the stretch").toBe(
        false,
      );
    }
  });
});

describe("degenerate collapse (finding #15)", () => {
  it("a fully collapsed stretch fails with the contract message, not factory internals", () => {
    const document = baseDocument();
    document.instances = [];
    document.nets = [{ id: "net-1", terminals: [] }];
    document.netlist!.terminals = [];
    document.junctions = [
      { id: "J1", netId: "net-1", position: { x: 0, y: 0 } },
      { id: "J2", netId: "net-1", position: { x: 40, y: 0 } },
    ];
    seedRoute(document, {
      bends: [],
      modes: ["manual"],
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
    });
    // Collapse the whole route onto one point: both junctions to (40,0).
    expect(() =>
      proposeJunctionGroupTranslation(document, resolver, [
        { junctionId: "J1", position: { x: 40, y: 0 } },
      ]),
    ).toThrow(/degenerate/u);
  });
});

describe("escape stubs from segment drags (finding #14)", () => {
  it("dragging a single escape leg emits manual stubs that commit", () => {
    const document = baseDocument();
    document.instances.find((i) => i.id === "A")!.placement = {
      position: { x: -10, y: 300 },
      rotation: 0,
      mirror: "none",
    };
    document.instances.find((i) => i.id === "B")!.placement = {
      position: { x: 110, y: 300 },
      rotation: 0,
      mirror: "x",
    };
    // Agent-drawn direct connection: one straight escape leg pin to pin.
    seedRoute(document, { bends: [], modes: ["escape"] });
    const drag = proposeWireSegmentDrag(document, resolver, "route-x", 0, {
      x: 50,
      y: 260,
    });
    const result = executeTransaction(
      document,
      {
        transactionId: "drag-escape",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [
          {
            kind: "set_route_path",
            route: {
              ...document.routes[0]!,
              ...createRoutePath({
                id: "route-x",
                netId: "net-1",
                start: document.routes[0]!.start,
                end: routeEnd(document.routes[0]!),
                bends: drag.routes[0]!.waypoints,
                modes: drag.routes[0]!.segmentModes,
              }),
            },
          },
        ],
      },
      { symbolResolver: resolver },
    );
    if (!result.ok) throw new Error(result.error.message);
    const route = result.document.routes.find((r) => r.id === "route-x")!;
    expect(route.legs.length).toBeGreaterThan(1);
  });
});

describe("escape leads under rigid transforms (finding #4)", () => {
  function escapeFixture(presentation?: "bulk-dashed"): SchematicDocument {
    const document = baseDocument();
    document.instances.find((i) => i.id === "A")!.placement = {
      position: { x: -10, y: 300 },
      rotation: 0,
      mirror: "none",
    };
    document.instances.find((i) => i.id === "B")!.placement = {
      position: { x: 210, y: 300 },
      rotation: 0,
      mirror: "x",
    };
    // Escape-led boundary wire A.P (0,300) -> (40,300) -> (160,300) -> (200,300).
    seedRoute(document, {
      bends: [
        { x: 40, y: 300 },
        { x: 160, y: 300 },
      ],
      modes: ["escape", "manual", "escape"],
      ...(presentation ? { presentation } : {}),
    });
    return document;
  }

  for (const [label, presentation] of [
    ["plain", undefined],
    ["bulk-dashed", "bulk-dashed"],
  ] as const) {
    it(`rotating one endpoint of an escape-led ${label} wire commits`, () => {
      const document = escapeFixture(presentation);
      const plan = planRoutingTransform(
        document,
        resolver,
        {
          instanceIds: ["A"],
          routeIds: [],
          junctionIds: [],
          annotationIds: [],
        },
        { kind: "rotate", degrees: 90 },
      );
      const blocking = plan.diagnostics.find((d) => d.severity === "error");
      expect(blocking?.message ?? "").toBe("");
      const result = executeTransaction(
        document,
        {
          transactionId: "rotate-escape",
          documentId: document.id,
          expectedRevision: document.revision,
          actor: { kind: "human", id: "test" },
          edits: [...plan.edits],
        },
        { symbolResolver: resolver },
      );
      if (!result.ok) throw new Error(result.error.message);
      expect(result.document.routes).toHaveLength(1);
    });
  }
});

describe("power-rail boundary stretch (finding #18)", () => {
  it("bending a rail-presentation branch fails with a named plan error", () => {
    const document = baseDocument();
    document.instances.find((i) => i.id === "A")!.placement = {
      position: { x: -10, y: 300 },
      rotation: 0,
      mirror: "none",
    };
    document.instances.find((i) => i.id === "B")!.placement = {
      position: { x: 110, y: 300 },
      rotation: 0,
      mirror: "x",
    };
    seedRoute(document, {
      bends: [],
      modes: ["manual"],
      presentation: "power-rail",
    });
    // Vertical translate of one end would bend the rail.
    expect(() =>
      proposeGroupMove(document, resolver, [
        { instanceId: "A", position: { x: -10, y: 200 } },
      ]),
    ).toThrow(/[Pp]ower rail/u);
  });
});
