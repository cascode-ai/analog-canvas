import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";
import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
  readVacaskSimulationData,
} from "@icm/spice-run";
import {
  ExecutionOutputSchema,
  validateExecutionOutput,
  type ExecutionInput,
  type Executor,
} from "./executor.js";
import { decodeHostedExecutionPayload } from "./hosted-executor.js";
import { executionArtifactEntries } from "./execution-artifacts.js";
import { SimulationFiles } from "./files.js";
import { SimulationService } from "./service.js";
import { prepareExecutionInput } from "./prepare-input.js";
import type { SimulationReply } from "./contract.js";

// This suite isolates result delivery. Native compiler/runner qualification is
// deliberately not claimed by this mocked preparation boundary.
vi.mock("./prepare-input.js", () => ({ prepareExecutionInput: vi.fn() }));

function runReply(reply: SimulationReply) {
  if (!reply.ok || !("run" in reply)) throw Error(JSON.stringify(reply));
  return reply.run;
}

const input: ExecutionInput = {
  language: "vacask",
  mode: "raw",
  netlist: "",
  testbench: "Native test\n",
  inputRevision: "native-rev",
  environment: { profileId: "native-observed" },
  entryPath: "run.sim",
  files: [{ path: "run.sim", text: "Native test\n" }],
  dependencies: [],
};
const fixture = (directory: string, path: string) =>
  readFileSync(
    new URL(`../../../netlists/${directory}/${path}`, import.meta.url),
    "utf8",
  );
async function envelope() {
  const rawfiles = [
    {
      path: "bias/result.raw",
      text: fixture("vacask-divider", "divider_op.raw"),
    },
    { path: "frequency/result.raw", text: fixture("vacask-rc", "rc_ac.raw") },
  ];
  const reading = readVacaskSimulationData(rawfiles, [
    { artifactPath: rawfiles[0]!.path, plotOrdinal: 0, analysis: "op" },
    {
      artifactPath: rawfiles[1]!.path,
      plotOrdinal: 0,
      analysis: "ac",
      axis: "frequency",
    },
  ]);
  if (reading.status !== "read") throw Error(JSON.stringify(reading));
  return ExecutionOutputSchema.parse({
    result: {
      outcome: { status: "completed" },
      diagnostics: reading.diagnostics,
      log: "native output",
      durationMs: 1,
      data: reading.data,
      metadata: {
        schemaVersion: 1,
        input: await createSimulationInputMetadata({
          inputRevision: input.inputRevision,
          netlist: input.netlist,
          testbench: input.testbench,
          deck: input.testbench,
        }),
        configuration: { modelLibrary: null },
        environment: await createSimulationEnvironmentMetadata({
          executor: "local-host",
          reproducibility: "observed",
          profileId: input.environment.profileId,
          platform: "linux/x64",
          simulator: { name: "vacask", version: "0.3.4", binarySha256: null },
          models: null,
          startupSha256: null,
        }),
      },
    },
    rawfiles,
    executedFiles: [
      ...input.files,
      { path: "cells/DUT.inc", text: "// Exact included source\r\n" },
    ],
  });
}
describe("native execution transport and evidence", () => {
  it("delivers multi-file evidence through service start/read/export and recovers from an invalid reply", async () => {
    const output = await envelope();
    vi.mocked(prepareExecutionInput).mockResolvedValue({
      ok: true,
      input: { ...input, preparedDeck: input.testbench },
      digest: "a".repeat(64),
      vectors: [],
      outputs: [],
      deviceOperatingPoints: [],
      measurements: [],
      warnings: [],
      signalNames: {},
      signalTargets: {},
      authoredFiles: input.files,
      generated: [],
      sourceMaps: [],
    });
    const files = new SimulationFiles();
    const executor: Executor = {
      capabilities: async () => ({
        configured: true,
        inputs: ["source"],
        profiles: [],
        analyses: ["op", "ac"],
        parsedAnalyses: ["op", "ac"],
        maxInputBytes: 1_048_576,
        maxTimeoutMs: 10_000,
        cancel: true,
      }),
      execute: vi.fn(async () => structuredClone(output)),
      cancel: vi.fn(),
    };
    const service = new SimulationService(files, executor, () =>
      createEmptyProject("p", "Test", "d"),
    );
    const prepared = await service.handle(
      {
        operation: "prepare",
        source: {
          kind: "workspace",
          workspaceId: "fixture",
          expectedRevision: 0,
        },
      },
      "prepare",
    );
    if (!prepared.ok || !("prepared" in prepared))
      throw Error(JSON.stringify(prepared));
    const op = {
      operation: "start",
      preparedId: prepared.prepared.id,
      digest: prepared.prepared.digest,
    };
    const started = runReply(await service.handle(op, "start"));
    expect(runReply(await service.handle(op, "start")).id).toBe(started.id);
    await vi.waitFor(async () =>
      expect(
        runReply(
          await service.handle(
            { operation: "read", runId: started.id },
            "read",
          ),
        ).state,
      ).toBe("finished"),
    );
    const finished = runReply(
      await service.handle({ operation: "read", runId: started.id }, "read"),
    );
    expect(finished.error).toBeUndefined();
    expect(finished.result?.metadata.environment.simulator.name).toBe("vacask");
    expect(executor.execute).toHaveBeenCalledTimes(1);
    const exported = await service.handle(
      { operation: "export", runId: started.id },
      "export",
    );
    if (!exported.ok || !("artifacts" in exported))
      throw Error(JSON.stringify(exported));
    expect(exported.artifacts.map((a) => a.name)).toEqual(
      expect.arrayContaining([
        "raw/bias/result.raw",
        "raw/frequency/result.raw",
        "executed/run.sim",
        "executed/cells/DUT.inc",
        "op-0.csv",
        "ac-1.csv",
        "evidence-manifest.json",
      ]),
    );
    expect(exported.artifacts.map((a) => a.name)).not.toContain("out.raw");
    const manifest = exported.artifacts.find(
      (a) => a.name === "evidence-manifest.json",
    )!;
    const read = await files.handle({
      action: "artifact",
      artifactId: manifest.id,
    });
    if (!read.ok || !("text" in read)) throw Error("manifest unavailable");
    expect(JSON.parse(read.text).nativeArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "raw",
          path: "bias/result.raw",
          artifact: expect.objectContaining({ name: "raw/bias/result.raw" }),
        }),
        expect.objectContaining({
          kind: "executed",
          path: "run.sim",
          artifact: expect.objectContaining({ name: "executed/run.sim" }),
        }),
      ]),
    );
    // Invalid evidence terminates this result read, not the session or a new run.
    vi.mocked(executor.execute).mockResolvedValueOnce({
      ...output,
      rawfiles: [],
    });
    const broken = runReply(await service.handle(op, "broken"));
    await vi.waitFor(async () =>
      expect(
        runReply(
          await service.handle(
            { operation: "read", runId: broken.id },
            "broken-read",
          ),
        ),
      ).toMatchObject({
        state: "lost",
        error: { code: "SIMULATION_RESULT_INVALID", recovery: "not-retryable" },
      }),
    );
    expect(runReply(await service.handle(op, "broken")).id).toBe(broken.id);
    const retry = runReply(await service.handle(op, "explicit-new-run"));
    await vi.waitFor(async () =>
      expect(
        runReply(
          await service.handle(
            { operation: "read", runId: retry.id },
            "retry-read",
          ),
        ).state,
      ).toBe("finished"),
    );
    expect(executor.execute).toHaveBeenCalledTimes(3);
  });

  it("keeps separate files, exact bytes and per-file plot identities through both executor routes", async () => {
    const output = await envelope();
    output.collectionStatus = "partial";
    const before = structuredClone(output);
    const { result, ...files } = output;
    const decoded = decodeHostedExecutionPayload(input, {
      ...result,
      ...files,
    });
    expect(validateExecutionOutput(input, output).result).toEqual(
      decoded.result,
    );
    expect(decoded.rawfiles).toEqual(output.rawfiles);
    expect(decoded.executedFiles).toEqual(output.executedFiles);
    expect(decoded.collectionStatus).toBe("partial");
    expect(decoded.result.data?.analyses.map((a) => a.analysis)).toEqual([
      "op",
      "ac",
    ]);
    expect(
      decoded.result.data?.rawPlots?.map((plot) => [
        plot.artifactPath,
        plot.artifactPlotOrdinal,
      ]),
    ).toEqual([
      ["bias/result.raw", 0],
      ["frequency/result.raw", 0],
    ]);
    expect(output).toEqual(before);
  });

  it("retains partial raw evidence without reviving withheld numeric data", async () => {
    const output = await envelope();
    delete output.result.data;
    output.result.outcome = { status: "failed" };
    output.rawfiles![1]!.text = "truncated raw file";
    const { result, ...files } = output;
    const decoded = decodeHostedExecutionPayload(input, {
      ...result,
      ...files,
    });
    expect(decoded.result.data).toBeUndefined();
    expect(decoded.result.outcome.status).toBe("failed");
    expect(decoded.rawfiles![1]!.text).toBe("truncated raw file");
  });

  it("preserves cancellation or launch failure before files were executed", async () => {
    const output = await envelope();
    delete output.result.data;
    output.result.outcome = { status: "failed" };
    output.rawfiles = [];
    output.executedFiles = [];
    output.cancelled = true;
    expect(validateExecutionOutput(input, output)).toMatchObject({
      cancelled: true,
      rawfiles: [],
      executedFiles: [],
    });
    delete output.cancelled;
    expect(validateExecutionOutput(input, output).result.outcome.status).toBe(
      "failed",
    );
  });

  it.each([
    "../escape.raw",
    "/tmp/run.raw",
    "C:/result.raw",
    "bad\\path.raw",
    "./result.raw",
  ])(
    "rejects unsafe native artifact path %s before publication",
    async (path) => {
      const output = await envelope();
      output.rawfiles![0]!.path = path;
      expect(() => validateExecutionOutput(input, output)).toThrow(
        expect.objectContaining({
          problem: expect.objectContaining({
            code: "SIMULATION_RESULT_INVALID",
            recovery: "not-retryable",
          }),
        }),
      );
    },
  );

  it("rejects duplicate paths, absent evidence and mixed singular/native envelopes", async () => {
    const output = await envelope();
    for (const mutation of [
      { rawfiles: [...output.rawfiles!, output.rawfiles![0]] },
      { rawfiles: output.rawfiles!.slice(1) },
      { rawfiles: undefined },
      { executedFiles: undefined },
      { rawfile: "not native evidence" },
      { executedDeck: "not native evidence" },
      {
        result: {
          ...output.result,
          data: { ...output.result.data!, rawPlots: [] },
        },
      },
    ])
      expect(() =>
        validateExecutionOutput(input, { ...output, ...mutation }),
      ).toThrow(
        expect.objectContaining({
          problem: expect.objectContaining({
            code: "SIMULATION_RESULT_INVALID",
          }),
        }),
      );
  });

  it("rejects a different run, missing executed entry or old engine answering native input", async () => {
    const output = await envelope();
    expect(() =>
      validateExecutionOutput({ ...input, inputRevision: "other" }, output),
    ).toThrow(
      expect.objectContaining({
        problem: expect.objectContaining({
          code: "SIMULATION_IDENTITY_MISMATCH",
        }),
      }),
    );
    expect(() =>
      validateExecutionOutput(input, { ...output, executedFiles: [] }),
    ).toThrow(
      expect.objectContaining({
        problem: expect.objectContaining({
          code: "SIMULATION_IDENTITY_MISMATCH",
        }),
      }),
    );
    output.result.metadata.environment.simulator.name = "ngspice";
    delete output.rawfiles;
    delete output.executedFiles;
    expect(() => validateExecutionOutput(input, output)).toThrow(
      expect.objectContaining({
        problem: expect.objectContaining({
          code: "SIMULATION_IDENTITY_MISMATCH",
        }),
      }),
    );
  });

  it("publishes source and raw namespaces through the same File Resource without filename collisions", async () => {
    const output = await envelope();
    // Native filenames may equal a service artifact or an input filename.
    output.rawfiles!.push({ path: "result.json", text: "native raw evidence" });
    output.executedFiles!.push({
      path: "result.json",
      text: "source evidence",
    });
    const files = new SimulationFiles();
    const artifacts = executionArtifactEntries(
      validateExecutionOutput(input, output),
    );
    expect(new Set(artifacts.map((item) => item.name)).size).toBe(
      artifacts.length,
    );
    expect(artifacts.map((item) => item.name)).toContain("raw/result.json");
    expect(artifacts.map((item) => item.name)).toContain(
      "executed/result.json",
    );
    for (const item of artifacts) {
      const ref = await files.put(item.name, "text/plain", item.text);
      const read = await files.handle({
        action: "artifact",
        artifactId: ref.id,
      });
      expect(read).toMatchObject({ ok: true, text: item.text });
    }
  });
});
