import { createEmptyProject } from "@icm/model";
import { createBlockSymbol } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import {
  localBlockSymbolTarget,
  selectedBlockSymbolTarget,
} from "./block-symbol-layout-target";

describe("shared block layout target", () => {
  it("produces identical artwork from local and external interfaces", () => {
    const project = createEmptyProject("p", "P");
    const cell = project.documents[0]!;
    cell.netlist!.terminals = [
      {
        id: "out",
        name: "V_{out}",
        direction: "output",
        netId: "net",
        interfaceInstanceIds: ["P1"],
      },
    ];
    cell.presentation.cellSymbol = {
      minimumBodySize: { width: 140, height: 100 },
      pinPlacements: [{ terminalId: "out", side: "north", offset: 20 }],
    };
    project.externalSubcircuitDefinitions.push({
      id: "external",
      name: cell.name,
      terminals: [{ id: "out", name: "V_{out}", direction: "output" }],
      formalParameters: [],
      interfaceStatus: "declared",
      presentation: cell.presentation.cellSymbol,
    });
    const external = selectedBlockSymbolTarget(project, {
      id: "X1",
      symbolId: "external",
      placement: null,
      netlist: {
        parameters: {},
        binding: { kind: "external-subcircuit", definitionId: "external" },
      },
    })!;
    const local = localBlockSymbolTarget(cell);
    expect(createBlockSymbol({ ...external, id: local.id })).toEqual(
      createBlockSymbol(local),
    );
  });

  it("does not offer generic layout grips for reviewed PDK artwork", () => {
    const project = createEmptyProject("p", "P");
    project.externalSubcircuitDefinitions.push({
      id: "mos",
      name: "sky130_fd_pr__nfet_01v8",
      terminals: ["D", "G", "S", "B"].map((name) => ({
        id: name,
        name,
        direction: "passive",
      })),
      formalParameters: [],
      interfaceStatus: "declared",
    });
    expect(
      selectedBlockSymbolTarget(project, {
        id: "M1",
        symbolId: "nmos",
        placement: null,
        netlist: {
          parameters: {},
          binding: { kind: "external-subcircuit", definitionId: "mos" },
        },
      }),
    ).toBeUndefined();
  });

  it("does not offer them for a standard cell, drawn as its gate or as a block (#1450)", () => {
    const project = createEmptyProject("p", "P");
    project.externalSubcircuitDefinitions.push({
      id: "cell",
      name: "sky130_fd_sc_hd__nor2_1",
      terminals: ["A", "B", "VGND", "VNB", "VPB", "VPWR", "Y"].map((name) => ({
        id: name,
        name,
        direction: "passive",
      })),
      formalParameters: [],
      interfaceStatus: "declared",
    });
    for (const symbolId of ["nor-gate", "ext-cell"])
      expect(
        selectedBlockSymbolTarget(project, {
          id: "X1",
          symbolId,
          placement: null,
          netlist: {
            parameters: {},
            binding: { kind: "external-subcircuit", definitionId: "cell" },
          },
        }),
        symbolId,
      ).toBeUndefined();
  });
});
