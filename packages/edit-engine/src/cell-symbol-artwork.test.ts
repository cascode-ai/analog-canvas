import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SchematicDocumentSchema,
  routeEndpoints,
  transformPoint,
  type CircuitProject,
  type SymbolDefinition,
} from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
  tryParseProjectWithMetadata,
} from "@icm/project-protocol";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
} from "@icm/symbols";
import { resolveRouteGeometry } from "@icm/derived";
import { buildSvgScene } from "@icm/render-svg";

import {
  capturedCellSymbolArtwork,
  planSetCellSymbolArtwork,
} from "./cell-symbol-artwork.js";
import { planSetCellSymbolSize } from "./hierarchy-planner.js";
import {
  planRemoveCellTerminal,
  planRenameCellTerminal,
} from "./cell-interface-change-planner.js";
import { planCreateCellPin } from "./cell-pin-planner.js";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";

const CELL = "document-ota-5t";
const BENCH = "document-ota-5t-testbench";

/** The 5-transistor OTA example: ota_5t placed in a wired testbench. */
const ota = (): CircuitProject =>
  parseProject(
    readFileSync("apps/editor/src/examples/simulation-ota.icproj.json", "utf8"),
  );

function commit(project: CircuitProject, edits: ProjectStructureEdit[]) {
  const result = executeProjectTransaction(project, {
    transactionId: `t-${project.structureRevision}`,
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "agent", id: "test" },
    edits,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.project;
}

const pin = (
  name: string,
  role: string,
  x: number,
  y: number,
  direction: "north" | "east" | "south" | "west",
  showName = false,
) => ({
  name,
  role,
  at: { x, y },
  direction,
  presentation: {
    visibility: "visible" as const,
    showName,
    ...(showName ? { textSizeScale: 0.6 } : {}),
  },
});
const line = (x1: number, y1: number, x2: number, y2: number) => ({
  kind: "line" as const,
  from: { x: x1, y: y1 },
  to: { x: x2, y: y2 },
});

/** An op-amp triangle: − and + on the left, OUT at the apex, rails on the edges. */
const TRIANGLE: SymbolDefinition = {
  schemaVersion: 1,
  id: "ota-triangle",
  name: "ota_5t",
  viewBox: { x: -60, y: -50, width: 120, height: 100 },
  pins: [
    pin("IN-", "inverting-input", -60, -20, "west"),
    pin("IN+", "non-inverting-input", -60, 20, "west"),
    pin("OUT", "output", 60, 0, "east"),
    pin("VDD", "inout", -20, -50, "north", true),
    pin("IBIAS", "input", 0, -50, "north", true),
    pin("VSS", "inout", -20, 50, "south", true),
  ],
  primitives: [
    {
      kind: "polygon",
      points: [
        { x: -40, y: -40 },
        { x: -40, y: 40 },
        { x: 40, y: 0 },
      ],
      fill: "none",
    },
    line(-60, -20, -40, -20),
    line(-60, 20, -40, 20),
    line(40, 0, 60, 0),
    line(-20, -50, -20, -30),
    line(0, -50, 0, -20),
    line(-20, 50, -20, 30),
    line(-35, -20, -29, -20),
    line(-35, 20, -29, 20),
    line(-32, 17, -32, 23),
  ],
  variants: [],
};
const PIN_MAP = {
  vinn: { pinName: "IN-" },
  vinp: { pinName: "IN+" },
  vout: { pinName: "OUT" },
  vdd: { pinName: "VDD" },
  ibias: { pinName: "IBIAS" },
  vss: { pinName: "VSS" },
};
const customize = (project: CircuitProject) =>
  commit(
    project,
    planSetCellSymbolArtwork(project, CELL, {
      symbolMode: "custom",
      artworkText: JSON.stringify(TRIANGLE),
      pinMap: PIN_MAP,
    }),
  );

const bench = (project: CircuitProject) =>
  project.documents.find((document) => document.id === BENCH)!;
const cell = (project: CircuitProject) =>
  project.documents.find((document) => document.id === CELL)!;
const caller = (project: CircuitProject) =>
  bench(project).instances.find(
    (instance) => instance.netlist?.binding?.kind === "subcircuit",
  )!;
const block = (project: CircuitProject) =>
  createProjectSymbolResolver(project, builtInSymbols).resolve(
    hierarchicalSymbolId("ota_5t"),
  )!.definition;

/** Every Net's members, as instance.pin strings. */
const members = (project: CircuitProject) =>
  bench(project)
    .nets.map((net) =>
      net.terminals
        .map((terminal) => `${terminal.instanceId}.${terminal.pinName}`)
        .sort()
        .join(" "),
    )
    .sort();

const netlist = (project: CircuitProject, format: "spice" | "spectre") => {
  const exported = createDesignNetlistExport(project, { format });
  if (exported.status !== "ready")
    throw new Error(JSON.stringify(exported.diagnostics));
  return exported.file.text;
};

/**
 * Each wire on the caller ends where its pin is drawn, and runs straight
 * along the grid: the pin's absolute position is the route's end point.
 */
function expectWiresOnPins(project: CircuitProject) {
  const document = bench(project);
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const instance = caller(project);
  const symbol = resolver.resolve(instance.symbolId)!.definition;
  let wires = 0;
  for (const route of document.routes)
    for (const [index, endpoint] of routeEndpoints(route).entries()) {
      if (endpoint.kind !== "terminal" || endpoint.instanceId !== instance.id)
        continue;
      wires += 1;
      const drawn = symbol.pins.find((item) => item.name === endpoint.pinName);
      expect(drawn, endpoint.pinName).toBeDefined();
      const geometry = resolveRouteGeometry(document, resolver, route)!;
      const end =
        index === 0 ? geometry.centerline[0] : geometry.centerline.at(-1);
      const { position, rotation, mirror } = instance.placement!;
      expect(rotation).toBe(0);
      expect(mirror).toBe("none");
      expect(end).toEqual({
        x: position.x + drawn!.at.x,
        y: position.y + drawn!.at.y,
      });
      for (const segment of geometry.segments)
        expect(
          segment.from.x === segment.to.x || segment.from.y === segment.to.y,
        ).toBe(true);
    }
  return wires;
}

describe("a Cell drawn with its author's artwork", () => {
  it("fills a captured automatic block and follows its manually resized body", () => {
    const captured = JSON.parse(serializeProject(ota()));
    captured.schemaVersion = 81;
    for (const definition of captured.componentDefinitions)
      for (const primitive of definition.symbol.primitives)
        delete primitive.fillableBody;
    const original = parseProject(JSON.stringify(captured));
    const document = bench(original);
    const { id, placement } = caller(original);
    const painted = commit(original, [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: [
          {
            kind: "set_body_fill",
            objectIds: [id],
            fill: { kind: "background" },
          },
        ],
      },
    ]);
    const point = { x: placement!.position.x, y: placement!.position.y + 130 };
    const visible = (source: CircuitProject) => {
      const reopened = parseProject(serializeProject(source));
      const scene = buildSvgScene(
        bench(reopened),
        createProjectSymbolResolver(reopened, builtInSymbols),
      );
      return scene.drawingScene.isVisibleAt({ kind: "electrical" }, point);
    };
    expect(visible(painted)).toBe(true);
    const resized = commit(
      painted,
      planSetCellSymbolSize(painted, CELL, { width: 400, height: 400 }),
    );
    expect(visible(resized)).toBe(false);
    expect(netlist(resized, "spice")).toBe(netlist(original, "spice"));
    expect(expectWiresOnPins(resized)).toBe(expectWiresOnPins(original));
  });

  it("keeps a curved hole clear at an electrical point after transforming and reopening", () => {
    const project = ota();
    const data =
      "M-30-30 H30 V30 H-30 Z m40.0001 30 a10.0001 10.0001 0 1 0-20.0002 0 a10.0001 10.0001 0 1 0 20.0002 0 z";
    const primitives = [
      { kind: "path", data, fillableBody: true },
      ...TRIANGLE.primitives.slice(1),
    ];
    const custom = commit(
      project,
      planSetCellSymbolArtwork(project, CELL, {
        symbolMode: "custom",
        artworkText: JSON.stringify({ ...TRIANGLE, primitives }),
        pinMap: PIN_MAP,
      }),
    );
    const document = bench(custom);
    const { id, placement } = caller(custom);
    const filled = commit(custom, [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: [
          {
            kind: "set_body_fill",
            objectIds: [id],
            fill: { kind: "background" },
          },
        ],
      },
    ]);
    const transformed = structuredClone(filled);
    const contact = caller(transformed).placement!;
    contact.rotation = 90;
    contact.mirror = "horizontal";
    const saved = serializeProject(transformed);
    const reopened = parseProject(saved);
    expect(serializeProject(reopened)).toBe(saved);
    const oldEnvelope = JSON.parse(saved);
    oldEnvelope.schemaVersion = 81;
    const rejected = tryParseProjectWithMetadata(JSON.stringify(oldEnvelope));
    expect(rejected).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          message: "Closed Symbol paths require Project schema 82",
          path: expect.arrayContaining(["primitives", 0, "fillableBody"]),
        }),
      ],
    });

    const scene = buildSvgScene(
      bench(reopened),
      createProjectSymbolResolver(reopened, builtInSymbols),
    );
    const origin = placement!.position;
    expect(scene.formalBody).toMatch(
      /<path[^>]*data-role="instance-body-fill"[^>]*fill-rule="evenodd"/u,
    );
    expect(scene.drawingScene.isVisibleAt({ kind: "electrical" }, origin)).toBe(
      true,
    );
    const local = (x: number, y: number) =>
      transformPoint({ x, y }, contact.position, contact);
    expect(
      scene.drawingScene.isVisibleAt({ kind: "electrical" }, local(6, 8)),
    ).toBe(true);
    expect(
      scene.drawingScene.isVisibleAt({ kind: "electrical" }, local(0, 12)),
    ).toBe(false);
    expect(netlist(reopened, "spice")).toBe(netlist(custom, "spice"));
  });

  it("accepts an explicitly closed shallow quadratic outline", () => {
    const data = "M0 0 Q1 .005 2 0 Z";
    const project = ota();
    const custom = commit(
      project,
      planSetCellSymbolArtwork(project, CELL, {
        symbolMode: "custom",
        artworkText: JSON.stringify({
          ...TRIANGLE,
          primitives: [{ kind: "path", data, fillableBody: true }],
        }),
        pinMap: PIN_MAP,
      }),
    );
    expect(
      cell(parseProject(serializeProject(custom))).presentation.cellSymbol
        ?.artwork?.symbol.primitives,
    ).toEqual([{ kind: "path", data, fillableBody: true }]);
  });

  it("fills independent rectangles and variant regions without painting unmarked circles", () => {
    const project = ota();
    const custom = commit(
      project,
      planSetCellSymbolArtwork(project, CELL, {
        symbolMode: "custom",
        artworkText: JSON.stringify({
          ...TRIANGLE,
          primitives: [
            {
              kind: "rectangle",
              bounds: { x: -30, y: -20, width: 20, height: 40 },
              part: "left",
              fillableBody: true,
            },
            {
              kind: "circle",
              center: { x: 20, y: 0 },
              radius: 10,
              part: "right",
              fillableBody: true,
            },
            { kind: "circle", center: { x: 0, y: 20 }, radius: 4 },
          ],
          variants: [
            {
              id: "right-only",
              hiddenPinNames: [],
              hiddenPrimitiveParts: ["left"],
            },
          ],
        }),
        pinMap: PIN_MAP,
      }),
    );
    const present = (source: CircuitProject, edits: unknown[]) => {
      const document = bench(source);
      return commit(source, [
        {
          kind: "transact_document",
          documentId: document.id,
          expectedRevision: document.revision,
          edits,
        },
      ] as ProjectStructureEdit[]);
    };
    const { id, symbolId, placement } = caller(custom);
    const filled = present(custom, [
      {
        kind: "set_body_fill",
        objectIds: [id],
        fill: { kind: "color", color: "#e6ffff" },
      },
    ]);
    const visible = (source: CircuitProject, x: number, y: number) => {
      const scene = buildSvgScene(
        bench(source),
        createProjectSymbolResolver(source, builtInSymbols),
      );
      return scene.drawingScene.isVisibleAt(
        { kind: "electrical" },
        {
          x: placement!.position.x + x,
          y: placement!.position.y + y,
        },
      );
    };
    expect(visible(filled, -20, 0)).toBe(false);
    expect(visible(filled, 20, 0)).toBe(false);
    expect(visible(filled, 0, 20)).toBe(true);
    const variant = present(filled, [
      {
        kind: "set_instance_symbol",
        instanceId: id,
        symbolId,
        symbolVariantId: "right-only",
      },
    ]);
    expect(visible(variant, -20, 0)).toBe(true);
    expect(visible(variant, 20, 0)).toBe(false);
    expect(caller(variant).bodyFill).toEqual({
      kind: "color",
      color: "#e6ffff",
    });
  });

  it.each([
    [
      "M0 0 L20 0 L0 20 M2 2 L3 2 L2 3 Z",
      /Every body subpath must end with Z/u,
    ],
    ["M0 0 L20 0 x Z", /Invalid character|Unexpected/u],
    ["M0 0 L10 0 L20 0 Z", /Each body subpath must enclose an area/u],
    [
      "M0 0 L20 0 L20 20 L20 10 L20 0 L10 0 L0 0 Z",
      /Each body subpath must enclose an area/u,
    ],
    [
      "M0 0 C0 8 8 8 8 0 C8 4 6 6 4 6 C2 6 0 4 0 0 Z",
      /Each body subpath must enclose an area/u,
    ],
    [
      "M0 0H20V20H0Z M0 0H10H20V10V20H10H0V10Z",
      /Body path must enclose an area after applying even-odd fill/u,
    ],
    [
      "M1 0L7 2L7 12L1 12Z M1 0L4 1L7 2L7 12L1 12Z",
      /Body path must enclose an area after applying even-odd fill/u,
    ],
    [
      "M0 0 A1e999 1e999 0 0 0 0 0 L10 0 L0 10 Z",
      /Path coordinates must be finite/u,
    ],
  ] as const)(
    "locates invalid filled paths in the component editing flow (%s)",
    (data, message) => {
      const project = ota();
      expect(() =>
        planSetCellSymbolArtwork(project, CELL, {
          symbolMode: "custom",
          artworkText: JSON.stringify({
            symbol: {
              ...TRIANGLE,
              primitives: [{ kind: "path", data, fillableBody: true }],
            },
          }),
          pinMap: PIN_MAP,
        }),
      ).toThrow(
        new RegExp("symbol\\.primitives\\.0\\.data: .*" + message.source, "iu"),
      );
      expect(cell(project).presentation.cellSymbol?.artwork).toBeUndefined();
    },
  );

  it("draws the triangle for its caller, its pins named by the Cell Pins", () => {
    const project = customize(ota());
    const symbol = block(project);
    expect(symbol.primitives[0]).toMatchObject({ kind: "polygon" });
    expect(symbol.hierarchicalBlock).toBeUndefined();
    expect(
      Object.fromEntries(
        symbol.pins.map((item) => [
          item.name,
          [item.at.x, item.at.y, item.presentation.displayName],
        ]),
      ),
    ).toEqual({
      vinn: [-60, -20, "IN-"],
      vinp: [-60, 20, "IN+"],
      vout: [60, 0, "OUT"],
      vdd: [-20, -50, "VDD"],
      ibias: [0, -50, "IBIAS"],
      vss: [-20, 50, "VSS"],
    });
    expect(caller(project).symbolId).toBe(hierarchicalSymbolId("ota_5t"));
  });

  it("switches a placed, wired Cell to custom and back: Nets, netlists and wires on pins stay", () => {
    const original = ota();
    const nets = members(original);
    const spice = netlist(original, "spice");
    const spectre = netlist(original, "spectre");
    const wires = expectWiresOnPins(original);
    expect(wires).toBeGreaterThanOrEqual(5);

    const custom = customize(original);
    expect(members(custom)).toEqual(nets);
    expect(netlist(custom, "spice")).toBe(spice);
    expect(netlist(custom, "spectre")).toBe(spectre);
    expect(expectWiresOnPins(custom)).toBe(wires);

    const automatic = commit(
      custom,
      planSetCellSymbolArtwork(custom, CELL, { symbolMode: "automatic" }),
    );
    // Automatic is the stored layout again, byte for byte.
    expect(cell(automatic).presentation.cellSymbol).toEqual(
      cell(original).presentation.cellSymbol,
    );
    expect(block(automatic)).toEqual(block(original));
    expect(members(automatic)).toEqual(nets);
    expect(netlist(automatic, "spice")).toBe(spice);
    expect(expectWiresOnPins(automatic)).toBe(wires);
  });

  it("round-trips Cell artwork and restores the automatic presentation on reset", () => {
    const original = ota();
    const custom = customize(original);
    const text = serializeProject(custom);
    expect(JSON.parse(text).schemaVersion).toBe(CURRENT_PROJECT_FILE_VERSION);
    const loaded = parseProject(text);
    expect(cell(loaded).presentation.cellSymbol?.artwork).toEqual(
      cell(custom).presentation.cellSymbol?.artwork,
    );
    expect(serializeProject(loaded)).toBe(text);
    expect(block(loaded)).toEqual(block(custom));
    const reset = commit(
      custom,
      planSetCellSymbolArtwork(custom, CELL, { symbolMode: "automatic" }),
    );
    expect(cell(reset).presentation).toEqual(cell(original).presentation);
    const older = JSON.parse(text) as { schemaVersion: number };
    older.schemaVersion = 80;
    expect(cell(parseProject(JSON.stringify(older))).presentation).toEqual(
      cell(custom).presentation,
    );
    older.schemaVersion = 79;
    expect(() => parseProject(JSON.stringify(older))).toThrow(
      "A Cell's custom symbol artwork requires Project schema 80",
    );
  });

  it("starts Customize from the generated block, mapped one to one", () => {
    const project = ota();
    const captured = capturedCellSymbolArtwork(project, CELL);
    const custom = commit(
      project,
      planSetCellSymbolArtwork(project, CELL, {
        symbolMode: "custom",
        artworkText: JSON.stringify(captured.symbol),
      }),
    );
    // Same pins, same places: the callers' block is drawn unchanged.
    const before = block(project);
    const after = block(custom);
    expect(after.pins.map((item) => [item.name, item.at])).toEqual(
      before.pins.map((item) => [item.name, item.at]),
    );
    expect(after.primitives).toEqual(before.primitives);
    expect(netlist(custom, "spice")).toBe(netlist(project, "spice"));
  });

  it("refuses an incomplete or unknown map, naming the Pin", () => {
    const project = ota();
    const { vss: _vss, ...partial } = PIN_MAP;
    expect(() =>
      planSetCellSymbolArtwork(project, CELL, {
        symbolMode: "custom",
        artworkText: JSON.stringify(TRIANGLE),
        pinMap: partial,
      }),
    ).toThrow(
      "ota_5t's custom symbol: Map Cell Pin vss to a graphical pin or an explicit supply: map it in Customize symbol, or reset the symbol to automatic; Map graphical pin VSS to a Cell Pin. Nothing was changed.",
    );
    expect(() =>
      planSetCellSymbolArtwork(project, CELL, {
        symbolMode: "custom",
        artworkText: JSON.stringify(TRIANGLE),
        pinMap: { ...PIN_MAP, vbias: { pinName: "VSS" } },
      }),
    ).toThrow('ota_5t has no Pin "vbias"');
    // The artwork's names are not the Cell's: a map is needed.
    expect(() =>
      planSetCellSymbolArtwork(project, CELL, {
        symbolMode: "custom",
        artworkText: JSON.stringify(TRIANGLE),
      }),
    ).toThrow("supply a pinMap");
    expect(() =>
      planSetCellSymbolArtwork(project, CELL, {
        symbolMode: "automatic",
        pinMap: PIN_MAP,
      }),
    ).toThrow("choose custom before supplying artwork");
    // The Document itself refuses a map that leaves a Pin out.
    const document = structuredClone(cell(project));
    document.presentation.cellSymbol = {
      artwork: {
        symbol: TRIANGLE,
        terminals: [{ terminalId: "terminal-pvinn", pinName: "IN-" }],
      },
    };
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(false);
  });

  it("maps a Cell Pin to a property supply: an implicit pin that takes the rail", () => {
    const symbol = {
      ...TRIANGLE,
      pins: TRIANGLE.pins.filter((item) => item.name !== "VSS"),
      primitives: TRIANGLE.primitives.slice(0, -4),
    };
    const input = {
      symbolMode: "custom" as const,
      artworkText: JSON.stringify(symbol),
      pinMap: { ...PIN_MAP, vss: { supply: "VSS" as const } },
    };
    // The testbench wires vss to ground: a property supply has no wire.
    expect(() => planSetCellSymbolArtwork(ota(), CELL, input)).toThrow(
      "XDUT in Testbench has a wire or No Connect on vss: a property supply has none.",
    );
    // Without that wire, vss takes the bench's ground rail.
    const project = ota();
    const document = bench(project);
    document.routes = document.routes.filter(
      (route) => route.id !== "tb-gnd-dut-route",
    );
    for (const net of document.nets)
      net.terminals = net.terminals.filter(
        (terminal) =>
          !(terminal.instanceId === "XDUT" && terminal.pinName === "vss"),
      );
    const spice = netlist(ota(), "spice");
    const custom = commit(
      project,
      planSetCellSymbolArtwork(project, CELL, input),
    );
    expect(
      block(custom).pins.find((item) => item.name === "vss"),
    ).toMatchObject({ presentation: { visibility: "implicit" } });
    expect(netlist(custom, "spice")).toBe(spice);
  });

  it("follows the Cell's interface: rename keeps the map, removal takes the pin, a new Pin refuses", () => {
    const custom = customize(ota());
    const renamed = commit(
      custom,
      planRenameCellTerminal(custom, CELL, "terminal-pibias", "ib"),
    );
    expect(
      block(renamed).pins.find((item) => item.name === "ib"),
    ).toMatchObject({
      at: { x: 0, y: -50 },
      presentation: { displayName: "IBIAS" },
    });
    expect(netlist(renamed, "spice")).toMatch(/ota_5t/u);

    const removed = commit(
      renamed,
      planRemoveCellTerminal(renamed, CELL, "terminal-pibias"),
    );
    const artwork = cell(removed).presentation.cellSymbol!.artwork!;
    expect(artwork.symbol.pins.map((item) => item.name)).not.toContain("IBIAS");
    expect(artwork.terminals.map((item) => item.terminalId)).not.toContain(
      "terminal-pibias",
    );

    expect(() =>
      commit(
        removed,
        planCreateCellPin(removed, CELL, {
          instance: {
            id: "P-extra",
            symbolId: "port",
            placement: {
              position: { x: -400, y: -400 },
              rotation: 0,
              mirror: "none",
            },
          },
          connectionEdits: [
            {
              kind: "connect_endpoints",
              from: { kind: "terminal", instanceId: "P-extra", pinName: "P" },
              to: { kind: "terminal", instanceId: "P-extra", pinName: "P" },
              newNetId: "net-extra",
            },
          ],
          terminal: {
            id: "terminal-extra",
            name: "vb2",
            netId: "net-extra",
            direction: "input",
            interfaceInstanceIds: ["P-extra"],
          },
        }),
      ),
    ).toThrow(
      "ota_5t is drawn with a custom symbol. Map Cell Pin vb2 to a graphical pin or an explicit supply: map it in Customize symbol, or reset the symbol to automatic",
    );
  });

  it("leaves the automatic block's size and sides alone while custom", () => {
    const custom = customize(ota());
    expect(() =>
      planSetCellSymbolSize(custom, CELL, { width: 200, height: 200 }),
    ).toThrow("ota_5t is drawn with a custom symbol");
  });
});
