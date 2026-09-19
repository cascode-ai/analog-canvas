import { describe, expect, it } from "vitest";
import { createEmptyProject, createEmptyDocument } from "@icm/model";
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

  it("diagnoses external and reachable internal master name collisions", () => {
    const { project, top } = fixture();
    project.externalSubcircuitDefinitions.push({
      id: "ext",
      name: "amp",
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
  });

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
