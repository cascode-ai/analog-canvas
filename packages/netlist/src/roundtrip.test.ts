import {
  createEmptyDocument,
  createEmptyProject,
  deriveStableId,
} from "@icm/model";
import type { CircuitProject } from "@icm/model";
import { importSpiceSources } from "@icm/spice";
import { describe, expect, it } from "vitest";

import type { DesignNetlistIR } from "./ir.js";
import { analyzeDesignNetlist } from "./extract.js";
import { printSpiceNetlist } from "./printers.js";

function structuralProject(): CircuitProject {
  const project = createEmptyProject("roundtrip-project", "Roundtrip", "top");
  const top = project.documents[0]!;
  top.name = "top";
  top.netlist = {
    name: "top",
    formalParameters: [],
    terminals: [
      {
        id: "top-terminal-vin",
        name: "VIN",
        netId: "top-net-vin",
        direction: "input",
        interfaceInstanceIds: ["top-port-vin"],
      },
      {
        id: "top-terminal-vout",
        name: "VOUT",
        netId: "top-net-vout",
        direction: "output",
        interfaceInstanceIds: ["top-port-vout"],
      },
    ],
  };
  top.instances.push(
    { id: "top-port-vin", symbolId: "port", placement: null },
    { id: "top-port-vout", symbolId: "port", placement: null },
    {
      id: "I1",
      symbolId: "current-source",
      placement: null,
      netlist: {
        reference: "I1",
        binding: { kind: "primitive", deviceClass: "current-source" },
        parameters: { dc: "10u" },
      },
    },
    {
      id: "X1",
      symbolId: "leaf-symbol",
      placement: null,
      netlist: {
        reference: "X1",
        binding: { kind: "subcircuit", childDocumentId: "leaf" },
        parameters: { scale: "2" },
      },
    },
    {
      id: "X2",
      symbolId: "external-symbol",
      placement: null,
      netlist: {
        reference: "X2",
        binding: {
          kind: "external-subcircuit",
          definitionId: "external-master",
        },
        parameters: { l: "1u", nf: "4" },
      },
    },
  );
  top.nets.push(
    {
      id: "top-net-vin",
      name: "internal_vin",
      scope: "local",
      terminals: [
        { instanceId: "top-port-vin", pinName: "P" },
        { instanceId: "X1", pinName: "A" },
        { instanceId: "X2", pinName: "P2" },
      ],
    },
    {
      id: "top-net-vout",
      name: "internal_vout",
      scope: "local",
      terminals: [
        { instanceId: "top-port-vout", pinName: "P" },
        { instanceId: "X1", pinName: "B" },
        { instanceId: "X2", pinName: "P1" },
      ],
    },
    {
      id: "top-net-vdd",
      name: "VDD",
      scope: "global",
      terminals: [{ instanceId: "I1", pinName: "+" }],
    },
    {
      id: "top-net-ground",
      name: "0",
      scope: "global",
      terminals: [{ instanceId: "I1", pinName: "-" }],
    },
  );

  const leaf = createEmptyDocument("leaf", "leaf");
  leaf.netlist = {
    name: "leaf",
    formalParameters: [{ name: "scale", defaultValue: "1" }],
    terminals: [
      {
        id: "leaf-terminal-a",
        name: "A",
        netId: "leaf-net-a",
        direction: "input",
        interfaceInstanceIds: ["leaf-port-a"],
      },
      {
        id: "leaf-terminal-b",
        name: "B",
        netId: "leaf-net-b",
        direction: "output",
        interfaceInstanceIds: ["leaf-port-b"],
      },
    ],
  };
  leaf.instances.push(
    { id: "leaf-port-a", symbolId: "port", placement: null },
    { id: "leaf-port-b", symbolId: "port", placement: null },
    {
      id: "C1",
      symbolId: "capacitor",
      placement: null,
      netlist: {
        reference: "C1",
        binding: { kind: "primitive", deviceClass: "capacitor" },
        parameters: { value: "2p" },
      },
    },
    {
      id: "R1",
      symbolId: "resistor",
      placement: null,
      netlist: {
        reference: "R1",
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    },
  );
  leaf.nets.push(
    {
      id: "leaf-net-a",
      name: "leaf_internal_a",
      scope: "local",
      terminals: [
        { instanceId: "leaf-port-a", pinName: "P" },
        { instanceId: "C1", pinName: "1" },
        { instanceId: "R1", pinName: "1" },
      ],
    },
    {
      id: "leaf-net-b",
      name: "leaf_internal_b",
      scope: "local",
      terminals: [
        { instanceId: "leaf-port-b", pinName: "P" },
        { instanceId: "C1", pinName: "2" },
      ],
    },
  );
  leaf.noConnects.push({
    id: "leaf-r1-open",
    endpoint: { kind: "terminal", instanceId: "R1", pinName: "2" },
  });
  project.documents.push(leaf);
  project.externalSubcircuitDefinitions.push({
    id: "external-master",
    name: "EXT_MASTER",
    terminals: [
      { id: "external-p1", name: "P1", direction: "passive" },
      { id: "external-p2", name: "P2", direction: "passive" },
    ],
    formalParameters: [],
    interfaceStatus: "declared",
  });
  for (const document of project.documents) {
    for (const net of document.nets) {
      if (!net.name) continue;
      document.connectivityEvidence.push({
        id: deriveStableId("fixture-net-name", document.id, net.id),
        kind: "name-claim",
        netId: net.id,
        name: net.name,
        owner: { kind: "explicit-net-property" },
        scope: net.scope,
      });
    }
  }
  return project;
}

function normalizedSemantics(ir: DesignNetlistIR) {
  const topCellName = ir.cells.find((cell) => cell.id === ir.topCellId)?.name;
  return {
    topCellName,
    globals: ir.globals,
    externalMasters: (ir.externalMasters ?? []).map((master) => ({
      name: master.name,
      terminals: master.terminals.map((terminal) => ({
        name: terminal.name,
        direction: terminal.direction,
      })),
      formalParameters: master.formalParameters,
    })),
    cells: ir.cells.map((cell) => ({
      name: cell.name,
      ports: cell.ports.map((port) => ({
        name: port.name,
        netName: port.netName,
      })),
      nets: cell.nets
        .map((net) => ({ name: net.name, scope: net.scope }))
        .toSorted((left, right) => left.name.localeCompare(right.name)),
      formalParameters: cell.formalParameters ?? [],
      instances: cell.instances.map((instance) => ({
        reference: instance.reference,
        deviceClass: instance.deviceClass,
        target: instance.target,
        nodes: instance.nodes,
        parameters: instance.parameters,
      })),
    })),
  };
}

describe("structural SPICE round trip", () => {
  it("keeps capacitor plate pin order independent of schematic orientation", () => {
    const project = structuralProject();
    const capacitor = project.documents
      .find((document) => document.id === "leaf")
      ?.instances.find((instance) => instance.id === "C1");
    expect(capacitor).toBeDefined();
    if (!capacitor) return;
    capacitor.placement = {
      position: { x: 120, y: 80 },
      rotation: 90,
      mirror: "none",
    };

    const analysis = analyzeDesignNetlist(project);
    expect(analysis.diagnostics).toEqual([
      expect.objectContaining({ code: "GENERATED_NO_CONNECT_NODE" }),
    ]);
    const exported = analysis.ir?.cells
      .find((cell) => cell.name === "leaf")
      ?.instances.find((instance) => instance.reference === "C1");
    expect(exported?.nodes).toEqual([
      { pinName: "1", netName: "A" },
      { pinName: "2", netName: "B" },
    ]);
    expect(printSpiceNetlist(analysis.ir!)).toContain("C1 A B 2p");
  });

  it("preserves a real Project's hierarchy, interfaces, globals, opens, and parameters", async () => {
    const beforeAnalysis = analyzeDesignNetlist(structuralProject());
    expect(beforeAnalysis.ir).not.toBeNull();
    expect(beforeAnalysis.diagnostics).toEqual([
      expect.objectContaining({ code: "GENERATED_NO_CONNECT_NODE" }),
    ]);
    const before = beforeAnalysis.ir!;
    const text = printSpiceNetlist(before);
    expect(text).toContain(".subckt leaf A B params: scale=1");
    expect(text).toContain("R1 A NC0001 1k");

    const imported = await importSpiceSources(
      [
        {
          path: "roundtrip.spi",
          bytes: new TextEncoder().encode(text),
        },
      ],
      "roundtrip.spi",
    );

    expect(imported.successful).toBe(true);
    expect(imported.project).not.toBeNull();
    const after = analyzeDesignNetlist(imported.project!);
    expect(after.diagnostics).toEqual([]);
    expect(after.ir).not.toBeNull();
    expect(normalizedSemantics(after.ir!)).toEqual(normalizedSemantics(before));
  });
});
