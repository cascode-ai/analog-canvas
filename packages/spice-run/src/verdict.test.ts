import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { SimulationDiagnostic } from "./contract.js";
import { evaluateSimulationRun } from "./verdict.js";

/**
 * What ngspice 46 printed for five failing decks, and the rawfile when it
 * wrote one. fixtures/ngspice-failures/README.md says how each was captured;
 * every run exited 1. The text below is the simulator's, not a paraphrase.
 */
function capture(name: string, extension: "log" | "raw"): string {
  return readFileSync(
    new URL(
      `../../../fixtures/ngspice-failures/${name}.${extension}`,
      import.meta.url,
    ),
    "utf8",
  );
}

function evaluate(name: string, options: { rawfile?: boolean } = {}) {
  const rawfile = options.rawfile ? capture(name, "raw") : null;
  return evaluateSimulationRun(
    { rawfile: "required" },
    {
      log: capture(name, "log"),
      exitCode: 1,
      signal: null,
      timedOut: false,
      durationMs: 10,
      rawfile,
      rawfileFormat: rawfile === null ? null : "ascii",
      rawfileTruncated: false,
    },
    { timeoutMs: 30_000 },
  );
}

const texts = (diagnostics: readonly SimulationDiagnostic[]) =>
  diagnostics.map((diagnostic) => diagnostic.text);

/** Lines that are true of every failure and so explain none of them. */
function expectNoFollowOnNoise(diagnostics: readonly SimulationDiagnostic[]) {
  const all = texts(diagnostics).join("\n");
  expect(all).not.toMatch(/incomplete or empty netlist/u);
  expect(all).not.toMatch(/check the results below/u);
  expect(all).not.toMatch(/"constants" plot/u);
}

describe("ngspice 46 failures (#1261)", () => {
  it("leads with the subcircuit call that has too few pins", () => {
    const run = evaluate("wrong-port-count");
    expect(run.outcome).toEqual({ status: "failed" });
    expect(run.data).toBeUndefined();
    // ngspice prints this cause with no "Error:" prefix and no line number.
    expect(run.diagnostics[0]).toEqual({
      severity: "error",
      text: 'Too few parameters for subcircuit type "scint" (instance: xxdut)',
    });
    expect(run.diagnostics.at(-1)).toEqual({
      severity: "error",
      text: "The simulator exited with code 1 before producing structured results.",
    });
    expectNoFollowOnNoise(run.diagnostics);
  });

  it("gives an unknown subcircuit the file and line ngspice names", () => {
    const run = evaluate("unknown-subckt");
    expect(run.outcome).toEqual({ status: "failed" });
    expect(run.diagnostics[0]).toEqual({
      severity: "error",
      text: "Error: unknown subckt: xdut vdd 0 vin vout phi1 phi2 sc",
      location: { file: "unknown-subckt.deck.spi", line: 3 },
    });
    expect(texts(run.diagnostics)).not.toContain(
      "in line no. 3 from file unknown-subckt.deck.spi",
    );
    expectNoFollowOnNoise(run.diagnostics);
  });

  it("reports a repeated singular-matrix warning once, with its count", () => {
    const run = evaluate("parallel-sources");
    expect(run.outcome).toEqual({ status: "failed" });
    expect(run.diagnostics[0]).toEqual({
      severity: "error",
      text: "Warning: singular matrix:  check node v1#branch",
      count: 6,
    });
    expect(
      texts(run.diagnostics).filter((text) => text.includes("singular matrix")),
    ).toHaveLength(1);
    expect(texts(run.diagnostics)).toEqual(
      expect.arrayContaining([
        "Error: The operating point could not be simulated successfully.",
        "doAnalyses: OP:  Timestep too small; cause unrecorded.",
        "op simulation(s) aborted",
      ]),
    );
    expectNoFollowOnNoise(run.diagnostics);
  });

  it("does not blame the constants plot for a failed operating point", () => {
    const run = evaluate("failed-op-constants", { rawfile: true });
    expect(run.outcome).toEqual({ status: "failed" });
    expect(run.data).toBeUndefined();
    expect(run.diagnostics[0]).toMatchObject({
      text: "Warning: singular matrix:  check node v1#branch",
    });
    expectNoFollowOnNoise(run.diagnostics);
  });

  it("still explains a rawfile that holds nothing but constants", () => {
    // Without a failure in the log, the constants plot is the only reason
    // there is no result, so it stays.
    const run = evaluateSimulationRun(
      { rawfile: "required" },
      {
        log: "Circuit: * constants only\n",
        exitCode: 0,
        signal: null,
        timedOut: false,
        durationMs: 10,
        rawfile: capture("failed-op-constants", "raw"),
        rawfileFormat: "ascii",
        rawfileTruncated: false,
      },
      { timeoutMs: 30_000 },
    );
    expect(run.outcome).toEqual({ status: "failed" });
    expect(run.diagnostics).toEqual([
      {
        severity: "error",
        text: expect.stringContaining('holds a "constants" plot'),
      },
    ]);
  });

  it("says why a transient stopped early and that its points are partial", () => {
    const run = evaluate("aborted-transient", { rawfile: true });
    expect(run.outcome).toEqual({ status: "failed" });
    const transient = run.data?.analyses[0];
    expect(transient?.analysis).toBe("tran");
    if (transient?.analysis !== "tran") return;
    expect(transient.timeSeconds).toHaveLength(73);
    expect(transient.timeSeconds.at(-1)).toBeCloseTo(9.783e-12, 14);
    expect(run.diagnostics).toEqual([
      {
        severity: "error",
        text:
          "doAnalyses: TRAN:  Timestep too small; time = 9.78316e-12, " +
          'timestep = 1.25e-24: trouble with node "n"',
      },
      { severity: "error", text: "tran simulation(s) aborted" },
      {
        severity: "warning",
        text:
          "The simulator exited with code 1 after the errors above. " +
          "The results below hold only what it computed before it stopped.",
      },
    ]);
  });
});
