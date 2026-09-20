import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { AgentSessionClient, AgentSessionError } from "@icm/agent-client";
import {
  AgentSimulationResourceResponseSchema,
  type AgentSimulationResourceRequest,
} from "@icm/agent-adapter";
import { createEmptyProject } from "@icm/model";
import {
  SimulationFiles,
  assembleNativeExecutionOutput,
  type ExecutionInput,
} from "@icm/simulation-service";

import { BrowserAgentSimulationHost } from "../../editor/src/agent/browser-agent-simulation-host.js";
import { FakeAgentHttp } from "../../../packages/agent-client/src/test-support/fake-relay.js";
import { routeSimulationRequest } from "../../../worker/simulation.js";
import {
  nativeWorkerEnv,
  nativeEnvironment,
} from "../../../worker/simulation.test-fixture.js";
import { callTool } from "./tools.js";

const source = readFileSync(
  new URL("../../../netlists/vacask-divider/divider.sim", import.meta.url),
  "utf8",
).replace(/  sweep supply[\s\S]*?endc/u, "endc");
const rawfile = readFileSync(
  new URL("../../../netlists/vacask-divider/divider_op.raw", import.meta.url),
  "utf8",
);
// Captured native numeric evidence through the real assembler; process execution
// is mocked here. Live native execution is covered by the public-source journey.
async function nativeNumericReply(input: ExecutionInput) {
  const output = await assembleNativeExecutionOutput(
    input,
    {
      execution: {
        stdout: "Running analysis 'divider_op'.\n  Elapsed time: 0.001\n",
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
        cancelled: false,
        spawnError: null,
        durationMs: 1,
      },
      timeoutMs: 1000,
      rawfiles: [{ path: "divider_op.raw", text: rawfile }],
      executedFiles: input.files,
      diagnostics: [],
      truncated: false,
    },
    nativeEnvironment,
  );
  return Response.json({
    ...output.result,
    rawfiles: output.rawfiles,
    executedFiles: output.executedFiles,
    cancelled: output.cancelled,
  });
}
describe("MCP / browser Simulation Resource parity", () => {
  it("remembers custom bases per Project, never presents the last Project as the current one, and permits offline inspection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "icm-workspace-scope-"));
    const client = new AgentSessionClient({ http: new FakeAgentHttp() });
    await client.connect("session-1.code");
    const initial = await client.status();
    let projectId: string | null = "project-a";
    vi.spyOn(client, "status").mockImplementation(async () => ({
      ...initial,
      projectId,
      sessionId: projectId ? "new-session" : null,
    }));
    const state = { client };
    const invoke = async (basePath?: string) => {
      const reply = await callTool(
        "simulation_files",
        { request: { action: "workspace" }, ...(basePath ? { basePath } : {}) },
        state,
      );
      return JSON.parse(reply.content[0]!.text!);
    };
    try {
      const a = join(directory, "a");
      const b = join(directory, "b");
      expect(await invoke(a)).toMatchObject({
        basePath: a,
        projectId: "project-a",
      });
      projectId = "project-b";
      expect(await invoke(b)).toMatchObject({
        basePath: b,
        projectId: "project-b",
      });
      projectId = "project-a";
      expect(await invoke()).toMatchObject({
        basePath: a,
        projectId: "project-a",
      });
      const wrong = await invoke(b);
      expect(JSON.stringify(wrong)).toContain("WORKSPACE_PROJECT_MISMATCH");
      projectId = null;
      expect(await invoke()).toMatchObject({
        basePath: a,
        projectId: "project-a",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("returns the generated start identity after a lost response so the same session can retry safely", async () => {
    const http = new FakeAgentHttp();
    const client = new AgentSessionClient({ http });
    await client.connect("session-1.code");
    const send = vi
      .spyOn(client, "simulationResource")
      .mockRejectedValue(
        new AgentSessionError("NETWORK_FAILURE", "Response lost", "network"),
      );
    const request = {
      operation: "start",
      preparedId: "prepared",
      digest: "a".repeat(64),
    };
    const first = JSON.parse(
      (await callTool("simulation", { request }, { client })).content[0]!.text!,
    );
    expect(first).toMatchObject({
      ok: false,
      error: { recovery: "retry-same-request" },
    });
    expect(first.requestId).toBeTruthy();
    await callTool(
      "simulation",
      { request, requestId: first.requestId },
      { client },
    );
    expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
    expect(http.claims).toHaveLength(1);
  });
  it("prepares and runs saved folders as ordinary sequential runs", async () => {
    const files = new SimulationFiles();
    const project = createEmptyProject("batch-project", "Batch", "doc");
    project.simulationFolders = ["TT", "FF"].map((name) => ({
      id: `folder-${name.toLowerCase()}`,
      name,
      version: 4 as const,
      input: {
        kind: "source" as const,
        entry: "main.sim",
        configPath: "experiment.json",
        circuitBindings: [],
        files: [
          {
            path: "experiment.json",
            text: JSON.stringify({
              version: 2,
              environment: { profileId: nativeEnvironment.profileId },
            }),
          },
          {
            path: "main.sim",
            text: source,
          },
        ],
        dependencies: [],
      },
    }));
    let executions = 0;
    let active = 0;
    let maxActive = 0;
    const host = new BrowserAgentSimulationHost({
      getProjectSessionId: () => "batch-project:1",
      getProject: () => project,
      files,
      fetch: async (url, init) =>
        (await routeSimulationRequest(
          new Request(new URL(String(url), "http://localhost"), init),
          nativeWorkerEnv(async (_url, init) => {
            executions++;
            active++;
            maxActive = Math.max(maxActive, active);
            try {
              return await nativeNumericReply(JSON.parse(String(init?.body)));
            } finally {
              active--;
            }
          }),
        ))!,
    });
    class Relay extends FakeAgentHttp {
      override async simulation(
        _session: string,
        _token: string,
        request: AgentSimulationResourceRequest,
      ) {
        return AgentSimulationResourceResponseSchema.parse(
          await host.handle(request),
        );
      }
    }
    const client = new AgentSessionClient({ http: new Relay() });
    await client.connect("session-1.code");
    const invoke = async (request: unknown, requestId?: string) =>
      JSON.parse(
        (
          await callTool(
            "simulation",
            { request, ...(requestId ? { requestId } : {}) },
            { client },
          )
        ).content[0]!.text!,
      );
    try {
      const prepared = await invoke({
        operation: "prepare-batch",
        expectedStructureRevision: project.structureRevision,
        items: [
          { id: "tt", folderId: "folder-tt" },
          { id: "ff", folderId: "folder-ff" },
        ],
      });
      expect(executions).toBe(0);
      const started = await invoke(
        { operation: "start-batch", batchId: prepared.batch.id },
        "batch-start-once",
      );
      expect(started.batch.state).toBe("running");
      let finished: any;
      await vi.waitFor(async () => {
        finished = await invoke({
          operation: "read-batch",
          batchId: prepared.batch.id,
        });
        expect(finished.batch.state, JSON.stringify(finished)).toBe("finished");
      });
      expect(finished.batch.items).toEqual([
        expect.objectContaining({
          state: "finished",
          runId: expect.any(String),
        }),
        expect.objectContaining({
          state: "finished",
          runId: expect.any(String),
        }),
      ]);
      expect(executions).toBe(2);
      expect(maxActive).toBe(1);
    } finally {
      await host.clear();
    }
  });
  it("authors a raw workspace, recovers an input error, runs, reads numbers and exports verified CSV using the same session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "icm-agent-simulation-"));
    const files = new SimulationFiles(),
      project = createEmptyProject("p", "test", "doc");
    let executions = 0;
    const host = new BrowserAgentSimulationHost({
      getProjectSessionId: () => "p:1",
      getProject: () => project,
      files,
      fetch: async (url, init) => {
        const response = await routeSimulationRequest(
          new Request(new URL(String(url), "http://localhost"), init),
          nativeWorkerEnv(async (_url, init) => {
            executions++;
            return nativeNumericReply(JSON.parse(String(init?.body)));
          }),
        );
        return response!;
      },
    });
    const transfers = new Map<string, string>();
    files.setArtifactPublisher(async (ref, text) => {
      const path = `/api/agent/sessions/session-1/artifacts/${ref.fileId ?? ref.id}`;
      transfers.set(path, text);
      return path;
    });
    class Relay extends FakeAgentHttp {
      override async downloadArtifact(
        _session: string,
        _token: string,
        path: string,
      ) {
        return new Response(transfers.get(path) ?? null);
      }
      override async simulation(
        _session: string,
        _token: string,
        request: AgentSimulationResourceRequest,
      ) {
        return AgentSimulationResourceResponseSchema.parse(
          await host.handle(request),
        );
      }
    }
    const http = new Relay({
      files: async (request) =>
        request.operation === "simulation-input"
          ? {
              apiVersion: "3.0",
              requestId: request.requestId,
              operation: "simulation-input",
              ok: true,
              result: await files.handle(request.input),
            }
          : {
              apiVersion: "3.0",
              requestId: request.requestId,
              operation: "error",
              ok: false,
              error: { code: "test", message: "test" },
            },
    });
    const client = new AgentSessionClient({ http });
    await client.connect("session-1.code");
    const toolState = { client };
    const invoke = async (name: string, args: unknown) => {
      const reply = await callTool(name, args, toolState);
      return JSON.parse(reply.content[0]!.text!);
    };
    try {
      const help = await invoke("simulation", {
        request: { operation: "authoring-help", name: "embed" },
      });
      expect(help.ok).toBe(true);
      expect(help.helpers[0].source).toContain("def report_measurement(");
      expect(help.helpers[0].source).toContain("def report_plot(");
      expect(executions).toBe(0);
      const bad = await invoke("simulation", {
        request: {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: "folder-1",
            expectedStructureRevision: project.structureRevision,
          },
        },
      });
      expect(bad).toMatchObject({
        ok: false,
        error: { code: "SIMULATION_FOLDER_MISSING" },
      });
      const created = await invoke("simulation_files", {
        request: { action: "create" },
      });
      const workspaceId = created.workspace.id;
      await invoke("simulation_files", {
        request: {
          action: "update",
          owner: { kind: "session-workspace", workspaceId },
          expectedRevision: 0,
          entry: "main.sim",
          writes: [
            {
              path: "experiment.json",
              text: JSON.stringify({
                version: 2,
                environment: { profileId: nativeEnvironment.profileId },
              }),
            },
            {
              path: "main.sim",
              text: source,
            },
          ],
        },
      });
      const prepared = await invoke("simulation", {
        request: {
          operation: "prepare",
          source: {
            kind: "workspace",
            workspaceId,
            expectedRevision: 1,
          },
        },
      });
      expect(executions).toBe(0);
      const args = {
        request: {
          operation: "start",
          preparedId: prepared.prepared.id,
          digest: prepared.prepared.digest,
        },
        requestId: "start-once",
      };
      const started = await invoke("simulation", args);
      expect(started.run.id).toBeDefined();
      expect((await invoke("simulation", args)).run.id).toBe(started.run.id);
      let finished: any;
      await vi.waitFor(async () => {
        finished = await invoke("simulation", {
          request: { operation: "read", runId: started.run.id },
        });
        expect(finished.run.state).toBe("finished");
      });
      expect(executions).toBe(1);
      await vi.waitFor(async () =>
        expect(
          await invoke("simulation", {
            request: { operation: "history" },
          }),
        ).toMatchObject({
          ok: true,
          runs: [{ runId: started.run.id }],
          nextCursor: null,
        }),
      );
      expect(finished.run.state, JSON.stringify(finished)).toBe("finished");
      expect(finished.run.result.data.analyses[0].probes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "output", value: 2 }),
        ]),
      );
      const csv = finished.run.artifacts.find(
        (a: { name: string }) => a.name === "op-0.csv",
      );
      const path = join(directory, "result.csv");
      expect(
        await invoke("simulation_files", {
          request: { action: "artifact", artifactId: csv.id },
          outputPath: path,
        }),
      ).toMatchObject({ ok: true });
      // This captured raw record declares "notype" and the textual fixture has
      // no typed acquisition. Preserve an unknown unit rather than invent one.
      expect((await readFile(path, "utf8")).split("\n")).toContain("output,2,");
      const download = vi.spyOn(http, "downloadArtifact");
      const basePath = join(directory, "workspace");
      const synced = await invoke("simulation_files", {
        request: { action: "sync", runId: started.run.id },
        basePath,
      });
      expect(synced).toMatchObject({
        ok: true,
        basePath,
        downloadedFiles: finished.run.artifacts.length,
      });
      expect(synced.files).toHaveLength(finished.run.artifacts.length);
      expect(
        await invoke("simulation_files", { request: { action: "workspace" } }),
      ).toMatchObject({ ok: true, basePath });
      download.mockClear();
      const reused = await invoke("simulation_files", {
        request: { action: "sync", runId: started.run.id },
      });
      expect(reused.ok, JSON.stringify(reused.error)).toBe(true);
      expect(
        reused.files.every((file: { reused: boolean }) => file.reused),
      ).toBe(true);
      expect(download).not.toHaveBeenCalled();
      const localIndex = JSON.parse(await readFile(synced.indexPath, "utf8"));
      expect(localIndex.runs[0].runId).toBe(started.run.id);
      expect(http.claims).toHaveLength(1);
    } finally {
      await host.clear();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
