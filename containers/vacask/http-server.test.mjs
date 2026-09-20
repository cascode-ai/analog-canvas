import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSimulationEnvironmentMetadata,
  SIMULATION_EXECUTOR_RESPONSE_MAX_BYTES,
  SIMULATION_EXECUTOR_STREAM_MAX_BYTES,
} from "@icm/spice-run";
import { createVacaskHttpServer } from "./http-server.mjs";
import { createHash } from "node:crypto";
import {
  EXECUTION_RECEIPT_HEADER,
  readExecutionReceipt,
} from "@icm/simulation-service";
import { executeVacask } from "./execute.mjs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectVacaskModelArtifact } from "./model-symbols.mjs";
vi.mock("./execute.mjs", () => ({ executeVacask: vi.fn() }));
const servers = [];
let runtime, capabilities, limits, supervisor;
beforeEach(async () => {
  vi.mocked(executeVacask).mockReset();
  runtime = {
    environment: await createSimulationEnvironmentMetadata({
      executor: "local-host",
      reproducibility: "observed",
      profileId: "native-proof",
      platform: "test/x64",
      simulator: {
        name: "vacask",
        version: "0.3.4",
        binarySha256: "a".repeat(64),
      },
      models: null,
      startupSha256: "b".repeat(64),
    }),
  };
  limits = {
    maxInputBytes: 1024,
    maxInputFiles: 4,
    maxOutputBytes: 1024,
    maxLogBytes: 512,
    maxRawFiles: 4,
    maxEntries: 20,
  };
  capabilities = {
    configured: true,
    rawfileCollection: "native-multi-ascii",
    maxInputFiles: 4,
    inputs: ["source"],
    analyses: ["op"],
    parsedAnalyses: ["op"],
    profiles: [{ id: "native-proof", corners: [] }],
    maxTimeoutMs: 100,
    maxInputBytes: 1024,
    maxOutputBytes: 1024,
    cancel: true,
  };
  supervisor = {
    limits: { defaultTimeoutMs: 50, maxTimeoutMs: 100, concurrentRuns: 1 },
    snapshot: vi.fn(() => ({ state: "idle" })),
    cancel: vi.fn(),
  };
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
async function start(options = {}) {
  const server = createVacaskHttpServer({
    runtimeReady: runtime,
    capabilities,
    limits,
    supervisor,
    ...options,
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  // A listening socket does not imply asynchronous identity verification is done.
  // Startup-failure tests supply their own readiness inputs and must stay pending.
  if (!options.runtimeReady && !options.capabilities && !options.limits)
    await server.initialized;
  return {
    base,
    post: (body, path = "/api/simulate", headers = {}) =>
      fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
  };
}
const token = "11111111-1111-1111-1111-111111111111";
describe("native HTTP transport", () => {
  it("publishes only the model symbols verified against the runtime dependency", async () => {
    const root = await mkdtemp(join(tmpdir(), "vacask-symbol-health-"));
    const runtimePath = join(root, "library.inc");
    await writeFile(runtimePath, "model core sp_bsim4v8\n");
    const symbols = await inspectVacaskModelArtifact(runtimePath, ["core"]);
    runtime.dependencies = [
      { id: "models", sha256: symbols.sha256, runtimePath },
    ];
    capabilities.profiles[0].dependencies = [
      { id: "models", sha256: symbols.sha256 },
    ];
    capabilities.profiles[0].modelSymbols = [
      { dependencyId: "models", ...symbols },
    ];
    const { base, post } = await start();
    await vi.waitFor(async () =>
      expect((await fetch(base + "/health")).status).toBe(200),
    );
    expect(
      (await (await post({ operation: "capabilities" })).json()).profiles[0]
        .modelSymbols,
    ).toEqual(capabilities.profiles[0].modelSymbols);
  });
  it("keeps health and unavailable capabilities responsive until identity is measured", async () => {
    let finish;
    const { base, post } = await start({
      runtimeReady: new Promise((resolve) => {
        finish = resolve;
      }),
    });
    expect((await fetch(base + "/health")).status).toBe(503);
    expect(
      await (await post({ operation: "capabilities" })).json(),
    ).toMatchObject({ configured: false, profiles: [] });
    finish(runtime);
    await vi.waitFor(async () =>
      expect((await fetch(base + "/health")).status).toBe(200),
    );
    expect(await (await post({ operation: "capabilities" })).json()).toEqual(
      capabilities,
    );
    expect(executeVacask).not.toHaveBeenCalled();
  });
  it("does not advertise invalid runtime limits as healthy", async () => {
    const { base, post } = await start({
      limits: { ...limits, maxLogBytes: 2048 },
    });
    expect((await fetch(base + "/health")).status).toBe(503);
    expect(
      await (await post({ operation: "capabilities" })).json(),
    ).toMatchObject({ configured: false });
  });
  it("does not advertise a mismatched Profile or failed startup", async () => {
    const mismatch = await start({
      capabilities: {
        ...capabilities,
        profiles: [{ id: "another", corners: [] }],
      },
    });
    expect((await fetch(mismatch.base + "/health")).status).toBe(503);
    const failed = await start({
      runtimeReady: Promise.reject(new Error("private path")),
    });
    expect(await (await failed.post({})).json()).toEqual({
      error: "simulator-not-ready",
      message: "The native executor is not ready; editing remains available.",
    });
    expect(executeVacask).not.toHaveBeenCalled();
  });
  it("bounds and validates bodies and refuses browser origin calls before execution", async () => {
    const { base, post } = await start({ maxRequestBytes: 128 });
    expect((await post("{")).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect(
      (await post({}, "/run", { origin: "https://untrusted.test" })).status,
    ).toBe(403);
    expect(
      (await post({}, "/run", { "content-type": "text/plain" })).status,
    ).toBe(415);
    expect((await post({ padding: "x".repeat(256) })).status).toBe(413);
    expect((await post({ operation: "unexpected" })).status).toBe(400);
    expect((await fetch(base + "/run")).status).toBe(404);
    expect(executeVacask).not.toHaveBeenCalled();
  });
  it("honors cancellation arriving before a run without introducing another job queue", async () => {
    const { post } = await start();
    expect((await post({ runToken: "wrong" }, "/cancel")).status).toBe(400);
    expect(await (await post({ runToken: token }, "/cancel")).json()).toEqual({
      accepted: true,
    });
    expect(supervisor.cancel).toHaveBeenCalledWith(token);
    expect(await (await post({ runToken: token }, "/run")).json()).toEqual({
      error: "run-cancelled",
    });
    expect(executeVacask).not.toHaveBeenCalled();
  });
  it("forwards bounded timeout and canonical output, preserving busy retry headers", async () => {
    const { post } = await start();
    vi.mocked(executeVacask).mockResolvedValueOnce({
      ok: true,
      output: {
        result: { outcome: { status: "completed" } },
        rawfiles: [],
        executedFiles: [],
        cancelled: false,
      },
    });
    const done = await post({ timeoutMs: 9999 }, "/run");
    expect(await done.json()).toEqual({
      outcome: { status: "completed" },
      rawfiles: [],
      executedFiles: [],
      cancelled: false,
    });
    expect(executeVacask.mock.calls[0][0].timeoutMs).toBe(100);
    vi.mocked(executeVacask).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "simulator-busy",
        message: "busy",
        recovery: "retry-after",
      },
      retryAfterSeconds: 2,
    });
    const busy = await post({});
    expect(busy.status).toBe(429);
    expect(busy.headers.get("retry-after")).toBe("2");
  });
  it("binds a bounded receipt to the exact returned JSON bytes and executed inputs", async () => {
    const { post } = await start();
    const executedFiles = [{ path: "run.sim", text: "* µ input" }];
    const metadata = {
      schemaVersion: 1,
      input: {
        inputRevision: "rev-µ",
        netlistSha256: "a".repeat(64),
        testbenchSha256: "b".repeat(64),
        deckSha256: "c".repeat(64),
      },
      configuration: { modelLibrary: null },
      environment: runtime.environment,
    };
    const payload = {
      outcome: { status: "completed" },
      metadata,
      log: "µ evidence",
      diagnostics: [],
      durationMs: 1,
      rawfiles: [],
      executedFiles,
      cancelled: false,
      collectionStatus: "complete",
    };
    const { rawfiles, cancelled, collectionStatus, ...result } = payload;
    delete result.executedFiles;
    vi.mocked(executeVacask).mockResolvedValueOnce({
      ok: true,
      output: { result, rawfiles, executedFiles, cancelled, collectionStatus },
    });
    const response = await post({
      runToken: token,
      language: "vacask",
      inputRevision: "rev-µ",
      environment: { profileId: runtime.environment.profileId },
      entryPath: "run.sim",
    });
    expect(response.status).toBe(200);
    const receipt = readExecutionReceipt(
      response.headers.get(EXECUTION_RECEIPT_HEADER),
    );
    const text = await response.text();
    expect(JSON.parse(text)).toEqual(payload);
    expect(receipt).toMatchObject({
      runToken: token,
      metadata,
      outcome: { status: "completed" },
      collectionStatus: "complete",
      byteLength: Buffer.byteLength(text),
      sha256: createHash("sha256").update(text).digest("hex"),
      executedFilesSha256: createHash("sha256")
        .update(JSON.stringify(executedFiles))
        .digest("hex"),
    });
    expect(() => readExecutionReceipt("x".repeat(8193))).toThrow();
    expect(() => readExecutionReceipt("%invalid")).toThrow();
    expect(readExecutionReceipt(null)).toBeNull();
  });
  it("transfers a 9 MiB evidence file only to an opted-in streaming reader", async () => {
    const { post } = await start();
    const evidence = "x".repeat(9 * 1024 * 1024);
    const input = {
      runToken: token,
      language: "vacask",
      inputRevision: "large",
      environment: { profileId: runtime.environment.profileId },
      entryPath: "run.sim",
    };
    const output = {
      result: {
        outcome: { status: "completed" },
        log: "",
        diagnostics: [],
        durationMs: 1,
        metadata: {
          schemaVersion: 1,
          input: {
            inputRevision: "large",
            netlistSha256: "a".repeat(64),
            testbenchSha256: "b".repeat(64),
            deckSha256: "c".repeat(64),
          },
          configuration: { modelLibrary: null },
          environment: runtime.environment,
        },
      },
      executedFiles: [{ path: "run.sim", text: "original" }],
      rawfiles: [{ path: "large.raw", text: evidence }],
      cancelled: false,
      collectionStatus: "complete",
    };
    vi.mocked(executeVacask).mockResolvedValue({ ok: true, output });
    const response = await post(input, "/run", {
      "x-analog-execution-transfer": "receipt-v1",
    });
    const receipt = readExecutionReceipt(
      response.headers.get(EXECUTION_RECEIPT_HEADER),
    );
    const bytes = await response.text();
    expect(receipt.byteLength).toBeGreaterThan(
      SIMULATION_EXECUTOR_RESPONSE_MAX_BYTES,
    );
    expect(receipt.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(JSON.parse(bytes).rawfiles[0].text).toBe(evidence);
    const legacy = await post(input);
    expect(await legacy.json()).toMatchObject({
      collectionStatus: "partial",
      rawfiles: [],
      outcome: { status: "failed" },
    });
  });
  it("reports uncertain completion and retired capacity without leaking host errors", async () => {
    const { post } = await start();
    vi.mocked(executeVacask).mockRejectedValueOnce(
      new Error("secret internal path"),
    );
    const failure = await post({});
    expect(failure.status).toBe(503);
    expect(await failure.json()).toMatchObject({
      error: "simulator-unreachable",
    });
    supervisor.snapshot.mockReturnValue({ state: "fatal" });
    expect((await post({})).status).toBe(503);
    expect(executeVacask).toHaveBeenCalledTimes(1);
  });
  it("bounds serialized replies instead of sending an oversized numerical response", async () => {
    const { post } = await start({ maxResponseBytes: 512 });
    vi.mocked(executeVacask).mockResolvedValueOnce({
      ok: true,
      output: { result: { log: "x".repeat(1024) } },
    });
    const reply = await post({});
    expect(reply.status).toBe(502);
    expect(await reply.json()).toMatchObject({
      error: "executor-response-too-large",
    });
  });
  it.each(["completed", "timed-out"])(
    "retains a terminal %s receipt when numerical serialization exceeds the budget",
    async (status) => {
      const { post } = await start({ maxResponseBytes: 4096 });
      const outcome =
        status === "timed-out" ? { status, timeoutMs: 100 } : { status };
      const files = [{ path: "run.sim", text: "original input" }];
      vi.mocked(executeVacask).mockResolvedValueOnce({
        ok: true,
        output: {
          result: {
            outcome,
            durationMs: 100,
            metadata: { input: { inputRevision: "same" } },
            log: "x".repeat(5000),
            data: { large: "x".repeat(5000) },
          },
          rawfiles: [{ path: "run.raw", text: "x".repeat(5000) }],
          executedFiles: files,
          cancelled: false,
        },
      });
      const reply = await post({});
      expect(reply.status).toBe(200);
      const text = await reply.text();
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4096);
      const payload = JSON.parse(text);
      expect(payload.outcome).toEqual(
        status === "timed-out" ? outcome : { status: "failed" },
      );
      expect(payload.rawfiles).toEqual([]);
      expect(payload.collectionStatus).toBe("partial");
      expect(payload.data).toBeUndefined();
      expect(payload.executedFiles).toEqual(files);
      expect(payload.metadata.input.inputRevision).toBe("same");
      expect(payload.diagnostics[0].text).toContain("withheld");
    },
  );
  it("allows multi-analysis replies beyond the retired 4 MiB hop but caps configured envelopes", async () => {
    const { post } = await start();
    const text = "x".repeat(4 * 1024 * 1024 + 1);
    vi.mocked(executeVacask).mockResolvedValueOnce({
      ok: true,
      output: { result: { log: text } },
    });
    const reply = await post({});
    expect(reply.status).toBe(200);
    expect(JSON.stringify(await reply.json())).toContain(text);
    expect(() =>
      createVacaskHttpServer({
        maxResponseBytes: SIMULATION_EXECUTOR_STREAM_MAX_BYTES + 1,
      }),
    ).toThrow(/ceiling/u);
  });
});
