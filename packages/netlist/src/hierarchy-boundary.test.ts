import { describe, expect, it } from "vitest";
import { createEmptyProject, createEmptyDocument } from "@icm/model";
import { buildProjectConnectivityIndex, runErcChecks } from "@icm/derived";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  analyzeDesignNetlist,
  analyzeDesignNetlistForAuthoring,
} from "./extract.js";

function fixture() {
  const project = createEmptyProject("project", "Project");
  const child = createEmptyDocument("child", "Amp");
  child.netlist!.name = "Amp";
  for (const name of ["IN", "OUT"]) {
    child.instances.push({ id: name, symbolId: "port", placement: null });
    child.nets.push({
      id: name,
      terminals: [{ instanceId: name, pinName: "P" }],
    });
    child.netlist!.terminals.push({
      id: `port-${name}`,
      name,
      netId: name,
      direction: "passive",
      interfaceInstanceIds: [name],
    });
  }
  project.documents.push(child);
  const top = project.documents[0]!;
  top.instances.push({
    id: "X1",
    reference: "X1",
    symbolId: "block",
    placement: null,
    netlist: {
      parameters: {},
      binding: { kind: "subcircuit", childDocumentId: child.id },
    },
  });
  top.nets.push({
    id: "out",
    terminals: [{ instanceId: "X1", pinName: "OUT" }],
  });
  return { project, child, top };
}

describe("hierarchy netlist boundaries", () => {
  it("keeps formal node order independent of symbol body and pin sides", () => {
    const { project, child } = fixture();
    const before = analyzeDesignNetlistForAuthoring(project).ir!;
    child.presentation.cellSymbol = {
      minimumBodySize: { width: 200, height: 160 },
      pinPlacements: [
        { terminalId: "port-OUT", side: "north", offset: 20 },
        { terminalId: "port-IN", side: "south", offset: -20 },
      ],
    };
    const after = analyzeDesignNetlistForAuthoring(project).ir!;
    expect(
      after.cells.map((cell) => ({
        id: cell.id,
        ports: cell.ports,
        instances: cell.instances,
      })),
    ).toEqual(
      before.cells.map((cell) => ({
        id: cell.id,
        ports: cell.ports,
        instances: cell.instances,
      })),
    );
  });
  it.each([false, true])(
    "preserves missing positional nodes for external=%s authoring only",
    (external) => {
      const { project, top } = fixture();
      if (external) {
        project.externalSubcircuitDefinitions.push({
          id: "ext",
          name: "ExternalAmp",
          interfaceStatus: "declared",
          formalParameters: [],
          terminals: ["IN", "OUT"].map((name) => ({
            id: name,
            name,
            direction: "passive" as const,
          })),
        });
        top.instances[0]!.netlist!.binding = {
          kind: "external-subcircuit",
          definitionId: "ext",
        };
      }
      expect(analyzeDesignNetlist(project).ir).toBeNull();
      const preview = analyzeDesignNetlistForAuthoring(project);
      const nodes = preview.ir!.cells.find((cell) => cell.id === top.id)!
        .instances[0]!.nodes;
      expect(nodes).toHaveLength(2);
      expect(nodes[0]).toEqual({ pinName: "IN", netName: "<unconnected:IN>" });
      expect(nodes[1]!.pinName).toBe("OUT");
      expect(nodes[1]!.netName).not.toContain("unconnected");
    },
  );

  it.each([
    ["Amp", "amp"],
    ["A mp", "a_mp"],
  ])(
    "aligns ERC and export master collisions for %s / %s",
    (localName, externalName) => {
      const { project, top, child } = fixture();
      child.netlist!.name = localName;
      project.externalSubcircuitDefinitions.push({
        id: "ext",
        name: externalName,
        interfaceStatus: "declared",
        formalParameters: [],
        terminals: [],
      });
      top.instances.push({
        id: "X2",
        reference: "X2",
        symbolId: "external",
        placement: null,
        netlist: {
          parameters: {},
          binding: { kind: "external-subcircuit", definitionId: "ext" },
        },
      });
      expect(analyzeDesignNetlist(project).diagnostics).toContainEqual(
        expect.objectContaining({
          code: "MASTER_NAME_COLLISION",
          objectIds: ["X2"],
        }),
      );
      const resolver = createProjectSymbolResolver(project, builtInSymbols);
      expect(
        runErcChecks(
          project,
          buildProjectConnectivityIndex(project, resolver),
          resolver,
        ),
      ).toContainEqual(
        expect.objectContaining({
          code: "ERC_MASTER_NAME_COLLISION",
          severity: "error",
          primary: expect.objectContaining({
            documentId: top.id,
            objectId: "X2",
            kind: "instance",
          }),
          related: [
            expect.objectContaining({ documentId: child.id, kind: "document" }),
          ],
        }),
      );
      project.externalSubcircuitDefinitions[0]!.name = "DistinctMaster";
      expect(
        analyzeDesignNetlist(project).diagnostics.some(
          (item) => item.code === "MASTER_NAME_COLLISION",
        ),
      ).toBe(false);
    },
  );

  it("diagnoses effective Port direction conflicts", () => {
    const { project, child } = fixture();
    child.instances.push({
      id: "alias-marker",
      symbolId: "port",
      placement: null,
    });
    child.nets[0]!.terminals.push({ instanceId: "alias-marker", pinName: "P" });
    child.netlist!.terminals.push({
      ...child.netlist!.terminals[0]!,
      id: "alias",
      direction: "output",
      interfaceInstanceIds: ["alias-marker"],
    });
    expect(analyzeDesignNetlist(project).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "CELL_PORT_DIRECTION_CONFLICT",
        documentId: child.id,
      }),
    );
  });
});
