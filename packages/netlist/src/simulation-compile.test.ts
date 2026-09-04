import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  createEmptyDocument,
  createEmptyProject,
  deriveStableId,
  type CircuitProject,
  type SchematicDocument,
  type SimulationAnalysisSpec,
  type SimulationProbeSpec,
  type SimulationSetup,
} from "@icm/model";
import { buildSimulationDeck, readSimulationData } from "@icm/spice-run";
import { describe, expect, it } from "vitest";

import { compileStructuredSimulation } from "./simulation-compile.js";

const run = promisify(execFile);

/**
 * The integration test below runs the SIMULATOR ON THIS MACHINE when there is
 * one and skips itself when there is not, the same bargain
 * `scripts/simulation-acceptance.mjs` makes: a deck asserted against a mock
 * agrees with whatever we believe today, which is exactly what the vector
 * names in this module must not be verified against.
 */
const ngspicePath = await run("which", ["ngspice"])
  .then(({ stdout }) => stdout.trim() || null)
  .catch(() => null);
const withSimulator = ngspicePath ? it : it.skip;

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
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { value },
    },
  } as const;
}

/**
 * A Testbench in the Project top: a 1 V source with a unit AC stimulus driving
 * an equal resistor divider to ground. Its operating point is arithmetic, not
 * a recorded number: `mid` is exactly 0.5 V and the source sinks exactly
 * 0.5 mA.
 */
function dividerProject(): CircuitProject {
  const project = createEmptyProject("project", "Project", "tb");
  const testbench = project.documents[0]!;
  testbench.netlist!.name = "tb";
  testbench.instances.push(
    {
      id: "inst-v1",
      symbolId: "voltage-source",
      placement: null,
      reference: "V1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "voltage-source" },
        parameters: { dc: "1", acMagnitude: "1" },
      },
    },
    resistor("inst-r1", "R1", "1k"),
    resistor("inst-r2", "R2", "1k"),
  );
  testbench.nets.push(
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
      ],
    },
  );
  claimNet(testbench, "net-in", "in");
  claimNet(testbench, "net-mid", "mid");
  claimNet(testbench, "net-gnd", "0", "global", "ground");
  return project;
}

/**
 * The same divider, split across a hierarchy: the Testbench holds the source
 * and one subcircuit call, and the two resistors and their shared node live
 * inside the DUT Cell. `mid` is reachable only through the occurrence.
 */
function hierarchyProject(): CircuitProject {
  const project = createEmptyProject("project", "Project", "tb");
  const testbench = project.documents[0]!;
  testbench.netlist!.name = "tb";
  const dut = createEmptyDocument("dut", "DUT");
  dut.netlist = {
    name: "dut",
    formalParameters: [],
    terminals: [
      {
        id: "dut-terminal-in",
        name: "in",
        netId: "dut-net-in",
        direction: "input",
        interfaceInstanceIds: ["dut-port-in"],
      },
      {
        id: "dut-terminal-out",
        name: "out",
        netId: "dut-net-out",
        direction: "output",
        interfaceInstanceIds: ["dut-port-out"],
      },
    ],
  };
  dut.instances.push(
    { id: "dut-port-in", symbolId: "port", placement: null },
    { id: "dut-port-out", symbolId: "port", placement: null },
    resistor("dut-r1", "R1", "1k"),
    resistor("dut-r2", "R2", "1k"),
  );
  dut.nets.push(
    {
      id: "dut-net-in",
      terminals: [
        { instanceId: "dut-port-in", pinName: "P" },
        { instanceId: "dut-r1", pinName: "1" },
      ],
    },
    {
      id: "dut-net-mid",
      terminals: [
        { instanceId: "dut-r1", pinName: "2" },
        { instanceId: "dut-r2", pinName: "1" },
      ],
    },
    {
      id: "dut-net-out",
      terminals: [
        { instanceId: "dut-r2", pinName: "2" },
        { instanceId: "dut-port-out", pinName: "P" },
      ],
    },
  );
  claimNet(dut, "dut-net-mid", "mid");
  project.documents.push(dut);

  testbench.instances.push(
    {
      id: "inst-v1",
      symbolId: "voltage-source",
      placement: null,
      reference: "V1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "voltage-source" },
        parameters: { dc: "1" },
      },
    },
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
  );
  testbench.nets.push(
    {
      id: "net-in",
      terminals: [
        { instanceId: "inst-v1", pinName: "+" },
        { instanceId: "inst-x1", pinName: "in" },
      ],
    },
    {
      id: "net-gnd",
      terminals: [
        { instanceId: "inst-v1", pinName: "-" },
        { instanceId: "inst-x1", pinName: "out" },
      ],
    },
  );
  claimNet(testbench, "net-in", "in");
  claimNet(testbench, "net-gnd", "0", "global", "ground");
  return project;
}

/**
 * The hierarchy project with a 0 V source in series inside the DUT: the
 * classic SPICE ammeter, placed where only an occurrence can address it.
 */
function nestedSourceProject(): CircuitProject {
  const project = hierarchyProject();
  const dut = project.documents.find((document) => document.id === "dut")!;
  dut.instances.push({
    id: "dut-v2",
    symbolId: "voltage-source",
    placement: null,
    reference: "V2",
    netlist: {
      binding: { kind: "primitive", deviceClass: "voltage-source" },
      parameters: { dc: "0" },
    },
  });
  dut.nets.find((net) => net.id === "dut-net-mid")!.terminals = [
    { instanceId: "dut-r1", pinName: "2" },
    { instanceId: "dut-v2", pinName: "+" },
  ];
  dut.nets.push({
    id: "dut-net-sense",
    terminals: [
      { instanceId: "dut-v2", pinName: "-" },
      { instanceId: "dut-r2", pinName: "1" },
    ],
  });
  claimNet(dut, "dut-net-sense", "sense");
  return project;
}

const OP: SimulationAnalysisSpec = { kind: "op" };
const AC: SimulationAnalysisSpec = {
  kind: "ac",
  sweep: "dec",
  points: 10,
  startHz: 1,
  stopHz: 1e6,
};

function setup(
  rootDocumentId: string,
  analyses: SimulationAnalysisSpec[],
  probes: SimulationProbeSpec[],
): SimulationSetup {
  return {
    version: 1,
    input: {
      kind: "structured",
      rootDocumentId,
      analyses,
      probes,
      environment: { profileId: "hosted-sky130-core-continuous-v1" },
    },
  };
}

function netProbe(
  id: string,
  documentId: string,
  netId: string,
  occurrence: string[] = [],
): SimulationProbeSpec {
  return { id, kind: "net-voltage", documentId, netId, occurrence };
}

function currentProbe(
  id: string,
  documentId: string,
  instanceId: string,
  occurrence: string[] = [],
): SimulationProbeSpec {
  return { id, kind: "source-current", documentId, instanceId, occurrence };
}

const dividerSetup = setup(
  "tb",
  [OP, AC],
  [
    netProbe("probe-in", "tb", "net-in"),
    netProbe("probe-mid", "tb", "net-mid"),
    currentProbe("probe-source", "tb", "inst-v1"),
  ],
);

function codes(diagnostics: readonly { code: string }[]): string[] {
  return diagnostics.map((item) => item.code);
}

describe("compiling a structured simulation setup", () => {
  it("prints a flat Testbench as top-level cards and a saving control block", async () => {
    const compiled = await compileStructuredSimulation(
      dividerProject(),
      dividerSetup,
      { timeoutMs: 30_000 },
    );

    expect(compiled.diagnostics).toEqual([]);
    if (!compiled.ok) return;
    // Nothing the root reaches is a subcircuit, so the netlist half defines
    // nothing and says so rather than repeating the testbench.
    expect(compiled.request.netlist).toBe(
      "* Generated by Interactive Circuit Maker netlist-export/1.0\n",
    );
    expect(compiled.request.testbench).toBe(
      [
        "* Analog Canvas testbench tb",
        "R1 in mid 1k",
        "R2 mid 0 1k",
        "V1 in 0 DC 1 AC 1 0",
        ".control",
        "set filetype=ascii",
        "set appendwrite",
        "op",
        "write out.raw v(in) v(mid) i(v1)",
        "ac dec 10 1 1000000",
        "write out.raw v(in) v(mid) i(v1)",
        ".endc",
        ".end",
        "",
      ].join("\n"),
    );
    expect(compiled.request.analyses).toEqual(["op", "ac"]);
    expect(compiled.request.timeoutMs).toBe(30_000);
    expect(compiled.request.inputRevision).toMatch(
      /^structured-1-[0-9a-f]{64}$/u,
    );
    expect(compiled.vectors).toEqual([
      { probeId: "probe-in", vector: "v(in)", quantity: "voltage" },
      { probeId: "probe-mid", vector: "v(mid)", quantity: "voltage" },
      { probeId: "probe-source", vector: "i(v1)", quantity: "current" },
    ]);
  });

  it("omits a timeout the caller did not ask for", async () => {
    const compiled = await compileStructuredSimulation(
      dividerProject(),
      dividerSetup,
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect("timeoutMs" in compiled.request).toBe(false);
  });

  it("declares a global Net in the half the deck reads first", async () => {
    // `.global` has to precede every card that uses the name, and the runner
    // concatenates the netlist half ahead of the testbench. A global reached
    // only from the root must therefore still be declared over there.
    const project = dividerProject();
    const testbench = project.documents[0]!;
    testbench.instances.push(resistor("inst-r3", "R3", "10k"));
    testbench.nets.push({
      id: "net-vdd",
      terminals: [{ instanceId: "inst-r3", pinName: "1" }],
    });
    testbench.nets
      .find((net) => net.id === "net-mid")!
      .terminals.push({ instanceId: "inst-r3", pinName: "2" });
    claimNet(testbench, "net-vdd", "VDD", "global", "vdd");

    const compiled = await compileStructuredSimulation(
      project,
      setup("tb", [OP], [netProbe("probe-mid", "tb", "net-mid")]),
    );

    expect(compiled.diagnostics).toEqual([]);
    if (!compiled.ok) return;
    expect(compiled.request.netlist).toBe(
      [
        "* Generated by Interactive Circuit Maker netlist-export/1.0",
        ".global VDD",
        "",
      ].join("\n"),
    );
    expect(compiled.request.testbench).toContain("R3 VDD mid 10k\n");
  });

  it("defines every reached Cell once and instantiates only the root", async () => {
    const compiled = await compileStructuredSimulation(
      hierarchyProject(),
      setup(
        "tb",
        [OP],
        [
          netProbe("probe-mid", "dut", "dut-net-mid", ["inst-x1"]),
          currentProbe("probe-source", "tb", "inst-v1"),
        ],
      ),
    );

    expect(compiled.diagnostics).toEqual([]);
    if (!compiled.ok) return;
    expect(compiled.request.netlist).toBe(
      [
        "* Generated by Interactive Circuit Maker netlist-export/1.0",
        "",
        ".subckt dut in out",
        "R1 in mid 1k",
        "R2 mid out 1k",
        ".ends dut",
        "",
      ].join("\n"),
    );
    expect(compiled.request.testbench).toBe(
      [
        "* Analog Canvas testbench tb",
        "V1 in 0 DC 1",
        "X1 in 0 dut",
        ".control",
        "set filetype=ascii",
        "set appendwrite",
        "op",
        "write out.raw v(x1.mid) i(v1)",
        ".endc",
        ".end",
        "",
      ].join("\n"),
    );
    // ngspice writes the node inside a call as `x1.mid`, in lower case
    // whatever the deck spelled, so this is the name that comes back.
    expect(compiled.vectors).toEqual([
      { probeId: "probe-mid", vector: "v(x1.mid)", quantity: "voltage" },
      { probeId: "probe-source", vector: "i(v1)", quantity: "current" },
    ]);
  });

  it("saves one vector for two probes that name the same node", async () => {
    const project = dividerProject();
    const compiled = await compileStructuredSimulation(
      project,
      setup(
        "tb",
        [OP],
        [
          netProbe("probe-a", "tb", "net-mid"),
          netProbe("probe-b", "tb", "net-mid"),
        ],
      ),
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.request.testbench).toContain("write out.raw v(mid)\n");
    expect(compiled.vectors.map((vector) => vector.probeId)).toEqual([
      "probe-a",
      "probe-b",
    ]);
  });

  it("names a source inside a call the way ngspice expands it", async () => {
    // A source in the DUT, not the Testbench: ngspice expands a device inside
    // a call to `<type>.<call path>.<device>`, so its branch is `i(v.x1.v2)`
    // and never `i(x1.v2)`.
    const compiled = await compileStructuredSimulation(
      nestedSourceProject(),
      setup(
        "tb",
        [OP],
        [currentProbe("probe-inner", "dut", "dut-v2", ["inst-x1"])],
      ),
    );

    expect(compiled.diagnostics).toEqual([]);
    if (!compiled.ok) return;
    expect(compiled.vectors).toEqual([
      { probeId: "probe-inner", vector: "i(v.x1.v2)", quantity: "current" },
    ]);
  });

  it("compiles the same Project and setup to identical bytes", async () => {
    const first = await compileStructuredSimulation(
      dividerProject(),
      dividerSetup,
    );
    const repeated = await compileStructuredSimulation(
      dividerProject(),
      dividerSetup,
    );
    const reopened = await compileStructuredSimulation(
      JSON.parse(JSON.stringify(dividerProject())) as CircuitProject,
      JSON.parse(JSON.stringify(dividerSetup)) as SimulationSetup,
    );

    expect(repeated).toEqual(first);
    expect(reopened).toEqual(first);
  });

  it("changes the input revision when the environment selection changes", async () => {
    // The corner never reaches the deck, and it decides the numbers. An
    // identity covering only the deck bytes would call two different runs one.
    const withTt = await compileStructuredSimulation(
      dividerProject(),
      dividerSetup,
    );
    const cornered = structuredClone(dividerSetup);
    cornered.input.environment.corner = "ss";
    const withSs = await compileStructuredSimulation(
      dividerProject(),
      cornered,
    );

    expect(withTt.ok && withSs.ok).toBe(true);
    if (!withTt.ok || !withSs.ok) return;
    expect(withTt.request.testbench).toBe(withSs.request.testbench);
    expect(withTt.request.inputRevision).not.toBe(withSs.request.inputRevision);
  });
});

describe("refusing a structured simulation setup", () => {
  it("reports the extractor's own findings when the root is unknown", async () => {
    const compiled = await compileStructuredSimulation(
      dividerProject(),
      setup("missing", [OP], [netProbe("probe-mid", "tb", "net-mid")]),
    );

    expect(compiled.ok).toBe(false);
    expect(codes(compiled.diagnostics)).toContain("MISSING_ROOT_CELL");
  });

  it("refuses a root that defines subcircuits and instantiates none", async () => {
    const project = hierarchyProject();
    const testbench = project.documents[0]!;
    testbench.instances = [];
    testbench.nets = [{ id: "net-probe", terminals: [] }];
    testbench.annotations = [];
    testbench.connectivityEvidence = [];
    claimNet(testbench, "net-probe", "probe");

    const compiled = await compileStructuredSimulation(
      project,
      setup("tb", [OP], [netProbe("probe-node", "tb", "net-probe")]),
    );

    expect(compiled.ok).toBe(false);
    expect(codes(compiled.diagnostics)).toEqual([
      "SIMULATION_ROOT_HAS_NO_INSTANCES",
    ]);
  });

  it("refuses a setup with no analysis and a setup with no probe", async () => {
    const compiled = await compileStructuredSimulation(
      dividerProject(),
      setup("tb", [], []),
    );

    expect(compiled.ok).toBe(false);
    expect(codes(compiled.diagnostics)).toEqual([
      "SIMULATION_NO_ANALYSIS",
      "SIMULATION_NO_PROBE",
    ]);
  });

  it("refuses the same analysis twice", async () => {
    const compiled = await compileStructuredSimulation(
      dividerProject(),
      setup("tb", [OP, OP], [netProbe("probe-mid", "tb", "net-mid")]),
    );

    expect(compiled.ok).toBe(false);
    expect(codes(compiled.diagnostics)).toEqual([
      "SIMULATION_DUPLICATE_ANALYSIS",
    ]);
  });

  it("refuses a probe on an object that is not in the Project", async () => {
    const compiled = await compileStructuredSimulation(
      dividerProject(),
      setup(
        "tb",
        [OP],
        [
          netProbe("probe-document", "nowhere", "net-mid"),
          netProbe("probe-net", "tb", "net-nowhere"),
          currentProbe("probe-instance", "tb", "inst-nowhere"),
        ],
      ),
    );

    expect(compiled.ok).toBe(false);
    expect(codes(compiled.diagnostics)).toEqual([
      "SIMULATION_PROBE_UNKNOWN_DOCUMENT",
      "SIMULATION_PROBE_UNKNOWN_NET",
      "SIMULATION_PROBE_UNKNOWN_INSTANCE",
    ]);
  });

  it("refuses an occurrence that is not a path of hierarchy Instances", async () => {
    const compiled = await compileStructuredSimulation(
      hierarchyProject(),
      setup(
        "tb",
        [OP],
        [netProbe("probe-mid", "dut", "dut-net-mid", ["inst-v1"])],
      ),
    );

    expect(compiled.ok).toBe(false);
    expect(codes(compiled.diagnostics)).toEqual([
      "SIMULATION_PROBE_OCCURRENCE_INVALID",
    ]);
    expect(compiled.diagnostics[0]?.message).toContain("inst-v1");
  });

  it("refuses an occurrence that lands somewhere other than the probe's Document", async () => {
    const compiled = await compileStructuredSimulation(
      hierarchyProject(),
      setup("tb", [OP], [netProbe("probe-mid", "dut", "dut-net-mid")]),
    );

    expect(compiled.ok).toBe(false);
    expect(codes(compiled.diagnostics)).toEqual([
      "SIMULATION_PROBE_OCCURRENCE_INVALID",
    ]);
    expect(compiled.diagnostics[0]?.message).toContain("reaches Document tb");
  });

  it("refuses a source-current probe on something that is not a source", async () => {
    const compiled = await compileStructuredSimulation(
      dividerProject(),
      setup("tb", [OP], [currentProbe("probe-resistor", "tb", "inst-r1")]),
    );

    expect(compiled.ok).toBe(false);
    expect(codes(compiled.diagnostics)).toEqual([
      "SIMULATION_PROBE_NOT_A_SOURCE",
    ]);
  });

  it("refuses a source-current probe on a current source", async () => {
    // Measured, not assumed: ngspice 46 keeps no branch vector for an
    // independent current source, and one refused vector aborts the whole
    // `write` -- so a deck carrying `i(i1)` produces no rawfile at all.
    const project = dividerProject();
    const testbench = project.documents[0]!;
    testbench.instances.push({
      id: "inst-i1",
      symbolId: "current-source",
      placement: null,
      reference: "I1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "current-source" },
        parameters: { dc: "1m" },
      },
    });
    testbench.nets
      .find((net) => net.id === "net-in")!
      .terminals.push({ instanceId: "inst-i1", pinName: "+" });
    testbench.nets
      .find((net) => net.id === "net-gnd")!
      .terminals.push({ instanceId: "inst-i1", pinName: "-" });

    const compiled = await compileStructuredSimulation(
      project,
      setup("tb", [OP], [currentProbe("probe-current", "tb", "inst-i1")]),
    );

    expect(compiled.ok).toBe(false);
    expect(codes(compiled.diagnostics)).toEqual([
      "SIMULATION_PROBE_SOURCE_HAS_NO_BRANCH_CURRENT",
    ]);
  });
});

/**
 * Run a compiled request the way the hosted runner does: the environment's
 * model library, then the two halves, then `.end`. A passive divider needs no
 * library, so `null` here is the whole deck.
 *
 * The rawfile is read from the run directory rather than from the log, and a
 * missing one throws — which is the proof this test ran a simulator at all.
 */
async function simulate(
  request: Parameters<typeof buildSimulationDeck>[0],
): Promise<{ log: string; rawfile: string }> {
  const deck = buildSimulationDeck(request, null);
  const directory = await mkdtemp(join(tmpdir(), "icm-compile-sim-"));
  try {
    await writeFile(join(directory, "deck.cir"), deck, "utf8");
    const finished = await run(ngspicePath!, ["-b", "deck.cir"], {
      cwd: directory,
    }).catch((error: { stdout?: string; stderr?: string }) => ({
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    }));
    return {
      log: `${finished.stdout}\n${finished.stderr}`,
      rawfile: await readFile(join(directory, "out.raw"), "utf8"),
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

describe("the compiled deck against ngspice", () => {
  withSimulator(
    "solves the divider and returns every vector the compiler named",
    async () => {
      const compiled = await compileStructuredSimulation(
        dividerProject(),
        dividerSetup,
      );
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;

      const { log, rawfile } = await simulate(compiled.request);

      // The deck must not carry an analysis card beside its control block:
      // ngspice 46 then re-runs the deck's own analyses afterwards and reports
      // an error the runner classifies as a failed run.
      expect(log).not.toMatch(/^\s*error[: ]/imu);

      const reading = readSimulationData(rawfile);
      expect(reading.status).toBe("read");
      if (reading.status !== "read") return;
      // Both analyses reached one rawfile: `write` truncates by default, so
      // without `set appendwrite` the AC plot would have replaced the OP one.
      expect(
        reading.data.analyses.map((analysis) => analysis.analysis),
      ).toEqual(["op", "ac"]);

      for (const analysis of reading.data.analyses) {
        const present = new Set(analysis.probes.map((probe) => probe.name));
        for (const vector of compiled.vectors) {
          expect(present).toContain(vector.vector);
        }
      }

      const operatingPoint = reading.data.analyses[0]!;
      if (operatingPoint.analysis !== "op") return;
      const mid = operatingPoint.probes.find(
        (probe) => probe.name === "v(mid)",
      );
      // Two equal resistors across 1 V: arithmetic, not a recorded number.
      expect(mid?.value).toBe(0.5);
      expect(mid?.unit).toBe("V");
      const source = operatingPoint.probes.find(
        (probe) => probe.name === "i(v1)",
      );
      // A source's branch current is positive into its `+` terminal, so a
      // 1 V source driving 2 kOhm sinks half a milliamp.
      expect(source?.value).toBeCloseTo(-0.5e-3, 12);
      expect(source?.unit).toBe("A");
    },
    60_000,
  );

  withSimulator(
    "resolves a Net probed through a subcircuit occurrence",
    async () => {
      const compiled = await compileStructuredSimulation(
        hierarchyProject(),
        setup(
          "tb",
          [OP],
          [netProbe("probe-mid", "dut", "dut-net-mid", ["inst-x1"])],
        ),
      );
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(compiled.vectors[0]?.vector).toBe("v(x1.mid)");

      const { rawfile } = await simulate(compiled.request);
      const reading = readSimulationData(rawfile);
      expect(reading.status).toBe("read");
      if (reading.status !== "read") return;
      const operatingPoint = reading.data.analyses[0]!;
      expect(operatingPoint.analysis).toBe("op");
      if (operatingPoint.analysis !== "op") return;
      expect(
        operatingPoint.probes.find((probe) => probe.name === "v(x1.mid)")
          ?.value,
      ).toBe(0.5);
    },
    60_000,
  );

  withSimulator(
    "resolves a source probed through a subcircuit occurrence",
    async () => {
      const compiled = await compileStructuredSimulation(
        nestedSourceProject(),
        setup(
          "tb",
          [OP],
          [currentProbe("probe-inner", "dut", "dut-v2", ["inst-x1"])],
        ),
      );
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(compiled.vectors[0]?.vector).toBe("i(v.x1.v2)");

      const { log, rawfile } = await simulate(compiled.request);
      // The spelling this asserts is the one ngspice refuses to substitute:
      // `i(x1.v2)` is "no such function as i", and one refused vector aborts
      // the whole `write`, so a wrong name here leaves no rawfile to read.
      expect(log).not.toMatch(/^\s*error[: ]/imu);

      const reading = readSimulationData(rawfile);
      expect(reading.status).toBe("read");
      if (reading.status !== "read") return;
      const operatingPoint = reading.data.analyses[0]!;
      expect(operatingPoint.analysis).toBe("op");
      if (operatingPoint.analysis !== "op") return;
      // 1 V across the two 1 kOhm resistors the sense source sits between.
      expect(
        operatingPoint.probes.find((probe) => probe.name === "i(v.x1.v2)")
          ?.value,
      ).toBeCloseTo(0.5e-3, 12);
    },
    60_000,
  );
});
