import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { networkFailure } from "../../../../packages/agent-client/src/errors";
import { FOCUSED_TOOLS } from "../../../mcp-server/src/focused-tools";
import { runHttpCommand } from "../../../mcp-server/src/http-cli";
import {
  callTool as dispatchTool,
  type ToolSessionState,
} from "../../../mcp-server/src/tools";
import { EditorDocumentController } from "../document/document-controller";
import {
  emptyAgentProject,
  liveAgentEditor,
} from "./live-agent-editor.test-support";
import {
  HostedSimulationService,
  dividerFiles,
  dividerFolder,
  liveEditorWithRelay,
  openTabs,
  type OpenTab,
} from "./live-simulation.test-support";

const directories: string[] = [];
const editors: { simulationHost: { clear(): Promise<void> } | null }[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(
    editors.splice(0).map((item) => item.simulationHost?.clear()),
  );
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function tempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "analog-simulation-tools-"));
  directories.push(path);
  return path;
}

describe.each(["compatibility", "focused", "cli"] as const)(
  "MCP simulation tools on the live editor (%s)",
  (surface) => {
    /** One tool call on this surface: the canonical tool, its focused tool, or the CLI. */
    function callTool(name: string, args: unknown, session: ToolSessionState) {
      if (surface === "cli")
        return runHttpCommand(
          { toolSession: session },
          name,
          JSON.stringify(args),
        ) as ReturnType<typeof dispatchTool>;
      const request = (
        args as { request?: { action?: string; operation?: string } }
      ).request;
      const operation = request?.operation ?? request?.action;
      const focused =
        surface === "focused" && operation
          ? FOCUSED_TOOLS.find(
              (tool) =>
                tool.source === name &&
                (tool.operations as readonly string[]).includes(operation),
            )
          : undefined;
      return dispatchTool(focused?.name ?? name, args, session);
    }

    /** The MCP server's tools on one session, each returning its JSON reply. */
    function tools(session: ToolSessionState) {
      return async (name: string, args: unknown) =>
        JSON.parse((await callTool(name, args, session)).content[0]!.text!);
    }

    it("remembers a custom base per open Project, never presents the last Project as the current one, and inspects it offline", async () => {
      const directory = await tempDirectory();
      const tabs: { active: string; open: OpenTab[] } = {
        active: "tab-a",
        open: [],
      };
      const editor = liveAgentEditor({
        project: createEmptyProject("project-a", "Amplifier", "main"),
        projectHost: { workspace: openTabs(tabs) },
      });
      // A second saved Project is open in another tab of the same editor.
      tabs.open = [
        {
          id: "tab-a",
          controller: editor.controller,
          cloudProjectId: "cloud-a",
        },
        {
          id: "tab-b",
          controller: new EditorDocumentController(
            createEmptyProject("project-b", "Bias", "main"),
          ),
          cloudProjectId: "cloud-b",
        },
      ];
      const tool = tools({
        client: editor.client,
        workspaceRoot: join(directory, "locations"),
      });
      const workspace = (basePath?: string) =>
        tool("simulation_files", {
          request: { action: "workspace" },
          ...(basePath ? { basePath } : {}),
        });
      expect(
        await tool("connect", { claimCode: "session-1.code" }),
      ).toMatchObject({ ok: true });
      const a = join(directory, "a");
      const b = join(directory, "b");
      expect(await workspace(a)).toMatchObject({
        basePath: a,
        projectId: "project-a",
      });
      // The person switches tabs between the Agent's calls.
      tabs.active = "tab-b";
      expect(await workspace(b)).toMatchObject({
        basePath: b,
        projectId: "project-b",
      });
      tabs.active = "tab-a";
      expect(await workspace()).toMatchObject({
        basePath: a,
        projectId: "project-a",
      });
      expect(JSON.stringify(await workspace(b))).toContain(
        "WORKSPACE_PROJECT_MISMATCH",
      );
      // Disconnected, the last base still reads without the editor.
      expect(await tool("disconnect", {})).toMatchObject({ ok: true });
      const reads = editor.http.projectCalls.length;
      expect(await workspace()).toMatchObject({
        basePath: a,
        projectId: "project-a",
      });
      expect(editor.http.projectCalls).toHaveLength(reads);
      expect(editor.http.disconnects).toEqual(["session-1"]);
    });

    it("returns the generated start identity after a lost reply, and the retry with it reaches the run the editor already started", async () => {
      const service = new HostedSimulationService();
      const project = emptyAgentProject();
      project.simulationFolders = [dividerFolder("op", "OP")];
      const editor = liveAgentEditor({
        project,
        simulationService: service.fetch,
      });
      editors.push(editor);
      const tool = tools({ client: editor.client });
      await tool("connect", { claimCode: "session-1.code" });
      const prepared = await tool("simulation", {
        request: {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: "op",
            expectedStructureRevision:
              editor.controller.project.structureRevision,
          },
        },
      });
      const request = {
        operation: "start",
        preparedId: prepared.prepared.id,
        digest: prepared.prepared.digest,
      };
      // The relay delivers the start, but the editor's reply is lost on
      // the way back, on the client's own retry as well.
      const relay = editor.http.simulation.bind(editor.http);
      const replyLost: typeof relay = async (...args) => {
        await relay(...args);
        throw networkFailure("Response lost");
      };
      vi.spyOn(editor.http, "simulation")
        .mockImplementationOnce(replyLost)
        .mockImplementationOnce(replyLost);
      const first = await tool("simulation", { request });
      expect(first).toMatchObject({
        ok: false,
        error: { code: "NETWORK_FAILURE", recovery: "retry-same-request" },
      });
      expect(first.requestId).toBeTruthy();
      const retried = await tool("simulation", {
        request,
        requestId: first.requestId,
      });
      expect(retried).toMatchObject({
        ok: true,
        run: { id: expect.any(String) },
      });
      const starts = editor.http.simulationCalls.filter(
        (call) => call.operation === "start",
      );
      expect(starts).toHaveLength(3);
      expect(starts[0]).toMatchObject({ requestId: first.requestId });
      expect(new Set(starts.map((call) => JSON.stringify(call))).size).toBe(1);
      await vi.waitFor(async () =>
        expect(
          await tool("simulation", {
            request: { operation: "read", runId: retried.run.id },
          }),
        ).toMatchObject({ run: { state: "finished" } }),
      );
      // One run for that identity, executed once.
      expect(service.executions).toBe(1);
      expect(editor.http.claims).toHaveLength(1);
    });

    it("prepares and runs saved folders as ordinary sequential runs", async () => {
      const service = new HostedSimulationService();
      const project = emptyAgentProject("Batch");
      project.simulationFolders = [
        dividerFolder("folder-tt", "TT"),
        dividerFolder("folder-ff", "FF"),
      ];
      const editor = liveAgentEditor({
        project,
        simulationService: service.fetch,
      });
      editors.push(editor);
      const tool = tools({ client: editor.client });
      await tool("connect", { claimCode: "session-1.code" });
      const prepared = await tool("simulation", {
        request: {
          operation: "prepare-batch",
          expectedStructureRevision:
            editor.controller.project.structureRevision,
          items: [
            { id: "tt", folderId: "folder-tt" },
            { id: "ff", folderId: "folder-ff" },
          ],
        },
      });
      expect(service.executions).toBe(0);
      expect(prepared.batch.items).toHaveLength(2);
      for (const item of prepared.batch.items) {
        expect(item.prepared.projection).toBe("summary");
        expect(item.prepared.deviceOperatingPoints).toBeUndefined();
        expect(item.prepared.detailsArtifact.name).toBe("preparation.json");
      }
      const started = await tool("simulation", {
        request: { operation: "start-batch", batchId: prepared.batch.id },
        requestId: "batch-start-once",
      });
      expect(started.batch.state).toBe("running");
      let finished: any;
      await vi.waitFor(async () => {
        finished = await tool("simulation", {
          request: { operation: "read-batch", batchId: prepared.batch.id },
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
      expect(service.executions).toBe(2);
      expect(service.maxActive).toBe(1);
    });

    it("authors a raw workspace, recovers an input error, runs, reads numbers and exports verified CSV using the same session", async () => {
      const directory = await tempDirectory();
      const service = new HostedSimulationService();
      const tabs: { active: string; open: OpenTab[] } = {
        active: "tab-1",
        open: [],
      };
      const editor = liveEditorWithRelay({
        simulationService: service.fetch,
        projectHost: { workspace: openTabs(tabs) },
      });
      editors.push(editor);
      tabs.open = [{ id: "tab-1", controller: editor.controller }];
      const { controller, http, relay } = editor;
      const tool = tools({
        client: editor.client,
        workspaceRoot: join(directory, "locations"),
      });
      await tool("connect", { claimCode: "session-1.code" });
      const help = await tool("simulation", {
        request: { operation: "authoring-help", name: "embed" },
      });
      expect(help.ok).toBe(true);
      expect(help.helpers[0].source).toContain("def report_measurement(");
      expect(help.helpers[0].source).toContain("def report_plot(");
      expect(service.executions).toBe(0);
      const bad = await tool("simulation", {
        request: {
          operation: "prepare",
          source: {
            kind: "project-folder",
            folderId: "folder-1",
            expectedStructureRevision: controller.project.structureRevision,
          },
        },
      });
      expect(bad).toMatchObject({
        ok: false,
        error: { code: "SIMULATION_FOLDER_MISSING" },
      });
      const created = await tool("simulation_files", {
        request: { action: "create" },
      });
      const workspaceId = created.workspace.id;
      await tool("simulation_files", {
        request: {
          action: "update",
          owner: { kind: "session-workspace", workspaceId },
          expectedRevision: 0,
          entry: "main.sim",
          writes: dividerFiles(),
        },
      });
      const prepared = await tool("simulation", {
        request: {
          operation: "prepare",
          source: { kind: "workspace", workspaceId, expectedRevision: 1 },
        },
      });
      expect(service.executions).toBe(0);
      expect(prepared.prepared.projection).toBe("summary");
      expect(prepared.prepared.acquisition).toContain("not captured data");
      expect(prepared.prepared.vectors).toBeUndefined();
      expect(prepared.prepared.detailsArtifact.name).toBe("preparation.json");
      const args = {
        request: {
          operation: "start",
          preparedId: prepared.prepared.id,
          digest: prepared.prepared.digest,
        },
        requestId: "start-once",
      };
      const started = await tool("simulation", args);
      expect(started.run.id).toBeDefined();
      expect((await tool("simulation", args)).run.id).toBe(started.run.id);
      let finished: any;
      await vi.waitFor(async () => {
        finished = await tool("simulation", {
          request: { operation: "read", runId: started.run.id },
          detail: "full",
        });
        expect(finished.run.state).toBe("finished");
      });
      expect(service.executions).toBe(1);
      await vi.waitFor(async () =>
        expect(
          await tool("simulation", { request: { operation: "history" } }),
        ).toMatchObject({
          ok: true,
          runs: [{ runId: started.run.id }],
          nextCursor: null,
        }),
      );
      expect(finished.run.result.data).toBeUndefined();
      expect(finished.run.outputData).toBeUndefined();
      const summary = await tool("simulation", {
        request: { operation: "read", runId: started.run.id },
      });
      expect(summary.run.artifacts).toBeUndefined();
      expect(summary.run.artifactCount).toBe(finished.run.artifacts.length);
      expect(summary.run.details).toEqual(finished.run.details);
      // Every file of the run has reached the relay before the Agent asks.
      const fileIds = finished.run.artifacts.map(
        (item: { id: string; fileId?: string }) => item.fileId ?? item.id,
      );
      await vi.waitFor(() =>
        expect(relay.uploaded).toEqual(expect.arrayContaining(fileIds)),
      );
      const csv = finished.run.artifacts.find(
        (item: { name: string }) => item.name === "op-0.csv",
      );
      const path = join(directory, "result.csv");
      expect(
        await tool("simulation_files", {
          request: { action: "artifact", artifactId: csv.id },
          outputPath: path,
        }),
      ).toMatchObject({ ok: true });
      // The captured raw record declares "notype"; the unit stays unknown.
      expect((await readFile(path, "utf8")).split("\n")).toContain("output,2,");
      const basePath = join(directory, "workspace");
      const synced = await tool("simulation_files", {
        request: { action: "sync", runId: started.run.id },
        basePath,
      });
      expect(synced).toMatchObject({
        ok: true,
        basePath,
        workspaceFileCount: finished.run.artifacts.length,
      });
      expect(synced.files).toHaveLength(finished.run.artifacts.length);
      expect(relay.served).toEqual(expect.arrayContaining(fileIds));
      expect(synced.projection).toBe("summary");
      expect(synced.runs).toBeUndefined();
      expect(synced.files[0].sha256).toBeUndefined();
      expect(
        await tool("simulation_files", { request: { action: "workspace" } }),
      ).toMatchObject({ ok: true, basePath });
      const served = relay.served.length;
      const reused = await tool("simulation_files", {
        request: { action: "sync", runId: started.run.id },
      });
      expect(reused.ok, JSON.stringify(reused.error)).toBe(true);
      expect(
        reused.files.every((file: { reused: boolean }) => file.reused),
      ).toBe(true);
      expect(relay.served).toHaveLength(served);
      const localIndex = JSON.parse(await readFile(synced.indexPath, "utf8"));
      expect(localIndex.runs[0].runId).toBe(started.run.id);
      expect(localIndex.runs[0].files[0].sha256).toBeDefined();
      expect(http.claims).toHaveLength(1);
    });

    it("warns about an invalid @spec line in a file it saved, and the file is saved as written (#1398)", async () => {
      const project = emptyAgentProject();
      project.simulationFolders = [
        createSimulationFolder({
          id: "wien",
          name: "Wien",
          profileId: "ngspice",
          engine: "ngspice",
        }),
      ];
      const editor = liveAgentEditor({ project });
      const tool = tools({ client: editor.client });
      await tool("connect", { claimCode: "session-1.code" });
      // #1311: ngspice reads 40m, but a Spec bound takes no SPICE suffix.
      const source = (bounds: string) =>
        [
          "Wien-bridge oscillator",
          ".tran 1u 40m",
          ".meas tran per10 trig v(out) val=0 rise=2 targ v(out) val=0 rise=12",
          `* @spec per10 range ${bounds} unit=s`,
          ".end",
          "",
        ].join("\n");
      const save = (expectedRevision: number, bounds: string) =>
        tool("simulation_files", {
          request: {
            action: "update",
            owner: { kind: "project-folder", folderId: "wien" },
            expectedRevision,
            writes: [{ path: "run.cir", text: source(bounds) }],
          },
        });
      const saved = () =>
        editor.controller.project.simulationFolders[0]!.input.files.find(
          (file) => file.path === "run.cir",
        )!.text;
      const first = editor.controller.project.structureRevision;
      const calls = editor.http.fileCalls.length;
      const warned = await save(first, "9.0m 11.1m");
      expect(warned).toMatchObject({
        ok: true,
        update: {
          changed: true,
          files: [{ path: "run.cir", action: "updated" }],
        },
      });
      expect(warned.specWarnings).toEqual([
        {
          path: "run.cir",
          line: 4,
          message: expect.stringMatching(/"9\.0m".*write 9\.0e-3/u),
        },
      ]);
      // A warning, not a refusal; checked from the request, nothing reread.
      expect(saved()).toBe(source("9.0m 11.1m"));
      expect(editor.http.fileCalls).toHaveLength(calls + 1);
      // A refused update wrote nothing, so it warns about nothing.
      const refused = await save(first, "9.0m 11.1m");
      expect(refused).toMatchObject({
        ok: false,
        error: { code: "PROJECT_REVISION_CONFLICT" },
      });
      expect(refused).not.toHaveProperty("specWarnings");
      const valid = await save(warned.source.revision, "9.0e-3 11.1e-3");
      expect(valid).toMatchObject({ ok: true, update: { changed: true } });
      expect(valid).not.toHaveProperty("specWarnings");
      expect(saved()).toBe(source("9.0e-3 11.1e-3"));
      // An edit sends only its fragment, so the file it changed is read back
      // once and checked whole.
      const beforeEdit = editor.http.fileCalls.length;
      const edited = await tool("simulation_files", {
        request: {
          action: "update",
          owner: { kind: "project-folder", folderId: "wien" },
          expectedRevision: valid.source.revision,
          replacements: [
            {
              path: "run.cir",
              textDigest: valid.update.files[0].textDigest,
              oldText: "range 9.0e-3",
              newText: "range 9.0m",
            },
          ],
        },
      });
      expect(edited.specWarnings).toEqual([
        {
          path: "run.cir",
          line: 4,
          message: expect.stringMatching(/"9\.0m".*write 9\.0e-3/u),
        },
      ]);
      expect(saved()).toBe(source("9.0m 11.1e-3"));
      expect(editor.http.fileCalls.slice(beforeEdit)).toMatchObject([
        { input: { action: "update" } },
        { input: { action: "read", path: "run.cir", offset: 0 } },
      ]);
    });
  },
);
