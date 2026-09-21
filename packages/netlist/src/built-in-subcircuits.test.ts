import { describe, expect, it } from "vitest";

import { createEmptyProject, type CircuitProject } from "@icm/model";
import { subcircuitDescriptor } from "@icm/devices";

import { createDesignNetlistExport } from "./export.js";

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
  for (const family of ["opamp", "opamp-differential"])
    for (const state of [
      "",
      "-lettered",
      "-inputs-swapped",
      "-lettered-inputs-swapped",
      ...(family === "opamp-differential"
        ? [
            "-crossed",
            "-crossed-lettered",
            "-crossed-inputs-swapped",
            "-crossed-lettered-inputs-swapped",
          ]
        : []),
    ])
      it.each(["spice", "spectre"] as const)(
        `exports ${family}-wide${state} identically to compact in %s`,
        (format) => {
          const compactId = `${family}${state}`;
          const wideId = `${family}-wide${state}`;
          const connections =
            family === "opamp"
              ? [...differentialNets.slice(0, 2), ["OUT", "output"] as const]
              : differentialNets;
          const compact = analogBlockProject([compactId], connections);
          const wide = analogBlockProject([wideId], connections);
          for (const project of [compact, wide]) {
            const block = project.documents[0]!.instances.find(
              (instance) => instance.id === "block-1",
            )!;
            block.netlist!.parameters = { gain: "100", bandwidth: "10Meg" };
            block.netlist!.binding = {
              kind: "unresolved-subcircuit",
              name: "user_amplifier",
            };
          }
          const original = createDesignNetlistExport(compact, { format });
          const result = createDesignNetlistExport(wide, { format });
          expect(original.status).toBe("ready");
          expect(result.status).toBe("ready");
          if (result.status !== "ready" || original.status !== "ready") return;
          expect(result.file.text).toBe(original.file.text);
          expect(subcircuitDescriptor(wideId)!.target).toBe(
            subcircuitDescriptor(compactId)!.target,
          );
          expect(subcircuitDescriptor(wideId)!.ports).toEqual(
            subcircuitDescriptor(compactId)!.ports,
          );
        },
      );

  it("declares an undrawn block supply as a global without synthesizing interfaces", () => {
    // A Block used at the abstract level with nothing above it yet: its
    // library interface states that it needs these nodes, so the netlist
    // declares them as globals of the declared name and says so. It still
    // adds no Cell port, claims no Net in the Document, and leaves the
    // drawing exactly as it was.
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
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(
      result.diagnostics
        .filter((diagnostic) => diagnostic.code === "DECLARED_BLOCK_SUPPLY")
        .map((diagnostic) => diagnostic.severity),
    ).toEqual(["warning", "warning"]);
    expect(result.file.text).toContain(".global VDD VSS");
    expect(result.file.text).toContain(
      "X1 VDD VSS plus_node minus_node positive_out negative_out opamp_differential",
    );
    // No Cell interface was invented for it.
    expect(result.file.text).toContain(".subckt dut\n");
    expect(project).toEqual(before);
  });
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
      "X1 VDDA VSS plus_node minus_node positive_out negative_out opamp_differential",
    );
    expect(project).toEqual(before);
  });

  it("takes the drawn ground and declares only what is missing", () => {
    // Ground is on the page, so VSS follows it; the positive supply is not,
    // so only that one is declared as a global.
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
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(
      result.diagnostics
        .filter((diagnostic) => diagnostic.code === "DECLARED_BLOCK_SUPPLY")
        .map((diagnostic) => diagnostic.message),
    ).toEqual([
      "Analog Block X1 has no VDD Net in this Cell; its declared supply exports as global node VDD",
    ]);
    expect(result.file.text).toContain(
      "X1 VDD VSS plus_node minus_node positive_out negative_out opamp_differential",
    );
  });

  it("refuses when that supply token is already some other node", () => {
    // An imported Net can carry the spelling VDD without being an authored
    // supply. Declaring a global of the same name would put two different
    // nodes under one token, so the Block's supply stays missing instead.
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
    document.connectivityEvidence = document.connectivityEvidence.map(
      (evidence) =>
        evidence.kind === "net-name-hint" && evidence.netId === "block-1-IN+"
          ? { ...evidence, sourceName: "VDD" }
          : evidence,
    );

    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("blocked");
    const missing = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "MISSING_BLOCK_SUPPLY",
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]!.message).toContain("already spells VDD for a local Net");
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
        ["opamp-differential", "opamp-differential-wide-crossed"],
        differentialNets,
      ),
      {
        format: "spice",
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

  it.each([
    ["Vin", "VIN", "vin"],
    ["F_in_bar", "F_IN_bar", "f_in_bar"],
  ])(
    "applies the selected case to %s without changing its overbar marker",
    (name, uppercase, lowercase) => {
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
        name,
        netId: "net-vin",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      });

      const upper = createDesignNetlistExport(project, {
        portCase: "upper",
      });
      const lower = createDesignNetlistExport(project, {
        portCase: "lower",
      });

      expect(upper.status).toBe("ready");
      expect(lower.status).toBe("ready");
      if (upper.status !== "ready" || lower.status !== "ready") return;
      expect(upper.file.text).toContain(`.subckt dut ${uppercase}\n`);
      expect(lower.file.text).toContain(`.subckt dut ${lowercase}\n`);
    },
  );
});
