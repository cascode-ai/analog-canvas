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

/**
 * Model-card notices. The SKY130 NPN block is ngspice 46's text from the
 * Production run in #1313, verbatim. The other two blocks are ngspice 46 on a
 * workstation with the volare SKY130 NPN card: the author's diode card with a
 * mistyped parameter, and the NPN four subcircuits deep, where ngspice cuts
 * its 72-character echo inside the card's name.
 */
const PDK_NPN_BLOCK = `Warning: Model issue on line 1286 :
  .model xdut.xq1:sky130_fd_pr__npn_05v5_w1p00l1p00_model npn level=1 tref ...
unrecognized parameter (dcap) - ignored
unrecognized parameter (gap1) - ignored
unrecognized parameter (gap2) - ignored
unrecognized parameter (tsky130_fd_pr__res_generic_m1) - ignored
unrecognized parameter (tsky130_fd_pr__res_generic_m2) - ignored`;
const AUTHOR_DIODE_BLOCK = `Warning: Model issue on line 11 :
  .model mydiode d (is=1e-14 n=1 bogusx=3) ...
unrecognized parameter (bogusx) - ignored`;
const DEEP_NPN_BLOCK = `Warning: Model issue on line 28 :
  .model xtb.xamp.xbias.xmirror.xq1:sky130_fd_pr__npn_05v5_w1p00l1p00__mod ...
unrecognized parameter (dcap) - ignored
unrecognized parameter (gap1) - ignored
unrecognized parameter (gap2) - ignored`;

/** The run's own files: a DUT using the Profile's NPN by its subcircuit name. */
const NPN_PAIR_SOURCES = [
  `* NPN differential pair\n.lib "icm-models.lib" tt\n.include "dut.cir"\nxdut c1 c2 b1 b2 tail dut\nVD b1 b2 0\n.control\ndc VD -0.1 0.1 0.001\n.endc\n.end\n`,
  `.subckt dut c1 c2 b1 b2 e\nxq1 c1 b1 e 0 sky130_fd_pr__npn_05v5_W1p00L1p00\nxq2 c2 b2 e 0 sky130_fd_pr__npn_05v5_W1p00L1p00\n.ends\n`,
];

function completedRun(blocks: string[], sources?: readonly string[]) {
  return evaluateSimulationRun(
    { rawfile: "not-required" },
    {
      log: [
        "Note: No compatibility mode selected!",
        "Circuit: * NPN differential pair",
        ...blocks.map((block) => `\n${block}\n`),
        "Doing analysis at TEMP = 27.000000 and TNOM = 27.000000",
        "No. of Data Rows : 201",
        "Note: Simulation executed from .control section",
      ].join("\n"),
      exitCode: 0,
      signal: null,
      timedOut: false,
      durationMs: 10,
      rawfile: null,
      rawfileFormat: null,
      rawfileTruncated: false,
    },
    { timeoutMs: 30_000, sources },
  );
}

const dropped = (diagnostics: readonly SimulationDiagnostic[]) =>
  texts(diagnostics.filter((diagnostic) => diagnostic.droppedInput));

describe("model-card notices (#1313)", () => {
  it("does not count a parameter ignored on the Profile library's card as dropped input", () => {
    const run = completedRun([PDK_NPN_BLOCK], NPN_PAIR_SOURCES);
    expect(run.outcome).toEqual({ status: "completed" });
    expect(dropped(run.diagnostics)).toEqual([]);
    // ngspice's lines stay, unedited, as information.
    expect(run.diagnostics).toEqual(
      expect.arrayContaining([
        { severity: "warning", text: "Warning: Model issue on line 1286 :" },
        { severity: "info", text: "unrecognized parameter (dcap) - ignored" },
        {
          severity: "info",
          text: "unrecognized parameter (tsky130_fd_pr__res_generic_m2) - ignored",
        },
      ]),
    );
    // A card cut inside its name is the same card.
    expect(completedRun([DEEP_NPN_BLOCK], NPN_PAIR_SOURCES).outcome).toEqual({
      status: "completed",
    });
  });

  it("keeps the author's own cards and unreadable lines as dropped input", () => {
    const ownDiode = [
      ...NPN_PAIR_SOURCES,
      ".model mydiode d (is=1e-14 n=1 bogusx=3)\n",
    ];
    const both = completedRun([PDK_NPN_BLOCK, AUTHOR_DIODE_BLOCK], ownDiode);
    expect(both.outcome).toEqual({ status: "completed-with-dropped-input" });
    expect(dropped(both.diagnostics)).toEqual([
      "unrecognized parameter (bogusx) - ignored",
    ]);

    // The author's copy of the NPN card, in any case, inside a subcircuit,
    // with its name on a continuation line: ngspice reads it as theirs.
    const ownNpn = [
      ...NPN_PAIR_SOURCES,
      ".subckt mynpn c b e s\n.model\n* copied card\n+ Sky130_FD_PR__NPN_05V5_W1P00L1P00_MODEL npn level=1.0 tref=30 dcap=2\n.ends\n",
    ];
    expect(completedRun([PDK_NPN_BLOCK], ownNpn).outcome).toEqual({
      status: "completed-with-dropped-input",
    });
    const ownDeepNpn = [
      ...NPN_PAIR_SOURCES,
      ".model sky130_fd_pr__npn_05v5_W1p00L1p00__model npn level=1.0 dcap=2\n",
    ];
    expect(completedRun([DEEP_NPN_BLOCK], ownDeepNpn).outcome).toEqual({
      status: "completed-with-dropped-input",
    });

    const badLine = completedRun(
      ["Warning: 'r1 in out' is not a valid resistor instance line, ignored!"],
      NPN_PAIR_SOURCES,
    );
    expect(badLine.outcome).toEqual({ status: "completed-with-dropped-input" });

    // Without the run's files, no card can be told apart from the author's.
    expect(completedRun([PDK_NPN_BLOCK]).outcome).toEqual({
      status: "completed-with-dropped-input",
    });
  });
});
