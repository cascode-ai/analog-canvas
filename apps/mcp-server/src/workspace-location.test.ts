import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { AgentSessionClient } from "@icm/agent-client";
import { FakeAgentHttp } from "../../../packages/agent-client/src/test-support/fake-relay.js";
import { defaultWorkspacePath } from "./local-workspace.js";
import {
  createOperationSession,
  type OperationSession,
} from "./operation-session.js";
import { executeOperation } from "./operations.js";
import { userWorkspaceRoot } from "./workspace-location.js";

describe("workspace location policy", () => {
  it("separates browser copies with the same Project.id and reuses saved Cloud identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "icm-workspace-identity-"));
    const client = new AgentSessionClient({ http: new FakeAgentHttp() });
    await client.connect("session-1.code");
    let workspaceId = "tab-a";
    let cloudProjectId: string | null = null;
    vi.spyOn(client, "projectResource").mockImplementation(async (request) => ({
      apiVersion: "3.0",
      requestId: request.requestId,
      operation: "workspace",
      ok: true,
      result: {
        action: "list",
        activeWorkspaceId: workspaceId,
        projects: [
          {
            workspaceId,
            projectId: "project-main",
            name: "New Circuit",
            cloudProjectId,
            dirty: false,
            structureRevision: 0,
            cells: [],
          },
        ],
      },
    }));
    const session: OperationSession = { client, workspaceRoot: root };
    const inspect = () =>
      executeOperation(
        "simulation_data",
        {
          request: { action: "workspace" },
        },
        session,
      ) as Promise<any>;
    try {
      const draftA = await inspect();
      workspaceId = "tab-b";
      const draftB = await inspect();
      expect(draftB.basePath).not.toBe(draftA.basePath);
      cloudProjectId = "cloud-saved";
      const saved = await inspect();
      expect(saved.basePath).not.toBe(draftB.basePath);
      workspaceId = "tab-reopened";
      expect((await inspect()).basePath).toBe(saved.basePath);
      expect(await readFile(draftA.indexPath, "utf8")).toContain("draft:tab-a");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("uses platform user data without trusting cwd or a relative environment path", () => {
    const root = userWorkspaceRoot();
    expect(isAbsolute(root)).toBe(true);
    expect(root).not.toContain(process.cwd());
    const home = join(tmpdir(), "home");
    expect(userWorkspaceRoot({}, "linux", home)).toBe(
      join(home, ".local", "share", "analog-canvas", "workspaces"),
    );
    expect(userWorkspaceRoot({}, "darwin", home)).toBe(
      join(
        home,
        "Library",
        "Application Support",
        "analog-canvas",
        "workspaces",
      ),
    );
    expect(() =>
      userWorkspaceRoot({ XDG_DATA_HOME: "relative" }, "linux", home),
    ).toThrow("ABSOLUTE");
    expect(() =>
      createOperationSession({
        apiBaseUrl: "https://test",
        connectorPath: "unused",
        taskDirectory: "relative",
      }),
    ).toThrow("absolute");
  });

  it("honors explicit, saved, host-task and user-data paths across fresh sessions without mixing Projects", async () => {
    const root = await mkdtemp(join(tmpdir(), "icm-workspace-policy-"));
    const client = new AgentSessionClient({ http: new FakeAgentHttp() });
    await client.connect("session-1.code");
    const status = await client.status();
    let projectId = "p1";
    vi.spyOn(client, "status").mockImplementation(async () => ({
      ...status,
      projectId,
    }));
    vi.spyOn(client, "projectResource").mockImplementation(async (request) => ({
      apiVersion: "3.0",
      requestId: request.requestId,
      operation: "workspace",
      ok: true,
      result: {
        action: "list",
        activeWorkspaceId: `tab-${projectId}`,
        projects: [
          {
            workspaceId: `tab-${projectId}`,
            projectId,
            name: projectId,
            cloudProjectId: `cloud-${projectId}`,
            dirty: false,
            structureRevision: 0,
            cells: [],
          },
        ],
      },
    }));
    const session = (taskDirectory?: string): OperationSession => ({
      client,
      workspaceRoot: join(root, "data"),
      ...(taskDirectory ? { taskDirectory } : {}),
    });
    const invoke = (state: OperationSession, basePath?: string) =>
      executeOperation(
        "simulation_data",
        {
          request: { action: "workspace" },
          ...(basePath ? { basePath } : {}),
        },
        state,
      ) as Promise<any>;
    try {
      const first = await invoke(session());
      expect(first.basePath.startsWith(join(root, "data"))).toBe(true);
      const explicit = join(root, "custom");
      const custom = await invoke(session(), explicit);
      expect(custom.basePath).toBe(explicit);
      await writeFile(join(custom.workPath, "user.py"), "user-owned");
      const reopened = await invoke(session(join(root, "ignored-task")));
      expect(reopened.basePath).toBe(explicit);
      expect(await readFile(join(reopened.workPath, "user.py"), "utf8")).toBe(
        "user-owned",
      );
      projectId = "p2";
      const task = await invoke(session(join(root, "task")));
      expect(
        task.basePath.startsWith(join(root, "task", ".analog-canvas")),
      ).toBe(true);
      expect(task.projectId).toBe("p2");
      expect((await invoke(session(), explicit)).error.message).toBe(
        "WORKSPACE_PROJECT_MISMATCH",
      );
      const badPath = join(root, "not-a-directory");
      await writeFile(badPath, "occupied");
      expect((await invoke(session(), badPath)).ok).toBe(false);
      expect((await invoke(session())).basePath).toBe(task.basePath);
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
