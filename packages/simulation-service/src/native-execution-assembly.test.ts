import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSimulationEnvironmentMetadata } from "@icm/spice-run";
import { VACASK_PLOT_PREFIX } from "@icm/netlist";
import { evaluateSimulationOutputs } from "./output-evaluation.js";
import { SimulationOutputDataSchema } from "./contract.js";
import {
  assembleNativeExecutionOutput,
  type NativeJobObservation,
} from "./native-execution-output.js";
import type { ExecutionInput } from "./executor.js";

const raw = readFileSync(
  new URL("../../../netlists/vacask-divider/divider_op.raw", import.meta.url),
  "utf8",
);
const environment = () =>
  createSimulationEnvironmentMetadata({
    executor: "local-host",
    reproducibility: "observed",
    profileId: "proof",
    platform: "test/x64",
    simulator: {
      name: "vacask",
      version: "0.3.4",
      binarySha256: "a".repeat(64),
    },
    models: null,
    startupSha256: "b".repeat(64),
  });
function fixture(control = "analysis bias op") {
  const source = `Native observation\ncontrol\n${control}\nendc\n`;
  const input: ExecutionInput = {
    language: "vacask",
    mode: "raw",
    netlist: "",
    testbench: source,
    inputRevision: "rev-1",
    environment: { profileId: "proof" },
    files: [{ path: "run.sim", text: source }],
    dependencies: [],
    entryPath: "run.sim",
    preparedDeck: source,
    collection: { kind: "native-multi-ascii" },
  };
  const job: NativeJobObservation = {
    execution: {
      stdout:
        "Simulating: Native observation\nRunning analysis 'bias'.\n  Elapsed time: 0.001\n",
      stderr: "",
      exitCode: 0,
      signal: null,
      timedOut: false,
      cancelled: false,
      spawnError: null,
      durationMs: 10,
    },
    timeoutMs: 100,
    rawfiles: [{ path: "bias.raw", text: raw }],
    executedFiles: input.files,
    diagnostics: [],
    truncated: false,
  };
  return { input, job };
}
describe("native result assembly", () => {
  it.each([0, 1])(
    "keeps an invalid current probe actionable with exit %s and earlier partial data",
    async (exitCode) => {
      const { input, job } = fixture(
        'analysis bias op\nanalysis response ac from=1 to=1e6 mode="dec" points=10',
      );
      job.execution.exitCode = exitCode;
      job.execution.stdout +=
        "Node 'ILOAD:flow(br)' not found.\nFailed to bind analysis outputs.\n";
      job.diagnostics = [
        { severity: "error", text: "Missing VACASK output response.raw" },
      ];
      const output = await assembleNativeExecutionOutput(
        input,
        job,
        await environment(),
      );
      expect(output.result.outcome.status).toBe("failed");
      expect(output.result.diagnostics.slice(0, 3)).toEqual([
        { severity: "error", text: "Node 'ILOAD:flow(br)' not found." },
        { severity: "error", text: "Failed to bind analysis outputs." },
        job.diagnostics[0],
      ]);
      expect(output.result.data?.analyses).toHaveLength(1);
      expect(output.rawfiles).toEqual(job.rawfiles);
      expect(output.executedFiles).toEqual(job.executedFiles);
    },
  );

  it("recognizes unlocated output-binding failure even without any output file", async () => {
    const { input, job } = fixture("analysis bias op write=0");
    job.rawfiles = [];
    job.execution.stdout += "Failed to bind analysis outputs.\n";
    const output = await assembleNativeExecutionOutput(
      input,
      job,
      await environment(),
    );
    expect(output.result.outcome.status).toBe("failed");
    expect(output.result.diagnostics[0]?.text).toBe(
      "Failed to bind analysis outputs.",
    );
    expect(output.result.data).toBeUndefined();
  });
  it("maps explicitly reported curves into canonical outputs without losing raw or failed-record evidence", async () => {
    const { input, job } = fixture();
    job.rawfiles.push({
      path: "derived.raw",
      text: readFileSync(
        new URL("../../../netlists/vacask-rc/rc_ac.raw", import.meta.url),
        "utf8",
      ),
    });
    const report = {
      artifactPath: "derived.raw",
      plotOrdinal: 0,
      analysis: "ac",
      axis: "frequency",
      probes: [{ name: "output", quantity: "transfer", unit: "1" }],
    };
    job.execution.stdout += VACASK_PLOT_PREFIX + JSON.stringify(report) + "\n";
    job.execution.stdout +=
      VACASK_PLOT_PREFIX +
      JSON.stringify({ ...report, artifactPath: "missing.raw" }) +
      "\n";
    const result = await assembleNativeExecutionOutput(
      input,
      job,
      await environment(),
    );
    expect(result.result.outcome.status).toBe("failed");
    expect(result.result.data?.analyses).toHaveLength(2);
    expect(
      result.result.data?.analyses[1]?.postprocessor?.logLine,
    ).toBeGreaterThan(0);
    const output = evaluateSimulationOutputs(
      result.result.data!,
      [],
      [],
      [],
      [],
      true,
    );
    expect(SimulationOutputDataSchema.safeParse(output).success).toBe(true);
    expect(output.analyses[1]).toMatchObject({
      postprocessor: result.result.data!.analyses[1]!.postprocessor,
      outputs: expect.arrayContaining([
        expect.objectContaining({
          label: "output",
          unit: "1",
          semantics: expect.objectContaining({ valueKind: "complex" }),
        }),
      ]),
    });
    job.truncated = true;
    expect(
      (await assembleNativeExecutionOutput(input, job, await environment()))
        .result.data,
    ).toBeUndefined();
  });
  it("returns canonical numeric and original-file evidence with measured environment", async () => {
    const { input, job } = fixture();
    const measured = await environment();
    const output = await assembleNativeExecutionOutput(input, job, measured);
    expect(output.result.outcome.status).toBe("completed");
    expect(output.result.metadata.environment).toEqual(measured);
    expect(output.result.metadata.input.inputRevision).toBe("rev-1");
    expect(output.result.data?.analyses[0]).toMatchObject({
      analysis: "op",
      rawPlotOrdinals: [0],
    });
    expect(output.rawfiles).toEqual(job.rawfiles);
    expect(output.executedFiles).toEqual(input.files);
  });
  it("retains complete earlier records when a later analysis errors despite exit zero", async () => {
    const { input, job } = fixture("analysis bias op\nanalysis bad nonsense");
    job.execution.stdout +=
      "Analysis type 'nonsense' not found.\n  analysis bad nonsense\n  ^\n5:1 (0x60) in /tmp/run.sim\n";
    const output = await assembleNativeExecutionOutput(
      input,
      job,
      await environment(),
    );
    expect(output.result.outcome.status).toBe("failed");
    expect(output.result.data?.analyses).toHaveLength(1);
    expect(output.result.diagnostics).toContainEqual({
      severity: "error",
      text: "Analysis type 'nonsense' not found.\n  analysis bad nonsense\n  ^\n5:1 (0x60) in /tmp/run.sim",
    });
  });
  it("treats absent requested output as failure without discarding earlier data", async () => {
    const { input, job } = fixture("analysis bias op\nanalysis second op");
    const output = await assembleNativeExecutionOutput(
      input,
      job,
      await environment(),
    );
    expect(output.result.outcome.status).toBe("failed");
    expect(output.result.data?.analyses).toHaveLength(1);
    expect(
      output.result.diagnostics.some((d) =>
        d.text.includes("Missing VACASK output second.raw"),
      ),
    ).toBe(true);
  });
  it("keeps unmatched native records accessible without declaring the executed program failed", async () => {
    const { input, job } = fixture("analysis bias op\nanalysis bias op");
    const output = await assembleNativeExecutionOutput(
      input,
      job,
      await environment(),
    );
    expect(output.result.outcome.status).toBe("completed");
    expect(output.result.data).toBeUndefined();
    expect(
      output.result.diagnostics.some((d) =>
        d.text.includes("ambiguous source identity"),
      ),
    ).toBe(true);
    expect(output.rawfiles).toEqual(job.rawfiles);
  });
  it("supports programs requesting no numeric capture but rejects banner-only false success", async () => {
    const { input, job } = fixture("analysis bias op write=0");
    job.rawfiles = [];
    const uncaptured = await assembleNativeExecutionOutput(
      input,
      job,
      await environment(),
    );
    expect(uncaptured.result.outcome.status).toBe("completed");
    expect(uncaptured.collectionStatus).toBe("complete");
    job.execution.stdout = "This is vacask 0.3.4.\n";
    expect(
      (await assembleNativeExecutionOutput(input, job, await environment()))
        .result.outcome.status,
    ).toBe("failed");
  });
  it("withholds all numeric values when input parameters were ignored or output was truncated", async () => {
    const { input, job } = fixture();
    job.execution.stdout += "Warning, parameter 'wrong' not found. Ignored.\n";
    const dropped = await assembleNativeExecutionOutput(
      input,
      job,
      await environment(),
    );
    expect(dropped.result.outcome.status).toBe("completed-with-dropped-input");
    expect(dropped.result.data).toBeUndefined();
    expect(dropped.collectionStatus).toBe("complete");
    job.execution.stdout = "Simulating: Native observation\n";
    job.truncated = true;
    const truncated = await assembleNativeExecutionOutput(
      input,
      job,
      await environment(),
    );
    expect(truncated.result.outcome.status).toBe("failed");
    expect(truncated.result.data).toBeUndefined();
    expect(truncated.rawfiles).toEqual(job.rawfiles);
    expect(truncated.collectionStatus).toBe("partial");
  });
  it("marks collector failures partial without inferring them from process errors", async () => {
    const { input, job } = fixture();
    job.diagnostics.push({ severity: "error", text: "Unreadable output" });
    const output = await assembleNativeExecutionOutput(
      input,
      job,
      await environment(),
    );
    expect(output.collectionStatus).toBe("partial");
    expect(output.rawfiles).toEqual(job.rawfiles);
  });
  it("reports the actual timeout ceiling and keeps cancellation distinct", async () => {
    const { input, job } = fixture();
    job.execution.timedOut = true;
    job.execution.exitCode = null;
    expect(
      (await assembleNativeExecutionOutput(input, job, await environment()))
        .result.outcome,
    ).toEqual({ status: "timed-out", timeoutMs: 100 });
    job.execution.timedOut = false;
    job.execution.cancelled = true;
    const cancelled = await assembleNativeExecutionOutput(
      input,
      job,
      await environment(),
    );
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.result.outcome.status).toBe("failed");
  });
  it("returns an honest prelaunch failure without fabricated executed files", async () => {
    const { input, job } = fixture();
    job.execution.spawnError = { code: "ENOENT", message: "unavailable" };
    job.execution.exitCode = null;
    job.rawfiles = [];
    job.executedFiles = [];
    const output = await assembleNativeExecutionOutput(
      input,
      job,
      await environment(),
    );
    expect(output.result.outcome.status).toBe("failed");
    expect(output.result.data).toBeUndefined();
    expect(output.executedFiles).toEqual([]);
  });
});
