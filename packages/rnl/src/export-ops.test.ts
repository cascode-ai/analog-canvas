import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { subcircuitDescriptor } from "@icm/devices";
import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
} from "@icm/derived";
import {
  createEmptyProject,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  externalSubcircuitSymbolId,
} from "@icm/symbols";

import { rnlExportOps, type RnlOp, type RnlVertex } from "./export-ops.js";
import { rnlBodyPortOrder } from "./symbol-map.js";

const example = (name: string): CircuitProject =>
  parseProject(
    readFileSync(
      resolve(process.cwd(), `apps/editor/src/examples/${name}.icproj.json`),
      "utf8",
    ),
  );

function exported(project: CircuitProject) {
  const result = createDesignNetlistExport(project, {
    bodyPortOrder: rnlBodyPortOrder(project),
    includeIr: true,
  });
  if (result.status !== "ready")
    throw new Error(JSON.stringify(result.diagnostics));
  // The netlist holds the root Cell and what it calls; so does the RNL.
  const printed = new Set(result.ir!.cells.map((cell) => cell.id));
  return {
    text: result.file.text,
    documents: project.documents.filter((document) => printed.has(document.id)),
    ...rnlExportOps(project, result.ir!),
  };
}

type Op<K extends RnlOp["op"]> = Extract<RnlOp, { op: K }>;
const of = <K extends RnlOp["op"]>(ops: readonly RnlOp[], kind: K) =>
  ops.filter((op): op is Op<K> => op.op === kind);

const EXAMPLES = [
  "simulation-common-source",
  "simulation-rc",
  "simulation-rlc",
  "simulation-ota",
  "five-transistor-ota-sky130",
];

describe("RNL export of the simulation examples", () => {
  it.each(EXAMPLES)(
    "draws every part, glyph and wire of %s, naming only what it declares",
    (name) => {
      const project = example(name);
      const { ops, diagnostics, text, documents } = exported(project);
      expect(diagnostics.filter((item) => item.severity === "error")).toEqual(
        [],
      );
      // Their symbols all come with rnl-std: the file pins it, clears the
      // symbols' own labels and names no other package.
      expect(
        of(ops, "use-package").map(({ name, version }) => `${name} ${version}`),
      ).toEqual(["rnl-std 0.3", "rnl-std-no-labels 0.3"]);
      const wires = of(ops, "add-wire");
      const routes = documents.flatMap((document) => document.routes);
      expect(wires.length).toBeGreaterThanOrEqual(routes.length);
      const levelOf = new Map<string, Set<string>>();
      const declare = (level: string, name: string) => {
        if (!levelOf.has(level)) levelOf.set(level, new Set());
        levelOf.get(level)!.add(name);
      };
      for (const op of of(ops, "set")) declare(op.level, op.object);
      for (const op of of(ops, "add-usage")) declare(op.level, op.name);
      for (const op of of(ops, "add-point")) declare(op.level, op.name);
      const known = (level: string, vertex: RnlVertex) =>
        "terminal" in vertex
          ? levelOf.get(level)!.has(vertex.terminal.split(":")[0]!)
          : "point" in vertex
            ? levelOf.get(level)!.has(vertex.point)
            : "usage" in vertex
              ? levelOf.get(level)!.has(vertex.usage)
              : true;
      for (const wire of wires) {
        expect(wire.via.length).toBeGreaterThanOrEqual(2);
        for (const vertex of wire.via)
          expect(known(wire.level, vertex), JSON.stringify(vertex)).toBe(true);
        for (const net of wire.nets)
          expect(text).toMatch(new RegExp(`[ (]${net.slice(1)}[ )\n]`));
      }
      const grounds = documents.flatMap((document) =>
        document.instances.filter((instance) => instance.symbolId === "ground"),
      );
      expect(
        of(ops, "add-usage").filter((op) => op.definition === "$GROUND"),
      ).toHaveLength(grounds.length);
      for (const label of of(ops, "add-text")) {
        // A part's or glyph's label hangs on something declared, by key and
        // offset; a net's stands at an absolute place; a free text on its point.
        if (label.attach?.startsWith("&")) {
          expect(label.at).toBeDefined();
          expect(label.key).toBeUndefined();
        } else if (label.attach) {
          expect(levelOf.get(label.level)!.has(label.attach)).toBe(true);
          expect(label.offset).toBeDefined();
        } else expect(label.at).toBeDefined();
        expect(label.lines.flat().length).toBeGreaterThan(0);
      }
    },
  );

  it("hangs a part's labels on it by key, where Analog Canvas shows them", () => {
    const { ops, diagnostics } = exported(example("simulation-common-source"));
    const place = of(ops, "set").find((op) => op.object === "#XM1")!.at!;
    const name = of(ops, "add-text").find(
      (op) => op.attach === "#XM1" && op.key === "name",
    )!;
    const value = of(ops, "add-text").find(
      (op) => op.attach === "#XM1" && op.key === "value",
    )!;
    expect(name.size).toBeGreaterThan(1);
    expect(
      name.lines.flat().map((run) => run.kind === "text" && run.text),
    ).toEqual(["XM1"]);
    // W over L, as the value label draws it.
    expect(value.lines[0]![0]!.kind).toBe("frac");
    expect(place).toEqual([35, -40]);
    expect(name.offset).toEqual([-4, -3]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "RNL_TEXT_FIXED",
      }),
    );
  });

  it("puts a net's label on the net at its place, and leaves hidden labels out", () => {
    const { ops, diagnostics } = exported(example("simulation-rlc"));
    expect(of(ops, "add-text")).toContainEqual(
      expect.objectContaining({ attach: "&out", at: expect.any(Array) }),
    );
    expect(diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["RNL_TEXT_HIDDEN", "RNL_TEXT_ALONG_WIRE"]),
    );
    // One warning per kind and drawing, naming every object it covers.
    const hidden = diagnostics.find((item) => item.code === "RNL_TEXT_HIDDEN")!;
    expect(hidden.objectIds).toHaveLength(2);
    expect(hidden.message).toMatch(/^2 /);
  });

  it("joins a wire that runs through a junction there, and dots it", () => {
    const project = example("simulation-common-source");
    const { ops } = exported(project);
    const source = of(ops, "add-wire").find(
      (wire) => "terminal" in wire.via[0]! && wire.via[0].terminal === "#XM1:3",
    )!;
    expect(source.via).toEqual([
      { terminal: "#XM1:3" },
      { point: expect.stringMatching(/^%j/) },
      { usage: expect.stringMatching(/^%gnd/), role: "p" },
    ]);
    const through = (source.via[1] as { point: string }).point;
    expect(of(ops, "add-point").find((op) => op.name === through)).toEqual(
      expect.objectContaining({ junction: true }),
    );
  });

  it("dots exactly the contacts Analog Canvas dots", () => {
    for (const name of EXAMPLES) {
      const project = example(name);
      const { ops, documents } = exported(project);
      const resolver = createProjectSymbolResolver(project, builtInSymbols);
      const dots = documents.flatMap((document) =>
        deriveDocumentContactEvidence(document, resolver).contacts.filter(
          contactRequiresJunctionDot,
        ),
      );
      const written =
        of(ops, "add-point").filter((op) => op.junction).length +
        of(ops, "add-usage").filter((op) => op.definition === "$JUNCTION")
          .length;
      expect(written, name).toBe(dots.length);
    }
  });

  it("joins parts that touch with a wire of no length", () => {
    const { ops } = exported(example("simulation-common-source"));
    expect(of(ops, "add-wire")).toContainEqual(
      expect.objectContaining({
        nets: ["&VSS"],
        via: [
          { terminal: "#CL:2" },
          { usage: expect.stringMatching(/^%gnd/), role: "p" },
        ],
      }),
    );
  });

  it("draws ground on the Cell's ground pin and keeps a port tag off it", () => {
    const { ops } = exported(example("simulation-common-source"));
    for (const op of of(ops, "add-usage").filter(
      (item) => item.definition === "$GROUND",
    ))
      expect(op.attach).toEqual({ p: "&VSS" });
    expect(of(ops, "remove-from")).toEqual([
      expect.objectContaining({
        items: ["&VSS"],
        set: "$PORT_FILL_SET",
      }),
    ]);
  });

  it("wires a drawn Cell's block by its printed port positions", () => {
    const { ops, diagnostics } = exported(example("simulation-ota"));
    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const block = of(ops, "set").find((op) => op.object === "#XDUT")!;
    expect(block.symbol).toBeUndefined();
    const reached = of(ops, "add-wire").flatMap((wire) =>
      wire.via.flatMap((vertex) =>
        "terminal" in vertex && vertex.terminal.startsWith("#XDUT:")
          ? [Number(vertex.terminal.split(":")[1])]
          : [],
      ),
    );
    expect(new Set(reached)).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });
});

describe("what RNL cannot write", () => {
  it("refuses a part turned by 45°", () => {
    const project = example("simulation-rc");
    const part = project.documents[0]!.instances.find(
      (instance) => instance.placement && instance.symbolId === "resistor",
    )!;
    part.placement!.rotation = 45;
    const { ops, diagnostics } = exported(project);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "RNL_ROTATION_NOT_QUARTER",
        objectIds: [part.id],
      }),
    );
    expect(
      of(ops, "set").find((op) => op.object === `#${part.reference}`),
    ).toBeUndefined();
  });

  it("warns of a part off the drawing and places nothing for it", () => {
    const project = example("simulation-rc");
    const part = project.documents[0]!.instances.find(
      (instance) => instance.placement && instance.symbolId === "resistor",
    )!;
    part.placement = null;
    const { ops, diagnostics } = exported(project);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "RNL_NOT_PLACED" }),
    );
    expect(
      of(ops, "set").find((op) => op.object === `#${part.reference}`),
    ).toEqual(expect.not.objectContaining({ at: expect.anything() }));
  });

  it("draws a three-terminal MOS whole when a wire reaches its hidden bulk", () => {
    const project = example("simulation-common-source");
    const mos = project.documents[0]!.instances.find(
      (instance) => instance.id === "XM1",
    )!;
    mos.symbolVariantId = "textbook-3terminal";
    const { ops, diagnostics } = exported(project);
    expect(diagnostics.map((item) => item.code)).toContain(
      "RNL_HIDDEN_PIN_WIRED",
    );
    expect(of(ops, "set").find((op) => op.object === "#XM1")?.symbol).toBe(
      "$NMOS_4TERM",
    );
  });

  it.each([
    ["opamp", "$OPAMP_5TERM", "rnl-std-functional 0.3", false],
    [
      "opamp-lettered",
      "$CANVAS_OPAMP_LETTERED",
      "analog-canvas-extensions 0.1",
      true,
    ],
  ] as const)(
    "declares the package of %s's symbol %s, %s, and warns only of a non-standard one",
    (symbolId, symbol, pinned, nonStandard) => {
      const project = createEmptyProject("block", "Block", "dut");
      const document = project.documents[0]!;
      document.netlist!.name = "dut";
      const descriptor = subcircuitDescriptor(symbolId)!;
      document.instances.push({
        id: "block",
        symbolId,
        reference: "X1",
        placement: {
          position: { x: 100, y: 0 },
          rotation: 0,
          mirror: "none",
        },
        netlist: {
          binding: { kind: "unresolved-subcircuit", name: descriptor.target },
          parameters: {},
        },
      });
      for (const port of descriptor.ports.filter((item) => !item.supply)) {
        const id = `pin-${port.name}`;
        document.instances.push({ id, symbolId: "port", placement: null });
        document.nets.push({
          id: port.name,
          terminals: [
            { instanceId: id, pinName: "P" },
            { instanceId: "block", pinName: port.pinName ?? port.name },
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
      const { ops, diagnostics } = exported(project);
      expect(
        diagnostics.filter((item) => item.code === "RNL_NOT_STANDARD_SYMBOL"),
      ).toEqual(
        nonStandard
          ? [
              expect.objectContaining({
                severity: "warning",
                objectIds: ["block"],
              }),
            ]
          : [],
      );
      expect(of(ops, "set")).toContainEqual(
        // Both draw − on top: the + on top symbol, flipped.
        expect.objectContaining({
          object: "#X1",
          symbol,
          at: [10, 0],
          orient: "MX",
        }),
      );
      expect(
        of(ops, "use-package").map(({ name, version }) => `${name} ${version}`),
      ).toEqual(["rnl-std 0.3", "rnl-std-no-labels 0.3", pinned]);
    },
  );
});

describe("blocks' symbols", () => {
  it("defines a drawn Cell's block in its own level, its pins on the printed ports", () => {
    const { ops, diagnostics } = exported(example("simulation-ota"));
    expect(diagnostics.map((item) => item.code)).not.toContain(
      "RNL_BLOCK_STAND_IN",
    );
    const symbol = of(ops, "define-symbol").find(
      (op) => op.level === "subckt:ota_5t",
    )!;
    expect(symbol.name).toBe("%ota_5t_SYMBOL");
    expect(symbol.box).toEqual([-8, -7, 8, 7]);
    expect(
      symbol.pins.map((pin) => [pin.terminals, pin.at, pin.direction]),
    ).toContainEqual([["vout"], [8, 0], "right"]);
    expect(symbol.pins[0]!.label?.lines[0]![0]).toMatchObject({ text: "vss" });
    expect(symbol.prims[0]).toEqual({
      shape: "rectangle",
      points: [[0, 0]],
      params: { width: 14, height: 12 },
    });
    expect(of(ops, "set")).toContainEqual({
      level: "subckt:ota_5t",
      op: "set",
      object: "#",
      symbol: "%ota_5t_SYMBOL",
    });
    // Each call takes the Cell's own look.
    expect(
      of(ops, "set").find((op) => op.object === "#XDUT")?.symbol,
    ).toBeUndefined();
  });

  it("defines an external block once in the file level and sets it on each call, by port number", () => {
    const project = example("simulation-ota");
    const cell = project.documents.find((item) => item.name === "ota_5t")!;
    for (const id of ["M1", "M2"]) {
      const mos = cell.instances.find((instance) => instance.id === id)!;
      const binding = mos.netlist!.binding;
      if (binding?.kind !== "external-subcircuit") throw new Error(id);
      mos.symbolId = externalSubcircuitSymbolId(binding.definitionId);
    }
    const { ops } = exported(project);
    const files = of(ops, "define-symbol").filter((op) => op.level === "file");
    expect(files.map((op) => op.name)).toEqual([
      "$sky130_fd_pr__nfet_01v8_SYMBOL",
    ]);
    expect(files[0]!.pins.map((pin) => pin.terminals)).toEqual([
      [1],
      [2],
      [3],
      [4],
    ]);
    for (const id of ["#XM1", "#XM2"])
      expect(of(ops, "set").find((op) => op.object === id)?.symbol).toBe(
        "$sky130_fd_pr__nfet_01v8_SYMBOL",
      );
  });
});

/** The RC example with one drawing object of each kind, and marks on its wires. */
function drawings(): CircuitProject {
  const project = example("simulation-rc");
  const document = project.documents.find(
    (item) => item.id === project.topDocumentId,
  )!;
  const free = (x: number, y: number) =>
    ({ kind: "free", position: { x, y } }) as const;
  const base = (id: string, zIndex: number, x = 0, y = 0) => ({
    id,
    locked: false,
    zIndex,
    anchor: free(x, y),
  });
  const text = (value: string) => ({
    runs: [{ kind: "text" as const, value }],
  });
  const objects: NonNullable<SchematicDocument["drafting"]>["objects"] = [
    {
      ...base("back", 0),
      kind: "rectangle",
      center: { x: 500, y: -150 },
      width: 160,
      height: 80,
      rotation: 0,
      lineStyle: "solid",
      layer: "background",
      styleOverride: { fillColor: "#eef4ff" },
    },
    {
      ...base("turned", 1),
      kind: "rectangle",
      center: { x: 700, y: -150 },
      width: 80,
      height: 40,
      rotation: 90,
      lineStyle: "dashed",
    },
    {
      ...base("slanted", 2),
      kind: "rectangle",
      center: { x: 860, y: -150 },
      width: 80,
      height: 40,
      rotation: 30,
      lineStyle: "solid",
    },
    {
      ...base("circle", 3),
      kind: "circle",
      center: { x: 1000, y: -150 },
      radius: 30,
      lineStyle: "dotted",
      styleOverride: { color: "#cc0000" },
    },
    {
      ...base("curve", 4),
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
      ...base("arrow", 5),
      kind: "arrow",
      from: free(400, -400),
      to: free(560, -400),
      styleOverride: { arrowEnd: "medium-arrow" },
    },
    {
      ...base("ends", 6),
      kind: "arrow",
      from: free(400, -460),
      to: free(560, -460),
      styleOverride: { arrowStart: "dot", arrowEnd: "open-arrow" },
    },
    {
      ...base("hollow", 7),
      kind: "arrow",
      from: free(820, -430),
      to: free(960, -430),
      outline: { width: 20 },
    },
    {
      ...base("leader", 8, 400, -520),
      kind: "leader",
      target: free(480, -560),
    },
    {
      ...base("callout", 9, 600, -540),
      kind: "callout",
      content: text("Load"),
      alignment: "start",
      rotation: 0,
      target: free(700, -580),
    },
    {
      ...base("both", 10, 860, -540),
      kind: "text",
      content: text("Vx"),
      alignment: "middle",
      rotation: 0,
      polarity: "both",
    },
    {
      ...base("plus", 11, 940, -540),
      kind: "text",
      content: text("unseen"),
      alignment: "middle",
      rotation: 0,
      polarity: "positive",
    },
    {
      ...base("figure", 12, 1100, -300),
      kind: "floating-symbol",
      symbolId: "resistor",
      transform: { rotation: 90, mirror: "none" },
    },
  ];
  document.drafting = { objects };
  const [first, second] = document.routes;
  first!.styleOverride = { arrow: "middle" };
  second!.styleOverride = { arrow: "end" };
  const marker = (id: string, markerKind: "current" | "voltage") => ({
    id,
    kind: "route-marker" as const,
    content: text(markerKind === "current" ? "I1" : "V1"),
    anchor: {
      kind: "route" as const,
      routeId: first!.id,
      legId: first!.legs[0]!.id,
      t: 0.5,
      normalOffset: -14,
      direction: "forward" as const,
      orientation: "follow" as const,
      fallbackPosition: { x: 0, y: 0 },
    },
    alignment: "middle" as const,
    rotation: 0 as const,
    locked: false,
    markerKind,
  });
  document.annotations.push(
    marker("current", "current"),
    marker("voltage", "voltage"),
  );
  return project;
}

const firstText = (op: Op<"add-text">) => {
  const run = op.lines[0]?.[0];
  return run?.kind === "text" ? run.text : undefined;
};

describe("drawing objects", () => {
  it("draws each object as its RNL shapes, stacked as Analog Canvas stacks them", () => {
    const { ops, diagnostics } = exported(drawings());
    expect(diagnostics.map((item) => item.code)).not.toContain(
      "RNL_DRAWING_NOT_EXPORTED",
    );
    const shapes = of(ops, "add-shape");
    expect(shapes[0]).toMatchObject({
      shape: "rectangle",
      layer: "bottom",
      points: [[50, 15]],
      params: { width: 16, height: 8, fill: "fillcolor" },
      style: { fillcolor: "#eef4ff" },
    });
    expect(shapes[1]).toMatchObject({
      shape: "rectangle",
      layer: "top",
      params: { width: 4, height: 8 },
      style: { linestyle: "dashed" },
    });
    expect(shapes[2]).toMatchObject({ shape: "line" });
    expect(shapes[2]!.points).toHaveLength(5);
    expect(shapes[3]).toMatchObject({
      shape: "circle",
      params: { radius: 3 },
      style: { linestyle: "dotted", linecolor: "#cc0000" },
    });
    expect(shapes[4]).toMatchObject({ shape: "bezier" });
    expect(shapes[5]).toMatchObject({
      shape: "line",
      points: [
        [40, 40],
        [56, 40],
      ],
      params: { arrow: "end" },
    });
    // A dot is a filled circle; an open head is its outline, the shaft ending at its base.
    const ends = shapes.slice(6, 9);
    expect(ends.map((shape) => shape.shape)).toEqual([
      "line",
      "line",
      "circle",
    ]);
    expect(ends[0]!.params).toBeUndefined();
    expect(ends[2]).toMatchObject({
      points: [[40, 46]],
      params: { fill: "linecolor" },
    });
    expect(shapes[9]).toMatchObject({ shape: "line" });
    expect(shapes[9]!.points.at(-1)).toEqual(shapes[9]!.points[0]);
    expect(
      shapes
        .slice(10, 12)
        .map((shape) => shape.points.map((point) => point.join(","))),
    ).toEqual([
      ["40,52", "48,56"],
      ["60,54", "70,58"],
    ]);
    // + is two strokes and − one, around the words; a one-sided + has its own two.
    expect(shapes.slice(12)).toHaveLength(5);
    const texts = of(ops, "add-text");
    expect(texts).toContainEqual(
      expect.objectContaining({ at: [60, 54], style: { bold: true } }),
    );
    expect(texts.find((op) => firstText(op) === "Load")?.at).toEqual([60, 54]);
    expect(texts.find((op) => firstText(op) === "Vx")).toMatchObject({
      at: [86, 54],
      valign: "middle",
    });
    expect(texts.find((op) => firstText(op) === "unseen")).toBeUndefined();
    expect(of(ops, "add-usage")).toContainEqual(
      expect.objectContaining({
        definition: "$FIGURE",
        attach: { p: [110, 30] },
        symbol: "$RESISTOR",
        orient: "R270",
      }),
    );
  });

  it("puts current and voltage marks and wire arrows on the wires", () => {
    const { ops, diagnostics } = exported(drawings());
    expect(diagnostics.map((item) => item.code)).not.toContain(
      "RNL_WIRE_ARROW",
    );
    const usages = of(ops, "add-usage");
    const arrows = usages.filter((op) => op.definition === "$ARROW");
    expect(arrows.map((op) => op.orient ?? "R0")).toEqual(["R0", "R270"]);
    const current = usages.find((op) => op.definition === "$CURRENT_ARROW")!;
    expect(current.orient).toBe("R90");
    const label = of(ops, "add-text").find((op) => firstText(op) === "I1");
    expect(label).toMatchObject({ attach: current.name, halign: "middle" });
    const signs = of(ops, "add-text").filter((op) =>
      ["+", "−"].includes(firstText(op) ?? ""),
    );
    expect(signs).toHaveLength(2);
  });

  it("leaves out a floating symbol with no RNL symbol, and says so", () => {
    const project = drawings();
    const document = project.documents.find(
      (item) => item.id === project.topDocumentId,
    )!;
    const figure = document.drafting!.objects.find(
      (object) => object.kind === "floating-symbol",
    )!;
    if (figure.kind === "floating-symbol") figure.symbolId = "no-such-symbol";
    const { ops, diagnostics } = exported(project);
    expect(
      of(ops, "add-usage").filter((op) => op.definition === "$FIGURE"),
    ).toEqual([]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "RNL_DRAWING_NOT_EXPORTED",
        objectIds: ["figure"],
      }),
    );
  });
});
