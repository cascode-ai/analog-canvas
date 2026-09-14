import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyProject,
  createSimulationFolder,
  CircuitProjectSchema,
} from "../../packages/model/src/index.js";
import { SimulationService } from "../../packages/simulation-service/src/service.js";
import { SimulationFiles } from "../../packages/simulation-service/src/files.js";
import { CapabilitiesSchema } from "../../packages/simulation-service/src/contract.js";
import { inspectNativeAnalyses } from "../../packages/simulation-service/src/native-source-analysis.js";
import {
  readVacaskSimulationData,
  createSimulationEnvironmentMetadata,
} from "../../packages/spice-run/src/index.js";
import { routeSimulationRequest } from "../../worker/simulation.js";
import {
  routeManagedSimulationRequest,
  consumeSimulationJobs,
} from "../../worker/simulation-operations.js";
import { createSimulationOperationsHarness } from "../../worker/simulation-operations.test-fixture.js";
import { createManagedHostedExecutor } from "../../packages/simulation-service/src/managed-hosted-executor.js";
import { collectVacaskRawfiles } from "./rawfile-collector.mjs";
import { createVacaskHttpServer } from "./http-server.mjs";
import { createHostedExecutor } from "../../packages/simulation-service/src/hosted-executor.js";
import { initializeVacaskRuntime } from "./runtime.mjs";
import { SimulationRunSupervisor } from "../ngspice/run-supervisor.mjs";
import { createSimulationStarter } from "../../packages/netlist/src/simulation-starter.js";
import { compileSourceSimulation } from "../../packages/netlist/src/simulation-source-compile.js";
import { nativeVoltageAcquisition } from "../../packages/netlist/src/simulation-native-voltage.js";
import { nativeAcquisitionEdit } from "../../packages/netlist/src/simulation-native-save-edit.js";
import { nativeSourceAcquisitions } from "../../packages/netlist/src/simulation-native-source-signals.js";
import {
  startLocalHost,
  createLocalSimulationHandler,
} from "../../apps/local-host/src/index.js";

const roots = [];
const servers = [];
const closers = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
  for (const close of closers.splice(0)) close();
});
const caps = CapabilitiesSchema.parse({
  configured: true,
  rawfileCollection: "native-multi-ascii",
  maxInputFiles: 24,
  inputs: ["source"],
  analyses: ["op", "dc", "ac", "tran", "noise"],
  parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
  profiles: [{ id: "local-proof", corners: [] }],
  maxTimeoutMs: 15_000,
  maxInputBytes: 1_048_576,
  maxOutputBytes: 1_048_576,
  cancel: false,
});
function fixture() {
  const project = createEmptyProject(
    "native-project",
    "Public native proof",
    "dut",
  );
  const document = project.documents[0];
  document.netlist.name = "DUT";
  document.instances.push(
    { id: "P", symbolId: "port", placement: null },
    { id: "N", symbolId: "port", placement: null },
    {
      id: "R",
      symbolId: "resistor",
      reference: "R1",
      placement: null,
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    },
  );
  for (const [name, pin] of [
    ["P", "1"],
    ["N", "2"],
  ]) {
    document.nets.push({
      id: `net-${name}`,
      terminals: [
        { instanceId: name, pinName: "P" },
        { instanceId: "R", pinName: pin },
      ],
    });
    document.netlist.terminals.push({
      id: name,
      name,
      netId: `net-${name}`,
      direction: "passive",
      interfaceInstanceIds: [name],
    });
  }
  const folder = createSimulationFolder({
    id: "experiment",
    name: "Native",
    profileId: "local-proof",
  });
  folder.input.entry = "run.sim";
  folder.input.circuitBindings = [
    {
      id: "binding",
      documentId: "dut",
      emission: "subcircuit",
      path: "DUT.inc",
    },
  ];
  folder.input.files = [
    {
      path: "experiment.json",
      text: JSON.stringify({
        version: 2,
        environment: { profileId: "local-proof" },
      }),
    },
    {
      path: "run.sim",
      text: `Public native service proof
include "DUT.inc"
load "capacitor.osdi"
model voltage vsource
model load resistor
model cap capacitor
V1 (Input 0) voltage dc=1 mag=1
XD (Input Out) DUT
RL (Out 0) load r=1k
C (Out 0) cap c=1u
control
abort always
options rawfile="ascii" strictsave=2
save default
analysis bias op
sweep supply instance="V1" parameter="dc" from=0 to=2 step=1
analysis sweep op
analysis frequency ac from=10 to=1k mode="dec" points=2 writeop=1
analysis time tran stop=1m step=0.1m
analysis noise noise out="Out" in="V1" from=10 to=1k mode="dec" points=2
endc
`,
    },
  ];
  project.simulationFolders.push(folder);
  return CircuitProjectSchema.parse(project);
}
function requireReply(reply, key) {
  if (!reply.ok || !(key in reply)) throw Error(JSON.stringify(reply));
  return reply[key];
}

describe("native public compilation and result service", () => {
  it
    .skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)
    .each(["op", "ac", "tran"])(
    "runs the actual %s DUT starter with user sources/loads and shared Canvas acquisition helpers",
    async (template) => {
      const project = fixture();
      const before = structuredClone(project);
      const started = createSimulationStarter(project, {
        id: "starter",
        name: "Native starter",
        profileId: "local-proof",
        documentId: "dut",
        mode: "dut",
        template,
      });
      if (!started.ok) throw Error(started.message);
      const folder = started.folder;
      // This is the user's TB editing step. The generated DUT, entry, control
      // template and interface call remain exactly as the product created them.
      folder.input.files.find((f) => f.path === "testbench.spice").text += `
model voltage vsource
model load resistor
V1 (P 0) voltage dc=1 mag=1
RL (N 0) load r=1k
`;
      const selection = nativeVoltageAcquisition(project, folder.input, {
        kind: "voltage",
        documentId: "dut",
        occurrence: [],
        anchor: { kind: "base-net", netId: "net-N" },
        circuit: { bindingId: "circuit", callPath: ["XDUT"] },
      });
      expect(selection).toEqual({ ok: true, vector: "N", save: "v(N)" });
      const branch = nativeSourceAcquisitions(folder.input).find(
        (s) => s.vector === "V1:flow(br)",
      );
      expect(branch).toEqual({
        quantity: "current",
        vector: "V1:flow(br)",
        save: "i(V1)",
      });
      const entry = folder.input.files.find(
        (f) => f.path === folder.input.entry,
      );
      const savedSelection = nativeAcquisitionEdit(
        entry.text,
        entry.text.indexOf("save default") + "save default".length,
        [selection.save, branch.save],
        true,
      );
      expect(savedSelection.ok).toBe(true);
      expect(savedSelection.text).toBe(
        entry.text.replace("save default", "save default v(N) i(V1)"),
      );
      entry.text = savedSelection.text;
      const saved = structuredClone(folder);
      const compiled = compileSourceSimulation(project, folder);
      if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
      const cwd = await mkdtemp(join(tmpdir(), "icm-native-starter-"));
      roots.push(cwd);
      for (const file of compiled.files) {
        await mkdir(dirname(join(cwd, file.path)), { recursive: true });
        await writeFile(join(cwd, file.path), file.text);
      }
      const startup = join(cwd, "startup.toml");
      await writeFile(startup, "# controlled native starter proof\n");
      const run = spawnSync(
        resolve(process.env.VACASK_BIN),
        ["--tomlfile", startup, "-n", "1", "-b", "1", compiled.entry],
        {
          cwd,
          encoding: "utf8",
          windowsHide: true,
          timeout: 15_000,
          env: {
            ...process.env,
            SIM_MODULE_PATH: resolve(process.env.VACASK_MODULES),
          },
        },
      );
      expect(run.error).toBeUndefined();
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
      const collected = await collectVacaskRawfiles(cwd, {
        inputPaths: compiled.files.map((f) => f.path),
        maxBytes: 1_048_576,
        maxFiles: 8,
        maxEntries: 32,
      });
      expect(collected.truncated).toBe(false);
      const analysis = inspectNativeAnalyses({
        ...folder.input,
        files: compiled.files,
        circuitBindings: [],
      });
      const data = readVacaskSimulationData(
        collected.rawfiles,
        analysis.projections,
      );
      expect(data.status, JSON.stringify(data)).toBe("read");
      if (data.status !== "read") return;
      // Check raw numerical evidence as well as template syntax. All three
      // analyses of this purely resistive divider must produce N=0.5.
      const plot = data.data.analyses.find((p) => p.analysis === template);
      expect(plot, JSON.stringify(data)).toBeDefined();
      const probe = plot.probes.find((p) => p.name === "N");
      expect(probe).toBeDefined();
      const current = plot.probes.find((p) => p.name === branch.vector);
      expect(current).toBeDefined();
      if (template === "op") expect(current.value).toBeCloseTo(-0.0005, 12);
      else {
        const values = template === "ac" ? current.real : current.value;
        expect(values.length).toBeGreaterThan(1);
        for (const value of values) expect(value).toBeCloseTo(-0.0005, 12);
        if (template === "ac")
          for (const value of current.imag) expect(value).toBeCloseTo(0, 12);
      }
      if (template === "op") expect(probe.value).toBeCloseTo(0.5, 10);
      else {
        const values = template === "ac" ? probe.real : probe.value;
        expect(values.length).toBeGreaterThan(1);
        for (const value of values) expect(value).toBeCloseTo(0.5, 10);
        if (template === "ac")
          for (const value of probe.imag) expect(value).toBeCloseTo(0, 10);
      }
      expect(folder).toEqual(saved);
      expect(project).toEqual(before);
    },
  );

  it("prepares native source and Canvas signal addresses without executing or changing the Project", async () => {
    const project = fixture();
    const before = structuredClone(project);
    const execute = vi.fn();
    const service = new SimulationService(
      new SimulationFiles(),
      { capabilities: async () => caps, execute, cancel: vi.fn() },
      () => project,
    );
    const prepared = requireReply(
      await service.handle(
        {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: "experiment",
            expectedStructureRevision: project.structureRevision,
          },
        },
        "prepare",
      ),
      "prepared",
    );
    expect(prepared.signalNames).toEqual({ Input: "XD/P", Out: "XD/N" });
    expect(prepared.signalTargets.Out).toEqual([
      {
        rootDocumentId: "dut",
        documentId: "dut",
        netId: "net-N",
        occurrence: [],
      },
    ]);
    expect(execute).not.toHaveBeenCalled();
    expect(project).toEqual(before);
  });

  it
    .skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)
    .each(["local-host", "worker", "managed"])(
    "runs public Prepare/Start through %s and the native HTTP process, then exports the mapped result",
    async (transport) => {
      const project = fixture();
      const before = structuredClone(project);
      const files = new SimulationFiles();
      const binary = resolve(process.env.VACASK_BIN);
      const modules = resolve(process.env.VACASK_MODULES);
      let submitted;
      const supervisor = new SimulationRunSupervisor();
      const root = await mkdtemp(join(tmpdir(), "icm-native-public-"));
      roots.push(root);
      const startup = "# public native journey controlled configuration\n";
      const startupPath = join(root, "vacaskrc.toml");
      await writeFile(startupPath, startup);
      const configuration = {
        executor: "local-host",
        profileId: "local-proof",
        binary,
        modules,
        startupPath,
        runRoot: root,
      };
      let runtime = await initializeVacaskRuntime(configuration);
      if (transport !== "local-host") {
        // A test-only lock from measured local assets exercises hosted identity
        // verification; it is not a deployment/model qualification or a fake
        // simulator result. Reinitialize to independently check those bytes.
        const expectedEnvironment = await createSimulationEnvironmentMetadata({
          ...runtime.environment,
          executor: "hosted-container",
          reproducibility: "pinned",
        });
        runtime = await initializeVacaskRuntime({
          ...configuration,
          executor: "hosted-container",
          expectedEnvironment,
        });
      }
      const server = createVacaskHttpServer({
        runtimeReady: runtime,
        capabilities: caps,
        supervisor,
        limits: {
          maxInputBytes: caps.maxInputBytes,
          maxInputFiles: caps.maxInputFiles,
          maxOutputBytes: caps.maxOutputBytes,
          maxLogBytes: 65536,
          maxRawFiles: 64,
          maxEntries: 4096,
        },
      });
      servers.push(server);
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      await vi.waitFor(async () =>
        expect((await fetch(`${base}/health`)).status).toBe(200),
      );
      const editorRoot = await mkdtemp(
        join(tmpdir(), "icm-native-local-editor-"),
      );
      roots.push(editorRoot);
      await writeFile(
        join(editorRoot, "index.html"),
        "<title>Local editor transport proof</title>",
      );
      const workerEnvironment = {
        SIMULATION_PROFILE_ID: "local-proof",
        VACASK: {
          getByName: () => ({
            fetch: (url, init) =>
              fetch(new URL(new URL(url).pathname, base), init),
          }),
        },
      };
      const local = await startLocalHost({
        editorRoot,
        simulationHandler:
          transport === "worker"
            ? (request) => routeSimulationRequest(request, workerEnvironment)
            : createLocalSimulationHandler(base),
      });
      servers.push(local.server);
      // Real shared client + local Editor host + HTTP + process + numeric adapter; capabilities are
      // declared for this local proof, not a registered cloud qualification.
      let executor = createHostedExecutor((path, options) => {
        const body = JSON.parse(options.body);
        if (body.operation === undefined) submitted = body;
        return fetch(new URL(path, local.origin), options);
      });
      let managed;
      const deliveries = [];
      const dispatches = [];
      if (transport === "managed") {
        managed = createSimulationOperationsHarness();
        closers.push(managed.close);
        Object.assign(managed.env, workerEnvironment);
        const runner = workerEnvironment.VACASK.getByName();
        managed.env.VACASK = {
          getByName: () => ({
            fetch: (url, init) => {
              if (new URL(url).pathname === "/run")
                dispatches.push(JSON.parse(init.body));
              return runner.fetch(url, init);
            },
          }),
        };
        executor = createManagedHostedExecutor({
          fetch: async (path, options) => {
            if (options?.body) {
              const body = JSON.parse(options.body);
              if (body.input) submitted = body.input;
            }
            const request = new Request(
              new URL(path, "https://managed.test"),
              options,
            );
            return (
              (await routeManagedSimulationRequest(
                request,
                managed.env,
                managed.runtime,
              )) ?? (await routeSimulationRequest(request, managed.env))
            );
          },
          // Deliver only after the real adapter has observed a queued record.
          // SQLite/control and queue consumer are real; queue/R2 hosting is not.
          sleep: async () => {
            const body = managed.jobs.shift();
            if (!body) throw new Error("No queued native job");
            const message = { body, ack: vi.fn(), retry: vi.fn() };
            deliveries.push(message);
            await consumeSimulationJobs(
              { messages: [message] },
              managed.env,
              managed.runtime,
            );
          },
        });
      }
      executor.execute = vi.fn(executor.execute);
      const service = new SimulationService(files, executor, () => project);
      const prepared = requireReply(
        await service.handle(
          {
            operation: "prepare",
            source: {
              kind: "project-folder",
              folderId: "experiment",
              expectedStructureRevision: project.structureRevision,
            },
          },
          "prepare",
        ),
        "prepared",
      );
      const operation = {
        operation: "start",
        preparedId: prepared.id,
        digest: prepared.digest,
      };
      const started = requireReply(
        await service.handle(operation, "start"),
        "run",
      );
      await vi.waitFor(async () => {
        const read = requireReply(
          await service.handle(
            { operation: "read", runId: started.id },
            "read",
          ),
          "run",
        );
        expect(read.error, JSON.stringify(read.error)).toBeUndefined();
        expect(read.state).toBe("finished");
      });
      const finished = requireReply(
        await service.handle({ operation: "read", runId: started.id }, "read"),
        "run",
      );
      expect(finished.inputStatus).toBe("unchanged");
      expect(finished.result.outcome.status).toBe("completed");
      expect(submitted.language).toBe("vacask");
      expect(submitted.collection).toEqual({ kind: "native-multi-ascii" });
      expect(await readdir(root)).toEqual(["vacaskrc.toml"]);
      const op = finished.result.data.analyses.find((a) => a.analysis === "op");
      expect(op.probes.find((p) => p.name === "Out").value).toBeCloseTo(
        0.5,
        10,
      );
      const dc = finished.result.data.analyses.find((a) => a.analysis === "dc");
      expect(dc.sweep.values).toEqual([0, 1, 2]);
      expect(dc.probes.find((p) => p.name === "Out").value).toEqual([
        0, 0.5, 1,
      ]);
      expect(
        new Set(finished.result.data.analyses.map((a) => a.analysis)),
      ).toEqual(new Set(caps.analyses));
      expect(finished.artifacts.map((a) => a.name)).toContain(
        "executed/DUT.inc",
      );
      expect(finished.artifacts.map((a) => a.name)).toContain(
        "raw/frequency.op.raw",
      );
      expect(submitted.files.find((f) => f.path === "DUT.inc").text).toContain(
        "subckt DUT",
      );
      expect(
        requireReply(await service.handle(operation, "start"), "run").id,
      ).toBe(started.id);
      expect(executor.execute).toHaveBeenCalledTimes(1);
      expect(project).toEqual(before);
      if (managed) {
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0].ack).toHaveBeenCalledOnce();
        expect(deliveries[0].retry).not.toHaveBeenCalled();
        expect(dispatches).toHaveLength(1);
        // Duplicate queue delivery cannot execute the completed job twice.
        await consumeSimulationJobs(
          { messages: [deliveries[0]] },
          managed.env,
          managed.runtime,
        );
        expect(dispatches).toHaveLength(1);
        const resultUrl = `https://managed.test/api/simulation/runs/${deliveries[0].body.runId}/result`;
        const otherOwner = {
          ...managed.runtime,
          principalOf: async () => ({
            ...(await managed.runtime.principalOf()),
            id: "other-owner",
          }),
        };
        expect(
          (
            await routeManagedSimulationRequest(
              new Request(resultUrl),
              managed.env,
              otherOwner,
            )
          ).status,
        ).toBe(404);
        const stored = await routeManagedSimulationRequest(
          new Request(resultUrl),
          managed.env,
          managed.runtime,
        );
        expect((await stored.json()).rawfiles).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: "frequency.op.raw" }),
          ]),
        );
      }
    },
  );
});
