import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";
import { projectMappings } from "../../../packages/virtuoso-import/dist/core/index.js";
import { createGenericBoxes } from "../../../packages/virtuoso-import/dist/adapter/generic-box.js";
import {
  createEmptyProject,
  createRoutePath,
  routeEnd,
} from "../../../packages/model/dist/index.js";
import {
  createProjectSymbolResolver,
  externalSubcircuitSymbolId,
  builtInSymbols,
} from "../../../packages/symbols/dist/index.js";
import { renderDocumentSvg } from "../../../packages/render-svg/dist/index.js";
import {
  resolveEndpointPoint,
  resolveEndpointConnection,
  resolveRouteGeometry,
  diagnoseVisualQuality,
} from "../../../packages/derived/dist/index.js";
import {
  serializeProject,
  tryParseProjectWithMetadata,
} from "../../../packages/project-protocol/dist/index.js";
import { refineBoxRoutes } from "../../../packages/virtuoso-import/engine/box_routes.mjs";
import { trimBulkRoutes } from "../../../packages/virtuoso-import/engine/bulk_routes.mjs";

test("three outward-facing pins share one moved junction instead of leaving a stub", () => {
  for (const blocked of [false, true]) {
    const project = createEmptyProject("three-pin", "three-pin"),
      doc = project.documents[0];
    doc.instances = [
      {
        id: "M0",
        symbolId: "nmos",
        symbolVariantId: "textbook-3terminal",
        placement: {
          position: { x: 110, y: 350 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "M1",
        symbolId: "nmos",
        symbolVariantId: "textbook-3terminal",
        placement: {
          position: { x: 370, y: 350 },
          rotation: 0,
          mirror: "horizontal",
        },
      },
      {
        id: "M2",
        symbolId: "nmos",
        symbolVariantId: "textbook-3terminal",
        placement: {
          position: { x: 230, y: 440 },
          rotation: 0,
          mirror: "none",
        },
      },
      ...(blocked
        ? [
            {
              id: "obstacle",
              symbolId: "voltage-source",
              placement: {
                position: { x: 240, y: 390 },
                rotation: 0,
                mirror: "none",
              },
            },
          ]
        : []),
    ];
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const peers = [
      ["M0", "S"],
      ["M1", "S"],
      ["M2", "D"],
    ].map(([instanceId, pinName]) => ({
      kind: "terminal",
      instanceId,
      pinName,
    }));
    const end = { kind: "junction", junctionId: "J" };
    doc.nets = [
      {
        id: "n",
        terminals: peers.map(({ instanceId, pinName }) => ({
          instanceId,
          pinName,
        })),
      },
    ];
    doc.junctions = [
      { id: "J", netId: "n", position: { x: 240, y: 370 }, role: "branch" },
    ];
    doc.routes = peers.map((start, i) =>
      createRoutePath({
        id: "r" + i,
        netId: "n",
        start,
        end,
        bends: [],
        modes: ["manual"],
      }),
    );
    const nets = structuredClone(doc.nets),
      members = doc.routes.map((r) => [r.start, routeEnd(r)]);
    const result = refineBoxRoutes(doc, resolver);
    assert.deepEqual(doc.nets, nets);
    assert.deepEqual(
      doc.routes.map((r) => [r.start, routeEnd(r)]),
      members,
    );
    assert.equal(result.opposedThreePinBranches.length, blocked ? 0 : 1);
    assert.deepEqual(doc.junctions[0].position, {
      x: 240,
      y: blocked ? 370 : 390,
    });
    if (!blocked) {
      for (const route of doc.routes) {
        const geometry = resolveRouteGeometry(doc, resolver, route);
        assert.deepEqual(geometry.segments.at(-1).to, { x: 240, y: 390 });
      }
      assert.equal(
        refineBoxRoutes(doc, resolver).opposedThreePinBranches.length,
        0,
      );
    }
  }
});

test("local shared power fan-in moves outside box without changing connectivity", () => {
  for (const trunk of [false, true]) {
    const project = createEmptyProject("fan", "fan"),
      doc = project.documents[0];
    project.externalSubcircuitDefinitions = [
      {
        id: "box",
        name: "Block",
        terminals: ["P", "Pb"].map((id) => ({
          id,
          name: id,
          direction: "passive",
        })),
        formalParameters: [],
        interfaceStatus: "declared",
        presentation: {
          pinPlacements: [
            { terminalId: "P", side: "north", offset: -20 },
            { terminalId: "Pb", side: "north", offset: 20 },
          ],
        },
      },
    ];
    doc.instances = [
      {
        id: "X",
        symbolId: externalSubcircuitSymbolId("box"),
        placement: {
          position: { x: 300, y: 300 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "power",
        symbolId: "vdd-port",
        placement: {
          position: { x: 300, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    ];
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const pinName = resolver.resolve("vdd-port").definition.pins[0].name;
    const peers = [
      { kind: "terminal", instanceId: "X", pinName: "P" },
      { kind: "terminal", instanceId: "X", pinName: "Pb" },
      { kind: "terminal", instanceId: "power", pinName },
    ];
    doc.nets = [
      {
        id: "n",
        terminals: peers.map(({ instanceId, pinName }) => ({
          instanceId,
          pinName,
        })),
      },
    ];
    const end = { kind: "junction", junctionId: "J" };
    doc.junctions = [
      { id: "J", netId: "n", position: { x: 300, y: 300 }, role: "branch" },
    ];
    doc.routes = peers.map((start, i) =>
      createRoutePath({
        id: "r" + i,
        netId: "n",
        start,
        end,
        bends: [],
        modes: ["manual"],
      }),
    );
    if (trunk) {
      doc.junctions.push({
        id: "trunk",
        netId: "n",
        position: { x: 500, y: 300 },
        role: "route-anchor",
      });
      doc.routes.push(
        createRoutePath({
          id: "trunk",
          netId: "n",
          start: end,
          end: { kind: "junction", junctionId: "trunk" },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    const nets = structuredClone(doc.nets),
      ends = doc.routes.map((r) => [r.start, routeEnd(r)]),
      old = structuredClone(doc.junctions[0].position);
    const result = refineBoxRoutes(doc, resolver);
    assert.deepEqual(doc.nets, nets);
    assert.deepEqual(
      doc.routes.map((r) => [r.start, routeEnd(r)]),
      ends,
    );
    assert.equal(result.sharedPowerBranches.length, trunk ? 0 : 1);
    if (trunk) assert.deepEqual(doc.junctions[0].position, old);
    else {
      assert(
        doc.junctions[0].position.y <
          resolveEndpointPoint(doc, resolver, peers[0]).y,
      );
      assert(
        !diagnoseVisualQuality(doc, resolver).some((d) =>
          [
            "VISUAL_TERMINAL_DEPARTURE",
            "VISUAL_SYMBOL_OVERLAP",
            "VISUAL_WIRE_THROUGH_SYMBOL",
          ].includes(d.code),
        ),
      );
      assert.equal(
        refineBoxRoutes(doc, resolver).sharedPowerBranches.length,
        0,
      );
    }
  }
});

test("collinear pins use artwork lead direction instead of pin extrema", () => {
  const source = fixture();
  for (const t of source.symbols[0].terminals) t.pins[0].localCenter[0] = 2.25;
  source.symbols[0].shapes = source.symbols[0].terminals.map((t) => ({
    type: "line",
    layer: "device",
    points: [t.pins[0].localCenter, [2, t.pins[0].localCenter[1]]],
  }));
  const a = projectMappings(source, { version: 1, devices: {} }, []);
  const boxes = createGenericBoxes(a.snapshot, a.mappings, 140);
  assert(
    boxes.definitions.every((d) =>
      d.presentation.pinPlacements.every((p) => p.side === "east"),
    ),
  );
});

test("bulk branch stops at first same-net contact and splits the main conductor", () => {
  const project = createEmptyProject("bulk", "bulk"),
    doc = project.documents[0];
  doc.instances = [
    {
      id: "M",
      reference: "M",
      symbolId: "nmos",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    },
  ];
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const start = { kind: "terminal", instanceId: "M", pinName: "B" },
    p = resolveEndpointPoint(doc, resolver, start);
  assert(p);
  doc.nets = [{ id: "n", terminals: [{ instanceId: "M", pinName: "B" }] }];
  const j = (id, x, y, netId = "n") => ({
    id,
    netId,
    position: { x, y },
    role: "route-anchor",
  });
  doc.junctions = [
    j("a", p.x + 40, p.y - 40),
    j("b", p.x + 40, p.y + 40),
    j("end", p.x + 40, p.y + 20),
    j("foreign-a", p.x + 20, p.y - 40, "other"),
    j("foreign-b", p.x + 20, p.y + 40, "other"),
  ];
  const ep = (id) => ({ kind: "junction", junctionId: id });
  doc.routes = [
    createRoutePath({
      id: "main",
      netId: "n",
      start: ep("a"),
      end: ep("b"),
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "foreign",
      netId: "other",
      start: ep("foreign-a"),
      end: ep("foreign-b"),
      bends: [],
      modes: ["manual"],
    }),
    {
      ...createRoutePath({
        id: "bulk",
        netId: "n",
        start,
        end: ep("end"),
        bends: [{ x: p.x + 40, y: p.y }],
        modes: ["manual", "manual"],
      }),
      presentation: "bulk-dashed",
    },
  ];
  const nets = structuredClone(doc.nets);
  const changes = trimBulkRoutes(doc, resolver);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].contact, { x: p.x + 40, y: p.y });
  assert.deepEqual(doc.nets, nets);
  const bulk = doc.routes.find((r) => r.id === "bulk"),
    end = routeEnd(bulk);
  assert.equal(end.kind, "junction");
  assert.equal(
    doc.routes.filter((r) =>
      [r.start, routeEnd(r)].some(
        (e) => e.kind === "junction" && e.junctionId === end.junctionId,
      ),
    ).length,
    3,
  );
  assert.deepEqual(trimBulkRoutes(doc, resolver), []);
  assert(
    !diagnoseVisualQuality(doc, resolver).some(
      (d) => d.code === "VISUAL_ROUTE_OVERLAP",
    ),
  );
});

test("box size is independent of drawing scale and portable presentation survives roundtrip", () => {
  const a = projectMappings(fixture(), { version: 1, devices: {} }, []);
  const b = projectMappings(fixture(), { version: 1, devices: {} }, []);
  const x = createGenericBoxes(a.snapshot, a.mappings, 140),
    y = createGenericBoxes(b.snapshot, b.mappings, 300);
  assert.deepEqual(x.definitions, y.definitions);
  const project = createEmptyProject("test", "test");
  project.externalSubcircuitDefinitions = x.definitions;
  const doc = project.documents[0],
    d = x.definitions[0];
  assert.deepEqual(Object.keys(d.presentation).sort(), [
    "minimumBodySize",
    "pinPlacements",
  ]);
  doc.instances.push({
    id: "X1",
    reference: "X1",
    symbolId: externalSubcircuitSymbolId(d.id),
    placement: { position: { x: 300, y: 300 }, rotation: 0, mirror: "none" },
    netlist: {
      parameters: {},
      binding: { kind: "external-subcircuit", definitionId: d.id },
    },
  });
  const parsed = tryParseProjectWithMetadata(serializeProject(project));
  assert(parsed.ok);
  for (const rotation of [0, 90, 180, 270])
    for (const mirror of ["none", "horizontal"]) {
      doc.instances[0].placement = {
        position: { x: 300, y: 300 },
        rotation,
        mirror,
      };
      const svg = renderDocumentSvg(
        doc,
        createProjectSymbolResolver(project, builtInSymbols),
      );
      assert(svg.includes("<svg"));
    }
});

test("box route leaves outward, avoids body, preserves net and shared junction", () => {
  const project = createEmptyProject("routing", "routing"),
    doc = project.documents[0];
  project.externalSubcircuitDefinitions = [
    {
      id: "box",
      name: "Block",
      terminals: [{ id: "p", name: "IN", direction: "input" }],
      formalParameters: [],
      interfaceStatus: "declared",
      presentation: {
        pinPlacements: [{ terminalId: "p", side: "west", offset: 0 }],
      },
    },
  ];
  doc.instances = [
    {
      id: "X1",
      reference: "X1",
      symbolId: externalSubcircuitSymbolId("box"),
      placement: { position: { x: 300, y: 300 }, rotation: 0, mirror: "none" },
      netlist: {
        parameters: {},
        binding: { kind: "external-subcircuit", definitionId: "box" },
      },
    },
  ];
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const start = { kind: "terminal", instanceId: "X1", pinName: "IN" },
    end = { kind: "junction", junctionId: "J" };
  const p = resolveEndpointPoint(doc, resolver, start);
  doc.nets = [{ id: "n", terminals: [{ instanceId: "X1", pinName: "IN" }] }];
  doc.junctions = [
    { id: "J", netId: "n", position: { x: 450, y: 300 }, role: "route-anchor" },
  ];
  doc.routes = [
    createRoutePath({
      id: "r",
      netId: "n",
      start,
      end,
      bends: [],
      modes: ["manual"],
    }),
  ];
  const before = structuredClone(doc.nets),
    junction = structuredClone(doc.junctions);
  assert(
    diagnoseVisualQuality(doc, resolver).some(
      (d) => d.code === "VISUAL_TERMINAL_DEPARTURE",
    ),
  );
  const result = refineBoxRoutes(doc, resolver);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(doc.nets, before);
  assert.deepEqual(doc.junctions, junction);
  assert.deepEqual(routeEnd(doc.routes[0]), end);
  const g = resolveRouteGeometry(doc, resolver, doc.routes[0]);
  assert(g.segments[0].to.x < p.x);
  assert.deepEqual(
    diagnoseVisualQuality(doc, resolver).filter((d) =>
      ["VISUAL_TERMINAL_DEPARTURE", "VISUAL_WIRE_THROUGH_SYMBOL"].includes(
        d.code,
      ),
    ),
    [],
  );
});

test("short MOS-to-capacitor route uses one bend when both pin directions permit it", () => {
  const project = createEmptyProject("short-route", "short-route"),
    doc = project.documents[0];
  project.externalSubcircuitDefinitions = [
    {
      id: "box",
      name: "Block",
      terminals: [{ id: "p", name: "P", direction: "passive" }],
      formalParameters: [],
      interfaceStatus: "declared",
      presentation: {
        pinPlacements: [{ terminalId: "p", side: "west", offset: 0 }],
      },
    },
  ];
  doc.instances = [
    {
      id: "M",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      placement: {
        position: { x: -520, y: -60 },
        rotation: 90,
        mirror: "none",
      },
    },
    {
      id: "C",
      symbolId: "capacitor",
      placement: { position: { x: -460, y: -20 }, rotation: 0, mirror: "none" },
    },
    {
      id: "X",
      symbolId: externalSubcircuitSymbolId("box"),
      placement: {
        position: { x: 1000, y: 1000 },
        rotation: 0,
        mirror: "none",
      },
    },
  ];
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const start = { kind: "terminal", instanceId: "M", pinName: "D" },
    end = { kind: "terminal", instanceId: "C", pinName: "1" };
  const a = resolveEndpointPoint(doc, resolver, start),
    b = resolveEndpointPoint(doc, resolver, end);
  assert.deepEqual(a, { x: -500, y: -50 });
  assert.deepEqual(b, { x: -460, y: -40 });
  doc.nets = [
    {
      id: "n",
      terminals: [
        { instanceId: "M", pinName: "D" },
        { instanceId: "C", pinName: "1" },
      ],
    },
  ];
  doc.routes = [
    createRoutePath({
      id: "r",
      netId: "n",
      start,
      end,
      bends: [{ x: a.x, y: b.y }],
      modes: ["manual", "manual"],
    }),
  ];
  const nets = structuredClone(doc.nets);
  refineBoxRoutes(doc, resolver);
  assert.deepEqual(doc.nets, nets);
  assert.deepEqual(routeEnd(doc.routes[0]), end);
  assert.deepEqual(
    resolveRouteGeometry(doc, resolver, doc.routes[0]).segments.map(
      (s) => s.to,
    ),
    [{ x: b.x, y: a.y }, b],
  );
});

test("single-ended power markers align and shorten, shared markers stay fixed", () => {
  for (const shared of [false, true]) {
    const project = createEmptyProject("power", "power"),
      doc = project.documents[0];
    project.externalSubcircuitDefinitions = [
      {
        id: "box",
        name: "Block",
        terminals: [{ id: "p", name: "VDD", direction: "passive" }],
        formalParameters: [],
        interfaceStatus: "declared",
        presentation: {
          pinPlacements: [{ terminalId: "p", side: "north", offset: 0 }],
        },
      },
    ];
    doc.instances = [
      {
        id: "X",
        symbolId: externalSubcircuitSymbolId("box"),
        placement: {
          position: { x: 300, y: 300 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "power",
        symbolId: "vdd-port",
        placement: {
          position: { x: 320, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    ];
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const pinName = resolver.resolve("vdd-port").definition.pins[0].name;
    const start = { kind: "terminal", instanceId: "X", pinName: "VDD" },
      end = { kind: "terminal", instanceId: "power", pinName };
    const a = resolveEndpointConnection(doc, resolver, start),
      b = resolveEndpointConnection(doc, resolver, end);
    assert.equal(b.outward.y, 1);
    doc.nets = [
      {
        id: "n",
        terminals: [
          { instanceId: "X", pinName: "VDD" },
          { instanceId: "power", pinName },
        ],
      },
    ];
    doc.routes = [
      createRoutePath({
        id: "r",
        netId: "n",
        start,
        end,
        bends: [],
        modes: ["manual"],
      }),
    ];
    if (shared) {
      doc.junctions = [
        {
          id: "j",
          netId: "n",
          position: { x: 400, y: 150 },
          role: "route-anchor",
        },
      ];
      doc.routes.push(
        createRoutePath({
          id: "shared",
          netId: "n",
          start: end,
          end: { kind: "junction", junctionId: "j" },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    const nets = structuredClone(doc.nets),
      old = structuredClone(doc.instances[1].placement);
    refineBoxRoutes(doc, resolver, { stubLength: 40 });
    assert.deepEqual(doc.nets, nets);
    if (shared) assert.deepEqual(doc.instances[1].placement, old);
    else {
      const p = resolveEndpointPoint(doc, resolver, end);
      assert.deepEqual(p, { x: a.contactPoint.x, y: a.contactPoint.y - 40 });
      assert.equal(
        resolveRouteGeometry(doc, resolver, doc.routes[0]).segments.length,
        1,
      );
    }
  }
});
