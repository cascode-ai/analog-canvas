import { describe, expect, it } from "vitest";

import {
  buildSimulationDeck,
  deckNeedsModelLibrary,
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
  DEFAULT_SIMULATION_TIMEOUT_MS,
  isSimulationEnvironmentMetadata,
  MAX_SIMULATION_TIMEOUT_MS,
  readNgspiceDiagnostics,
  readNgspiceRun,
  readNgspiceRunEvidence,
  resolveTimeoutMs,
  simulationConfigurationMetadata,
  verifySimulationEnvironmentMetadata,
  type NgspiceProcessResult,
  type NgspiceRunReading,
} from "./index.js";

/**
 * Captured from ngspice 44 on 2026-09-01, not written by hand. The point of
 * the malformed-resistor case is that it EXITS ZERO: the deck was accepted,
 * one device was silently discarded, and the solver answered for what was
 * left.
 */
const DROPPED_RESISTOR_OUTPUT = `
Warning: 'r1 in out' is not a valid resistor instance line, ignored!


Note: No compatibility mode selected!


Circuit: * syntax error

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
Note: Simulation executed from .control section
`;

const MISSING_MODEL_OUTPUT = `
Circuit: * missing model

could not find a valid modelname
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
`;

const CLEAN_OUTPUT = `
Note: No compatibility mode selected!

Circuit: * divider

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
v(out) = 5.000000e-01
Note: Simulation executed from .control section
`;

/**
 * Captured from ngspice 46 on 2026-09-04 by running the deck this repository
 * builds. `op` and `print` are inside the author's `.control` block, which is
 * what ADR 0055 means by "the testbench is the author's" and what the ngspice
 * documentation tells an author to write. Exit status 0, and no note.
 */
const CONTROL_BLOCK_OUTPUT = `
Note: No compatibility mode selected!


Circuit: * analog canvas simulation deck

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
v(mid) = 5.000000e-01
Note: Simulation executed from .control section
`;

/**
 * The same run through the preview container, whose ngspice is 39 (issue
 * #568). The control block ran every analysis and printed every value asked
 * for; ngspice's batch pass then noted, for its own reasons, that the deck
 * carried no `.plot`/`.print`/`.fourier` card and exited non-zero.
 *
 * The banner lines are the measured ngspice-46 run above; the closing note
 * and the values are quoted from the issue's recorded ngspice-39 responses.
 */
const NGSPICE_39_CONTROL_BLOCK_OUTPUT = `
Note: No compatibility mode selected!


Circuit: * analog canvas simulation deck

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
v(vout)       = 7.661889e-01
v(ibias)      = 6.018893e-01
v(xdut.tail)  = 2.907461e-01
v(xdut.nleft) = 7.661889e-01
gain_db       = 4.183501e+01
ugb           = 3.302606e+07
Note: Simulation executed from .control section

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
`;

/**
 * Captured from ngspice 46 on 2026-09-04: a deck with a circuit and no
 * analysis at all. Nothing was solved and no vector exists, and ngspice says
 * so in as many words before exiting 1.
 */
const NO_ANALYSIS_OUTPUT = `
Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!

Note: No compatibility mode selected!


Circuit: * analog canvas simulation deck

`;

/**
 * Captured from ngspice 46 on 2026-09-04: an `op` inside a `.control` block
 * with no `print`. The author asked for no value, but the analysis ran and
 * ngspice counted its rows, so the run produced a result.
 */
const CONTROL_BLOCK_NO_PRINT_OUTPUT = `
Note: No compatibility mode selected!


Circuit: * analog canvas simulation deck

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
Note: Simulation executed from .control section
`;

function read(
  log: string,
  overrides: Partial<NgspiceProcessResult> = {},
): NgspiceRunReading {
  return readNgspiceRun({
    log,
    exitCode: 0,
    signal: null,
    timedOut: false,
    timeoutMs: 30_000,
    ...overrides,
  });
}

describe("ngspice output reading", () => {
  it("never calls a run clean when ngspice discarded part of the deck", () => {
    const diagnostics = readNgspiceDiagnostics(DROPPED_RESISTOR_OUTPUT);
    const dropped = diagnostics.filter(
      (diagnostic) => diagnostic.droppedInput === true,
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.text).toContain("not a valid resistor instance line");

    // The measured trap: ngspice exits 0 here. Reading the status alone would
    // report success for a circuit missing a resistor.
    expect(read(DROPPED_RESISTOR_OUTPUT).outcome).toEqual({
      status: "completed-with-dropped-input",
    });
  });

  it("keeps ngspice's own words for a missing model", () => {
    const { outcome, diagnostics } = read(MISSING_MODEL_OUTPUT, {
      exitCode: 1,
    });
    expect(diagnostics.map((diagnostic) => diagnostic.text)).toContain(
      "could not find a valid modelname",
    );
    expect(
      diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    ).toBe(true);
    expect(outcome).toEqual({ status: "failed" });
  });

  it("reports a clean run as clean", () => {
    expect(read(CLEAN_OUTPUT)).toEqual({
      outcome: { status: "completed" },
      diagnostics: [],
    });
  });

  it("says a timeout is a timeout, not a broken circuit", () => {
    // A long analysis and a wrong circuit look identical from the outside;
    // the author is told which one happened.
    expect(
      read(CLEAN_OUTPUT, { timedOut: true, exitCode: null }).outcome,
    ).toEqual({ status: "timed-out", timeoutMs: 30_000 });
  });
});

describe("what a run produced", () => {
  it("counts a printed value and an analysis, and ignores ngspice's prose", () => {
    const evidence = readNgspiceRunEvidence(CONTROL_BLOCK_OUTPUT);
    expect(evidence.printedValueNames).toEqual(["v(mid)"]);
    expect(evidence.analysisDataRows).toEqual([1]);
    expect(evidence.producedResults).toBe(true);

    // ngspice's own chatter contains `=` and a number on several lines. None
    // of it is a value the author asked for, and none of it may stand in for
    // one, or a run that measured nothing would look like a run that did.
    const chatter = readNgspiceRunEvidence(
      [
        "Doing analysis at TEMP = 27.000000 and TNOM = 27.000000",
        "Total analysis time (seconds) = 0.000642",
        "Total DRAM available = 16384.000 MB.",
        "DRAM currently available =  155.172 MB.",
        "Maximum ngspice program size =    9.844 MB.",
        "No. of Data Rows : 0",
      ].join("\n"),
    );
    expect(chatter.printedValueNames).toEqual([]);
    expect(chatter.analysisDataRows).toEqual([]);
    expect(chatter.producedResults).toBe(false);
  });

  it("counts an analysis that ran without the author printing anything", () => {
    // `op` with no `print`: no value was requested, but a vector exists.
    const evidence = readNgspiceRunEvidence(CONTROL_BLOCK_NO_PRINT_OUTPUT);
    expect(evidence.printedValueNames).toEqual([]);
    expect(evidence.producedResults).toBe(true);
    expect(read(CONTROL_BLOCK_NO_PRINT_OUTPUT).outcome).toEqual({
      status: "completed",
    });
  });
});

describe("a run whose measurements came back is not a failure", () => {
  it("completes a `.control` testbench that ngspice 39 exited non-zero on", () => {
    // Issue #568. The container simulated a five-transistor sky130 OTA and
    // got exactly the right answer; the service reported `failed` with an
    // empty `diagnostics` array, because the only thing consulted was the
    // exit status. ngspice 39 ends a batch pass over a `.control` deck with
    // a note about the `.print` cards it did not find, and exits non-zero,
    // after the control block has already run and printed.
    const { outcome, diagnostics } = read(NGSPICE_39_CONTROL_BLOCK_OUTPUT, {
      exitCode: 1,
    });
    expect(outcome).toEqual({ status: "completed" });
    expect(diagnostics).toEqual([]);

    // The measurements the author asked for are the reason it completed.
    const evidence = readNgspiceRunEvidence(NGSPICE_39_CONTROL_BLOCK_OUTPUT);
    expect(evidence.printedValueNames).toEqual([
      "v(vout)",
      "v(ibias)",
      "v(xdut.tail)",
      "v(xdut.nleft)",
      "gain_db",
      "ugb",
    ]);
  });

  it("does not decide success from that note's absence either", () => {
    // The note is ngspice 39's wording. A simulator that prints a different
    // one, or none, must not change the verdict: results decide it. Same
    // deck, same values, note removed, still non-zero.
    const withoutNote = NGSPICE_39_CONTROL_BLOCK_OUTPUT.replace(
      /^Note: No "\.plot".*$/mu,
      "",
    );
    expect(withoutNote).not.toContain('No ".plot"');
    expect(read(withoutNote, { exitCode: 1 }).outcome).toEqual({
      status: "completed",
    });
  });
});

describe("a run that produced nothing is a failure that says so", () => {
  it("fails a deck no analysis ran on", () => {
    // Measured ngspice 46: a circuit with no analysis. No vector exists, so
    // there is nothing to report however the process exited.
    const { outcome, diagnostics } = read(NO_ANALYSIS_OUTPUT, { exitCode: 1 });
    expect(readNgspiceRunEvidence(NO_ANALYSIS_OUTPUT).producedResults).toBe(
      false,
    );
    expect(outcome).toEqual({ status: "failed" });
    expect(diagnostics.map((diagnostic) => diagnostic.text)).toContain(
      "Error: incomplete or empty netlist",
    );
    expect(
      diagnostics.some((diagnostic) =>
        /no analysis results/iu.test(diagnostic.text),
      ),
    ).toBe(true);
  });

  it("keeps a silent or signal-killed run a failure (#566)", () => {
    const silent = read("", { exitCode: 0 });
    expect(silent.outcome).toEqual({ status: "failed" });
    expect(silent.diagnostics[0]!.text).toContain("no output");

    const killed = read("", { exitCode: 128, signal: "SIGKILL" });
    expect(killed.outcome).toEqual({ status: "failed" });
    expect(killed.diagnostics[0]!.text).toContain("SIGKILL");

    // A kill that lands after some values were printed is still a kill: what
    // came back is a fragment of the answer, not the answer.
    const cutOff = read(CONTROL_BLOCK_OUTPUT, {
      exitCode: 128,
      signal: "SIGKILL",
    });
    expect(cutOff.outcome).toEqual({ status: "failed" });
    expect(cutOff.diagnostics[0]!.text).toContain("SIGKILL");
  });

  it("never reports a failure without a diagnostic", () => {
    // The half of #568 that has nothing to do with which ngspice is running:
    // `status: "failed"` beside `diagnostics: []` gives the author nothing to
    // act on and the next debugger no thread to pull. Whatever a process does,
    // a failed verdict comes with at least one line explaining it.
    const logs = [
      "",
      "   \n  \n",
      CLEAN_OUTPUT,
      CONTROL_BLOCK_OUTPUT,
      CONTROL_BLOCK_NO_PRINT_OUTPUT,
      NGSPICE_39_CONTROL_BLOCK_OUTPUT,
      NO_ANALYSIS_OUTPUT,
      MISSING_MODEL_OUTPUT,
      DROPPED_RESISTOR_OUTPUT,
      "ngspice said something nobody has a pattern for yet",
    ];
    const exitCodes = [0, 1, 2, 128, null];
    const signals = [null, "SIGKILL", "SIGSEGV"];

    let failures = 0;
    for (const log of logs) {
      for (const exitCode of exitCodes) {
        for (const signal of signals) {
          for (const timedOut of [false, true]) {
            const { outcome, diagnostics } = read(log, {
              exitCode,
              signal,
              timedOut,
            });
            if (outcome.status !== "failed") continue;
            failures += 1;
            expect(
              diagnostics.length,
              `failed with no diagnostic: exit ${String(exitCode)}, signal ${String(signal)}, log ${JSON.stringify(log.slice(0, 40))}`,
            ).toBeGreaterThanOrEqual(1);
            expect(
              diagnostics.some((diagnostic) => diagnostic.severity === "error"),
            ).toBe(true);
          }
        }
      }
    }
    // The sweep has to actually reach the failed branch to prove anything.
    expect(failures).toBeGreaterThan(0);
  });
});

describe("simulation deck assembly", () => {
  const netlist =
    ".subckt amp in out\nM1 out in 0 0 nfet\n.ends\nXA in out amp";
  const testbench = "V1 in 0 DC 1\n.control\nop\nprint v(out)\n.endc";

  it("selects an explicit section from a corner library", () => {
    const deck = buildSimulationDeck(
      { netlist, testbench },
      {
        directive: "lib",
        path: "/opt/sky130/sky130A/libs.tech/ngspice/sky130.lib.spice",
        section: "tt",
      },
    );
    expect(deck).toContain(
      '.lib "/opt/sky130/sky130A/libs.tech/ngspice/sky130.lib.spice" tt',
    );
    // ADR 0055: we ship no templates and infer no intent. Nothing analysis-
    // shaped may appear that the author did not write.
    expect(deck).toContain(testbench);
    const ours = deck.replace(testbench, "").replace(netlist, "");
    expect(ours).not.toMatch(/\.ac\b|\.dc\b|\.tran\b|\.control/iu);
  });

  it("includes a plain model file without inventing a section", () => {
    const deck = buildSimulationDeck(
      { netlist, testbench },
      {
        directive: "include",
        path: "C:/PDK Files/models/plain-models.spice",
      },
    );
    expect(deck).toContain('.include "C:/PDK Files/models/plain-models.spice"');
    expect(deck).not.toMatch(/^\s*\.lib\b/mu);
  });

  it("refuses values that could inject another deck line", () => {
    expect(() =>
      buildSimulationDeck(
        { netlist, testbench },
        { directive: "include", path: 'models.spice"\n.end' },
      ),
    ).toThrow(/path/iu);
    expect(() =>
      buildSimulationDeck(
        { netlist, testbench },
        {
          directive: "lib",
          path: "models.lib.spice",
          section: "tt\n.end",
        },
      ),
    ).toThrow(/section/iu);
  });

  it("does not close a deck the author already closed", () => {
    const closed = `${testbench}\n.end`;
    const deck = buildSimulationDeck({ netlist, testbench: closed }, null);
    expect(deck.match(/^\s*\.end\s*$/gimu)).toHaveLength(1);
  });
});

describe("simulation run metadata", () => {
  it("identifies the exact input bytes and echoes the caller revision", async () => {
    const metadata = await createSimulationInputMetadata({
      inputRevision: "project-17",
      netlist: "abc",
      testbench: "testbench",
      deck: "deck",
    });
    expect(metadata).toEqual({
      inputRevision: "project-17",
      netlistSha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      testbenchSha256:
        "486ad88a3471e0d1b3f4786647a18e93b54c72bc10b9ea1060992ba1ae4f47bf",
      deckSha256:
        "d830325906c3d540ae219e6aba0f243d52cd708feea68355a3f63f76aff8da33",
    });
  });

  it("fingerprints observed facts without claiming they are pinned", async () => {
    const environment = await createSimulationEnvironmentMetadata({
      executor: "hosted-container",
      reproducibility: "observed",
      platform: "linux/x64",
      simulator: {
        name: "ngspice",
        version: "ngspice-47",
        binarySha256:
          "22d5cae2bd32b2e39157a8d27bf457122f68285b72a9ebefdf41551b628233ab",
      },
      models: {
        id: "sky130A",
        contentSha256:
          "17c208a699228f5acb87bf59c09c22a4c4d3937b6766b4957737d34e8e075f64",
      },
    });
    expect(environment.reproducibility).toBe("observed");
    expect(environment.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(isSimulationEnvironmentMetadata(environment)).toBe(true);
    expect(
      isSimulationEnvironmentMetadata({
        ...environment,
        fingerprint: "declared-without-a-hash",
      }),
    ).toBe(false);
    expect(await verifySimulationEnvironmentMetadata(environment)).toEqual(
      environment,
    );
    expect(
      await verifySimulationEnvironmentMetadata({
        ...environment,
        simulator: { ...environment.simulator, version: "ngspice-46" },
      }),
    ).toBeNull();
  });

  it("records the model directive and section without exposing its path", () => {
    expect(
      simulationConfigurationMetadata({
        directive: "lib",
        path: "C:/private/pdk/sky130.lib.spice",
        section: "ff",
      }),
    ).toEqual({ modelLibrary: { directive: "lib", section: "ff" } });
  });
});

describe("timeout ceiling", () => {
  it("defaults, floors and caps the requested ceiling", () => {
    expect(resolveTimeoutMs(undefined)).toBe(DEFAULT_SIMULATION_TIMEOUT_MS);
    expect(resolveTimeoutMs(Number.NaN)).toBe(DEFAULT_SIMULATION_TIMEOUT_MS);
    expect(resolveTimeoutMs(5_000)).toBe(5_000);
    expect(resolveTimeoutMs(-1)).toBe(1);
    // Awake time is what a container bills, so an unbounded run is an
    // unbounded bill as much as a user waiting on nothing.
    expect(resolveTimeoutMs(10 * MAX_SIMULATION_TIMEOUT_MS)).toBe(
      MAX_SIMULATION_TIMEOUT_MS,
    );
  });
});

describe("model library on demand", () => {
  it("asks for the library only when a device needs a model", () => {
    // Passives, sources, and a subcircuit of them: no model card to look up,
    // so no 16 s corner load.
    expect(
      deckNeedsModelLibrary(
        ".subckt divider in out\nR1 in out 1k\nR2 out 0 1k\n.ends\nV1 in 0 DC 1\nX1 in out divider\n.op",
      ),
    ).toBe(false);
    expect(deckNeedsModelLibrary("C1 a 0 1p\nL1 a b 1n\nE1 c 0 a 0 2")).toBe(
      false,
    );
    // A MOSFET, a diode, a BJT, or a JFET card, or any Sky130 name.
    expect(deckNeedsModelLibrary("M1 out in 0 0 nfet")).toBe(true);
    expect(deckNeedsModelLibrary("D1 a 0 dmod")).toBe(true);
    expect(deckNeedsModelLibrary("Q1 c b e npn")).toBe(true);
    expect(deckNeedsModelLibrary("J1 d g s jmod")).toBe(true);
    expect(
      deckNeedsModelLibrary("XM1 d g s b sky130_fd_pr__nfet_01v8 w=1 l=0.15"),
    ).toBe(true);
    // A comment or a continuation line is not a device.
    expect(deckNeedsModelLibrary("* M1 would need a model\n+ M2 too")).toBe(
      false,
    );
  });
});
