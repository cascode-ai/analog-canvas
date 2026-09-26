import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConnectorStore } from "./connector-store.js";
import { WorkspaceBindingStore } from "./workspace-binding-store.js";
import { AgentSessionClient } from "./session-client.js";
import {
  FakeAgentHttp,
  snapshotResponse,
  transactSuccessResponse,
} from "./test-support/fake-relay.js";
import { testSnapshot } from "./test-support/snapshot-fixture.js";

describe("task workspace binding", () => {
  it("restores across fresh clients, isolates tasks, and refuses a closed or replaced target without reading a foreground document", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analog-binding-"));
    try {
      const connectorStore = new ConnectorStore(
        join(directory, "connector.json"),
      );
      const binding = new WorkspaceBindingStore(join(directory, "task-b.json"));
      let closed = false;
      let projectId = "project-b";
      const create = (workspaceBindingStore = binding) => {
        const http = new FakeAgentHttp({
          projects: (request) => ({
            apiVersion: "3.0",
            requestId: request.requestId,
            operation: "workspace",
            ok: true,
            result: {
              action: "list",
              activeWorkspaceId: "tab-a",
              projects: closed
                ? []
                : [
                    {
                      workspaceId: "tab-b",
                      projectId,
                      name: "B",
                      cloudProjectId: null,
                      dirty: false,
                      structureRevision: 0,
                      cells: [{ documentId: "main", name: "B", revision: 0 }],
                    },
                  ],
            },
          }),
        });
        return {
          http,
          client: new AgentSessionClient({
            http,
            connectorStore,
            workspaceBindingStore,
          }),
        };
      };
      const first = create();
      await first.client.connect("session-1.code");
      await first.client.bindWorkspace("tab-b");
      expect(await binding.load()).toMatchObject({
        workspaceId: "tab-b",
        projectId: "project-b",
      });
      expect(await readFile(binding.path, "utf8")).not.toMatch(
        /token|revision|documentIds/i,
      );

      const second = create();
      const snapshot = testSnapshot();
      snapshot.project.id = "project-b";
      second.http.circuitHandler = async ({ request }) => {
        expect(second.http.workspaceId).toBe("tab-b");
        return request.operation === "transact"
          ? transactSuccessResponse(request.requestId, request.expectedRevision)
          : snapshotResponse(request.requestId, snapshot);
      };
      await second.client.snapshot();
      expect(
        await second.client.advancedTransact({
          edits: [
            {
              kind: "set_instance_reference",
              instanceId: "instance-1",
              reference: "M2",
            },
          ],
        }),
      ).toMatchObject({
        ok: true,
        workspaceId: "tab-b",
        projectId: "project-b",
      });
      expect(second.http.projectCalls).toHaveLength(1);
      const separate = create(
        new WorkspaceBindingStore(join(directory, "task-a.json")),
      );
      await separate.client.snapshot();
      expect(separate.client.workspaceId).toBeNull();
      expect(separate.http.projectCalls).toHaveLength(0);

      projectId = "replaced";
      const replaced = create();
      await expect(replaced.client.snapshot()).rejects.toMatchObject({
        code: "WORKSPACE_NOT_FOUND",
      });
      await expect(replaced.client.snapshot()).rejects.toMatchObject({
        code: "WORKSPACE_NOT_FOUND",
      });
      expect(replaced.http.circuitCalls).toHaveLength(0);
      closed = true;
      const missing = create();
      await expect(missing.client.snapshot()).rejects.toMatchObject({
        code: "WORKSPACE_NOT_FOUND",
      });
      expect(missing.http.circuitCalls).toHaveLength(0);
      await missing.client.bindWorkspace(null);
      await missing.client.snapshot();
      expect(missing.client.workspaceId).toBeNull();
      expect(await binding.load()).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps corrupt and stale target records fail-closed until explicitly cleared; new Claims reset targets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analog-binding-"));
    try {
      const connectorStore = new ConnectorStore(
        join(directory, "connector.json"),
      );
      const workspaceBindingStore = new WorkspaceBindingStore(
        join(directory, "target.json"),
      );
      const http = new FakeAgentHttp();
      await new AgentSessionClient({ http, connectorStore }).connect(
        "session-1.code",
      );
      await workspaceBindingStore.save({
        version: 1,
        apiBaseUrl: http.baseUrl,
        sessionId: "another-session",
        workspaceId: "tab-b",
        projectId: "project-b",
      });
      const restarted = new AgentSessionClient({
        http,
        connectorStore,
        workspaceBindingStore,
      });
      await expect(restarted.snapshot()).rejects.toMatchObject({
        code: "WORKSPACE_BINDING_STALE",
      });
      await writeFile(workspaceBindingStore.path, "broken");
      await expect(restarted.snapshot()).rejects.toThrow(
        "saved workspace binding",
      );
      await restarted.connect("session-1.new-claim");
      expect(await workspaceBindingStore.load()).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not advertise durable CLI binding without a task directory", async () => {
    const client = new AgentSessionClient({
      http: new FakeAgentHttp(),
      requireDurableWorkspaceBinding: true,
    });
    await expect(client.bindWorkspace("tab-b")).rejects.toMatchObject({
      code: "WORKSPACE_TASK_REQUIRED",
    });
  });
});
