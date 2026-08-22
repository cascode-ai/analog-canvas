import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";

import { builtInSymbols } from "./builtins.js";
import {
  createHierarchicalBlockSymbol,
  createProjectHierarchicalSymbols,
  externalSubcircuitSymbolId,
} from "./hierarchical-block.js";

describe("hierarchical block formal terminals", () => {
  it("derives pins only from the private formal cell interface", () => {
    const symbol = createHierarchicalBlockSymbol({
      name: "Child",
      sourceBinding: {
        cellName: "child",
        sourceRef: {
          fileId: "child.sp",
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 1, line: 1, column: 2 },
        },
      },
      netlist: {
        name: "child",
        formalParameters: [],
        terminals: [
          {
            id: "cell-terminal-in",
            name: "IN",
            netId: "net-in",
            direction: "input",
            interfaceInstanceIds: ["P1"],
          },
          {
            id: "cell-terminal-out",
            name: "OUT",
            netId: "net-out",
            direction: "output",
            interfaceInstanceIds: ["P2"],
          },
        ],
      },
    });

    expect(symbol?.pins.map((pin) => pin.name)).toEqual(["IN", "OUT"]);
  });

  it("creates a formal zero-terminal block for a manual Cell", () => {
    const symbol = createHierarchicalBlockSymbol({
      name: "Cell1",
      netlist: { name: "Cell1", terminals: [], formalParameters: [] },
    });

    expect(symbol).toMatchObject({
      name: "Cell1",
      hierarchicalBlock: true,
      viewBox: { x: -50, y: -30, width: 100, height: 60 },
      pins: [],
    });
    expect(symbol?.primitives[0]).toMatchObject({
      kind: "polygon",
      fill: "none",
      stroke: "foreground",
    });
    expect(
      symbol?.primitives[0]?.kind === "polygon"
        ? symbol.primitives[0].points
        : [],
    ).toHaveLength(4);
  });

  it("uses direction-aware sides, adaptive body width, and stable explicit pin placement", () => {
    const symbol = createHierarchicalBlockSymbol({
      name: "GainStage",
      netlist: {
        name: "GainStage",
        formalParameters: [],
        terminals: [
          {
            id: "terminal-vin",
            name: "VERY_LONG_INPUT",
            netId: "net-in",
            direction: "input",
            interfaceInstanceIds: ["P1"],
          },
          {
            id: "terminal-vout",
            name: "OUT",
            netId: "net-out",
            direction: "output",
            interfaceInstanceIds: ["P2"],
          },
          {
            id: "terminal-vdd",
            name: "VDD",
            netId: "net-vdd",
            direction: "passive",
            interfaceInstanceIds: ["P3"],
          },
        ],
      },
      presentation: {
        styleProfileId: "razavi-textbook-v1",
        grid: 10,
        compactness: "normal",
        cellSymbol: {
          pinPlacements: [
            { terminalId: "terminal-vdd", side: "north", offset: 20 },
          ],
        },
      },
    });

    expect(symbol?.pins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "VERY_LONG_INPUT",
          direction: "west",
        }),
        expect.objectContaining({ name: "OUT", direction: "east" }),
        expect.objectContaining({
          name: "VDD",
          at: { x: 20, y: -30 },
          direction: "north",
        }),
      ]),
    );
    expect(symbol?.viewBox.width).toBeGreaterThan(100);
    expect(
      symbol?.pins.every((pin) => pin.at.x % 10 === 0 && pin.at.y % 10 === 0),
    ).toBe(true);
  });

  it("keeps dense long-name interfaces grid-aligned on every body edge", () => {
    const terminals = Array.from({ length: 12 }, (_, index) => ({
      id: `terminal-${index}`,
      name: `VERY_LONG_SIGNAL_${index + 1}`,
      netId: `net-${index}`,
      direction: index % 2 === 0 ? ("input" as const) : ("output" as const),
      interfaceInstanceIds: [`P${index + 1}`],
    }));
    const symbol = createHierarchicalBlockSymbol({
      name: "DenseStage",
      netlist: { name: "DenseStage", terminals, formalParameters: [] },
      presentation: {
        styleProfileId: "razavi-textbook-v1",
        grid: 10,
        compactness: "normal",
        cellSymbol: {
          pinPlacements: [
            { terminalId: "terminal-0", side: "north", offset: -40 },
            { terminalId: "terminal-1", side: "south", offset: 40 },
          ],
        },
      },
    });

    expect(symbol?.pins).toHaveLength(12);
    expect(symbol?.viewBox.width).toBeGreaterThanOrEqual(220);
    expect(symbol?.viewBox.height).toBeGreaterThanOrEqual(100);
    expect(
      symbol?.pins.map((pin) => `${pin.direction}:${pin.at.x}:${pin.at.y}`),
    ).toHaveLength(
      new Set(
        symbol?.pins.map((pin) => `${pin.direction}:${pin.at.x}:${pin.at.y}`),
      ).size,
    );
    expect(
      symbol?.pins.every((pin) => pin.at.x % 10 === 0 && pin.at.y % 10 === 0),
    ).toBe(true);
  });
});

describe("external PDK symbol presentation", () => {
  function projectWithExternal(
    name: string,
    terminalNames: readonly string[] = ["D", "G", "S", "B"],
    presentation?: { minimumBodySize: { width: number; height: number } },
  ) {
    const project = createEmptyProject("project", "Project");
    project.externalSubcircuitDefinitions.push({
      id: "external-device",
      name,
      terminals: terminalNames.map((terminalName, index) => ({
        id: `external-terminal-${index}`,
        name: terminalName,
        direction: "passive",
      })),
      formalParameters: [],
      interfaceStatus: "declared",
      ...(presentation ? { presentation } : {}),
    });
    return project;
  }

  it.each([
    ["sky130_fd_pr__nfet_01v8", "nmos"],
    ["sky130_fd_pr__pfet_01v8", "pmos"],
  ])(
    "retains canonical %s MOS presentation for existing external identity",
    (name, baseId) => {
      const symbol = createProjectHierarchicalSymbols(
        projectWithExternal(name),
        builtInSymbols,
      ).find(
        (candidate) =>
          candidate.id === externalSubcircuitSymbolId("external-device"),
      );
      const base = builtInSymbols.find((candidate) => candidate.id === baseId);

      expect(symbol).toMatchObject({
        id: externalSubcircuitSymbolId("external-device"),
        name,
        hierarchicalBlock: true,
        pins: base?.pins,
        primitives: base?.primitives,
        defaultVariantId: "textbook-3terminal",
        variants: base?.variants,
      });
      expect(symbol?.pins.map((pin) => pin.name)).toEqual(["D", "G", "S", "B"]);
    },
  );

  it("keeps the generic block when terminal order is incompatible", () => {
    const symbol = createProjectHierarchicalSymbols(
      projectWithExternal("sky130_fd_pr__nfet_01v8", ["G", "D", "S", "B"]),
      builtInSymbols,
    ).at(-1);

    expect(symbol?.pins.map((pin) => pin.name)).toEqual(["G", "D", "S", "B"]);
    expect(symbol?.primitives[0]).toMatchObject({ kind: "polygon" });
  });

  it("keeps an explicit block presentation authoritative", () => {
    const symbol = createProjectHierarchicalSymbols(
      projectWithExternal("sky130_fd_pr__nfet_01v8", ["D", "G", "S", "B"], {
        minimumBodySize: { width: 160, height: 100 },
      }),
      builtInSymbols,
    ).at(-1);

    expect(symbol?.viewBox.width).toBeGreaterThanOrEqual(160);
    expect(symbol?.primitives[0]).toMatchObject({ kind: "polygon" });
  });
});
