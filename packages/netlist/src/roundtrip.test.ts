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

function claimNet(
  document: CircuitProject["documents"][number],
  netId: string,
  name: string,
  scope: "local" | "global" = "local",
): void {
  const labelId = deriveStableId(
    "fixture-net-label",
    document.id,
    netId,
    name,
    scope,
  );
  document.annotations.push({
    id: labelId,
    kind: "net-label",
    binding: { kind: "net-name", netId },
    netId,
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.connectivityEvidence.push({
    id: deriveStableId("fixture-net-name", document.id, netId),
    kind: "name-claim",
    netId,
    name,
    owner: { kind: "net-label", annotationId: labelId },
    scope,
  });
}

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
      reference: "I1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "current-source" },
        parameters: { dc: "10u" },
      },
    },
    {
      id: "X1",
      symbolId: "leaf-symbol",
      placement: null,
      reference: "X1",
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "leaf" },
        parameters: { scale: "2" },
      },
    },
    {
      id: "X2",
      symbolId: "external-symbol",
      placement: null,
      reference: "X2",
      netlist: {
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

      terminals: [
        { instanceId: "top-port-vin", pinName: "P" },
        { instanceId: "X1", pinName: "A" },
        { instanceId: "X2", pinName: "P2" },
      ],
    },
    {
      id: "top-net-vout",

      terminals: [
        { instanceId: "top-port-vout", pinName: "P" },
        { instanceId: "X1", pinName: "B" },
        { instanceId: "X2", pinName: "P1" },
      ],
    },
    {
      id: "top-net-vdd",

      terminals: [{ instanceId: "I1", pinName: "+" }],
    },
    {
      id: "top-net-ground",

      terminals: [{ instanceId: "I1", pinName: "-" }],
    },
  );
  claimNet(top, "top-net-vin", "VIN");
  claimNet(top, "top-net-vout", "VOUT");
  claimNet(top, "top-net-vdd", "VDD", "global");
  claimNet(top, "top-net-ground", "0", "global");

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
      reference: "C1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "capacitor" },
        parameters: { value: "2p" },
      },
    },
    {
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "R1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    },
  );
  leaf.nets.push(
    {
      id: "leaf-net-a",

      terminals: [
        { instanceId: "leaf-port-a", pinName: "P" },
        { instanceId: "C1", pinName: "1" },
        { instanceId: "R1", pinName: "1" },
      ],
    },
    {
      id: "leaf-net-b",

      terminals: [
        { instanceId: "leaf-port-b", pinName: "P" },
        { instanceId: "C1", pinName: "2" },
      ],
    },
  );
  claimNet(leaf, "leaf-net-a", "A");
  claimNet(leaf, "leaf-net-b", "B");
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
  it("keeps Cadence bang spelling separate from global electrical identity", async () => {
    const imported = await importSpiceSources(
      [
        {
          path: "cadence.spi",
          bytes: new TextEncoder().encode(
            "Cadence bang\nV1 vdd! 0 DC 1.8\n.end\n",
          ),
        },
      ],
      "cadence.spi",
      {},
      { namingProfile: "cadence-bang" },
    );
    expect(imported.successful).toBe(true);

    const native = analyzeDesignNetlist(imported.project!, {
      format: "spice",
      namingProfile: "native",
    });
    const cadence = analyzeDesignNetlist(imported.project!, {
      format: "spice",
      namingProfile: "cadence-bang",
    });

    expect(native.ir?.globals).toEqual(["0", "vdd"]);
    expect(cadence.ir?.globals).toEqual(["0", "vdd!"]);
    expect(printSpiceNetlist(native.ir!)).toContain(".global vdd");
    expect(printSpiceNetlist(cadence.ir!)).toContain(".global vdd!");
    expect(imported.project!.documents[0]!.connectivityEvidence).toContainEqual(
      expect.objectContaining({
        kind: "net-name-hint",
        sourceName: "vdd!",
      }),
    );

    imported.project!.documents[0]!.sourceStatus = "connectivity-modified";
    expect(
      analyzeDesignNetlist(imported.project!, {
        format: "spice",
        namingProfile: "cadence-bang",
      }).ir,
    ).toEqual(cadence.ir);
  });

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
