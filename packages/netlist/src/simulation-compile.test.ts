import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  deriveStableId,
  type CircuitProject,
  type SchematicDocument,
  type SimulationSetup,
} from "@icm/model";
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

const DIVIDER_SETUP: SimulationSetup = {
  version: 1,
  input: {
    kind: "structured",
    rootDocumentId: "tb",
    analyses: [
      { kind: "op" },
      { kind: "ac", sweep: "dec", points: 2, startHz: 1, stopHz: 100 },
    ],
    probes: [
      {
        id: "probe-mid",
        kind: "net-voltage",
        documentId: "tb",
        netId: "net-mid",
        occurrence: [],
      },
      {
        id: "probe-in",
        kind: "net-voltage",
        documentId: "tb",
        netId: "net-in",
        occurrence: [],
      },
      {
        id: "probe-v1",
        kind: "source-current",
        documentId: "tb",
        instanceId: "inst-v1",
        occurrence: [],
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

function setupWith(
  overrides: Partial<SimulationSetup["input"]>,
): SimulationSetup {
  return {
    version: 1,
    input: { ...DIVIDER_SETUP.input, probes: [], ...overrides },
  };
}

async function compile(
  project: CircuitProject,
  setup: SimulationSetup,
  options?: { timeoutMs?: number },
) {
  return compileStructuredSimulation(project, setup, options);
}

function codes(result: Awaited<ReturnType<typeof compile>>): string[] {
  return result.diagnostics.map((item) => item.code);
}

describe("compiling a structured simulation setup", () => {
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
        "V1 IN 0 DC 1 AC 1 0",
        ".control",
        "set filetype=ascii",
        "set appendwrite",
        "op",
        "write out.raw v(mid) v(in) i(v1)",
        "ac dec 2 1 100",
        "write out.raw v(mid) v(in) i(v1)",
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
      { probeId: "probe-v1", vector: "i(v1)", quantity: "current" },
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
        probes: [DIVIDER_SETUP.input.probes[0]!],
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
            netId: "dut-net-out",
            occurrence: ["inst-x1"],
          },
          {
            id: "probe-root",
            kind: "net-voltage",
            documentId: "tb",
            netId: "net-in",
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

  it("names a source current inside an occurrence with its device type letter", async () => {
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
            kind: "source-current",
            documentId: "dut",
            instanceId: "dut-vs",
            occurrence: ["inst-x1"],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vectors).toEqual([
      { probeId: "probe-sense", vector: "i(v.x1.vsense)", quantity: "current" },
    ]);
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
        probes: [DIVIDER_SETUP.input.probes[0]!],
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
            netId: "net-mid",
            occurrence: [],
          },
          {
            id: "probe-b",
            kind: "net-voltage",
            documentId: "tb",
            netId: "net-mid",
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.testbench).toContain("write out.raw v(mid)\n");
    expect(result.vectors.map((item) => item.probeId)).toEqual([
      "probe-a",
      "probe-b",
    ]);
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
            netId: "net-mid",
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(["SIMULATION_PROBE_UNKNOWN_DOCUMENT"]);
  });

  it("reports a probe naming a Net the Document does not hold", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        probes: [
          {
            id: "probe-lost",
            kind: "net-voltage",
            documentId: "tb",
            netId: "no-such-net",
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(["SIMULATION_PROBE_UNKNOWN_NET"]);
    expect(result.ok === false && result.diagnostics[0]!.primary).toEqual({
      documentId: "tb",
      hierarchyPath: [],
      kind: "net",
      objectId: "no-such-net",
    });
  });

  it("reports a probe naming an Instance the Document does not hold", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        probes: [
          {
            id: "probe-lost",
            kind: "source-current",
            documentId: "tb",
            instanceId: "no-such-instance",
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(["SIMULATION_PROBE_UNKNOWN_INSTANCE"]);
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
            netId: "net-mid",
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
            netId: "net-in",
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

  it("reports a source-current probe on an Instance that is not a source", async () => {
    const result = await compile(
      dividerProject(),
      setupWith({
        probes: [
          {
            id: "probe-r1",
            kind: "source-current",
            documentId: "tb",
            instanceId: "inst-r1",
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(["SIMULATION_PROBE_NOT_A_SOURCE"]);
  });

  it("refuses a source-current probe on an independent current source", async () => {
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
            kind: "source-current",
            documentId: "tb",
            instanceId: "inst-i1",
            occurrence: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual([
      "SIMULATION_PROBE_SOURCE_HAS_NO_BRANCH_CURRENT",
    ]);
  });
});

describe("determinism", () => {
  it("compiles the same Project and setup to byte-identical output", async () => {
    const first = await compile(dividerProject(), DIVIDER_SETUP);
    const repeated = await compile(dividerProject(), DIVIDER_SETUP);
    const reopened = await compile(
      JSON.parse(JSON.stringify(dividerProject())) as CircuitProject,
      JSON.parse(JSON.stringify(DIVIDER_SETUP)) as SimulationSetup,
    );

    expect(repeated).toEqual(first);
    expect(reopened).toEqual(first);
  });

  it("moves the input revision when the setup changes but the deck does not", async () => {
    const first = await compile(dividerProject(), DIVIDER_SETUP);
    const relabelled = await compile(
      dividerProject(),
      setupWith({
        probes: DIVIDER_SETUP.input.probes,
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
      expect(value("i(v1)")).toBeCloseTo(-0.0005, 12);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
