import { describe, expect, it } from "vitest";

import {
  buildSimulationDeck,
  classifySimulationOutcome,
  DEFAULT_SIMULATION_TIMEOUT_MS,
  MAX_SIMULATION_TIMEOUT_MS,
  readNgspiceDiagnostics,
  resolveTimeoutMs,
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
        exitCode: 0,
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
        exitCode: 1,
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
        exitCode: 0,
      }),
    ).toEqual({ status: "completed" });
  });

  it("says a timeout is a timeout, not a broken circuit", () => {
    // A long analysis and a wrong circuit look identical from the outside;
    // the author is told which one happened.
    expect(
      classifySimulationOutcome(readNgspiceDiagnostics(CLEAN_OUTPUT), {
        timedOut: true,
        timeoutMs: 30_000,
        exitCode: null,
      }),
    ).toEqual({ status: "timed-out", timeoutMs: 30_000 });
  });
});

describe("simulation deck assembly", () => {
  const netlist =
    ".subckt amp in out\nM1 out in 0 0 nfet\n.ends\nXA in out amp";
  const testbench = "V1 in 0 DC 1\n.control\nop\nprint v(out)\n.endc";

  it("contributes only the model path and keeps the testbench verbatim", () => {
    const deck = buildSimulationDeck(
      { netlist, testbench },
      "/opt/sky130/sky130A/libs.tech/ngspice/sky130.lib.spice",
    );
    expect(deck).toContain(
      ".include /opt/sky130/sky130A/libs.tech/ngspice/sky130.lib.spice",
    );
    // ADR 0055: we ship no templates and infer no intent. Nothing analysis-
    // shaped may appear that the author did not write.
    expect(deck).toContain(testbench);
    const ours = deck.replace(testbench, "").replace(netlist, "");
    expect(ours).not.toMatch(/\.ac\b|\.dc\b|\.tran\b|\.control/iu);
  });

  it("does not close a deck the author already closed", () => {
    const closed = `${testbench}\n.end`;
    const deck = buildSimulationDeck({ netlist, testbench: closed }, null);
    expect(deck.match(/^\s*\.end\s*$/gimu)).toHaveLength(1);
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
