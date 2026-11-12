import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  buildDocumentDerivedContext,
  deriveImportedRoutingGuidance,
  endpointKey,
  resolveAnnotationPresentation,
  resolveAnnotationText,
  resolveDocumentLogicalNets,
  resolveDocumentStyleProfile,
  resolveRouteGeometry,
} from "@icm/derived";
import {
  IDEAL_COMPARATOR_TARGET,
  deviceDescriptor,
  reviewedExternalBindingById,
  subcircuitDescriptor,
} from "@icm/devices";
import { executeProjectTransaction } from "@icm/edit-engine";
import {
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
  flattenRichText,
  sameStyledText,
  type CircuitProject,
  type Annotation,
  type DraftingObject,
  type Instance,
  type RichTextRun,
  type RouteBranch,
} from "@icm/model";
import {
  compareElectricalGraphs,
  createDesignNetlistExport,
  projectElectricalGraph,
} from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import {
  CANVAS_PACKAGE,
  CANVAS_PACKAGE_VERSION,
  composeOrient,
  createRnlExport,
  rnlBodyPortOrder,
  rnlOrient,
  rnlPlace,
  rnlSymbolFor,
  RNL_STD_VERSION,
  type RnlWriteRequest,
} from "@icm/rnl";
import {
  builtInSymbols,
  cellSymbolPinSlots,
  createProjectSymbolResolver,
  externalSubcircuitSymbolId,
  hierarchicalSymbolId,
  withProjectComponentDefinitions,
} from "@icm/symbols";
import type { Shape } from "@rich-netlist/runtime/core";
import { createRnlTestCore } from "./rnl-core.test-support";

import { labelCensus, labelDifferences } from "../../../e2e/label-census";
import { bipolarProject } from "../../../e2e/bipolar-project";
import { withImportedInstanceDisplays } from "../instance-display/imported-instance-displays";
import { materializeRazaviProjectBulkConnections } from "../../presentation/razavi-presentation";
import { createDefaultNetlistExportPreferences } from "./netlist-export-preferences";
import { planNetlistProcess, prepareNetlistExample } from "./netlist-process";
import { planRnlImport } from "./rnl-import";
import type { RnlRuntime } from "./rnl-runtime";
import { delayCellFixture } from "../../../../../packages/netlist/src/delay-cell-fixture.test-support.js";
import { externalModelFixture } from "../../../../../packages/netlist/src/external-model-fixture.test-support.js";

/** An arrow end's style, as a drawing object keeps it. */
type ArrowEnd =
  | "small-arrow"
  | "medium-arrow"
  | "large-arrow"
  | "dot"
  | "none"
  | "open-arrow";

// The rnl runtime's own core, in a worker thread: the editor's write and read.
const core = await createRnlTestCore();
afterAll(() => core.terminate());
const runtime: RnlRuntime = core;

const example = (name: string): CircuitProject =>
  parseProject(
    readFileSync(
      resolve(import.meta.dirname, `../../examples/${name}.icproj.json`),
      "utf8",
    ),
  );

it("uses native Pins, Ground and bulk styling even when external RNL uses the Canvas package", async () => {
  const entryPath = "review.sp";
  const text = [
    "* External RNL review fixture",
    '* @RNL(type="header") { @VERSION("0.3"); @USE-PACKAGE(name="rnl-std-full",version="0.3");',
    '* @USE-PACKAGE(name="analog-canvas-extensions",version="0.5"); }',
    ".model nch nmos",
    ".subckt review IN OUT BIAS",
    "M1 OUT IN 0 BIAS nch w=1u l=0.15u",
    "* @RNL {",
    "* #M1 @SET-SYMBOL $NMOS_4TERM; #M1 @PLACE(0,0);",
    '* &IN @WIRE(mode="straight") {(-8,0) #M1:2};',
    '* (-8.4,0) @TEXT("IN",halign="end");',
    '* &OUT @WIRE(mode="straight") {#M1:1 (0,7)};',
    "* %body = (8,0);",
    '* &BIAS @WIRE(mode="straight",linecolor="#30485d") {#M1:4 %body (8,-4)};',
    '* (8,-4.4) @TEXT("BIAS",valign="top");',
    "* %g = (0,-7);",
    '* &"0" @WIRE(mode="straight") {#M1:3 %g};',
    '* (0,-7.4) @TEXT("0",valign="top");',
    '* (9,-5) @TEXT("0");',
    "* }",
    ".ends review",
    ".end",
  ].join("\n");
  const input = {
    entryPath,
    runtime,
    inputs: [{ path: entryPath, bytes: new TextEncoder().encode(text) }],
  };
  const native = await planRnlImport(input);
  const source = await planRnlImport({ ...input, appearance: "source" });
  if (native.status !== "ready" || source.status !== "ready")
    throw new Error(JSON.stringify([native.diagnostics, source.diagnostics]));
  expect(native.drawing).toBe("preserved");
  expect(source.drawing).toBe("preserved");
  const top = (project: CircuitProject) =>
    project.documents.find(
      (document) => document.id === project.topDocumentId,
    )!;
  const canvas = top(native.project);
  const original = top(source.project);
  expect(
    canvas.instances.find((part) => part.reference === "M1")?.placement,
  ).toEqual(
    original.instances.find((part) => part.reference === "M1")?.placement,
  );
  const ground = canvas.instances.find((part) => part.symbolId === "ground");
  expect(ground?.placement?.position).toEqual({ x: 0, y: 80 });
  expect(original.instances.some((part) => part.symbolId === "ground")).toBe(
    false,
  );
  const textZeros = (doc: typeof canvas) =>
    doc.drafting?.objects.filter(
      (item) => item.kind === "text" && flattenRichText(item.content) === "0",
    );
  expect(textZeros(canvas)).toHaveLength(1);
  expect(textZeros(original)).toHaveLength(2);
  const bulk = canvas.routes.find(
    (route) => route.start.kind === "terminal" && route.start.pinName === "B",
  )!;
  expect(bulk.presentation).toBe("bulk-dashed");
  expect(
    canvas.routes.filter((route) => route.presentation === "bulk-dashed"),
  ).toHaveLength(2);
  expect(
    original.routes.find((route) => route.id === bulk.id)?.presentation,
  ).toBeUndefined();
  const landed = (project: CircuitProject) => {
    const doc = top(project);
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const { contactEvidence } = buildDocumentDerivedContext(doc, resolver);
    return doc.netlist!.terminals.every(({ interfaceInstanceIds }) =>
      interfaceInstanceIds.some((id) =>
        contactEvidence.byEndpointKey
          .get(
            endpointKey({
              kind: "terminal",
              instanceId: id,
              pinName: "P",
            }),
          )
          ?.incidents.some(({ kind }) => kind === "route"),
      ),
    );
  };
  expect(landed(native.project)).toBe(true);
  expect(landed(source.project)).toBe(false);
  const centerlines = (project: CircuitProject, doc: typeof canvas) => {
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    return doc.routes.map((route) => [
      route.id,
      resolveRouteGeometry(doc, resolver, route)?.centerline,
    ]);
  };
  expect(centerlines(native.project, canvas)).toEqual(
    centerlines(source.project, original),
  );
  const [after, before] = [native, source].map(({ project }) =>
    projectElectricalGraph(project),
  );
  if (after?.status !== "ready" || before?.status !== "ready")
    throw new Error("Both drawings must be electrically comparable");
  expect(compareElectricalGraphs(before.graph, after.graph)).toBe("equal");

  const ambiguous = await planRnlImport({
    ...input,
    inputs: [
      {
        path: entryPath,
        bytes: new TextEncoder().encode(
          text.replace(
            '* (0,-7.4) @TEXT("0",valign="top");',
            '* &"0" @WIRE(mode="straight") {(0,-7) (0,-11)};\n* (0,-7.4) @TEXT("0",valign="top");',
          ),
        ),
      },
    ],
  });
  if (ambiguous.status !== "ready") throw new Error(ambiguous.message);
  expect(ambiguous.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "RNL_IMPORT_GROUND_NOT_PLACED" }),
    ]),
  );
  expect(
    top(ambiguous.project).instances.some((part) => part.symbolId === "ground"),
  ).toBe(false);
});

it.each(["spice", "spectre"] as const)(
  "round-trips an electrical Delay Cell's body, supply connections and unchanged artwork through %s+RNL",
  async (format) => {
    const project = delayCellFixture();
    const result = await roundTrip(project, format);
    expect(failures(result)).toEqual([]);
    const parts = result.project.documents
      .flatMap((d) => d.instances)
      .filter((i) => i.symbolId === "delay-cell");
    expect(parts).toHaveLength(3);
    expect(parts.every((i) => i.netlist?.parameters.tpd === "100p")).toBe(true);
    expect(drawingCensus(result.project)).toEqual(drawingCensus(project));
    const before = projectElectricalGraph(project);
    const after = projectElectricalGraph(result.project);
    if (before.status !== "ready" || after.status !== "ready")
      throw Error("Delay Cell graph was not ready");
    expect(compareElectricalGraphs(before.graph, after.graph)).toBe("equal");
  },
);

it.each(["spice", "spectre"] as const)(
  "reads Delay Cells whose body yields its name to a Cell back as the Delay Cells through %s+RNL (#1928)",
  async (format) => {
    const project = delayCellFixture();
    const own = createEmptyDocument("own-delay", "delay_cell");
    own.netlist!.name = "delay_cell";
    project.documents.push(own);
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready") throw new Error("export blocked");
    expect(exported.request.netlist).toMatch(/ icm_delay_cell\b/u);
    const result = await roundTrip(project, format);
    expect(failures(result)).toEqual([]);
    const parts = result.project.documents
      .flatMap((d) => d.instances)
      .filter((i) => i.symbolId === "delay-cell");
    expect(parts).toHaveLength(3);
    expect(parts.every((i) => i.netlist?.parameters.tpd === "100p")).toBe(true);
  },
);

it.each(["spice", "spectre"] as const)(
  "keeps a Cell's parameter default written in braces the same circuit through %s+RNL, which Spectre prints bare",
  async (format) => {
    const project = createEmptyProject("braced", "Braced default", "dut");
    const dut = project.documents[0]!;
    dut.netlist = {
      name: "dut",
      formalParameters: [{ name: "P_R1", defaultValue: "{20k}" }],
      terminals: [],
    };
    dut.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "{P_R1}" },
      },
    });
    for (const pinName of ["1", "2"])
      dut.noConnects.push({
        id: `nc-${pinName}`,
        endpoint: { kind: "terminal", instanceId: "R1", pinName },
      });
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    const before = projectElectricalGraph(project);
    const after = projectElectricalGraph(plan.project);
    if (before.status !== "ready" || after.status !== "ready")
      throw Error("graph was not ready");
    expect(compareElectricalGraphs(before.graph, after.graph)).toBe("equal");
  },
);

/**
 * Library blocks X1, X2… in Cell `dut`, by default a D flip-flop and a DAC,
 * each pin wired straight across to a Cell Pin level with it: blocks a
 * Spectre export calls without their bodies.
 */
/** The pins a symbol draws by default: a block's hidden supplies take their Net as hidden (#1941). */
function drawnPins(symbol: (typeof builtInSymbols)[number]) {
  const hidden = new Set(
    symbol.variants.find((variant) => variant.id === symbol.defaultVariantId)
      ?.hiddenPinNames,
  );
  return symbol.pins.filter((pin) => !hidden.has(pin.name));
}

function calledBlocks(symbolIds = ["d-flip-flop", "dac"]): CircuitProject {
  const project = createEmptyProject("blocks", "Blocks", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const symbols = new Map(builtInSymbols.map((symbol) => [symbol.id, symbol]));
  const portPin = symbols.get("port")!.pins[0]!.at;
  const at = (x: number, y: number) =>
    ({ position: { x, y }, rotation: 0, mirror: "none" }) as const;
  symbolIds.forEach((symbolId, row) => {
    const reference = `X${row + 1}`;
    const position = { x: 200, y: 100 + row * 150 };
    document.instances.push({
      id: reference,
      symbolId,
      reference,
      placement: at(position.x, position.y),
      netlist: subcircuitDescriptor(symbolId)
        ? {
            binding: {
              kind: "unresolved-subcircuit",
              name: subcircuitDescriptor(symbolId)!.target,
            },
            parameters: {},
          }
        : // A native card's part takes its defaults; a diode, a model.
          {
            ...(deviceDescriptor(symbolId)?.deviceClass === "diode"
              ? {
                  binding: {
                    kind: "model" as const,
                    deviceClass: "diode",
                    name: "DIODE",
                  },
                }
              : {}),
            parameters: Object.fromEntries(
              (deviceDescriptor(symbolId)?.parameters ?? []).flatMap(
                (parameter) =>
                  parameter.defaultValue === undefined
                    ? []
                    : [[parameter.name, parameter.defaultValue]],
              ),
            ),
          },
    });
    for (const pin of drawnPins(symbols.get(symbolId)!)) {
      const node = `n_${reference}_${pin.name}`.toLowerCase();
      const port = `pin-${node}`;
      const x = position.x + pin.at.x + (pin.at.x < 0 ? -60 : 60);
      const y = position.y + pin.at.y;
      document.instances.push({
        id: port,
        symbolId: "port",
        placement: at(x - portPin.x, y - portPin.y),
      });
      document.nets.push({
        id: node,
        terminals: [
          { instanceId: port, pinName: "P" },
          { instanceId: reference, pinName: pin.name },
        ],
      });
      document.netlist!.terminals.push({
        id: `terminal-${node}`,
        name: node,
        netId: node,
        direction: "inout",
        interfaceInstanceIds: [port],
      });
      document.routes.push({
        id: `route-${node}`,
        netId: node,
        start: { kind: "terminal", instanceId: port, pinName: "P" },
        legs: [
          {
            id: `leg-${node}`,
            to: {
              kind: "endpoint",
              endpoint: {
                kind: "terminal",
                instanceId: reference,
                pinName: pin.name,
              },
            },
            mode: "manual",
          },
        ],
      });
    }
  });
  return project;
}

it.each(["spice", "spectre"] as const)(
  "brings back a Library flip-flop and DAC with their wires, as %s+RNL calls them",
  async (format) => {
    const project = calledBlocks();
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready") throw new Error("export blocked");
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    // Spectre calls each with its supplies first and leaves its body to the
    // reader's libraries: the file draws each with a symbol of its own whose
    // pins sit where the call prints them.
    if (format === "spectre") {
      expect(written.text).not.toMatch(/^subckt (d_flip_flop|dac)\b/mu);
      expect(written.text).toContain(
        "@SET-SYMBOL $CANVAS_CALL_D_FLIP_FLOP__0_0_1_2_3_4",
      );
      expect(written.text).toContain("@SET-SYMBOL $CANVAS_CALL_DAC__0_0_1_2");
    }
    const plan = await importRnl(written.text, format);
    expect(failures(plan)).toEqual([]);
    expect(
      plan.diagnostics
        .map((item) => item.code)
        .filter((code) =>
          ["RNL_IMPORT_UNMAPPED_SYMBOL", "RNL_IMPORT_WIRE_SKIPPED"].includes(
            code,
          ),
        ),
    ).toEqual([]);
    const dut = plan.project.documents.find(
      (document) => document.netlist?.name === "dut",
    )!;
    expect(
      ["X1", "X2"].map(
        (reference) =>
          dut.instances.find((instance) => instance.reference === reference)
            ?.symbolId,
      ),
    ).toEqual(["d-flip-flop", "dac"]);
    expect(plan.project.externalSubcircuitDefinitions ?? []).toEqual([]);
    expect(dut.routes).toHaveLength(project.documents[0]!.routes.length);
    const netlist = (circuit: CircuitProject) => {
      const result = createDesignNetlistExport(circuit, { format });
      return result.status === "ready" ? result.file.text : result.status;
    };
    expect(netlist(plan.project)).toBe(netlist(project));
  },
);

it.each(["spice", "spectre"] as const)(
  "brings back a crystal as the crystal through %s+RNL",
  async (format) => {
    const project = calledBlocks(["crystal"]);
    project.documents[0]!.instances[0]!.netlist!.parameters = { rm: "30" };
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready") throw new Error("export blocked");
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    expect(written.text).toContain("@SET-SYMBOL $CANVAS_CRYSTAL");
    const plan = await importRnl(written.text, format);
    expect(failures(plan)).toEqual([]);
    const crystal = plan.project.documents
      .flatMap((document) => document.instances)
      .find((instance) => instance.reference === "X1");
    expect(crystal?.symbolId).toBe("crystal");
    expect(crystal?.netlist?.parameters).toEqual({ rm: "30" });
    const netlist = (circuit: CircuitProject) => {
      const result = createDesignNetlistExport(circuit, { format });
      return result.status === "ready" ? result.file.text : result.status;
    };
    expect(netlist(plan.project)).toBe(netlist(project));
  },
);

const EXTENSIONS_06_PARTS = [
  "polarized-capacitor",
  "led",
  "schottky-diode",
  "shockley-diode",
  "put",
  "ujt",
  "potentiometer",
  "photoresistor",
  "speaker",
  "microphone",
  "sine-voltage-source",
  "ammeter",
] as const;

it.each(["spice", "spectre"] as const)(
  "brings back each part the written Canvas package draws through %s+RNL",
  async (format) => {
    const project = calledBlocks([...EXTENSIONS_06_PARTS]);
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready")
      throw new Error(
        JSON.stringify(exported.netlistDiagnostics ?? exported.diagnostics),
      );
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    expect(written.text).toContain(
      `USE-PACKAGE(name="${CANVAS_PACKAGE}", version="${CANVAS_PACKAGE_VERSION}")`,
    );
    const plan = await importRnl(written.text, format);
    expect(failures(plan)).toEqual([]);
    expect(
      plan.diagnostics
        .map((item) => item.code)
        .filter((code) => code === "RNL_IMPORT_UNMAPPED_SYMBOL"),
    ).toEqual([]);
    const parts = plan.project.documents
      .flatMap((document) => document.instances)
      .filter((instance) => /^X\d+$/u.test(instance.reference ?? ""));
    expect(
      EXTENSIONS_06_PARTS.map(
        (_, row) =>
          parts.find((instance) => instance.reference === `X${row + 1}`)
            ?.symbolId,
      ),
    ).toEqual([...EXTENSIONS_06_PARTS]);
    const netlist = (circuit: CircuitProject) => {
      const result = createDesignNetlistExport(circuit, { format });
      return result.status === "ready" ? result.file.text : result.status;
    };
    expect(netlist(plan.project)).toBe(netlist(project));
  },
);

it("brings back the built-in Zener with its breakdown, which prints a card of its own, through SPICE+RNL", async () => {
  // The Zener's bv prints in its own card (icm_zener_X1), which the
  // netlist import reads as a card X1 calls; the file keeps bv for the
  // part, and X1 is the editor's Zener again, printing that card. Only
  // SPICE prints the built-in Zener.
  const format = "spice";
  const project = calledBlocks(["zener-diode"]);
  const zener = project.documents[0]!.instances.find(
    (instance) => instance.id === "X1",
  )!;
  zener.netlist = { parameters: { bv: "6.2" } };
  const before = createDesignNetlistExport(project, { format });
  expect(before.status === "ready" && before.file.text).toMatch(
    /^\.?model icm_zener_X1 /mu,
  );
  const plan = await roundTrip(project, format);
  expect(failures(plan)).toEqual([]);
  expect(plan.diagnostics.map((item) => item.code)).not.toContain(
    "RNL_IMPORT_PARAMETERS_IGNORED",
  );
  const back = plan.project.documents
    .flatMap((document) => document.instances)
    .find((instance) => instance.reference === "X1")!;
  expect(back.symbolId).toBe("zener-diode");
  expect(back.netlist).toEqual({ parameters: { bv: "6.2" } });
  const after = createDesignNetlistExport(plan.project, { format });
  expect(after.status === "ready" && after.file.text).toBe(
    before.status === "ready" && before.file.text,
  );
});

it.each(["spice", "spectre"] as const)(
  "draws a coupled inductor its card starts at the other end of on the pins the card prints, through %s+RNL",
  async (format) => {
    // L2 is dotted at its pin 2, so its card prints that pin first, and
    // RNL binds the symbol's first pin to it: the symbol is turned over so
    // each wire still ends on its own node, and comes back as drawn.
    const project = calledBlocks(["inductor-compact", "inductor-compact"]);
    const document = project.documents[0]!;
    for (const [id, reference] of [
      ["X1", "L1"],
      ["X2", "L2"],
    ] as const)
      document.instances.find((instance) => instance.id === id)!.reference =
        reference;
    document.inductorCouplings = [
      {
        id: "coupling-k1",
        name: "K1",
        k: "0.9",
        arrow: false,
        members: [
          { instanceId: "X1", dotPin: "1" },
          { instanceId: "X2", dotPin: "2" },
        ],
      },
    ];
    const before = createDesignNetlistExport(project, { format });
    expect(before.status === "ready" && before.file.text).toMatch(
      /^L2 \(?n_x2_2 n_x2_1\b/mu,
    );
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    expect(plan.drawing).not.toBe("discarded");
    // Each wire ends at the places it was drawn to, on its own node.
    const ends = (circuit: CircuitProject) => {
      const cell = circuit.documents.find(
        (item) => item.netlist?.name === "dut",
      )!;
      const resolver = createProjectSymbolResolver(circuit, builtInSymbols);
      const names = new Map(
        cell.netlist!.terminals.map((terminal) => [
          terminal.netId,
          terminal.name,
        ]),
      );
      return cell.routes
        .flatMap((route) => {
          const line = resolveRouteGeometry(cell, resolver, route)?.centerline;
          return [line?.[0], line?.at(-1)].map(
            (point) => `${names.get(route.netId)} ${point?.x},${point?.y}`,
          );
        })
        .sort();
    };
    expect(ends(plan.project)).toEqual(ends(project));
    const after = createDesignNetlistExport(plan.project, { format });
    expect(after.status === "ready" && after.file.text).toBe(
      before.status === "ready" && before.file.text,
    );
  },
);

/**
 * Cell `dut`: a resistor R1 from Cell Pin `A` to the Cell's port `VDD`,
 * whose only interface is a hidden power label hung on R1, as a Cell keeps
 * a supply port it does not show.
 */
function hiddenPowerPort(): CircuitProject {
  const project = createEmptyProject("hidden-port", "Hidden port", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const at = (x: number, y: number) =>
    ({ position: { x, y }, rotation: 0, mirror: "none" }) as const;
  document.instances.push(
    {
      id: "R1",
      symbolId: "resistor",
      reference: "R1",
      placement: at(200, 100),
      netlist: { parameters: { value: "1k" } },
    },
    { id: "pin-a", symbolId: "port", placement: at(100, 100) },
  );
  document.nets.push(
    {
      id: "net-a",
      terminals: [
        { instanceId: "pin-a", pinName: "P" },
        { instanceId: "R1", pinName: "1" },
      ],
    },
    { id: "net-vdd", terminals: [{ instanceId: "R1", pinName: "2" }] },
  );
  document.netlist!.terminals.push(
    {
      id: "terminal-a",
      name: "A",
      netId: "net-a",
      direction: "inout",
      interfaceInstanceIds: ["pin-a"],
    },
    {
      id: "terminal-vdd",
      name: "VDD",
      netId: "net-vdd",
      direction: "inout",
      interfaceInstanceIds: [],
      interfaceAnnotationId: "hidden-vdd",
    },
  );
  document.annotations.push({
    id: "hidden-vdd",
    kind: "power-label",
    netId: "net-vdd",
    binding: { kind: "cell-terminal-name", terminalId: "terminal-vdd" },
    anchor: {
      kind: "object",
      objectId: "R1",
      localOffset: { x: 0, y: -60 },
      fallbackPosition: { x: 200, y: 40 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
    visible: false,
  });
  document.connectivityEvidence.push({
    id: "evidence-hidden-vdd",
    kind: "name-claim",
    netId: "net-vdd",
    name: "VDD",
    owner: { kind: "power-marker", objectId: "hidden-vdd" },
    scope: "local",
    powerDomain: "vdd",
  });
  return project;
}

it.each(["spice", "spectre"] as const)(
  "keeps a Cell port the drawing does not draw without a Pin, its interface a hidden power label (%s+RNL)",
  async (format) => {
    const project = hiddenPowerPort();
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    const dut = plan.project.documents.find(
      (document) => document.netlist?.name === "dut",
    )!;
    const vdd = dut.netlist!.terminals.find(
      (terminal) => terminal.name === "VDD",
    )!;
    expect(vdd.interfaceInstanceIds).toEqual([]);
    expect(
      dut.annotations.find(
        (annotation) => annotation.id === vdd.interfaceAnnotationId,
      ),
    ).toMatchObject({ kind: "power-label", visible: false });
    // No Pin stands for it: the only one is A's.
    expect(
      dut.instances.filter((instance) => instance.symbolId === "port"),
    ).toHaveLength(1);
    const netlist = (circuit: CircuitProject) => {
      const result = createDesignNetlistExport(circuit, { format });
      return result.status === "ready" ? result.file.text : result.status;
    };
    expect(netlist(plan.project)).toBe(netlist(project));
  },
);

/**
 * hiddenPowerPort's dut with its supply port drawn only as its power label,
 * named `supply`, and an NMOS M1 whose body has no Net, its source on a
 * second such port GND where `ground` asks for one, else on A.
 */
function labelledSupplies(supply: string, ground: boolean): CircuitProject {
  const project = hiddenPowerPort();
  const document = project.documents[0]!;
  const label = document.annotations.find((item) => item.id === "hidden-vdd")!;
  label.visible = true;
  label.anchor = { kind: "free", position: { x: 200, y: 40 } };
  document.netlist!.terminals.find(
    (terminal) => terminal.id === "terminal-vdd",
  )!.name = supply;
  const claim = document.connectivityEvidence.find(
    (item) => item.id === "evidence-hidden-vdd",
  )!;
  if (claim.kind === "name-claim") claim.name = supply;
  document.instances.push({
    id: "M1",
    symbolId: "nmos",
    reference: "M1",
    placement: { position: { x: 300, y: 100 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "model", deviceClass: "mos", name: "NMOS" },
      parameters: { w: "1u", l: "1u" },
    },
  });
  document.nets
    .find((net) => net.id === "net-vdd")!
    .terminals.push({ instanceId: "M1", pinName: "D" });
  document.nets
    .find((net) => net.id === "net-a")!
    .terminals.push({ instanceId: "M1", pinName: "G" });
  if (!ground) {
    document.nets
      .find((net) => net.id === "net-a")!
      .terminals.push({ instanceId: "M1", pinName: "S" });
    return project;
  }
  // GND as the editor draws a power label for a port: a supply claim, on
  // a wire from M1's source to R2.
  document.instances.push({
    id: "R2",
    symbolId: "resistor",
    reference: "R2",
    placement: { position: { x: 300, y: 300 }, rotation: 0, mirror: "none" },
    netlist: { parameters: { value: "2k" } },
  });
  document.nets
    .find((net) => net.id === "net-a")!
    .terminals.push({ instanceId: "R2", pinName: "1" });
  document.nets.push({
    id: "net-gnd",
    terminals: [
      { instanceId: "M1", pinName: "S" },
      { instanceId: "R2", pinName: "2" },
    ],
  });
  document.routes.push({
    id: "route-gnd",
    netId: "net-gnd",
    start: { kind: "terminal", instanceId: "M1", pinName: "S" },
    legs: [
      {
        id: "leg-gnd",
        to: {
          kind: "endpoint",
          endpoint: { kind: "terminal", instanceId: "R2", pinName: "2" },
        },
        mode: "manual",
      },
    ],
  });
  document.netlist!.terminals.push({
    id: "terminal-gnd",
    name: "GND",
    netId: "net-gnd",
    direction: "inout",
    interfaceInstanceIds: [],
    interfaceAnnotationId: "label-gnd",
  });
  document.annotations.push({
    ...label,
    id: "label-gnd",
    netId: "net-gnd",
    binding: { kind: "cell-terminal-name", terminalId: "terminal-gnd" },
    anchor: { kind: "free", position: { x: 300, y: 200 } },
  } as Annotation);
  document.connectivityEvidence.push({
    ...claim,
    id: "evidence-gnd",
    netId: "net-gnd",
    name: "GND",
    owner: { kind: "power-marker", objectId: "label-gnd" },
  } as (typeof document.connectivityEvidence)[number]);
  return project;
}

it.each(
  (["spice", "spectre"] as const).flatMap((format) =>
    (["AVDD", "VDD GND"] as const).map((ports) => [format, ports] as const),
  ),
)(
  "keeps a Cell whose power label ports are the supplies its unwired bodies take (%s+RNL, %s)",
  async (format, ports) => {
    // dut's NMOS body has no Net: it takes ground, the VSS pin the export
    // adds after the Cell's drawn supplies (AVDD, or VDD and GND, which RNL
    // reads as ground 0), each drawn only as its power label. Taken back,
    // each label is its port's interface again, so the body adds no VDD pin
    // of its own, and VSS goes again, printed where the file has it.
    const project = labelledSupplies(ports.split(" ")[0]!, ports !== "AVDD");
    const exported = createRnlExport(project, { format });
    expect(exported.status === "ready" && exported.request.netlist).toMatch(
      new RegExp(`subckt dut \\(?${ports} VSS A\\b`, "u"),
    );
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    expect(plan.drawing).not.toBe("discarded");
    // The VSS pin goes again: dut has the Pins it was drawn with.
    const pins = (circuit: CircuitProject) =>
      circuit.documents[0]!.netlist!.terminals.map(
        (terminal) => terminal.name,
      ).sort();
    expect(pins(plan.project)).toEqual(pins(project));
    // The stand-in NMOS card reads back as the Project's own model, which
    // the netlist then leaves out: that is #1815's, not this.
    const netlist = (circuit: CircuitProject) => {
      const result = createDesignNetlistExport(circuit, { format });
      return result.status === "ready"
        ? result.file.text.replace(/^\.?model NMOS .*\n/gmu, "")
        : result.status;
    };
    expect(netlist(plan.project)).toBe(netlist(project));
  },
);

/**
 * An nmos M1 that calls a model source's subcircuit, so SPICE prints it as
 * XM1, in a Cell with its own naming typography.
 */
function namedSubcircuitPart(): CircuitProject {
  const project = createEmptyProject("named-part", "Named part");
  project.modelSources = [
    {
      id: "source",
      language: "spice",
      revision: 1,
      entry: "nch.spice",
      dependencies: [],
      files: [
        {
          path: "nch.spice",
          text: ".subckt nch_mac D G S B\nRDS D S 1k\n.ends nch_mac\n",
        },
      ],
    },
  ];
  project.externalSubcircuitDefinitions = [
    {
      id: "nch",
      name: "nch_mac",
      interfaceStatus: "declared",
      terminals: ["D", "G", "S", "B"].map((name) => ({
        id: name,
        name,
        direction: "inout" as const,
      })),
      formalParameters: [],
      implementation: { kind: "source", sourceId: "source", entry: "nch_mac" },
    },
  ];
  const document = project.documents[0]!;
  document.presentation.labelSubscriptItalic = false;
  document.presentation.textFace = "serif";
  document.presentation.crossingStyle = "hop";
  document.instances.push({
    id: "M1",
    reference: "M1",
    symbolId: "nmos",
    placement: { position: { x: 200, y: 200 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "external-subcircuit", definitionId: "nch" },
      parameters: {},
    },
  });
  for (const pinName of ["D", "G", "S", "B"])
    document.noConnects.push({
      id: `M1${pinName}`,
      endpoint: { kind: "terminal", instanceId: "M1", pinName },
    });
  return project;
}

it.each(["spice", "spectre"] as const)(
  "writes a part's name and a Cell's typography, and reads the typography back, through %s+RNL",
  async (format) => {
    const project = namedSubcircuitPart();
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready")
      throw new Error(
        JSON.stringify(
          [...exported.netlistDiagnostics, ...exported.diagnostics].filter(
            (item) => item.severity === "error",
          ),
        ),
      );
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    // Each setting other than Analog Canvas's default.
    expect(written.text).toContain(
      '$CANVAS_TYPESETTING @ATTACH(subscript_italic=false, face="serif", crossings="hop") #(level)',
    );
    // Spectre prints M1 as M1; only SPICE needs the name.
    expect(written.text.includes('$CANVAS_NAME @ATTACH(name="M1")')).toBe(
      format === "spice",
    );
    const plan = await importRnl(written.text, format);
    expect(failures(plan)).toEqual([]);
    const document = plan.project.documents.find((d) =>
      d.instances.some((i) => i.symbolId === "nmos"),
    )!;
    // nch_mac, a SPICE body the file writes no RNL of, stays the model
    // source it was rather than a Cell, whose calls take names starting
    // with X: XM1 is M1 again (#1791). Spectre reads its SPICE section as a
    // Cell still, whose call keeps the X the conversion gave it.
    expect(
      plan.diagnostics.some((item) => item.code === "RNL_IMPORT_NAME_REFUSED"),
    ).toBe(false);
    expect(
      document.instances.find((i) => i.symbolId === "nmos")?.reference,
    ).toBe(format === "spice" ? "M1" : "XM1");
    expect(document.presentation.labelSubscriptItalic).toBe(false);
    expect(document.presentation.textFace).toBe("serif");
    expect(document.presentation.crossingStyle).toBe("hop");
    expect(document.presentation.labelFirstLetterItalic).toBeUndefined();
  },
);

/**
 * An NPN Q1 and a block X1 bound to the subcircuits of a model source whose
 * bodies Analog Canvas has no symbols for: a four-terminal Q card and a
 * behavioural B source, beside the file-level parameter and model card they
 * read.
 */
function libraryBoundParts(): CircuitProject {
  const project = createEmptyProject("library-parts", "Library parts", "dut");
  project.documents[0]!.netlist!.name = "dut";
  project.modelSources = [
    {
      id: "library",
      language: "spice",
      revision: 1,
      entry: "library.spice",
      dependencies: [],
      files: [
        {
          path: "library.spice",
          text: [
            ".param GAIN=2",
            ".model qmod npn",
            ".subckt bjt_wrap C B E params: AREA=1",
            "Q1 C B E C qmod area={AREA}",
            ".ends bjt_wrap",
            ".subckt shaper IN OUT",
            "BOUT OUT 0 V={GAIN*tanh(V(IN))}",
            ".ends shaper",
            "",
          ].join("\n"),
        },
      ],
    },
  ];
  const definition = (
    id: string,
    name: string,
    ports: string[],
    formalParameters: { name: string; defaultValue: string }[] = [],
  ) => ({
    id,
    name,
    interfaceStatus: "declared" as const,
    terminals: ports.map((port) => ({
      id: `${id}-${port}`,
      name: port,
      direction: "passive" as const,
    })),
    formalParameters,
    implementation: {
      kind: "source" as const,
      sourceId: "library",
      entry: name,
    },
  });
  project.externalSubcircuitDefinitions = [
    definition(
      "wrap",
      "bjt_wrap",
      ["C", "B", "E"],
      [{ name: "AREA", defaultValue: "1" }],
    ),
    definition("shaper", "shaper", ["IN", "OUT"]),
  ];
  const document = project.documents[0]!;
  const part = (
    id: string,
    symbolId: string,
    definitionId: string,
    y: number,
    pins: string[],
    parameters: Record<string, string> = {},
  ) => {
    document.instances.push({
      id,
      reference: id,
      symbolId,
      placement: { position: { x: 200, y }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "external-subcircuit", definitionId },
        parameters,
      },
    });
    for (const pinName of pins)
      document.noConnects.push({
        id: `${id}${pinName}`,
        endpoint: { kind: "terminal", instanceId: id, pinName },
      });
  };
  part("Q1", "npn", "wrap", 160, ["C", "B", "E"], { AREA: "2" });
  part("X1", externalSubcircuitSymbolId("shaper"), "shaper", 320, [
    "IN",
    "OUT",
  ]);
  return project;
}

it("keeps a library's bodies the file draws nothing of as the model source they were through spice+RNL (#1791)", async () => {
  const project = libraryBoundParts();
  const plan = await roundTrip(project);
  expect(failures(plan)).toEqual([]);
  // Only the circuit is a Cell; nothing in the bodies needs a symbol.
  expect(plan.project.documents.map((d) => d.netlist?.name)).toEqual(["dut"]);
  const parts = plan.project.documents[0]!.instances;
  const bound = (reference: string) => {
    const part = parts.find((instance) => instance.reference === reference)!;
    const binding = part.netlist?.binding;
    const definition = plan.project.externalSubcircuitDefinitions.find(
      (item) =>
        binding?.kind === "external-subcircuit" &&
        item.id === binding.definitionId,
    );
    return { part, definition };
  };
  const q1 = bound("Q1");
  expect(q1.part.symbolId).toBe("npn");
  expect(q1.part.placement).toEqual(
    project.documents[0]!.instances[0]!.placement,
  );
  expect(q1.part.netlist?.parameters).toEqual({ AREA: "2" });
  expect(q1.definition).toMatchObject({
    name: "bjt_wrap",
    interfaceStatus: "declared",
    terminals: [{ name: "C" }, { name: "B" }, { name: "E" }],
    formalParameters: [{ name: "AREA", defaultValue: "1" }],
    implementation: { kind: "source", entry: "bjt_wrap" },
  });
  expect(bound("X1").definition?.name).toBe("shaper");
  // The bodies, and the parameter and card they read, are their own text.
  expect(plan.project.modelSources?.[0]?.files[0]?.text).toBe(
    project.modelSources![0]!.files[0]!.text,
  );
  const netlist = (item: CircuitProject) => {
    const written = createDesignNetlistExport(item, { format: "spice" });
    if (written.status !== "ready") throw Error(JSON.stringify(written));
    return written.file.text;
  };
  expect(netlist(plan.project)).toBe(netlist(project));
});

it.each(["spice", "spectre"] as const)(
  "draws a part bound to a model source's subcircuit with its own artwork again, each pin where it was (%s+RNL)",
  async (format) => {
    const project = libraryBoundParts();
    // X1 calls shaper, drawn as a Project symbol of its own: a triangle with
    // leads, a mark and a box drawn with H and V legs.
    project.componentDefinitions = [
      {
        symbol: {
          schemaVersion: 1,
          id: "shaper-art",
          name: "Shaper",
          viewBox: { x: -44, y: -34, width: 88, height: 68 },
          pins: [
            {
              name: "IN",
              role: "input",
              at: { x: -40, y: -10 },
              direction: "west",
              presentation: { visibility: "visible", leadLength: 10 },
            },
            {
              name: "OUT",
              role: "output",
              at: { x: 30, y: 0 },
              direction: "east",
              presentation: { visibility: "visible", leadLength: 10 },
            },
          ],
          primitives: [
            { kind: "line", from: { x: -40, y: -10 }, to: { x: -30, y: -10 } },
            { kind: "line", from: { x: 20, y: 0 }, to: { x: 30, y: 0 } },
            { kind: "path", data: "M -30 -30 L -30 30 L 20 0 Z" },
            { kind: "circle", center: { x: -10, y: 0 }, radius: 4 },
            { kind: "path", data: "M -20 -8 H -14 V 8 H -20 Z" },
          ],
          variants: [],
        },
      },
    ] as unknown as CircuitProject["componentDefinitions"];
    const part = project.documents[0]!.instances.find(
      (instance) => instance.id === "X1",
    )!;
    part.symbolId = "shaper-art";
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    expect(plan.drawing).not.toBe("discarded");
    const back = plan.project.documents[0]!.instances.find(
      (instance) => instance.reference === "X1",
    )!;
    expect(back.placement).toEqual(part.placement);
    const drawn = (item: CircuitProject, symbolId: string) => {
      const definition = createProjectSymbolResolver(
        item,
        builtInSymbols,
      ).resolve(symbolId)?.definition;
      return {
        pins: definition?.pins.map(({ name, at, direction }) => ({
          name,
          at,
          direction,
        })),
        primitives: definition?.primitives.map((primitive) => primitive.kind),
      };
    };
    expect(drawn(plan.project, back.symbolId)).toEqual({
      pins: drawn(project, "shaper-art").pins,
      // Leads and legs come back as lines and outlines, the mark as a circle.
      primitives: ["line", "line", "polygon", "circle", "polygon"],
    });
  },
);

/**
 * Labels the import cannot tell from their text alone: a Cell Pin drawn as
 * a supply whose power label shows the Pin's name, a resistor whose name
 * label is its own text, and a parameter shown without its value.
 */
function boundLabels(): CircuitProject {
  const project = createEmptyProject("labels", "Labels", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const at = (x: number, y: number) =>
    ({ position: { x, y }, rotation: 0, mirror: "none" }) as const;
  const label = (
    id: string,
    kind: "instance-label" | "instance-value" | "power-label",
    objectId: string,
    offset: { x: number; y: number },
    text: Partial<Annotation>,
  ): Annotation =>
    ({
      id,
      kind,
      anchor: {
        kind: "object",
        objectId,
        localOffset: offset,
        fallbackPosition: offset,
      },
      alignment: "start",
      rotation: 0,
      locked: false,
      ...text,
    }) as Annotation;
  document.instances.push(
    { id: "VDD1", symbolId: "vdd-port", placement: at(200, 100) },
    {
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: at(200, 200),
      netlist: { parameters: { value: "1k" } },
    },
    {
      id: "C1",
      reference: "C1",
      symbolId: "capacitor",
      placement: at(400, 200),
      netlist: { parameters: { value: "1p" } },
    },
  );
  document.nets.push({
    id: "vdd",
    terminals: [
      { instanceId: "VDD1", pinName: "P" },
      { instanceId: "R1", pinName: "1" },
      { instanceId: "C1", pinName: "1" },
    ],
  });
  document.netlist!.terminals.push({
    id: "terminal-vdd",
    name: "VDD",
    netId: "vdd",
    direction: "inout",
    interfaceInstanceIds: ["VDD1"],
  });
  for (const [id, part] of [
    ["R12", "R1"],
    ["C12", "C1"],
  ] as const)
    document.noConnects.push({
      id,
      endpoint: { kind: "terminal", instanceId: part, pinName: "2" },
    });
  document.annotations.push(
    label(
      "vdd-label",
      "power-label",
      "VDD1",
      { x: 20, y: 10 },
      {
        netId: "vdd",
        binding: { kind: "cell-terminal-name", terminalId: "terminal-vdd" },
      },
    ),
    // Its own text, which reads as the name it has.
    label(
      "r1-name",
      "instance-label",
      "R1",
      { x: 15, y: 5 },
      {
        content: { runs: [{ kind: "text", value: "R1" }] },
      },
    ),
    label(
      "c1-name",
      "instance-label",
      "C1",
      { x: 15, y: 5 },
      {
        binding: { kind: "instance-reference", instanceId: "C1" },
      },
    ),
    label(
      "c1-value",
      "instance-value",
      "C1",
      { x: 15, y: 20 },
      {
        binding: {
          kind: "instance-value",
          instanceId: "C1",
          parameter: "value",
          showValue: false,
        },
      },
    ),
  );
  return project;
}

it.each(["spice", "spectre"] as const)(
  "says what each bound label shows, and reads it back, through %s+RNL",
  async (format) => {
    const project = boundLabels();
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready")
      throw new Error(
        JSON.stringify(
          [...exported.netlistDiagnostics, ...exported.diagnostics].filter(
            (item) => item.severity === "error",
          ),
        ),
      );
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    expect(written.text).toContain(
      '$CANVAS_LABEL @ATTACH(bind="port") %power1(label)',
    );
    expect(written.text).toContain(
      '$CANVAS_LABEL @ATTACH(bind="name") #C1::name(label)',
    );
    expect(written.text).toContain(
      '$CANVAS_LABEL @ATTACH(bind="parameter", parameter="value", show_value=false) #C1::value(label)',
    );
    // A label that holds its own text says nothing.
    expect(written.text).not.toContain("#R1::name(label)");
    const plan = await importRnl(written.text, format);
    expect(failures(plan)).toEqual([]);
    const document = plan.project.documents.find(
      (d) => d.netlist?.name === "dut",
    )!;
    const ownerOf = ({ anchor }: Annotation) =>
      anchor.kind === "object"
        ? document.instances.find((i) => i.id === anchor.objectId)
        : undefined;
    const power = document.annotations.find((a) => a.kind === "power-label");
    expect(power?.binding?.kind).toBe("cell-terminal-name");
    expect(power && ownerOf(power)?.symbolId).toBe("vdd-port");
    const shownBy = (reference: string, kind: Annotation["kind"]) =>
      document.annotations.filter(
        (a) =>
          a.kind === kind &&
          a.visible !== false &&
          ownerOf(a)?.reference === reference,
      );
    expect(shownBy("R1", "instance-label").map((a) => a.binding)).toEqual([
      undefined,
    ]);
    expect(shownBy("C1", "instance-label").map((a) => a.binding)).toEqual([
      { kind: "instance-reference", instanceId: expect.any(String) },
    ]);
    expect(shownBy("C1", "instance-value").map((a) => a.binding)).toEqual([
      {
        kind: "instance-value",
        instanceId: expect.any(String),
        parameter: "value",
        showValue: false,
      },
    ]);
  },
);

it.each(["spice", "spectre"] as const)(
  "keeps each part's colour, and its labels' own, through %s+RNL",
  async (format) => {
    const project = boundLabels();
    const document = project.documents[0]!;
    const part = (id: string) =>
      document.instances.find((instance) => instance.id === id)!;
    part("R1").styleOverride = { foreground: "#dc2626" };
    part("VDD1").styleOverride = { foreground: "#2563eb" };
    part("C1").styleOverride = { foreground: "#16a34a" };
    const labelOf = (from: CircuitProject, kind: string) =>
      from.documents[0]!.annotations.find(
        (annotation) =>
          annotation.kind === kind &&
          (annotation.binding as { instanceId?: string } | undefined)
            ?.instanceId !== undefined &&
          from.documents[0]!.instances.find(
            (instance) =>
              instance.id ===
              (annotation.binding as { instanceId: string }).instanceId,
          )?.reference === "C1",
      )!;
    // The name in its part's colour, which it follows; the value in its own.
    labelOf(project, "instance-label").textColor = "#16a34a";
    labelOf(project, "instance-value").textColor = "#7c3aed";
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready") throw new Error("export blocked");
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    expect(written.text).toContain(
      '@DEFINE-STYLE(linecolor="#dc2626", textcolor="#dc2626")',
    );
    expect(written.text).toContain("@SET-STYLE");
    const plan = await importRnl(written.text, format);
    expect(failures(plan)).toEqual([]);
    const back = plan.project.documents[0]!;
    const colour = (find: (instance: Instance) => boolean) =>
      back.instances.find(find)?.styleOverride?.foreground;
    expect(colour((instance) => instance.reference === "R1")).toBe("#dc2626");
    expect(colour((instance) => instance.reference === "C1")).toBe("#16a34a");
    expect(colour((instance) => instance.symbolId === "vdd-port")).toBe(
      "#2563eb",
    );
    expect(labelOf(plan.project, "instance-label").textColor).toBeUndefined();
    expect(labelOf(plan.project, "instance-value").textColor).toBe("#7c3aed");
  },
);

it.each(["spice", "spectre"] as const)(
  "keeps the author's text of a value the netlist writes otherwise through %s+RNL",
  async (format) => {
    const project = boundLabels();
    const parts = project.documents[0]!.instances;
    parts.find((i) => i.id === "C1")!.netlist!.parameters.value = "100fF";
    parts.find((i) => i.id === "R1")!.netlist!.parameters.value = "2.2MegΩ";
    // A pulse source, its fields named as Spectre names them.
    parts.push({
      id: "V1",
      reference: "V1",
      symbolId: "voltage-source",
      placement: { position: { x: 600, y: 200 }, rotation: 0, mirror: "none" },
      netlist: {
        parameters: {
          waveform: "pulse",
          low: "0",
          high: "1.8V",
          delay: "1ns",
          rise: "50ps",
          fall: "50ps",
          width: "5ns",
          period: "10ns",
          dc: "0",
        },
      },
    });
    const document = project.documents[0]!;
    document.nets
      .find((net) => net.id === "vdd")!
      .terminals.push({
        instanceId: "V1",
        pinName: "+",
      });
    document.noConnects.push({
      id: "V1-",
      endpoint: { kind: "terminal", instanceId: "V1", pinName: "-" },
    });
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready") throw new Error("export blocked");
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    // Spectre reads 100f and 2.2M; SPICE writes the text as it is.
    expect(written.text.includes("c=100f")).toBe(format === "spectre");
    expect(
      written.text.includes(
        '$CANVAS_PARAMETER_TEXT @ATTACH(name="c", text="100fF") #C1(part)',
      ),
    ).toBe(format === "spectre");
    expect(
      written.text.includes(
        '$CANVAS_PARAMETER_TEXT @ATTACH(name="r", text="2.2MegΩ") #R1(part)',
      ),
    ).toBe(format === "spectre");
    const plan = await importRnl(written.text, format);
    expect(
      failures(plan).map((item) => `${item.code}: ${item.message}`),
    ).toEqual([]);
    const back = plan.project.documents.flatMap((d) => d.instances);
    expect(
      back.find((i) => i.reference === "C1")?.netlist?.parameters.value,
    ).toBe("100fF");
    expect(
      back.find((i) => i.reference === "R1")?.netlist?.parameters.value,
    ).toBe("2.2MegΩ");
    expect(
      back.find((i) => i.reference === "V1")?.netlist?.parameters,
    ).toMatchObject({ high: "1.8V", delay: "1ns", rise: "50ps", width: "5ns" });
    if (format === "spectre")
      expect(written.text).toContain(
        '$CANVAS_PARAMETER_TEXT @ATTACH(name="val1", text="1.8V") #V1(part)',
      );
    const before = createDesignNetlistExport(project, { format });
    const after = createDesignNetlistExport(plan.project, { format });
    expect(after.status === "ready" && after.file.text).toBe(
      before.status === "ready" && before.file.text,
    );
  },
);

it.each(["spice", "spectre"] as const)(
  "keeps the author's text of a SKY130 size the netlist prints in micrometres through %s+RNL",
  async (format) => {
    const project = example("five-transistor-ota-sky130");
    const parts = project.documents.flatMap((d) => d.instances);
    const m1 = parts.find((i) => i.id === "M1")!.netlist!.parameters;
    m1.l = "0.15u";
    m1.w = "0.5u";
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready") throw new Error("export blocked");
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    // The netlist reads 0.15 and 0.5, which come back as 150n and 500n.
    expect(written.text).toMatch(/\bl=0\.15\b/u);
    expect(written.text).toContain(
      '$CANVAS_PARAMETER_TEXT @ATTACH(name="l", text="0.15u") #XM1(part)',
    );
    // A size read back as written takes no text: 1u and 96u stay.
    expect(written.text).not.toContain('text="96u"');
    const plan = await importRnl(written.text, format);
    expect(
      plan.diagnostics.filter(
        (item) => item.code === "RNL_IMPORT_PARAMETER_TEXT",
      ),
    ).toEqual([]);
    const back = (id: string) =>
      plan.project.documents
        .flatMap((d) => d.instances)
        .find((i) => i.reference === parts.find((p) => p.id === id)!.reference)
        ?.netlist?.parameters;
    expect(back("M1")).toMatchObject({ l: "0.15u", w: "0.5u" });
    expect(back("M2")).toMatchObject({ l: "1u", w: "96u" });
    const before = createDesignNetlistExport(project, { format });
    const after = createDesignNetlistExport(plan.project, { format });
    expect(after.status === "ready" && after.file.text).toBe(
      before.status === "ready" && before.file.text,
    );
  },
);

it("ends a wire to a port on no port, or to ground on no ground, at a junction there", async () => {
  // A flat file has no ports, and its VSS is no ground: the port is its
  // net's label, the ground a picture, and both keep their wires.
  const text = [
    "* flat",
    '* @RNL(type="header") { @VERSION("0.3"); @USE-PACKAGE(name="rnl-std-full", version="0.3") }',
    "R1 in VSS 1k",
    "V1 in 0 1",
    "V2 VSS 0 0",
    "* @RNL {",
    '*   #R1 @PLACE(0, 0) => @ORIENT("R0");',
    '*   %p = $IO_PORT @ATTACH &in => @PLACE(-6, 1) => @ORIENT("R0");',
    '*   %g = $GROUND @ATTACH &VSS => @PLACE(0, -4) => @ORIENT("R0");',
    "*   &in @WIRE {%p:p (0, 1) #R1:1};",
    "*   &VSS @WIRE {#R1:2 %g:p};",
    "* }",
    ".end",
    "",
  ].join("\n");
  const plan = await importRnl(text, "spice");
  expect(failures(plan)).toEqual([]);
  expect(
    plan.diagnostics.filter((item) => item.code === "RNL_IMPORT_WIRE_SKIPPED"),
  ).toEqual([]);
  const top = plan.project.documents.find((d) =>
    d.instances.some((i) => i.id.toLowerCase() === "r1"),
  )!;
  const ends = top.routes.flatMap((route) => [
    route.start,
    ...route.legs.flatMap((leg) =>
      leg.to.kind === "endpoint" ? [leg.to.endpoint] : [],
    ),
  ]);
  const junctions = ends.flatMap((end) =>
    end.kind === "junction" ? [end.junctionId] : [],
  );
  expect(junctions).toHaveLength(2);
  const name = (netId: string) =>
    top.importReference?.nets.find((net) => net.id === netId)?.name;
  const label = top.annotations.find((item) => item.kind === "net-label");
  expect(label && name(label.netId!)).toBe("in");
  expect(label?.binding?.kind).toBe("net-name");
  expect(label?.anchor.kind === "object" && label.anchor.objectId).toBe(
    top.junctions.find((junction) => name(junction.netId) === "in")?.id,
  );
  expect(junctions).toContain(
    top.junctions.find((junction) => name(junction.netId) === "VSS")?.id,
  );
  expect(
    top.drafting?.objects.filter((item) => item.kind === "floating-symbol"),
  ).toHaveLength(1);
});

it("joins a wire that ends on a point another wire runs straight through", async () => {
  // The gate wire runs straight through %j; the port's wire ends there.
  const text = [
    "* through",
    '* @RNL(type="header") { @VERSION("0.3"); @USE-PACKAGE(name="rnl-std-full", version="0.3") }',
    ".model NMOS nmos level=54",
    ".model PMOS pmos level=54",
    ".subckt inv a y vdd vss",
    "MP y a vdd vdd PMOS w=2u l=0.18u",
    "MN y a vss vss NMOS w=1u l=0.18u",
    "* @RNL {",
    '*   #MP @PLACE(0, 3) => @ORIENT("R0");',
    '*   #MN @PLACE(0, -3) => @ORIENT("R0");',
    '*   %p = $IO_PORT @ATTACH &a => @PLACE(-6, 0) => @ORIENT("R0");',
    "*   %j = (-4, 0);",
    "*   $JUNCTION @ATTACH {%j};",
    "*   &a @WIRE {#MP:g (-4, 3) %j (-4, -3) #MN:g};",
    "*   &a @WIRE {%p:p %j};",
    "* }",
    ".ends inv",
    "X1 in out VDD 0 inv",
    ".end",
    "",
  ].join("\n");
  const plan = await importRnl(text, "spice");
  expect(failures(plan)).toEqual([]);
  const cell = plan.project.documents.find((d) => d.netlist?.name === "inv")!;
  const net = cell.nets.find((item) =>
    item.terminals.some((t) => t.instanceId === "MP" && t.pinName === "G"),
  )!;
  // The gate wire is two routes, each reaching the junction.
  const junction = cell.junctions.find((item) => item.netId === net.id)!;
  const routes = cell.routes.filter((route) => route.netId === net.id);
  expect(routes).toHaveLength(3);
  for (const route of routes) {
    const end = route.legs.at(-1)!.to;
    expect(
      [route.start, end.kind === "endpoint" ? end.endpoint : null].some(
        (item) => item?.kind === "junction" && item.junctionId === junction.id,
      ),
    ).toBe(true);
  }
  const resolver = createProjectSymbolResolver(plan.project, builtInSymbols);
  expect(
    deriveImportedRoutingGuidance(cell, resolver).filter(
      (guide) => guide.netId === net.id,
    ),
  ).toEqual([]);
});

it("reads a Cell's call drawn with the standard gate in its terminal order as the Library gate", async () => {
  // X1 prints its pins as $INVERTER numbers its terminals (a, y, then the
  // supplies); X2 prints its supplies first, so its wires would move.
  const text = [
    "* std gate",
    '* @RNL(type="header") { @VERSION("0.3"); @USE-PACKAGE(name="rnl-std-full", version="0.3") }',
    ".model NMOS nmos level=54",
    ".model PMOS pmos level=54",
    ".subckt inv a y vdd vss",
    "MP y a vdd vdd PMOS w=2u l=0.18u",
    "MN y a vss vss NMOS w=1u l=0.18u",
    '* @RNL { #MP @PLACE(0, 3) => @ORIENT("R0"); #MN @PLACE(0, -3) => @ORIENT("R0") }',
    ".ends inv",
    ".subckt invs vdd vss a y",
    "MP y a vdd vdd PMOS w=2u l=0.18u",
    "MN y a vss vss NMOS w=1u l=0.18u",
    ".ends invs",
    "X1 in out VDD 0 inv",
    "X2 VDD 0 out out2 invs",
    "V1 in 0 1",
    "V2 VDD 0 1",
    "R3 out 0 1k",
    "* @RNL {",
    "*   {#X1 #X2} @SET-SYMBOL $INVERTER;",
    '*   #X1 @PLACE(0, 0) => @ORIENT("R0");',
    '*   #X2 @PLACE(10, 6) => @ORIENT("R0");',
    '*   #V1 @PLACE(-8, -2) => @ORIENT("R0");',
    '*   #R3 @PLACE(4, -2) => @ORIENT("R0");',
    "*   &out @WIRE {#X1:2 (4, 0) #R3:1};",
    "*   &in @WIRE {#V1:1 (-8, 0) #X1:1};",
    "* }",
    ".end",
    "",
  ].join("\n");
  const plan = await importRnl(text, "spice");
  expect(failures(plan)).toEqual([]);
  const top = plan.project.documents.find((d) =>
    d.instances.some((i) => i.id.toLowerCase() === "x1"),
  )!;
  const part = (id: string) =>
    top.instances.find((i) => i.id.toLowerCase() === id)!;
  expect(part("x1").symbolId).toBe("inverter");
  expect(part("x2").symbolId).not.toBe("inverter");
  expect(
    plan.diagnostics
      .filter((item) => item.code === "RNL_IMPORT_UNMAPPED_SYMBOL")
      .map((item) => item.message.split(" ")[0]),
  ).toEqual(["X2"]);
  const pins = top.routes.flatMap((route) =>
    [
      route.start,
      ...route.legs.flatMap((leg) =>
        leg.to.kind === "endpoint" ? [leg.to.endpoint] : [],
      ),
    ].flatMap((end) =>
      end.kind === "terminal" && end.instanceId === part("x1").id
        ? [end.pinName]
        : [],
    ),
  );
  expect(pins.sort()).toEqual(["A", "Y"]);
});

it("refuses a $CANVAS_NAME that is no netlist name and a typesetting it does not know, and keeps the drawing", async () => {
  const text = [
    "* refused names",
    '* @RNL(type="header") { @VERSION("0.3"); @USE-PACKAGE(name="analog-canvas-extensions", version="0.3") }',
    ".subckt nch d g s b",
    "R1 d s 1k",
    ".ends nch",
    "XM1 d g 0 0 nch",
    "XM2 d g 0 0 nch",
    "R1 d 0 1k",
    "V1 g 0 1",
    `* @RNL { $CANVAS_NAME @ATTACH(name="X 9") #XM1; $CANVAS_NAME @ATTACH(name="${"X".repeat(129)}") #XM2; $CANVAS_TYPESETTING @ATTACH(face="comic", subscript_italic=false, crossings="bridge") #(level) }`,
    ".end",
    "",
  ].join("\n");
  const plan = await importRnl(text, "spice");
  expect(failures(plan)).toEqual([]);
  const parts = plan.project.documents.flatMap((d) => d.instances);
  const card = (id: string) =>
    parts.find((instance) => instance.id.toLowerCase() === id)?.reference;
  expect(card("xm1")).toBe("XM1");
  expect(card("xm2")).toBe("XM2");
  expect(
    plan.diagnostics.filter((item) => item.code === "RNL_IMPORT_NAME_REFUSED"),
  ).toHaveLength(2);
  // The known setting stands; the unknown face and crossings leave the
  // import's own.
  const top = plan.project.documents.find((d) =>
    d.instances.some((i) => i.id.toLowerCase() === "r1"),
  )!;
  expect(top.presentation.labelSubscriptItalic).toBe(false);
  expect(top.presentation.textFace).toBeUndefined();
  expect(top.presentation.crossingStyle).toBeUndefined();
  const ignored = plan.diagnostics
    .filter((item) => item.code === "RNL_IMPORT_TYPESETTING_IGNORED")
    .map((item) => item.message);
  expect(ignored.some((message) => message.startsWith('face="comic"'))).toBe(
    true,
  );
  expect(
    ignored.some((message) => message.startsWith('crossings="bridge"')),
  ).toBe(true);
});

it("reads a rectangle given by its two corners as the one between them", async () => {
  const text = [
    "* frames",
    '* @RNL(type="header") { @VERSION("0.3"); @USE-PACKAGE(name="rnl-std-full", version="0.3") }',
    "R1 a 0 1k",
    "* @RNL {",
    '*   #R1 @SET-SYMBOL $RESISTOR => @PLACE(0, 0) => @ORIENT("R0");',
    "*   @RECTANGLE {(-7, 10.5) (-1, 30.5)};",
    "*   (4, 1) @RECTANGLE(width=6, height=2)",
    "* }",
    ".end",
    "",
  ].join(String.fromCharCode(10));
  const plan = await importRnl(text, "spice");
  expect(failures(plan)).toEqual([]);
  const frames = plan.project.documents
    .flatMap((document) => document.drafting?.objects ?? [])
    .flatMap((object) =>
      object.kind === "rectangle"
        ? [
            {
              center: object.center,
              width: object.width,
              height: object.height,
            },
          ]
        : [],
    );
  // Ten units to one, y down.
  expect(frames).toEqual([
    { center: { x: -40, y: -205 }, width: 60, height: 200 },
    { center: { x: 40, y: -10 }, width: 60, height: 20 },
  ]);
});

it.each([
  ["a net of its caller's", "VSS", true],
  ["ground", "0", false],
] as const)(
  "keeps a Cell's VSS drawn as ground a port where its call ties it to %s",
  async (_, tie, port) => {
    const text = [
      "* ground on a Cell's VSS",
      // The fill packages draw no port of their own on a Cell's VSS.
      '* @RNL(type="header") { @VERSION("0.3"); @USE-PACKAGE(name="rnl-std-full", version="0.3"); @USE-PACKAGE(name="rnl-std-fill") {}; @USE-PACKAGE(name="rnl-std-spice") {} }',
      ".subckt cell a vss",
      "R1 a vss 1k",
      "* @RNL {",
      '*   #R1 @SET-SYMBOL $RESISTOR => @PLACE(0, 0) => @ORIENT("R0");',
      "*   %p_a = $IO_PORT @ATTACH &a => @PLACE(0, 4);",
      "*   %g = $GROUND @ATTACH &vss => @PLACE(0, -4);",
      "*   &vss @WIRE {#R1:2 %g:p}",
      "* }",
      ".ends cell",
      `X1 in ${tie} cell`,
      "R2 VSS 0 1",
      "V1 in 0 1",
      ".end",
      "",
    ].join("\n");
    const plan = await importRnl(text, "spice");
    expect(failures(plan)).toEqual([]);
    const cell = plan.project.documents.find(
      (document) => document.netlist?.name === "cell",
    )!;
    expect(
      cell.instances.find((item) => item.id === "R1")?.placement,
    ).toBeDefined();
    expect(
      cell.netlist?.terminals.some((item) => item.name.toLowerCase() === "vss"),
    ).toBe(port);
    // Ground only on ground: elsewhere the glyph is a picture.
    expect(
      plan.diagnostics.some(
        (item) => item.code === "RNL_IMPORT_GLYPH_AS_PICTURE",
      ),
    ).toBe(port);
  },
);

it.each(["spice", "spectre"] as const)(
  "keeps the Document's wire and symbol widths through %s+RNL",
  async (format) => {
    const project = calledBlocks(["crystal"]);
    project.documents[0]!.presentation.styleOverrides = {
      wireStrokeScale: 0.75,
      symbolStrokeScale: 0.8,
    };
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready") throw new Error("export blocked");
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    const plan = await importRnl(written.text, format);
    expect(failures(plan)).toEqual([]);
    const document = plan.project.documents.find(
      (item) => item.netlist?.name === "dut",
    )!;
    expect(document.presentation.styleOverrides).toMatchObject({
      wireStrokeScale: 0.75,
      symbolStrokeScale: 0.8,
    });
  },
);

it("keeps a node the file names on a pin it marks unconnected", async () => {
  // out reaches R1's n alone and is marked unconnected: Analog Canvas would
  // name such a node NC0001, so the pin keeps out, without the mark; NC0001
  // on R2 is Analog Canvas's own and becomes the mark again.
  const text = [
    "* open pins",
    '* @RNL(type="header") { @VERSION("0.3") }',
    "R1 a out 1k",
    "R2 a NC0001 1k",
    "V1 a 0 1",
    "* @RNL { #R1 @PLACE(0, 0); #R2 @PLACE(4, 0); #V1 @PLACE(8, 0); $NO_CONNECT @ATTACH #R1:n; $NO_CONNECT @ATTACH #R2:n }",
    ".end",
    "",
  ].join("\n");
  const plan = await importRnl(text, "spice");
  expect(failures(plan)).toEqual([]);
  const document = plan.project.documents[0]!;
  expect(document.noConnects.map((mark) => mark.endpoint.instanceId)).toEqual([
    document.instances.find((instance) => instance.reference === "R2")!.id,
  ]);
  expect(plan.diagnostics.map((item) => item.code)).toContain(
    "RNL_IMPORT_NO_CONNECT_NAMED",
  );
  const netlist = createDesignNetlistExport(plan.project, { format: "spice" });
  expect(netlist.status === "ready" && netlist.file.text).toMatch(
    /^R1 a out 1k$/mu,
  );
});

it.each(["spice", "spectre"] as const)(
  "writes a file's own cards back at the file level, with their drawing (%s+RNL)",
  async (format) => {
    // The importer makes one Cell of the cards outside every subcircuit;
    // exported as the top, they go back outside, not into a subcircuit.
    const text =
      format === "spice"
        ? [
            "* top level",
            '* @RNL(type="header") { @VERSION("0.3") }',
            ".subckt half a b",
            "R1 a b 1k",
            ".ends half",
            "X1 in mid half",
            "X2 mid 0 half",
            "V1 in 0 1",
            "* @RNL { #X1 @PLACE(0, 0); #X2 @PLACE(10, 0); #V1 @PLACE(-10, 0) }",
            ".end",
            "",
          ]
        : [
            "// top level",
            "simulator lang=spectre",
            '// @RNL(type="header") { @VERSION("0.3") }',
            "subckt half (a b)",
            "R1 (a b) resistor r=1k",
            "ends half",
            "X1 (in mid) half",
            "X2 (mid 0) half",
            "V1 (in 0) vsource dc=1",
            "// @RNL { #X1 @PLACE(0, 0); #X2 @PLACE(10, 0); #V1 @PLACE(-10, 0) }",
            "",
          ];
    const plan = await importRnl(text.join("\n"), format);
    expect(failures(plan)).toEqual([]);
    const exported = createRnlExport(plan.project, { format });
    if (exported.status !== "ready") throw new Error("export blocked");
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    expect(written.text).not.toMatch(/__flat__/u);
    expect(written.text).toMatch(/^X2 \(?mid 0\)? half$/mu);
    const again = await importRnl(written.text, format);
    expect(failures(again)).toEqual([]);
    const top = again.project.documents.find(
      (document) => document.id === again.project.topDocumentId,
    )!;
    expect(
      top.instances
        .filter((instance) => instance.reference)
        .map((instance) => [instance.reference, instance.placement?.position])
        .sort(),
    ).toEqual([
      ["V1", { x: -100, y: 0 }],
      ["X1", { x: 0, y: 0 }],
      ["X2", { x: 100, y: 0 }],
    ]);
  },
);

it("puts a point a bus wire meets first on the net of the wire of one net", async () => {
  // %p1 is met first by a wire of two nets (a bus, left out), then by a's
  // own wire: the point is a's, so a's wire ends there and the drawing comes
  // in (rnl-gallery's RISC-A did not).
  const text = [
    "* bus tap",
    '* @RNL(type="header") { @VERSION("0.3") }',
    "R1 a 0 1k",
    "R2 b 0 1k",
    "R3 a b 1k",
    "* @RNL {",
    '*   #R1 @PLACE(0, 0); #R2 @PLACE(10, 0); #R3 @PLACE(20, 0) => @ORIENT("R90");',
    "*   %p1 = (0, 10); %p2 = (10, 10);",
    "*   {&b &a} @WIRE {%p1 %p2};",
    "*   &a @WIRE {#R1:1 %p1}",
    "* }",
    ".end",
    "",
  ].join("\n");
  const plan = await importRnl(text, "spice");
  expect(failures(plan)).toEqual([]);
  expect(plan.drawing).not.toBe("discarded");
  expect(plan.diagnostics.map((item) => item.code)).toContain(
    "RNL_IMPORT_WIRE_SKIPPED",
  );
  const document = plan.project.documents[0]!;
  const r1 = document.instances.find((item) => item.reference === "R1")!;
  const net = document.nets.find((item) =>
    item.terminals.some((terminal) => terminal.instanceId === r1.id),
  )!;
  const junction = document.junctions.find(
    (item) => item.position.x === 0 && item.position.y === -100,
  );
  expect(junction?.netId).toBe(net.id);
});

it("keeps parts where RNL puts them, on a finer Document grid", async () => {
  // R1 at (1.3, 0) is 13 units across, off Analog Canvas's 10-unit grid: it
  // stays there, and the Document takes the 1-unit grid that holds it.
  const text = [
    "* off the grid",
    '* @RNL(type="header") { @VERSION("0.3") }',
    "R1 a 0 1k",
    "R2 a 0 1k",
    "* @RNL { #R1 @PLACE(1.3, 0); #R2 @PLACE(4, 0) }",
    ".end",
    "",
  ].join("\n");
  const plan = await importRnl(text, "spice");
  expect(failures(plan)).toEqual([]);
  const document = plan.project.documents[0]!;
  const at = (reference: string) =>
    document.instances.find((instance) => instance.reference === reference)
      ?.placement?.position;
  expect([at("R1"), at("R2")]).toEqual([
    { x: 13, y: 0 },
    { x: 40, y: 0 },
  ]);
  expect(document.presentation.grid).toBe(1);
  expect(plan.diagnostics.map((item) => item.code)).not.toContain(
    "RNL_IMPORT_SNAPPED",
  );
});

it("names a part again as Analog Canvas named it, from $CANVAS_NAME", async () => {
  // SPICE starts a subcircuit call's card with X: a part Analog Canvas
  // names otherwise prints as X and its name.
  const text = [
    "* named parts",
    '* @RNL(type="header") { @VERSION("0.3"); @USE-PACKAGE(name="analog-canvas-extensions", version="0.2") }',
    ".subckt nch d g s b",
    "R1 d s 1k",
    ".ends nch",
    "XM1 d g 0 0 nch",
    "XM2 d g 0 0 nch",
    "XM3 d g 0 0 nch",
    "R1 d 0 1k",
    "V1 g 0 1",
    '* @RNL { $CANVAS_NAME @ATTACH(name="X7") #XM1; $CANVAS_NAME @ATTACH(name="M2") #XM2; $CANVAS_NAME @ATTACH(name="r1") #XM3 }',
    ".end",
    "",
  ].join("\n");
  const plan = await importRnl(text, "spice");
  expect(failures(plan)).toEqual([]);
  const parts = plan.project.documents.flatMap((d) => d.instances);
  const card = (id: string) =>
    parts.find((instance) => instance.id.toLowerCase() === id)?.reference;
  expect(card("xm1")).toBe("X7");
  // nch, a body with no RNL of its own, is a model source's subcircuit,
  // whose calls keep any name (#1791); R1 is taken.
  expect(card("xm2")).toBe("M2");
  expect(card("xm3")).toBe("XM3");
  const codes = plan.diagnostics.map((item) => item.code);
  expect(codes).toContain("RNL_IMPORT_NAME_TAKEN");
  expect(codes).not.toContain("RNL_IMPORT_PACKAGE_VERSION");
});

it.each(["spice", "spectre"] as const)(
  "reads a gate whose Cell prints its supplies first back as the Library gate through %s+RNL",
  async (format) => {
    // An inverter on a Cell whose Pins are VDD, VSS, A, Y: the export draws
    // it with each pin on the position the call prints it at (#1788).
    const project = delayCellFixture(true);
    const gate = project.documents[0]!.instances.find((i) => i.id === "X1")!;
    gate.symbolId = "inverter";
    // The Cell keeps its Pins and C2, and a resistor from A to Y stands for
    // its transistors, which would need model cards.
    const cell = project.documents.find((d) => d.id === "delay_cmos")!;
    const kept = new Set(["pin-VDD", "pin-VSS", "pin-A", "pin-Y", "C2"]);
    cell.instances = cell.instances.filter((i) => kept.has(i.id));
    cell.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: null,
      netlist: { parameters: { value: "1k" } },
    });
    for (const net of cell.nets) {
      net.terminals = net.terminals.filter((t) => kept.has(t.instanceId));
      if (net.id === "A" || net.id === "Y")
        net.terminals.push({
          instanceId: "R1",
          pinName: net.id === "A" ? "1" : "2",
        });
    }
    cell.nets = cell.nets.filter((net) => net.terminals.length);
    cell.connectivityEvidence = cell.connectivityEvidence.filter((evidence) =>
      cell.nets.some((net) => net.id === evidence.netId),
    );
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready") throw new Error("export blocked");
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    expect(written.text).toContain("$CANVAS_CALL_INVERTER__0_0_1_2");
    const result = await importRnl(written.text, format);
    expect(failures(result)).toEqual([]);
    const top = result.project.documents.find(
      (document) => document.netlist?.name === "dut",
    )!;
    const part = top.instances.find((instance) => instance.reference === "X1");
    expect(part?.symbolId).toBe("inverter");
    expect(part?.placement).toEqual(gate.placement);
    expect(
      top.nets
        .flatMap((net) => net.terminals)
        .filter((terminal) => terminal.instanceId === part!.id)
        .map((terminal) => terminal.pinName)
        .sort(),
    ).toEqual(["A", "VDD", "VSS", "Y"]);
    const before = createDesignNetlistExport(project, { format });
    const after = createDesignNetlistExport(result.project, { format });
    expect(after.status === "ready" && after.file.text).toBe(
      before.status === "ready" && before.file.text,
    );
  },
);

it.each(["spice", "spectre"] as const)(
  "reads a Delay Cell whose Cell prints its supplies first back as the Delay Cell on that Cell through %s+RNL",
  async (format) => {
    // Its Cell's Pins are VDD, VSS, A, Y: the export draws it as it draws
    // such a gate, with each pin on the position the call prints it at (#1819).
    const project = delayCellFixture(true);
    const part = project.documents[0]!.instances.find((i) => i.id === "X1")!;
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready") throw new Error("export blocked");
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    expect(written.text).toContain("$CANVAS_CALL_DELAY_CELL__0_0_1_2");
    expect(written.text).not.toContain("$CANVAS_DELAY_CELL");
    const result = await importRnl(written.text, format);
    expect(failures(result)).toEqual([]);
    const top = result.project.documents.find(
      (document) => document.netlist?.name === "dut",
    )!;
    const back = top.instances.find((instance) => instance.reference === "X1");
    expect(back?.symbolId).toBe("delay-cell");
    expect(back?.placement).toEqual(part.placement);
    const binding = back?.netlist?.binding;
    expect(
      binding?.kind === "subcircuit" &&
        result.project.documents.find(
          (document) => document.id === binding.childDocumentId,
        )?.netlist?.name,
    ).toBe("delay_cmos");
    expect(
      top.nets
        .flatMap((net) => net.terminals)
        .filter((terminal) => terminal.instanceId === back!.id)
        .map((terminal) => terminal.pinName)
        .sort(),
    ).toEqual(["A", "VDD", "VSS", "Y"]);
    const before = createDesignNetlistExport(project, { format });
    const after = createDesignNetlistExport(result.project, { format });
    expect(after.status === "ready" && after.file.text).toBe(
      before.status === "ready" && before.file.text,
    );
  },
);

it.each(["spice", "spectre"] as const)(
  "takes no Cell Pin for the supplies a Library gate's rails print through %s+RNL",
  async (format) => {
    // The gate's rails left to the Cell, as a gate is drawn: dut prints VDD
    // and its ground for them, which no drawing shows (#1787).
    const project = delayCellFixture(true);
    const top = project.documents[0]!;
    top.instances.find((i) => i.id === "X1")!.symbolId = "inverter";
    for (const net of top.nets)
      net.terminals = net.terminals.filter(
        (t) =>
          t.instanceId !== "X1" || (t.pinName !== "VDD" && t.pinName !== "VSS"),
      );
    top.nets = top.nets.filter((net) => net.terminals.length);
    top.connectivityEvidence = top.connectivityEvidence.filter((evidence) =>
      top.nets.some((net) => net.id === evidence.netId),
    );
    const cell = project.documents.find((d) => d.id === "delay_cmos")!;
    const kept = new Set(["pin-VDD", "pin-VSS", "pin-A", "pin-Y", "C2"]);
    cell.instances = cell.instances.filter((i) => kept.has(i.id));
    cell.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: null,
      netlist: { parameters: { value: "1k" } },
    });
    for (const net of cell.nets) {
      net.terminals = net.terminals.filter((t) => kept.has(t.instanceId));
      if (net.id === "A" || net.id === "Y")
        net.terminals.push({
          instanceId: "R1",
          pinName: net.id === "A" ? "1" : "2",
        });
    }
    cell.nets = cell.nets.filter((net) => net.terminals.length);
    cell.connectivityEvidence = cell.connectivityEvidence.filter((evidence) =>
      cell.nets.some((net) => net.id === evidence.netId),
    );
    const exported = createRnlExport(project, { format });
    expect(exported.status === "ready" && exported.request.netlist).toMatch(
      /subckt dut \(?VDD VSS\b/u,
    );
    const result = await roundTrip(project, format);
    expect(failures(result)).toEqual([]);
    const dut = result.project.documents.find(
      (document) => document.netlist?.name === "dut",
    )!;
    expect(dut.netlist!.terminals.map((t) => t.name)).toEqual([]);
    expect(
      dut.instances.find((instance) => instance.reference === "X1")?.symbolId,
    ).toBe("inverter");
    const before = createDesignNetlistExport(project, { format });
    const after = createDesignNetlistExport(result.project, { format });
    expect(after.status === "ready" && after.file.text).toBe(
      before.status === "ready" && before.file.text,
    );
  },
);

it.each(["spice", "spectre"] as const)(
  "reads a gate back as the Library gate when its Cell draws ground through %s+RNL",
  async (format) => {
    // The Cell draws ground and has no VSS Pin: the netlist gives it one,
    // which the import undoes as it reads the Cell, before the call.
    const project = delayCellFixture(true);
    const top = project.documents[0]!;
    const gate = top.instances.find((i) => i.id === "X1")!;
    gate.symbolId = "inverter";
    for (const net of top.nets)
      net.terminals = net.terminals.filter(
        (t) => t.instanceId !== "X1" || t.pinName !== "VSS",
      );
    top.nets = top.nets.filter((net) => net.terminals.length);
    top.connectivityEvidence = top.connectivityEvidence.filter((evidence) =>
      top.nets.some((net) => net.id === evidence.netId),
    );
    // The top draws its own ground, a load on the output.
    top.instances.push(
      {
        id: "C0",
        reference: "C0",
        symbolId: "capacitor",
        placement: {
          position: { x: 500, y: 300 },
          rotation: 0,
          mirror: "none",
        },
        netlist: { parameters: { value: "1p" } },
      },
      {
        id: "GND0",
        symbolId: "ground",
        placement: {
          position: { x: 500, y: 400 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    top.nets
      .find((net) => net.id === "output")!
      .terminals.push({ instanceId: "C0", pinName: "1" });
    top.nets.push({
      id: "gnd",
      terminals: [
        { instanceId: "C0", pinName: "2" },
        { instanceId: "GND0", pinName: "0" },
      ],
    });
    top.connectivityEvidence.push({
      id: "gnd0-claim",
      kind: "name-claim",
      netId: "gnd",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "power-marker", objectId: "GND0" },
    });
    const cell = project.documents.find((d) => d.id === "delay_cmos")!;
    const kept = new Set(["pin-VDD", "pin-A", "pin-Y", "C2"]);
    cell.instances = cell.instances.filter((i) => kept.has(i.id));
    // Its Pins named in lower case, which a gate meets without case.
    cell.netlist!.terminals = cell
      .netlist!.terminals.filter((t) => t.name !== "VSS")
      .map((t) => ({ ...t, name: t.name.toLowerCase() }));
    cell.instances.push(
      {
        id: "R1",
        reference: "R1",
        symbolId: "resistor",
        placement: null,
        netlist: { parameters: { value: "1k" } },
      },
      {
        id: "GND1",
        symbolId: "ground",
        placement: {
          position: { x: 300, y: 300 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    for (const net of cell.nets) {
      net.terminals = net.terminals.filter((t) => kept.has(t.instanceId));
      if (net.id === "A" || net.id === "Y")
        net.terminals.push({
          instanceId: "R1",
          pinName: net.id === "A" ? "1" : "2",
        });
      if (net.id === "VSS")
        net.terminals.push({ instanceId: "GND1", pinName: "0" });
    }
    cell.nets = cell.nets.filter((net) => net.terminals.length);
    cell.connectivityEvidence = [
      ...cell.connectivityEvidence.filter((evidence) =>
        cell.nets.some((net) => net.id === evidence.netId),
      ),
      {
        id: "gnd-claim",
        kind: "name-claim",
        netId: "VSS",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        owner: { kind: "power-marker", objectId: "GND1" },
      },
    ];
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready") throw new Error("export blocked");
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    expect(written.text).toContain("$CANVAS_CALL_INVERTER__");
    const result = await importRnl(written.text, format);
    expect(failures(result)).toEqual([]);
    const back = result.project.documents.find(
      (document) => document.netlist?.name === "dut",
    )!;
    const part = back.instances.find((instance) => instance.reference === "X1");
    expect(part?.symbolId).toBe("inverter");
    // The call keeps its printed terminals, the ground pin's undone.
    expect(
      part?.importProvenance?.terminalMapping?.map((item) => item.pinName),
    ).toEqual(["VDD", "A", "Y"]);
    expect(part?.placement).toEqual(gate.placement);
    const before = createDesignNetlistExport(project, { format });
    const after = createDesignNetlistExport(result.project, { format });
    expect(after.status === "ready" && after.file.text).toBe(
      before.status === "ready" && before.file.text,
    );
  },
);

it.each(["spice", "spectre"] as const)(
  "puts a net label on its wire exactly where it stood, through %s+RNL",
  async (format) => {
    // 80 along a wire of 230: a share no fixed number of digits writes.
    const project = createEmptyProject("labels", "Labels", "dut");
    const document = project.documents[0]!;
    document.netlist!.name = "dut";
    document.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: -80, y: 200 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1k" } },
    });
    document.nets.push({
      id: "dx",
      terminals: [{ instanceId: "R1", pinName: "1" }],
    });
    document.noConnects.push({
      id: "R12",
      endpoint: { kind: "terminal", instanceId: "R1", pinName: "2" },
    });
    document.junctions.push(
      { id: "JA", netId: "dx", position: { x: -80, y: 100 } },
      { id: "JB", netId: "dx", position: { x: 150, y: 100 } },
    );
    const wire = createRoutePath({
      id: "wire",
      netId: "dx",
      start: { kind: "junction", junctionId: "JA" },
      end: { kind: "junction", junctionId: "JB" },
      bends: [],
      modes: ["manual"],
    });
    document.routes.push(
      createRoutePath({
        id: "tap",
        netId: "dx",
        start: { kind: "terminal", instanceId: "R1", pinName: "1" },
        end: { kind: "junction", junctionId: "JA" },
        bends: [],
        modes: ["manual"],
      }),
      wire,
    );
    document.annotations.push({
      id: "dx-label",
      kind: "net-label",
      netId: "dx",
      binding: { kind: "net-name", netId: "dx" },
      anchor: {
        kind: "route",
        routeId: "wire",
        legId: wire.legs[0]!.id,
        t: 80 / 230,
        normalOffset: -4,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 0, y: 96 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push({
      id: "dx-claim",
      kind: "name-claim",
      netId: "dx",
      name: "dx",
      scope: "local",
      owner: { kind: "net-label", annotationId: "dx-label" },
    });
    const where = (from: CircuitProject) => {
      const cell = from.documents[0]!;
      const label = cell.annotations.find((a) => a.kind === "net-label")!;
      return resolveAnnotationPresentation(
        cell,
        createProjectSymbolResolver(from, builtInSymbols),
        label,
        resolveDocumentStyleProfile(cell.presentation),
      ).position;
    };
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    expect(where(plan.project)).toEqual(where(project));
  },
);

it.each(["global", "local"] as const)(
  "reads a power label of a %s net back as that net's supply, its rails rails",
  async (scope) => {
    // As the editor keeps a power label on a net it names: bound to the
    // net's name, which it claims as a supply, so the net's rails draw bold.
    const project = createEmptyProject("rails", "Rails", "dut");
    const document = project.documents[0]!;
    document.netlist!.name = "dut";
    const name = scope === "global" ? "VDD" : "vdd";
    document.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 300, y: 200 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1k" } },
    });
    document.nets.push({
      id: "vdd",
      terminals: [{ instanceId: "R1", pinName: "1" }],
    });
    document.noConnects.push({
      id: "R12",
      endpoint: { kind: "terminal", instanceId: "R1", pinName: "2" },
    });
    document.junctions.push(
      { id: "JA", netId: "vdd", position: { x: 300, y: 120 } },
      { id: "JB", netId: "vdd", position: { x: 400, y: 120 } },
    );
    document.routes.push(
      createRoutePath({
        id: "tap",
        netId: "vdd",
        start: { kind: "terminal", instanceId: "R1", pinName: "1" },
        end: { kind: "junction", junctionId: "JA" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "rail",
        netId: "vdd",
        start: { kind: "junction", junctionId: "JA" },
        end: { kind: "junction", junctionId: "JB" },
        bends: [],
        modes: ["manual"],
        presentation: "power-rail",
      }),
    );
    document.annotations.push({
      id: "vdd-label",
      kind: "power-label",
      netId: "vdd",
      binding: { kind: "net-name", netId: "vdd" },
      anchor: { kind: "free", position: { x: 410, y: 110 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push({
      id: "vdd-claim",
      kind: "name-claim",
      netId: "vdd",
      name,
      scope,
      powerDomain: "vdd",
      owner: { kind: "power-marker", objectId: "vdd-label" },
    });
    const supplied = (from: CircuitProject) => {
      const cell = from.documents[0]!;
      const label = cell.annotations.find((a) => a.kind === "power-label")!;
      const rail = cell.routes.find((r) => r.presentation === "power-rail")!;
      return {
        binding: label.binding?.kind,
        claim: cell.connectivityEvidence.flatMap((e) =>
          e.kind === "name-claim" &&
          e.owner.kind === "power-marker" &&
          e.owner.objectId === label.id
            ? [`${e.name} ${e.scope} ${e.powerDomain}`]
            : [],
        ),
        rail: resolveDocumentLogicalNets(cell).byBaseNetId.get(rail.netId)
          ?.powerDomain,
      };
    };
    for (const format of ["spice", "spectre"] as const) {
      const plan = await roundTrip(project, format);
      expect(failures(plan)).toEqual([]);
      expect(supplied(plan.project), format).toEqual(supplied(project));
    }
    expect(supplied(project)).toEqual({
      binding: "net-name",
      claim: [`${name} ${scope} vdd`],
      rail: "vdd",
    });
  },
);

it.each(["spice", "spectre"] as const)(
  "reads a port drawn only as its power label back as that label through %s+RNL (#1783)",
  async (format) => {
    // As the editor keeps a local power label: the label is the port, and
    // claims its net's name as a supply.
    const project = createEmptyProject("rails", "Rails", "dut");
    const document = project.documents[0]!;
    document.netlist!.name = "dut";
    document.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 300, y: 200 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1k" } },
    });
    document.nets.push({
      id: "vdd",
      terminals: [{ instanceId: "R1", pinName: "1" }],
    });
    document.noConnects.push({
      id: "R12",
      endpoint: { kind: "terminal", instanceId: "R1", pinName: "2" },
    });
    document.netlist!.terminals.push({
      id: "t-vdd",
      name: "VDD",
      netId: "vdd",
      direction: "inout",
      interfaceInstanceIds: [],
      interfaceAnnotationId: "vdd-label",
    });
    document.annotations.push({
      id: "vdd-label",
      kind: "power-label",
      netId: "vdd",
      binding: { kind: "cell-terminal-name", terminalId: "t-vdd" },
      anchor: { kind: "free", position: { x: 300, y: 120 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push({
      id: "vdd-claim",
      kind: "name-claim",
      netId: "vdd",
      name: "VDD",
      scope: "local",
      powerDomain: "vdd",
      owner: { kind: "power-marker", objectId: "vdd-label" },
    });
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    const dut = plan.project.documents.find((d) => d.netlist?.name === "dut")!;
    const terminal = dut.netlist!.terminals.find((t) => t.name === "VDD")!;
    expect(terminal.interfaceInstanceIds).toEqual([]);
    const label = dut.annotations.find(
      (a) => a.id === terminal.interfaceAnnotationId,
    );
    expect(label?.kind).toBe("power-label");
    expect(dut.instances.some((i) => i.symbolId === "port")).toBe(false);
    expect(
      dut.connectivityEvidence.some(
        (e) =>
          e.kind === "name-claim" &&
          e.owner.kind === "power-marker" &&
          e.owner.objectId === label?.id,
      ),
    ).toBe(true);
  },
);

it.each(["spice", "spectre"] as const)(
  "reads back a varactor, a tunable resistor and an NPN as drawn through %s+RNL (#1786)",
  async (format) => {
    // The netlist import names their pins as a plain part's (1, 2 for a
    // capacitor); RNL binds them by terminal.
    const project = createEmptyProject("tunables", "Tunables", "dut");
    const document = project.documents[0]!;
    document.netlist!.name = "dut";
    const parts = [
      ["C1", "variable-capacitor", "capacitor", { value: "1p" }, ["P1", "P2"]],
      ["R1", "variable-resistor", "resistor", { value: "1k" }, ["P1", "P2"]],
      ["Q1", "npn", "bjt", {}, ["C", "B", "E"]],
    ] as const;
    parts.forEach(([id, symbolId, deviceClass, parameters, pins], index) => {
      document.instances.push({
        id,
        reference: id,
        symbolId,
        placement: {
          position: { x: 200 + index * 200, y: 200 },
          rotation: 0,
          mirror: "none",
        },
        netlist: {
          binding:
            deviceClass === "bjt"
              ? { kind: "model", deviceClass, name: "NPN" }
              : { kind: "primitive", deviceClass },
          parameters: { ...parameters },
        },
      });
      for (const pinName of pins)
        document.noConnects.push({
          id: `${id}${pinName}`,
          endpoint: { kind: "terminal", instanceId: id, pinName },
        });
    });
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    expect(
      plan.diagnostics.filter(
        (item) => item.code === "RNL_IMPORT_UNMAPPED_SYMBOL",
      ),
    ).toEqual([]);
    const back = plan.project.documents.flatMap((d) => d.instances);
    // The import compares the circuits itself (no failures above); the NPN
    // stand-in card is a separate matter (#1789).
    for (const [id, symbolId] of parts)
      expect(back.find((i) => i.reference === id)?.symbolId).toBe(symbolId);
  },
);

it.each(
  (["spice", "spectre"] as const).flatMap((format) =>
    [
      "sky130-npn-05v5-w1p00l1p00",
      "sky130-res-high-po",
      "sky130-ind-05-125",
    ].map((id) => [id, format] as const),
  ),
)(
  "reads back a %s part whose call prints its property terminals too, as drawn, through %s+RNL (#1786)",
  async (bindingId, format) => {
    // The call prints the substrate (and a centre tap), which no symbol
    // draws: the part's own symbol still draws the rest.
    const binding = reviewedExternalBindingById(bindingId)!;
    const project = createEmptyProject("pdk", "PDK part", "dut");
    project.externalSubcircuitDefinitions = [
      {
        id: "device",
        name: binding.masterName,
        interfaceStatus: "declared",
        terminals: binding.terminals.map((terminal) => ({
          id: terminal.targetName,
          name: terminal.targetName,
          direction: "passive" as const,
        })),
        formalParameters: binding.parameters.map((parameter) => ({
          name: parameter.name,
          defaultValue:
            parameter.targetDefaultValue ?? parameter.defaultValue ?? "1",
        })),
      },
    ];
    const document = project.documents[0]!;
    document.netlist!.name = "dut";
    document.instances.push(
      {
        id: "D1",
        reference: "X1",
        symbolId: binding.symbolId,
        placement: {
          position: { x: 200, y: 200 },
          rotation: 0,
          mirror: "none",
        },
        netlist: {
          binding: { kind: "external-subcircuit", definitionId: "device" },
          parameters: {},
        },
      },
      {
        id: "GND1",
        symbolId: "ground",
        placement: {
          position: { x: 400, y: 400 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    for (const terminal of binding.terminals)
      if (terminal.interaction === "canvas")
        document.noConnects.push({
          id: `nc-${terminal.pinName}`,
          endpoint: {
            kind: "terminal",
            instanceId: "D1",
            pinName: terminal.pinName,
          },
        });
    document.nets.push({
      id: "ground",
      terminals: [
        { instanceId: "GND1", pinName: "0" },
        ...binding.terminals
          .filter((terminal) => terminal.interaction === "property")
          .map((terminal) => ({
            instanceId: "D1",
            pinName: terminal.pinName,
          })),
      ],
    });
    document.connectivityEvidence.push({
      id: "gnd-claim",
      kind: "name-claim",
      netId: "ground",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "power-marker", objectId: "GND1" },
    });
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready") throw new Error("export blocked");
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    const symbol = rnlSymbolFor(binding.symbolId)!.symbol;
    expect(written.text).toContain(`@SET-SYMBOL ${symbol}`);
    const plan = await importRnl(written.text, format);
    expect(failures(plan)).toEqual([]);
    expect(
      plan.diagnostics.filter(
        (item) => item.code === "RNL_IMPORT_UNMAPPED_SYMBOL",
      ),
    ).toEqual([]);
    const part = plan.project.documents
      .flatMap((d) => d.instances)
      .find((i) => i.reference === "X1");
    expect(part?.symbolId).toBe(binding.symbolId);
    expect(part?.placement).toEqual(document.instances[0]!.placement);
  },
);

it("keeps a wire RNL draws on a Cell's GND, which it reads as ground (#1784)", async () => {
  const written = await runtime.write({
    write: {
      dialect: "spice",
      netlist: "\n.subckt dut a GND\nR1 a GND 1k\n.ends dut\n",
      author: "test",
      ops: [
        {
          op: "set",
          level: "subckt:dut",
          object: "#R1",
          symbol: "$RESISTOR",
          at: [0, 0],
          orient: "R0",
        },
        { op: "add-point", level: "subckt:dut", name: "%g", at: [0, -6] },
        {
          op: "add-wire",
          level: "subckt:dut",
          nets: ["&GND"],
          via: [{ terminal: "#R1:2" }, { point: "%g" }],
          mode: "straight",
        },
      ],
    } as never,
    svg: false,
  });
  const plan = await importRnl(written.text, "spice");
  expect(failures(plan)).toEqual([]);
  expect(plan.diagnostics.map((item) => item.code)).not.toContain(
    "RNL_IMPORT_WIRE_SKIPPED",
  );
  const dut = plan.project.documents.find((d) => d.netlist?.name === "dut")!;
  expect(dut.routes).toHaveLength(1);
});

it.each([
  "opamp",
  "inverter",
  "nand-gate-3",
  "d-flip-flop-reset",
  "comparator-differential",
  "delay-cell",
])(
  "keeps a %s's wired VDD on its Net through spice+RNL, which draws no supply pin (#1833, #1941)",
  async (symbolId) => {
    const project = createEmptyProject("supplies", "Supplies", "dut");
    const document = project.documents[0]!;
    document.netlist!.name = "dut";
    const at = (x: number, y: number) => ({
      position: { x, y },
      rotation: 0 as const,
      mirror: "none" as const,
    });
    const symbol = builtInSymbols.find((item) => item.id === symbolId)!;
    const descriptor = subcircuitDescriptor(symbolId)!;
    const vdd = symbol.pins.find((pin) => pin.name === "VDD")!.at;
    // The marker's P straight above the block's VDD pin.
    document.instances.push(
      {
        id: "block",
        symbolId,
        symbolVariantId: "supply-pins",
        reference: "X1",
        placement: at(100, 100),
        netlist: {
          binding: { kind: "unresolved-subcircuit", name: descriptor.target },
          parameters: {},
        },
      },
      {
        id: "rail",
        symbolId: "vdd-port",
        placement: at(100 + vdd.x, 100 + vdd.y - 80),
      },
    );
    for (const { name: port, pinName } of descriptor.ports) {
      if (!pinName) continue;
      const id = `pin-${port}`;
      document.instances.push({ id, symbolId: "port", placement: null });
      document.nets.push({
        id: `net-${port}`,
        terminals: [
          { instanceId: id, pinName: "P" },
          { instanceId: "block", pinName },
        ],
      });
      document.netlist!.terminals.push({
        id: `terminal-${port}`,
        name: port,
        netId: `net-${port}`,
        direction: "inout",
        interfaceInstanceIds: [id],
      });
    }
    document.nets.push({
      id: "net-vdd",
      terminals: [
        { instanceId: "block", pinName: "VDD" },
        { instanceId: "rail", pinName: "P" },
      ],
    });
    document.routes.push(
      createRoutePath({
        id: "wire",
        netId: "net-vdd",
        start: { kind: "terminal", instanceId: "block", pinName: "VDD" },
        end: { kind: "terminal", instanceId: "rail", pinName: "P" },
        bends: [],
        modes: ["manual"],
      }),
    );
    // RNL fails a wire to a terminal its symbol draws no pin for (9.2.4).
    const exported = createRnlExport(project, { format: "spice" });
    expect(exported.diagnostics.map((item) => item.code)).toContain(
      "RNL_PIN_NOT_DRAWN",
    );
    const plan = await roundTrip(project);
    expect(failures(plan)).toEqual([]);
    const dut = plan.project.documents.find((d) => d.netlist?.name === "dut")!;
    const block = dut.instances.find((item) => item.symbolId === symbolId)!;
    const netOf = (instanceId: string, pinName: string) =>
      dut.nets.find((net) =>
        net.terminals.some(
          (terminal) =>
            terminal.instanceId === instanceId && terminal.pinName === pinName,
        ),
      )?.id;
    const rail = dut.instances.find((item) => item.symbolId === "vdd-port");
    expect(netOf(block.id, "VDD")).toBeDefined();
    expect(rail).toBeDefined();
    expect(netOf(block.id, "VDD")).toBe(netOf(rail!.id, "P"));
  },
);

it("gives a Spectre card its own name again through Spectre+RNL", async () => {
  // Spectre calls a subcircuit M1; SPICE, which the import reads it as,
  // calls it XM1.
  const project = openedExample("five-transistor-ota-sky130", "sky130");
  // The example names its transistors XM1 and so on; a part may be M1.
  for (const instance of project.documents.flatMap((d) => d.instances))
    if (/mos/u.test(instance.symbolId) && instance.reference?.startsWith("X"))
      instance.reference = instance.reference.slice(1);
  const plan = await roundTrip(project, "spectre");
  expect(failures(plan)).toEqual([]);
  const transistors = (of: CircuitProject) =>
    of.documents
      .flatMap((document) => document.instances)
      .filter((instance) => /mos/u.test(instance.symbolId))
      .map((instance) => instance.reference)
      .sort();
  expect(transistors(project).length).toBeGreaterThan(0);
  expect(transistors(plan.project)).toEqual(transistors(project));
});

it.each(["spice", "spectre"] as const)(
  "reads a part calling a model no card declares as the type it is drawn as through %s+RNL",
  async (format) => {
    // A deck's models usually come from a PDK the netlist does not include.
    const project = createEmptyProject("models", "Models", "dut");
    const document = project.documents[0]!;
    document.netlist!.name = "dut";
    for (const [id, symbolId, model, x] of [
      ["MN1", "nmos", "DN", 200],
      ["MP1", "pmos", "DP", 400],
    ] as const) {
      document.instances.push({
        id,
        reference: id,
        symbolId,
        placement: { position: { x, y: 200 }, rotation: 0, mirror: "none" },
        netlist: {
          binding: { kind: "model", deviceClass: "mos", name: model },
          parameters: { w: "1u", l: "1u" },
        },
      });
      for (const pinName of ["D", "G", "S", "B"])
        document.noConnects.push({
          id: `${id}${pinName}`,
          endpoint: { kind: "terminal", instanceId: id, pinName },
        });
    }
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    const parts = plan.project.documents.flatMap((d) => d.instances);
    for (const [reference, symbolId, model] of [
      ["MN1", "nmos", "DN"],
      ["MP1", "pmos", "DP"],
    ] as const) {
      const part = parts.find((i) => i.reference === reference);
      expect(part?.symbolId).toBe(symbolId);
      expect(part?.netlist?.binding).toMatchObject({
        kind: "model",
        name: model,
      });
    }
  },
);

it.each(["spice", "spectre"] as const)(
  "takes no Cell Pin for the supplies a gate's rails print where the gate's Cell draws ground, through %s+RNL",
  async (format) => {
    // The gate's Cell draws ground, so dut meets ground through it, and its
    // rails are dut's: dut prints VDD and VSS, no drawing shows either. Kept
    // as ports, dut would print a GND pin beside VSS, which the file never
    // had: the file's circuit is the reference.
    const project = delayCellFixture(true);
    const top = project.documents[0]!;
    top.instances.find((i) => i.id === "X1")!.symbolId = "inverter";
    for (const net of top.nets)
      net.terminals = net.terminals.filter(
        (t) =>
          t.instanceId !== "X1" || (t.pinName !== "VDD" && t.pinName !== "VSS"),
      );
    top.nets = top.nets.filter((net) => net.terminals.length);
    top.connectivityEvidence = top.connectivityEvidence.filter((evidence) =>
      top.nets.some((net) => net.id === evidence.netId),
    );
    const cell = project.documents.find((d) => d.id === "delay_cmos")!;
    const kept = new Set(["pin-VDD", "pin-A", "pin-Y", "C2"]);
    cell.instances = cell.instances.filter((i) => kept.has(i.id));
    cell.netlist!.terminals = cell.netlist!.terminals.filter(
      (t) => t.name !== "VSS",
    );
    cell.instances.push(
      {
        id: "R1",
        reference: "R1",
        symbolId: "resistor",
        placement: null,
        netlist: { parameters: { value: "1k" } },
      },
      {
        id: "GND1",
        symbolId: "ground",
        placement: {
          position: { x: 300, y: 300 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    for (const net of cell.nets) {
      net.terminals = net.terminals.filter((t) => kept.has(t.instanceId));
      if (net.id === "A" || net.id === "Y")
        net.terminals.push({
          instanceId: "R1",
          pinName: net.id === "A" ? "1" : "2",
        });
      if (net.id === "VSS")
        net.terminals.push({ instanceId: "GND1", pinName: "0" });
    }
    cell.nets = cell.nets.filter((net) => net.terminals.length);
    cell.connectivityEvidence = [
      ...cell.connectivityEvidence.filter((evidence) =>
        cell.nets.some((net) => net.id === evidence.netId),
      ),
      {
        id: "gnd-claim",
        kind: "name-claim",
        netId: "VSS",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        owner: { kind: "power-marker", objectId: "GND1" },
      },
    ];
    const result = await roundTrip(project, format);
    expect(failures(result)).toEqual([]);
    const dut = result.project.documents.find(
      (document) => document.netlist?.name === "dut",
    )!;
    expect(dut.netlist!.terminals.map((t) => t.name)).toEqual([]);
    const before = createDesignNetlistExport(project, { format });
    const after = createDesignNetlistExport(result.project, { format });
    expect(after.status === "ready" && after.file.text).toBe(
      before.status === "ready" && before.file.text,
    );
  },
);

/** A netlist's text, or its status where the export cannot print it. */
function printed(project: CircuitProject, format: "spice" | "spectre") {
  const result = createDesignNetlistExport(project, { format });
  return result.status === "ready" ? result.file.text : result.status;
}

it.each(["spice", "spectre"] as const)(
  "leaves an op-amp's unwired supplies off the ground pin a switch adds, through %s+RNL",
  async (format) => {
    // The Cell prints VSS for the switch alone; the op-amp's body writes its
    // ports in another order in the file than in a plain netlist. A kept VSS
    // pin would take the op-amp's unwired supply.
    const project = createEmptyProject("opamp-switch", "Op-amp", "dut");
    const document = project.documents[0]!;
    document.netlist!.name = "dut";
    const at = (x: number, y: number) =>
      ({ position: { x, y }, rotation: 0, mirror: "none" }) as const;
    document.instances.push(
      {
        id: "S1",
        symbolId: "simple-switch",
        reference: "S1",
        placement: at(100, 100),
      },
      {
        id: "X1",
        symbolId: "opamp-differential-wide",
        reference: "X1",
        placement: at(300, 100),
        netlist: {
          binding: {
            kind: "unresolved-subcircuit",
            name: "opamp_differential",
          },
          parameters: { gain: "1e6" },
        },
      },
    );
    document.nets.push(
      { id: "a", terminals: [{ instanceId: "S1", pinName: "1" }] },
      {
        id: "b",
        terminals: [
          { instanceId: "S1", pinName: "2" },
          { instanceId: "X1", pinName: "IN+" },
        ],
      },
      { id: "c", terminals: [{ instanceId: "X1", pinName: "IN-" }] },
      { id: "d", terminals: [{ instanceId: "X1", pinName: "OUT+" }] },
      { id: "e", terminals: [{ instanceId: "X1", pinName: "OUT-" }] },
    );
    const text = printed(project, format);
    expect(text).toMatch(/VSS/u);
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    expect(printed(plan.project, format)).toBe(text);
  },
);

it.each(["spice", "spectre"] as const)(
  "takes no Cell Pin for a supply a Cell's body gives it where another Cell draws that supply global, through %s+RNL",
  async (format) => {
    // Cell a's unwired PMOS body gives dut a VDD port; Cell b draws the
    // global VDD. As a Pin, dut's VDD would be both a port and the global
    // net, which the export refuses to print.
    const project = createEmptyProject("global-vdd", "Global VDD", "dut");
    const top = project.documents[0]!;
    top.netlist!.name = "dut";
    const at = (x: number, y: number) =>
      ({ position: { x, y }, rotation: 0, mirror: "none" }) as const;
    const pmosCell = (name: string, drawsVdd: boolean) => {
      const cell = createEmptyDocument(name, name);
      cell.netlist = { name, formalParameters: [], terminals: [] };
      cell.instances.push(
        {
          id: "M1",
          symbolId: "pmos",
          reference: "M1",
          placement: at(200, 100),
          netlist: {
            binding: { kind: "model", deviceClass: "mos", name: "DP" },
            parameters: { w: "1u", l: "1u" },
          },
        },
        { id: "PA", symbolId: "port", placement: at(100, 100) },
      );
      cell.netlist.terminals.push({
        id: "terminal-a",
        name: "a",
        netId: "a",
        direction: "inout",
        interfaceInstanceIds: ["PA"],
      });
      cell.nets.push(
        {
          id: "a",
          terminals: [
            { instanceId: "PA", pinName: "P" },
            { instanceId: "M1", pinName: "G" },
            { instanceId: "M1", pinName: "D" },
          ],
        },
        { id: "s", terminals: [{ instanceId: "M1", pinName: "S" }] },
      );
      if (drawsVdd) {
        cell.instances.push({
          id: "V1",
          symbolId: "vdd-port",
          placement: at(200, 40),
        });
        cell.nets
          .find((net) => net.id === "s")!
          .terminals.push({ instanceId: "V1", pinName: "P" });
        cell.connectivityEvidence.push({
          id: "vdd-claim",
          kind: "name-claim",
          netId: "s",
          name: "VDD",
          scope: "global",
          powerDomain: "vdd",
          owner: { kind: "power-marker", objectId: "V1" },
        });
      }
      return cell;
    };
    const cells = [pmosCell("a", false), pmosCell("b", true)];
    project.documents.push(...cells);
    cells.forEach((cell, index) => {
      const id = `X${index + 1}`;
      top.instances.push({
        id,
        symbolId: hierarchicalSymbolId(cell.id),
        reference: id,
        placement: at(100 + 300 * index, 100),
        netlist: {
          binding: { kind: "subcircuit", childDocumentId: cell.id },
          parameters: {},
        },
      });
      top.nets.push({
        id: `n${id}`,
        terminals: [{ instanceId: id, pinName: "a" }],
      });
    });
    const text = printed(project, format);
    expect(text).toMatch(/global VDD/iu);
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    expect(printed(plan.project, format)).toBe(text);
  },
);

it.each(["spice", "spectre"] as const)(
  "takes no ground pin where a port drawn as a power label orders the file's ports, through %s+RNL",
  async (format) => {
    // dut's VREF is a power label's port, so it prints with the supplies:
    // VREF before VSS, which only the label makes so. The rest is the gate
    // case: kept as a port, VSS would bring a GND pin beside it.
    const project = delayCellFixture(true);
    const top = project.documents[0]!;
    top.instances.find((i) => i.id === "X1")!.symbolId = "inverter";
    for (const net of top.nets)
      net.terminals = net.terminals.filter(
        (t) =>
          t.instanceId !== "X1" || (t.pinName !== "VDD" && t.pinName !== "VSS"),
      );
    top.nets = top.nets.filter((net) => net.terminals.length);
    top.connectivityEvidence = top.connectivityEvidence.filter((evidence) =>
      top.nets.some((net) => net.id === evidence.netId),
    );
    top.instances.push({
      id: "R9",
      reference: "R9",
      symbolId: "resistor",
      placement: { position: { x: 500, y: 100 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1k" } },
    });
    top.nets.push(
      { id: "net-vref", terminals: [{ instanceId: "R9", pinName: "1" }] },
      { id: "net-load", terminals: [{ instanceId: "R9", pinName: "2" }] },
    );
    top.netlist!.terminals.push({
      id: "terminal-vref",
      name: "VREF",
      netId: "net-vref",
      direction: "inout",
      interfaceInstanceIds: [],
      interfaceAnnotationId: "label-vref",
    });
    top.annotations.push({
      id: "label-vref",
      kind: "power-label",
      netId: "net-vref",
      binding: { kind: "cell-terminal-name", terminalId: "terminal-vref" },
      anchor: { kind: "free", position: { x: 500, y: 40 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    top.connectivityEvidence.push({
      id: "evidence-vref",
      kind: "name-claim",
      netId: "net-vref",
      name: "VREF",
      owner: { kind: "power-marker", objectId: "label-vref" },
      scope: "local",
      powerDomain: "vdd",
    });
    const cell = project.documents.find((d) => d.id === "delay_cmos")!;
    const kept = new Set(["pin-VDD", "pin-A", "pin-Y", "C2"]);
    cell.instances = cell.instances.filter((i) => kept.has(i.id));
    cell.netlist!.terminals = cell.netlist!.terminals.filter(
      (t) => t.name !== "VSS",
    );
    cell.instances.push(
      {
        id: "R1",
        reference: "R1",
        symbolId: "resistor",
        placement: null,
        netlist: { parameters: { value: "1k" } },
      },
      {
        id: "GND1",
        symbolId: "ground",
        placement: {
          position: { x: 300, y: 300 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    for (const net of cell.nets) {
      net.terminals = net.terminals.filter((t) => kept.has(t.instanceId));
      if (net.id === "A" || net.id === "Y")
        net.terminals.push({
          instanceId: "R1",
          pinName: net.id === "A" ? "1" : "2",
        });
      if (net.id === "VSS")
        net.terminals.push({ instanceId: "GND1", pinName: "0" });
    }
    cell.nets = cell.nets.filter((net) => net.terminals.length);
    cell.connectivityEvidence = [
      ...cell.connectivityEvidence.filter((evidence) =>
        cell.nets.some((net) => net.id === evidence.netId),
      ),
      {
        id: "gnd-claim",
        kind: "name-claim",
        netId: "VSS",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        owner: { kind: "power-marker", objectId: "GND1" },
      },
    ];
    const text = printed(project, format);
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    expect(printed(plan.project, format)).toBe(text);
  },
);

it.each(["spice", "spectre"] as const)(
  "keeps a rail that runs over a junction other wires end at one route, through %s+RNL",
  async (format) => {
    // Analog Canvas joins only what a route reaches: a rail drawn over the
    // junction another rail ends at is not joined there, and stays whole.
    const project = createEmptyProject("rails", "Rails", "dut");
    const document = project.documents[0]!;
    document.netlist!.name = "dut";
    for (const [id, x] of [
      ["R1", 100],
      ["R2", 300],
    ] as const)
      document.instances.push({
        id,
        reference: id,
        symbolId: "resistor",
        placement: { position: { x, y: 200 }, rotation: 0, mirror: "none" },
        netlist: { parameters: { value: "1k" } },
      });
    document.nets.push(
      {
        id: "vdd",
        terminals: [
          { instanceId: "R1", pinName: "1" },
          { instanceId: "R2", pinName: "1" },
        ],
      },
      {
        id: "out",
        terminals: [
          { instanceId: "R1", pinName: "2" },
          { instanceId: "R2", pinName: "2" },
        ],
      },
    );
    document.netlist!.terminals.push(
      {
        id: "t-vdd",
        name: "VDD",
        netId: "vdd",
        direction: "inout",
        interfaceInstanceIds: [],
      },
      {
        id: "t-out",
        name: "OUT",
        netId: "out",
        direction: "inout",
        interfaceInstanceIds: [],
      },
    );
    const junction = (id: string, x: number) => ({
      id,
      netId: "vdd",
      position: { x, y: 100 },
    });
    document.junctions.push(
      junction("JA", 50),
      junction("JB", 100),
      junction("JC", 200),
      junction("JD", 300),
    );
    const rail = (
      id: string,
      start: RouteBranch["start"],
      end: RouteBranch["start"],
    ) =>
      createRoutePath({
        id,
        netId: "vdd",
        start,
        end,
        bends: [],
        modes: ["manual"],
        presentation: "power-rail",
      });
    const on = (junctionId: string) =>
      ({ kind: "junction", junctionId }) as const;
    const pin = (instanceId: string) =>
      ({ kind: "terminal", instanceId, pinName: "1" }) as const;
    document.routes.push(
      // Each runs over a junction the other ends at.
      rail("over", on("JA"), on("JC")),
      rail("next", on("JB"), on("JD")),
      rail("drop1", on("JB"), pin("R1")),
      rail("drop2", on("JD"), pin("R2")),
    );
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    const back = plan.project.documents[0]!;
    const x = (endpoint: RouteBranch["start"]) =>
      endpoint.kind === "junction"
        ? back.junctions.find((item) => item.id === endpoint.junctionId)
            ?.position.x
        : endpoint.instanceId;
    const spans = back.routes
      .map((route) => {
        const end = route.legs.at(-1)!.to;
        return `${x(route.start)}-${end.kind === "endpoint" ? x(end.endpoint) : "?"}`;
      })
      .sort();
    expect(spans).toEqual(["100-300", "100-R1", "300-R2", "50-200"]);
  },
);

it.each(["spice", "spectre"] as const)(
  "keeps a body tie that runs between junctions a body tie, through %s+RNL",
  async (format) => {
    const project = createEmptyProject("body-tie", "Body tie", "dut");
    const document = project.documents[0]!;
    document.netlist!.name = "dut";
    const at = (x: number, y: number) =>
      ({ position: { x, y }, rotation: 0, mirror: "none" }) as const;
    for (const [id, x] of [
      ["M1", 100],
      ["M2", 300],
    ] as const) {
      document.instances.push({
        id,
        reference: id,
        symbolId: "nmos",
        placement: at(x, 100),
        mosBulkBinding: { origin: "instance-override", netId: "bulk" },
        netlist: {
          binding: { kind: "model", deviceClass: "mos", name: "DN" },
          parameters: { w: "1u", l: "1u" },
        },
      });
      for (const pinName of ["D", "G", "S"])
        document.noConnects.push({
          id: `${id}${pinName}`,
          endpoint: { kind: "terminal", instanceId: id, pinName },
        });
    }
    document.instances.push({
      id: "PB",
      symbolId: "port",
      placement: at(200, 300),
    });
    document.netlist!.terminals.push({
      id: "terminal-b",
      name: "B",
      netId: "bulk",
      direction: "inout",
      interfaceInstanceIds: ["PB"],
    });
    document.nets.push({
      id: "bulk",
      terminals: [
        { instanceId: "M1", pinName: "B" },
        { instanceId: "M2", pinName: "B" },
        { instanceId: "PB", pinName: "P" },
      ],
    });
    const junction = (id: string, x: number, y: number) => ({
      id,
      netId: "bulk",
      position: { x, y },
    });
    document.junctions.push(junction("J1", 200, 200), junction("J2", 250, 200));
    const tie = (
      id: string,
      start: RouteBranch["start"],
      end: RouteBranch["start"],
    ): RouteBranch => ({
      id,
      netId: "bulk",
      start,
      legs: [
        {
          id: `${id}-leg`,
          to: { kind: "endpoint", endpoint: end },
          mode: "manual",
        },
      ],
      presentation: "bulk-dashed",
    });
    const onJunction = (junctionId: string) =>
      ({ kind: "junction", junctionId }) as const;
    const onBody = (instanceId: string) =>
      ({ kind: "terminal", instanceId, pinName: "B" }) as const;
    document.routes.push(
      tie("r1", onBody("M1"), onJunction("J1")),
      tie("r2", onJunction("J1"), onJunction("J2")),
      tie("r3", onJunction("J2"), onBody("M2")),
      tie("r4", onJunction("J1"), {
        kind: "terminal",
        instanceId: "PB",
        pinName: "P",
      }),
      tie("r5", onJunction("J2"), {
        kind: "terminal",
        instanceId: "PB",
        pinName: "P",
      }),
    );
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    const routes = plan.project.documents[0]!.routes;
    expect(routes).toHaveLength(5);
    for (const route of routes) {
      expect(route.presentation).toBe("bulk-dashed");
      expect(route.styleOverride?.lineStyle).toBeUndefined();
    }
  },
);

it.each(["spice", "spectre"] as const)(
  "leaves a dashed wire that meets no body tie its own line style, through %s+RNL",
  async (format) => {
    const project = hiddenPowerPort();
    const document = project.documents[0]!;
    document.routes.push({
      id: "wire",
      netId: "net-a",
      start: { kind: "terminal", instanceId: "pin-a", pinName: "P" },
      legs: [
        {
          id: "wire-leg",
          to: {
            kind: "endpoint",
            endpoint: { kind: "terminal", instanceId: "R1", pinName: "1" },
          },
          mode: "manual",
        },
      ],
      styleOverride: { lineStyle: "dashed" },
    });
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    expect(plan.project.documents[0]!.routes[0]).toMatchObject({
      styleOverride: { lineStyle: "dashed" },
    });
    expect(plan.project.documents[0]!.routes[0]!.presentation).toBeUndefined();
  },
);

it.each(["spice", "spectre"] as const)(
  "hangs each net's and power label where it was drawn, on its wire, glyph or net, through %s+RNL",
  async (format) => {
    // Each label's anchor kind, by its Cell's name.
    const anchors = (from: CircuitProject) =>
      Object.fromEntries(
        from.documents.map((document) => [
          document.netlist?.name,
          document.annotations
            .filter(
              (annotation) =>
                annotation.kind === "net-label" ||
                annotation.kind === "power-label",
            )
            .map((annotation) => `${annotation.kind} ${annotation.anchor.kind}`)
            .sort(),
        ]),
      );
    // Labels on their wires and free ones, some beside a wire.
    const ota = example("simulation-ota");
    const back = (await roundTrip(ota, format)).project;
    expect(anchors(back)).toEqual(anchors(ota));
    // A power label on its supply glyph.
    const labels = boundLabels();
    const read = (await roundTrip(labels, format)).project;
    const power = read.documents[0]!.annotations.find(
      (annotation) => annotation.kind === "power-label",
    )!;
    expect(power.anchor.kind).toBe("object");
    expect(
      read.documents[0]!.instances.find(
        (instance) =>
          power.anchor.kind === "object" &&
          instance.id === power.anchor.objectId,
      )?.symbolId,
    ).toBe("vdd-port");
  },
);

describe("RNL round trip of bipolar devices and mirrored labels", () => {
  it.each(["spice", "spectre"] as const)(
    "reads every device and label back from %s",
    async (format) => {
      const project = bipolarProject();
      const plan = await roundTrip(project, format);
      expect(failures(plan)).toEqual([]);
      expect(drawingCensus(plan.project)).toEqual(drawingCensus(project));
      const before = projectElectricalGraph(project);
      const after = projectElectricalGraph(plan.project);
      expect(before.status).toBe("ready");
      expect(after.status).toBe("ready");
      if (before.status === "ready" && after.status === "ready")
        expect(compareElectricalGraphs(before.graph, after.graph)).toBe(
          "equal",
        );
      expect(
        labelDifferences(labelCensus(project), labelCensus(plan.project)),
      ).toEqual([]);
    },
  );
});

async function expectViewerLabels(
  project: CircuitProject,
  format: "spice" | "spectre",
) {
  const exported = createRnlExport(project, { format });
  if (exported.status !== "ready") throw new Error("export blocked");
  const written = await core.write({
    write: exported.request,
    svg: false,
    primitives: true,
  });
  const path = `circuit.${format === "spice" ? "sp" : "scs"}`;
  const snapshot = await runtime.snapshot({
    entry: path,
    files: { [path]: written.text },
    dialect: format,
    parts: { drawing: false, host: true, model: true },
  });
  let compared = 0;
  for (const level of snapshot.levels) {
    const drawing = written.document.levels.find(
      (item) => item.title === level.name,
    );
    for (const text of level.model?.texts ?? []) {
      if (!text.written || !text.attach || !text.key) continue;
      const owner = `${text.attach}::${text.key}`;
      const primitive = drawing?.primitives?.find(
        (item) => item.kind === "text" && item.owner === owner,
      );
      expect(primitive, owner).toBeDefined();
      if (primitive?.kind !== "text") throw new Error(`missing text ${owner}`);
      expect(primitive.anchor, owner).toEqual(text.anchor);
      expect(primitive.halign, owner).toBe(text.halign);
      expect(primitive.valign, owner).toBe(text.valign);
      // Ink can overhang its alignment anchor (italics and scripts). Compare
      // its box with the same text drawn at the scene point independently of
      // the owner, rather than assuming an ink edge equals the anchor.
      const reference = await core.write({
        write: {
          ...exported.request,
          ops: [
            {
              op: "add-text",
              level: level.id,
              lines: text.lines,
              at: text.anchor,
              halign: text.halign,
              valign: text.valign,
              rotate: text.rotate,
              style: { ...text.style, size: primitive.size },
            },
          ],
        },
        svg: false,
        primitives: true,
      });
      const expected = reference.document.levels
        .flatMap((item) => item.primitives ?? [])
        .filter((item) => item.kind === "text");
      expect(
        reference.document.diagnostics.filter(
          (item) => item.severity === "error",
        ),
        owner,
      ).toEqual([]);
      expect(expected, owner).toHaveLength(1);
      expect(primitive.bbox, owner).toEqual(expected[0]?.bbox);
      compared++;
    }
  }
  expect(compared).toBeGreaterThan(0);
}

describe("viewer labels match the scene positions written by the editor", () => {
  it.each(["spice", "spectre"] as const)(
    "draws the mirrored bipolar fixture's labels as written (%s)",
    async (format) => {
      await expectViewerLabels(bipolarProject(), format);
    },
  );
  it.each(
    [
      "common-source-amplifier",
      "two-stage-op-amp",
      "current-mirror-loaded-differential-pair",
      "fully-differential-two-stage-op-amp",
      "five-transistor-ota-sky130",
    ].flatMap((name) =>
      (["spice", "spectre"] as const).map((format) => [name, format] as const),
    ),
  )("draws %s labels as written (%s)", async (name, format) => {
    await expectViewerLabels(
      prepareNetlistExample(
        example(name),
        createDefaultNetlistExportPreferences().profiles.abstract,
      ),
      format,
    );
  });
});

/** Export as SPICE+RNL, write with the runtime, and import the file it wrote. */
async function roundTrip(
  project: CircuitProject,
  format: "spice" | "spectre" = "spice",
) {
  const exported = createRnlExport(project, { format });
  if (exported.status !== "ready") throw new Error("export blocked");
  const written = await runtime.write({ write: exported.request, svg: false });
  return importRnl(written.text, format);
}

const pathOf = (format: "spice" | "spectre") =>
  format === "spice" ? "circuit.sp" : "circuit.scs";

/** Import a rich netlist as File > Import > RNL... does. */
async function importRnl(text: string, format: "spice" | "spectre") {
  const path = pathOf(format);
  const plan = await planRnlImport({
    inputs: [{ path, bytes: new TextEncoder().encode(text) }],
    entryPath: path,
    runtime,
  });
  if (plan.status !== "ready") throw new Error(plan.message);
  return plan;
}

/** Diagnostics that say the drawing did not come back as written. */
const failures = (plan: Awaited<ReturnType<typeof importRnl>>) =>
  plan.diagnostics.filter(
    (item) => item.severity === "error" || item.code === "RNL_IMPORT_RNL_ERROR",
  );

/**
 * A write request as another tool, or Analog Canvas before Canvas 0.2,
 * writes the drawing: without what only Analog Canvas keeps.
 */
function withoutCanvasMeaning(request: RnlWriteRequest): RnlWriteRequest {
  return {
    ...request,
    ops: request.ops.filter(
      (op) =>
        !(
          op.op === "add-usage" &&
          ["$CANVAS_NAME", "$CANVAS_TYPESETTING", "$CANVAS_LABEL"].includes(
            op.definition,
          )
        ),
    ),
  };
}

/** What RNL writes for a placed part: its symbol, place and orientation. */
function rnlPart(instance: Instance) {
  const symbol = rnlSymbolFor(instance.symbolId, instance.symbolVariantId);
  const turn = instance.placement ? rnlOrient(instance.placement) : undefined;
  if (!symbol || !turn?.ok) return { symbolId: instance.symbolId };
  return {
    symbol: symbol.symbol,
    at: rnlPlace(instance.placement!.position, turn.orient, symbol.offset),
    orient: composeOrient(turn.orient, symbol.orient),
  };
}

/** Each printed part's card name in its Cell, by its Analog Canvas instance. */
/** The cards of the netlist as the RNL export prints it, uncalled Cells too. */
function cardNames(project: CircuitProject) {
  const result = createDesignNetlistExport(project, {
    bodyPortOrder: rnlBodyPortOrder(project),
    includeIr: true,
    uncalledCells: true,
  });
  if (result.status !== "ready") throw new Error("netlist blocked");
  return result.ir!.cells.flatMap((cell) =>
    cell.instances.map((instance) => ({
      cell: cell.name,
      id: instance.id,
      card: instance.reference,
    })),
  );
}

describe("RNL round trip", () => {
  it.each(
    [
      "simulation-common-source",
      "simulation-rc",
      "simulation-rlc",
      "simulation-ota",
      "five-transistor-ota-sky130",
      "two-stage-op-amp",
    ].flatMap((name) => [[name, "spice"] as const, [name, "spectre"] as const]),
  )("places every part of %s (%s) where it was drawn", async (name, format) => {
    const project = example(name);
    const { project: drawn, diagnostics } = await roundTrip(project, format);
    expect(parseProject(JSON.stringify(drawn))).toBeTruthy();
    const misplaced: string[] = [];
    for (const { cell, id, card } of cardNames(project)) {
      // Instance ids repeat across Cells: each is looked up in its own.
      const original = project.documents
        .find(
          (document) =>
            document.netlist?.name.toLowerCase() === cell.toLowerCase(),
        )
        ?.instances.find((instance) => instance.id === id);
      if (!original?.placement) continue;
      const document = drawn.documents.find(
        (item) => item.netlist?.name.toLowerCase() === cell.toLowerCase(),
      );
      const part = document?.instances.find(
        (instance) => instance.id.toLowerCase() === card.toLowerCase(),
      );
      // Two variants one RNL symbol draws, one flipped, are one drawing to
      // RNL: an op-amp flipped top to bottom reads back as the variant with
      // its inputs swapped, unflipped.
      const same =
        part?.placement &&
        JSON.stringify(rnlPart(part)) === JSON.stringify(rnlPart(original));
      if (!same)
        misplaced.push(
          `${cell}/${card}: ${JSON.stringify(original.placement)} ${original.symbolId}/${original.symbolVariantId ?? "-"} -> ${JSON.stringify(part?.placement)} ${part?.symbolId}/${part?.symbolVariantId ?? "-"}`,
        );
    }
    expect(misplaced).toEqual([]);
    expect(
      diagnostics
        .filter((item) => item.code.startsWith("RNL_"))
        .map((item) => `${item.code}: ${item.message}`),
    ).toEqual([]);
  });

  it.each([
    "simulation-rc",
    "simulation-ota",
    "simulation-common-source",
    "two-stage-op-amp",
  ])(
    "shows %s's names and net labels where it showed them, and no others",
    async (name) => {
      const project = example(name);
      const { project: drawn } = await roundTrip(project);
      // Instance ids repeat across Cells: a card is keyed by its Cell too.
      const cards = new Map(
        cardNames(project).map((item) => [
          `${item.cell.toLowerCase()} ${item.id}`,
          item,
        ]),
      );
      /** Each shown label by what it shows and where, as text. */
      const shown = (
        from: CircuitProject,
        rename: (cell: string, id: string) => string,
      ) =>
        from.documents.flatMap((document) => {
          const resolver = createProjectSymbolResolver(from, builtInSymbols);
          const profile = resolveDocumentStyleProfile(document.presentation);
          const logical = resolveDocumentLogicalNets(document);
          return document.annotations
            .filter(
              (annotation) =>
                annotation.visible !== false &&
                (annotation.kind === "net-label" ||
                  (annotation.kind === "instance-label" &&
                    annotation.binding?.kind === "instance-reference")),
            )
            .map((annotation) => {
              const text = resolveAnnotationText(document, annotation, logical);
              const where = resolveAnnotationPresentation(
                document,
                resolver,
                annotation,
                profile,
              );
              const owner =
                annotation.binding?.kind === "instance-reference"
                  ? rename(
                      document.netlist?.name.toLowerCase() ?? "",
                      annotation.binding.instanceId,
                    )
                  : "";
              return `${document.netlist?.name.toLowerCase()} ${annotation.kind} ${owner} ${flattenRichText(text)} at ${Math.round(where.position.x)},${Math.round(where.position.y)} ${where.alignment}`;
            });
        });
      const printed = new Set(
        [...cards.values()].map((item) => item.cell.toLowerCase()),
      );
      const original = shown(
        project,
        (cell, id) => cards.get(`${cell} ${id}`)?.card ?? id,
      ).filter((line) => printed.has(line.split(" ")[0]!));
      expect(original.length).toBeGreaterThan(0);
      expect(shown(drawn, (_cell, id) => id).sort()).toEqual(original.sort());
    },
  );

  it("keeps a Net label's display alias, and its Net's name (#1880)", async () => {
    const project = example("simulation-rc");
    const claimOf = (
      document: CircuitProject["documents"][number],
      id: string,
    ) =>
      document.connectivityEvidence.find(
        (evidence) =>
          evidence.kind === "name-claim" &&
          evidence.owner.kind === "net-label" &&
          evidence.owner.annotationId === id,
      );
    const document = project.documents.find((item) =>
      item.annotations.some(
        (annotation) =>
          annotation.kind === "net-label" && claimOf(item, annotation.id),
      ),
    )!;
    const index = document.annotations.findIndex(
      (annotation) =>
        annotation.kind === "net-label" && claimOf(document, annotation.id),
    );
    const claim = claimOf(document, document.annotations[index]!.id);
    if (claim?.kind !== "name-claim") throw new Error("no Net label claim");
    const {
      binding: _binding,
      formatOverride: _format,
      ...label
    } = document.annotations[index]!;
    document.annotations[index] = {
      ...label,
      content: { runs: [{ kind: "text", value: "VEA,OUT" }] },
    };
    const { project: drawn } = await roundTrip(project);
    const aliased = drawn.documents.flatMap((item) =>
      item.annotations
        .filter((annotation) => annotation.kind === "net-label")
        .map((annotation) => ({
          text: flattenRichText(resolveAnnotationText(item, annotation)),
          bound: annotation.binding !== undefined,
          claim: claimOf(item, annotation.id),
        })),
    );
    expect(aliased.filter((item) => item.text === "VEA,OUT")).toEqual([
      {
        text: "VEA,OUT",
        bound: false,
        claim: expect.objectContaining({ name: claim.name }),
      },
    ]);
    expect(
      aliased
        .filter((item) => item.text !== "VEA,OUT")
        .every((item) => item.bound),
    ).toBe(true);
  });

  it("keeps a name the drawing does not show hidden, in its usual place", async () => {
    const { project: drawn } = await roundTrip(example("two-stage-op-amp"));
    const names = drawn.documents
      .flatMap((document) => document.annotations)
      .flatMap((annotation) =>
        annotation.kind === "instance-label" &&
        annotation.binding?.kind === "instance-reference" &&
        ["X1", "X2"].includes(annotation.binding.instanceId)
          ? [
              {
                part: annotation.binding.instanceId,
                visible: annotation.visible,
                placed: annotation.anchor.kind === "object",
              },
            ]
          : [],
      );
    expect(names.sort((a, b) => a.part.localeCompare(b.part))).toEqual([
      { part: "X1", visible: false, placed: true },
      { part: "X2", visible: false, placed: true },
    ]);
  });

  it.each(["spice", "spectre"] as const)(
    "keeps a Cell's name that the netlist must write otherwise, through %s+RNL",
    async (format) => {
      const project = example("simulation-ota");
      const cell = project.documents.find(
        (document) => document.id === "document-ota-5t",
      )!;
      cell.name = "OTA five-T";
      cell.netlist!.name = "OTA five-T";
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready")
        throw new Error(JSON.stringify(exported));
      expect(exported.request.netlist).not.toContain("OTA five-T");
      const { project: drawn, diagnostics } = await roundTrip(project, format);
      expect(
        diagnostics.filter((item) => item.code.startsWith("RNL_")),
      ).toEqual([]);
      const names = (from: CircuitProject) =>
        from.documents
          .map((document) => `${document.name} | ${document.netlist?.name}`)
          .sort();
      expect(names(drawn)).toEqual(names(project));
    },
  );

  it.each(["spice", "spectre"] as const)(
    "refuses a Cell name another Cell has and a kept parameter the card would print, keeping the drawing, through %s+RNL",
    async (format) => {
      const project = example("simulation-ota");
      const cell = project.documents.find(
        (document) => document.id === "document-ota-5t",
      )!;
      cell.name = "OTA five-T";
      cell.netlist!.name = "OTA five-T";
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready")
        throw new Error(JSON.stringify(exported));
      const written = await runtime.write({
        write: exported.request,
        svg: false,
      });
      // Hand-edited: the Cell takes the testbench's name, and the bias
      // source keeps an AC magnitude its card would print.
      const comment = format === "spice" ? "*" : "//";
      const edited = written.text
        .replace('name="OTA five-T"', 'name="Testbench"')
        .replace(
          /^(IBIAS\b.*)$/mu,
          `$1\n${comment} @RNL { $CANVAS_PARAMETER @ATTACH(name="acMagnitude", text="1") #IBIAS(part) }`,
        );
      expect(edited).toContain('name="Testbench"');
      expect(edited).toContain("#IBIAS(part) }");
      const plan = await importRnl(edited, format);
      expect(failures(plan)).toEqual([]);
      const codes = plan.diagnostics.map((item) => item.code);
      expect(codes).toContain("RNL_IMPORT_CELL_NAME_REFUSED");
      expect(codes).toContain("RNL_IMPORT_PARAMETERS_IGNORED");
      expect(
        plan.project.documents.map((document) => document.netlist?.name).sort(),
      ).toEqual(["OTA_five_T", "Testbench"]);
      const source = plan.project.documents
        .flatMap((document) => document.instances)
        .find((instance) => instance.reference === "IBIAS")!;
      expect(source.netlist?.parameters.acMagnitude).toBeUndefined();
    },
  );

  it.each(["spice", "spectre"] as const)(
    "keeps the op-amp variant a part was drawn as, flipped or with its inputs swapped, through %s+RNL",
    async (format) => {
      for (const [symbolId, mirror] of [
        ["opamp", "vertical"],
        ["opamp-inputs-swapped", "none"],
      ] as const) {
        const project = example("two-stage-op-amp");
        const opamp = project.documents
          .flatMap((document) => document.instances)
          .find((instance) => instance.symbolId === "opamp")!;
        opamp.symbolId = symbolId;
        opamp.placement = { ...opamp.placement!, mirror };
        const { project: drawn } = await roundTrip(project, format);
        const part = drawn.documents
          .flatMap((document) => document.instances)
          .find((instance) => instance.symbolId.startsWith("opamp"));
        // The same turn, however its rotation and mirror spell it.
        expect([
          part?.symbolId,
          part?.placement && rnlOrient(part.placement),
        ]).toEqual([symbolId, rnlOrient(opamp.placement)]);
      }
    },
  );

  it.each(["spice", "spectre"] as const)(
    "keeps a part the author never named unnamed, which the netlist names to print it, through %s+RNL",
    async (format) => {
      const project = example("two-stage-op-amp");
      const document = project.documents.find((item) =>
        item.instances.some((instance) => instance.symbolId === "opamp"),
      )!;
      const opamp = document.instances.find(
        (instance) => instance.symbolId === "opamp",
      )!;
      // Unnamed, it emits as its symbol's own body, with no netlist record.
      delete opamp.reference;
      delete opamp.netlist;
      const { project: drawn, diagnostics } = await roundTrip(project, format);
      expect(
        diagnostics.filter((item) => item.code.startsWith("RNL_")),
      ).toEqual([]);
      const cell = drawn.documents.find(
        (item) => item.netlist?.name === document.netlist?.name,
      )!;
      const opamps = cell.instances.filter((instance) =>
        instance.symbolId.startsWith("opamp"),
      );
      expect(opamps).toHaveLength(1);
      expect(opamps[0]!.reference).toBeUndefined();
      expect(opamps[0]!.netlist).toBeUndefined();
    },
  );

  it.each(["spice", "spectre"] as const)(
    "keeps an unnamed part's name label, which shows nothing, where it stands, through %s+RNL",
    async (format) => {
      const project = example("two-stage-op-amp");
      const document = project.documents.find((item) =>
        item.instances.some((instance) => instance.symbolId === "opamp"),
      )!;
      const opamp = document.instances.find(
        (instance) => instance.symbolId === "opamp",
      )!;
      delete opamp.reference;
      delete opamp.netlist;
      const position = opamp.placement!.position;
      document.annotations = document.annotations.filter(
        (item) =>
          item.anchor.kind !== "object" || item.anchor.objectId !== opamp.id,
      );
      document.annotations.push({
        id: "opamp-name",
        kind: "instance-label",
        binding: { kind: "instance-reference", instanceId: opamp.id },
        anchor: {
          kind: "object",
          objectId: opamp.id,
          localOffset: { x: 0, y: 60 },
          fallbackPosition: { x: position.x, y: position.y + 60 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      });
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready") throw new Error("export blocked");
      const written = await runtime.write({
        write: exported.request,
        svg: false,
      });
      // RNL's own viewers show the name the netlist gives the part.
      expect(written.text).toMatch(
        /#X\d+ @TEXT\("[^"]*X\d+[^"]*", key="name"/u,
      );
      const plan = await importRnl(written.text, format);
      expect(failures(plan)).toEqual([]);
      const cell = plan.project.documents.find(
        (item) => item.netlist?.name === document.netlist?.name,
      )!;
      const part = cell.instances.find((instance) =>
        instance.symbolId.startsWith("opamp"),
      )!;
      expect(part.reference).toBeUndefined();
      const labels = cell.annotations.filter(
        (item) =>
          item.anchor.kind === "object" && item.anchor.objectId === part.id,
      );
      expect(labels).toEqual([
        expect.objectContaining({
          kind: "instance-label",
          binding: { kind: "instance-reference", instanceId: part.id },
          anchor: expect.objectContaining({ localOffset: { x: 0, y: 60 } }),
        }),
      ]);
      const label = labels[0]!;
      expect(label.visible).not.toBe(false);
      expect("content" in label || "formatOverride" in label).toBe(false);
      expect(flattenRichText(resolveAnnotationText(cell, label)).trim()).toBe(
        "",
      );
    },
  );

  it.each(["spice", "spectre"] as const)(
    "keeps the parameters the card does not print, a source's other waveforms and an op-amp's rails, through %s+RNL",
    async (format) => {
      const rc = example("simulation-rc");
      const source = rc.documents
        .flatMap((document) => document.instances)
        .find((instance) => instance.reference === "V1")!;
      // Set to dc, it keeps its pulse fields and a sine's for later.
      source.netlist!.parameters = {
        ...source.netlist!.parameters,
        waveform: "dc",
        frequency: "1k",
      };
      const amp = example("two-stage-op-amp");
      const opamp = amp.documents
        .flatMap((document) => document.instances)
        .find((instance) => instance.symbolId === "opamp")!;
      opamp.netlist!.parameters = {
        ...opamp.netlist!.parameters,
        vhigh: "VDD",
        vlow: "VSS",
      };
      for (const [project, original] of [
        [rc, source],
        [amp, opamp],
      ] as const) {
        const { project: drawn } = await roundTrip(project, format);
        const part = drawn.documents
          .flatMap((document) => document.instances)
          .find(
            (instance) =>
              instance.reference === original.reference ||
              instance.reference === `X${original.reference}`,
          );
        // The card prints an AC phase of 0, the default, either way.
        const { acPhase, ...parameters } = part?.netlist?.parameters ?? {};
        expect(acPhase ?? "0").toBe("0");
        expect(parameters).toEqual(original.netlist!.parameters);
      }
    },
  );

  it.each(["spice", "spectre"] as const)(
    "keeps a drawing text's typography role and its size within it, through %s+RNL",
    async (format) => {
      const project = example("simulation-rc");
      const document = project.documents.find(
        (item) => item.id === project.topDocumentId,
      )!;
      const base = (id: string, zIndex: number, y: number) => ({
        id,
        locked: false,
        zIndex,
        anchor: { kind: "free" as const, position: { x: 500, y } },
        alignment: "start" as const,
        rotation: 0 as const,
      });
      const objects: DraftingObject[] = [
        {
          ...base("label-text", 0, -300),
          kind: "text",
          content: { runs: [{ kind: "text", value: "Label role" }] },
          typographyToken: "label",
        },
        {
          ...base("caption-text", 1, -260),
          kind: "text",
          content: { runs: [{ kind: "text", value: "Caption role" }] },
          typographyToken: "caption",
          styleOverride: { sizeScale: 1.25 },
        },
        {
          ...base("callout", 2, -220),
          kind: "callout",
          content: { runs: [{ kind: "text", value: "Called out" }] },
          typographyToken: "label",
          target: { kind: "free", position: { x: 420, y: -180 } },
        },
      ];
      document.drafting = { objects };
      const { project: drawn } = await roundTrip(project, format);
      const cell = drawn.documents.find(
        (item) => item.netlist?.name === document.netlist?.name,
      )!;
      const roles = (objects: readonly DraftingObject[]) =>
        objects
          .flatMap((object) =>
            object.kind === "text" || object.kind === "callout"
              ? [
                  `${object.kind} ${JSON.stringify(object.content)} ${object.typographyToken ?? "-"} ${object.styleOverride?.sizeScale ?? 1}`,
                ]
              : [],
          )
          .filter((line) => /role|Called/u.test(line))
          .sort();
      expect(roles(cell.drafting?.objects ?? [])).toEqual(roles(objects));
    },
  );

  it.each(["spice", "spectre"] as const)(
    "keeps a drawing text anchored to the part it was anchored to, through %s+RNL",
    async (format) => {
      const project = example("simulation-rc");
      const document = project.documents.find(
        (item) => item.id === project.topDocumentId,
      )!;
      const r1 = document.instances.find((item) => item.reference === "R1")!;
      document.drafting = {
        objects: [
          {
            id: "note",
            locked: false,
            zIndex: 0,
            anchor: {
              kind: "object",
              objectId: r1.id,
              localOffset: { x: 30, y: -20 },
              fallbackPosition: {
                x: r1.placement!.position.x + 30,
                y: r1.placement!.position.y - 20,
              },
            },
            kind: "text",
            content: { runs: [{ kind: "text", value: "1%" }] },
            alignment: "start",
            rotation: 0,
          },
        ],
      };
      const { project: drawn } = await roundTrip(project, format);
      const cell = drawn.documents.find(
        (item) => item.netlist?.name === document.netlist?.name,
      )!;
      const note = cell.drafting?.objects.find(
        (object) =>
          object.kind === "text" &&
          JSON.stringify(object.content).includes("1%"),
      );
      const anchor = note?.anchor;
      expect(anchor?.kind).toBe("object");
      if (anchor?.kind !== "object") return;
      expect(
        cell.instances.find((item) => item.id === anchor.objectId)?.reference,
      ).toBe("R1");
      expect(anchor.localOffset).toEqual({ x: 30, y: -20 });
    },
  );

  it("keeps a line style set as the editor sets one, in the shape's override (#1787)", async () => {
    const project = example("simulation-rc");
    const document = project.documents.find(
      (item) => item.id === project.topDocumentId,
    )!;
    const base = (id: string, zIndex: number) => ({
      id,
      locked: false,
      zIndex,
      anchor: { kind: "free", position: { x: 0, y: 0 } } as const,
    });
    document.drafting = {
      objects: [
        {
          ...base("box", 0),
          kind: "rectangle",
          center: { x: 500, y: -150 },
          width: 160,
          height: 80,
          rotation: 0,
          lineStyle: "solid",
          styleOverride: { lineStyle: "dashed" },
        },
        {
          ...base("rule", 1),
          kind: "construction-line",
          points: [
            { x: 400, y: -300 },
            { x: 600, y: -300 },
          ],
          lineStyle: "dashed",
          styleOverride: { lineStyle: "solid" },
        },
      ],
    };
    const { project: drawn } = await roundTrip(project);
    const cell = drawn.documents.find(
      (item) => item.netlist?.name === document.netlist?.name,
    )!;
    const looks = (cell.drafting?.objects ?? [])
      .filter((object) => object.kind !== "text")
      .map((object) => ({
        kind: object.kind,
        lineStyle: "lineStyle" in object ? object.lineStyle : undefined,
        override: object.styleOverride?.lineStyle,
      }));
    expect(looks).toEqual([
      { kind: "rectangle", lineStyle: "solid", override: "dashed" },
      { kind: "construction-line", lineStyle: "dashed", override: "solid" },
    ]);
  });

  it.each(["spice", "spectre"] as const)(
    "keeps a drawing text's weight as it was set, whatever its runs, through %s+RNL",
    async (format) => {
      const project = example("simulation-rc");
      const document = project.documents.find(
        (item) => item.id === project.topDocumentId,
      )!;
      const text = (
        id: string,
        zIndex: number,
        value: string,
        runsBold: boolean,
        plain: boolean,
      ): Extract<
        NonNullable<
          CircuitProject["documents"][number]["drafting"]
        >["objects"][number],
        { kind: "text" }
      > => ({
        id,
        locked: false,
        zIndex,
        anchor: {
          kind: "free",
          position: { x: 400, y: -300 - 40 * zIndex },
        } as const,
        kind: "text" as const,
        content: {
          runs: [
            runsBold
              ? {
                  kind: "span" as const,
                  style: "bold" as const,
                  children: [{ kind: "text" as const, value }],
                }
              : { kind: "text" as const, value },
          ],
        },
        alignment: "start" as const,
        rotation: 0,
        ...(plain ? { styleOverride: { weight: "normal" as const } } : {}),
      });
      const texts = [
        text("default", 0, "Default", false, false),
        text("bold-runs", 1, "Bold runs", true, false),
        text("plain-bold-runs", 2, "Plain, bold runs", true, true),
        text("plain", 3, "Plain", false, true),
      ];
      document.drafting = { objects: texts };
      const { project: drawn } = await roundTrip(project, format);
      const cell = drawn.documents.find(
        (item) => item.netlist?.name === document.netlist?.name,
      )!;
      const mine = JSON.stringify(texts.map((object) => object.content));
      const looks = (cell.drafting?.objects ?? []).flatMap((object) =>
        object.kind === "text" && mine.includes(JSON.stringify(object.content))
          ? [
              {
                content: object.content,
                styleOverride: object.styleOverride,
              },
            ]
          : [],
      );
      expect(looks).toEqual(
        texts.map((object) => ({
          content: object.content,
          styleOverride: object.styleOverride,
        })),
      );
    },
  );

  it("reads back rectangles, circles, curves and arrows", async () => {
    const project = example("simulation-rc");
    const document = project.documents.find(
      (item) => item.id === project.topDocumentId,
    )!;
    const free = (x: number, y: number) =>
      ({ kind: "free", position: { x, y } }) as const;
    const base = (id: string, zIndex: number) => ({
      id,
      locked: false,
      zIndex,
      anchor: free(0, 0),
    });
    document.drafting = {
      objects: [
        {
          ...base("back", 0),
          kind: "rectangle",
          center: { x: 500, y: -150 },
          width: 160,
          height: 80,
          rotation: 0,
          lineStyle: "dashed",
          layer: "background",
          styleOverride: { fillColor: "#eef4ff" },
        },
        {
          ...base("slanted", 1),
          kind: "rectangle",
          center: { x: 860, y: -150 },
          width: 80,
          height: 40,
          rotation: 30,
          lineStyle: "solid",
        },
        {
          ...base("circle", 2),
          kind: "circle",
          center: { x: 1000, y: -150 },
          radius: 30,
          lineStyle: "dotted",
          styleOverride: { color: "#cc0000" },
        },
        {
          ...base("curve", 3),
          kind: "construction-line",
          points: [
            { x: 400, y: -300 },
            { x: 500, y: -300 },
            { x: 600, y: -250 },
          ],
          curveControls: [null, { x: 580, y: -310 }],
          lineStyle: "dashed",
        },
        {
          ...base("arrow", 4),
          kind: "arrow",
          from: free(400, -400),
          to: free(560, -400),
          styleOverride: { arrowEnd: "medium-arrow" },
        },
        {
          ...base("dashed-arrow", 5),
          kind: "arrow",
          from: free(400, -450),
          to: free(560, -450),
          styleOverride: { arrowEnd: "medium-arrow", lineStyle: "dashed" },
        },
      ],
    };
    const { project: drawn } = await roundTrip(project);
    const cell = drawn.documents.find(
      (item) => item.netlist?.name === document.netlist?.name,
    )!;
    const objects = (cell.drafting?.objects ?? []).filter(
      (object) => object.kind !== "text",
    );
    // A closed shape comes back made solid and drawn as it was, in its
    // override, as the editor sets a line style.
    expect(objects).toEqual([
      expect.objectContaining({
        kind: "rectangle",
        center: { x: 500, y: -150 },
        width: 160,
        height: 80,
        rotation: 0,
        lineStyle: "solid",
        layer: "background",
        styleOverride: { lineStyle: "dashed", fillColor: "#eef4ff" },
      }),
      expect.objectContaining({
        kind: "rectangle",
        center: { x: 860, y: -150 },
        width: 80,
        height: 40,
        rotation: 30,
      }),
      expect.objectContaining({
        kind: "circle",
        center: { x: 1000, y: -150 },
        radius: 30,
        lineStyle: "solid",
        styleOverride: { color: "#cc0000", lineStyle: "dotted" },
      }),
      expect.objectContaining({
        kind: "construction-line",
        points: [
          { x: 400, y: -300 },
          { x: 500, y: -300 },
          { x: 600, y: -250 },
        ],
        curveControls: [null, { x: 580, y: -310 }],
        lineStyle: "dashed",
      }),
      expect.objectContaining({
        kind: "arrow",
        from: free(400, -400),
        to: free(560, -400),
        styleOverride: { arrowStart: "none", arrowEnd: "medium-arrow" },
      }),
      // An arrow, made solid, keeps the line it is drawn with.
      expect.objectContaining({
        kind: "arrow",
        from: free(400, -450),
        to: free(560, -450),
        styleOverride: {
          lineStyle: "dashed",
          arrowStart: "none",
          arrowEnd: "medium-arrow",
        },
      }),
    ]);
  });

  it("reads a curved arrow's control back where it was, though raising it falls between units", async () => {
    const project = example("simulation-rc");
    const document = project.documents.find(
      (item) => item.id === project.topDocumentId,
    )!;
    const free = (x: number, y: number) =>
      ({ kind: "free", position: { x, y } }) as const;
    document.drafting = {
      objects: [
        {
          id: "curved",
          locked: false,
          zIndex: 0,
          anchor: free(420, 355),
          kind: "arrow",
          from: free(420, 355),
          to: free(455, 310),
          curveControls: [{ x: 425, y: 320 }],
          styleOverride: { arrowEnd: "small-arrow" },
        },
      ],
    };
    const { project: drawn } = await roundTrip(project);
    const cell = drawn.documents.find(
      (item) => item.netlist?.name === document.netlist?.name,
    )!;
    const objects = (cell.drafting?.objects ?? []).filter(
      (object) => object.kind !== "text",
    );
    expect(objects).toEqual([
      expect.objectContaining({
        kind: "arrow",
        from: free(420, 355),
        to: free(455, 310),
        curveControls: [{ x: 425, y: 320 }],
      }),
    ]);
  });

  it("reads back leaders, callouts, polarity marks and arrows as Analog Canvas drew them", async () => {
    const project = example("simulation-rc");
    const document = project.documents.find(
      (item) => item.id === project.topDocumentId,
    )!;
    const free = (x: number, y: number) =>
      ({ kind: "free", position: { x, y } }) as const;
    const base = (id: string, zIndex: number, x: number, y: number) => ({
      id,
      locked: false,
      zIndex,
      anchor: free(x, y),
    });
    const words = (value: string) => ({
      runs: [{ kind: "text" as const, value }],
    });
    const bare = { runs: [{ kind: "line-break" as const }] };
    const arrow = (
      id: string,
      zIndex: number,
      [x1, y1, x2, y2]: [number, number, number, number],
      arrowStart: ArrowEnd,
      arrowEnd: ArrowEnd,
      width?: number,
    ) => ({
      ...base(id, zIndex, x1, y1),
      kind: "arrow" as const,
      from: free(x1, y1),
      to: free(x2, y2),
      ...(width ? { outline: { width } } : {}),
      styleOverride: { arrowStart, arrowEnd },
    });
    document.drafting = {
      objects: [
        {
          ...base("lead", 0, 400, -500),
          kind: "leader",
          target: free(500, -560),
          styleOverride: { lineStyle: "dashed", color: "#cc0000" },
        },
        {
          ...base("call", 1, 600, -500),
          kind: "callout",
          content: words("bias"),
          alignment: "start",
          rotation: 0,
          target: free(700, -560),
        },
        {
          ...base("both", 2, 800, -500),
          kind: "text",
          content: words("Vx"),
          alignment: "middle",
          rotation: 0,
          polarity: "both",
        },
        {
          ...base("plus", 3, 900, -500),
          kind: "text",
          content: bare,
          alignment: "middle",
          rotation: 0,
          polarity: "positive",
        },
        {
          ...base("minus", 4, 950, -500),
          kind: "text",
          content: bare,
          alignment: "middle",
          rotation: 0,
          polarity: "negative",
        },
        arrow("open", 5, [400, -650, 560, -650], "none", "open-arrow"),
        arrow("dot", 6, [600, -650, 760, -650], "dot", "small-arrow"),
        arrow("big", 7, [800, -650, 960, -650], "large-arrow", "large-arrow"),
        arrow("fat", 8, [400, -800, 600, -800], "none", "medium-arrow", 30),
        arrow(
          "fat2",
          9,
          [650, -800, 850, -800],
          "medium-arrow",
          "medium-arrow",
          30,
        ),
        arrow("bar", 10, [900, -800, 1000, -800], "none", "none", 30),
      ],
    };
    const { project: drawn, diagnostics } = await roundTrip(project);
    const cell = drawn.documents.find(
      (item) => item.netlist?.name === document.netlist?.name,
    )!;
    // The example's own drawing text comes back too; these all have marks.
    const objects = (cell.drafting?.objects ?? []).filter(
      (object) => object.kind !== "text" || object.polarity,
    );
    expect(
      diagnostics.filter((item) => item.code === "RNL_IMPORT_DRAWING_UNJOINED"),
    ).toEqual([]);
    // Each comes back as one object of its own kind, in its stacking order.
    expect(objects.map((object) => object.kind)).toEqual(
      document.drafting.objects.map((object) => object.kind),
    );
    const [lead, call, both, plus, minus, open, dot, big, fat, fat2, bar] =
      objects;
    expect(lead).toMatchObject({
      anchor: free(400, -500),
      target: free(500, -560),
      styleOverride: { lineStyle: "dashed", color: "#cc0000" },
    });
    expect(call).toMatchObject({
      anchor: free(600, -500),
      target: free(700, -560),
      content: words("bias"),
      alignment: "start",
    });
    expect(both).toMatchObject({ content: words("Vx"), polarity: "both" });
    expect(plus).toMatchObject({
      anchor: free(900, -500),
      content: bare,
      polarity: "positive",
    });
    // Its size comes through: its strokes are off Canvas's whole units.
    expect(
      plus && "styleOverride" in plus && plus.styleOverride?.sizeScale,
    ).toBeFalsy();
    expect(minus).toMatchObject({
      anchor: free(950, -500),
      polarity: "negative",
    });
    expect(open).toMatchObject({
      from: free(400, -650),
      to: free(560, -650),
      styleOverride: { arrowStart: "none", arrowEnd: "open-arrow" },
    });
    expect(dot).toMatchObject({
      from: free(600, -650),
      to: free(760, -650),
      styleOverride: { arrowStart: "dot", arrowEnd: "small-arrow" },
    });
    expect(big).toMatchObject({
      styleOverride: { arrowStart: "large-arrow", arrowEnd: "large-arrow" },
    });
    for (const [back, from, to, start, end] of [
      [fat, 400, 600, "none", "medium-arrow"],
      [fat2, 650, 850, "medium-arrow", "medium-arrow"],
      [bar, 900, 1000, "none", "none"],
    ] as const)
      expect(back).toMatchObject({
        from: free(from, -800),
        to: free(to, -800),
        outline: { width: 30 },
        styleOverride: { arrowStart: start, arrowEnd: end },
      });
  });

  it("reads back ellipses as circles or curves, and arcs as curves", async () => {
    // Analog Canvas writes neither; another tool's file may hold both.
    const exported = createRnlExport(example("simulation-rc"), {
      format: "spice",
    });
    if (exported.status !== "ready") throw new Error("export blocked");
    const level = exported.request.ops.find((op) => op.op === "set")!.level;
    const shapes: Shape[] = [
      {
        shape: "ellipse",
        points: [[100, -15]],
        params: { width: 6, height: 6 },
      },
      {
        shape: "ellipse",
        points: [[110, -15]],
        params: { width: 8, height: 4, fill: "linecolor" },
      },
      {
        shape: "arc",
        points: [
          [120, -10],
          [122, -12],
          [124, -10],
        ],
        params: { arrow: "end" },
      },
      {
        shape: "arc",
        points: [
          [130, -10],
          [132, -8],
          [134, -10],
        ],
      },
    ];
    const request: RnlWriteRequest = {
      ...exported.request,
      ops: [
        ...exported.request.ops,
        ...shapes.map((shape) => ({
          level,
          op: "add-shape" as const,
          ...shape,
        })),
      ],
    };
    const written = await runtime.write({ write: request, svg: false });
    const plan = await planRnlImport({
      inputs: [
        { path: "circuit.sp", bytes: new TextEncoder().encode(written.text) },
      ],
      entryPath: "circuit.sp",
      runtime,
    });
    if (plan.status !== "ready") throw new Error(plan.message);
    const objects = plan.project.documents.flatMap(
      (document) => document.drafting?.objects ?? [],
    );
    expect(objects.find((object) => object.kind === "circle")).toMatchObject({
      center: { x: 1000, y: 150 },
      radius: 30,
    });
    // An eighth of a turn a leg, each quadratic within 0.3 % of the curve.
    const oval = objects.find(
      (object) =>
        object.kind === "construction-line" && object.points.length === 9,
    );
    expect(oval).toMatchObject({
      points: [
        { x: 1140, y: 150 },
        { x: 1128, y: 164 },
        { x: 1100, y: 170 },
        { x: 1072, y: 164 },
        { x: 1060, y: 150 },
        { x: 1072, y: 136 },
        { x: 1100, y: 130 },
        { x: 1128, y: 136 },
        { x: 1140, y: 150 },
      ],
    });
    expect(
      oval?.kind === "construction-line" && oval.curveControls?.every(Boolean),
    ).toBe(true);
    expect(objects.find((object) => object.kind === "arrow")).toMatchObject({
      from: { kind: "free", position: { x: 1200, y: 100 } },
      to: { kind: "free", position: { x: 1240, y: 100 } },
      waypoints: [
        { x: 1206, y: 114 },
        { x: 1220, y: 120 },
        { x: 1234, y: 114 },
      ],
      styleOverride: { arrowEnd: "medium-arrow" },
    });
    expect(
      objects.find(
        (object) =>
          object.kind === "construction-line" && object.points.length === 5,
      ),
    ).toMatchObject({
      points: [
        { x: 1300, y: 100 },
        { x: 1306, y: 86 },
        { x: 1320, y: 80 },
        { x: 1334, y: 86 },
        { x: 1340, y: 100 },
      ],
    });
    expect(
      plan.diagnostics.filter((item) =>
        item.code.startsWith("RNL_IMPORT_SHAPE"),
      ),
    ).toEqual([expect.objectContaining({ code: "RNL_IMPORT_SHAPE_UNFILLED" })]);
  });

  it("reads a circle or an ellipse written on two points, without its size", async () => {
    // RNL writes either one without its size: an ellipse by its box's
    // opposite corners, a circle by its centre and a point on it (13.4).
    const exported = createRnlExport(example("simulation-rc"), {
      format: "spice",
    });
    if (exported.status !== "ready") throw new Error("export blocked");
    const level = exported.request.ops.find((op) => op.op === "set")!.level;
    const shapes: Shape[] = [
      {
        shape: "ellipse",
        points: [
          [100, -15],
          [106, -9],
        ],
      },
      {
        shape: "ellipse",
        points: [
          [110, -17],
          [118, -13],
        ],
      },
      {
        shape: "circle",
        points: [
          [130, -15],
          [133, -11],
        ],
      },
    ];
    const written = await runtime.write({
      write: {
        ...exported.request,
        ops: [
          ...exported.request.ops,
          ...shapes.map((shape) => ({
            level,
            op: "add-shape" as const,
            ...shape,
          })),
        ],
      },
      svg: false,
    });
    const plan = await importRnl(written.text, "spice");
    expect(failures(plan)).toEqual([]);
    expect(plan.drawing).toBe("preserved");
    const objects = plan.project.documents.flatMap(
      (document) => document.drafting?.objects ?? [],
    );
    const circles = objects.filter((object) => object.kind === "circle");
    expect(circles).toEqual([
      expect.objectContaining({ center: { x: 1030, y: 120 }, radius: 30 }),
      expect.objectContaining({ center: { x: 1300, y: 150 }, radius: 50 }),
    ]);
    const oval = objects.find(
      (object) =>
        object.kind === "construction-line" && object.points.length === 9,
    );
    expect(oval?.kind === "construction-line" && oval.points[0]).toEqual({
      x: 1180,
      y: 150,
    });
  });

  it.each(["spice", "spectre"] as const)(
    "carries the Cells the top does not call, with their drawings, through %s+RNL",
    async (format) => {
      const project = example("simulation-rc");
      const { project: drawn } = await roundTrip(project, format);
      const parts = (from: CircuitProject) =>
        from.documents
          .flatMap((document) =>
            document.instances.map(
              (instance) =>
                `${document.netlist?.name} ${instance.reference ?? instance.symbolId} ${JSON.stringify(instance.placement)}`,
            ),
          )
          .sort();
      expect(drawn.documents.map((document) => document.netlist?.name)).toEqual(
        expect.arrayContaining(["rc_lowpass", "rc_highpass"]),
      );
      expect(parts(drawn)).toEqual(parts(project));
      expect(
        drawn.documents.find((document) => document.id === drawn.topDocumentId)
          ?.netlist?.name,
      ).toBe("rc_lowpass");
    },
  );

  it.each(["spice", "spectre"] as const)(
    "carries a Cell that calls the top, and reads the top back as the editor's, through %s+RNL",
    async (format) => {
      const project = example("simulation-rc");
      const lowpass = project.documents.find(
        (document) => document.id === project.topDocumentId,
      )!;
      const highpass = project.documents.find(
        (document) => document.netlist?.name === "rc_highpass",
      )!;
      highpass.instances.push({
        id: "XLOW",
        reference: "XLOW",
        symbolId: hierarchicalSymbolId(lowpass.netlist!.name),
        placement: {
          position: { x: 500, y: 500 },
          rotation: 0,
          mirror: "none",
        },
        netlist: {
          binding: { kind: "subcircuit", childDocumentId: lowpass.id },
          parameters: {},
        },
      });
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready")
        throw new Error(JSON.stringify(exported));
      expect(exported.request.netlist).toMatch(/\.?subckt rc_highpass/iu);
      expect(
        exported.diagnostics.filter(
          (item) => item.code === "RNL_CELL_NOT_WRITTEN",
        ),
      ).toEqual([]);
      expect(
        exported.request.ops.filter(
          (op) => op.op === "add-usage" && op.definition === "$CANVAS_TOP",
        ),
      ).toHaveLength(1);
      const { project: drawn, diagnostics } = await roundTrip(project, format);
      expect(
        diagnostics.filter((item) => item.code.startsWith("RNL_")),
      ).toEqual([]);
      expect(
        drawn.documents.find((document) => document.id === drawn.topDocumentId)
          ?.netlist?.name,
      ).toBe("rc_lowpass");
      expect(
        drawn.documents.map((document) => document.netlist?.name).sort(),
      ).toEqual(["rc_highpass", "rc_lowpass"]);
    },
  );

  it.each(["spice", "spectre"] as const)(
    "reads back a block the file draws in lines, filled bars and dots and no box, through %s+RNL",
    async (format) => {
      const project = example("simulation-rc");
      const lowpass = project.documents.find(
        (document) => document.id === project.topDocumentId,
      )!;
      const highpass = project.documents.find(
        (document) => document.netlist?.name === "rc_highpass",
      )!;
      const symbolId = hierarchicalSymbolId(lowpass.netlist!.name);
      highpass.instances.push({
        id: "XLOW",
        reference: "XLOW",
        symbolId,
        placement: {
          position: { x: 500, y: 500 },
          rotation: 0,
          mirror: "none",
        },
        netlist: {
          binding: { kind: "subcircuit", childDocumentId: lowpass.id },
          parameters: {},
        },
      });
      const block = createProjectSymbolResolver(
        project,
        builtInSymbols,
      ).resolve(symbolId)!.definition;
      const primitives = [
        {
          kind: "polygon",
          points: [
            { x: -50, y: -50 },
            { x: 50, y: 0 },
            { x: -50, y: 50 },
          ],
          fill: "none",
          stroke: "foreground",
        },
        {
          kind: "line",
          from: { x: -60, y: 30 },
          to: { x: -50, y: 30 },
        },
        // A gate's plate and a junction's dot, as an author draws a MOS
        // stack's artwork: shapes that are no block's box.
        {
          kind: "polygon",
          points: [
            { x: -30, y: -20 },
            { x: -26, y: -20 },
            { x: -26, y: 20 },
            { x: -30, y: 20 },
          ],
          fill: "foreground",
          stroke: "none",
        },
        {
          kind: "circle",
          center: { x: 20, y: 0 },
          radius: 3,
          fill: "foreground",
          stroke: "none",
        },
      ];
      project.componentDefinitions = [
        ...(project.componentDefinitions ?? []),
        { symbol: { ...block, primitives } },
      ] as CircuitProject["componentDefinitions"];
      const plan = await roundTrip(project, format);
      expect(failures(plan)).toEqual([]);
      const artwork = (from: CircuitProject) =>
        from.componentDefinitions?.find(
          (definition) => definition.symbol.id === symbolId,
        )?.symbol;
      expect(artwork(plan.project)?.primitives).toMatchObject(primitives);
      expect(
        plan.diagnostics.filter(
          (item) => item.code === "RNL_IMPORT_BLOCK_APPROXIMATE",
        ),
      ).toEqual([]);
      // Written again, it draws the same.
      const again = await roundTrip(plan.project, format);
      expect(failures(again)).toEqual([]);
      expect(artwork(again.project)?.primitives).toEqual(
        artwork(plan.project)?.primitives,
      );
    },
  );

  it("leaves out an uncalled Cell the netlist cannot print, and prints the others", () => {
    const project = example("simulation-rc");
    const highpass = project.documents.find(
      (document) => document.netlist?.name === "rc_highpass",
    )!;
    // A Cell not finished: its parts are wired to nothing.
    const broken = structuredClone(highpass);
    broken.id = "cell-rc-broken";
    broken.name = "rc_broken";
    broken.netlist!.name = "rc_broken";
    broken.nets = [];
    broken.routes = [];
    broken.junctions = [];
    project.documents.push(broken);
    const exported = createRnlExport(project, { format: "spice" });
    if (exported.status !== "ready") throw new Error("export blocked");
    expect(exported.request.netlist).toMatch(/\.subckt rc_highpass/iu);
    expect(exported.request.netlist).not.toMatch(/rc_broken/iu);
    expect(
      exported.diagnostics
        .filter((item) => item.code === "RNL_CELL_NOT_WRITTEN")
        .map((item) => item.objectIds),
    ).toEqual([[broken.id]]);
  });

  it.each(["spice", "spectre"] as const)(
    "keeps a net named with a Greek letter, which the netlist spells out, through %s+RNL",
    async (format) => {
      const project = example("simulation-rc");
      const document = project.documents.find(
        (item) => item.id === project.topDocumentId,
      )!;
      const claim = document.connectivityEvidence!.find(
        (item) => item.kind === "name-claim" && item.name === "out",
      )!;
      if (claim.kind === "name-claim") claim.name = "φ1";
      // Its label shows the net's name, as the editor sets it.
      for (const annotation of document.annotations)
        if (annotation.kind === "net-label") delete annotation.formatOverride;
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready")
        throw new Error(JSON.stringify(exported));
      expect(exported.request.netlist).toMatch(/\bphi1\b/u);
      const { project: drawn } = await roundTrip(project, format);
      const names = (from: CircuitProject) =>
        Array.from(
          resolveDocumentLogicalNets(
            from.documents.find((item) => item.id === from.topDocumentId)!,
          ).byBaseNetId.values(),
          (net) => net.name,
        )
          .filter((name) => name)
          .sort();
      expect(names(drawn)).toEqual(names(project));
      expect(names(drawn)).toContain("φ1");
    },
  );

  it("draws a port drawn several times with as many Cell Pins", async () => {
    const project = parseProject(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../../../fixtures/projects/port-nets/project.icproj.json",
        ),
        "utf8",
      ),
    );
    const { project: drawn, diagnostics } = await roundTrip(project);
    const pins = (from: CircuitProject) =>
      from.documents
        .flatMap((document) =>
          (document.netlist?.terminals ?? []).map(
            (terminal) =>
              `${terminal.name} ${terminal.interfaceInstanceIds.length}`,
          ),
        )
        .sort();
    expect(pins(drawn)).toEqual(pins(project));
    expect(diagnostics.filter((item) => item.code.startsWith("RNL_"))).toEqual(
      [],
    );
  });

  it.each(["before", "after"] as const)(
    "draws the wire to a block's pin that its Cell draws twice on two Nets, listed %s the first",
    async (order) => {
      const project = example("simulation-ota");
      const cell = project.documents.find(
        (document) => document.id === "document-ota-5t",
      )!;
      // A second ibias Cell Pin on a Net of its own, which the name joins
      // to the first: the printed port is keyed by one of the two Nets.
      cell.instances.push({
        id: "PIBIAS2",
        placement: {
          mirror: "none",
          position: { x: 290, y: 420 },
          rotation: 90,
        },
        symbolId: "port",
      });
      cell.nets.push({
        id: "net-cell-pin-pibias-2",
        terminals: [{ instanceId: "PIBIAS2", pinName: "P" }],
      });
      const terminals = cell.netlist!.terminals;
      const first = terminals.findIndex((item) => item.name === "ibias");
      terminals.splice(order === "before" ? first : first + 1, 0, {
        ...terminals[first]!,
        id: "cell-terminal-ibias-2",
        interfaceInstanceIds: ["PIBIAS2"],
        netId: "net-cell-pin-pibias-2",
      });

      const exported = createRnlExport(project, { format: "spice" });
      if (exported.status !== "ready")
        throw new Error(JSON.stringify(exported));
      expect(
        exported.diagnostics.filter((item) => item.code === "RNL_WIRE_UNNAMED"),
      ).toEqual([]);
      const { project: drawn } = await roundTrip(project);
      const top = (from: CircuitProject) =>
        from.documents.find((document) => document.id === from.topDocumentId)!;
      expect(top(drawn).routes.length).toBe(top(project).routes.length);
    },
  );

  it("lays out a Cell's block as the RNL draws it", async () => {
    const project = example("simulation-ota");
    const { project: drawn } = await roundTrip(project);
    const slots = (from: CircuitProject) => {
      const cell = from.documents.find(
        (document) => document.netlist?.name === "ota_5t",
      )!;
      const names = new Map(
        cell.netlist!.terminals.map((terminal) => [terminal.id, terminal.name]),
      );
      return cellSymbolPinSlots(from, cell)
        .map(
          (slot) => `${names.get(slot.terminalId)} ${slot.side} ${slot.offset}`,
        )
        .sort();
    };
    expect(slots(drawn)).toEqual(slots(project));
  });

  it.each(["spice", "spectre"] as const)(
    "lays out the top's block, which no call draws, as it was laid out, through %s+RNL",
    async (format) => {
      const project = example("two-stage-op-amp");
      const top = (from: CircuitProject) =>
        from.documents.find((document) => document.id === from.topDocumentId)!;
      const vout = top(project).netlist!.terminals.find(
        (terminal) => terminal.name === "Vout",
      )!;
      top(project).presentation.cellSymbol = {
        pinPlacements: [{ terminalId: vout.id, side: "north", offset: 0 }],
      };
      const result = await roundTrip(project, format);
      expect(failures(result)).toEqual([]);
      const named = (from: CircuitProject) => {
        const cell = top(from);
        const names = new Map(
          cell.netlist!.terminals.map((terminal) => [
            terminal.id,
            terminal.name,
          ]),
        );
        return {
          stored: (cell.presentation.cellSymbol?.pinPlacements ?? []).map(
            (item) =>
              `${names.get(item.terminalId)} ${item.side} ${item.offset}`,
          ),
          slots: cellSymbolPinSlots(from, cell)
            .map(
              (slot) =>
                `${names.get(slot.terminalId)} ${slot.side} ${slot.offset}`,
            )
            .sort(),
        };
      };
      expect(named(result.project).stored).toContain("Vout north 0");
      expect(named(result.project).slots).toEqual(named(project).slots);
    },
  );

  it.each(["spice", "spectre"] as const)(
    "keeps pins left open, on the top and inside a Cell, through %s+RNL",
    async (format) => {
      const project = example("simulation-ota");
      // A resistor left open at both ends in each Cell.
      for (const document of project.documents) {
        document.instances.push({
          id: "R9",
          reference: "R9",
          symbolId: "resistor",
          placement: {
            position: { x: 600, y: 600 },
            rotation: 0,
            mirror: "none",
          },
          netlist: {
            binding: { kind: "primitive", deviceClass: "resistor" },
            parameters: { value: "1k" },
          },
        });
        for (const pinName of ["2", "1"])
          document.noConnects.push({
            id: `open-${pinName}`,
            endpoint: { kind: "terminal", instanceId: "R9", pinName },
          });
      }
      const result = await roundTrip(project, format);
      expect(failures(result)).toEqual([]);
      const drawn = result.project;
      const open = (from: CircuitProject) =>
        from.documents
          .flatMap((document) =>
            document.noConnects.map(
              ({ endpoint }) =>
                `${document.netlist?.name} ${endpoint.instanceId}:${endpoint.pinName}`,
            ),
          )
          .sort();
      expect(open(drawn)).toEqual(open(project));
      // No net is left on an open pin, and the netlist numbers the open
      // nodes as before.
      for (const document of drawn.documents)
        expect(
          document.nets.filter((net) =>
            net.terminals.some((terminal) => terminal.instanceId === "R9"),
          ),
        ).toEqual([]);
      const netlist = (from: CircuitProject) => {
        const result = createDesignNetlistExport(from, { format });
        if (result.status !== "ready") throw new Error("netlist blocked");
        return result.file.text.match(/^R9\b.*$/gmu);
      };
      expect(netlist(drawn)).toEqual(netlist(project));
    },
  );

  it("reads back wire arrows, a current marker and a floating symbol", async () => {
    const project = example("simulation-rc");
    const document = project.documents.find(
      (item) => item.id === project.topDocumentId,
    )!;
    document.drafting = {
      objects: [
        {
          id: "figure",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 1100, y: -300 } },
          kind: "floating-symbol",
          symbolId: "resistor",
          transform: { rotation: 90, mirror: "none" },
        },
      ],
    };
    const [first, second] = document.routes;
    first!.styleOverride = { arrow: "middle" };
    second!.styleOverride = { arrow: "end" };
    document.annotations.push({
      id: "current",
      kind: "route-marker",
      content: {
        runs: [
          { kind: "text", value: "I" },
          {
            kind: "span",
            style: "subscript",
            children: [{ kind: "text", value: "D" }],
          },
        ],
      },
      anchor: {
        kind: "route",
        routeId: first!.id,
        legId: first!.legs[0]!.id,
        t: 0.5,
        normalOffset: -14,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
      markerKind: "current",
    });
    document.annotations.push({
      id: "voltage",
      kind: "route-marker",
      content: { runs: [{ kind: "text", value: "Vin" }] },
      anchor: {
        kind: "route",
        routeId: second!.id,
        legId: second!.legs[0]!.id,
        t: 0.5,
        normalOffset: 0,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
      markerKind: "voltage",
    });
    const { project: drawn } = await roundTrip(project);
    const cell = drawn.documents.find(
      (item) => item.netlist?.name === document.netlist?.name,
    )!;
    expect(
      cell.annotations.find((item) => item.markerKind === "voltage"),
    ).toMatchObject({
      kind: "route-marker",
      content: { runs: [{ kind: "text", value: "Vin" }] },
      alignment: "start",
      anchor: { t: 0.5, direction: "forward", orientation: "follow" },
    });
    expect(
      cell.routes.map((route) => route.styleOverride?.arrow).filter(Boolean),
    ).toEqual(["middle", "end"]);
    const marker = cell.annotations.find(
      (item) => item.kind === "route-marker",
    );
    expect(marker).toMatchObject({
      markerKind: "current",
      anchor: {
        t: 0.5,
        normalOffset: -14,
        direction: "forward",
        orientation: "follow",
      },
    });
    expect(marker?.content).toEqual({
      runs: [
        { kind: "text", value: "I" },
        {
          kind: "span",
          style: "subscript",
          children: [{ kind: "text", value: "D" }],
        },
      ],
    });
    expect(
      cell.drafting?.objects.filter(
        (object) => object.kind === "floating-symbol",
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "floating-symbol",
        symbolId: "resistor",
        anchor: { kind: "free", position: { x: 1100, y: -300 } },
        transform: { rotation: 90, mirror: "none" },
      }),
    ]);
  });
});

/**
 * A comparator placed in Cell `dut`, bound as a placed one is, each signal
 * pin on a Cell Pin and, when `powered`, its VDD too.
 */
function comparator(
  symbolId: string,
  parameters: Record<string, string>,
  powered: boolean,
): CircuitProject {
  const project = createEmptyProject("comparator", "Comparator", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  document.instances.push({
    id: "block",
    symbolId,
    reference: "X1",
    placement: { position: { x: 100, y: 0 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: {
        kind: "unresolved-subcircuit",
        name: symbolId.startsWith("comparator-differential")
          ? "icm_ideal_comparator_differential"
          : IDEAL_COMPARATOR_TARGET,
      },
      parameters,
    },
  });
  for (const port of subcircuitDescriptor(symbolId)!.ports) {
    const pinName = port.pinName ?? port.supply;
    if (port.supply && !(powered && port.supply === "VDD")) continue;
    const id = `pin-${port.name}`;
    document.instances.push({ id, symbolId: "port", placement: null });
    document.nets.push({
      id: port.name,
      terminals: [
        { instanceId: id, pinName: "P" },
        { instanceId: "block", pinName },
      ],
    });
    document.netlist!.terminals.push({
      id: `terminal-${port.name}`,
      name: port.name,
      netId: port.name,
      direction: "inout",
      interfaceInstanceIds: [id],
    });
  }
  return project;
}

/** A converter in Cell `dut`, its pins and supplies each on a Cell Pin. */
function converter(symbolId: string): CircuitProject {
  const project = createEmptyProject("converter", "Converter", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const descriptor = subcircuitDescriptor(symbolId)!;
  document.instances.push({
    id: "block",
    symbolId,
    reference: "X1",
    placement: { position: { x: 100, y: 0 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "unresolved-subcircuit", name: descriptor.target },
      parameters: { bits: "6" },
    },
  });
  for (const port of descriptor.ports) {
    const id = `pin-${port.name}`;
    document.instances.push({ id, symbolId: "port", placement: null });
    document.nets.push({
      id: port.name,
      terminals: [
        { instanceId: id, pinName: "P" },
        ...(port.pinName
          ? [{ instanceId: "block", pinName: port.pinName }]
          : []),
      ],
    });
    document.netlist!.terminals.push({
      id: `terminal-${port.name}`,
      name: port.name,
      netId: port.name,
      direction: "inout",
      interfaceInstanceIds: [id],
    });
  }
  return project;
}

describe("RNL round trip of built-in blocks", () => {
  it("refuses a comparator retargeted to the Project's master whose ports are not its own pins (#1928)", () => {
    const project = comparator("comparator-differential", {}, true);
    const ports = ["VDD", "VSS", "VIP", "VIN", "VOP", "VON"];
    project.documents[0]!.instances[0]!.netlist!.binding = {
      kind: "unresolved-subcircuit",
      name: "custom_cmp",
    };
    project.modelSources = [
      {
        id: "source",
        language: "spice",
        revision: 1,
        entry: "cmp.sp",
        dependencies: [],
        files: [
          {
            path: "cmp.sp",
            text: `.subckt custom_cmp ${ports.join(" ")}\nRLOAD VOP VON 1k\n.ends custom_cmp\n`,
          },
        ],
      },
    ];
    project.externalSubcircuitDefinitions = [
      {
        id: "custom-cmp",
        name: "custom_cmp",
        interfaceStatus: "declared",
        terminals: ports.map((name) => ({
          id: name,
          name,
          direction: "inout" as const,
        })),
        formalParameters: [],
        implementation: {
          kind: "source",
          sourceId: "source",
          entry: "custom_cmp",
        },
      },
    ];
    // The retarget binds the comparator to custom_cmp, Pin by name, as
    // set-model would; its VIP/VIN/VOP/VON are the ideal body's, not the
    // comparator's, so the netlist refuses before any stencil is drawn.
    const result = createRnlExport(project, { format: "spice" });
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.netlistDiagnostics).toContainEqual(
      expect.objectContaining({ code: "GATE_CELL_PIN_MISMATCH" }),
    );
  });

  it("refuses an inline comparator stencil on a component's own master with another port order", () => {
    // A User Component drawn with the comparator's symbol calls its own
    // master, its ports in its own order: the inline stencil's terminals
    // would land on the wrong nodes.
    const project = withProjectComponentDefinitions(
      comparator("comparator-differential", {}, true),
    );
    const component = project.componentDefinitions!.find(
      (definition) => definition.symbol.id === "comparator-differential",
    )!;
    component.subcircuit = {
      ...component.subcircuit!,
      target: "custom_cmp",
      ports: [...component.subcircuit!.ports].reverse(),
    };
    project.documents[0]!.instances[0]!.netlist!.binding = {
      kind: "unresolved-subcircuit",
      name: "custom_cmp",
    };
    project.externalSubcircuitDefinitions = [
      {
        id: "custom-cmp",
        name: "custom_cmp",
        interfaceStatus: "declared",
        terminals: component.subcircuit.ports.map((port) => ({
          id: port.name,
          name: port.name,
          direction: "inout" as const,
        })),
        formalParameters: [],
      },
    ];
    const result = createRnlExport(project, { format: "spice" });
    expect(result.status).toBe("blocked");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "RNL_INLINE_INTERFACE_MISMATCH" }),
    );
  });
  it.each(["missing primitive", "linewidth", "linestyle", "fill"])(
    "does not recognize a local comparator stencil with edited %s",
    async (edit) => {
      const project = comparator(
        "comparator-differential-inputs-swapped",
        { vhigh: "1" },
        false,
      );
      const exported = createRnlExport(project, { format: "spice" });
      if (exported.status !== "ready") throw Error(JSON.stringify(exported));
      const stencil = exported.request.ops.find(
        (op) => op.op === "define-symbol",
      );
      if (!stencil || stencil.op !== "define-symbol")
        throw Error("No inline stencil");
      if (edit === "missing primitive") stencil.prims.pop();
      else if (edit === "fill") {
        const triangle = stencil.prims.find(
          (primitive) => primitive.points.length === 4,
        )!;
        triangle.params = { ...triangle.params, fill: "linecolor" };
      } else {
        const lead = stencil.prims[0]!;
        lead.style = {
          ...lead.style,
          ...(edit === "linewidth" ? { linewidth: 12 } : { linestyle: "none" }),
        };
      }
      const written = await runtime.write({
        write: exported.request,
        svg: false,
      });
      const plan = await importRnl(written.text, "spice");
      expect(plan.diagnostics).toContainEqual(
        expect.objectContaining({ code: "RNL_IMPORT_UNMAPPED_SYMBOL" }),
      );
    },
  );
  it.each(
    (
      [
        "comparator",
        "comparator-unmarked",
        "comparator-differential",
        "comparator-differential-inputs-swapped",
        "comparator-differential-unmarked",
        "comparator-differential-unmarked-inputs-swapped",
      ] as const
    ).flatMap((symbolId) =>
      (
        [
          ["icm_ideal_comparator", { vhigh: "1" }, false],
          ["icm_ideal_comparator_vdd", {}, true],
        ] as const
      ).map(
        ([body, parameters, powered]) =>
          [
            symbolId,
            symbolId.startsWith("comparator-differential")
              ? body.replace(
                  "icm_ideal_comparator",
                  "icm_ideal_comparator_differential",
                )
              : body,
            parameters,
            powered,
          ] as const,
      ),
    ),
  )(
    "draws a %s calling %s and brings it back",
    async (symbolId, body, parameters, powered) => {
      for (const format of ["spice", "spectre"] as const) {
        const project = comparator(symbolId, parameters, powered);
        const plan = await roundTrip(project, format);
        // RNL's own errors, such as a pin on a terminal the call lacks,
        // come in as warnings.
        expect(
          plan.diagnostics.filter(
            (item) =>
              item.severity === "error" || item.code === "RNL_IMPORT_RNL_ERROR",
          ),
        ).toEqual([]);
        const part = plan.project.documents
          .flatMap((document) => document.instances)
          .find((instance) => instance.reference === "X1")!;
        expect(rnlPart(part)).toEqual(
          rnlPart(project.documents[0]!.instances[0]!),
        );
        const again = createDesignNetlistExport(plan.project, { format });
        expect(again.status === "ready" && again.file.text).toMatch(
          new RegExp(`^X1 .* ${body}( |$)`, "mu"),
        );
      }
    },
  );
  it.each([
    ["adc-differential", "adc_differential"],
    ["adc-differential-inputs-swapped", "adc_differential"],
    ["dac-differential", "dac_differential"],
  ] as const)(
    "draws a %s as a stencil of its own and brings it back calling %s",
    async (symbolId, body) => {
      for (const format of ["spice", "spectre"] as const) {
        const project = converter(symbolId);
        const plan = await roundTrip(project, format);
        expect(
          plan.diagnostics.filter(
            (item) =>
              item.severity === "error" || item.code === "RNL_IMPORT_RNL_ERROR",
          ),
        ).toEqual([]);
        const part = plan.project.documents
          .flatMap((document) => document.instances)
          .find((instance) => instance.reference === "X1")!;
        expect(rnlPart(part)).toEqual(
          rnlPart(project.documents[0]!.instances[0]!),
        );
        const again = createDesignNetlistExport(plan.project, { format });
        expect(again.status === "ready" && again.file.text).toMatch(
          new RegExp(`^X1 .* ${body}( |$)`, "mu"),
        );
      }
    },
  );

  it.each(["spice", "spectre"] as const)(
    "brings an op-amp bound to a Cell back drawn, the Cell's IN+ and IN- spelt as Spectre escapes them (%s)",
    async (format) => {
      // Cell ota takes the op-amp's pins in its own order; Spectre writes
      // its ports IN\- and IN\+, which the call passes nodes to.
      const project = createEmptyProject("opamp-cell", "Op-amp cell", "top");
      const top = project.documents[0]!;
      top.netlist!.name = "top";
      const ota = createEmptyDocument("ota", "ota");
      ota.netlist!.name = "ota";
      const at = (x: number, y: number) =>
        ({ position: { x, y }, rotation: 0, mirror: "none" }) as const;
      const pin = (
        document: typeof top,
        name: string,
        x: number,
        y: number,
        terminals: { instanceId: string; pinName: string }[] = [],
      ) => {
        document.instances.push({
          id: `port-${name}`,
          symbolId: "port",
          placement: at(x, y),
        });
        document.nets.push({
          id: `net-${name}`,
          terminals: [
            { instanceId: `port-${name}`, pinName: "P" },
            ...terminals,
          ],
        });
        document.netlist!.terminals.push({
          id: `terminal-${name}`,
          name,
          netId: `net-${name}`,
          direction: "inout",
          interfaceInstanceIds: [`port-${name}`],
        });
      };
      ota.instances.push({
        id: "R1",
        reference: "R1",
        symbolId: "resistor",
        placement: at(200, 100),
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "20k" },
        },
      });
      pin(ota, "OUT", 0, 0, [{ instanceId: "R1", pinName: "2" }]);
      pin(ota, "IN-", 0, 40);
      pin(ota, "IN+", 0, 80, [{ instanceId: "R1", pinName: "1" }]);
      pin(ota, "VDD", 0, 120);
      pin(ota, "VSS", 0, 160);
      project.documents.push(ota);
      top.instances.push({
        id: "amp",
        symbolId: "opamp",
        reference: "X1",
        placement: at(200, 200),
        netlist: {
          binding: { kind: "subcircuit", childDocumentId: "ota" },
          parameters: {},
        },
      });
      pin(top, "IN", 0, 40, [{ instanceId: "amp", pinName: "IN+" }]);
      pin(top, "OUT", 0, 80, [
        { instanceId: "amp", pinName: "IN-" },
        { instanceId: "amp", pinName: "OUT" },
      ]);
      const before = createDesignNetlistExport(project, { format });
      if (before.status !== "ready") throw new Error(JSON.stringify(before));
      const plan = await roundTrip(project, format);
      expect(failures(plan)).toEqual([]);
      expect(plan.drawing).not.toBe("discarded");
      const amp = plan.project.documents
        .flatMap((document) => document.instances)
        .find((instance) => instance.reference === "X1")!;
      expect(amp).toMatchObject({
        symbolId: "opamp",
        placement: top.instances.find((item) => item.id === "amp")!.placement,
        netlist: { binding: { kind: "subcircuit" } },
      });
      const after = createDesignNetlistExport(plan.project, { format });
      expect(after.status === "ready" && after.file.text).toBe(
        before.file.text,
      );
    },
  );
});

/**
 * Switches placed in Cell `dut` with a ground: S1 clocked by the phase its
 * label names, S2 by its own name, S3 by its CTRL pin, and a chopper
 * clocked by its label.
 */
function switches(): CircuitProject {
  const project = createEmptyProject("switches", "Switches", "main");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const at = (x: number, y: number) =>
    ({ position: { x, y }, rotation: 0, mirror: "none" }) as const;
  const port = (id: string, name: string, net: string, x: number) => {
    document.instances.push({ id, symbolId: "port", placement: at(x, 0) });
    document.netlist!.terminals.push({
      id: `terminal-${id}`,
      name,
      netId: net,
      direction: "inout",
      interfaceInstanceIds: [id],
    });
    return { instanceId: id, pinName: "P" };
  };
  document.instances.push(
    { id: "GND1", symbolId: "ground", placement: at(600, 300) },
    {
      id: "C1",
      symbolId: "capacitor",
      reference: "C1",
      placement: at(600, 200),
      netlist: {
        binding: { kind: "primitive", deviceClass: "capacitor" },
        // As the conversion from Spectre spells it, so both dialects compare.
        parameters: { value: "1e-12" },
      },
    },
    {
      id: "S1",
      symbolId: "simple-switch",
      reference: "S1",
      placement: at(100, 100),
    },
    {
      id: "S2",
      symbolId: "ideal-switch",
      reference: "S2",
      placement: at(200, 100),
    },
    {
      id: "S3",
      symbolId: "externally-controlled-switch",
      reference: "S3",
      placement: at(300, 100),
    },
    {
      id: "CH1",
      symbolId: "chopper",
      reference: "CH1",
      placement: at(450, 100),
    },
  );
  document.nets.push(
    {
      id: "a",
      terminals: [
        port("PA", "A", "a", 0),
        { instanceId: "S1", pinName: "1" },
        { instanceId: "S2", pinName: "1" },
        { instanceId: "S3", pinName: "P" },
        { instanceId: "CH1", pinName: "INP" },
      ],
    },
    {
      id: "b",
      terminals: [
        port("PB", "B", "b", 50),
        { instanceId: "S1", pinName: "2" },
        { instanceId: "S2", pinName: "2" },
        { instanceId: "S3", pinName: "N" },
        { instanceId: "CH1", pinName: "INN" },
        { instanceId: "C1", pinName: "1" },
      ],
    },
    {
      id: "c",
      terminals: [
        port("PC", "C", "c", 700),
        { instanceId: "S3", pinName: "CTRL" },
        { instanceId: "CH1", pinName: "OUTP" },
      ],
    },
    {
      id: "d",
      terminals: [
        port("PD", "D", "d", 750),
        { instanceId: "CH1", pinName: "OUTN" },
      ],
    },
    {
      id: "gnd",
      terminals: [
        { instanceId: "GND1", pinName: "0" },
        { instanceId: "C1", pinName: "2" },
      ],
    },
  );
  document.connectivityEvidence.push({
    id: "gnd-claim",
    kind: "name-claim",
    netId: "gnd",
    name: "0",
    scope: "global",
    powerDomain: "ground",
    owner: { kind: "power-marker", objectId: "GND1" },
  });
  for (const [id, text] of [
    ["S1", "Φ1"],
    ["CH1", "Φ2"],
  ] as const)
    document.annotations.push({
      id: `label-${id}`,
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: text }] },
      anchor: {
        kind: "object",
        objectId: id,
        localOffset: { x: 0, y: -30 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
  return project;
}

describe("RNL round trip of switches", () => {
  it.each(["spice", "spectre"] as const)(
    "brings each switch back clocked as it was drawn (%s)",
    async (format) => {
      const project = switches();
      const plan = await roundTrip(project, format);
      expect(
        plan.diagnostics.filter(
          (item) =>
            item.severity === "error" || item.code === "RNL_IMPORT_RNL_ERROR",
        ),
      ).toEqual([]);
      const parts = plan.project.documents.flatMap(
        (document) => document.instances,
      );
      for (const reference of ["S1", "S2", "S3", "CH1"]) {
        const original = project.documents[0]!.instances.find(
          (instance) => instance.reference === reference,
        )!;
        const part = parts.find((instance) => instance.reference === reference);
        expect(part && rnlPart(part)).toEqual(rnlPart(original));
        expect(part?.symbolId).toBe(original.symbolId);
      }
      // Each part its label clocks names its phase in its label again.
      const phases = plan.project.documents.flatMap((document) =>
        document.annotations.flatMap((annotation) =>
          annotation.kind === "instance-label" &&
          !annotation.binding &&
          annotation.content &&
          annotation.anchor.kind === "object"
            ? [
                `${parts.find((part) => part.id === (annotation.anchor as { objectId: string }).objectId)?.reference} ${flattenRichText(annotation.content)}`,
              ]
            : [],
        ),
      );
      expect(phases.sort()).toEqual(["CH1 Φ2", "S1 Φ1"]);
      // The phases its labels clock the switches by print as the Cell's
      // pins, but come back as labels alone, no Cell Pins (#1787).
      const pins = (from: CircuitProject) =>
        from.documents
          .flatMap((cell) => cell.netlist?.terminals ?? [])
          .map((terminal) => terminal.name)
          .sort();
      expect(pins(plan.project)).toEqual(pins(project));
      for (const spice of [false, true]) {
        const options = { format: spice ? "spice" : format } as const;
        const before = createDesignNetlistExport(project, options);
        const after = createDesignNetlistExport(plan.project, options);
        expect(after.status === "ready" && after.file.text).toBe(
          before.status === "ready" && before.file.text,
        );
      }
    },
  );

  it.each(["spice", "spectre"] as const)(
    "brings a wide chopper back wide, defined in the file itself (%s, #2170)",
    async (format) => {
      const project = switches();
      const chopper = project.documents[0]!.instances.find(
        (instance) => instance.id === "CH1",
      )!;
      chopper.symbolVariantId = "wide";
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready")
        throw new Error(JSON.stringify(exported));
      // The published package stays as it is: the file defines the symbol.
      expect(exported.request.ops).toContainEqual(
        expect.objectContaining({
          op: "define-symbol",
          name: "$CANVAS_CHOPPER_WIDE",
        }),
      );
      const plan = await roundTrip(project, format);
      expect(failures(plan)).toEqual([]);
      const part = plan.project.documents
        .flatMap((document) => document.instances)
        .find((instance) => instance.reference === "CH1")!;
      expect(part.symbolId).toBe("chopper");
      expect(part.symbolVariantId).toBe("wide");
      expect(rnlPart(part)).toEqual(rnlPart(chopper));
      for (const spice of [false, true]) {
        const options = { format: spice ? "spice" : format } as const;
        const before = createDesignNetlistExport(project, options);
        const after = createDesignNetlistExport(plan.project, options);
        expect(after.status === "ready" && after.file.text).toBe(
          before.status === "ready" && before.file.text,
        );
      }
    },
  );

  it.each(["spice", "spectre"] as const)(
    "brings a chopper bound to a Cell back bound to it, clocked by its label (%s, #1928)",
    async (format) => {
      const project = switches();
      // Cell chop takes the chopper's pins and its clock CK, in its own order.
      const chop = createEmptyDocument("chop", "chop");
      chop.netlist!.name = "chop";
      for (const [index, pin] of [
        "CK",
        "OUTN",
        "OUTP",
        "INN",
        "INP",
      ].entries()) {
        chop.instances.push({
          id: `port-${pin}`,
          symbolId: "port",
          placement: {
            position: { x: index * 100, y: 0 },
            rotation: 0,
            mirror: "none",
          },
        });
        chop.nets.push({
          id: `net-${pin}`,
          terminals: [{ instanceId: `port-${pin}`, pinName: "P" }],
        });
        chop.netlist!.terminals.push({
          id: `terminal-${pin}`,
          name: pin,
          netId: `net-${pin}`,
          direction: "inout",
          interfaceInstanceIds: [`port-${pin}`],
        });
      }
      project.documents.push(chop);
      project.documents[0]!.instances.find(
        (instance) => instance.id === "CH1",
      )!.netlist = {
        binding: { kind: "subcircuit", childDocumentId: "chop" },
        parameters: {},
      };
      const before = createDesignNetlistExport(project, { format });
      if (before.status !== "ready") throw new Error(JSON.stringify(before));
      expect(before.file.text).toMatch(/ chop\s*$/mu);
      const plan = await roundTrip(project, format);
      expect(failures(plan)).toEqual([]);
      const parts = plan.project.documents.flatMap(
        (document) => document.instances,
      );
      const chopper = parts.find((instance) => instance.reference === "CH1");
      expect(chopper).toMatchObject({
        symbolId: "chopper",
        netlist: { binding: { kind: "subcircuit" } },
      });
      // Its label names its clock again.
      expect(
        plan.project.documents.flatMap((document) =>
          document.annotations.flatMap((annotation) =>
            annotation.kind === "instance-label" &&
            annotation.content &&
            annotation.anchor.kind === "object" &&
            annotation.anchor.objectId === chopper?.id
              ? [flattenRichText(annotation.content)]
              : [],
          ),
        ),
      ).toContain("Φ2");
      const after = createDesignNetlistExport(plan.project, { format });
      expect(after.status === "ready" && after.file.text).toBe(
        before.file.text,
      );
    },
  );

  it.each(["spice", "spectre"] as const)(
    "takes no Cell Pin for the ground pin a Cell drawing no ground prints (%s)",
    async (format) => {
      // The switches read their control against ground, so the Cell prints
      // a VSS pin its drawing never shows (#1787).
      const project = switches();
      const document = project.documents[0]!;
      document.instances = document.instances.filter(
        (instance) => instance.id !== "GND1",
      );
      document.nets = document.nets.filter((net) => net.id !== "gnd");
      document.nets
        .find((net) => net.id === "d")!
        .terminals.push({ instanceId: "C1", pinName: "2" });
      document.connectivityEvidence = [];
      const exported = createRnlExport(project, { format });
      expect(exported.status === "ready" && exported.request.netlist).toMatch(
        format === "spice" ? /\.subckt dut VSS / : /subckt dut \(?VSS /,
      );
      const plan = await roundTrip(project, format);
      expect(failures(plan)).toEqual([]);
      const pins = (from: CircuitProject) =>
        from.documents
          .flatMap((cell) => cell.netlist?.terminals ?? [])
          .map((terminal) => terminal.name)
          .sort();
      // The same Pins as the Cell drawing its ground takes back, VSS not
      // among them.
      const grounded = await roundTrip(switches(), format);
      expect(pins(plan.project)).toEqual(pins(grounded.project));
      expect(pins(plan.project)).not.toContain("VSS");
      for (const spice of [false, true]) {
        const options = { format: spice ? "spice" : format } as const;
        const before = createDesignNetlistExport(project, options);
        const after = createDesignNetlistExport(plan.project, options);
        expect(after.status === "ready" && after.file.text).toBe(
          before.status === "ready" && before.file.text,
        );
      }
    },
  );
});

it.each(["spice", "spectre"] as const)(
  "takes no Cell Pin for the supplies an unwired MOS body prints through %s+RNL",
  async (format) => {
    // M1's body is left unwired: GainStage prints the supplies a body
    // defaults to as VDD and VSS pins, which its caller passes on (#1787).
    const project = parseProject(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../../../fixtures/projects/hierarchical-gain-stage/project.icproj.json",
        ),
        "utf8",
      ),
    );
    for (const instance of project.documents.flatMap((cell) => cell.instances))
      if (instance.id === "M1")
        instance.netlist = {
          binding: { kind: "model", deviceClass: "mos", name: "NMOS" },
          parameters: { w: "1u", l: "1u" },
        };
      else if (instance.id === "R1")
        instance.netlist = {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "1k" },
        };
    const exported = createRnlExport(project, { format });
    expect(exported.status === "ready" && exported.request.netlist).toMatch(
      /subckt GainStage \(?VDD VSS /,
    );
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    const pins = (from: CircuitProject) =>
      from.documents
        .map(
          (cell) =>
            `${cell.netlist?.name}: ${(cell.netlist?.terminals ?? [])
              .map((terminal) => terminal.name)
              .sort()
              .join(" ")}`,
        )
        .sort();
    expect(pins(plan.project)).toEqual(pins(project));
    const body = plan.project.documents
      .flatMap((cell) => cell.instances)
      .find((instance) => instance.reference === "M1")!;
    expect(
      plan.project.documents.some((cell) =>
        cell.nets.some((net) =>
          net.terminals.some(
            (item) => item.instanceId === body.id && item.pinName === "B",
          ),
        ),
      ),
    ).toBe(false);
    // The stand-in NMOS card reads back as the Project's own model, which
    // the netlist then leaves out: that is #1815's, not this.
    const cards = (text: string | false) =>
      text && text.replace(/^\.?model NMOS .*\n/gmu, "");
    for (const spice of [false, true]) {
      const options = { format: spice ? "spice" : format } as const;
      const before = createDesignNetlistExport(project, options);
      const after = createDesignNetlistExport(plan.project, options);
      expect(cards(after.status === "ready" && after.file.text)).toBe(
        cards(before.status === "ready" && before.file.text),
      );
    }
  },
);

it.each(["spice", "spectre"] as const)(
  "takes no Cell Pin for the supplies an unwired MOS body prints in a Cell no Cell calls, through %s+RNL",
  async (format) => {
    // As above, in a copy of GainStage that nothing calls: the file prints
    // it with the same VDD and VSS pins, which its drawing does not show.
    const project = parseProject(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../../../fixtures/projects/hierarchical-gain-stage/project.icproj.json",
        ),
        "utf8",
      ),
    );
    for (const instance of project.documents.flatMap((cell) => cell.instances))
      if (instance.id === "M1")
        instance.netlist = {
          binding: { kind: "model", deviceClass: "mos", name: "NMOS" },
          parameters: { w: "1u", l: "1u" },
        };
      else if (instance.id === "R1")
        instance.netlist = {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "1k" },
        };
    const stage = project.documents.find(
      (cell) => cell.netlist?.name === "GainStage",
    )!;
    const spare = structuredClone(stage);
    spare.id = "cell-spare-stage";
    spare.name = "SpareStage";
    spare.netlist!.name = "SpareStage";
    project.documents.push(spare);
    const exported = createRnlExport(project, { format });
    expect(exported.status === "ready" && exported.request.netlist).toMatch(
      /subckt SpareStage \(?VDD VSS /,
    );
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    const pins = (from: CircuitProject) =>
      from.documents
        .map(
          (cell) =>
            `${cell.netlist?.name}: ${(cell.netlist?.terminals ?? [])
              .map((terminal) => terminal.name)
              .sort()
              .join(" ")}`,
        )
        .sort();
    expect(pins(plan.project)).toEqual(pins(project));
  },
);

it.each(["spice", "spectre"] as const)(
  "keeps a body supply pin its callers pass another node through %s+RNL",
  async (format) => {
    // As above, but the file passes GainStage's VSS a body bias of its
    // own: the pin is the author's, as the netlist is.
    const project = parseProject(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../../../fixtures/projects/hierarchical-gain-stage/project.icproj.json",
        ),
        "utf8",
      ),
    );
    for (const instance of project.documents.flatMap((cell) => cell.instances))
      if (instance.id === "M1")
        instance.netlist = {
          binding: { kind: "model", deviceClass: "mos", name: "NMOS" },
          parameters: { w: "1u", l: "1u" },
        };
      else if (instance.id === "R1")
        instance.netlist = {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "1k" },
        };
    const exported = createRnlExport(project, { format });
    if (exported.status !== "ready") throw new Error("export blocked");
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    // X2 passes its VSS pin the supply instead: an author's body tie.
    const edited = written.text.replace(
      format === "spice"
        ? "X2 VDD VSS net0 net1 GainStage"
        : "X2 (VDD VSS net0 net1) GainStage",
      format === "spice"
        ? "X2 VDD VDD net0 net1 GainStage"
        : "X2 (VDD VDD net0 net1) GainStage",
    );
    expect(edited).not.toBe(written.text);
    const plan = await importRnl(edited, format);
    expect(failures(plan)).toEqual([]);
    const stage = plan.project.documents.find(
      (cell) => cell.netlist?.name === "GainStage",
    )!;
    expect(stage.netlist!.terminals.map((terminal) => terminal.name)).toContain(
      "VSS",
    );
  },
);

/**
 * GainStagePair with GainStage's body unwired, so the export gives GainStage
 * and the pair VDD and VSS pins, and a Cell Sink calling ground through a
 * ground glyph, which prints its own VSS: the pair's Pins `IN<0>` and OUT.
 */
function stagesWithSink(): CircuitProject {
  const project = parseProject(
    readFileSync(
      resolve(
        import.meta.dirname,
        "../../../../../fixtures/projects/hierarchical-gain-stage/project.icproj.json",
      ),
      "utf8",
    ),
  );
  for (const instance of project.documents.flatMap((cell) => cell.instances))
    if (instance.id === "M1")
      instance.netlist = {
        binding: { kind: "model", deviceClass: "mos", name: "NMOS" },
        parameters: { w: "1u", l: "1u" },
      };
    else if (instance.id === "R1")
      instance.netlist = {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      };
  const at = (x: number, y: number, rotation: 0 | 180 = 0) =>
    ({ position: { x, y }, rotation, mirror: "none" }) as const;
  const sink = createEmptyDocument("document-sink", "Sink");
  sink.netlist = {
    name: "Sink",
    formalParameters: [],
    terminals: [
      {
        id: "terminal-sink-a",
        name: "A",
        netId: "net-a",
        direction: "inout",
        interfaceInstanceIds: ["PA"],
      },
    ],
  };
  sink.instances.push(
    { id: "PA", symbolId: "port", placement: at(100, 100) },
    {
      id: "RS",
      symbolId: "resistor",
      reference: "RS",
      placement: at(200, 160),
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "2k" },
      },
    },
    { id: "GS", symbolId: "ground", placement: at(200, 260) },
  );
  sink.nets.push(
    {
      id: "net-a",
      terminals: [
        { instanceId: "PA", pinName: "P" },
        { instanceId: "RS", pinName: "1" },
      ],
    },
    {
      id: "net-gnd",
      terminals: [
        { instanceId: "GS", pinName: "0" },
        { instanceId: "RS", pinName: "2" },
      ],
    },
  );
  sink.connectivityEvidence.push({
    id: "sink-gnd-claim",
    kind: "name-claim",
    netId: "net-gnd",
    name: "0",
    scope: "global",
    powerDomain: "ground",
    owner: { kind: "power-marker", objectId: "GS" },
  });
  project.documents.push(sink);
  const top = project.documents.find(
    (cell) => cell.id === project.topDocumentId,
  )!;
  top.instances.push(
    {
      id: "X3",
      symbolId: hierarchicalSymbolId("document-sink"),
      reference: "X3",
      placement: at(900, 240),
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "document-sink" },
        parameters: {},
      },
    },
    { id: "PIN", symbolId: "port", placement: at(100, 240) },
    { id: "POUT", symbolId: "port", placement: at(1000, 160, 180) },
  );
  top.netlist!.terminals.push(
    {
      id: "terminal-top-in",
      name: "IN<0>",
      netId: "net-top-in",
      direction: "input",
      interfaceInstanceIds: ["PIN"],
    },
    {
      id: "terminal-top-out",
      name: "OUT",
      netId: "net-top-out",
      direction: "output",
      interfaceInstanceIds: ["POUT"],
    },
  );
  top.nets
    .find((net) => net.id === "net-top-in")!
    .terminals.push({ instanceId: "PIN", pinName: "P" });
  top.nets
    .find((net) => net.id === "net-top-out")!
    .terminals.push(
      { instanceId: "POUT", pinName: "P" },
      { instanceId: "X3", pinName: "A" },
    );
  return project;
}

it.each(["spice", "spectre"] as const)(
  "takes back the supply pins a Cell with a port RNL quotes prints, beside a Cell drawing its ground, through %s+RNL",
  async (format) => {
    // RNL quotes the pair's port IN<0> ("IN<0>"); the import compares the
    // pins it takes back by the file's own subcircuits, which spell it so.
    const project = stagesWithSink();
    const exported = createRnlExport(project, { format });
    expect(exported.status === "ready" && exported.request.netlist).toMatch(
      /subckt GainStagePair \(?VDD VSS /,
    );
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    expect(plan.drawing).not.toBe("discarded");
    for (const spice of [false, true]) {
      const options = { format: spice ? "spice" : format } as const;
      const before = createDesignNetlistExport(project, options);
      const after = createDesignNetlistExport(plan.project, options);
      expect(after.status === "ready" && after.file.text).toBe(
        before.status === "ready" && before.file.text,
      );
    }
  },
);

const GATES_4 = ["and", "nand", "or", "nor", "xor", "xnor"] as const;

/**
 * The six 4-input gates in Cell `dut`, one above another, each pin wired
 * straight across to a Cell Pin level with it.
 */
function gates4(): CircuitProject {
  const project = createEmptyProject("gates", "Gates", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const symbols = new Map(builtInSymbols.map((symbol) => [symbol.id, symbol]));
  const portPin = symbols.get("port")!.pins[0]!.at;
  const at = (x: number, y: number) =>
    ({ position: { x, y }, rotation: 0, mirror: "none" }) as const;
  GATES_4.forEach((gate, row) => {
    const symbolId = `${gate}-gate-4`;
    const reference = `X${row + 1}`;
    const position = { x: 200, y: 100 + row * 100 };
    document.instances.push({
      id: reference,
      symbolId,
      reference,
      placement: at(position.x, position.y),
      netlist: {
        binding: {
          kind: "unresolved-subcircuit",
          name: subcircuitDescriptor(symbolId)!.target,
        },
        parameters: {},
      },
    });
    for (const pin of drawnPins(symbols.get(symbolId)!)) {
      const node = `n_${reference}_${pin.name}`.toLowerCase();
      const port = `pin-${node}`;
      const x = position.x + pin.at.x + (pin.at.x < 0 ? -60 : 60);
      const y = position.y + pin.at.y;
      document.instances.push({
        id: port,
        symbolId: "port",
        placement: at(x - portPin.x, y - portPin.y),
      });
      document.nets.push({
        id: node,
        terminals: [
          { instanceId: port, pinName: "P" },
          { instanceId: reference, pinName: pin.name },
        ],
      });
      document.netlist!.terminals.push({
        id: `terminal-${node}`,
        name: node,
        netId: node,
        direction: "inout",
        interfaceInstanceIds: [port],
      });
      document.routes.push({
        id: `route-${node}`,
        netId: node,
        start: { kind: "terminal", instanceId: port, pinName: "P" },
        legs: [
          {
            id: `leg-${node}`,
            to: {
              kind: "endpoint",
              endpoint: {
                kind: "terminal",
                instanceId: reference,
                pinName: pin.name,
              },
            },
            mode: "manual",
          },
        ],
      });
    }
  });
  return project;
}

it.each(["spice", "spectre"] as const)(
  "keeps an instance label that stands free of any part, through %s+RNL",
  async (format) => {
    const project = hiddenPowerPort();
    project.documents[0]!.annotations.push({
      id: "free",
      kind: "instance-label",
      alignment: "end",
      rotation: 0,
      locked: false,
      anchor: { kind: "free", position: { x: 500, y: 240 } },
      content: { runs: [{ kind: "text", value: "VOUT" }] },
    });
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    const document = plan.project.documents[0]!;
    expect(document.drafting?.objects ?? []).toEqual([]);
    expect(
      document.annotations.filter(
        (annotation) =>
          annotation.kind === "instance-label" &&
          annotation.anchor.kind === "free",
      ),
    ).toMatchObject([
      {
        kind: "instance-label",
        alignment: "end",
        anchor: { position: { x: 500, y: 240 } },
        content: { runs: [{ kind: "text", value: "VOUT" }] },
      },
    ]);
    expect(
      labelDifferences(labelCensus(project), labelCensus(plan.project)),
    ).toEqual([]);
  },
);

it.each(["spice", "spectre"] as const)(
  "draws a project's exact copy of a Library symbol with that symbol, through %s+RNL",
  async (format) => {
    const project = hiddenPowerPort();
    const library = builtInSymbols.find((symbol) => symbol.id === "resistor")!;
    const copyId = "own-resistor";
    project.componentDefinitions = [
      {
        symbol: {
          ...library,
          id: copyId,
          primitives: library.primitives.map(({ part: _, ...shape }) => shape),
        },
        electrical: {
          ...deviceDescriptor("resistor")!,
          id: copyId,
          symbolId: copyId,
        },
      },
    ] as CircuitProject["componentDefinitions"];
    const part = project.documents[0]!.instances.find(
      (instance) => instance.id === "R1",
    )!;
    part.symbolId = copyId;
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    expect(
      plan.project.documents[0]!.instances.find(
        (instance) => instance.reference === "R1",
      )!.symbolId,
    ).toBe("resistor");
    const before = createDesignNetlistExport(project, { format });
    const after = createDesignNetlistExport(plan.project, { format });
    expect(after.status === "ready" && after.file.text).toBe(
      before.status === "ready" && before.file.text,
    );

    // A copy drawn otherwise is the project's own symbol, which RNL lacks.
    project.componentDefinitions![0]!.symbol.primitives = [];
    const refused = createRnlExport(project, { format });
    expect(refused.status).toBe("blocked");
    expect(refused.diagnostics.map((item) => item.code)).toContain(
      "RNL_NO_SYMBOL",
    );
  },
);

it.each(["spice", "spectre"] as const)(
  "reads a transformer back the transformer, through %s+RNL",
  async (format) => {
    const project = createEmptyProject("magnetic", "Magnetic", "dut");
    const document = project.documents[0]!;
    document.netlist!.name = "dut";
    document.instances.push({
      id: "X1",
      symbolId: "xfmr",
      reference: "X1",
      placement: { position: { x: 200, y: 200 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { lp: "2n", ls: "3n", k: "0.5" } },
    });
    for (const pinName of ["P+", "P-", "S+", "S-"])
      document.noConnects.push({
        id: `X1${pinName}`,
        endpoint: { kind: "terminal", instanceId: "X1", pinName },
      });
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    expect(plan.project.documents).toHaveLength(1);
    expect(plan.project.documents[0]!.instances[0]).toMatchObject({
      symbolId: "xfmr",
      netlist: { parameters: { lp: "2n", ls: "3n", k: "0.5" } },
    });
    const before = createDesignNetlistExport(project, { format });
    const after = createDesignNetlistExport(plan.project, { format });
    expect(after.status === "ready" && after.file.text).toBe(
      before.status === "ready" && before.file.text,
    );
  },
);

describe("RNL round trip of 4-input gates", () => {
  it("keeps the name of a Cell Pin that SPICE spells without its brackets", async () => {
    const project = gates4();
    const document = project.documents[0]!;
    const terminal = document.netlist!.terminals[0]!;
    terminal.name = "SEL[3]";
    // The Pin shows its name, as a Cell Pin drawn in the editor does.
    document.annotations.push({
      id: "sel-label",
      kind: "instance-label",
      binding: { kind: "cell-terminal-name", terminalId: terminal.id },
      anchor: {
        kind: "object",
        objectId: terminal.interfaceInstanceIds[0]!,
        localOffset: { x: -20, y: 5 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "end",
      rotation: 0,
      locked: false,
    });
    const exported = createRnlExport(project, { format: "spice" });
    if (exported.status !== "ready") throw new Error("export blocked");
    expect(exported.request.netlist).not.toMatch(/SEL\[3\]/u);
    const { project: drawn } = await roundTrip(project, "spice");
    const pin = (from: CircuitProject) =>
      from.documents
        .flatMap((item) => item.netlist?.terminals ?? [])
        .filter((item) => /^SEL/u.test(item.name))
        .map((item) => item.name);
    expect(pin(drawn)).toEqual(["SEL[3]"]);
  });

  it.each(["spice", "spectre"] as const)(
    "keeps the styles of a Cell Pin label whose name it sets with a subscript (%s)",
    async (format) => {
      const project = gates4();
      const document = project.documents[0]!;
      const terminal = document.netlist!.terminals[0]!;
      terminal.name = "N_Vos_B";
      const span = (
        style: "italic" | "bold" | "subscript",
        ...children: RichTextRun[]
      ): RichTextRun => ({ kind: "span", style, children });
      const text = (value: string): RichTextRun => ({ kind: "text", value });
      // Written otherwise than the name would set it: V slants, os does not.
      const formatOverride = {
        runs: [
          span("bold", span("italic", text("N"))),
          span("subscript", span("bold", span("italic", text("V")))),
          span("subscript", span("bold", text("os_B"))),
        ],
      };
      document.annotations.push({
        id: "offset-label",
        kind: "instance-label",
        binding: { kind: "cell-terminal-name", terminalId: terminal.id },
        formatOverride,
        anchor: {
          kind: "object",
          objectId: terminal.interfaceInstanceIds[0]!,
          localOffset: { x: -20, y: 5 },
          fallbackPosition: { x: 0, y: 0 },
        },
        alignment: "end",
        rotation: 0,
        locked: false,
      });
      const { project: drawn } = await roundTrip(project, format);
      const back = drawn.documents.find(
        (item) => item.netlist?.name === document.netlist?.name,
      )!;
      const pin = back.netlist!.terminals.find(
        (item) => item.name === "N_Vos_B",
      )!;
      const label = back.annotations.find(
        (item) =>
          item.binding?.kind === "cell-terminal-name" &&
          item.binding.terminalId === pin.id,
      );
      expect(label?.formatOverride).toBeDefined();
      expect(sameStyledText(label!.formatOverride!, formatOverride)).toBe(true);
    },
  );

  it.each(["spice", "spectre"] as const)(
    "adds no supply Cell Pins for gates whose bodies the netlist writes, whose rails it ties itself (%s)",
    async (format) => {
      const project = gates4();
      const { project: drawn } = await roundTrip(project, format);
      const pins = (from: CircuitProject) =>
        from.documents
          .flatMap((document) =>
            (document.netlist?.terminals ?? []).map(
              (terminal) => terminal.name,
            ),
          )
          .sort();
      expect(pins(drawn)).toEqual(pins(project));
    },
  );

  it.each(["spice", "spectre"] as const)(
    "draws Analog Canvas's own gates, every wire level, and brings them back (%s)",
    async (format) => {
      const project = gates4();
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready") throw new Error("export blocked");
      const written = await runtime.write({
        write: exported.request,
        svg: false,
      });
      for (const gate of GATES_4)
        expect(written.text).toContain(
          `@SET-SYMBOL $CANVAS_${gate.toUpperCase()}_4INPUT`,
        );
      expect(written.text).toContain(
        `@USE-PACKAGE(name="${CANVAS_PACKAGE}", version="${CANVAS_PACKAGE_VERSION}")`,
      );
      // RNL's standard gates have their inputs elsewhere; Analog Canvas's
      // own keep each wire level, in RNL as in the editor.
      const path = pathOf(format);
      const snapshot = await runtime.snapshot({
        entry: path,
        files: { [path]: written.text },
        dialect: format,
        parts: { drawing: false, host: true, model: true },
      });
      expect(
        snapshot.diagnostics.filter((item) => item.severity === "error"),
      ).toEqual([]);
      const wires = snapshot.levels.flatMap(
        (level) => level.model?.wires ?? [],
      );
      expect(wires).toHaveLength(30);
      expect(
        wires.filter(
          (wire) => new Set(wire.points.map((point) => point?.[1])).size !== 1,
        ),
      ).toEqual([]);

      const plan = await importRnl(written.text, format);
      expect(failures(plan)).toEqual([]);
      const parts = plan.project.documents.flatMap(
        (document) => document.instances,
      );
      for (const original of project.documents[0]!.instances) {
        if (!original.reference) continue;
        const part = parts.find(
          (instance) => instance.reference === original.reference,
        );
        expect(part?.symbolId).toBe(original.symbolId);
        expect(part && rnlPart(part)).toEqual(rnlPart(original));
      }
      expect(
        plan.project.documents.flatMap((document) => document.routes),
      ).toHaveLength(30);
      const before = createDesignNetlistExport(project, { format });
      const after = createDesignNetlistExport(plan.project, { format });
      expect(after.status === "ready" && after.file.text).toBe(
        before.status === "ready" && before.file.text,
      );
    },
  );

  it.each(["spice", "spectre"] as const)(
    "reads RNL's standard 4-input gates back as Analog Canvas's own (%s)",
    async (format) => {
      const project = gates4();
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready") throw new Error("export blocked");
      // The same drawing as another tool writes it, with RNL's own gates.
      const request = JSON.parse(
        JSON.stringify(withoutCanvasMeaning(exported.request))
          .replaceAll("$CANVAS_", "$")
          .replace(
            `"name":"${CANVAS_PACKAGE}","version":"${CANVAS_PACKAGE_VERSION}"`,
            `"name":"rnl-std-logic","version":"${RNL_STD_VERSION}"`,
          ),
      ) as typeof exported.request;
      const written = await runtime.write({ write: request, svg: false });
      expect(written.text).not.toContain("$CANVAS_");
      expect(written.text).toContain("@SET-SYMBOL $AND_4INPUT");
      const plan = await importRnl(written.text, format);
      expect(failures(plan)).toEqual([]);
      const parts = plan.project.documents.flatMap(
        (document) => document.instances,
      );
      for (const original of project.documents[0]!.instances) {
        if (!original.reference) continue;
        const part = parts.find(
          (instance) => instance.reference === original.reference,
        );
        expect(part?.symbolId).toBe(original.symbolId);
        expect(part?.placement).toEqual(original.placement);
      }
      const before = createDesignNetlistExport(project, { format });
      const after = createDesignNetlistExport(plan.project, { format });
      expect(after.status === "ready" && after.file.text).toBe(
        before.status === "ready" && before.file.text,
      );
    },
  );
});

/**
 * Two calls of a subcircuit a Spectre model source defines in a SPICE
 * section, placed in the top Cell, their pins left unconnected.
 */
function spiceModelSource(): CircuitProject {
  const project = createEmptyProject("owned-model", "Owned model");
  project.modelSources = [
    {
      id: "source",
      language: "spectre",
      revision: 1,
      entry: "gain.scs",
      dependencies: [],
      files: [
        {
          path: "gain.scs",
          text: "simulator lang=spice\n.subckt gain_block A B params: gain=2\nRLOAD A B {gain*1k}\n.ends gain_block\nsimulator lang=spectre\n",
        },
      ],
    },
  ];
  project.externalSubcircuitDefinitions = [
    {
      id: "gain",
      name: "gain_block",
      interfaceStatus: "declared",
      terminals: [
        { id: "a", name: "A", direction: "input" },
        { id: "b", name: "B", direction: "output" },
      ],
      formalParameters: [{ name: "gain", defaultValue: "2" }],
      implementation: {
        kind: "source",
        sourceId: "source",
        entry: "gain_block",
      },
    },
  ];
  const document = project.documents[0]!;
  for (const id of ["X1", "X2"]) {
    document.instances.push({
      id,
      reference: id,
      symbolId: externalSubcircuitSymbolId("gain"),
      placement: {
        position: { x: 200, y: id === "X1" ? 160 : 280 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "gain" },
        parameters: {},
      },
    });
    for (const pinName of ["A", "B"])
      document.noConnects.push({
        id: id + pinName,
        endpoint: { kind: "terminal", instanceId: id, pinName },
      });
  }
  return project;
}

describe("RNL round trip of a Spectre netlist with a SPICE section", () => {
  it("writes no record inside the SPICE section, and reads the calls back", async () => {
    const project = spiceModelSource();
    const exported = createRnlExport(project, { format: "spectre" });
    if (exported.status !== "ready")
      throw new Error(
        `export blocked: ${JSON.stringify([...exported.netlistDiagnostics, ...exported.diagnostics].filter((item) => item.severity === "error"))}`,
      );
    const written = await runtime.write({
      write: exported.request,
      svg: false,
    });
    const lines = written.text.split(/\r?\n/u);
    const start = lines.indexOf("simulator lang=spice");
    const end = lines.indexOf("simulator lang=spectre", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(
      lines
        .slice(start, end)
        .filter((line) => /^(\*|\/\/).*@[A-Z]/u.test(line)),
    ).toEqual([]);
    const plan = await importRnl(written.text, "spectre");
    expect(failures(plan)).toEqual([]);
    const parts = plan.project.documents.flatMap(
      (document) => document.instances,
    );
    // The import makes its own external definition; each call stands where
    // it was drawn.
    for (const original of project.documents[0]!.instances) {
      const part = parts.find((instance) => instance.reference === original.id);
      expect(part?.placement, original.id).toEqual(original.placement);
    }
  });
});

/** A primitive's device class, as an instance binds it. */
type PrimitiveClass = Extract<
  NonNullable<NonNullable<Instance["netlist"]>["binding"]>,
  { kind: "primitive" }
>["deviceClass"];

const CONTROLLED_SOURCE_KINDS = ["vcvs", "vccs", "ccvs", "cccs"];

/**
 * The four controlled sources in either appearance, each into its own load: the
 * voltage-controlled ones sense V1's voltage, the current-controlled ones
 * its current.
 */
function controlledSources(
  kinds: readonly string[] = CONTROLLED_SOURCE_KINDS,
  shape: "circle" | "diamond" = "diamond",
): CircuitProject {
  const project = createEmptyProject(
    "controlled-sources",
    "Controlled Sources",
  );
  const document = project.documents[0]!;
  const at = (x: number, y: number) =>
    ({ position: { x, y }, rotation: 0, mirror: "none" }) as const;
  const part = (
    id: string,
    symbolId: string,
    deviceClass: PrimitiveClass,
    x: number,
    parameters: Record<string, string>,
    more: Partial<Instance> = {},
  ): Instance => ({
    id,
    symbolId,
    reference: id,
    placement: at(x, 100),
    netlist: { binding: { kind: "primitive", deviceClass }, parameters },
    ...more,
  });
  const appearance = shape === "diamond" ? { symbolVariantId: "diamond" } : {};
  // Values as the conversion from Spectre spells them, so both dialects
  // compare.
  const sources = [
    [
      "E1",
      "vcvs",
      { gain: "2" },
      { kind: "voltage", positiveNetId: "a", negativeNetId: "gnd" },
    ],
    [
      "G1",
      "vccs",
      { gm: "0.001" },
      { kind: "voltage", positiveNetId: "a", negativeNetId: "gnd" },
    ],
    ["H1", "ccvs", { rm: "1000" }, { kind: "current", sensorInstanceId: "V1" }],
    ["F1", "cccs", { gain: "2" }, { kind: "current", sensorInstanceId: "V1" }],
  ] as const;
  document.instances.push(
    { id: "GND1", symbolId: "ground", placement: at(100, 300) },
    part("V1", "voltage-source", "voltage-source", 100, { dc: "1" }),
    part("R1", "resistor", "resistor", 200, { value: "1000" }),
  );
  const gnd = [
    { instanceId: "GND1", pinName: "0" },
    { instanceId: "V1", pinName: "-" },
    { instanceId: "R1", pinName: "2" },
  ];
  document.nets.push({
    id: "a",
    terminals: [
      { instanceId: "V1", pinName: "+" },
      { instanceId: "R1", pinName: "1" },
    ],
  });
  sources
    .filter(([, kind]) => kinds.includes(kind))
    .forEach(([id, kind, parameters, control], index) => {
      const x = 300 + index * 200;
      const load = `R${id}`;
      const source = part(id, kind, kind, x, parameters, appearance);
      source.netlist!.control = control;
      document.instances.push(
        source,
        part(load, "resistor", "resistor", x + 100, { value: "1000" }),
      );
      document.nets.push({
        id: id.toLowerCase(),
        terminals: [
          { instanceId: id, pinName: "+" },
          { instanceId: load, pinName: "1" },
        ],
      });
      gnd.push(
        { instanceId: id, pinName: "-" },
        { instanceId: load, pinName: "2" },
      );
    });
  document.nets.push({ id: "gnd", terminals: gnd });
  document.connectivityEvidence.push({
    id: "gnd-claim",
    kind: "name-claim",
    netId: "gnd",
    name: "0",
    scope: "global",
    powerDomain: "ground",
    owner: { kind: "power-marker", objectId: "GND1" },
  });
  return project;
}

describe.each(["circle", "diamond"] as const)(
  "RNL round trip of controlled sources drawn as %s",
  (shape) => {
    // Analog Canvas's Spectre import reads no native ccvs or cccs, so Spectre
    // brings back the voltage-controlled ones.
    it.each([
      ["spice", CONTROLLED_SOURCE_KINDS],
      ["spectre", ["vcvs", "vccs"]],
    ] as const)(
      "preserves each source appearance through its canonical symbol (%s)",
      async (format, kinds) => {
        const project = withImportedInstanceDisplays(
          controlledSources(kinds, shape),
        );
        const exported = createRnlExport(project, { format });
        if (exported.status !== "ready") throw new Error("export blocked");
        const written = await runtime.write({
          write: exported.request,
          svg: false,
        });
        for (const kind of kinds) {
          const symbol =
            shape === "diamond"
              ? `$${kind.toUpperCase()}`
              : `$CANVAS_${kind.toUpperCase()}_CIRCLE`;
          expect(written.text).toContain(`@SET-SYMBOL ${symbol}`);
        }
        expect(written.text.includes("@SET-SYMBOL $CANVAS_")).toBe(
          shape === "circle",
        );
        expect(
          exported.diagnostics.some(
            (item) => item.code === "RNL_NOT_STANDARD_SYMBOL",
          ),
        ).toBe(shape === "circle");
        const plan = await importRnl(written.text, format);
        expect(failures(plan)).toEqual([]);
        expect(
          labelCensus(project).filter((label) => !label.hidden).length,
        ).toBeGreaterThan(kinds.length);
        expect(
          labelDifferences(labelCensus(project), labelCensus(plan.project)),
        ).toEqual([]);
        const parts = plan.project.documents.flatMap(
          (document) => document.instances,
        );
        for (const original of project.documents[0]!.instances) {
          if (!original.reference) continue;
          const part = parts.find(
            (instance) => instance.reference === original.reference,
          );
          expect(part?.symbolId, original.reference).toBe(original.symbolId);
          expect(part?.symbolVariantId, original.reference).toBe(
            original.symbolVariantId,
          );
          expect(part && rnlPart(part)).toEqual(rnlPart(original));
        }
        const before = createDesignNetlistExport(project, { format });
        const after = createDesignNetlistExport(plan.project, { format });
        expect(after.status === "ready" && after.file.text).toBe(
          before.status === "ready" && before.file.text,
        );
      },
    );
  },
);

describe("another tool's label looks", () => {
  it.each(["spice", "spectre"] as const)(
    "give way to the house look; only Analog Canvas's own file keeps them (%s)",
    async (format) => {
      // Names set the way Virtuoso sets them: 10-point and coloured.
      const project = withImportedInstanceDisplays(
        controlledSources(["vcvs", "vccs"]),
      );
      for (const annotation of project.documents[0]!.annotations)
        if (annotation.kind === "instance-label") {
          annotation.sizeScale = 0.6616;
          annotation.textColor = "#aa3300";
        }
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready") throw new Error("export blocked");
      const labels = async (write: typeof exported.request) => {
        const written = await runtime.write({ write, svg: false });
        const plan = await importRnl(written.text, format);
        expect(failures(plan)).toEqual([]);
        return plan.project.documents[0]!.annotations.filter(
          (annotation) => annotation.kind === "instance-label",
        );
      };
      const own = await labels(exported.request);
      expect(own.length).toBeGreaterThan(0);
      for (const label of own) {
        expect(label.sizeScale).toBe(0.6616);
        expect(label.textColor).toBe("#aa3300");
      }
      // The same file as another tool writes it.
      const foreign = await labels({
        ...withoutCanvasMeaning(exported.request),
        ops: withoutCanvasMeaning(exported.request).ops.filter(
          (op) =>
            !(
              op.op === "use-package" && op.name === "analog-canvas-extensions"
            ),
        ),
      });
      expect(foreign.length).toBe(own.length);
      for (const label of foreign) {
        expect(label.sizeScale).toBeUndefined();
        expect(label.textColor).toBeUndefined();
        expect(label.formatOverride).toBeUndefined();
      }
    },
  );
});

describe("legacy controlled-source diamond symbols", () => {
  it.each([
    ["spice", CONTROLLED_SOURCE_KINDS],
    ["spectre", ["vcvs", "vccs"]],
  ] as const)(
    "imports the old aliases as diamonds (%s)",
    async (format, kinds) => {
      const project = withImportedInstanceDisplays(controlledSources(kinds));
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready") throw new Error("export blocked");
      const standard = new Set(kinds.map((kind) => `$${kind.toUpperCase()}`));
      // A file Analog Canvas wrote with Canvas 0.1.
      const old = withoutCanvasMeaning(exported.request);
      const written = await runtime.write({
        write: {
          ...old,
          ops: [
            ...old.ops.flatMap((op) =>
              op.op === "set" && op.symbol && standard.has(op.symbol)
                ? [{ ...op, symbol: `$CANVAS_${op.symbol.slice(1)}_DIAMOND` }]
                : op.op === "use-package" &&
                    op.name === "analog-canvas-extensions"
                  ? []
                  : [op],
            ),
            {
              op: "use-package",
              level: "subckt:dut",
              name: "analog-canvas-extensions",
              version: "0.1",
            },
          ],
        },
        svg: false,
      });
      for (const kind of kinds)
        expect(written.text).toContain(
          `@SET-SYMBOL $CANVAS_${kind.toUpperCase()}_DIAMOND`,
        );
      const plan = await importRnl(written.text, format);
      expect(failures(plan)).toEqual([]);
      const sources = plan.project.documents
        .flatMap((document) => document.instances)
        .filter((part) => kinds.some((kind) => kind === part.symbolId));
      expect(sources).toHaveLength(kinds.length);
      for (const part of sources) {
        expect(part.symbolVariantId).toBe("diamond");
        const original = project.documents[0]!.instances.find(
          (instance) => instance.reference === part.reference,
        );
        if (!original) throw new Error("original source missing");
        expect(rnlPart(part)).toEqual(rnlPart(original));
      }
      const reexported = createRnlExport(plan.project, { format });
      if (reexported.status !== "ready") throw new Error("re-export blocked");
      const rewritten = await runtime.write({
        write: reexported.request,
        svg: false,
      });
      expect(rewritten.text).not.toContain("@SET-SYMBOL $CANVAS_");
      for (const kind of kinds)
        expect(rewritten.text).toContain(`@SET-SYMBOL $${kind.toUpperCase()}`);
      expect(
        labelDifferences(labelCensus(project), labelCensus(plan.project)),
      ).toEqual([]);
      const before = createDesignNetlistExport(project, { format });
      const after = createDesignNetlistExport(plan.project, { format });
      expect(after.status === "ready" && after.file.text).toBe(
        before.status === "ready" && before.file.text,
      );
    },
  );
});

/**
 * What a drawing must keep through RNL, Cell by Cell: its parts by kind (the
 * two op-amp variants RNL draws alike count as one), its junctions, the pins
 * its wires reach by part kind and pin, its wires by how they are drawn, and
 * its net and power labels.
 */
function drawingCensus(project: CircuitProject) {
  const kind = (symbolId: string) =>
    symbolId === "opamp-inputs-swapped" ? "opamp" : symbolId;
  const tally = (keys: readonly string[]) => {
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts].sort().map(([key, count]) => `${key}:${count}`);
  };
  return Object.fromEntries(
    project.documents.map((document) => {
      const symbolOf = new Map(
        document.instances.map((instance) => [
          instance.id,
          kind(instance.symbolId),
        ]),
      );
      const reached = document.routes.flatMap((route) =>
        [
          route.start,
          ...route.legs.flatMap((leg) =>
            leg.to.kind === "endpoint" ? [leg.to.endpoint] : [],
          ),
        ].flatMap((endpoint) =>
          endpoint.kind === "terminal"
            ? [`${symbolOf.get(endpoint.instanceId)}.${endpoint.pinName}`]
            : [],
        ),
      );
      return [
        (document.netlist?.name ?? document.name).toLowerCase(),
        {
          parts: tally(
            document.instances.map((instance) => kind(instance.symbolId)),
          ),
          junctions: document.junctions.length,
          wiredPins: tally(reached),
          // Each wire as drawn, a power rail as a rail; a wire through a
          // junction stays one wire.
          wires: tally(
            document.routes.map((route) => route.presentation ?? "wire"),
          ),
          labels: tally(
            document.annotations
              .filter(
                (annotation) =>
                  annotation.kind === "net-label" ||
                  annotation.kind === "power-label",
              )
              .map((annotation) => annotation.kind),
          ),
        },
      ];
    }),
  );
}

/**
 * How a reader comes to an example under a process: opened under it, or
 * opened under the default SKY130 and then switched in the Netlist panel,
 * whose Process select rebinds every device (planNetlistProcess).
 */
const openings = ["sky130", "abstract", "sky130 then abstract"] as const;

function openedExample(name: string, opening: (typeof openings)[number]) {
  const profiles = createDefaultNetlistExportPreferences().profiles;
  if (opening !== "sky130 then abstract")
    return prepareNetlistExample(example(name), profiles[opening]);
  const opened = prepareNetlistExample(example(name), profiles.sky130);
  const edits = planNetlistProcess(opened, profiles.abstract);
  if (!edits.length) return opened;
  const switched = executeProjectTransaction(opened, {
    transactionId: "switch-netlist-process",
    projectId: opened.id,
    expectedStructureRevision: opened.structureRevision,
    actor: { kind: "human", id: "netlist-process" },
    edits,
  });
  if (!switched.ok) throw new Error(switched.error.message);
  return switched.project;
}

describe("RNL round trip of examples as the editor opens them", () => {
  it("writes a Project the SPICE import brought in as Spectre the import reads again", async () => {
    // The SPICE import keeps a source's value as written (VINP's AC and
    // PULSE in its dc text); Spectre must print it in Spectre's own terms.
    const project = prepareNetlistExample(
      example("five-transistor-ota-sky130"),
      createDefaultNetlistExportPreferences().profiles.sky130,
    );
    const fromSpice = await roundTrip(project, "spice");
    const again = await roundTrip(fromSpice.project, "spectre");
    expect(failures(again)).toEqual([]);
    const spectre = createDesignNetlistExport(again.project, {
      format: "spectre",
    });
    expect(spectre.status === "ready" && spectre.file.text).toMatch(
      /^VINP \(.*\) vsource type=pulse val0=0\.9 val1=0\.91 /mu,
    );
  });

  // The editor binds an example's devices to the chosen process when it
  // opens one (prepareNetlistExample); these examples print only then, and
  // draw copied ground glyphs, SKY130 subcircuit MOS, Abstract's NMOS and
  // PMOS (on their stand-in cards) and nets named Vin+.
  it.each(
    [
      "common-source-amplifier",
      "current-mirror-loaded-differential-pair",
      "fully-differential-two-stage-op-amp",
      "simulation-common-source",
      "two-stage-op-amp",
      "five-transistor-ota-sky130",
    ].flatMap((name) =>
      openings.flatMap((opening) => [
        [name, opening, "spice"] as const,
        [name, opening, "spectre"] as const,
      ]),
    ),
  )(
    "brings %s (%s, %s) back with every part, ground, wire, junction and label",
    async (name, opening, format) => {
      const project = openedExample(name, opening);
      const exported = createRnlExport(project, { format });
      if (exported.status !== "ready") throw new Error("export blocked");
      // Nothing the drawing shows is left out of the file.
      expect(
        exported.diagnostics
          .filter((item) =>
            ["RNL_GLYPH_UNCONNECTED", "RNL_WIRE_UNNAMED"].includes(item.code),
          )
          .map((item) => item.message),
      ).toEqual([]);
      const written = await runtime.write({
        write: exported.request,
        svg: false,
      });
      const plan = await importRnl(written.text, format);
      expect(
        plan.diagnostics
          .filter((item) => item.severity !== "info")
          .map((item) => `${item.code}: ${item.message}`),
      ).toEqual([]);
      // The editor takes the Project in as it takes any: valid, with its
      // MOS bulk defaults made explicit.
      expect(parseProject(JSON.stringify(plan.project))).toBeTruthy();
      expect(() =>
        materializeRazaviProjectBulkConnections(plan.project),
      ).not.toThrow();
      const before = drawingCensus(project);
      const after = drawingCensus(plan.project);
      for (const cell of cardNames(project).map((item) =>
        item.cell.toLowerCase(),
      ))
        expect(after[cell], cell).toEqual(before[cell]);
      expect(
        labelDifferences(labelCensus(project), labelCensus(plan.project)),
      ).toEqual([]);
      // ... and the file brings back no Cell the drawing did not have.
      expect(Object.keys(after).length).toBeGreaterThan(0);
      for (const [cell, census] of Object.entries(after))
        expect(census, cell).toEqual(before[cell]);
    },
  );
});

// #1933: a SPICE model library the Spectre conversion refuses goes into the
// Spectre netlist as SPICE, and reads back as the library it is.
it.each(["spice", "spectre"] as const)(
  "brings back a SPICE model library Spectre conversion refuses, through %s+RNL",
  async (format) => {
    const project = externalModelFixture();
    const plan = await roundTrip(project, format);
    expect(failures(plan)).toEqual([]);
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    const before = createDesignNetlistExport(project, { format: "spice" });
    const after = createDesignNetlistExport(plan.project, { format: "spice" });
    expect(after.status === "ready" && after.file.text).toBe(
      before.status === "ready" && before.file.text,
    );
  },
);

/**
 * delayCellFixture with a second Cell b that draws a Library inverter X1,
 * its rails unwired: the call in dut is X1 too, or named apart.
 */
function sameIdInAnotherCell(sameId: boolean): CircuitProject {
  const project = delayCellFixture(true);
  const top = project.documents[0]!;
  const call = top.instances[0]!;
  call.symbolId = hierarchicalSymbolId("delay_cmos");
  if (!sameId) {
    call.id = "Xother";
    call.reference = "Xother";
    for (const net of top.nets)
      for (const terminal of net.terminals)
        if (terminal.instanceId === "X1") terminal.instanceId = "Xother";
  }
  const b = createEmptyDocument("b", "b");
  b.netlist!.name = "b";
  b.instances.push({
    id: "X1",
    reference: "X1",
    symbolId: "inverter",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: {
        kind: "unresolved-subcircuit",
        name: subcircuitDescriptor("inverter")!.target,
      },
      parameters: {},
    },
  });
  for (const [pin, name] of [
    ["A", "input"],
    ["Y", "output"],
  ] as const) {
    b.nets.push({ id: name, terminals: [{ instanceId: "X1", pinName: pin }] });
    b.connectivityEvidence.push({
      id: `name-${name}`,
      kind: "net-name-hint",
      netId: name,
      sourceName: name,
      origin: "spice-import",
    });
  }
  project.documents.push(b);
  return project;
}

it.each(["spice", "spectre"] as const)(
  "reads each Cell's pins by its own instances, whatever another Cell names alike, through %s+RNL (#1955)",
  async (format) => {
    const cellB = async (sameId: boolean) => {
      const plan = await roundTrip(sameIdInAnotherCell(sameId), format);
      const b = plan.project.documents.find(
        (document) => document.netlist?.name === "b",
      )!;
      return {
        instances: b.instances.map(({ id, symbolId, placement }) => ({
          id,
          symbolId,
          placement,
        })),
        interfaces: b.netlist!.terminals.map((terminal) => ({
          name: terminal.name,
          instanceIds: terminal.interfaceInstanceIds,
          annotationId: terminal.interfaceAnnotationId,
        })),
      };
    };
    const apart = await cellB(false);
    // b draws no Cell Pin: the VDD and VSS its inverter's unwired rails
    // print go again, as for any Cell (#1787), whether or not dut's call is
    // X1 too.
    expect(apart.interfaces).toEqual([]);
    expect(await cellB(true)).toEqual(apart);
  },
);
