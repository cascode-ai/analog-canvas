import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  CircuitProjectSchema,
  CURRENT_PROJECT_SCHEMA_VERSION,
  createEmptyDocument,
  createEmptyProject,
  deriveStableId,
  type CircuitProject,
  type SchematicDocument,
  type SimulationStructuredInput,
  type SimulationStructuredSetup,
} from "@icm/model";
import fiveTransistorOtaSky130 from "../../../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json";
import {
  buildSimulationDeck,
  readSimulationData,
  type SimulationRequest,
} from "@icm/spice-run";

import { compileStructuredSimulation } from "./simulation-compile.js";

function claimNet(
  document: SchematicDocument,
  netId: string,
  name: string,
  scope: "local" | "global" = "local",
  powerDomain?: "vdd" | "ground",
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
    kind: powerDomain ? "power-label" : "net-label",
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
    ...(powerDomain ? { powerDomain } : {}),
  });
}

function resistor(id: string, reference: string, value: string) {
  return {
    id,
    symbolId: "resistor",
    placement: null,
    reference,
    netlist: {
      binding: { kind: "primitive" as const, deviceClass: "resistor" as const },
      parameters: { value },
    },
  };
}

function voltageSource(
  id: string,
  reference: string,
  parameters: Record<string, string>,
) {
  return {
    id,
    symbolId: "voltage-source",
    placement: null,
    reference,
    netlist: {
      binding: {
        kind: "primitive" as const,
        deviceClass: "voltage-source" as const,
      },
      parameters,
    },
  };
}

const ground = {
  id: "inst-gnd",
  symbolId: "ground",
  placement: null,
};

/**
 * `V1 -> R1 -> R2 -> ground`, the Testbench root of the Project.
 *
 * Net names are authored in upper case on purpose: the deck keeps the
 * author's spelling while every compiled vector is lower case, which is what
 * ngspice writes into the rawfile whichever case it was asked for.
 */
function dividerProject(): CircuitProject {
  const project = createEmptyProject("project", "Project", "tb");
  const tb = project.documents[0]!;
  tb.netlist!.name = "divider_tb";
  tb.instances.push(
    voltageSource("inst-v1", "V1", { dc: "1", acMagnitude: "1" }),
    resistor("inst-r1", "R1", "1k"),
    resistor("inst-r2", "R2", "1k"),
    ground,
  );
  tb.nets.push(
    {
      id: "net-in",
      terminals: [
        { instanceId: "inst-v1", pinName: "+" },
        { instanceId: "inst-r1", pinName: "1" },
      ],
    },
    {
      id: "net-mid",
      terminals: [
        { instanceId: "inst-r1", pinName: "2" },
        { instanceId: "inst-r2", pinName: "1" },
      ],
    },
    {
      id: "net-gnd",
      terminals: [
        { instanceId: "inst-v1", pinName: "-" },
        { instanceId: "inst-r2", pinName: "2" },
        { instanceId: "inst-gnd", pinName: "0" },
      ],
    },
  );
  claimNet(tb, "net-in", "IN");
  claimNet(tb, "net-mid", "MID");
  claimNet(tb, "net-gnd", "0", "global", "ground");
  return project;
}

const DIVIDER_SETUP: SimulationStructuredSetup = {
  version: 3,
  input: {
    kind: "structured",
    designVariables: [],
    runPlan: { mode: "nominal" },
    rootDocumentId: "tb",
    analyses: [
      { kind: "op" },
      { kind: "ac", sweep: "dec", points: 2, startHz: 1, stopHz: 100 },
    ],
    outputs: [
      {
        id: "probe-mid",
        label: "MID",
        expression: {
          kind: "voltage",
          documentId: "tb",
          anchor: { kind: "terminal", instanceId: "inst-r1", pinName: "2" },
          occurrence: [],
        },
      },
      {
        id: "probe-in",
        label: "IN",
        expression: {
          kind: "voltage",
          documentId: "tb",
          anchor: { kind: "terminal", instanceId: "inst-v1", pinName: "+" },
          occurrence: [],
        },
      },
      {
        id: "probe-v1",
        label: "IV1",
        expression: {
          kind: "current",
          documentId: "tb",
          instanceId: "inst-v1",
          pinName: "+",
          occurrence: [],
        },
      },
    ],
    environment: { profileId: "hosted-sky130-v1" },
  },
};

/**
 * A Testbench that instantiates a DUT Cell, so a probe can name a Net that
 * only exists one level down.
 */
function hierarchicalProject(): CircuitProject {
  const project = createEmptyProject("project", "Project", "tb");
  const tb = project.documents[0]!;
  tb.netlist!.name = "dut_tb";
  const dut = createEmptyDocument("dut", "DUT");
  dut.netlist = {
    name: "dut",
    formalParameters: [],
    terminals: [
      {
        id: "dut-terminal-a",
        name: "A",
        netId: "dut-net-a",
        direction: "input",
        interfaceInstanceIds: ["dut-pin-a"],
      },
      {
        id: "dut-terminal-b",
        name: "B",
        netId: "dut-net-b",
        direction: "output",
        interfaceInstanceIds: ["dut-pin-b"],
      },
    ],
  };
  dut.instances.push(
    { id: "dut-pin-a", symbolId: "port", placement: null },
    { id: "dut-pin-b", symbolId: "port", placement: null },
    resistor("dut-rt", "RT", "1k"),
    resistor("dut-rb", "RB", "1k"),
  );
  dut.nets.push(
    {
      id: "dut-net-a",
      terminals: [
        { instanceId: "dut-pin-a", pinName: "P" },
        { instanceId: "dut-rt", pinName: "1" },
      ],
    },
    {
      id: "dut-net-out",
      terminals: [
        { instanceId: "dut-rt", pinName: "2" },
        { instanceId: "dut-rb", pinName: "1" },
      ],
    },
    {
      id: "dut-net-b",
      terminals: [
        { instanceId: "dut-pin-b", pinName: "P" },
        { instanceId: "dut-rb", pinName: "2" },
      ],
    },
  );
  claimNet(dut, "dut-net-out", "OUT");

  tb.instances.push(
    voltageSource("inst-v1", "V1", { dc: "1", acMagnitude: "1" }),
    {
      id: "inst-x1",
      symbolId: "dut-symbol",
      placement: null,
      reference: "X1",
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "dut" },
        parameters: {},
      },
    },
    ground,
  );
  tb.nets.push(
    {
      id: "net-in",
      terminals: [
        { instanceId: "inst-v1", pinName: "+" },
        { instanceId: "inst-x1", pinName: "A" },
      ],
    },
    {
      id: "net-gnd",
      terminals: [
        { instanceId: "inst-v1", pinName: "-" },
        { instanceId: "inst-x1", pinName: "B" },
        { instanceId: "inst-gnd", pinName: "0" },
      ],
    },
  );
  claimNet(tb, "net-in", "IN");
  claimNet(tb, "net-gnd", "0", "global", "ground");
  project.documents.push(dut);
  return project;
}

function addHierarchicalCurrentSource(project: CircuitProject): void {
  const child = project.documents.find((document) => document.id === "dut")!;
  child.instances.push({
    id: "inst-i1",
    symbolId: "current-source",
    placement: null,
    reference: "I1",
    netlist: {
      binding: { kind: "primitive", deviceClass: "current-source" },
      parameters: { dc: "1m" },
    },
  });
  child.nets[0]!.terminals.push({ instanceId: "inst-i1", pinName: "+" });
  child.nets[1]!.terminals.push({ instanceId: "inst-i1", pinName: "-" });
}

function setupWith(
  overrides: Partial<SimulationStructuredInput> & {
    probes?: Array<Record<string, unknown> & { id: string; kind: string }>;
  },
): SimulationStructuredSetup {
  const { probes, ...current } = overrides;
  const outputs = probes
    ? probes.map((probe) => {
        const { id, ...legacyExpression } = probe;
        return {
          id,
          label: id,
          expression: {
            ...legacyExpression,
            kind:
              legacyExpression.kind === "net-voltage" ? "voltage" : "current",
          },
        };
      })
    : current.outputs;
  return {
    version: 3,
    input: {
      ...DIVIDER_SETUP.input,
      outputs: outputs ?? [],
      ...current,
    } as SimulationStructuredInput,
  };
}

async function compile(
  project: CircuitProject,
  setup: SimulationStructuredSetup,
  options?: { timeoutMs?: number },
) {
  return compileStructuredSimulation(project, setup, options);
}

function codes(result: Awaited<ReturnType<typeof compile>>): string[] {
  return result.diagnostics.map((item) => item.code);
}

describe("compiling a structured simulation setup", () => {
  it("derives hierarchy-aware NMOS and PMOS terminal operating points", async () => {
    const project = CircuitProjectSchema.parse({
      ...fiveTransistorOtaSky130,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      simulationSetups: [],
    });
    const result = await compile(
      project,
      setupWith({
        rootDocumentId: "document-ota-5t-testbench",
        analyses: [{ kind: "op" }],
        outputs: [],
        deviceOperatingPoints: [
          {
            id: "op-m1",
            documentId: "document-ota-5t",
            instanceId: "M1",
            occurrence: ["XDUT"],
          },
          {
            id: "op-m3",
            documentId: "document-ota-5t",
            instanceId: "M3",
            occurrence: ["XDUT"],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deviceOperatingPoints).toEqual([
      expect.objectContaining({
        id: "op-m1",
        reference: "XM1",
        polarity: "nmos",
        occurrence: ["XDUT"],
        values: expect.arrayContaining([
          expect.objectContaining({ parameter: "vgs", unit: "V" }),
          expect.objectContaining({ parameter: "vds", unit: "V" }),
          expect.objectContaining({ parameter: "vbs", unit: "V" }),
          expect.objectContaining({ parameter: "id", unit: "A" }),
        ]),
      }),
      expect.objectContaining({
        id: "op-m3",
        reference: "XM3",
        polarity: "pmos",
        occurrence: ["XDUT"],
      }),
    ]);
    expect(result.vectors.some((vector) => vector.quantity === "current")).toBe(
      true,
    );
    expect(
      result.vectors.some((vector) => vector.vector.includes("xdut")),
    ).toBe(true);
    const vectors = result.vectors.map((vector) => vector.vector);
    expect(vectors).toEqual(
      expect.arrayContaining(["v(vinp)", "v(vdd)", "v(xdut.tail)"]),
    );
    expect(vectors).not.toContain("v(0)");
    expect(vectors).not.toContain("v(xdut.vinp)");
    expect(vectors).not.toContain("v(xdut.vdd)");
    expect(JSON.stringify(result.deviceOperatingPoints)).toContain(
      '"kind":"constant","value":0,"unit":"V"',
    );
    expect(result.request.netlist).toContain("VICMPRB");
  });

  it("refuses a selected MOS with unavailable Bulk instead of guessing", async () => {
    const project = CircuitProjectSchema.parse({
      ...fiveTransistorOtaSky130,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      simulationSetups: [],
    });
    const dut = project.documents.find(
      (document) => document.id === "document-ota-5t",
    )!;
    dut.mosBulkDefaults = undefined;
    dut.nets = dut.nets.map((net) => ({
      ...net,
      terminals: net.terminals.filter(
        (terminal) => terminal.instanceId !== "M1" || terminal.pinName !== "B",
      ),
    }));
    const m1 = dut.instances.find((instance) => instance.id === "M1")!;
    m1.mosBulkBinding = undefined;

    const result = await compile(
      project,
      setupWith({
        rootDocumentId: "document-ota-5t-testbench",
        analyses: [{ kind: "op" }],
        outputs: [],
        deviceOperatingPoints: [
          {
            id: "op-m1",
            documentId: "document-ota-5t",
            instanceId: "M1",
            occurrence: ["XDUT"],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    // Structural extraction owns the stronger invariant: a model/subcircuit
    // MOS may not reach simulation with its B terminal missing at all.
    expect(codes(result)).toContain("MISSING_PIN_NET");
  });

  it("compiles Noise against a root independent source and writes both plots", async () => {
    const compiled = await compile(
      dividerProject(),
      setupWith({
        analyses: [
          {
            kind: "noise",
            output: {
              positive: {
                documentId: "tb",
                anchor: {
                  kind: "terminal",
                  instanceId: "inst-r1",
                  pinName: "2",
                },
                occurrence: [],
              },
              negative: {
                documentId: "tb",
                anchor: { kind: "base-net", netId: "net-gnd" },
                occurrence: [],
              },
            },
            inputSourceInstanceId: "inst-v1",
            sweep: "dec",
            points: 20,
            startHz: 1,
            stopHz: 1e6,
          },
        ],
        outputs: [],
        measurements: [
          {
            id: "noise-at-1k",
            label: "Output noise at 1 kHz",
            analysis: "noise",
            outputId: "noise-output-density",
            method: { kind: "sample-at", coordinate: 1_000 },
          },
        ],
      }),
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.request.analyses).toEqual(["noise"]);
    expect(compiled.request.testbench).toContain(
      "noise v(mid,0) V1 dec 20 1 1000000\n",
    );
    expect(compiled.request.testbench).toContain(
      "write out.raw noise1.all noise2.all\n",
    );
    expect(compiled.request.testbench).not.toContain("appendwrite");
    expect(compiled.measurements).toEqual([
      expect.objectContaining({ id: "noise-at-1k" }),
    ]);
  });

  it("refuses an unavailable or non-source Noise input without throwing", async () => {
    const noise = {
      kind: "noise" as const,
      output: {
        positive: {
          documentId: "tb",
          anchor: {
            kind: "terminal" as const,
            instanceId: "inst-r1",
            pinName: "2",
          },
          occurrence: [],
        },
      },
      inputSourceInstanceId: "missing",
      sweep: "dec" as const,
      points: 10,
      startHz: 1,
      stopHz: 1e3,
    };
    const missing = await compile(
      dividerProject(),
      setupWith({ analyses: [noise], outputs: [] }),
    );
    expect(codes(missing)).toContain("SIMULATION_NOISE_SOURCE_UNAVAILABLE");

    const unsupported = await compile(
      dividerProject(),
      setupWith({
        analyses: [{ ...noise, inputSourceInstanceId: "inst-r1" }],
        outputs: [],
      }),
    );
    expect(codes(unsupported)).toContain("SIMULATION_NOISE_SOURCE_UNSUPPORTED");
  });

  it("carries valid saved measurements and locates broken references", async () => {
    const valid = await compile(
      dividerProject(),
      setupWith({
        outputs: DIVIDER_SETUP.input.outputs,
        measurements: [
          {
            id: "mid-op",
            label: "MID bias",
            analysis: "op",
            outputId: "probe-mid",
            method: { kind: "value" },
          },
        ],
      }),
    );
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.measurements).toEqual([
      expect.objectContaining({ id: "mid-op", outputId: "probe-mid" }),
    ]);

    const invalid = await compile(
      dividerProject(),
      setupWith({
        outputs: DIVIDER_SETUP.input.outputs,
        measurements: [
          {
            id: "missing",
            label: "Missing output",
            analysis: "tran",
            outputId: "does-not-exist",
            method: {
              kind: "rms",
              window: { start: 0, stop: 1 },
            },
          },
        ],
      }),
    );
    expect(invalid.ok).toBe(false);
    expect(codes(invalid)).toEqual([
      "SIMULATION_MEASUREMENT_ANALYSIS_UNAVAILABLE",
      "SIMULATION_MEASUREMENT_OUTPUT_UNAVAILABLE",
    ]);
  });

  it("writes the divider Testbench as top-level cards with both analyses", async () => {
    const result = await compile(dividerProject(), DIVIDER_SETUP, {
      timeoutMs: 30_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Nothing but the root is reached, so there is no subcircuit to define.
    expect(result.request.netlist).toBe(
      "* Generated by Interactive Circuit Maker netlist-export/1.0\n",
    );
    expect(result.request.testbench).toBe(
      [
        "* Analog Canvas testbench for divider_tb",
        "R1 IN MID 1k",
        "R2 MID 0 1k",
        "V1 ICMPRB005 0 DC 1 AC 1 0",
        "VICMPRB005 IN ICMPRB005 DC 0",
        ".control",
        "set filetype=ascii",
        "set appendwrite",
        "op",
        "write out.raw v(mid) v(in) i(vicmprb005)",
        "ac dec 2 1 100",
        "write out.raw v(mid) v(in) i(vicmprb005)",
        ".endc",
        ".end",
        "",
      ].join("\n"),
    );
    expect(result.request.analyses).toEqual(["op", "ac"]);
    expect(result.request.timeoutMs).toBe(30_000);
    expect(result.request.inputRevision).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.vectors).toEqual([
      { probeId: "probe-mid", vector: "v(mid)", quantity: "voltage" },
      { probeId: "probe-in", vector: "v(in)", quantity: "voltage" },
      {
        probeId: "probe-v1",
        vector: "i(vicmprb005)",
        quantity: "current",
      },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("omits the timeout the caller did not ask for", async () => {
    const result = await compile(dividerProject(), DIVIDER_SETUP);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("timeoutMs" in result.request).toBe(false);
  });

  it("keeps a single-analysis deck truncating rather than appending", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        analyses: [{ kind: "op" }],
        outputs: [DIVIDER_SETUP.input.outputs[0]!],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.testbench).toContain(
      ["\n.control", "set filetype=ascii", "op", "write out.raw v(mid)"].join(
        "\n",
      ),
    );
    expect(result.request.testbench).not.toContain("appendwrite");
    expect(result.request.analyses).toEqual(["op"]);
  });

  it("compiles a one-source linear DC sweep without changing source bias", async () => {
    const project = dividerProject();
    const result = await compile(
      project,
      setupWith({
        analyses: [
          {
            kind: "dc",
            sourceInstanceId: "inst-v1",
            startValue: 0,
            stopValue: 1.8,
            stepValue: 0.1,
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.analyses).toEqual(["dc"]);
    expect(result.request.testbench).toContain("\nV1 IN 0 DC 1 AC 1 0\n");
    expect(result.request.testbench).toContain("\ndc V1 0 1.8 0.1\n");
  });

  it("derives a negative ngspice increment for a descending DC sweep", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        analyses: [
          {
            kind: "dc",
            sourceInstanceId: "inst-v1",
            startValue: 1.8,
            stopValue: 0,
            stepValue: 0.1,
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.testbench).toContain("\ndc V1 1.8 0 -0.1\n");
  });

  it("locates a missing or unsupported DC sweep source", async () => {
    const missing = await compile(
      dividerProject(),
      setupWith({
        analyses: [
          {
            kind: "dc",
            sourceInstanceId: "missing",
            startValue: 0,
            stopValue: 1,
            stepValue: 0.1,
          },
        ],
      }),
    );
    expect(codes(missing)).toEqual(["SIMULATION_DC_SOURCE_UNAVAILABLE"]);

    const unsupported = await compile(
      dividerProject(),
      setupWith({
        analyses: [
          {
            kind: "dc",
            sourceInstanceId: "inst-r1",
            startValue: 0,
            stopValue: 1,
            stepValue: 0.1,
          },
        ],
      }),
    );
    expect(codes(unsupported)).toEqual(["SIMULATION_DC_SOURCE_UNSUPPORTED"]);
  });

  it("emits the authored temperature as a deck card", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        environment: { profileId: "hosted-sky130-v1", temperatureC: -40 },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.testbench).toContain("\n.temp -40\n.control\n");
  });

  it("prints a reached DUT as a subcircuit and probes into its occurrence", async () => {
    const result = await compile(
      hierarchicalProject(),
      setupWith({
        analyses: [{ kind: "op" }],
        probes: [
          {
            id: "probe-inner",
            kind: "net-voltage",
            documentId: "dut",
            anchor: {
              kind: "terminal",
              instanceId: "dut-rt",
              pinName: "2",
            },
            occurrence: ["inst-x1"],
          },
          {
            id: "probe-root",
            kind: "net-voltage",
            documentId: "tb",
            anchor: {
              kind: "terminal",
              instanceId: "inst-v1",
              pinName: "+",
            },
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.netlist).toBe(
      [
        "* Generated by Interactive Circuit Maker netlist-export/1.0",
        "",
        ".subckt dut A B",
        "RB OUT B 1k",
        "RT A OUT 1k",
        ".ends dut",
        "",
      ].join("\n"),
    );
    expect(result.request.testbench).toBe(
      [
        "* Analog Canvas testbench for dut_tb",
        "V1 IN 0 DC 1 AC 1 0",
        "X1 IN 0 dut",
        ".control",
        "set filetype=ascii",
        "op",
        "write out.raw v(x1.out) v(in)",
        ".endc",
        ".end",
        "",
      ].join("\n"),
    );
    expect(result.vectors).toEqual([
      { probeId: "probe-inner", vector: "v(x1.out)", quantity: "voltage" },
      { probeId: "probe-root", vector: "v(in)", quantity: "voltage" },
    ]);
  });

  it("instruments a selected terminal inside an occurrence", async () => {
    const project = hierarchicalProject();
    const dut = project.documents.find((item) => item.id === "dut")!;
    dut.instances.push(voltageSource("dut-vs", "VSENSE", { dc: "0" }));
    dut.nets.push({
      id: "dut-net-sense",
      terminals: [
        { instanceId: "dut-vs", pinName: "+" },
        { instanceId: "dut-vs", pinName: "-" },
      ],
    });
    claimNet(dut, "dut-net-sense", "SENSE");

    const result = await compile(
      project,
      setupWith({
        analyses: [{ kind: "op" }],
        probes: [
          {
            id: "probe-sense",
            kind: "terminal-current",
            documentId: "dut",
            instanceId: "dut-vs",
            pinName: "+",
            occurrence: ["inst-x1"],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vectors).toEqual([
      {
        probeId: "probe-sense",
        vector: "i(v.x1.vicmprb005)",
        quantity: "current",
      },
    ]);
    expect(result.request.netlist).toContain(
      "VSENSE ICMPRB005 SENSE DC 0\nVICMPRB005 SENSE ICMPRB005 DC 0",
    );
  });

  it("declares a global Net with the definitions, ahead of the testbench", async () => {
    const project = hierarchicalProject();
    const dut = project.documents.find((item) => item.id === "dut")!;
    claimNet(dut, "dut-net-a", "VDD", "global", "vdd");

    const result = await compile(
      project,
      setupWith({ analyses: [{ kind: "op" }] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.netlist.split("\n")[1]).toBe(".global VDD");
    expect(result.request.testbench).not.toContain(".global");
  });

  it("saves the whole plot when the author probed nothing", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({ analyses: [{ kind: "op" }] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.testbench).toContain("\nwrite out.raw\n");
    expect(result.vectors).toEqual([]);
  });

  it("carries extraction warnings instead of dropping them", async () => {
    const project = dividerProject();
    const tb = project.documents[0]!;
    // An unnamed Net still exports, under a generated node name, with a
    // warning the structural export would make an author read first.
    tb.annotations = tb.annotations.filter((item) => item.netId !== "net-mid");
    tb.connectivityEvidence = tb.connectivityEvidence.filter(
      (item) => item.kind !== "name-claim" || item.netId !== "net-mid",
    );

    const result = await compile(
      project,
      setupWith({
        analyses: [{ kind: "op" }],
        outputs: [DIVIDER_SETUP.input.outputs[0]!],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((item) => item.code)).toEqual([
      "GENERATED_NET_NAME",
    ]);
    expect(result.vectors).toEqual([
      { probeId: "probe-mid", vector: "v(n0001)", quantity: "voltage" },
    ]);
  });

  it("writes every vector once even when two probes share a node", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        analyses: [{ kind: "op" }],
        probes: [
          {
            id: "probe-a",
            kind: "net-voltage",
            documentId: "tb",
            anchor: {
              kind: "terminal",
              instanceId: "inst-r1",
              pinName: "2",
            },
            occurrence: [],
          },
          {
            id: "probe-b",
            kind: "net-voltage",
            documentId: "tb",
            anchor: {
              kind: "terminal",
              instanceId: "inst-r2",
              pinName: "1",
            },
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.testbench).toContain("write out.raw v(mid)\n");
    expect(result.vectors.map((item) => item.probeId)).toEqual(["probe-a"]);
    expect(result.outputs).toHaveLength(2);
  });

  it("compiles a derived expression while acquiring only its physical leaves", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        analyses: [
          { kind: "ac", sweep: "dec", points: 2, startHz: 1, stopHz: 100 },
        ],
        outputs: [
          {
            id: "gain-db",
            label: "Gain_dB",
            expression: {
              kind: "db20",
              operand: {
                kind: "divide",
                left: structuredClone(
                  DIVIDER_SETUP.input.outputs[0]!.expression,
                ),
                right: structuredClone(
                  DIVIDER_SETUP.input.outputs[1]!.expression,
                ),
              },
            },
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.testbench).toContain("write out.raw v(mid) v(in)\n");
    expect(result.vectors).toEqual([
      {
        probeId: "gain-db:input:0",
        vector: "v(mid)",
        quantity: "voltage",
      },
      {
        probeId: "gain-db:input:1",
        vector: "v(in)",
        quantity: "voltage",
      },
    ]);
    expect(result.outputs[0]).toMatchObject({
      id: "gain-db",
      label: "Gain_dB",
      expression: {
        kind: "db20",
        operand: { kind: "divide" },
      },
    });
  });

  it("resolves Junction and Route voltage anchors through their current Base Net", async () => {
    const project = dividerProject();
    const document = project.documents[0]!;
    document.junctions.push({
      id: "mid-junction",
      netId: "net-mid",
      position: { x: 100, y: 100 },
    });
    document.routes.push({
      id: "mid-route",
      netId: "net-mid",
      start: { kind: "terminal", instanceId: "inst-r1", pinName: "2" },
      legs: [
        {
          id: "mid-route-leg",
          mode: "manual",
          to: {
            kind: "endpoint",
            endpoint: {
              kind: "terminal",
              instanceId: "inst-r2",
              pinName: "1",
            },
          },
        },
      ],
    });
    const result = await compile(
      project,
      setupWith({
        analyses: [{ kind: "op" }],
        probes: [
          {
            id: "probe-junction",
            kind: "net-voltage",
            documentId: "tb",
            anchor: { kind: "junction", junctionId: "mid-junction" },
            occurrence: [],
          },
          {
            id: "probe-route",
            kind: "net-voltage",
            documentId: "tb",
            anchor: { kind: "route", routeId: "mid-route" },
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vectors).toEqual([
      { probeId: "probe-junction", vector: "v(mid)", quantity: "voltage" },
    ]);
    expect(result.outputs).toHaveLength(2);
  });
});

describe("refusing a setup that cannot be simulated", () => {
  it("reports a root Document the Project does not hold", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({ rootDocumentId: "no-such-testbench" }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("MISSING_ROOT_CELL");
  });

  it("refuses a root that only defines subcircuits", async () => {
    const project = hierarchicalProject();
    const tb = project.documents.find((item) => item.id === "tb")!;
    tb.instances = [];
    tb.nets = [];
    tb.annotations = [];
    tb.connectivityEvidence = [];

    const result = await compile(project, setupWith({}));

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(["SIMULATION_ROOT_HAS_NO_INSTANCES"]);
  });

  it("reports a probe naming a Document that is not in the Project", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        probes: [
          {
            id: "probe-lost",
            kind: "net-voltage",
            documentId: "no-such-document",
            anchor: {
              kind: "terminal",
              instanceId: "inst-r1",
              pinName: "2",
            },
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(["SIMULATION_PROBE_UNKNOWN_DOCUMENT"]);
  });

  it("reports a voltage-probe anchor the Document no longer holds", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        probes: [
          {
            id: "probe-lost",
            kind: "net-voltage",
            documentId: "tb",
            anchor: {
              kind: "terminal",
              instanceId: "no-such-instance",
              pinName: "out",
            },
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(["SIMULATION_PROBE_ANCHOR_UNAVAILABLE"]);
    expect(result.ok === false && result.diagnostics[0]!.primary).toEqual({
      documentId: "tb",
      hierarchyPath: [],
      kind: "instance",
      objectId: "no-such-instance",
      endpoint: {
        kind: "terminal",
        instanceId: "no-such-instance",
        pinName: "out",
      },
    });
  });

  it("reports a probe naming an Instance the Document does not hold", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        probes: [
          {
            id: "probe-lost",
            kind: "terminal-current",
            documentId: "tb",
            instanceId: "no-such-instance",
            pinName: "+",
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(["SIMULATION_PROBE_UNKNOWN_INSTANCE"]);
  });

  it("reports a current output naming a terminal the Instance does not hold", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        probes: [
          {
            id: "probe-lost-terminal",
            kind: "terminal-current",
            documentId: "tb",
            instanceId: "inst-r1",
            pinName: "D",
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(["SIMULATION_PROBE_UNKNOWN_TERMINAL"]);
    expect(result.ok === false && result.diagnostics[0]!.primary).toMatchObject(
      {
        documentId: "tb",
        hierarchyPath: [],
        kind: "instance",
        objectId: "inst-r1",
        endpoint: {
          kind: "terminal",
          instanceId: "inst-r1",
          pinName: "D",
        },
      },
    );
  });

  it("reports an occurrence step that is not a hierarchy Instance", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        probes: [
          {
            id: "probe-lost",
            kind: "net-voltage",
            documentId: "tb",
            anchor: {
              kind: "terminal",
              instanceId: "inst-r1",
              pinName: "2",
            },
            occurrence: ["inst-r1"],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(["SIMULATION_PROBE_INVALID_OCCURRENCE"]);
  });

  it("reports an occurrence that reaches a different Document", async () => {
    const result = await compile(
      hierarchicalProject(),
      setupWith({
        probes: [
          {
            id: "probe-lost",
            kind: "net-voltage",
            documentId: "tb",
            anchor: {
              kind: "terminal",
              instanceId: "inst-v1",
              pinName: "+",
            },
            occurrence: ["inst-x1"],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual([
      "SIMULATION_PROBE_OCCURRENCE_DOCUMENT_MISMATCH",
    ]);
    expect(result.ok === false && result.diagnostics[0]!.primary).toEqual({
      documentId: "dut",
      hierarchyPath: [
        {
          parentDocumentId: "tb",
          instanceId: "inst-x1",
          childDocumentId: "dut",
        },
      ],
      kind: "document",
      objectId: "dut",
    });
  });

  it("writes explicit-SI transient parameters in ngspice argument order", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        analyses: [
          {
            kind: "tran",
            stepSeconds: 1e-6,
            stopSeconds: 1e-3,
            startSeconds: 1e-4,
            maxStepSeconds: 1e-7,
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.analyses).toEqual(["tran"]);
    expect(result.request.testbench).toContain(
      "\ntran 0.000001 0.001 0.0001 1e-7\nwrite out.raw",
    );
  });

  it("instruments a passive-device terminal", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        probes: [
          {
            id: "probe-r1",
            kind: "terminal-current",
            documentId: "tb",
            instanceId: "inst-r1",
            pinName: "1",
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.testbench).toContain(
      "R1 ICMPRB001 MID 1k\nVICMPRB001 IN ICMPRB001 DC 0",
    );
    expect(result.vectors).toEqual([
      {
        probeId: "probe-r1",
        vector: "i(vicmprb001)",
        quantity: "current",
      },
    ]);
  });

  it("instruments a hierarchical Cell instance port", async () => {
    const result = await compile(
      hierarchicalProject(),
      setupWith({
        analyses: [{ kind: "op" }],
        probes: [
          {
            id: "probe-x1-a",
            kind: "terminal-current",
            documentId: "tb",
            instanceId: "inst-x1",
            pinName: "A",
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.testbench).toContain(
      "X1 ICMPRB003 0 dut\nVICMPRB003 IN ICMPRB003 DC 0",
    );
    expect(result.vectors).toEqual([
      {
        probeId: "probe-x1-a",
        vector: "i(vicmprb003)",
        quantity: "current",
      },
    ]);
  });

  it("instruments a top-level independent current source", async () => {
    const project = dividerProject();
    const tb = project.documents[0]!;
    tb.instances.push({
      id: "inst-i1",
      symbolId: "current-source",
      placement: null,
      reference: "I1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "current-source" },
        parameters: { dc: "1m" },
      },
    });
    tb.nets[1]!.terminals.push({ instanceId: "inst-i1", pinName: "+" });
    tb.nets[2]!.terminals.push({ instanceId: "inst-i1", pinName: "-" });

    const result = await compile(
      project,
      setupWith({
        probes: [
          {
            id: "probe-i1",
            kind: "terminal-current",
            documentId: "tb",
            instanceId: "inst-i1",
            pinName: "+",
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.testbench).toContain(
      "I1 ICMPRB001 0 DC 1m\nVICMPRB001 MID ICMPRB001 DC 0",
    );
    expect(result.request.testbench).toContain("write out.raw i(vicmprb001)\n");
    expect(result.vectors).toContainEqual({
      probeId: "probe-i1",
      vector: "i(vicmprb001)",
      quantity: "current",
    });
  });

  it("instruments a current source below the simulation root", async () => {
    const project = hierarchicalProject();
    addHierarchicalCurrentSource(project);

    const result = await compile(
      project,
      setupWith({
        probes: [
          {
            id: "probe-i1",
            kind: "terminal-current",
            documentId: "dut",
            instanceId: "inst-i1",
            pinName: "+",
            occurrence: ["inst-x1"],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.netlist).toContain(
      "I1 ICMPRB001 OUT DC 1m\nVICMPRB001 A ICMPRB001 DC 0",
    );
    expect(result.request.testbench).toContain(
      "write out.raw i(v.x1.vicmprb001)\n",
    );
    expect(result.request.testbench).not.toContain(".probe I(I1)");
    expect(result.vectors).toEqual([
      {
        probeId: "probe-i1",
        vector: "i(v.x1.vicmprb001)",
        quantity: "current",
      },
    ]);
  });

  it("keeps repeated occurrences of one instrumented current source distinct", async () => {
    const project = hierarchicalProject();
    addHierarchicalCurrentSource(project);
    const tb = project.documents.find((document) => document.id === "tb")!;
    const x1 = tb.instances.find((instance) => instance.id === "inst-x1")!;
    tb.instances.push({
      ...structuredClone(x1),
      id: "inst-x2",
      reference: "X2",
    });
    tb.nets[0]!.terminals.push({ instanceId: "inst-x2", pinName: "A" });
    tb.nets[1]!.terminals.push({ instanceId: "inst-x2", pinName: "B" });

    const result = await compile(
      project,
      setupWith({
        probes: [
          {
            id: "probe-i1-x1",
            kind: "terminal-current",
            documentId: "dut",
            instanceId: "inst-i1",
            pinName: "+",
            occurrence: ["inst-x1"],
          },
          {
            id: "probe-i1-x2",
            kind: "terminal-current",
            documentId: "dut",
            instanceId: "inst-i1",
            pinName: "+",
            occurrence: ["inst-x2"],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.request.netlist.match(/VICMPRB001 A ICMPRB001 DC 0/gu),
    ).toHaveLength(1);
    expect(result.vectors).toEqual([
      {
        probeId: "probe-i1-x1",
        vector: "i(v.x1.vicmprb001)",
        quantity: "current",
      },
      {
        probeId: "probe-i1-x2",
        vector: "i(v.x2.vicmprb001)",
        quantity: "current",
      },
    ]);
  });
});

describe("determinism", () => {
  it("compiles the same Project and setup to byte-identical output", async () => {
    const first = await compile(dividerProject(), DIVIDER_SETUP);
    const repeated = await compile(dividerProject(), DIVIDER_SETUP);
    const reopened = await compile(
      JSON.parse(JSON.stringify(dividerProject())) as CircuitProject,
      JSON.parse(JSON.stringify(DIVIDER_SETUP)) as SimulationStructuredSetup,
    );

    expect(repeated).toEqual(first);
    expect(reopened).toEqual(first);
  });

  it("moves the input revision when the setup changes but the deck does not", async () => {
    const first = await compile(dividerProject(), DIVIDER_SETUP);
    const relabelled = await compile(
      dividerProject(),
      setupWith({
        outputs: DIVIDER_SETUP.input.outputs,
        environment: { profileId: "some-other-profile" },
      }),
    );

    expect(first.ok && relabelled.ok).toBe(true);
    if (!first.ok || !relabelled.ok) return;
    expect(relabelled.request.testbench).toBe(first.request.testbench);
    expect(relabelled.request.inputRevision).not.toBe(
      first.request.inputRevision,
    );
  });
});

function ngspiceOnPath(): boolean {
  const probe = spawnSync("ngspice", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

/** Skips cleanly where ngspice is absent; the hosted gate never skips. */
describe.skipIf(!ngspiceOnPath())("running a compiled deck", () => {
  it("runs the compiled Noise command and reads its paired plots", async () => {
    const compiled = await compile(
      dividerProject(),
      setupWith({
        analyses: [
          {
            kind: "noise",
            output: {
              positive: {
                documentId: "tb",
                anchor: {
                  kind: "terminal",
                  instanceId: "inst-r1",
                  pinName: "2",
                },
                occurrence: [],
              },
            },
            inputSourceInstanceId: "inst-v1",
            sweep: "dec",
            points: 5,
            startHz: 1,
            stopHz: 1e3,
          },
        ],
        outputs: [],
      }),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const directory = mkdtempSync(join(tmpdir(), "icm-noise-compile-"));
    try {
      writeFileSync(
        join(directory, "deck.cir"),
        buildSimulationDeck(compiled.request as SimulationRequest, null),
        "utf8",
      );
      execFileSync("ngspice", ["-b", "deck.cir"], {
        cwd: directory,
        encoding: "utf8",
      });
      const reading = readSimulationData(
        readFileSync(join(directory, "out.raw"), "utf8"),
      );
      expect(reading.status).toBe("read");
      if (reading.status !== "read") return;
      const noise = reading.data.analyses[0];
      expect(noise?.analysis).toBe("noise");
      if (noise?.analysis !== "noise") return;
      expect(noise.frequencyHz.length).toBeGreaterThan(10);
      expect(noise.outputNoiseDensity.every(Number.isFinite)).toBe(true);
      expect(noise.inputNoiseDensity.every(Number.isFinite)).toBe(true);
      expect(noise.integratedOutputNoise).toBeGreaterThan(0);
      expect(noise.integratedInputNoise).toBeGreaterThan(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports opposite entering currents at a two-terminal device", async () => {
    const compiled = await compile(
      dividerProject(),
      setupWith({
        analyses: [{ kind: "op" }],
        probes: [
          {
            id: "probe-r1-1",
            kind: "terminal-current",
            documentId: "tb",
            instanceId: "inst-r1",
            pinName: "1",
            occurrence: [],
          },
          {
            id: "probe-r1-2",
            kind: "terminal-current",
            documentId: "tb",
            instanceId: "inst-r1",
            pinName: "2",
            occurrence: [],
          },
        ],
      }),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const directory = mkdtempSync(join(tmpdir(), "icm-terminal-current-"));
    try {
      writeFileSync(
        join(directory, "deck.cir"),
        buildSimulationDeck(compiled.request as SimulationRequest, null),
        "utf8",
      );
      execFileSync("ngspice", ["-b", "deck.cir"], {
        cwd: directory,
        encoding: "utf8",
      });
      const reading = readSimulationData(
        readFileSync(join(directory, "out.raw"), "utf8"),
      );
      expect(reading.status).toBe("read");
      if (reading.status !== "read") return;
      const operatingPoint = reading.data.analyses[0]!;
      expect(operatingPoint.analysis).toBe("op");
      if (operatingPoint.analysis !== "op") return;
      const probes = operatingPoint.probes;
      const value = (name: string) =>
        probes.find((probe) => probe.name === name)!.value;
      expect(value(compiled.vectors[0]!.vector)).toBeCloseTo(0.0005, 12);
      expect(value(compiled.vectors[1]!.vector)).toBeCloseTo(-0.0005, 12);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns the divider's operating point under every emitted vector", async () => {
    const compiled = await compile(dividerProject(), DIVIDER_SETUP);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const deck = buildSimulationDeck(
      compiled.request as SimulationRequest,
      null,
    );
    // `set appendwrite` needs a directory where `out.raw` does not exist yet,
    // which is exactly what the hosted harness makes for every run.
    const directory = mkdtempSync(join(tmpdir(), "icm-simulation-compile-"));
    try {
      writeFileSync(join(directory, "deck.cir"), deck, "utf8");
      execFileSync("ngspice", ["-b", "deck.cir"], {
        cwd: directory,
        encoding: "utf8",
      });
      const reading = readSimulationData(
        readFileSync(join(directory, "out.raw"), "utf8"),
      );

      expect(reading.status).toBe("read");
      if (reading.status !== "read") return;
      expect(reading.data.analyses.map((item) => item.analysis)).toEqual([
        "op",
        "ac",
      ]);
      for (const analysis of reading.data.analyses) {
        if (!("probes" in analysis))
          throw new Error(`Unexpected ${analysis.analysis} result`);
        const names = new Set(analysis.probes.map((probe) => probe.name));
        for (const vector of compiled.vectors) {
          expect(names).toContain(vector.vector);
        }
      }
      const operatingPoint = reading.data.analyses[0]!;
      expect(operatingPoint.analysis).toBe("op");
      if (operatingPoint.analysis !== "op") return;
      const value = (name: string) =>
        operatingPoint.probes.find((probe) => probe.name === name)!.value;
      // 1 V across two equal resistors, and 1 V / 2 kOhm out of the source.
      expect(value("v(in)")).toBeCloseTo(1, 12);
      expect(value("v(mid)")).toBeCloseTo(0.5, 12);
      expect(value("i(vicmprb005)")).toBeCloseTo(-0.0005, 12);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reads a selected hierarchical current source through compiler instrumentation", async () => {
    const project = hierarchicalProject();
    addHierarchicalCurrentSource(project);
    const compiled = await compile(
      project,
      setupWith({
        analyses: [{ kind: "op" }],
        probes: [
          {
            id: "probe-i1",
            kind: "terminal-current",
            documentId: "dut",
            instanceId: "inst-i1",
            pinName: "+",
            occurrence: ["inst-x1"],
          },
        ],
      }),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const deck = buildSimulationDeck(
      compiled.request as SimulationRequest,
      null,
    );
    const directory = mkdtempSync(join(tmpdir(), "icm-hierarchy-current-"));
    try {
      writeFileSync(join(directory, "deck.cir"), deck, "utf8");
      execFileSync("ngspice", ["-b", "deck.cir"], {
        cwd: directory,
        encoding: "utf8",
      });
      const reading = readSimulationData(
        readFileSync(join(directory, "out.raw"), "utf8"),
      );

      expect(reading.status).toBe("read");
      if (reading.status !== "read") return;
      const operatingPoint = reading.data.analyses[0]!;
      expect(operatingPoint.analysis).toBe("op");
      if (operatingPoint.analysis !== "op") return;
      expect(
        operatingPoint.probes.find(
          (probe) => probe.name === "i(v.x1.vicmprb001)",
        )?.value,
      ).toBeCloseTo(0.001, 12);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
