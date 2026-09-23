import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionClient, AgentSessionError } from "@icm/agent-client";
import { FakeAgentHttp } from "../../../packages/agent-client/src/test-support/fake-relay.js";
import { SimulationFiles } from "@icm/simulation-service";
import { workspaceTransfer } from "./workspace-transfer.js";
import { LocalWorkspace } from "./local-workspace.js";
import { TransferPending } from "./transfer-pending.js";

describe("workspace batch preparation", () => {
  it("bounds deferred publication retries and keeps single-RPC preparation nonblocking", async () => {
    const files = new SimulationFiles();
    const ref = await files.put("pending", "text/plain", "a");
    const client = new AgentSessionClient({ http: new FakeAgentHttp() });
    await client.connect("session-1.code");
    const prepare = vi
      .spyOn(client, "prepareArtifactDownload")
      .mockResolvedValue({
        apiVersion: "3.0",
        requestId: "r",
        operation: "simulation-input",
        ok: true,
        result: {
          ok: false,
          error: {
            code: "ARTIFACT_TRANSFER_PENDING",
            message: "wait",
            stage: "export",
            recovery: "retry-after",
            retryAfterMs: 1,
          },
        },
      });
    const bytes = vi.spyOn(client, "downloadArtifact");
    const transfer = workspaceTransfer(client);
    transfer.select!([ref], { deferPending: true });
    for (let i = 0; i < 60; i++)
      await expect(transfer(ref, 0)).rejects.toMatchObject({
        retryAfterMs: 500,
      });
    await expect(transfer(ref, 0)).rejects.not.toBeInstanceOf(TransferPending);
    expect(prepare).toHaveBeenCalledTimes(61);
    expect(prepare).toHaveBeenLastCalledWith(ref.id, undefined, { waitMs: 0 });
    expect(bytes).not.toHaveBeenCalled();
  });
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
  it("prepares only two missing files in a fourteen-of-sixteen local hit", async () => {
    const files = new SimulationFiles();
    const refs = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        files.put(`f${i}`, "text/plain", `${i}`),
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
      .mockImplementation(
        async (path) =>
          new Response(`${refs.findIndex((ref) => path.endsWith(ref.id))}`),
      );
    const root = await mkdtemp(join(tmpdir(), "icm-mixed-hit-"));
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
        preparedId: "p",
        inputRevision: "1",
        execution: "completed" as const,
        collection: "complete" as const,
        files: refs,
        datasets: [],
      };
      await workspace.sync(
        catalog,
        workspaceTransfer(client),
        refs.slice(0, 14).map((ref) => ref.id),
      );
      metadata.mockClear();
      bytes.mockClear();
      const result = await workspace.sync(catalog, workspaceTransfer(client));
      expect(result.transfer).toMatchObject({
        downloaded: 2,
        reused: 14,
        remaining: 0,
      });
      expect(metadata).toHaveBeenCalledTimes(1);
      expect(metadata.mock.calls[0]![2]).toMatchObject({
        input: {
          action: "downloads",
          artifactIds: refs.slice(14).map((ref) => ref.id),
        },
      });
      expect(bytes).toHaveBeenCalledTimes(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("downloads ready files behind two pending entries through the real workspace scheduler", async () => {
    const files = new SimulationFiles();
    const refs = await Promise.all(
      ["pending-a", "pending-b", "ready-c", "ready-d"].map((name) =>
        files.put(name, "text/plain", name),
      ),
    );
    const client = new AgentSessionClient({ http: new FakeAgentHttp() });
    await client.connect("session-1.code");
    const ready = (ref: (typeof refs)[number]) => ({
      ok: true as const,
      artifact: ref,
      download: { path: `/api/agent/sessions/session-1/artifacts/${ref.id}` },
    });
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
            i < 2
              ? {
                  ok: false,
                  error: {
                    code: "ARTIFACT_TRANSFER_PENDING",
                    message: "wait",
                    stage: "export",
                    recovery: "retry-after",
                    retryAfterMs: 500,
                  },
                }
              : ready(ref),
        })),
      },
    });
    let release = false;
    vi.spyOn(client, "prepareArtifactDownload").mockImplementation(
      async (id) => ({
        apiVersion: "3.0",
        requestId: "r",
        operation: "simulation-input",
        ok: true,
        result: release
          ? ready(refs.find((ref) => ref.id === id)!)
          : {
              ok: false,
              error: {
                code: "ARTIFACT_TRANSFER_PENDING",
                message: "wait",
                stage: "export",
                recovery: "retry-after",
                retryAfterMs: 500,
              },
            },
      }),
    );
    const downloaded: string[] = [];
    vi.spyOn(client, "downloadArtifact").mockImplementation(async (path) => {
      const ref = refs.find((ref) => path.endsWith(ref.id))!;
      downloaded.push(ref.name);
      return new Response(ref.name);
    });
    const root = await mkdtemp(join(tmpdir(), "icm-pending-slots-"));
    let pending: Promise<unknown> | undefined;
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
      pending = workspace.sync(
        {
          schemaVersion: 1,
          runId: "r",
          preparedId: "p",
          inputRevision: "1",
          execution: "completed",
          collection: "complete",
          files: refs,
          datasets: [],
        },
        workspaceTransfer(client),
      );
      await vi.waitFor(() =>
        expect(downloaded.sort()).toEqual(["ready-c", "ready-d"]),
      );
      release = true;
      const result = await pending;
      expect(result).toMatchObject({
        ok: true,
        transfer: { downloaded: 4, remaining: 0 },
      });
    } finally {
      release = true;
      await pending;
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
