import { describe, expect, it } from "vitest";

import { createEmptyProject, type CircuitProject } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { componentSupplyPins } from "./component-visual-variants";
import { hiddenTerminals } from "./hidden-terminals";

/** One part X1 in the top Cell, bound to external definition `name`. */
function boundPart(
  symbolId: string,
  name: string,
  terminals: readonly string[],
): CircuitProject {
  const project = createEmptyProject("hidden", "Hidden terminals");
  project.externalSubcircuitDefinitions.push({
    id: "definition",
    name,
    interfaceStatus: "declared",
    formalParameters: [],
    terminals: terminals.map((terminal) => ({
      id: `definition-${terminal}`,
      name: terminal,
      direction: "passive" as const,
    })),
  });
  project.documents[0]!.instances.push({
    id: "X1",
    reference: "X1",
    symbolId,
    placement: null,
    netlist: {
      binding: { kind: "external-subcircuit", definitionId: "definition" },
      parameters: {},
    },
  });
  return project;
}

const part = (project: CircuitProject) =>
  project.documents[0]!.instances.find((instance) => instance.id === "X1")!;
const terminalsOf = (project: CircuitProject) =>
  hiddenTerminals(
    project,
    part(project),
    createProjectSymbolResolver(project, builtInSymbols),
  );

/** X1, an op-amp in the top Cell, its supplies shown or hidden. */
function amplifier(symbolVariantId?: string): CircuitProject {
  const project = createEmptyProject("hidden", "Hidden terminals");
  project.documents[0]!.instances.push({
    id: "X1",
    reference: "X1",
    symbolId: "opamp",
    ...(symbolVariantId ? { symbolVariantId } : {}),
    placement: null,
    netlist: {
      binding: { kind: "unresolved-subcircuit", name: "opamp" },
      parameters: {},
    },
  });
  return project;
}

describe("the terminals a part draws no pin for (#1833)", () => {
  it("lists every own terminal of a reviewed device, not only the first", () => {
    const project = boundPart("inductor", "sky130_fd_pr__ind_05_125", [
      "A",
      "B",
      "CT",
      "SUB",
    ]);
    expect(terminalsOf(project)).toEqual([
      { pinName: "CT", label: "CT" },
      { pinName: "SUB", label: "Substrate" },
    ]);
  });

  it("lists a block's supplies, which take Auto while unset", () => {
    expect(terminalsOf(amplifier())).toEqual([
      { pinName: "VDD", label: "VDD", rail: "VDD" },
      { pinName: "VSS", label: "VSS", rail: "VSS" },
    ]);
  });

  it("lists none of an op-amp's supplies while it draws their pins", () => {
    expect(terminalsOf(amplifier("supply-pins"))).toEqual([]);
  });

  it("lists the pins a Circuit Component's op-amp artwork maps and hides", () => {
    // Made from the op-amp's current artwork, VDD and VSS pins included.
    const project = boundPart("opamp", "EA", [
      "VDD",
      "VSS",
      "VIP",
      "VIN",
      "VOUT",
    ]);
    project.componentDefinitions = [
      {
        symbol: structuredClone(
          builtInSymbols.find((symbol) => symbol.id === "opamp")!,
        ),
        circuitBinding: {
          definitionId: "definition",
          terminals: [
            { terminalId: "definition-VDD", pinName: "VDD" },
            { terminalId: "definition-VSS", pinName: "VSS" },
            { terminalId: "definition-VIP", pinName: "IN+" },
            { terminalId: "definition-VIN", pinName: "IN-" },
            { terminalId: "definition-VOUT", pinName: "OUT" },
          ],
        },
      },
    ];
    expect(terminalsOf(project)).toEqual([
      { pinName: "VDD", label: "VDD" },
      { pinName: "VSS", label: "VSS" },
    ]);
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    expect(componentSupplyPins(part(project), resolver)).toBe(false);
    part(project).symbolVariantId = "supply-pins";
    expect(terminalsOf(project)).toEqual([]);
    expect(componentSupplyPins(part(project), resolver)).toBe(true);
  });

  it("lists the supplies a Circuit Component on the op-amp artwork leaves on their rails", () => {
    // VDD and VSS pins unmapped: they draw nothing, shown or not.
    const project = boundPart("opamp", "EA", [
      "VDD",
      "VSS",
      "VIP",
      "VIN",
      "VOUT",
    ]);
    const artwork = (supplies: boolean) => ({
      symbol: structuredClone(
        builtInSymbols.find((symbol) => symbol.id === "opamp")!,
      ),
      circuitBinding: {
        definitionId: "definition",
        terminals: [
          ...(supplies
            ? [
                { terminalId: "definition-VDD", supply: "VDD" as const },
                { terminalId: "definition-VSS", supply: "VSS" as const },
              ]
            : []),
          { terminalId: "definition-VIP", pinName: "IN+" },
          { terminalId: "definition-VIN", pinName: "IN-" },
          { terminalId: "definition-VOUT", pinName: "OUT" },
        ],
      },
    });
    project.componentDefinitions = [artwork(true)];
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    expect(terminalsOf(project)).toEqual([
      { pinName: "VDD", label: "VDD", rail: "VDD" },
      { pinName: "VSS", label: "VSS", rail: "VSS" },
    ]);
    // Showing them would draw no more pins, so Properties offers no switch.
    expect(componentSupplyPins(part(project), resolver)).toBeUndefined();

    // A model with no supplies binds the same artwork and has no Net row.
    project.externalSubcircuitDefinitions[0]!.terminals =
      project.externalSubcircuitDefinitions[0]!.terminals.filter(
        (terminal) => !["VDD", "VSS"].includes(terminal.name),
      );
    project.componentDefinitions = [artwork(false)];
    expect(terminalsOf(project)).toEqual([]);
  });

  it("lists the supplies a Circuit Component maps to no pin of its artwork", () => {
    // A Gallery LDO's error amplifier: IN+, IN- and OUT on VIP, VIN and VOUT.
    const project = boundPart("opamp", "LDO_TEACH_EA", [
      "VDD",
      "VSS",
      "VIP",
      "VIN",
      "VOUT",
    ]);
    project.componentDefinitions = [
      {
        symbol: {
          schemaVersion: 1,
          id: "opamp",
          name: "Operational Amplifier",
          viewBox: { x: -40, y: -30, width: 80, height: 60 },
          pins: (
            [
              ["IN+", -40, 10, "west", "non-inverting-input"],
              ["IN-", -40, -10, "west", "inverting-input"],
              ["OUT", 30, 0, "east", "output"],
            ] as const
          ).map(([name, x, y, direction, role]) => ({
            name,
            at: { x, y },
            direction,
            role,
            presentation: { leadLength: 10, visibility: "visible" as const },
          })),
          primitives: [],
          variants: [],
        },
        circuitBinding: {
          definitionId: "definition",
          terminals: [
            { terminalId: "definition-VDD", supply: "VDD" },
            { terminalId: "definition-VSS", supply: "VSS" },
            { terminalId: "definition-VIP", pinName: "IN+" },
            { terminalId: "definition-VIN", pinName: "IN-" },
            { terminalId: "definition-VOUT", pinName: "OUT" },
          ],
        },
      },
    ];
    expect(terminalsOf(project)).toEqual([
      { pinName: "VDD", label: "VDD", rail: "VDD" },
      { pinName: "VSS", label: "VSS", rail: "VSS" },
    ]);
  });

  it("lists none for a part whose terminals are all pins", () => {
    const project = createEmptyProject("hidden", "Hidden terminals");
    project.documents[0]!.instances.push({
      id: "X1",
      reference: "R1",
      symbolId: "resistor",
      placement: null,
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    });
    expect(terminalsOf(project)).toEqual([]);
  });
});
