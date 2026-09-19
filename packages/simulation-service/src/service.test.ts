import { readFileSync } from "node:fs";
import { nativeSky130OtaFixture } from "../test-support/sky130-ota.js";
import { describe, it, expect, vi } from "vitest";
import {
  createEmptyProject,
  createSimulationFolder,
  type ProjectSimulationFolder,
  type SimulationSourceInput,
  CircuitProjectSchema,
  type CircuitProject,
} from "@icm/model";
import { currentFiveTransistorOtaCircuitSource } from "../../../apps/editor/src/examples/five-transistor-ota.test-support.js";
import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
} from "@icm/spice-run";
import { assembleNativeExecutionOutput } from "./native-execution-output.js";
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
  rawfileCollection: "native-multi-ascii",
  maxInputFiles: 24,
  inputs: ["source"],
  analyses: ["op", "ac"],
  parsedAnalyses: ["op", "ac", "tran"],
  profiles: [
    {
      id: "test",
      corners: ["tt"],
      dependencies: [{ id: "models", sha256: "a".repeat(64) }],
    },
  ],
  maxTimeoutMs: 120000,
  maxInputBytes: 1048576,
  maxOutputBytes: 1048576,
  cancel: true,
};
const deck = readFileSync(
  new URL("../../../netlists/vacask-divider/divider.sim", import.meta.url),
  "utf8",
).replace(/  sweep supply[\s\S]*?endc/u, "endc");
const rawfile = readFileSync(
  new URL("../../../netlists/vacask-divider/divider_op.raw", import.meta.url),
  "utf8",
);
function sourceFolder(
  id: string,
  name: string,
  input: Pick<SimulationSourceInput, "entry" | "files" | "dependencies">,
): ProjectSimulationFolder {
  const folder = createSimulationFolder({ id, name, profileId: "test" });
  folder.input.entry = input.entry;
  folder.input.files = [
    {
      path: "experiment.json",
      text: JSON.stringify({ version: 2, environment: { profileId: "test" } }),
    },
    ...input.files,
  ];
  folder.input.dependencies = input.dependencies;
  return folder;
}
function saveSource(
  project: CircuitProject,
  input: Pick<SimulationSourceInput, "entry" | "files" | "dependencies">,
) {
  project.simulationFolders = [sourceFolder(SETUP_ID, "Setup 1", input)];
}
function nativeOtaFolder(
  project: CircuitProject,
  analysis: string,
  section = "tt",
) {
  const folder = createSimulationFolder({
    id: SETUP_ID,
    name: "OTA",
    profileId: "test",
    documentId: project.topDocumentId,
  });
  const entry = folder.input.files.find(
    (file) => file.path === folder.input.entry,
  )!;
  entry.text = entry.text
    .replace(
      'include "circuit.spice"',
      `include "models/library.inc" section=${section}\ninclude "circuit.spice"`,
    )
    .replace("analysis op op", analysis);
  folder.input.dependencies = [
    { id: "models", sha256: "a".repeat(64), mountPath: "models/library.inc" },
  ];
  project.simulationFolders = [folder];
  return folder;
}
const SETUP_ID = "folder-1";
// Lifecycle tests mock process scheduling, but use recorded native plot bytes
// and the real result assembler. Real execution is covered by the public journey.
async function result(input: ExecutionInput) {
  const hasOp = input.files.some((f) =>
    f.text.includes("analysis divider_op op"),
  );
  return assembleNativeExecutionOutput(
    input,
    {
      execution: {
        stdout: hasOp
          ? "Running analysis 'divider_op'.\n  Elapsed time: 0.001\n"
          : "",
        stderr: "",
        exitCode: 0,
        signal: null,
        spawnError: null,
        timedOut: false,
        cancelled: false,
        durationMs: 1,
      },
      timeoutMs: 1000,
      rawfiles: hasOp ? [{ path: "divider_op.raw", text: rawfile }] : [],
      executedFiles: input.files,
      diagnostics: [],
      truncated: false,
    },
    await createSimulationEnvironmentMetadata({
      executor: "local-host",
      reproducibility: "observed",
      profileId: "test",
      platform: "test/x64",
      simulator: { name: "vacask", version: "0.3.4", binarySha256: null },
      models: null,
      startupSha256: null,
    }),
  );
}
// Synthetic ngspice reply for transport/Spec contracts, not engine acceptance.
async function ngspiceResult(input: ExecutionInput) {
  return {
    outcome: { status: "completed" as const },
    diagnostics: [],
    log: "fixture",
    durationMs: 1,
    metadata: {
      schemaVersion: 1 as const,
      configuration: { modelLibrary: null },
      input: await createSimulationInputMetadata({
        inputRevision: input.inputRevision,
        netlist: input.netlist,
        testbench: input.testbench,
        deck: input.preparedDeck!,
      }),
      environment: await createSimulationEnvironmentMetadata({
        executor: "local-host",
        reproducibility: "observed",
        profileId: "test",
        platform: "test/x64",
        simulator: { name: "ngspice", version: "test", binarySha256: null },
        models: null,
        startupSha256: null,
      }),
    },
    data: {
      schemaVersion: 1 as const,
      analyses: [
        {
          analysis: "op" as const,
          plotName: "Operating Point",
          probes: [
            { name: "v(out)", quantity: "voltage", unit: "V", value: 1 },
          ],
        },
      ],
    },
  };
}
function unwrap<T extends "prepared" | "run">(reply: SimulationReply, key: T) {
  expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
  if (!reply.ok || !(key in reply)) throw Error(JSON.stringify(reply));
  return (reply as Extract<SimulationReply, Record<T, unknown>>)[key];
}
function fixture(engine: "ngspice" | "vacask" = "vacask") {
  const files = new SimulationFiles();
  let release: () => void = () => {};
  const wait = new Promise<void>((r) => (release = r));
  const executor: Executor = {
    capabilities: async () =>
      engine === "vacask"
        ? caps
        : { ...caps, rawfileCollection: "declared-single-ascii" },
    execute: vi.fn(async (input) => {
      await wait;
      return result(input);
    }),
    cancel: vi.fn(async () => {
      release();
    }),
  };
  const project = createEmptyProject("p", "test", "doc");
  const service = new SimulationService(files, executor, () => project);
  return { files, executor, service, project, release };
}
async function prepareRaw(f: ReturnType<typeof fixture>, source = deck) {
  const created = await f.files.handle({ action: "create" });
  if (!created.ok || !("workspace" in created)) throw Error("create");
  await f.files.handle({
    action: "update",
    owner: { kind: "session-workspace", workspaceId: created.workspace.id },
    expectedRevision: 0,
    entry: "deck.cir",
    writes: [
      { path: "deck.cir", text: source },
      {
        path: "experiment.json",
        text: JSON.stringify({
          version: 2,
          environment: { profileId: "test" },
        }),
      },
    ],
  });
  const prepared = unwrap(
    await f.service.handle(
      {
        operation: "prepare",
        source: {
          kind: "workspace",
          workspaceId: created.workspace.id,
          expectedRevision: 1,
        },
      },
      "prepare",
    ),
    "prepared",
  );
  return { prepared, workspaceId: created.workspace.id };
}
describe("shared simulation lifecycle", () => {
  it("advertises the session concurrency limit and sequential batch path", async () => {
    const f = fixture("ngspice");
    expect(
      await f.service.handle({ operation: "capabilities" }, "capabilities"),
    ).toMatchObject({
      ok: true,
      capabilities: {
        maxActiveRuns: 1,
        batch: { execution: "sequential" },
      },
    });
  });

  it("delivers the same captured Spec report through run reads and artifacts", async () => {
    const f = fixture("ngspice");
    const source =
      "Spec fixture\nV1 out 0 1\nR1 out 0 1k\n* @spec peak <= 2 unit=V\n.control\nop\nmeas tran peak MAX v(out)\nwrite out.raw all\n.endc\n.end\n";
    vi.mocked(f.executor.execute).mockImplementation(async (input) => ({
      result: { ...(await ngspiceResult(input)), log: "peak = 1.8" },
      rawfile: "raw numbers",
    }));
    const { prepared } = await prepareRaw(f, source);
    const started = unwrap(
      await f.service.handle(
        {
          operation: "start",
          preparedId: prepared.id,
          digest: prepared.digest,
        },
        "spec-start",
      ),
      "run",
    );
    await vi.waitFor(async () =>
      expect(
        unwrap(
          await f.service.handle(
            { operation: "read", runId: started.id },
            "spec-read",
          ),
          "run",
        ).state,
      ).toBe("finished"),
    );
    const finished = unwrap(
      await f.service.handle(
        { operation: "read", runId: started.id },
        "spec-final",
      ),
      "run",
    );
    expect(finished.outputData?.specs).toMatchObject({
      runId: started.id,
      preparedId: prepared.id,
      inputDigest: prepared.digest,
      results: [{ name: "peak", value: 1.8, judgment: "pass" }],
    });
    const artifact = finished.artifacts.find((a) => a.name === "specs.json")!;
    const read = await f.files.handle({
      action: "artifact",
      artifactId: artifact.id,
    });
    if (!read.ok || !("text" in read)) throw Error("Missing Spec artifact");
    expect(JSON.parse(read.text)).toEqual(finished.outputData?.specs);
    expect(finished.artifacts.map((a) => a.name)).toEqual(
      expect.arrayContaining(["out.raw", "specs.csv", "log.txt"]),
    );
    expect(finished.outputData).toEqual({
      schemaVersion: 1,
      analyses: [],
      diagnostics: [],
      specs: finished.outputData!.specs,
    });
    expect(
      finished.artifacts
        .filter((a) => a.name.endsWith(".csv"))
        .map((a) => a.name)
        .sort(),
    ).toEqual(["op-0.csv", "specs.csv"]);
    expect(finished.artifacts.map((a) => a.name)).not.toEqual(
      expect.arrayContaining(["outputs.json"]),
    );
    expect(finished.artifacts.map((a) => a.name)).not.toEqual(
      expect.arrayContaining(["native-measurements.json"]),
    );
    await f.service.clear();
  });
  it("hands off one complete AC CSV and only authored metrics, with no automatic summaries", async () => {
    const f = fixture("ngspice");
    const source =
      "AC fixture\nV1 out 0 1\nR1 out 0 1k\n.control\nac dec 80 10 1Meg\nmeas ac gain_at_fc FIND v(out) AT=1591.55\nwrite out.raw all\n.endc\n.end\n";
    const analysis = {
      analysis: "ac" as const,
      plotName: "AC Analysis",
      frequencyHz: [10, 1591.55],
      probes: [
        {
          name: "v(out)",
          quantity: "voltage",
          unit: "V",
          real: [0.99, 0.5],
          imag: [-0.01, -0.5],
        },
      ],
    };
    vi.mocked(f.executor.execute).mockImplementation(async (input) => ({
      result: {
        ...(await ngspiceResult(input)),
        log: "gain_at_fc = 0.5",
        data: { schemaVersion: 1, analyses: [analysis] },
      },
      rawfile: "captured raw",
    }));
    const { prepared } = await prepareRaw(f, source);
    const started = unwrap(
      await f.service.handle(
        {
          operation: "start",
          preparedId: prepared.id,
          digest: prepared.digest,
        },
        "ac-start",
      ),
      "run",
    );
    await vi.waitFor(async () =>
      expect(
        unwrap(
          await f.service.handle(
            { operation: "read", runId: started.id },
            "ac-poll",
          ),
          "run",
        ).state,
      ).toBe("finished"),
    );
    const finished = unwrap(
      await f.service.handle(
        { operation: "read", runId: started.id },
        "ac-read",
      ),
      "run",
    );
    expect(finished.result?.data?.analyses).toEqual([analysis]);
    expect(finished.outputData).toEqual({
      schemaVersion: 1,
      analyses: [],
      diagnostics: [],
      specs: expect.objectContaining({
        results: [
          expect.objectContaining({
            name: "gain_at_fc",
            value: 0.5,
            judgment: "unconstrained",
          }),
        ],
      }),
    });
    expect(
      finished.artifacts
        .filter((a) => a.name.endsWith(".csv"))
        .map((a) => a.name)
        .sort(),
    ).toEqual(["ac-0.csv", "specs.csv"]);
    const csv = finished.artifacts.find((a) => a.name === "ac-0.csv")!;
    const read = await f.files.handle({
      action: "artifact",
      artifactId: csv.id,
    });
    if (!read.ok || !("text" in read)) throw Error("Missing AC CSV");
    expect(read.text).toContain("1591.55,0.5,-0.5");
    expect(read.text).toContain("0.99,-0.01");
    await f.service.clear();
  });
  it.each([false, true])(
    "runs a recoverable sequential batch (first run fails: %s)",
    async (firstRunFails) => {
      const files = new SimulationFiles();
      const project = createEmptyProject("batch-project", "Batch", "doc");
      project.simulationFolders = ["A", "B"].map((name) =>
        sourceFolder(`folder-${name.toLowerCase()}`, name, {
          entry: "tb.cir",
          files: [{ path: "tb.cir", text: `${deck}\n// Batch ${name}\n` }],
          dependencies: [],
        }),
      );
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
              const index = releases.length;
              releases.push(() => {
                active--;
                void result(input).then((output) => {
                  if (firstRunFails && index === 0) {
                    output.result.outcome = { status: "failed" };
                    output.result.diagnostics.push({
                      severity: "error",
                      text: "Failed to bind analysis outputs.",
                    });
                  }
                  resolve(output);
                });
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
            { id: "tt", folderId: "folder-a" },
            { id: "ff", folderId: "folder-b" },
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
      // Recover identifiers from the existing Batch resource rather than
      // submitting another start after a caller loses its transient Run IDs.
      const recovered = await service.handle(
        { operation: "read-batch", batchId: preparedReply.batch.id },
        "recover-batch",
      );
      if (!recovered.ok || !("batch" in recovered))
        throw Error(JSON.stringify(recovered));
      expect(
        new Set(recovered.batch.items.map((item) => item.runId)).size,
      ).toBe(2);
      for (const [index, item] of recovered.batch.items.entries()) {
        const run = unwrap(
          await service.handle(
            { operation: "read", runId: item.runId! },
            `recover-${index}`,
          ),
          "run",
        );
        expect(run.state).toBe("finished");
        expect(run.result?.outcome.status).toBe(
          firstRunFails && index === 0 ? "failed" : "completed",
        );
        expect(
          run.artifacts.some((artifact) => artifact.name === "log.txt"),
        ).toBe(true);
      }
      expect(executor.execute).toHaveBeenCalledTimes(2);
    },
  );

  it("prepares native parameter/corner/temperature sweep members with separate identities through the shared service", async () => {
    const project = CircuitProjectSchema.parse(
      currentFiveTransistorOtaCircuitSource(),
    );
    const folder = nativeOtaFolder(project, "analysis bias op");
    const document = project.documents.find((d) =>
      d.instances.some((i) => i.netlist?.parameters.w),
    )!;
    const instance = document.instances.find((i) => i.netlist?.parameters.w)!;
    const before = structuredClone(project);
    const f = fixture();
    f.executor.capabilities = async () => ({
      ...caps,
      profiles: [
        {
          ...caps.profiles[0]!,
          corners: ["tt", "ff"],
          modelLibrary: { dependencyId: "models", defaultSection: "tt" },
        },
      ],
    });
    const service = new SimulationService(f.files, f.executor, () => project);
    const request = {
      operation: "prepare-sweep" as const,
      folderId: folder.id,
      expectedStructureRevision: project.structureRevision,
      axes: [
        {
          kind: "parameter" as const,
          documentId: document.id,
          instanceId: instance.id,
          parameter: "w",
          values: ["10u", "20u"],
        },
        { kind: "corner" as const, values: ["tt", "ff"] },
        { kind: "temperature" as const, values: [27, 125] },
      ],
    };
    const reply = await service.handle(request, "native-parameter-sweep");
    expect(reply).toMatchObject({ ok: true, batch: { state: "prepared" } });
    if (!reply.ok || !("batch" in reply)) throw Error(JSON.stringify(reply));
    expect(reply.batch.items.map((item) => item.label)).toEqual([
      `${instance.id}.w=10u, corner=tt, temp=27C`,
      `${instance.id}.w=10u, corner=tt, temp=125C`,
      `${instance.id}.w=10u, corner=ff, temp=27C`,
      `${instance.id}.w=10u, corner=ff, temp=125C`,
      `${instance.id}.w=20u, corner=tt, temp=27C`,
      `${instance.id}.w=20u, corner=tt, temp=125C`,
      `${instance.id}.w=20u, corner=ff, temp=27C`,
      `${instance.id}.w=20u, corner=ff, temp=125C`,
    ]);
    expect(
      new Set(reply.batch.items.map((item) => item.prepared.digest)).size,
    ).toBe(8);
    expect(
      new Set(reply.batch.items.map((item) => item.prepared.inputRevision))
        .size,
    ).toBe(8);
    expect(
      reply.batch.items.map((item) => item.prepared.environment.corner),
    ).toEqual(["tt", "tt", "ff", "ff", "tt", "tt", "ff", "ff"]);
    expect(
      reply.batch.items.map((item) => item.prepared.environment.temperatureC),
    ).toEqual([27, 125, 27, 125, 27, 125, 27, 125]);
    expect(project).toEqual(before);
    expect(f.executor.execute).not.toHaveBeenCalled();
    const again = await service.handle(request, "native-parameter-repeat");
    if (!again.ok || !("batch" in again)) throw Error(JSON.stringify(again));
    expect(again.batch.items.map((item) => item.prepared.digest)).toEqual(
      reply.batch.items.map((item) => item.prepared.digest),
    );
    expect(
      await service.handle(
        { ...request, axes: [{ ...request.axes[0]!, instanceId: "missing" }] },
        "native-invalid-point",
      ),
    ).toMatchObject({ ok: false, error: { recovery: "fix-input" } });
    expect(f.executor.execute).not.toHaveBeenCalled();
  });

  it("expands corner, Design Variable and instance parameter axes into one batch", async () => {
    const project = CircuitProjectSchema.parse(
      currentFiveTransistorOtaCircuitSource(),
    );
    const folder = nativeOtaFolder(project, "analysis bias op");
    const root = project.documents.find(
      (document) => document.id === project.topDocumentId,
    )!;
    const source = root.instances.find(
      (instance) =>
        instance.netlist?.binding?.kind === "primitive" &&
        instance.netlist.binding.deviceClass === "voltage-source" &&
        "low" in instance.netlist.parameters,
    );
    if (!source) throw new Error("source");
    // The native declaration owns the nominal value. Canvas owns its explicit
    // expression reference, not a second JSON binding/value table.
    source.netlist!.parameters.low = "{VIN}";
    const entry = folder.input.files.find(
      (file) => file.path === folder.input.entry,
    )!;
    entry.text = entry.text.replace(
      'include "models/library.inc"',
      'parameters VIN=0.9\ninclude "models/library.inc"',
    );
    const before = structuredClone(project);
    const f = fixture();
    f.executor.capabilities = async () => ({
      ...caps,
      profiles: [
        {
          id: "test",
          corners: ["tt", "ff"],
          dependencies: [{ id: "models", sha256: "a".repeat(64) }],
          modelLibrary: { dependencyId: "models", defaultSection: "tt" },
        },
      ],
    });
    const service = new SimulationService(f.files, f.executor, () => project);
    const reply = await service.handle(
      {
        operation: "prepare-sweep",
        folderId: folder.id,
        expectedStructureRevision: project.structureRevision,
        axes: [
          { kind: "corner", values: ["tt", "ff"] },
          {
            kind: "variable",
            variableId: "VIN",
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
    expect(project).toEqual(before);
  });

  it("does not start a partially invalid batch and cancels queued members", async () => {
    const f = fixture();
    saveSource(f.project, {
      entry: "tb.cir",
      files: [{ path: "tb.cir", text: deck }],
      dependencies: [],
    });
    expect(
      await f.service.handle(
        {
          operation: "prepare-batch",
          expectedStructureRevision: f.project.structureRevision,
          items: [
            { id: "valid", folderId: SETUP_ID },
            { id: "missing", folderId: "folder-missing" },
          ],
        },
        "invalid-batch",
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_FOLDER_MISSING" },
    });
    expect(f.executor.execute).not.toHaveBeenCalled();

    const prepared = await f.service.handle(
      {
        operation: "prepare-batch",
        expectedStructureRevision: f.project.structureRevision,
        items: [
          { id: "one", folderId: SETUP_ID },
          { id: "two", folderId: SETUP_ID },
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

  it("prepares the corner selected by a Canvas-bound native folder", async () => {
    const project = CircuitProjectSchema.parse(
      currentFiveTransistorOtaCircuitSource(),
    );
    const folder = nativeOtaFolder(project, "analysis bias op", "ff");
    const f = fixture();
    f.executor.capabilities = async () => ({
      ...caps,
      analyses: ["op", "dc", "ac", "tran"],
      profiles: [
        {
          id: "test",
          corners: ["tt", "ff"],
          dependencies: [{ id: "models", sha256: "a".repeat(64) }],
          modelLibrary: { dependencyId: "models", defaultSection: "tt" },
        },
      ],
    });
    const before = structuredClone(project);
    const service = new SimulationService(f.files, f.executor, () => project);
    const prepared = unwrap(
      await service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: folder.id,
            expectedStructureRevision: project.structureRevision,
          },
        },
        "prepare-ff",
      ),
      "prepared",
    );
    expect(prepared.environment.corner).toBe("ff");
    expect(project).toEqual(before);
    const artifact = prepared.artifacts.find(
      (candidate) => candidate.name === "prepared.cir",
    );
    expect(artifact).toBeDefined();
    expect(
      await f.files.handle({ action: "artifact", artifactId: artifact!.id }),
    ).toMatchObject({
      ok: true,
      text: expect.stringContaining('include "models/library.inc" section=ff'),
    });
  });

  it("prepares the explicitly addressed folder when a Project has several", async () => {
    const f = fixture();
    f.project.simulationFolders = ["A", "B"].map((name) =>
      sourceFolder(`folder-${name.toLowerCase()}`, name, {
        entry: "tb.cir",
        files: [{ path: "tb.cir", text: `${name} deck\ncontrol\nendc\n` }],
        dependencies: [],
      }),
    );
    const prepared = unwrap(
      await f.service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: "folder-b",
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
      expect.objectContaining({ testbench: "B deck\ncontrol\nendc\n" }),
      expect.any(String),
      undefined,
      { preparedId: prepared.id, preparedDigest: prepared.digest },
    );
    f.release();
  });

  it("prepares and runs a persisted raw Project folder without mutating it", async () => {
    const f = fixture();
    saveSource(f.project, {
      entry: "tb.cir",
      files: [{ path: "tb.cir", text: deck }],
      dependencies: [],
    });

    const before = structuredClone(f.project);
    const prepared = unwrap(
      await f.service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: SETUP_ID,
            expectedStructureRevision: f.project.structureRevision,
          },
        },
        "project-raw",
      ),
      "prepared",
    );
    expect(prepared.mode).toBe("source");
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
    saveSource(f.project, {
      entry: "tb.cir",
      files: [
        {
          path: "tb.cir",
          text: 'Native dependency\ninclude "models/device.lib"\ncontrol\nendc\n',
        },
      ],
      dependencies: [
        {
          id: "device-models",
          mountPath: "models/device.lib",
          sha256: "a".repeat(64),
        },
      ],
    });
    expect(
      await f.service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: SETUP_ID,
            expectedStructureRevision: f.project.structureRevision,
          },
        },
        "project-dependency",
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_COMPILE_REFUSED",
        recovery: "fix-input",
        diagnostics: [
          { code: "SIMULATION_DEPENDENCY_UNAVAILABLE", severity: "error" },
        ],
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
    saveSource(f.project, {
      entry: "tb.cir",
      files: [
        {
          path: "tb.cir",
          text: 'Native dependency\ninclude "models/device.lib" section=tt\ncontrol\nendc\n',
        },
      ],
      dependencies: [
        {
          id: "device-models",
          mountPath: "models/device.lib",
          sha256: modelDigest,
        },
      ],
    });

    const prepared = unwrap(
      await f.service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: SETUP_ID,
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
    const saved = f.project.simulationFolders[0]!;

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

  it("rejects stale Project folder preparation by structure revision", async () => {
    const f = fixture();
    expect(
      await f.service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: SETUP_ID,
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
      owner: { kind: "session-workspace", workspaceId },
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
        "raw/divider_op.raw",
        "op-0.csv",
        "result.json",
        "executed/deck.cir",
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
        expect.objectContaining({ name: "raw/divider_op.raw" }),
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
            kind: "project-folder",
            folderId: SETUP_ID,
            expectedStructureRevision: f.project.structureRevision,
          },
        },
        "bad",
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_FOLDER_MISSING", recovery: "fix-input" },
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
          owner: { kind: "session-workspace", workspaceId },
          expectedRevision: 1,
          writes: [{ path, text: "x" }],
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "SIMULATION_FILE_INVALID" },
      });
    }
    expect(
      await f.files.handle({
        action: "update",
        owner: { kind: "session-workspace", workspaceId },
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
  it("prepares the shipped hierarchical OTA with native voltage and evidence-backed model OP acquisitions", async () => {
    const { project, profile, voltage, m1, acquisitions } =
      nativeSky130OtaFixture();
    expect(voltage.vector).toBe("vout");
    expect(m1).toBeDefined();
    expect(acquisitions).toHaveLength(9);
    expect(
      acquisitions.every(
        (a) => a.reference === "XDUT:XM1:msky130_fd_pr__nfet_01v8",
      ),
    ).toBe(true);
    const f = fixture();
    f.executor.capabilities = async () => ({
      ...caps,
      profiles: [profile],
      maxOutputBytes: 100,
    });
    const service = new SimulationService(f.files, f.executor, () => project);
    const prepared = unwrap(
      await service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: SETUP_ID,
            expectedStructureRevision: project.structureRevision,
          },
        },
        "ota",
      ),
      "prepared",
    );
    expect(prepared.vectors.length).toBeGreaterThan(0);
    expect(prepared.deviceOperatingPoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: "document-ota-5t",
          instanceId: "M1",
          occurrence: ["XDUT"],
          reference: "XDUT:XM1:msky130_fd_pr__nfet_01v8",
          polarity: "nmos",
        }),
      ]),
    );
    expect(prepared.mode).toBe("source");
    expect(prepared.warnings).toEqual([
      expect.stringContaining('dc is used only with type="dc"'),
      expect.stringContaining("run remains allowed"),
    ]);
    expect(f.executor.execute).not.toHaveBeenCalled();

    f.executor.capabilities = async () => ({
      ...caps,
      analyses: ["op"],
      profiles: [profile],
    });
    expect(
      await service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: SETUP_ID,
            expectedStructureRevision: project.structureRevision,
          },
        },
        "ota-unqualified",
      ),
    ).toMatchObject({
      ok: true,
      prepared: {
        warnings: expect.arrayContaining([
          expect.stringContaining("outside this Profile's qualified scope"),
        ]),
      },
    });
  });

  it("prepares qualified TRAN and keeps an oversized estimate advisory", async () => {
    const project = CircuitProjectSchema.parse(
      currentFiveTransistorOtaCircuitSource(),
    );
    const folder = nativeOtaFolder(
      project,
      "analysis transient tran step=1n stop=1m",
    );
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
            kind: "project-folder",
            folderId: folder.id,
            expectedStructureRevision: project.structureRevision,
          },
        },
        "tran",
      ),
      "prepared",
    );
    expect(prepared.mode).toBe("source");
    expect(prepared.warnings).toEqual([
      expect.stringContaining('dc is used only with type="dc"'),
      expect.stringContaining("run remains allowed"),
    ]);
    expect(f.executor.execute).not.toHaveBeenCalled();
  });
});
