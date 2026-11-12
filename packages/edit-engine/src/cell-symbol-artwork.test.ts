import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SchematicDocumentSchema,
  routeEndpoints,
  type CircuitProject,
  type SymbolDefinition,
} from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject, serializeProject } from "@icm/project-protocol";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
} from "@icm/symbols";
import { resolveRouteGeometry } from "@icm/derived";

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

  it("keeps a reset Cell's file bytes identical, and round-trips the artwork at schema 80", () => {
    const original = ota();
    const custom = customize(original);
    const text = serializeProject(custom);
    expect(JSON.parse(text).schemaVersion).toBe(80);
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
    // An older envelope cannot carry the field.
    const older = JSON.parse(text) as { schemaVersion: number };
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
