import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionClient, AgentSessionError } from "@icm/agent-client";
import { FakeAgentHttp } from "../../../packages/agent-client/src/test-support/fake-relay.js";
import { SimulationFiles } from "@icm/simulation-service";
import { workspaceTransfer } from "./workspace-transfer.js";
import { LocalWorkspace } from "./local-workspace.js";

describe("workspace batch preparation", () => {
  it.each([400, 403])(
    "falls back only on a definite old-schema rejection, not authorization failure (%s)",
    async (status) => {
      const files = new SimulationFiles();
      const refs = await Promise.all(
        ["a", "b"].map((name) => files.put(name, "text/plain", name)),
      );
      const client = new AgentSessionClient({ http: new FakeAgentHttp() });
      await client.connect("session-1.code");
      const batch = vi
        .spyOn(client, "fileResource")
        .mockRejectedValue(
          new AgentSessionError(
            status === 400 ? "FILE_CONTENT_INVALID" : "SCOPE_DENIED",
            "rejected",
            "request-rejected",
            status,
          ),
        );
      const single = vi
        .spyOn(client, "prepareArtifactDownload")
        .mockImplementation(async (id) => ({
          apiVersion: "3.0",
          requestId: "r",
          operation: "simulation-input",
          ok: true,
          result: {
            ok: true,
            artifact: refs.find((ref) => ref.id === id)!,
            download: { path: `/api/agent/sessions/session-1/artifacts/${id}` },
          },
        }));
      vi.spyOn(client, "downloadArtifact").mockImplementation(
        async () => new Response("data"),
      );
      const transfer = workspaceTransfer(client);
      transfer.select!(refs);
      if (status === 400) {
        await transfer(refs[0]!, 0);
        await transfer(refs[1]!, 0);
        expect(batch).toHaveBeenCalledTimes(1);
        expect(single).toHaveBeenCalledTimes(2);
      } else {
        await expect(transfer(refs[0]!, 0)).rejects.toThrow("rejected");
        expect(single).not.toHaveBeenCalled();
      }
    },
  );
  it("prepares sixteen files in one metadata request and reuses every local file without network", async () => {
    const files = new SimulationFiles();
    const refs = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        files.put(`f${i}.txt`, "text/plain", `${i}`),
      ),
    );
    files.setArtifactPublisher(
      async (ref) => `/api/agent/sessions/session-1/artifacts/${ref.id}`,
    );
    const http = new FakeAgentHttp({
      files: async (request) => ({
        apiVersion: "3.0",
        requestId: request.requestId,
        operation: "simulation-input",
        ok: true,
        result: await files.handle(
          request.operation === "simulation-input" ? request.input : {},
        ),
      }),
    });
    const client = new AgentSessionClient({ http });
    await client.connect("session-1.code");
    const metadata = vi.spyOn(http, "files");
    const bytes = vi
      .spyOn(client, "downloadArtifact")
      .mockImplementation(async (path) => {
        const index = refs.findIndex((ref) => path.endsWith(ref.id));
        return new Response(`${index}`);
      });
    const root = await mkdtemp(join(tmpdir(), "icm-batch-transfer-"));
    try {
      const workspace = await LocalWorkspace.open(
        {
          serverUrl: "https://canvas.test",
          sessionId: "session-1",
          projectId: "p",
          projectIdentity: "cloud:p",
        },
        root,
      );
      const catalog = {
        schemaVersion: 1 as const,
        runId: "run",
        preparedId: "prepared",
        inputRevision: "1",
        execution: "completed" as const,
        collection: "complete" as const,
        files: refs,
        datasets: [],
      };
      expect(
        await workspace.sync(catalog, workspaceTransfer(client)),
      ).toMatchObject({ ok: true, transfer: { downloaded: 16 } });
      expect(metadata).toHaveBeenCalledTimes(1);
      expect(bytes).toHaveBeenCalledTimes(16);
      expect(
        await workspace.sync(catalog, workspaceTransfer(client)),
      ).toMatchObject({ ok: true, transfer: { reused: 16 } });
      expect(metadata).toHaveBeenCalledTimes(1);
      expect(bytes).toHaveBeenCalledTimes(16);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("does not hold a ready file behind a pending peer or conceal a per-file failure", async () => {
    const files = new SimulationFiles();
    const refs = await Promise.all(
      ["ready", "pending", "bad"].map((name) =>
        files.put(name, "text/plain", name),
      ),
    );
    const http = new FakeAgentHttp();
    const client = new AgentSessionClient({ http });
    await client.connect("session-1.code");
    vi.spyOn(client, "fileResource").mockResolvedValue({
      apiVersion: "3.0",
      requestId: "r",
      operation: "simulation-input",
      ok: true,
      result: {
        ok: true,
        downloads: refs.map((ref, i) => ({
          artifactId: ref.id,
          result:
            i === 0
              ? {
                  ok: true,
                  artifact: ref,
                  download: {
                    path: `/api/agent/sessions/session-1/artifacts/${ref.id}`,
                  },
                }
              : {
                  ok: false,
                  error: {
                    code:
                      i === 1
                        ? "ARTIFACT_TRANSFER_PENDING"
                        : "ARTIFACT_UNAVAILABLE",
                    message: "not ready",
                    stage: "export",
                    recovery: "retry-after",
                  },
                },
        })),
      },
    });
    const wait = vi
      .spyOn(client, "prepareArtifactDownload")
      .mockImplementation(async () => new Promise(() => {}));
    const bytes = vi
      .spyOn(client, "downloadArtifact")
      .mockResolvedValue(new Response("ready"));
    const transfer = workspaceTransfer(client);
    transfer.select!(refs);
    void transfer(refs[1]!, 0);
    expect(await (await transfer(refs[0]!, 0)).text()).toBe("ready");
    await expect(transfer(refs[2]!, 0)).rejects.toThrow("ARTIFACT_UNAVAILABLE");
    expect(wait).toHaveBeenCalledTimes(1);
    expect(bytes).toHaveBeenCalledTimes(1);
  });
});
