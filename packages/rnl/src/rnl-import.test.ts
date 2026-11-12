import {
  CircuitProjectSchema,
  createEmptyDocument,
  createEmptyProject,
} from "@icm/model";
import { describe, expect, it } from "vitest";
import { hierarchicalSymbolId } from "@icm/symbols";
import {
  applyRnlSnapshot,
  type RnlLevelSnapshot,
  type RnlSnapshot,
  type RnlObjectView,
} from "./index.js";

/** A snapshot value from no statement in particular. */
const slot = <T>(value: T | null) => ({ value, source: null });

function usage(
  definition: string,
  attach: Record<string, string>,
  params: Record<string, string | boolean> = {},
): RnlObjectView {
  return {
    id: `%${definition}-${JSON.stringify(params)}`,
    kind: "usage",
    host: [],
    definition,
    attach,
    params,
    symbol: slot(null),
    at: slot(null),
    orient: slot("R0"),
    pins: [],
  };
}

// Hand-authored inputs at the runtime snapshot boundary. The editor tests
// separately qualify parsing/writing real RNL; no export creates this oracle.
function fixture() {
  const project = createEmptyProject("rnl-import", "RNL import");
  project.documents = ["first", "second"].map((name) => {
    const document = createEmptyDocument(name, name);
    document.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: null,
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
      importProvenance: {
        kind: "primitive",
        sourceMasterName: "R",
        sourceTarget: "R",
        terminalMapping: [
          { sourcePosition: 0, pinName: "1" },
          { sourcePosition: 1, pinName: "2" },
        ],
      },
    });
    document.instances.push({ id: "PIN", symbolId: "port", placement: null });
    document.nets = [
      {
        id: "input",
        terminals: [
          { instanceId: "R1", pinName: "1" },
          { instanceId: "PIN", pinName: "P" },
        ],
      },
      { id: "ground", terminals: [{ instanceId: "R1", pinName: "2" }] },
    ];
    document.netlist!.terminals = [
      {
        id: "input-port",
        name: "IN",
        netId: "input",
        direction: "input",
        interfaceInstanceIds: ["PIN"],
      },
    ];
    document.importReference = {
      files: [],
      nets: [
        {
          id: "input",
          name: "IN",
          scope: "local",
          terminals: [{ instanceId: "R1", sourcePosition: 0 }],
        },
        {
          id: "ground",
          name: "GND",
          scope: "local",
          terminals: [{ instanceId: "R1", sourcePosition: 1 }],
        },
      ],
    };
    return document;
  });
  project.topDocumentId = "first";
  const level = (name: string, x: number, y: number): RnlLevelSnapshot => ({
    id: `subckt:${name}`,
    kind: "subckt",
    name,
    file: 0,
    line: 1,
    status: null,
    model: {
      symbol: slot(null),
      symbols: [
        {
          id: "$RESISTOR",
          name: "$RESISTOR",
          package: "rnl-std-basic",
          level: null,
          default: false,
          definition: null,
        },
      ],
      objects: [
        {
          id: "#R1",
          kind: "instance",
          host: ["#R1"],
          definition: null,
          attach: null,
          symbol: slot("$RESISTOR"),
          at: slot([x, y]),
          orient: slot("R0"),
          pins: [],
        },
      ],
      points: [{ id: "%end", at: slot([x, y - 6]), junction: true }],
      wires: [
        {
          id: "%wire",
          nets: ["&0"],
          via: [{ terminal: "#R1:2" }, { point: "%end" }],
          points: [
            [x, y - 2],
            [x, y - 6],
          ],
          mode: "straight",
          style: {},
        },
      ],
      texts: [],
      shapes: [],
    },
  });
  const snapshot: RnlSnapshot = {
    schema: "rnl-snapshot/1",
    runtime: "0.5.5",
    language: "0.3",
    revision: "0".repeat(32),
    dialect: "spice",
    files: [{ path: "/w/top.sp", name: "top.sp" }],
    packages: [{ name: "rnl-std-basic", version: "0.3" }],
    levels: [level("first", 2, 3), level("second", -4, 5)],
    diagnostics: [],
    failed: null,
  };
  return { project: CircuitProjectSchema.parse(project), snapshot };
}

describe("RNL snapshot import", () => {
  it("keeps Cell-local names, pin order and GND wiring independent of level order (#1784)", () => {
    const { project, snapshot } = fixture();
    const source = structuredClone(project);
    const result = applyRnlSnapshot(project, snapshot);
    expect(() => CircuitProjectSchema.parse(result.project)).not.toThrow();
    expect(result.diagnostics).toEqual([]);
    expect(project).toEqual(source);
    expect(
      result.project.documents.map(
        (document) => document.instances[0]!.placement,
      ),
    ).toEqual([
      { position: { x: 20, y: -30 }, rotation: 0, mirror: "none" },
      { position: { x: -40, y: -50 }, rotation: 0, mirror: "none" },
    ]);
    for (const document of result.project.documents) {
      expect(document.nets).toEqual([
        {
          id: "input",
          terminals: [
            { instanceId: "R1", pinName: "1" },
            { instanceId: "PIN", pinName: "P" },
          ],
        },
        { id: "ground", terminals: [{ instanceId: "R1", pinName: "2" }] },
      ]);
      expect(document.netlist!.terminals).toEqual([
        {
          id: "input-port",
          name: "IN",
          netId: "input",
          direction: "input",
          interfaceInstanceIds: ["PIN"],
        },
      ]);
      expect(document.routes).toHaveLength(1);
      expect(document.routes[0]).toMatchObject({
        netId: "ground",
        start: { kind: "terminal", instanceId: "R1", pinName: "2" },
      });
      expect(document.junctions).toHaveLength(1);
      expect(document.junctions[0]).toMatchObject({
        netId: "ground",
        position:
          document.id === "first" ? { x: 20, y: 30 } : { x: -40, y: 10 },
      });
      expect(document.instances[0]!.netlist).toEqual({
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      });
    }
    const reversed = applyRnlSnapshot(project, {
      ...snapshot,
      levels: [...snapshot.levels].reverse(),
    });
    expect(reversed.diagnostics).toEqual([]);
    expect(reversed.project).toEqual(result.project);
  });

  it("rejects an unreadable snapshot without changing the circuit", () => {
    const { project, snapshot } = fixture();
    const before = structuredClone(project);
    const result = applyRnlSnapshot(project, {
      ...snapshot,
      failed: "invalid record",
    });
    expect(result.project).toEqual(before);
    expect(project).toEqual(before);
    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        code: "RNL_IMPORT_UNREADABLE",
        message: "RNL could not read the file: invalid record",
      },
    ]);
  });

  it("keeps the imported device and its electrical data when artwork is unknown", () => {
    const { project, snapshot } = fixture();
    snapshot.levels[0]!.model!.symbols[0]!.name = "$UNRECOGNIZED";
    const result = applyRnlSnapshot(project, snapshot);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "RNL_IMPORT_UNMAPPED_SYMBOL",
        documentId: "first",
      }),
    ]);
    expect(result.project.documents[0]!.instances[0]).toMatchObject({
      symbolId: "resistor",
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    });
    expect(result.project.documents[0]!.nets).toEqual(
      project.documents[0]!.nets,
    );
  });

  it("restores authored references and Cell typesetting without changing device parameters (#1785)", () => {
    const { project, snapshot } = fixture();
    const level = snapshot.levels[0]!;
    level.model!.objects = [
      ...level.model!.objects,
      usage("$CANVAS_NAME", { part: "#R1" }, { name: "R_RENAMED" }),
      usage(
        "$CANVAS_TYPESETTING",
        { level: "#" },
        {
          subscript_italic: false,
          subscript_after_first: false,
          face: "serif",
          crossings: "hop",
        },
      ),
    ];
    const result = applyRnlSnapshot(project, snapshot);
    expect(result.diagnostics).toEqual([]);
    expect(result.project.documents[0]!.instances[0]).toMatchObject({
      reference: "R_RENAMED",
      netlist: { parameters: { value: "1k" } },
    });
    expect(result.project.documents[0]!.presentation).toMatchObject({
      labelSubscriptItalic: false,
      labelSubscriptAfterFirst: false,
      textFace: "serif",
      crossingStyle: "hop",
    });
    expect(result.project.documents[1]!.instances[0]!.reference).toBe("R1");
    expect(() => CircuitProjectSchema.parse(result.project)).not.toThrow();
  });

  it("keeps omitted labels hidden and a rectangle's authored line override (#1787)", () => {
    const { project, snapshot } = fixture();
    snapshot.levels[0]!.model!.shapes = [
      {
        id: "%box",
        layer: "top",
        shape: "rectangle",
        points: [[10, 10]],
        params: { width: 8, height: 4 },
        style: { linestyle: "dashed" },
      },
    ];
    const result = applyRnlSnapshot(project, snapshot);
    expect(result.diagnostics).toEqual([]);
    expect(result.hiddenLabels).toContainEqual({
      documentId: "first",
      instanceId: "R1",
      name: true,
      values: true,
    });
    expect(result.project.documents[0]!.drafting!.objects).toContainEqual(
      expect.objectContaining({
        kind: "rectangle",
        center: { x: 100, y: -100 },
        width: 80,
        height: 40,
        styleOverride: { lineStyle: "dashed" },
      }),
    );
    expect(() => CircuitProjectSchema.parse(result.project)).not.toThrow();
  });

  it("removes an added ground interface pin only when every caller binds it to ground (#1783)", () => {
    const { project, snapshot } = fixture();
    const child = project.documents[0]!;
    child.instances.push({ id: "PGND", symbolId: "port", placement: null });
    child.nets[1]!.terminals.push({ instanceId: "PGND", pinName: "P" });
    child.netlist!.terminals.push({
      id: "ground-port",
      name: "GND",
      netId: "ground",
      direction: "passive",
      interfaceInstanceIds: ["PGND"],
    });
    const parent = createEmptyDocument("caller", "caller");
    parent.instances = [
      ...["X1", "X2"].map((id) => ({
        id,
        reference: id,
        symbolId: hierarchicalSymbolId(child.id),
        placement: null,
        netlist: {
          binding: { kind: "subcircuit" as const, childDocumentId: child.id },
          parameters: {},
        },
      })),
      { id: "G", symbolId: "ground", placement: null },
    ];
    parent.nets = [
      {
        id: "signal",
        terminals: [
          { instanceId: "X1", pinName: "IN" },
          { instanceId: "X2", pinName: "IN" },
        ],
      },
      {
        id: "return",
        terminals: [
          { instanceId: "X1", pinName: "GND" },
          { instanceId: "X2", pinName: "GND" },
          { instanceId: "G", pinName: "0" },
        ],
      },
    ];
    parent.connectivityEvidence = [
      {
        id: "ground-claim",
        kind: "name-claim",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        netId: "return",
        owner: { kind: "power-marker", objectId: "G" },
      },
    ];
    parent.importReference = {
      files: [],
      nets: [
        {
          id: "return",
          name: "0",
          scope: "global",
          terminals: [
            { instanceId: "X1", pinName: "GND" },
            { instanceId: "X2", pinName: "GND" },
            { instanceId: "G", pinName: "0" },
          ],
        },
      ],
    };
    project.documents.push(parent);
    project.topDocumentId = parent.id;
    snapshot.levels[0]!.model!.symbols = [
      ...snapshot.levels[0]!.model!.symbols,
      {
        id: "$GROUND_SYMBOL",
        name: "$GROUND_SYMBOL",
        package: "rnl-std-basic",
        level: null,
        default: false,
        definition: null,
      },
    ];
    snapshot.levels[0]!.model!.objects = [
      ...snapshot.levels[0]!.model!.objects,
      {
        ...usage("$GROUND", { p: "&0" }),
        symbol: slot("$GROUND_SYMBOL"),
        at: slot([2, -3]),
      },
    ];
    expect(() => CircuitProjectSchema.parse(project)).not.toThrow();
    const result = applyRnlSnapshot(project, snapshot);
    expect(result.diagnostics).toEqual([]);
    expect(
      result.project.documents[0]!.netlist!.terminals.map(
        (terminal) => terminal.name,
      ),
    ).toEqual(["IN"]);
    expect(result.project.documents[2]!.nets[1]!.terminals).toEqual([
      { instanceId: "G", pinName: "0" },
    ]);
    expect(() => CircuitProjectSchema.parse(result.project)).not.toThrow();
    const biased = structuredClone(project);
    const caller = biased.documents[2]!;
    caller.nets[1]!.terminals = caller.nets[1]!.terminals.filter(
      (terminal) => terminal.instanceId !== "X2",
    );
    caller.importReference!.nets[0]!.terminals =
      caller.importReference!.nets[0]!.terminals.filter(
        (terminal) => terminal.instanceId !== "X2",
      );
    caller.nets.push({
      id: "bias",
      terminals: [{ instanceId: "X2", pinName: "GND" }],
    });
    const kept = applyRnlSnapshot(biased, snapshot);
    expect(kept.diagnostics).toEqual([]);
    // The ground the file draws on the kept GND Pin is that Pin, drawn as a
    // Named Ground.
    expect(
      kept.project.documents[0]!.instances.find((item) => item.id === "PGND")
        ?.symbolId,
    ).toBe("named-ground");
    expect(
      kept.project.documents[0]!.netlist!.terminals.map(
        (terminal) => terminal.name,
      ),
    ).toEqual(["IN", "GND"]);
    expect(() => CircuitProjectSchema.parse(kept.project)).not.toThrow();
  });
});
