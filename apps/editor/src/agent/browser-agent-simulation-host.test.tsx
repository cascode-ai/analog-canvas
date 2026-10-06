import { IDBFactory } from "fake-indexeddb";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulationFiles } from "@icm/simulation-service/files";
import { callTool } from "../../../mcp-server/src/tools";
import { createBrowserSimulationArchiveStore } from "../features/simulation/browser-simulation-archive-store";
import { BrowserSimulationSession } from "../features/simulation/browser-simulation-session";
import { ProjectRunHistory } from "../features/simulation/project-run-history";
import { restoreSimulationRunArchive } from "../features/simulation/simulation-run-archive";
import { SpiceSimulationSurface } from "../features/simulation/spice-simulation-surface";
import {
  emptyAgentProject,
  liveAgentEditor,
} from "./live-agent-editor.test-support";
import {
  HostedSimulationService,
  dividerFolder,
} from "./live-simulation.test-support";

const cleanup: (() => unknown)[] = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/**
 * One editor tab: a saved divider folder, an Agent connected to it, and the
 * Project's run history the App gives both the Agent's Simulation resource
 * and the person's Simulation panel.
 */
async function editorTab() {
  const service = new HostedSimulationService();
  const project = emptyAgentProject();
  project.simulationFolders = [dividerFolder("folder", "OP")];
  const idbFactory = new IDBFactory();
  const history = new ProjectRunHistory(
    project.id,
    createBrowserSimulationArchiveStore({ idbFactory }),
  );
  const editor = liveAgentEditor({
    project,
    simulationService: service.fetch,
    runHistory: history,
  });
  // The panel's own session, as the App opens Simulation for the person.
  const person = new BrowserSimulationSession({
    runHistory: history,
    owner: "human",
    getProjectSessionId: () => editor.controller.projectSessionId,
    getProject: () => editor.controller.project,
    fetch: service.fetch,
  });
  cleanup.push(
    () => history.dispose(),
    () => editor.simulationHost?.clear(),
    () => person.clear(),
  );
  await editor.client.connect("session-1.code");
  return { service, editor, history, person, idbFactory };
}
type EditorTab = Awaited<ReturnType<typeof editorTab>>;

const folderSource = ({ editor }: EditorTab) => ({
  kind: "project-folder" as const,
  folderId: "folder",
  expectedStructureRevision: editor.controller.project.structureRevision,
});

/** `simulation_run run` on the folder, as an Agent normally submits it. */
async function agentRuns(tab: EditorTab): Promise<string> {
  const result = await callTool(
    "simulation_run",
    {
      waitMs: 20_000,
      request: { operation: "run", source: folderSource(tab) },
    },
    { client: tab.editor.client },
  );
  const reply = JSON.parse(result.content[0]!.text!);
  expect(reply).toMatchObject({ ok: true, run: { state: "finished" } });
  return reply.run.id;
}

/** The person presses Run: the panel prepares the folder, then starts it. */
async function personRuns(tab: EditorTab): Promise<string> {
  const prepared = await tab.person.handle({
    operation: "prepare",
    source: folderSource(tab),
  });
  if (!prepared.ok || !("prepared" in prepared))
    throw new Error(JSON.stringify(prepared));
  const started = await tab.person.handle({
    operation: "start",
    preparedId: prepared.prepared.id,
    digest: prepared.prepared.digest,
  });
  if (!started.ok || !("run" in started))
    throw new Error(JSON.stringify(started));
  return started.run.id;
}

/**
 * The runs' results, verified and kept by the observer without an Agent
 * read; it polls each run every 500 ms.
 */
async function handedOff({ history }: EditorTab, runIds: readonly string[]) {
  await vi.waitFor(
    () =>
      expect(
        history
          .snapshot()
          .filter((run) => runIds.includes(run.id) && run.archive)
          .map((run) => run.id),
      ).toEqual(runIds),
    { timeout: 5000 },
  );
}

/** The Simulation panel open on the folder: its status and Project runs. */
function panel(tab: EditorTab) {
  const markup = renderToStaticMarkup(
    <SpiceSimulationSurface
      open
      maximized={false}
      project={tab.editor.controller.project}
      activeDocumentId={tab.editor.controller.document.id}
      selectedFolderId="folder"
      onSelectFolderId={() => {}}
      session={tab.person}
      runHistory={tab.history}
      onToggleMaximized={() => {}}
      onMinimize={() => {}}
      onExit={() => {}}
      onSaveFolder={() => ({ status: "applied" })}
      onDeleteFolder={() => true}
      onHistoryBoundary={() => {}}
    />,
  );
  const runs =
    /aria-label="Project runs">([\s\S]*?)<\/section>/u.exec(markup)?.[1] ?? "";
  return {
    status: /class="simulation-status-chip[^"]*" role="status">([^<]*)</u.exec(
      markup,
    )?.[1],
    projectRuns: [
      ...runs.matchAll(/<li><span>([\s\S]*?)<\/span>(.*?)<\/li>/gu),
    ].map(([, row, actions]) => ({
      row: row!.replace(/<[^>]+>/gu, ""),
      openResult: actions!.includes('<button type="button">Open result'),
    })),
  };
}

describe("an Agent's runs of a Project folder in the Simulation panel", () => {
  it(
    "lists every owner's runs, failed ones included, and the folder status follows the newest",
    { timeout: 30_000 },
    async () => {
      const tab = await editorTab();
      // The Agent runs the folder twice before the person looks; the first
      // run fails.
      tab.service.failNext();
      const failed = await agentRuns(tab);
      await handedOff(tab, [failed]);
      expect(panel(tab).status).toBe("failed");
      const completed = await agentRuns(tab);
      await handedOff(tab, [completed]);
      expect(panel(tab)).toEqual({
        status: "completed",
        projectRuns: [
          {
            row: expect.stringMatching(/^Agent · OP · .+ · finished$/u),
            openResult: true,
          },
          {
            row: expect.stringMatching(/^Agent · OP · .+ · finished$/u),
            openResult: true,
          },
        ],
      });
      // The person runs it from the panel; then, with the panel still open,
      // the Agent runs it again, which reaches the panel without a reload.
      const yours = await personRuns(tab);
      await handedOff(tab, [yours]);
      const seenByPanel: string[][] = [];
      const unsubscribe = tab.history.subscribe(() =>
        seenByPanel.push(tab.history.snapshot().map((run) => run.id)),
      );
      const again = await agentRuns(tab);
      expect(seenByPanel.some((ids) => ids.includes(again))).toBe(true);
      unsubscribe();
      await handedOff(tab, [again]);
      expect(
        tab.history.snapshot().map(({ id, owner }) => [id, owner]),
      ).toEqual([
        [failed, "agent"],
        [completed, "agent"],
        [yours, "human"],
        [again, "agent"],
      ]);
      expect(panel(tab)).toEqual({
        status: "completed",
        projectRuns: [
          expect.objectContaining({ row: expect.stringMatching(/^Agent · /u) }),
          expect.objectContaining({ row: expect.stringMatching(/^Agent · /u) }),
          {
            row: expect.stringMatching(/^You · OP · .+ · finished$/u),
            openResult: true,
          },
          {
            row: expect.stringMatching(/^Agent · OP · .+ · finished$/u),
            openResult: true,
          },
        ],
      });
      expect(tab.service.executions).toBe(4);
    },
  );

  it(
    "opens an Agent's run result with the same input files as a person's run",
    { timeout: 30_000 },
    async () => {
      const tab = await editorTab();
      const agents = await agentRuns(tab);
      const yours = await personRuns(tab);
      await handedOff(tab, [agents, yours]);
      const archiveOf = (runId: string) =>
        tab.history.snapshot().find((run) => run.id === runId)!.archive!;
      expect(archiveOf(agents)).toMatchObject({
        runId: agents,
        folderId: "folder",
        origin: "agent",
      });
      expect(archiveOf(yours)).toMatchObject({ runId: yours, origin: "human" });
      // The Agent's session ends; Open result reads the browser archive.
      await tab.editor.simulationHost?.clear();
      const archives = createBrowserSimulationArchiveStore({
        idbFactory: tab.idbFactory,
      });
      cleanup.push(() => archives.close());
      const open = async (runId: string) => {
        const stored = await archives.read(archiveOf(runId).id);
        if (!stored.ok || !stored.value) throw new Error("archive unreadable");
        const restored = await restoreSimulationRunArchive(
          new SimulationFiles(),
          stored.value,
        );
        if (!restored.ok) throw new Error(restored.error.message);
        return restored.value;
      };
      const agentResult = await open(agents);
      const personResult = await open(yours);
      expect(agentResult.run).toMatchObject({
        id: agents,
        state: "finished",
        result: { outcome: { status: "completed" } },
      });
      expect(agentResult.prepared.id).toBe(agentResult.run.preparedId);
      const inputFiles = (result: typeof agentResult) =>
        result.prepared.artifacts.map((file) => file.name).sort();
      expect(inputFiles(agentResult)).toEqual(inputFiles(personResult));
      expect(tab.service.executions).toBe(2);
    },
  );
});
