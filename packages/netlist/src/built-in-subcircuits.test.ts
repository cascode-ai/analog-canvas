import { describe, expect, it } from "vitest";

import { createEmptyProject, type CircuitProject } from "@icm/model";
import { subcircuitDescriptor } from "@icm/devices";

import { createDesignNetlistExport } from "./export.js";
import { createNetlistExportProfile } from "./export-profiles.js";

const differentialNets = [
  ["IN+", "plus_node"],
  ["IN-", "minus_node"],
  ["OUT+", "positive_out"],
  ["OUT-", "negative_out"],
] as const;

function analogBlockProject(
  symbols: readonly string[],
  connections: readonly (readonly [string, string])[],
  authored = true,
): CircuitProject {
  const project = createEmptyProject("analog-blocks", "Analog Blocks", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  // These are authored interfaces, not ports synthesized by the exporter.
  for (const name of ["VDD", "VSS"]) {
    document.instances.push({ id: name, symbolId: "port", placement: null });
    document.nets.push({
      id: name,
      terminals: [{ instanceId: name, pinName: "P" }],
    });
    document.netlist!.terminals.push({
      id: `terminal-${name}`,
      name,
      netId: name,
      direction: "inout",
      interfaceInstanceIds: [name],
    });
  }
  for (const [instanceIndex, symbolId] of symbols.entries()) {
    const instanceId = `block-${instanceIndex + 1}`;
    document.instances.push({
      id: instanceId,
      symbolId,
      placement: null,
      ...(authored
        ? {
            reference: `X${instanceIndex + 1}`,
            netlist: {
              binding: {
                kind: "unresolved-subcircuit" as const,
                name: subcircuitDescriptor(symbolId)!.target,
              },
              parameters: {},
            },
          }
        : {}),
    });
    for (const [pinName, sourceName] of connections) {
      const netId = `${instanceId}-${pinName}`;
      document.nets.push({
        id: netId,
        terminals: [{ instanceId, pinName }],
      });
      document.connectivityEvidence.push({
        id: `${netId}-hint`,
        kind: "net-name-hint",
        netId,
        sourceName: `${sourceName}${instanceIndex || ""}`,
        origin: "spice-import",
      });
    }
  }
  return project;
}

describe("built-in Analog Block subcircuits", () => {
  it.each([undefined, createNetlistExportProfile("abstract")])(
    "blocks absent block supplies without synthesizing interfaces (profile: %s)",
    (profile) => {
      const project = analogBlockProject(
        ["opamp-differential"],
        differentialNets,
      );
      const document = project.documents[0]!;
      document.netlist!.terminals = [];
      document.instances = document.instances.filter(
        (instance) => !["VDD", "VSS"].includes(instance.id),
      );
      document.nets = document.nets.filter(
        (net) => !["VDD", "VSS"].includes(net.id),
      );
      const before = structuredClone(project);
      const result = createDesignNetlistExport(
        project,
        profile ? { profile } : {},
      );
      expect(result.status).toBe("blocked");
      expect(
        result.diagnostics.filter(
          (diagnostic) => diagnostic.code === "MISSING_BLOCK_SUPPLY",
        ),
      ).toHaveLength(2);
      expect(project).toEqual(before);
    },
  );
  it("follows the supplies the author drew rather than their spelling", () => {
    // Nobody names a Net "VSS" when they have drawn a ground symbol, and a
    // positive rail is as often called VDDA as VDD. The Block's declared
    // supply names its role, not the Net the author has to produce.
    const project = analogBlockProject(
      ["opamp-differential"],
      differentialNets,
    );
    const document = project.documents[0]!;
    document.netlist!.terminals = [];
    document.instances = document.instances.filter(
      (instance) => !["VDD", "VSS"].includes(instance.id),
    );
    document.nets = document.nets.filter(
      (net) => !["VDD", "VSS"].includes(net.id),
    );
    document.instances.push(
      { id: "GND1", symbolId: "ground", placement: null },
      { id: "VDD1", symbolId: "vdd-port", placement: null },
    );
    document.nets.push(
      { id: "net-gnd", terminals: [{ instanceId: "GND1", pinName: "0" }] },
      { id: "net-rail", terminals: [{ instanceId: "VDD1", pinName: "P" }] },
    );
    document.connectivityEvidence.push({
      id: "rail-claim",
      kind: "name-claim",
      netId: "net-rail",
      name: "VDDA",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "power-marker", objectId: "VDD1" },
    });
    const before = structuredClone(project);

    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // Declared order stays VDD, VSS, then the signals; the nodes are the ones
    // on the page.
    expect(result.file.text).toContain(
      "X1 VDDA 0 plus_node minus_node positive_out negative_out opamp_differential",
    );
    expect(project).toEqual(before);
  });

  it("still refuses a Block whose supply was never drawn", () => {
    // Ground alone leaves the positive supply unanswered, and inventing one
    // would connect a Block to a node nobody authored.
    const project = analogBlockProject(
      ["opamp-differential"],
      differentialNets,
    );
    const document = project.documents[0]!;
    document.netlist!.terminals = [];
    document.instances = document.instances.filter(
      (instance) => !["VDD", "VSS"].includes(instance.id),
    );
    document.nets = document.nets.filter(
      (net) => !["VDD", "VSS"].includes(net.id),
    );
    document.instances.push({
      id: "GND1",
      symbolId: "ground",
      placement: null,
    });
    document.nets.push({
      id: "net-gnd",
      terminals: [{ instanceId: "GND1", pinName: "0" }],
    });

    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("blocked");
    const missing = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "MISSING_BLOCK_SUPPLY",
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]!.message).toContain("requires a VDD Net");
  });

  it.each([
    {
      symbolId: "voltage-amplifier",
      connections: [
        ["IN", "input_node"],
        ["OUT", "output_node"],
      ] as const,
      card: "X1 VDD VSS input_node output_node voltage_amplifier",
    },
    {
      symbolId: "comparator-inputs-swapped",
      connections: [
        ["IN+", "positive_input"],
        ["IN-", "negative_input"],
        ["OUT", "output_node"],
      ] as const,
      card: "X1 VDD VSS positive_input negative_input output_node comparator",
    },
    {
      symbolId: "differential-transconductance",
      connections: [
        ["IN+", "positive_input"],
        ["IN-", "negative_input"],
        ["OUT", "output_node"],
      ] as const,
      card: "X1 VDD VSS positive_input negative_input output_node differential_transconductance",
    },
  ])("exports the $symbolId contract", ({ symbolId, connections, card }) => {
    const result = createDesignNetlistExport(
      analogBlockProject([symbolId], connections),
      {
        format: "spice",
        profile: createNetlistExportProfile("abstract"),
        portCase: "upper",
      },
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain(card);
  });

  it.each([
    "opamp-differential",
    "opamp-differential-inputs-swapped",
    "opamp-differential-crossed",
    "opamp-differential-crossed-inputs-swapped",
  ])("keeps semantic P/N order for %s", (symbolId) => {
    const result = createDesignNetlistExport(
      analogBlockProject([symbolId], differentialNets),
      {
        format: "spice",
        profile: createNetlistExportProfile("abstract"),
        portCase: "upper",
      },
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain(".subckt dut VDD VSS");
    expect(result.file.text).toContain(
      "X1 VDD VSS plus_node minus_node positive_out negative_out opamp_differential",
    );
    expect(result.file.text).not.toContain(".subckt opamp_differential");
    expect(result.externalMasterCount).toBe(1);
  });

  it("exports legacy blocks without mutating missing reference or netlist data", () => {
    const project = analogBlockProject(
      ["opamp-differential-crossed-lettered-inputs-swapped"],
      differentialNets,
      false,
    );
    const before = structuredClone(project);

    const result = createDesignNetlistExport(project, {
      format: "spectre",
      portCase: "upper",
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain("subckt dut (VDD VSS)");
    expect(result.file.text).toContain(
      "X1 (VDD VSS plus_node minus_node positive_out negative_out) opamp_differential",
    );
    expect(project).toEqual(before);
  });

  it("deduplicates one external master across visual variants", () => {
    const result = createDesignNetlistExport(
      analogBlockProject(
        ["opamp-differential", "opamp-differential-crossed"],
        differentialNets,
      ),
      {
        format: "spice",
        profile: createNetlistExportProfile("abstract"),
        portCase: "upper",
      },
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.externalMasterCount).toBe(1);
    expect(result.file.text).toContain(
      "X2 VDD VSS plus_node1 minus_node1 positive_out1 negative_out1 opamp_differential",
    );
  });

  it("switches formal supply spelling without changing ordinary signal nets", () => {
    const result = createDesignNetlistExport(
      analogBlockProject(["opamp-differential"], differentialNets),
      {
        format: "spectre",
        profile: createNetlistExportProfile("abstract"),
        portCase: "lower",
      },
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain("subckt dut (vdd vss)");
    expect(result.file.text).toContain(
      "X1 (vdd vss plus_node minus_node positive_out negative_out) opamp_differential",
    );
  });

  it("applies the selected case to authored signal ports as one interface", () => {
    const project = createEmptyProject("port-case", "Port Case", "dut");
    const document = project.documents[0]!;
    document.netlist!.name = "dut";
    document.instances.push({
      id: "P1",
      symbolId: "port",
      placement: null,
    });
    document.nets.push({
      id: "net-vin",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    document.netlist!.terminals.push({
      id: "terminal-vin",
      name: "Vin",
      netId: "net-vin",
      direction: "input",
      interfaceInstanceIds: ["P1"],
    });

    const upper = createDesignNetlistExport(project, {
      profile: createNetlistExportProfile("abstract"),
      portCase: "upper",
    });
    const lower = createDesignNetlistExport(project, {
      profile: createNetlistExportProfile("abstract"),
      portCase: "lower",
    });

    expect(upper.status).toBe("ready");
    expect(lower.status).toBe("ready");
    if (upper.status !== "ready" || lower.status !== "ready") return;
    expect(upper.file.text).toContain(".subckt dut VIN\n");
    expect(lower.file.text).toContain(".subckt dut vin\n");
  });
});
