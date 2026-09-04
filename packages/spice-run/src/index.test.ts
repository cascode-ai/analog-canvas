import { describe, expect, it } from "vitest";

import {
  buildSimulationDeck,
  deckNeedsModelLibrary,
  classifySimulationOutcome,
  describeExitStatus,
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
  DEFAULT_SIMULATION_TIMEOUT_MS,
  isSimulationEnvironmentMetadata,
  MAX_SIMULATION_TIMEOUT_MS,
  readNgspiceDiagnostics,
  resolveTimeoutMs,
  SKY130_LIBRARY_PATH,
  SKY130_LIBRARY_SECTION,
  simulationConfigurationMetadata,
  verifySimulationEnvironmentMetadata,
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
    expect(
      classifySimulationOutcome(diagnostics, {
        timedOut: false,
        timeoutMs: 30_000,
      }),
    ).toEqual({ status: "completed-with-dropped-input" });
  });

  it("keeps ngspice's own words for a missing model", () => {
    const diagnostics = readNgspiceDiagnostics(MISSING_MODEL_OUTPUT);
    expect(diagnostics.map((diagnostic) => diagnostic.text)).toContain(
      "could not find a valid modelname",
    );
    expect(
      diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    ).toBe(true);
    expect(
      classifySimulationOutcome(diagnostics, {
        timedOut: false,
        timeoutMs: 30_000,
      }),
    ).toEqual({ status: "failed" });
  });

  it("reports a clean run as clean", () => {
    const diagnostics = readNgspiceDiagnostics(CLEAN_OUTPUT);
    expect(diagnostics).toEqual([]);
    expect(
      classifySimulationOutcome(diagnostics, {
        timedOut: false,
        timeoutMs: 30_000,
      }),
    ).toEqual({ status: "completed" });
  });

  /**
   * Captured from the hosted container (ngspice 39) on 2026-09-04. The author's
   * testbench was a `.control` block, which ran and printed every value asked
   * for -- and then the batch pass found no `.plot`/`.print` card and said so,
   * and the process exited non-zero. ngspice 46 exits 0 for the same deck.
   */
  const CONTROL_BLOCK_OUTPUT = `
Circuit: * Analog Canvas simulation deck

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

v(vout) = 7.661889e-01
v(ibias) = 6.018893e-01

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
`;

  it("does not fail a run that printed its results, whatever ngspice exited", () => {
    // #568: every hosted simulation came back failed while the response
    // carried the right values, because the exit status alone was enough to
    // condemn it. That status varies with the ngspice build, not with the run.
    const diagnostics = readNgspiceDiagnostics(CONTROL_BLOCK_OUTPUT);
    expect(
      diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    ).toBe(false);
    expect(
      classifySimulationOutcome(diagnostics, {
        timedOut: false,
        timeoutMs: 30_000,
      }),
    ).toEqual({ status: "completed" });
  });

  it("reports the odd exit rather than hiding it", () => {
    // Not failing on it is not the same as pretending it did not happen.
    const noted = describeExitStatus(1);
    expect(noted?.severity).toBe("warning");
    expect(noted?.text).toContain("exited with code 1");
    expect(describeExitStatus(0)).toBeNull();
    expect(describeExitStatus(null)).toBeNull();
  });

  it("never fails without saying why", () => {
    // A refusal with an empty diagnostics array leaves the author nothing to
    // act on and the next debugger nothing to follow. Failure is reachable
    // only through an error diagnostic now, so the pairing cannot recur.
    const outcome = classifySimulationOutcome([], {
      timedOut: false,
      timeoutMs: 30_000,
    });
    expect(outcome.status).not.toBe("failed");

    const silent = classifySimulationOutcome(
      [{ severity: "error", text: "The simulator produced no output." }],
      { timedOut: false, timeoutMs: 30_000 },
    );
    expect(silent).toEqual({ status: "failed" });
  });

  it("says a timeout is a timeout, not a broken circuit", () => {
    // A long analysis and a wrong circuit look identical from the outside;
    // the author is told which one happened.
    expect(
      classifySimulationOutcome(readNgspiceDiagnostics(CLEAN_OUTPUT), {
        timedOut: true,
        timeoutMs: 30_000,
      }),
    ).toEqual({ status: "timed-out", timeoutMs: 30_000 });
  });
});

describe("the model library", () => {
  it("names the pinned image's library, and only that one", () => {
    // Every surface reads this constant, so a change here is a change
    // everywhere rather than a fourth spelling that drifts from the others.
    expect(SKY130_LIBRARY_PATH).toBe("/opt/sky130/continuous/sky130.lib.spice");
    expect(SKY130_LIBRARY_SECTION).toBe("tt");
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
