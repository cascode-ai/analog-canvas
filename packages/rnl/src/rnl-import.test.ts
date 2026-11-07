import {
  CircuitProjectSchema,
  createEmptyDocument,
  createEmptyProject,
} from "@icm/model";
import { describe, expect, it } from "vitest";
import {
  applyRnlSnapshot,
  type RnlLevelSnapshot,
  type RnlSnapshot,
} from "./index.js";

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
    model: {
      symbols: [
        {
          id: "$RESISTOR",
          name: "$RESISTOR",
          package: "rnl-std-basic",
          level: null,
          default: false,
        },
      ],
      objects: [
        {
          id: "#R1",
          kind: "instance",
          host: ["#R1"],
          definition: null,
          attach: null,
          symbol: { value: "$RESISTOR" },
          at: { value: [x, y] },
          orient: { value: "R0" },
          pins: [],
        },
      ],
      points: [{ id: "%end", at: { value: [x, y - 6] }, junction: true }],
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
    },
  });
  const snapshot: RnlSnapshot = {
    dialect: "spice",
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
});
