import { describe, it, expect, vi } from "vitest";
import {
  createEmptyProject,
  CircuitProjectSchema,
  type CircuitProject,
  type SimulationSetup,
} from "@icm/model";
import ota from "../../../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json";
import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
} from "@icm/spice-run";
import { SimulationFiles, sha256 } from "./files.js";
import { SimulationService } from "./service.js";
import {
  ExecutionFailure,
  type Executor,
  type ExecutionInput,
} from "./executor.js";
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
const SETUP_ID = "setup-1";
function saveSetup(project: CircuitProject, setup: SimulationSetup): void {
  project.simulationSetups = [
    { id: SETUP_ID, name: "Setup 1", ...structuredClone(setup) },
  ];
}
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
          kind: "workspace",
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
  it("prepares every saved setup before running a batch sequentially", async () => {
    const files = new SimulationFiles();
    const project = createEmptyProject("batch-project", "Batch", "doc");
    project.simulationSetups = ["A", "B"].map((name) => ({
      id: `setup-${name.toLowerCase()}`,
      name,
      version: 3,
      input: {
        kind: "raw" as const,
        entry: "tb.cir",
        files: [{ path: "tb.cir", text: `${name} deck\n.end\n` }],
        dependencies: [],
        environment: { profileId: "test" },
      },
    }));
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const executor: Executor = {
      capabilities: async () => caps,
      execute: vi.fn(
        (input) =>
          new Promise<Awaited<ReturnType<Executor["execute"]>>>((resolve) => {
            active++;
            maxActive = Math.max(maxActive, active);
            releases.push(() => {
              active--;
              void result(input).then((simulationResult) =>
                resolve({
                  result: simulationResult,
                  rawfile: "raw numbers",
                  executedDeck: input.preparedDeck!,
                }),
              );
            });
          }),
      ),
      cancel: vi.fn(async () => releases.at(-1)?.()),
    };
    const service = new SimulationService(files, executor, () => project);
    const preparedReply = await service.handle(
      {
        operation: "prepare-batch",
        expectedStructureRevision: project.structureRevision,
        items: [
          { id: "tt", setupId: "setup-a" },
          { id: "ff", setupId: "setup-b" },
        ],
      },
      "prepare-batch",
    );
    expect(preparedReply).toMatchObject({
      ok: true,
      batch: {
        state: "prepared",
        items: [
          { id: "tt", state: "prepared" },
          { id: "ff", state: "prepared" },
        ],
      },
    });
    if (!preparedReply.ok || !("batch" in preparedReply)) return;
    expect(executor.execute).not.toHaveBeenCalled();

    const startRequest = {
      operation: "start-batch" as const,
      batchId: preparedReply.batch.id,
    };
    const started = await service.handle(startRequest, "start-batch-once");
    expect(started).toMatchObject({ ok: true, batch: { state: "running" } });
    expect(
      await service.handle(startRequest, "start-batch-once"),
    ).toMatchObject({
      ok: true,
      batch: { id: preparedReply.batch.id, state: "running" },
    });
    await vi.waitFor(() => expect(executor.execute).toHaveBeenCalledTimes(1));
    releases[0]!();
    await vi.waitFor(() => expect(executor.execute).toHaveBeenCalledTimes(2));
    releases[1]!();
    await vi.waitFor(async () =>
      expect(
        await service.handle(
          { operation: "read-batch", batchId: preparedReply.batch.id },
          "read-batch",
        ),
      ).toMatchObject({
        ok: true,
        batch: {
          state: "finished",
          items: [
            { state: "finished", runId: expect.any(String) },
            { state: "finished", runId: expect.any(String) },
          ],
        },
      }),
    );
    expect(maxActive).toBe(1);
  });

  it("expands corner, Design Variable and instance parameter axes into one batch", async () => {
    const project = CircuitProjectSchema.parse(ota);
    const setup = project.simulationSetups.find(
      (candidate) => candidate.input.kind === "structured",
    );
    if (!setup || setup.input.kind !== "structured") throw new Error("setup");
    const setupInput = setup.input;
    setupInput.analyses = [{ kind: "op" }];
    setupInput.environment = { profileId: "test", corner: "tt" };
    const root = project.documents.find(
      (document) => document.id === setupInput.rootDocumentId,
    )!;
    const source = root.instances.find(
      (instance) =>
        instance.netlist?.binding?.kind === "primitive" &&
        instance.netlist.binding.deviceClass === "voltage-source" &&
        "low" in instance.netlist.parameters,
    );
    if (!source) throw new Error("source");
    setupInput.designVariables = [
      {
        id: "input-bias",
        name: "VIN",
        value: "0.9",
        bindings: [
          {
            documentId: root.id,
            instanceId: source.id,
            parameter: "low",
          },
        ],
      },
    ];
    const f = fixture();
    f.executor.capabilities = async () => ({
      ...caps,
      profiles: [{ id: "test", corners: ["tt", "ff"] }],
      modelLibrary: { path: "/models/sky130.lib.spice", section: "tt" },
    });
    const service = new SimulationService(f.files, f.executor, () => project);
    const reply = await service.handle(
      {
        operation: "prepare-sweep",
        setupId: setup.id,
        expectedStructureRevision: project.structureRevision,
        axes: [
          { kind: "corner", values: ["tt", "ff"] },
          {
            kind: "variable",
            variableId: "input-bias",
            values: ["0.85", "0.95"],
          },
          {
            kind: "parameter",
            documentId: root.id,
            instanceId: source.id,
            parameter: "high",
            values: ["0.91", "0.93"],
          },
        ],
      },
      "prepare-sweep",
    );
    expect(reply).toMatchObject({ ok: true, batch: { state: "prepared" } });
    if (!reply.ok || !("batch" in reply)) return;
    expect(reply.batch.items[0]).toMatchObject({
      label: `corner=tt, VIN=0.85, ${source.id}.high=0.91`,
      prepared: { environment: { corner: "tt" } },
    });
    expect(reply.batch.items).toHaveLength(8);
    expect(
      new Set(reply.batch.items.map((item) => item.prepared.digest)).size,
    ).toBe(8);
    expect(project.documents.find((item) => item.id === root.id)).toEqual(root);
  });

  it("does not start a partially invalid batch and cancels queued members", async () => {
    const f = fixture();
    saveSetup(f.project, {
      version: 3,
      input: {
        kind: "raw",
        entry: "tb.cir",
        files: [{ path: "tb.cir", text: deck }],
        dependencies: [],
        environment: { profileId: "test" },
      },
    });
    expect(
      await f.service.handle(
        {
          operation: "prepare-batch",
          expectedStructureRevision: f.project.structureRevision,
          items: [
            { id: "valid", setupId: SETUP_ID },
            { id: "missing", setupId: "setup-missing" },
          ],
        },
        "invalid-batch",
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_SETUP_MISSING" },
    });
    expect(f.executor.execute).not.toHaveBeenCalled();

    const prepared = await f.service.handle(
      {
        operation: "prepare-batch",
        expectedStructureRevision: f.project.structureRevision,
        items: [
          { id: "one", setupId: SETUP_ID },
          { id: "two", setupId: SETUP_ID },
        ],
      },
      "cancel-prepare",
    );
    if (!prepared.ok || !("batch" in prepared)) return;
    await f.service.handle(
      { operation: "start-batch", batchId: prepared.batch.id },
      "cancel-start",
    );
    await vi.waitFor(() => expect(f.executor.execute).toHaveBeenCalledTimes(1));
    const cancelled = await f.service.handle(
      { operation: "cancel-batch", batchId: prepared.batch.id },
      "cancel-batch",
    );
    expect(cancelled).toMatchObject({
      ok: true,
      batch: {
        state: "cancelling",
        items: [{ state: "running" }, { state: "cancelled" }],
      },
    });
    await vi.waitFor(async () =>
      expect(
        await f.service.handle(
          { operation: "read-batch", batchId: prepared.batch.id },
          "cancel-read",
        ),
      ).toMatchObject({
        ok: true,
        batch: {
          state: "cancelled",
          items: [{ state: "finished" }, { state: "cancelled" }],
        },
      }),
    );
    expect(f.executor.execute).toHaveBeenCalledTimes(1);
  });

  it("prepares the corner selected by a structured setup", async () => {
    const project = CircuitProjectSchema.parse(ota);
    const setup = project.simulationSetups[0];
    if (!setup || setup.input.kind !== "structured")
      throw new Error("fixture has no structured setup");
    setup.input.environment = { profileId: "test", corner: "ff" };
    const f = fixture();
    f.executor.capabilities = async () => ({
      ...caps,
      analyses: ["op", "dc", "ac", "tran"],
      profiles: [{ id: "test", corners: ["tt", "ff"] }],
      modelLibrary: { path: "/models/sky130.lib.spice", section: "tt" },
    });
    const service = new SimulationService(f.files, f.executor, () => project);
    const prepared = unwrap(
      await service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-setup",
            setupId: setup.id,
            expectedStructureRevision: project.structureRevision,
          },
        },
        "prepare-ff",
      ),
      "prepared",
    );
    const artifact = prepared.artifacts.find(
      (candidate) => candidate.name === "prepared.cir",
    );
    expect(artifact).toBeDefined();
    expect(
      await f.files.handle({ action: "artifact", artifactId: artifact!.id }),
    ).toMatchObject({
      ok: true,
      text: expect.stringContaining('.lib "/models/sky130.lib.spice" ff'),
    });
  });

  it("prepares the explicitly addressed setup when a Project has several", async () => {
    const f = fixture();
    f.project.simulationSetups = ["A", "B"].map((name) => ({
      id: `setup-${name.toLowerCase()}`,
      name,
      version: 3,
      input: {
        kind: "raw",
        entry: "tb.cir",
        files: [{ path: "tb.cir", text: `${name} deck\n.end\n` }],
        dependencies: [],
        environment: { profileId: "test" },
      },
    }));
    const prepared = unwrap(
      await f.service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-setup",
            setupId: "setup-b",
            expectedStructureRevision: f.project.structureRevision,
          },
        },
        "prepare-b",
      ),
      "prepared",
    );
    unwrap(
      await f.service.handle(
        {
          operation: "start",
          preparedId: prepared.id,
          digest: prepared.digest,
        },
        "start-b",
      ),
      "run",
    );
    expect(f.executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ testbench: "B deck\n.end\n" }),
      expect.any(String),
      undefined,
      { preparedId: prepared.id, preparedDigest: prepared.digest },
    );
    f.release();
  });

  it("prepares and runs a persisted raw Project setup without mutating it", async () => {
    const f = fixture();
    saveSetup(f.project, {
      version: 3,
      input: {
        kind: "raw",
        entry: "tb.cir",
        files: [{ path: "tb.cir", text: deck }],
        dependencies: [],
        environment: { profileId: "test" },
      },
    });

    const before = structuredClone(f.project);
    const prepared = unwrap(
      await f.service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-setup",
            setupId: SETUP_ID,
            expectedStructureRevision: f.project.structureRevision,
          },
        },
        "project-raw",
      ),
      "prepared",
    );
    expect(prepared.mode).toBe("raw");
    expect(prepared.artifacts.map((artifact) => artifact.name)).toEqual(
      expect.arrayContaining(["prepared.cir", "tb.cir", "prepared.json"]),
    );
    expect(f.project).toEqual(before);
    expect(f.executor.execute).not.toHaveBeenCalled();

    const run = unwrap(
      await f.service.handle(
        {
          operation: "start",
          preparedId: prepared.id,
          digest: prepared.digest,
        },
        "run-project-raw",
      ),
      "run",
    );
    f.release();
    await vi.waitFor(async () =>
      expect(
        unwrap(
          await f.service.handle(
            { operation: "read", runId: run.id },
            "read-project-raw",
          ),
          "run",
        ),
      ).toMatchObject({ state: "finished", inputStatus: "unchanged" }),
    );
  });

  it("reports unresolved Project dependencies without reading host paths", async () => {
    const f = fixture();
    saveSetup(f.project, {
      version: 3,
      input: {
        kind: "raw",
        entry: "tb.cir",
        files: [{ path: "tb.cir", text: '.include "models/device.lib"' }],
        dependencies: [
          {
            id: "device-models",
            mountPath: "models/device.lib",
            sha256: "a".repeat(64),
          },
        ],
        environment: { profileId: "test" },
      },
    });
    expect(
      await f.service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-setup",
            setupId: SETUP_ID,
            expectedStructureRevision: f.project.structureRevision,
          },
        },
        "project-dependency",
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_DEPENDENCY_UNAVAILABLE",
        recovery: "fix-input",
        diagnostics: [{ field: "input.dependencies[0]", severity: "error" }],
      },
    });
    expect(f.executor.execute).not.toHaveBeenCalled();
  });

  it("resolves a declared raw dependency only through the selected Profile", async () => {
    const f = fixture();
    const modelDigest = "a".repeat(64);
    f.executor.capabilities = async () => ({
      ...caps,
      profiles: [
        {
          id: "test",
          corners: ["tt"],
          dependencies: [{ id: "device-models", sha256: modelDigest }],
        },
      ],
    });
    saveSetup(f.project, {
      version: 3,
      input: {
        kind: "raw",
        entry: "tb.cir",
        files: [
          {
            path: "tb.cir",
            text: '.lib "models/device.lib" tt\n.end\n',
          },
        ],
        dependencies: [
          {
            id: "device-models",
            mountPath: "models/device.lib",
            sha256: modelDigest,
          },
        ],
        environment: { profileId: "test" },
      },
    });

    const prepared = unwrap(
      await f.service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-setup",
            setupId: SETUP_ID,
            expectedStructureRevision: f.project.structureRevision,
          },
        },
        "project-dependency-resolved",
      ),
      "prepared",
    );
    const started = unwrap(
      await f.service.handle(
        {
          operation: "start",
          preparedId: prepared.id,
          digest: prepared.digest,
        },
        "run-dependency-resolved",
      ),
      "run",
    );
    expect(f.executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        dependencies: [
          {
            id: "device-models",
            mountPath: "models/device.lib",
            sha256: modelDigest,
          },
        ],
      }),
      expect.any(String),
      undefined,
      { preparedId: prepared.id, preparedDigest: prepared.digest },
    );
    f.release();
    await vi.waitFor(async () =>
      expect(
        unwrap(
          await f.service.handle(
            { operation: "read", runId: started.id },
            "dependency-read",
          ),
          "run",
        ),
      ).toMatchObject({ state: "finished", inputStatus: "unchanged" }),
    );
    const saved = f.project.simulationSetups[0]!;
    if (saved.input.kind !== "raw") throw new Error("raw fixture");
    saved.input.dependencies[0]!.sha256 = "b".repeat(64);
    f.project.structureRevision++;
    expect(
      unwrap(
        await f.service.handle(
          { operation: "read", runId: started.id },
          "dependency-changed-read",
        ),
        "run",
      ),
    ).toMatchObject({ inputStatus: "changed" });
  });

  it("rejects stale Project setup preparation by structure revision", async () => {
    const f = fixture();
    expect(
      await f.service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-setup",
            setupId: SETUP_ID,
            expectedStructureRevision: f.project.structureRevision + 1,
          },
        },
        "stale-project",
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT_STRUCTURE_REVISION_CONFLICT",
        recovery: "reprepare",
      },
    });
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
        "evidence-manifest.json",
      ]),
    );
    const evidence = finished.artifacts.find(
      (artifact) => artifact.name === "evidence-manifest.json",
    )!;
    const evidenceRead = await f.files.handle({
      action: "artifact",
      artifactId: evidence.id,
    });
    expect(evidenceRead).toMatchObject({ ok: true });
    if (!evidenceRead.ok || !("text" in evidenceRead)) throw Error("evidence");
    expect(JSON.parse(evidenceRead.text)).toMatchObject({
      schemaVersion: 1,
      run: { id: finished.id, preparedId: prepared.id },
      prepared: { digest: prepared.digest },
      artifacts: expect.arrayContaining([
        expect.objectContaining({ name: "out.raw" }),
        expect.objectContaining({ name: "result.json" }),
      ]),
    });
    expect(unwrap(await f.service.handle(op, "next"), "run").id).not.toBe(
      run.id,
    );
  });
  it("input failures leave the same session usable; stale file edits and path escapes cannot overwrite input", async () => {
    const f = fixture();
    expect(
      await f.service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-setup",
            setupId: SETUP_ID,
            expectedStructureRevision: f.project.structureRevision,
          },
        },
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
    saveSetup(project, {
      version: 3,
      input: {
        kind: "structured",
        designVariables: [],
        runPlan: { mode: "nominal" },
        rootDocumentId: project.topDocumentId,
        analyses: [
          { kind: "op" },
          { kind: "ac", sweep: "dec", points: 10, startHz: 1, stopHz: 1e6 },
        ],
        outputs: [
          {
            id: "out",
            label: "out",
            expression: {
              kind: "voltage",
              documentId: project.topDocumentId,
              anchor: {
                kind: "terminal",
                instanceId: "XDUT",
                pinName: "vout",
              },
              occurrence: [],
            },
          },
        ],
        deviceOperatingPoints: [
          {
            id: "op-m1",
            documentId: "document-ota-5t",
            instanceId: "M1",
            occurrence: ["XDUT"],
          },
        ],
        environment: { profileId },
      },
    });
    const f = fixture();
    f.executor.capabilities = async () => ({
      ...caps,
      profiles: [{ id: profileId, corners: ["tt"] }],
      maxOutputBytes: 100,
    });
    const service = new SimulationService(f.files, f.executor, () => project);
    const prepared = unwrap(
      await service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-setup",
            setupId: SETUP_ID,
            expectedStructureRevision: project.structureRevision,
          },
        },
        "ota",
      ),
      "prepared",
    );
    expect(prepared.vectors.length).toBeGreaterThan(0);
    expect(prepared.deviceOperatingPoints).toEqual([
      expect.objectContaining({
        id: "op-m1",
        reference: "XM1",
        polarity: "nmos",
      }),
    ]);
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
        {
          operation: "prepare",
          source: {
            kind: "project-setup",
            setupId: SETUP_ID,
            expectedStructureRevision: project.structureRevision,
          },
        },
        "ota-unqualified",
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_ANALYSIS_UNQUALIFIED" },
    });
  });

  it("prepares qualified TRAN and keeps an oversized estimate advisory", async () => {
    const project = CircuitProjectSchema.parse(ota);
    const setup = project.simulationSetups[0];
    if (!setup) throw new Error("fixture has no setup");
    if (setup.input.kind !== "structured")
      throw new Error("fixture setup is not structured");
    setup.input.analyses = [
      { kind: "tran", stepSeconds: 1e-9, stopSeconds: 1e-3 },
    ];
    setup.input.environment.profileId = "test";
    const f = fixture();
    f.executor.capabilities = async () => ({
      ...caps,
      analyses: ["op", "ac", "tran"],
      maxOutputBytes: 1024,
    });
    const service = new SimulationService(f.files, f.executor, () => project);
    const prepared = unwrap(
      await service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-setup",
            setupId: setup.id,
            expectedStructureRevision: project.structureRevision,
          },
        },
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
