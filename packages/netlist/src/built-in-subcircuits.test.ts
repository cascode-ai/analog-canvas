import { describe, expect, it } from "vitest";

import {
  createEmptyProject,
  createSimulationFolder,
  type CircuitProject,
} from "@icm/model";
import { subcircuitDescriptor } from "@icm/devices";

import { createDesignNetlistExport } from "./export.js";
import { analyzeDesignNetlistForAuthoring } from "./extract.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import { generateCircuitSource } from "./simulation-circuit-source.js";

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
  it("blocks logic subcircuits whose targets have no emitted definition", () => {
    const result = createDesignNetlistExport(
      analogBlockProject(
        ["nand-gate"],
        [
          ["VDD", "vdd"],
          ["VSS", "vss"],
          ["A", "a"],
          ["B", "b"],
          ["Y", "y"],
        ],
      ),
    );
    expect(result.status).toBe("blocked");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNDEFINED_SUBCIRCUIT_TARGET",
          message: expect.stringContaining("nand_gate"),
        }),
      ]),
    );
  });

  it.each([
    {
      symbolId: "opamp",
      connections: [
        ["IN+", "plus"],
        ["IN-", "minus"],
        ["OUT", "out"],
      ],
      name: "opamp",
      parameter: "gain=1e6",
      body: "ECORE VOUT 0 VIP VIN {gain}",
    },
    {
      symbolId: "opamp-differential",
      connections: [
        ["IN+", "plus"],
        ["IN-", "minus"],
        ["OUT+", "out_plus"],
        ["OUT-", "out_minus"],
      ],
      name: "opamp_differential",
      parameter: "gain=1e6",
      body: "EPLUS VOP 0 VIP VIN {gain/2}",
    },
    {
      symbolId: "voltage-amplifier",
      connections: [
        ["IN", "input"],
        ["OUT", "output"],
      ],
      name: "voltage_amplifier",
      parameter: "gain=1",
      body: "ECORE VOUT 0 VIN 0 {gain}",
    },
    {
      symbolId: "transconductance",
      connections: [
        ["A", "input"],
        ["Y", "output"],
      ],
      name: "transconductance",
      parameter: "gm=1m",
      body: "GCORE 0 VOUT VIN 0 {gm}",
    },
    {
      symbolId: "differential-transconductance",
      connections: [
        ["IN+", "plus"],
        ["IN-", "minus"],
        ["OUT", "output"],
      ],
      name: "differential_transconductance",
      parameter: "gm=1m",
      body: "GCORE 0 VOUT VIP VIN {gm}",
    },
  ])("defines one native E/G-source master for $symbolId", (entry) => {
    const result = createDesignNetlistExport(
      analogBlockProject(
        [entry.symbolId],
        entry.connections as [string, string][],
      ),
    );
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain(`.subckt ${entry.name} `);
    expect(result.file.text).toContain(`params: ${entry.parameter}`);
    expect(result.file.text).toContain(entry.body);
    expect(result.externalMasterCount).toBe(0);
  });

  it.each(["user_amp", "toString"])(
    "keeps a retargeted opamp on the user's external %s subcircuit",
    (target) => {
      const project = analogBlockProject(
        ["opamp"],
        [
          ["IN+", "plus"],
          ["IN-", "minus"],
          ["OUT", "out"],
        ],
      );
      project.documents[0]!.instances.find(
        (item) => item.id === "block-1",
      )!.netlist!.binding = {
        kind: "unresolved-subcircuit",
        name: target,
      };
      const result = createDesignNetlistExport(project);
      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      expect(result.file.text).toContain(` ${target}`);
      expect(result.file.text).not.toContain(".subckt opamp ");
      expect(result.externalMasterCount).toBe(1);
    },
  );

  it("keeps an explicitly declared master ahead of the built-in ideal model", () => {
    const project = analogBlockProject(
      ["opamp"],
      [
        ["IN+", "plus"],
        ["IN-", "minus"],
        ["OUT", "out"],
      ],
    );
    project.externalSubcircuitDefinitions.push({
      id: "external-opamp",
      name: "opamp",
      interfaceStatus: "declared",
      formalParameters: [],
      terminals: ["VDD", "VSS", "VIP", "VIN", "VOUT"].map((name) => ({
        id: `external-${name}`,
        name,
        direction: "passive" as const,
      })),
    });
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).not.toContain(".subckt opamp ");
    expect(result.externalMasterCount).toBe(1);
  });

  it("passes a raw gain override through the ideal model call", () => {
    const project = analogBlockProject(
      ["opamp"],
      [
        ["IN+", "plus"],
        ["IN-", "minus"],
        ["OUT", "out"],
      ],
    );
    project.documents[0]!.instances.find(
      (item) => item.id === "block-1",
    )!.netlist!.parameters.gain = "2e3";
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain(
      "X1 VDD VSS plus minus out opamp gain=2e3",
    );
  });

  it("includes the built-in model in an ngspice simulation binding", () => {
    const project = analogBlockProject(
      ["opamp"],
      [
        ["IN+", "plus"],
        ["IN-", "minus"],
        ["OUT", "out"],
      ],
    );
    const folder = createSimulationFolder({
      id: "ideal-opamp-probe",
      name: "Ideal opamp probe",
      profileId: "local",
      documentId: project.documents[0]!.id,
    });
    folder.input.files.find((file) => file.path === folder.input.entry)!.text =
      "Ideal opamp probe\n.include circuit.spice\n.control\nop\n.endc\n.end\n";
    const compiled = compileNgspiceSourceSimulation(project, folder);
    expect(
      compiled.ok,
      JSON.stringify(compiled.ok ? [] : compiled.diagnostics),
    ).toBe(true);
    if (!compiled.ok) return;
    const generated = compiled.files.find(
      (file) => file.path === "circuit.spice",
    )!.text;
    expect(generated).toContain(
      ".subckt opamp VDD VSS VIP VIN VOUT params: gain=1e6",
    );
    expect(generated).toContain("ECORE VOUT 0 VIP VIN {gain}");
    expect(generated).toContain("X1 VDD VSS plus minus out opamp");
    expect(generated.match(/\.subckt opamp\b/gu)).toHaveLength(1);
  });

  it.each(["ngspice", "vacask"] as const)(
    "opens an editable %s circuit with a generated ideal-model Cell",
    (engine) => {
      const project = analogBlockProject(
        ["opamp"],
        [
          ["IN+", "plus"],
          ["IN-", "minus"],
          ["OUT", "out"],
        ],
      );
      const result = generateCircuitSource(
        project,
        {
          id: "circuit",
          path: "circuit.spice",
          documentId: "dut",
          emission: "top-level",
        },
        undefined,
        engine,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(
          result.source.instances.some((item) => item.instanceId === "block-1"),
        ).toBe(true);
        expect(
          result.source.parameters.every((item) => item.documentId === "dut"),
        ).toBe(true);
      }
    },
  );

  it.each(["and", "nand", "or", "nor", "xor", "xnor"])(
    "exports every four-input %s terminal in its declared electrical order",
    (family) => {
      const project = analogBlockProject(
        [`${family}-gate-4`],
        [
          ["A", "a"],
          ["B", "b"],
          ["C", "c"],
          ["D", "d"],
          ["Y", "y"],
        ],
      );
      const result = createDesignNetlistExport(project);
      expect(result.status).toBe("blocked");
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "UNDEFINED_SUBCIRCUIT_TARGET",
            message: expect.stringContaining(`${family}_gate_4`),
          }),
        ]),
      );
      const authoring = analyzeDesignNetlistForAuthoring(project);
      const instance = authoring.ir?.cells
        .find((cell) => cell.id === "dut")
        ?.instances.find((item) => item.id === "block-1");
      expect(instance?.nodes.map((node) => node.netName)).toEqual([
        "VDD",
        "VSS",
        "a",
        "b",
        "c",
        "d",
        "y",
      ]);
      expect(instance?.target).toBe(`${family}_gate_4`);
    },
  );
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

  it("blocks an undrawn block supply rather than declaring a global", () => {
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
    expect(result.status).toBe("blocked");
    expect(
      result.diagnostics
        .filter((diagnostic) => diagnostic.code === "MISSING_BLOCK_SUPPLY")
        .map((diagnostic) => diagnostic.message),
    ).toEqual([
      expect.stringContaining("select one in Properties"),
      expect.stringContaining("select one in Properties"),
    ]);
    expect(project).toEqual(before);
  });

  it("uses explicit property-only supply bindings ahead of Auto", () => {
    const project = analogBlockProject(
      ["opamp-differential"],
      differentialNets,
    );
    const document = project.documents[0]!;
    const positive = document.nets.find((net) => net.id === "block-1-IN+")!;
    const negative = document.nets.find((net) => net.id === "block-1-IN-")!;
    positive.terminals.push({ instanceId: "block-1", pinName: "VDD" });
    negative.terminals.push({ instanceId: "block-1", pinName: "VSS" });

    for (const format of ["spice", "spectre"] as const) {
      const result = createDesignNetlistExport(project, { format });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") continue;
      expect(result.file.text).toContain(
        format === "spice"
          ? "X1 plus_node minus_node plus_node minus_node positive_out negative_out opamp_differential"
          : "X1 (plus_node minus_node plus_node minus_node positive_out negative_out) opamp_differential",
      );
      expect(result.file.text).not.toContain(".global VDD VSS");
    }
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

  it("does not turn one missing supply into a global when the other is drawn", () => {
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
    expect(
      result.diagnostics
        .filter((diagnostic) => diagnostic.code === "MISSING_BLOCK_SUPPLY")
        .map((diagnostic) => diagnostic.message),
    ).toEqual([
      "Analog Block X1 has no unambiguous VDD Net; select one in Properties or draw a unique positive supply",
    ]);
  });

  it("does not mistake a same-named signal for an automatic supply", () => {
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
    expect(missing).toHaveLength(2);
    expect(missing[0]!.message).toContain("select one in Properties");
  });

  it("requires explicit selection when two positive supplies are drawn", () => {
    const project = analogBlockProject(
      ["opamp-differential"],
      differentialNets,
    );
    const document = project.documents[0]!;
    document.instances.push({
      id: "VDDA",
      symbolId: "vdd-port",
      placement: null,
    });
    document.nets.push({
      id: "net-vdda",
      terminals: [{ instanceId: "VDDA", pinName: "P" }],
    });
    document.connectivityEvidence.push({
      id: "vdda-claim",
      kind: "name-claim",
      netId: "net-vdda",
      name: "VDDA",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "power-marker", objectId: "VDDA" },
    });

    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("blocked");
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "MISSING_BLOCK_SUPPLY",
      ),
    ).toHaveLength(1);
    document.nets
      .find((net) => net.id === "net-vdda")!
      .terminals.push({
        instanceId: "block-1",
        pinName: "VDD",
      });
    const explicit = createDesignNetlistExport(project);
    expect(explicit.status).toBe("ready");
    if (explicit.status !== "ready") return;
    expect(explicit.file.text).toContain(
      "X1 VDDA VSS plus_node minus_node positive_out negative_out opamp_differential",
    );
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
    expect(result.file.text).toContain(
      ".subckt opamp_differential VDD VSS VIP VIN VOP VON params: gain=1e6",
    );
    expect(result.file.text).toContain("EPLUS VOP 0 VIP VIN {gain/2}");
    expect(result.file.text).toContain("EMINUS VON 0 VIN VIP {gain/2}");
    expect(result.externalMasterCount).toBe(0);
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
    expect(result.file.text).toContain(
      "subckt opamp_differential (VDD VSS VIP VIN VOP VON)",
    );
    expect(result.file.text).toContain(
      "EPLUS (VOP 0 VIP VIN) vcvs gain=gain/2",
    );
    expect(project).toEqual(before);
  });

  it("deduplicates one ideal model across visual variants", () => {
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
    expect(result.externalMasterCount).toBe(0);
    expect(
      result.file.text.match(/\.subckt opamp_differential\b/gu),
    ).toHaveLength(1);
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
