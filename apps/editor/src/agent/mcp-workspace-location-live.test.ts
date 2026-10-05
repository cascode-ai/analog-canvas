import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";
import { defaultWorkspacePath } from "../../../mcp-server/src/local-workspace";
import type { OperationSession } from "../../../mcp-server/src/operation-session";
import { executeOperation } from "../../../mcp-server/src/operations";
import { EditorDocumentController } from "../document/document-controller";
import type { BrowserAgentProjectHostOptions } from "./browser-agent-project-host";
import { liveAgentEditor } from "./live-agent-editor.test-support";
import { listWorkspaceProjects, workspaceResponses } from "./workspace-copy";

/** A Project whose one Cell is `main`. */
function project(id: string, name: string) {
  const created = createEmptyProject(id, name);
  created.documents[0]!.id = "main";
  created.topDocumentId = "main";
  return created;
}

/**
 * The editor's open tabs, listed with the helpers its shell serves the
 * workspace list from: each tab's controller, and its Cloud Project if saved.
 */
function openTabs() {
  const tabs = new Map<
    string,
    { controller: EditorDocumentController; cloudId: string | null }
  >();
  let active = "";
  const workspace: NonNullable<
    BrowserAgentProjectHostOptions["workspace"]
  > = async ({ requestId, request }) => {
    const { fail, success } = workspaceResponses(requestId);
    if (request.action !== "list")
      return fail("WORKSPACE_OPERATION_FAILED", "Only listing is served here");
    return success({
      action: "list",
      activeWorkspaceId: active,
      projects: listWorkspaceProjects(
        [...tabs].map(([id, tab]) => ({
          id,
          session: {
            controller: tab.controller,
            file: { cloudBinding: tab.cloudId ? { id: tab.cloudId } : null },
            dirty: false,
          },
        })),
      ),
    });
  };
  return {
    workspace,
    /** Open (or replace) a tab and bring it to the front. */
    show(
      id: string,
      controller: EditorDocumentController,
      cloudId = null as string | null,
    ) {
      tabs.set(id, { controller, cloudId });
      active = id;
    },
  };
}

const inspectWorkspace = (session: OperationSession, basePath?: string) =>
  executeOperation(
    "simulation_data",
    {
      request: { action: "workspace" },
      ...(basePath ? { basePath } : {}),
    },
    session,
  ) as Promise<any>;

describe("the MCP's local workspace for the editor's open Projects", () => {
  it("separates browser copies with the same Project.id and reuses saved Cloud identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "icm-workspace-identity-"));
    const tabs = openTabs();
    const opened = project("project-main", "New Circuit");
    const { client, controller } = liveAgentEditor({
      project: opened,
      projectHost: { workspace: tabs.workspace },
    });
    tabs.show("tab-a", controller);
    await client.connect("session-1.code");
    const session: OperationSession = { client, workspaceRoot: root };
    try {
      const draftA = await inspectWorkspace(session);
      // A second browser copy of the same Project, in another tab.
      const copy = new EditorDocumentController(structuredClone(opened));
      tabs.show("tab-b", copy);
      const draftB = await inspectWorkspace(session);
      expect(draftB.basePath).not.toBe(draftA.basePath);
      tabs.show("tab-b", copy, "cloud-saved");
      const saved = await inspectWorkspace(session);
      expect(saved.basePath).not.toBe(draftB.basePath);
      // The saved Project, reopened in a new tab, keeps its workspace.
      tabs.show(
        "tab-reopened",
        new EditorDocumentController(structuredClone(opened)),
        "cloud-saved",
      );
      expect((await inspectWorkspace(session)).basePath).toBe(saved.basePath);
      expect(await readFile(draftA.indexPath, "utf8")).toContain("draft:tab-a");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("honors explicit, saved, host-task and user-data paths across fresh sessions without mixing Projects", async () => {
    const root = await mkdtemp(join(tmpdir(), "icm-workspace-policy-"));
    const tabs = openTabs();
    const { client, controller } = liveAgentEditor({
      project: project("p1", "p1"),
      projectHost: { workspace: tabs.workspace },
    });
    tabs.show("tab-p1", controller, "cloud-p1");
    await client.connect("session-1.code");
    // The relay reports which Project the session is paired with.
    const status = await client.status();
    let projectId = "p1";
    vi.spyOn(client, "status").mockImplementation(async () => ({
      ...status,
      projectId,
    }));
    const session = (taskDirectory?: string): OperationSession => ({
      client,
      workspaceRoot: join(root, "data"),
      ...(taskDirectory ? { taskDirectory } : {}),
    });
    try {
      const first = await inspectWorkspace(session());
      expect(first.basePath.startsWith(join(root, "data"))).toBe(true);
      const explicit = join(root, "custom");
      const custom = await inspectWorkspace(session(), explicit);
      expect(custom.basePath).toBe(explicit);
      await writeFile(join(custom.workPath, "user.py"), "user-owned");
      const reopened = await inspectWorkspace(
        session(join(root, "ignored-task")),
      );
      expect(reopened.basePath).toBe(explicit);
      expect(await readFile(join(reopened.workPath, "user.py"), "utf8")).toBe(
        "user-owned",
      );
      // The session now pairs with another Project, open in its own tab.
      projectId = "p2";
      tabs.show(
        "tab-p2",
        new EditorDocumentController(project("p2", "p2")),
        "cloud-p2",
      );
      const task = await inspectWorkspace(session(join(root, "task")));
      expect(
        task.basePath.startsWith(join(root, "task", ".analog-canvas")),
      ).toBe(true);
      expect(task.projectId).toBe("p2");
      expect((await inspectWorkspace(session(), explicit)).error.message).toBe(
        "WORKSPACE_PROJECT_MISMATCH",
      );
      const badPath = join(root, "not-a-directory");
      await writeFile(badPath, "occupied");
      expect((await inspectWorkspace(session(), badPath)).ok).toBe(false);
      expect((await inspectWorkspace(session())).basePath).toBe(task.basePath);
      const pointer = defaultWorkspacePath(
        {
          serverUrl: client.apiBaseUrl,
          projectId,
          projectIdentity: `cloud:cloud-${projectId}`,
          sessionId: "ignored",
        },
        join(root, "data"),
      );
      expect(
        await readFile(join(pointer, "location.json"), "utf8"),
      ).not.toContain("token");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
