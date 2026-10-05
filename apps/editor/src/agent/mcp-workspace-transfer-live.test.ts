import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ArtifactRef,
  ResultCatalog,
} from "@icm/simulation-service/contract";
import { SimulationFiles } from "@icm/simulation-service/files";
import { transportFailure } from "../../../../packages/agent-client/src/errors";
import { LocalWorkspace } from "../../../mcp-server/src/local-workspace";
import { TransferPending } from "../../../mcp-server/src/transfer-pending";
import { workspaceTransfer } from "../../../mcp-server/src/workspace-transfer";
import { liveEditorWithRelay } from "./live-simulation.test-support";

type LiveEditor = ReturnType<typeof liveEditorWithRelay>;

const editors: LiveEditor[] = [];
const directories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const editor of editors.splice(0)) editor.relay.release();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

/** The live editor, connected, with the relay's artifact transfers attached. */
async function connected() {
  const editor = liveEditorWithRelay();
  editors.push(editor);
  await editor.client.connect("session-1.code");
  return editor;
}

/** Evidence the editor holds, as a run leaves it: one file per name. */
async function evidence(
  editor: LiveEditor,
  names: string[],
  text: (name: string, index: number) => string = (name) => name,
) {
  const refs: ArtifactRef[] = [];
  for (const [index, name] of names.entries())
    refs.push(
      await editor.fileHost.simulationFiles.put(
        name,
        "text/plain",
        text(name, index),
      ),
    );
  return refs;
}

const fileId = (ref: ArtifactRef) => ref.fileId ?? ref.id;

/** The download descriptor requests that reached the editor. */
function descriptorRequests(editor: LiveEditor) {
  return editor.http.fileCalls.flatMap((request) =>
    request.operation === "simulation-input" ? [request.input] : [],
  );
}

/** The run directory an Agent syncs: these files of one finished run. */
function runDirectory(files: ArtifactRef[]): ResultCatalog {
  return {
    schemaVersion: 1,
    runId: "run",
    preparedId: "prepared",
    inputRevision: "1",
    execution: "completed",
    collection: "complete",
    files,
    datasets: [],
  };
}

/** The Agent's local workspace for the live session's Project. */
async function localWorkspace(editor: LiveEditor) {
  const path = await mkdtemp(join(tmpdir(), "analog-transfer-"));
  directories.push(path);
  return LocalWorkspace.open(
    {
      serverUrl: editor.client.apiBaseUrl,
      sessionId: "session-1",
      projectId: editor.controller.project.id,
      projectIdentity: "draft:tab-1",
    },
    path,
  );
}

describe("workspace transfers from the live editor", () => {
  it("keeps publication retries batched and omits already-ready descriptors", async () => {
    const editor = await connected();
    // The relay has f0; every other upload is still in flight.
    editor.relay.hold((ref) => ref.name !== "f0");
    const refs = await evidence(
      editor,
      Array.from({ length: 17 }, (_, i) => `f${i}`),
      (_, i) => String(i),
    );
    await vi.waitFor(() =>
      expect(editor.relay.uploaded).toEqual([fileId(refs[0]!)]),
    );
    const single = vi.spyOn(editor.client, "prepareArtifactDownload");
    const transfer = workspaceTransfer(editor.client);
    transfer.select!(refs, { deferPending: true });
    const [ready, ...pending] = await Promise.allSettled(
      refs.map((ref) => transfer(ref, 0)),
    );
    // f0 arrives at once; the other sixteen wait for their publication.
    expect(ready).toMatchObject({ status: "fulfilled" });
    expect(await (ready as PromiseFulfilledResult<Response>).value.text()).toBe(
      "0",
    );
    expect(
      pending.map(
        (item) =>
          item.status === "rejected" && item.reason instanceof TransferPending,
      ),
    ).toEqual(Array(16).fill(true));
    editor.relay.release();
    await vi.waitFor(() => expect(editor.relay.uploaded).toHaveLength(17));
    const bytes = await Promise.all(
      refs.slice(1).map(async (ref) => (await transfer(ref, 0)).text()),
    );
    expect(bytes).toEqual(refs.slice(1).map((_, i) => String(i + 1)));
    // One batch per round; the second omits the file already fetched.
    expect(descriptorRequests(editor)).toEqual([
      { action: "downloads", artifactIds: refs.map((ref) => ref.id) },
      { action: "downloads", artifactIds: refs.slice(1).map((ref) => ref.id) },
    ]);
    expect(single).not.toHaveBeenCalled();
  });

  it("bounds deferred publication retries and keeps single-RPC preparation nonblocking", async () => {
    const editor = await connected();
    // The relay never receives this upload.
    editor.relay.hold(() => true);
    const [ref] = await evidence(editor, ["pending"]);
    const prepare = vi.spyOn(editor.client, "prepareArtifactDownload");
    const transfer = workspaceTransfer(editor.client);
    transfer.select!([ref!], { deferPending: true });
    // Each retry is scheduled at the editor's own publication hint.
    for (let i = 0; i < 60; i++)
      await expect(transfer(ref!, 0)).rejects.toSatisfy(
        (error) =>
          error instanceof TransferPending && error.retryAfterMs === 2000,
      );
    const last = transfer(ref!, 0);
    await expect(last).rejects.not.toBeInstanceOf(TransferPending);
    await expect(last).rejects.toThrow('"code":"ARTIFACT_TRANSFER_PENDING"');
    expect(prepare).toHaveBeenCalledTimes(61);
    expect(prepare).toHaveBeenLastCalledWith(ref!.id, undefined, {
      waitMs: 0,
    });
    expect(descriptorRequests(editor)).toHaveLength(61);
    expect(editor.relay.served).toEqual([]);
  });

  it("reports the relay's authorization refusal of a batch without falling back to single descriptors", async () => {
    const editor = await connected();
    const refs = await evidence(editor, ["a", "b"]);
    await vi.waitFor(() => expect(editor.relay.uploaded).toHaveLength(2));
    // The relay refuses the batch before it reaches the editor.
    const refused = vi
      .spyOn(editor.http, "files")
      .mockRejectedValueOnce(
        transportFailure(
          "TOKEN_SCOPE_INSUFFICIENT",
          "The token does not grant this operation",
          403,
        ),
      );
    const single = vi.spyOn(editor.client, "prepareArtifactDownload");
    const transfer = workspaceTransfer(editor.client);
    transfer.select!(refs);
    await expect(transfer(refs[0]!, 0)).rejects.toMatchObject({
      code: "TOKEN_SCOPE_INSUFFICIENT",
      httpStatus: 403,
    });
    expect(refused).toHaveBeenCalledOnce();
    expect(single).not.toHaveBeenCalled();
    expect(editor.http.fileCalls).toEqual([]);
    expect(editor.relay.served).toEqual([]);
  });

  it("prepares sixteen files in one metadata request and reuses every local file without network", async () => {
    const editor = await connected();
    const refs = await evidence(
      editor,
      Array.from({ length: 16 }, (_, i) => `f${i}.txt`),
      (_, i) => `${i}`,
    );
    await vi.waitFor(() => expect(editor.relay.uploaded).toHaveLength(16));
    const workspace = await localWorkspace(editor);
    const catalog = runDirectory(refs);
    expect(
      await workspace.sync(catalog, workspaceTransfer(editor.client)),
    ).toMatchObject({ ok: true, transfer: { downloaded: 16 } });
    expect(descriptorRequests(editor)).toEqual([
      { action: "downloads", artifactIds: refs.map((ref) => ref.id) },
    ]);
    expect(editor.relay.served).toHaveLength(16);
    expect(
      await workspace.sync(catalog, workspaceTransfer(editor.client)),
    ).toMatchObject({ ok: true, transfer: { reused: 16 } });
    expect(descriptorRequests(editor)).toHaveLength(1);
    expect(editor.relay.served).toHaveLength(16);
  });

  it("prepares only two missing files in a fourteen-of-sixteen local hit", async () => {
    const editor = await connected();
    const refs = await evidence(
      editor,
      Array.from({ length: 16 }, (_, i) => `f${i}`),
      (_, i) => `${i}`,
    );
    await vi.waitFor(() => expect(editor.relay.uploaded).toHaveLength(16));
    const workspace = await localWorkspace(editor);
    const catalog = runDirectory(refs);
    await workspace.sync(
      catalog,
      workspaceTransfer(editor.client),
      refs.slice(0, 14).map((ref) => ref.id),
    );
    const requests = descriptorRequests(editor).length;
    const served = editor.relay.served.length;
    const result = await workspace.sync(
      catalog,
      workspaceTransfer(editor.client),
    );
    expect(result.transfer).toMatchObject({
      downloaded: 2,
      reused: 14,
      remaining: 0,
    });
    expect(descriptorRequests(editor).slice(requests)).toEqual([
      { action: "downloads", artifactIds: refs.slice(14).map((ref) => ref.id) },
    ]);
    expect(editor.relay.served.slice(served).sort()).toEqual(
      refs.slice(14).map(fileId).sort(),
    );
  });

  it("downloads ready files behind two pending entries through the real workspace scheduler", async () => {
    const editor = await connected();
    editor.relay.hold((ref) => ref.name.startsWith("pending"));
    const refs = await evidence(editor, [
      "pending-a",
      "pending-b",
      "ready-c",
      "ready-d",
    ]);
    await vi.waitFor(() => expect(editor.relay.uploaded).toHaveLength(2));
    const served = () =>
      editor.relay.served
        .map((id) => refs.find((ref) => fileId(ref) === id)!.name)
        .sort();
    const workspace = await localWorkspace(editor);
    // The scheduler's clock, so the test need not sleep through the
    // editor's publication hint before the retry.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const synced = workspace.sync(
      runDirectory(refs),
      workspaceTransfer(editor.client),
    );
    await vi.waitFor(() => expect(served()).toEqual(["ready-c", "ready-d"]));
    // The relay now receives the two uploads still in flight.
    editor.relay.release();
    await vi.waitFor(() => expect(editor.relay.uploaded).toHaveLength(4));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await synced).toMatchObject({
      ok: true,
      transfer: { downloaded: 4, remaining: 0 },
    });
    expect(served()).toEqual(["pending-a", "pending-b", "ready-c", "ready-d"]);
  });

  it("does not hold a ready file behind a pending peer or conceal a per-file failure", async () => {
    const editor = await connected();
    editor.relay.hold((ref) => ref.name === "pending");
    const refs = await evidence(editor, ["ready", "pending"]);
    // A file of another session's run: this editor never held it.
    refs.push(await new SimulationFiles().put("bad", "text/plain", "bad"));
    await vi.waitFor(() =>
      expect(editor.relay.uploaded).toEqual([fileId(refs[0]!)]),
    );
    const wait = vi.spyOn(editor.client, "prepareArtifactDownload");
    const transfer = workspaceTransfer(editor.client);
    transfer.select!(refs);
    // The waiting file sleeps on this clock between its descriptor polls.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = transfer(refs[1]!, 0);
    expect(await (await transfer(refs[0]!, 0)).text()).toBe("ready");
    await expect(transfer(refs[2]!, 0)).rejects.toThrow("ARTIFACT_UNAVAILABLE");
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(refs[1]!.id, undefined, {});
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    expect(editor.relay.served).toEqual([fileId(refs[0]!)]);
    // Once the relay has the upload, the waiting file arrives as well.
    editor.relay.release();
    await vi.waitFor(() => expect(editor.relay.uploaded).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await (await pending).text()).toBe("pending");
  });
});
