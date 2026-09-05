import { describe, it, expect, vi } from "vitest";
import { createEmptyProject, CircuitProjectSchema } from "@icm/model";
import ota from "../../../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json";
import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
} from "@icm/spice-run";
import { SimulationFiles, sha256 } from "./files.js";
import {
  SimulationService,
  ExecutionFailure,
  type Executor,
  type ExecutionInput,
} from "./service.js";
import type { Capabilities, SimulationReply } from "./contract.js";

const caps: Capabilities = {
  configured: true,
  inputs: ["raw", "structured"],
  analyses: ["op", "ac"],
  parsedAnalyses: ["op", "ac", "tran"],
  profiles: [{ id: "test", corners: ["tt"] }],
  maxTimeoutMs: 120000,
  maxInputBytes: 1048576,
  maxOutputBytes: 1048576,
  cancel: true,
};
const deck =
  "divider\nV1 in 0 1\nR1 in out 1k\nR2 out 0 1k\n.control\nset filetype=ascii\nop\nwrite out.raw all\n.endc\n.end\n";
async function result(input: ExecutionInput) {
  return {
    outcome: { status: "completed" as const },
    diagnostics: [],
    log: "ngspice OP",
    durationMs: 1,
    data: {
      schemaVersion: 1 as const,
      analyses: [
        {
          analysis: "op" as const,
          plotName: "Operating Point",
          probes: [
            { name: "v(out)", quantity: "voltage", unit: "V", value: 0.5 },
          ],
        },
      ],
    },
    metadata: {
      schemaVersion: 1 as const,
      input: await createSimulationInputMetadata({
        inputRevision: input.inputRevision,
        netlist: input.netlist,
        testbench: input.testbench,
        deck: input.preparedDeck!,
      }),
      configuration: { modelLibrary: null },
      environment: await createSimulationEnvironmentMetadata({
        executor: "local-host",
        reproducibility: "observed",
        profileId: "test",
        platform: "linux/x64",
        simulator: { name: "ngspice", version: "47", binarySha256: null },
        models: null,
        startupSha256: null,
      }),
    },
  };
}
function unwrap<T extends "prepared" | "run">(reply: SimulationReply, key: T) {
  expect(reply).toMatchObject({ ok: true });
  if (!reply.ok || !(key in reply)) throw Error(JSON.stringify(reply));
  return (reply as Extract<SimulationReply, Record<T, unknown>>)[key];
}
function fixture() {
  const files = new SimulationFiles();
  let release: () => void = () => {};
  const wait = new Promise<void>((r) => (release = r));
  const executor: Executor = {
    capabilities: async () => caps,
    execute: vi.fn(async (input) => {
      await wait;
      return {
        result: await result(input),
        rawfile: "raw numbers",
        executedDeck: input.preparedDeck!,
      };
    }),
    cancel: vi.fn(async () => {
      release();
    }),
  };
  const project = createEmptyProject("p", "test", "doc");
  const service = new SimulationService(files, executor, () => project);
  return { files, executor, service, project, release };
}
async function prepareRaw(f: ReturnType<typeof fixture>) {
  const created = await f.files.handle({ action: "create" });
  if (!created.ok || !("workspace" in created)) throw Error("create");
  await f.files.handle({
    action: "update",
    workspaceId: created.workspace.id,
    expectedRevision: 0,
    entry: "deck.cir",
    writes: [{ path: "deck.cir", text: deck }],
  });
  const prepared = unwrap(
    await f.service.handle(
      {
        operation: "prepare",
        source: {
          kind: "raw",
          workspaceId: created.workspace.id,
          expectedRevision: 1,
          environment: { profileId: "test" },
        },
      },
      "prepare",
    ),
    "prepared",
  );
  return { prepared, workspaceId: created.workspace.id };
}
describe("shared simulation lifecycle", () => {
  it("returns a recoverable mismatch when a raw Project setup is sent to structured prepare", async () => {
    const f = fixture();
    f.project.simulation = {
      version: 1,
      input: {
        kind: "raw",
        entry: "tb.cir",
        files: [{ path: "tb.cir", text: deck }],
        dependencies: [],
        environment: { profileId: "test" },
      },
    };

    expect(
      await f.service.handle(
        { operation: "prepare", source: { kind: "structured" } },
        "raw-as-structured",
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_INPUT_MODE_MISMATCH",
        stage: "prepare",
        recovery: "fix-input",
      },
    });
    expect(f.executor.execute).not.toHaveBeenCalled();
    expect(
      await f.service.handle({ operation: "capabilities" }, "after-mismatch"),
    ).toMatchObject({ ok: true, capabilities: { configured: true } });
  });

  it("raw preparation does not mutate Project or execute; snapshots files and exports before running", async () => {
    const f = fixture(),
      before = structuredClone(f.project);
    const { prepared, workspaceId } = await prepareRaw(f);
    expect(f.project).toEqual(before);
    expect(f.executor.execute).not.toHaveBeenCalled();
    expect(prepared.artifacts.map((a) => a.name)).toContain("prepared.cir");
    await f.files.handle({
      action: "update",
      workspaceId,
      expectedRevision: 1,
      writes: [{ path: "deck.cir", text: "changed" }],
    });
    const a = prepared.artifacts.find((a) => a.name === "prepared.cir")!;
    expect(
      await f.files.handle({ action: "artifact", artifactId: a.id }),
    ).toMatchObject({ ok: true, text: deck });
    expect(a.sha256).toBe(await sha256(deck));
  });
  it("start returns immediately; exact retries never execute twice, and another run can follow completion", async () => {
    const f = fixture(),
      { prepared } = await prepareRaw(f);
    const op = {
      operation: "start",
      preparedId: prepared.id,
      digest: prepared.digest,
    };
    const run = unwrap(await f.service.handle(op, "start-once"), "run");
    expect(run.state).toBe("running");
    expect(unwrap(await f.service.handle(op, "start-once"), "run").id).toBe(
      run.id,
    );
    expect(
      await f.service.handle({ ...op, timeoutMs: 100 }, "start-once"),
    ).toMatchObject({ ok: false, error: { code: "REQUEST_ID_REUSED" } });
    expect(await f.service.handle(op, "other")).toMatchObject({
      ok: false,
      error: { code: "SIMULATOR_BUSY" },
    });
    expect(f.executor.execute).toHaveBeenCalledTimes(1);
    f.release();
    await vi.waitFor(async () =>
      expect(
        unwrap(
          await f.service.handle(
            { operation: "read", runId: run.id },
            crypto.randomUUID(),
          ),
          "run",
        ).state,
      ).toBe("finished"),
    );
    const finished = unwrap(
      await f.service.handle({ operation: "read", runId: run.id }, "read"),
      "run",
    );
    expect(finished.artifacts.map((a) => a.name)).toEqual(
      expect.arrayContaining([
        "out.raw",
        "op-0.csv",
        "result.json",
        "executed.cir",
      ]),
    );
    expect(unwrap(await f.service.handle(op, "next"), "run").id).not.toBe(
      run.id,
    );
  });
  it("input failures leave the same session usable; stale file edits and path escapes cannot overwrite input", async () => {
    const f = fixture();
    expect(
      await f.service.handle(
        { operation: "prepare", source: { kind: "structured" } },
        "bad",
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_SETUP_MISSING", recovery: "fix-input" },
    });
    const { workspaceId } = await prepareRaw(f);
    for (const path of [
      "../escape",
      "/tmp/escape",
      ".spiceinit",
      "C:\\escape",
    ]) {
      expect(
        await f.files.handle({
          action: "update",
          workspaceId,
          expectedRevision: 1,
          writes: [{ path, text: "x" }],
        }),
      ).toMatchObject({ ok: false, error: { code: "INPUT_PATH_INVALID" } });
    }
    expect(
      await f.files.handle({
        action: "update",
        workspaceId,
        expectedRevision: 0,
        writes: [],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_REVISION_CONFLICT" },
    });
    expect(
      await f.service.handle({ operation: "capabilities" }, "still-live"),
    ).toMatchObject({ ok: true });
  });
  it("unknown execution remains lost and is never retried implicitly", async () => {
    const f = fixture();
    f.executor.execute = vi.fn(async () => {
      throw new ExecutionFailure(
        {
          code: "NETWORK_UNKNOWN",
          message: "lost",
          stage: "read",
          recovery: "not-retryable",
        },
        true,
      );
    });
    const { prepared } = await prepareRaw(f),
      op = {
        operation: "start",
        preparedId: prepared.id,
        digest: prepared.digest,
      };
    const run = unwrap(await f.service.handle(op, "once"), "run");
    await vi.waitFor(async () =>
      expect(
        unwrap(
          await f.service.handle({ operation: "read", runId: run.id }, "r"),
          "run",
        ).state,
      ).toBe("lost"),
    );
    await f.service.handle(op, "once");
    expect(f.executor.execute).toHaveBeenCalledTimes(1);
    await f.service.clear();
    expect(
      await f.service.handle({ operation: "read", runId: run.id }, "r2"),
    ).toMatchObject({ ok: false, error: { code: "RUN_STATE_LOST" } });
  });
  it("cancel requests executor cleanup, and a late successful completion is not mislabeled cancelled", async () => {
    const f = fixture(),
      { prepared } = await prepareRaw(f);
    const run = unwrap(
      await f.service.handle(
        {
          operation: "start",
          preparedId: prepared.id,
          digest: prepared.digest,
        },
        "once",
      ),
      "run",
    );
    await f.service.handle({ operation: "cancel", runId: run.id }, "cancel");
    expect(f.executor.cancel).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () =>
      expect(
        unwrap(
          await f.service.handle({ operation: "read", runId: run.id }, "read"),
          "run",
        ).state,
      ).toBe("finished"),
    );
  });
  it("compiles the shipped hierarchical OTA through the public structured prepare path", async () => {
    const project = CircuitProjectSchema.parse(ota);
    const profileId = "test";
    project.simulation = {
      version: 1,
      input: {
        kind: "structured",
        rootDocumentId: project.topDocumentId,
        analyses: [
          { kind: "op" },
          { kind: "ac", sweep: "dec", points: 10, startHz: 1, stopHz: 1e6 },
        ],
        probes: [
          {
            id: "out",
            kind: "net-voltage",
            documentId: project.topDocumentId,
            netId: "tb-vout-net",
            occurrence: [],
          },
        ],
        environment: { profileId },
      },
    };
    const f = fixture();
    f.executor.capabilities = async () => ({
      ...caps,
      profiles: [{ id: profileId, corners: ["tt"] }],
      maxOutputBytes: 100,
    });
    const service = new SimulationService(f.files, f.executor, () => project);
    const prepared = unwrap(
      await service.handle(
        { operation: "prepare", source: { kind: "structured" } },
        "ota",
      ),
      "prepared",
    );
    expect(prepared.vectors.length).toBeGreaterThan(0);
    expect(prepared.mode).toBe("structured");
    expect(prepared.warnings).toEqual([
      expect.stringContaining("run remains allowed"),
    ]);
    expect(f.executor.execute).not.toHaveBeenCalled();

    f.executor.capabilities = async () => ({
      ...caps,
      analyses: ["op"],
      profiles: [{ id: profileId, corners: ["tt"] }],
    });
    expect(
      await service.handle(
        { operation: "prepare", source: { kind: "structured" } },
        "ota-unqualified",
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_ANALYSIS_UNQUALIFIED" },
    });
  });

  it("prepares qualified TRAN and keeps an oversized estimate advisory", async () => {
    const project = CircuitProjectSchema.parse(ota);
    if (!project.simulation) throw new Error("fixture has no setup");
    if (project.simulation.input.kind !== "structured")
      throw new Error("fixture setup is not structured");
    project.simulation.input.analyses = [
      { kind: "tran", stepSeconds: 1e-9, stopSeconds: 1e-3 },
    ];
    project.simulation.input.environment.profileId = "test";
    const f = fixture();
    f.executor.capabilities = async () => ({
      ...caps,
      analyses: ["op", "ac", "tran"],
      maxOutputBytes: 1024,
    });
    const service = new SimulationService(f.files, f.executor, () => project);
    const prepared = unwrap(
      await service.handle(
        { operation: "prepare", source: { kind: "structured" } },
        "tran",
      ),
      "prepared",
    );
    expect(prepared.mode).toBe("structured");
    expect(prepared.warnings).toEqual([
      expect.stringContaining("run remains allowed"),
    ]);
    expect(f.executor.execute).not.toHaveBeenCalled();
  });
});
