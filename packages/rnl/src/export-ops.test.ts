import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { subcircuitDescriptor } from "@icm/devices";
import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
} from "@icm/derived";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

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
        of(ops, "add-usage").filter((op) => op.definition === "$GND"),
      ).toHaveLength(grounds.length);
    },
  );

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
      (item) => item.definition === "$GND",
    ))
      expect(op.attach).toEqual({ p: "&VSS" });
    expect(of(ops, "remove-from")).toEqual([
      expect.objectContaining({
        items: ["&VSS"],
        set: "$PORT_FILL_SET",
      }),
    ]);
  });

  it("wires a drawn Cell's block by its printed port positions, in a stand-in box", () => {
    const { ops, diagnostics } = exported(example("simulation-ota"));
    expect(diagnostics.map((item) => item.code)).toEqual([
      "RNL_BLOCK_STAND_IN",
    ]);
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
      "$NMOS4",
    );
  });

  it("warns of a symbol from the analog-canvas package and uses that package", () => {
    const project = createEmptyProject("lettered", "Lettered", "dut");
    const document = project.documents[0]!;
    document.netlist!.name = "dut";
    const descriptor = subcircuitDescriptor("opamp-lettered")!;
    document.instances.push({
      id: "block",
      symbolId: "opamp-lettered",
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
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "RNL_NOT_STANDARD_SYMBOL",
        objectIds: ["block"],
      }),
    );
    expect(of(ops, "set")).toContainEqual(
      expect.objectContaining({
        object: "#X1",
        symbol: "$AC_OPAMP_LETTERED",
        at: [10, 0],
      }),
    );
    expect(of(ops, "use-package").map((op) => op.name)).toEqual([
      "analog-canvas",
    ]);
  });
});
