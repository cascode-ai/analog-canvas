import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSimulationResourceResponse } from "@icm/agent-adapter";
import { waitForSimulation } from "../../../mcp-server/src/simulation-wait";
import { callTool } from "../../../mcp-server/src/tools";
import {
  emptyAgentProject,
  liveAgentEditor,
} from "./live-agent-editor.test-support";
import {
  HostedSimulationService,
  dividerFolder,
} from "./live-simulation.test-support";

type LiveEditor = ReturnType<typeof liveAgentEditor>;

const editors: LiveEditor[] = [];

afterEach(async () => {
  await Promise.all(
    editors.splice(0).map((editor) => editor.simulationHost?.clear()),
  );
});

/** The live editor with one saved divider folder, connected. */
async function connected(service: HostedSimulationService) {
  const project = emptyAgentProject();
  project.simulationFolders = [dividerFolder("folder", "OP")];
  const editor = liveAgentEditor({ project, simulationService: service.fetch });
  editors.push(editor);
  await editor.client.connect("session-1.code");
  return editor;
}

/** A run of the saved folder, as the Agent submits it. */
function folderRun(editor: LiveEditor) {
  return {
    operation: "run" as const,
    source: {
      kind: "project-folder" as const,
      folderId: "folder",
      expectedStructureRevision: editor.controller.project.structureRevision,
    },
  };
}

/** The editor's receipt for a run it accepted while the service still runs it. */
async function acceptedRun(editor: LiveEditor) {
  const response = await editor.client.simulationResource({
    apiVersion: "3.0",
    requestId: crypto.randomUUID(),
    ...folderRun(editor),
  });
  if (!response.ok || !("run" in response))
    throw new Error(JSON.stringify(response));
  expect(response.run.state).toBe("running");
  return { response, runId: response.run.id };
}

describe("bounded simulation waiting on the live editor", () => {
  it("returns a fast completed run with one Agent request to the editor", async () => {
    const service = new HostedSimulationService();
    const editor = await connected(service);
    const result = await callTool(
      "simulation_run",
      { requestId: "one-run", waitMs: 20_000, request: folderRun(editor) },
      { client: editor.client },
    );
    expect(JSON.parse(result.content[0]!.text!)).toMatchObject({
      ok: true,
      run: { state: "finished" },
    });
    expect(editor.http.simulationCalls).toEqual([
      expect.objectContaining({
        operation: "run",
        waitMs: 20_000,
        requestId: "one-run",
      }),
    ]);
    expect(service.executions).toBe(1);
  });

  it("waits for one run in a single bounded read the editor holds", async () => {
    const service = new HostedSimulationService();
    const editor = await connected(service);
    service.hold();
    const { response, runId } = await acceptedRun(editor);
    const sent = editor.http.simulationCalls.length;
    const waited = waitForSimulation(editor.client, response, 5000);
    // The service finishes the run while the editor holds the read.
    await vi.waitFor(() =>
      expect(editor.http.simulationCalls).toHaveLength(sent + 1),
    );
    service.release();
    expect(await waited).toMatchObject({
      ok: true,
      run: { id: runId, state: "finished" },
    });
    expect(editor.http.simulationCalls.slice(sent)).toEqual([
      expect.objectContaining({ operation: "read", runId, waitMs: 5000 }),
    ]);
  });

  it("returns the editor's bounded read receipt and never reads or reexecutes a lost run", async () => {
    const service = new HostedSimulationService();
    const editor = await connected(service);
    service.hold();
    const { response, runId } = await acceptedRun(editor);
    const sent = editor.http.simulationCalls.length;
    // The editor holds the read for its bound, then answers: still running.
    expect(await waitForSimulation(editor.client, response, 50)).toMatchObject({
      ok: true,
      run: { id: runId, state: "running" },
    });
    expect(editor.http.simulationCalls.slice(sent)).toEqual([
      expect.objectContaining({ operation: "read", runId, waitMs: 50 }),
    ]);
    // The service's reply never reaches the editor, which reports the run lost.
    service.loseReplies();
    service.release();
    let lost: AgentSimulationResourceResponse | undefined;
    await vi.waitFor(async () => {
      lost = await editor.client.simulationResource({
        apiVersion: "3.0",
        requestId: crypto.randomUUID(),
        operation: "read",
        runId,
      });
      expect(lost).toMatchObject({
        ok: true,
        run: { state: "lost", error: { code: "RUN_RESPONSE_UNKNOWN" } },
      });
    });
    const reads = editor.http.simulationCalls.length;
    expect(await waitForSimulation(editor.client, lost!, 1000)).toBe(lost);
    expect(editor.http.simulationCalls).toHaveLength(reads);
    expect(service.executions).toBe(1);
  });
});
