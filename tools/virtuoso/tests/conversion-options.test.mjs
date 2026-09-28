import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { fixture } from "./fixture.mjs";
import {
  convertDesign,
  loadCatalog,
} from "../../../packages/virtuoso-import/dist/adapter/index.js";
import { projectMappings } from "../../../packages/virtuoso-import/dist/core/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../../../packages/symbols/dist/index.js";
import {
  resolveEndpointPoint,
  resolveRouteGeometry,
} from "../../../packages/derived/dist/index.js";
const runtime = { root: fileURLToPath(new URL("../../../", import.meta.url)) };
const table = {
  version: 1,
  devices: {
    "analogLib/res": {
      symbol: "resistor",
      pins: { PLUS: "1", MINUS: "2" },
      parameters: { r: "r" },
    },
  },
};
test("disabled filtering is per instance and preserves input", async () => {
  const source = fixture();
  source.instances[0].properties.push({
    name: "nlAction",
    type: "string",
    value: "ignore",
  });
  const before = structuredClone(source),
    catalog = await loadCatalog(runtime);
  const keep = projectMappings(source, table, catalog, {
    disabledInstances: "keep",
  });
  const omit = projectMappings(source, table, catalog, {
    disabledInstances: "omit",
  });
  assert.equal(keep.snapshot.instances.length, 2);
  assert.deepEqual(
    omit.snapshot.instances.map((i) => i.id),
    ["R2"],
  );
  assert.deepEqual(omit.report.omittedInstances, ["R1"]);
  assert(
    omit.snapshot.nets.every((n) =>
      n.terminals.every((t) => t.instanceId !== "R1"),
    ),
  );
  assert.deepEqual(source, before);
  const result = await convertDesign(source, table, {
    runtime,
    disabledInstances: "keep",
  });
  assert.deepEqual(result.report.disabledInstances, {
    mode: "keep",
    ids: ["R1"],
  });
  // Explicit omission is still reported; named free ends now become Cell Pins.
  const converted = await convertDesign(source, table, {
    runtime,
    disabledInstances: "omit",
  });
  assert.equal(converted.status, "success_with_warnings");
  assert(
    converted.report.endpointMarkers.some((marker) => marker.kind === "port"),
  );
  assert(
    !converted.validation.erc.some((d) => d.code === "ERC_UNCONNECTED_PIN"),
  );
  assert.deepEqual(converted.validation.blockingErc, []);
});
test("a label on another branch does not create a port on a short open stub", async () => {
  const source = fixture();
  source.shapes.push({
    id: "short-stub",
    netId: "VIN",
    type: "line",
    layer: "wire",
    points: [
      [-0.0625, 0.125],
      [0, 0.125],
    ],
  });
  const result = await convertDesign(source, table, { runtime });
  const ports = result.report.endpointMarkers.filter(
    (marker) => marker.kind === "port" && marker.netId === "VIN",
  );
  assert.equal(ports.length, 2);
  assert(!ports.some((marker) => marker.at.x === 290 && marker.at.y === 380));
});
test("an exported label-wire attachment takes precedence over proximity", async () => {
  const source = fixture();
  source.shapes.push({
    id: "attached-stub",
    netId: "VIN",
    type: "line",
    layer: "wire",
    points: [
      [-0.5, 0.125],
      [0, 0.125],
    ],
  });
  source.shapes.find((shape) => shape.id === "label-in").attachedWireId =
    "attached-stub";
  const result = await convertDesign(source, table, { runtime });
  const ports = result.report.endpointMarkers.filter(
    (marker) => marker.kind === "port" && marker.netId === "VIN",
  );
  assert(ports.some((marker) => marker.at.x === 220 && marker.at.y === 380));
  assert(!ports.some((marker) => marker.at.x === 300 && marker.at.y === 320));
});
test("voltage source on a transverse wire retains a short explicit pin route", async () => {
  const source = fixture();
  source.instances = source.instances.slice(0, 1);
  const voltage = source.instances[0];
  voltage.id = "V1";
  voltage.name = "V1";
  voltage.cell = "vdc";
  voltage.position = [0, -0.25];
  voltage.terminals[0].pins[0].worldCenter = [0, -0.0625];
  voltage.terminals[1].pins[0].worldCenter = [0, -0.4375];
  source.nets[0].terminals = [{ instanceId: "V1", pinName: "PLUS" }];
  source.nets[1].terminals = [{ instanceId: "V1", pinName: "MINUS" }];
  source.nets[1].name = "SENSE";
  source.shapes = [
    {
      id: "plus",
      netId: "VIN",
      type: "line",
      layer: "wire",
      points: [
        [0, -0.0625],
        [0, 0.125],
      ],
    },
    {
      id: "minus-left",
      netId: "GND",
      type: "line",
      layer: "wire",
      points: [
        [-0.5, -0.4375],
        [0, -0.4375],
      ],
    },
    {
      id: "minus-right",
      netId: "GND",
      type: "line",
      layer: "wire",
      points: [
        [0, -0.4375],
        [0.5, -0.4375],
      ],
    },
  ];
  const mapping = {
    version: 1,
    devices: {
      "analogLib/vdc": {
        symbol: "voltage-source",
        pins: { PLUS: "+", MINUS: "-" },
        parameters: {},
      },
    },
  };
  const result = await convertDesign(source, mapping, { runtime, scale: 140 });
  const doc = result.project.documents[0],
    instance = doc.instances.find((i) => i.reference === "V1");
  assert(instance);
  assert.equal(instance.placement.position.y, 430);
  const resolver = createProjectSymbolResolver(result.project, builtInSymbols);
  const route = doc.routes.find(
    (r) =>
      r.start.kind === "terminal" &&
      r.start.instanceId === instance.id &&
      r.start.pinName === "-",
  );
  assert(route);
  const geometry = resolveRouteGeometry(doc, resolver, route);
  assert.deepEqual(
    geometry.segments.map((s) => [s.from.y, s.to.y]),
    [[450, 460]],
  );
});
test("direct horizontal shunt capacitor uses a short upward pin connection", async () => {
  const source = fixture(),
    cap = source.instances[0],
    resistor = source.instances[1];
  cap.id = "C1";
  cap.name = "C1";
  cap.cell = "cap";
  cap.symbolId = "cap-symbol";
  cap.position = [0.5, -0.1875];
  cap.terminals[0].pins[0].worldCenter = [0.5, 0];
  cap.terminals[1].pins[0].worldCenter = [0.5, -0.375];
  cap.terminals[0].netId = "SIG";
  resistor.id = "R1";
  resistor.name = "R1";
  resistor.position = [-0.1875, 0];
  resistor.terminals[0].pins[0].worldCenter = [0, 0];
  resistor.terminals[1].pins[0].worldCenter = [-0.375, 0];
  resistor.terminals[0].netId = "SIG";
  resistor.terminals[1].netId = "SIDE";
  source.symbols = [
    {
      ...source.symbols[0],
      id: "cap-symbol",
      terminals: cap.terminals.map((t) => ({ ...t, netId: null })),
    },
    {
      ...source.symbols[0],
      id: "res-symbol",
      terminals: resistor.terminals.map((t) => ({ ...t, netId: null })),
    },
  ];
  source.nets = [
    {
      id: "SIG",
      name: "SIG",
      isGlobal: false,
      numBits: 1,
      terminals: [
        { instanceId: "C1", pinName: "PLUS" },
        { instanceId: "R1", pinName: "PLUS" },
      ],
    },
    {
      id: "GND",
      name: "GND",
      isGlobal: false,
      numBits: 1,
      terminals: [{ instanceId: "C1", pinName: "MINUS" }],
    },
    {
      id: "SIDE",
      name: "SIDE",
      isGlobal: false,
      numBits: 1,
      terminals: [{ instanceId: "R1", pinName: "MINUS" }],
    },
  ];
  source.shapes = [
    {
      id: "signal",
      netId: "SIG",
      type: "line",
      layer: "wire",
      points: [
        [0, 0],
        [0.5, 0],
      ],
    },
    {
      id: "ground",
      netId: "GND",
      type: "line",
      layer: "wire",
      points: [
        [0.5, -0.375],
        [0.5, -0.625],
      ],
    },
    {
      id: "side",
      netId: "SIDE",
      type: "line",
      layer: "wire",
      points: [
        [-0.375, 0],
        [-0.625, 0],
      ],
    },
  ];
  const mappings = {
    version: 1,
    devices: {
      "analogLib/cap": {
        symbol: "capacitor",
        pins: { PLUS: "1", MINUS: "2" },
        parameters: {},
      },
      "analogLib/res": {
        symbol: "resistor",
        pins: { PLUS: "1", MINUS: "2" },
        parameters: {},
      },
    },
  };
  const result = await convertDesign(source, mappings, { runtime, scale: 140 });
  const doc = result.project.documents[0],
    instance = doc.instances.find((i) => i.reference === "C1");
  assert(instance);
  assert.equal(instance.placement.position.y, 430);
  const resolver = createProjectSymbolResolver(result.project, builtInSymbols);
  const route = doc.routes.find(
    (r) =>
      (r.start.instanceId === instance.id && r.start.pinName === "1") ||
      r.legs.some(
        (leg) =>
          leg.to.endpoint?.instanceId === instance.id &&
          leg.to.endpoint.pinName === "1",
      ),
  );
  assert(route);
  const points = resolveRouteGeometry(doc, resolver, route).centerline;
  assert.equal(points.length, 3);
  const segments = points
    .slice(1)
    .map((point, index) => [points[index], point]);
  assert.equal(segments.filter(([a, b]) => a.y === b.y).length, 1);
  assert.equal(
    segments.filter(([a, b]) => a.x === b.x && Math.abs(a.y - b.y) === 10)
      .length,
    1,
  );
  source.nets.find((net) => net.id === "GND").name = "VBIAS";
  const nonGround = await convertDesign(source, mappings, {
    runtime,
    scale: 140,
  });
  assert.equal(
    nonGround.project.documents[0].instances.find((i) => i.reference === "C1")
      .placement.position.y,
    420,
  );
});
test("shared MOS D/S/B uses a single outer rail and hides supply bulk route", async () => {
  const mapping = {
    version: 1,
    devices: {
      "analogLib/nmos": {
        symbol: "nmos",
        pins: { D: "D", S: "S", B: "B", G: "G" },
        parameters: {},
      },
    },
  };
  for (const grounded of [false, true]) {
    const source = fixture(),
      mos = source.instances[0];
    const pin = (point) => ({
      worldCenter: point,
      localCenter: point,
      instanceId: null,
    });
    const terminal = (name, netId, point) => ({
      name,
      netId,
      direction: "inputOutput",
      pins: [pin(point)],
    });
    mos.id = "M1";
    mos.name = "M1";
    mos.cell = "nmos";
    mos.symbolId = "mos-symbol";
    mos.orientation = "R90";
    mos.terminals = [
      terminal("D", "TIE", [-0.1875, 0]),
      terminal("S", "TIE", [0.1875, 0]),
      terminal("B", "TIE", [0, 0]),
      terminal("G", "GATE", [0, -0.25]),
    ];
    source.instances = [mos];
    source.symbols = [
      {
        id: "mos-symbol",
        terminals: mos.terminals.map((t) => ({ ...t, netId: null })),
        shapes: [],
        bbox: [
          [-0.25, -0.3],
          [0.25, 0.3],
        ],
      },
    ];
    source.nets = [
      {
        id: "TIE",
        name: grounded ? "GND" : "TIE",
        isGlobal: false,
        numBits: 1,
        terminals: ["D", "S", "B"].map((pinName) => ({
          instanceId: "M1",
          pinName,
        })),
      },
      {
        id: "GATE",
        name: "GATE",
        isGlobal: false,
        numBits: 1,
        terminals: [{ instanceId: "M1", pinName: "G" }],
      },
    ];
    const wire = (id, netId, points) => ({
      id,
      netId,
      type: "line",
      layer: "wire",
      points,
    });
    source.shapes = [
      wire("d-rail", "TIE", [
        [-0.1875, 0],
        [-0.1875, 0.125],
      ]),
      wire("rail", "TIE", [
        [-0.1875, 0.125],
        [0.1875, 0.125],
      ]),
      wire("s-rail", "TIE", [
        [0.1875, 0],
        [0.1875, 0.125],
      ]),
      wire("b-s", "TIE", [
        [0, 0],
        [0.1875, 0],
      ]),
      wire("trunk", "TIE", [
        [-0.5, 0],
        [-0.1875, 0],
      ]),
      wire("gate", "GATE", [
        [0, -0.25],
        [0, -0.5],
      ]),
    ];
    const result = await convertDesign(source, mapping, {
      runtime,
      scale: 140,
    });
    assert.deepEqual(result.report.sdbTemplates, [
      {
        sourceId: "M1",
        netId: "TIE",
        mode: grounded ? "source-drain-only" : "body-to-rail",
      },
    ]);
    const doc = result.project.documents[0],
      instance = doc.instances.find((i) => i.reference === "M1");
    const net = doc.nets.find((n) =>
      n.terminals.some(
        (t) => t.instanceId === instance.id && t.pinName === "D",
      ),
    );
    assert.deepEqual(
      new Set(
        net.terminals
          .filter((t) => t.instanceId === instance.id)
          .map((t) => t.pinName),
      ),
      new Set(["D", "S", "B"]),
    );
    const bulkRoutes = doc.routes.filter(
      (r) =>
        r.netId === net.id &&
        ((r.start.instanceId === instance.id && r.start.pinName === "B") ||
          r.legs.some(
            (leg) =>
              leg.to.endpoint?.instanceId === instance.id &&
              leg.to.endpoint.pinName === "B",
          )),
    );
    assert.equal(bulkRoutes.length, grounded ? 0 : 1);
    if (!grounded) {
      const resolver = createProjectSymbolResolver(
        result.project,
        builtInSymbols,
      );
      const points = resolveRouteGeometry(
        doc,
        resolver,
        bulkRoutes[0],
      ).centerline;
      assert(
        points.length >= 2 && points.every((point) => point.x === points[0].x),
      );
    } else {
      const all = await convertDesign(source, mapping, {
        runtime,
        scale: 140,
        presentation: { ...result.report.presentation, bulkVisibility: "all" },
      });
      assert(all.report.hiddenBulkPins.some((pin) => pin.sourceId === "M1"));
      assert.equal(
        all.project.documents[0].routes.filter(
          (r) => r.presentation === "bulk-dashed",
        ).length,
        0,
      );
    }
  }
});
test("horizontal VDD end marker leaves downward without a return loop", async () => {
  const source = fixture(),
    resistor = source.instances[0];
  source.instances = [resistor];
  resistor.terminals[0].pins[0].worldCenter = [0, 0];
  resistor.terminals[1].pins[0].worldCenter = [-0.375, 0];
  resistor.terminals[0].netId = "SIG";
  resistor.terminals[1].netId = "POWER";
  source.nets = [
    {
      id: "SIG",
      name: "SIG",
      isGlobal: false,
      numBits: 1,
      terminals: [{ instanceId: "R1", pinName: "PLUS" }],
    },
    {
      id: "POWER",
      name: "VDD",
      isGlobal: false,
      numBits: 1,
      terminals: [{ instanceId: "R1", pinName: "MINUS" }],
    },
  ];
  source.shapes = [
    {
      id: "signal",
      netId: "SIG",
      type: "line",
      layer: "wire",
      points: [
        [0, 0],
        [0.25, 0],
      ],
    },
    {
      id: "power",
      netId: "POWER",
      type: "line",
      layer: "wire",
      points: [
        [-0.625, 0],
        [-0.375, 0],
      ],
    },
  ];
  const result = await convertDesign(source, table, { runtime, scale: 140 });
  const doc = result.project.documents[0],
    marker = doc.instances.find((i) => i.symbolId === "vdd-port");
  assert(marker);
  const resolver = createProjectSymbolResolver(result.project, builtInSymbols);
  assert.equal(
    resolveEndpointPoint(doc, resolver, {
      kind: "terminal",
      instanceId: marker.id,
      pinName: "P",
    }).y,
    390,
  );
  const route = doc.routes.find(
    (r) =>
      r.start.instanceId === marker.id ||
      r.legs.some((leg) => leg.to.endpoint?.instanceId === marker.id),
  );
  assert(route);
  const points = resolveRouteGeometry(doc, resolver, route).centerline;
  assert.equal(points.length, 3);
  assert.equal(points[0].x, points[1].x);
  assert.equal(Math.abs(points[0].y - points[1].y), 10);
  assert.equal(points[1].y, points[2].y);
});
test("bundled buses require opt-in and do not claim bit equivalence", async () => {
  const source = fixture();
  source.nets[0].numBits = 4;
  source.nets[0].name = "DATA<3:0>";
  await assert.rejects(convertDesign(source, table, { runtime }), {
    code: "BUS_UNSUPPORTED",
  });
  const result = await convertDesign(source, table, {
    runtime,
    busMode: "bundled",
  });
  assert.equal(result.report.bundledBuses[0].width, 4);
  assert.equal(result.report.bitConnectivityVerified, false);
  assert.equal(result.report.sourceConnectivityVerified, false);
  assert.equal(result.report.retainedConnectivityVerified, true);
});
test("invalid option values are rejected", async () => {
  await assert.rejects(
    convertDesign(fixture(), table, { runtime, busMode: "anything" }),
    { code: "INVALID_OPTION" },
  );
});
test("cancellation has a distinct result code", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    convertDesign(fixture(), table, { runtime, signal: controller.signal }),
    { code: "CANCELLED" },
  );
});
