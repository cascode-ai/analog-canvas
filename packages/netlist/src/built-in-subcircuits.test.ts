import { describe, expect, it } from "vitest";

import {
  createEmptyProject,
  createSimulationFolder,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import {
  subcircuitDescriptor,
  builtInModelContract,
  builtInSubcircuitDescriptors,
} from "@icm/devices";

import { createDesignNetlistExport } from "./export.js";
import { analyzeDesignNetlistForAuthoring } from "./extract.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import { generateCircuitSource } from "./simulation-circuit-source.js";

const inverterNets = [
  ["A", "in_node"],
  ["Y", "out_node"],
] as const;

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
  it("honors an explicit external master on an amplifier Symbol", () => {
    const project = analogBlockProject(
      ["opamp"],
      [
        ["IN+", "plus"],
        ["IN-", "minus"],
        ["OUT", "out"],
      ],
    );
    project.externalSubcircuitDefinitions.push({
      id: "custom",
      name: "custom_amp",
      interfaceStatus: "declared",
      terminals: ["IN+", "IN-", "OUT"].map((name, i) => ({
        id: `p${i}`,
        name,
        direction: "passive" as const,
      })),
      formalParameters: [{ name: "custom_gain", defaultValue: "1" }],
      implementation: {
        kind: "source",
        sourceId: "custom-source",
        entry: "custom_amp",
      },
    });
    project.modelSources = [
      {
        id: "custom-source",
        language: "spice",
        revision: 1,
        entry: "custom.spice",
        dependencies: [],
        files: [
          {
            path: "custom.spice",
            text: ".subckt custom_amp IN+ IN- OUT params: custom_gain=1\nE1 OUT 0 IN+ IN- {custom_gain}\n.ends custom_amp\n",
          },
        ],
      },
    ];
    const instance = project.documents[0]!.instances.find(
      (i) => i.id === "block-1",
    )!;
    instance.netlist = {
      binding: { kind: "external-subcircuit", definitionId: "custom" },
      parameters: { custom_gain: "{g}" },
    };
    const result = createDesignNetlistExport(project);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain(
      "X1 plus minus out custom_amp custom_gain={g}",
    );
    expect(result.file.text).not.toContain(".subckt opamp ");
    expect(result.file.text).toContain(project.modelSources[0]!.files[0]!.text);
  });
  it("exports a logic gate with its generated ideal body", () => {
    // Issue #1255 asked for a body or a blocking diagnostic; a placed gate
    // now gets the body, so nobody has to draw its transistors.
    const project = analogBlockProject(
      ["nand-gate", "nand-gate"],
      [
        ["VDD", "vdd"],
        ["VSS", "vss"],
        ["A", "a"],
        ["B", "b"],
        ["Y", "y"],
      ],
    );
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const text = result.file.text;
    expect(
      text.split(".subckt nand_gate VDD VSS A B Y params: vt=10m td=10p"),
    ).toHaveLength(2);
    expect(text).toMatch(/^X1 \S+ \S+ a b y nand_gate$/mu);
    expect(text).toMatch(/^X2 \S+ \S+ a1 b1 y1 nand_gate$/mu);
    expect(result.externalMasterCount).toBe(0);

    // Both backends now include the same combinational recipe once.
    const spectre = createDesignNetlistExport(project, { format: "spectre" });
    expect(spectre.status).toBe("ready");
    if (spectre.status !== "ready") return;
    expect(
      spectre.file.text.split("subckt nand_gate (VDD VSS A B Y)"),
    ).toHaveLength(2);
    expect(spectre.file.text).toContain("Cd (ndl VSS) capacitor c=td/1000");
    expect(spectre.file.text).toMatch(/^X1 \(.*\) nand_gate$/mu);
    expect(spectre.diagnostics).toEqual([]);
    expect(spectre.externalMasterCount).toBe(0);
  });

  it.each(
    builtInSubcircuitDescriptors.filter(
      (d) => builtInModelContract(d.target)?.family === "logic",
    ),
  )(
    "honors Spectre model capability for $symbolId without changing its interface",
    (descriptor) => {
      const connections = descriptor.ports.flatMap((p) =>
        p.pinName ? [[p.pinName, p.name.toLowerCase()] as const] : [],
      );
      const project = analogBlockProject([descriptor.symbolId], connections);
      const before = structuredClone(project);
      const result = createDesignNetlistExport(project, { format: "spectre" });
      expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
      if (result.status !== "ready") return;
      const included =
        builtInModelContract(descriptor.target)!.backends.spectre ===
        "included";
      expect(result.file.text.includes(`subckt ${descriptor.target} (`)).toBe(
        included,
      );
      expect(
        result.diagnostics.some((d) => d.code === "SPECTRE_MODEL_NOT_INCLUDED"),
      ).toBe(!included);
      expect(result.file.text).not.toMatch(/V=\{|\.subckt/u);
      expect(project).toEqual(before);
    },
  );

  describe("comparator models", () => {
    const comparatorPins = [
      ["IN+", "plus"],
      ["IN-", "minus"],
      ["OUT", "out"],
    ] as const;

    it("blocks an older comparator with no model instead of calling an undefined subcircuit", () => {
      // Issue #1255: an unbound comparator exported `X1 … comparator` as ready.
      const result = createDesignNetlistExport(
        analogBlockProject(["comparator"], comparatorPins, false),
      );
      expect(result.status).toBe("blocked");
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "UNDEFINED_SUBCIRCUIT_TARGET",
            message: expect.stringContaining(
              "Replace it from the Library (a placed comparator uses the built-in ideal comparator)",
            ),
          }),
        ]),
      );
    });

    it("accepts an older comparator when the Project defines comparator", () => {
      const project = analogBlockProject(["comparator"], comparatorPins, false);
      project.externalSubcircuitDefinitions = [
        {
          id: "own-comparator",
          name: "comparator",
          terminals: ["VDD", "VSS", "VIP", "VIN", "VOUT"].map((name) => ({
            name,
          })),
          formalParameters: [],
        },
      ] as never;
      const result = createDesignNetlistExport(project);
      expect(
        result.diagnostics.filter(
          (d) => d.code === "UNDEFINED_SUBCIRCUIT_TARGET",
        ),
      ).toEqual([]);
    });
  });

  it.each([
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

  it("limits an ideal op-amp to its drawn supplies, and to ±5 V without them (#1463)", () => {
    const opamp = (
      parameters: Record<string, string>,
      powered = true,
      format: "spice" | "spectre" = "spice",
    ) => {
      const project = analogBlockProject(
        ["opamp"],
        [
          ["IN+", "plus"],
          ["IN-", "minus"],
          ["OUT", "out"],
        ],
      );
      const document = project.documents[0]!;
      Object.assign(
        document.instances.find((item) => item.id === "block-1")!.netlist!
          .parameters,
        parameters,
      );
      if (!powered) {
        // A textbook figure: no positive supply drawn.
        document.instances = document.instances.filter((i) => i.id !== "VDD");
        document.nets = document.nets.filter((net) => net.id !== "VDD");
        document.netlist!.terminals = document.netlist!.terminals.filter(
          (terminal) => terminal.netId !== "VDD",
        );
      }
      return createDesignNetlistExport(project, { format });
    };
    const text = (result: ReturnType<typeof opamp>) =>
      result.status === "ready" ? result.file.text : "";

    // Drawn VDD: both limits read the op-amp's own supplies.
    const powered = text(opamp({}));
    expect(powered).toContain("X1 VDD VSS plus minus out icm_opamp_vdd_vss\n");
    expect(powered).toContain(
      ".subckt icm_opamp_vdd_vss VDD VSS VIP VIN VOUT params: gain=1e6",
    );
    expect(powered).toContain("Blin nlin 0 V={gain*(V(VIP)-V(VIN))}");
    expect(powered).toContain(
      "Bcore VOUT 0 V={0.5*(V(VDD)+(0.5*(V(VSS)+V(nlin)",
    );
    expect(powered).not.toContain("vhigh");

    // No supply drawn: the numeric body, whose defaults are ±5 V.
    const unpowered = text(opamp({}, false));
    expect(unpowered).toContain("X1 0 VSS plus minus out opamp\n");
    expect(unpowered).toContain(
      ".subckt opamp VDD VSS VIP VIN VOUT params: gain=1e6 vhigh=5 vlow=-5",
    );
    expect(unpowered).toContain(
      "Bcore VOUT 0 V={0.5*(vhigh+(0.5*(vlow+V(nlin)",
    );

    // Typed levels win over the supplies; a supply limit may be any case.
    expect(text(opamp({ vhigh: "12", vlow: "-12" }))).toContain(
      "X1 VDD VSS plus minus out opamp vhigh=12 vlow=-12",
    );
    expect(text(opamp({ vhigh: "vdd", vlow: "0.2" }))).toContain(
      "X1 VDD VSS plus minus out icm_opamp_vdd vlow=0.2",
    );
    expect(text(opamp({ vhigh: "3" }))).toContain(
      "X1 VDD VSS plus minus out icm_opamp_vss vhigh=3",
    );
    // Without a supply, a level below the default high limit still fits.
    expect(text(opamp({ vlow: "-1" }, false))).toContain(
      "X1 0 VSS plus minus out opamp vlow=-1",
    );

    for (const [parameters, powered, message] of [
      [{ vhigh: "rail" }, true, "requires vhigh to be a number or VDD"],
      [{ vlow: "VDD" }, true, "requires vlow to be a number or VSS"],
      [{ vhigh: "1", vlow: "2" }, true, "high limit, 1 V, must be above"],
      [
        { vlow: "6" },
        false,
        "high limit, 5 V, must be above its low limit, 6 V",
      ],
    ] as const) {
      const refused = opamp(parameters, powered);
      expect(refused.status).toBe("blocked");
      expect(refused.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "INVALID_IDEAL_OPAMP_LIMIT",
          message: expect.stringContaining(message),
        }),
      );
    }

    // Spectre prints the same equations as behavioral sources.
    const spectre = text(opamp({}, true, "spectre"));
    expect(spectre).toContain(
      "subckt icm_opamp_vdd_vss (VDD VSS VIP VIN VOUT)",
    );
    expect(spectre).toContain("Blin (nlin 0) bsource v=gain*(v(VIP)-v(VIN))");
  });

  it("powers an op-amp only from a supply the author drew or chose (#1463)", () => {
    const opampWith = (change: (document: SchematicDocument) => void) => {
      const project = analogBlockProject(
        ["opamp"],
        [
          ["IN+", "plus"],
          ["IN-", "minus"],
          ["OUT", "out"],
        ],
      );
      change(project.documents[0]!);
      return createDesignNetlistExport(project);
    };
    // No VDD drawn, but an inverter's body takes the default VDD Pin: the
    // op-amp stays on its ±5 V levels.
    const defaulted = opampWith((document) => {
      document.instances = document.instances.filter((i) => i.id !== "VDD");
      document.nets = document.nets.filter((net) => net.id !== "VDD");
      document.netlist!.terminals = document.netlist!.terminals.filter(
        (terminal) => terminal.netId !== "VDD",
      );
      document.instances.push({
        id: "inverter",
        reference: "X9",
        symbolId: "inverter",
        placement: null,
      });
      for (const pinName of ["A", "Y"])
        document.nets.push({
          id: `inverter-${pinName}`,
          terminals: [{ instanceId: "inverter", pinName }],
        });
    });
    expect(
      defaulted.status,
      JSON.stringify(
        defaulted.diagnostics.filter((d) => d.severity === "error"),
      ),
    ).toBe("ready");
    if (defaulted.status === "ready") {
      expect(defaulted.file.text).toMatch(/^X1 VDD VSS \S+ \S+ \S+ opamp$/mu);
      expect(defaulted.file.text).not.toContain("icm_opamp");
    }
    // Two positive supplies drawn: the limits fall back, and say so.
    const addVdda = (document: SchematicDocument) => {
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
    };
    const competing = opampWith(addVdda);
    expect(
      competing.status,
      JSON.stringify(
        competing.diagnostics.filter((d) => d.severity === "error"),
      ),
    ).toBe("ready");
    if (competing.status === "ready")
      expect(competing.file.text).toContain("X1 0 VSS plus minus out opamp\n");
    expect(competing.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IDEAL_OPAMP_SUPPLY_AMBIGUOUS",
        severity: "warning",
        message: expect.stringContaining(
          "X1's high limit reads +5 V and low limit reads −5 V: several drawn supplies",
        ),
      }),
    );
    // A typed level stays; the warning names only the limit that falls back.
    const typed = opampWith((document) => {
      addVdda(document);
      document.instances.find(
        (i) => i.id === "block-1",
      )!.netlist!.parameters.vhigh = "12";
    });
    expect(typed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IDEAL_OPAMP_SUPPLY_AMBIGUOUS",
        message: expect.stringContaining(
          "X1's low limit reads −5 V: several drawn supplies",
        ),
      }),
    );
    // Powered, with two candidates for its VSS: the low limit reads ground.
    const grounds = opampWith((document) => {
      document.instances.push({
        id: "GND2",
        symbolId: "ground",
        placement: null,
      });
      document.nets.push({
        id: "net-gnd2",
        terminals: [{ instanceId: "GND2", pinName: "0" }],
      });
    });
    expect(grounds.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IDEAL_OPAMP_SUPPLY_AMBIGUOUS",
        message: expect.stringContaining(
          "X1's low limit reads ground: several drawn Nets could be its VSS",
        ),
      }),
    );
    // A warning, never a block.
    expect(grounds.status).toBe("ready");
    if (grounds.status === "ready")
      expect(grounds.file.text).toContain(
        "X1 VDD 0 plus minus out icm_opamp_vdd_vss\n",
      );
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
      "X1 VDD VSS plus minus out icm_opamp_vdd_vss gain=2e3",
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
      ".subckt icm_opamp_vdd_vss VDD VSS VIP VIN VOUT params: gain=1e6",
    );
    expect(generated).toContain("Blin nlin 0 V={gain*(V(VIP)-V(VIN))}");
    expect(generated).toContain("X1 VDD VSS plus minus out icm_opamp_vdd_vss");
    expect(generated.match(/\.subckt icm_opamp_vdd_vss\b/gu)).toHaveLength(1);
  });

  it("includes a logic gate's ideal body in an ngspice simulation", () => {
    const project = analogBlockProject(
      ["d-flip-flop", "d-flip-flop"],
      [
        ["D", "d"],
        ["CK", "ck"],
        ["Q", "q"],
        ["QBAR", "qb"],
      ],
    );
    const folder = createSimulationFolder({
      id: "logic-probe",
      name: "Logic probe",
      profileId: "local",
      documentId: project.documents[0]!.id,
    });
    folder.input.files.find((file) => file.path === folder.input.entry)!.text =
      "Logic probe\n.include circuit.spice\n.control\nop\n.endc\n.end\n";
    const compiled = compileNgspiceSourceSimulation(project, folder);
    expect(
      compiled.ok,
      JSON.stringify(compiled.ok ? [] : compiled.diagnostics),
    ).toBe(true);
    if (!compiled.ok) return;
    const generated = compiled.files.find(
      (file) => file.path === "circuit.spice",
    )!.text;
    // Two flip-flops, one body.
    expect(generated.match(/\.subckt d_flip_flop\b/gu)).toHaveLength(1);
    expect(generated).toMatch(/^X2 \S+ \S+ d1 ck1 q1 qb1 d_flip_flop$/mu);
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
      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      expect(result.file.text).toContain(
        `.subckt ${family}_gate_4 VDD VSS A B C D Y params: vt=10m td=10p`,
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
      it.each(["spice"] as const)(
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

  it("gives an undrawn block supply the default a MOS body takes, never a global", () => {
    // An inverter's body switches at V(VDD,VSS)/2: it needs both supplies. A
    // textbook logic figure draws none, as it draws no MOS body.
    const project = analogBlockProject(["inverter"], inverterNets);
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
    expect(result.file.text).toContain(".subckt dut VDD VSS\n");
    expect(result.file.text).toContain("X1 VDD VSS in_node out_node inverter");
    expect(result.file.text).not.toMatch(/\.global/u);
    expect(result.diagnostics).toEqual([]);
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

  it("defaults only the supply the author did not draw, never as a global", () => {
    // An inverter's body switches at V(VDD,VSS)/2: it needs both supplies.
    const project = analogBlockProject(["inverter"], inverterNets);
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
    expect(result.file.text).toContain(".subckt dut VDD VSS\n");
    expect(result.file.text).toContain("X1 VDD VSS in_node out_node inverter");
    expect(result.file.text).not.toMatch(/\.global/u);
  });

  it("does not mistake a same-named signal for the supply", () => {
    // An inverter's body switches at V(VDD,VSS)/2: it needs both supplies.
    const project = analogBlockProject(["inverter"], inverterNets);
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
        evidence.kind === "net-name-hint" && evidence.netId === "block-1-A"
          ? { ...evidence, sourceName: "VDD" }
          : evidence,
    );

    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // The input keeps its own node; the supply is the default one.
    expect(result.file.text).toContain("X1 VDD VSS VDD__2 out_node inverter");
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "DISAMBIGUATED_SOURCE_NET_NAME",
    ]);
  });

  it("requires explicit selection when two positive supplies are drawn", () => {
    // An inverter's body switches at V(VDD,VSS)/2: it needs both supplies.
    const project = analogBlockProject(["inverter"], inverterNets);
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
      "X1 VDDA VSS in_node out_node inverter",
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
    const project = analogBlockProject([symbolId], connections);
    // The bare comparator target is a contract with a definition the Project
    // supplies; nothing built in defines it (#1255).
    if (card.endsWith(" comparator"))
      project.externalSubcircuitDefinitions = [
        {
          id: "own-comparator",
          name: "comparator",
          terminals: ["VDD", "VSS", "VIP", "VIN", "VOUT"].map((name) => ({
            name,
          })),
          formalParameters: [],
        },
      ] as never;
    const result = createDesignNetlistExport(project, {
      format: "spice",
      portCase: "upper",
    });

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
