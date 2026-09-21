import { describe, it, expect } from "vitest";
import { ArtifactDownloadError, SimulationFiles, sha256 } from "./files.js";
describe("simulation File Resource evidence", () => {
  it("returns online edit receipts and preserves workspace revisions on no-op saves", async () => {
    const files = new SimulationFiles();
    const created = await files.handle({ action: "create" });
    if (!created.ok || !("workspace" in created)) throw Error("create");
    const owner = {
      kind: "session-workspace",
      workspaceId: created.workspace.id,
    };
    const written = await files.handle({
      action: "update",
      owner,
      expectedRevision: 0,
      writes: [{ path: "run.cir", text: "op\n" }],
    });
    expect(written).toMatchObject({
      update: {
        changed: true,
        files: [
          {
            path: "run.cir",
            action: "created",
            textDigest: await sha256("op\n"),
            byteLength: 3,
          },
        ],
      },
    });
    const updated = await files.handle({
      action: "update",
      owner,
      expectedRevision: 1,
      replacements: [
        {
          path: "run.cir",
          textDigest: await sha256("op\n"),
          oldText: "op",
          newText: "op",
        },
      ],
    });
    expect(updated).toMatchObject({
      source: { revision: 1 },
      update: { changed: false, files: [] },
    });
    expect(
      await files.handle({ action: "update", owner, expectedRevision: 0 }),
    ).toMatchObject({
      ok: false,
      error: {
        currentRevision: 1,
        fileEdit: { applied: false, expectedRevision: 0 },
      },
    });
  });
  it("releases only the consumer lifetime on clear, preserving durable evidence", async () => {
    let releases = 0;
    let saved: {
      ref: import("./contract.js").ArtifactRef;
      text: string;
    } | null = null;
    const files = new SimulationFiles(Date.now, undefined, undefined, {
      put: async (ref, text) => {
        saved = { ref, text };
      },
      get: async () => saved,
      releaseSession: () => {
        releases++;
      },
    });
    const ref = await files.put("result.raw", "text/plain", "evidence");
    files.clear();
    expect(releases).toBe(1);
    expect(await files.readArtifact(ref.id)).toMatchObject({
      ok: true,
      text: "evidence",
    });
  });
  it("retains authored workspace drafts until explicit discard rather than elapsed time", async () => {
    let now = 0;
    const files = new SimulationFiles(() => now);
    const created = await files.handle({ action: "create" });
    if (!created.ok || !("workspace" in created)) throw Error("create");
    expect(created.workspace.expiresAt).toBeNull();
    now = 24 * 60 * 60 * 1000;
    const owner = {
      kind: "session-workspace",
      workspaceId: created.workspace.id,
    };
    expect(await files.handle({ action: "list", owner })).toMatchObject({
      ok: true,
    });
    expect(await files.handle({ action: "discard", owner })).toMatchObject({
      ok: true,
    });
    expect(await files.handle({ action: "list", owner })).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_UNAVAILABLE" },
    });
  });
  it("ignores old upload completions when a new publisher owns the queue", async () => {
    const files = new SimulationFiles();
    const old: Array<(path: string) => void> = [];
    const current: Array<(path: string) => void> = [];
    files.setArtifactPublisher(
      () => new Promise((resolve) => old.push(resolve)),
    );
    for (const name of ["a", "b", "c"])
      await files.put(name, "text/plain", name);
    files.setArtifactPublisher(
      () => new Promise((resolve) => current.push(resolve)),
    );
    expect(current).toHaveLength(2);
    for (const resolve of old) resolve("/old");
    await Promise.resolve();
    await Promise.resolve();
    expect(current).toHaveLength(2);
    current[0]!("/current");
    await Promise.resolve();
    await Promise.resolve();
    expect(current).toHaveLength(3);
    expect(old).toHaveLength(2);
  });
  it("publishes outside RPC deadlines with bounded concurrency and never restarts a pending upload", async () => {
    const files = new SimulationFiles();
    const pending: Array<(path: string) => void> = [];
    files.setArtifactPublisher(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const one = await files.put("one.raw", "text/plain", "1");
    await files.put("two.raw", "text/plain", "2");
    const three = await files.put("three.raw", "text/plain", "3");
    expect(pending).toHaveLength(2);
    for (let i = 0; i < 3; i++)
      expect(
        await files.handle({ action: "download", artifactId: three.id }),
      ).toMatchObject({
        ok: false,
        error: { code: "ARTIFACT_TRANSFER_PENDING", retryAfterMs: 2000 },
      });
    expect(pending).toHaveLength(2);
    pending[0]!("/api/agent/sessions/s/artifacts/one");
    await Promise.resolve();
    await Promise.resolve();
    expect(pending).toHaveLength(3);
    expect(
      await files.handle({ action: "download", artifactId: one.id }),
    ).toMatchObject({
      ok: true,
      download: { path: "/api/agent/sessions/s/artifacts/one" },
    });
    files.setArtifactPublisher(
      async () => "/api/agent/sessions/new/artifacts/restored",
    );
    expect(
      await files.handle({ action: "download", artifactId: one.id }),
    ).toMatchObject({
      ok: true,
      download: { path: "/api/agent/sessions/new/artifacts/restored" },
    });
  });
  it("registers one whole-file transfer and retries failed publication without losing preview", async () => {
    const files = new SimulationFiles();
    const artifact = await files.put("out.raw", "text/plain", "data");
    let calls = 0;
    files.setArtifactPublisher(async (ref, text) => {
      expect(text).toBe("data");
      if (++calls === 1) throw new Error("offline");
      return `/api/agent/sessions/s/artifacts/${ref.fileId}`;
    });
    expect(
      await files.handle({ action: "download", artifactId: artifact.id }),
    ).toMatchObject({ ok: false, error: { recovery: "retry-after" } });
    expect(
      await files.handle({ action: "artifact", artifactId: artifact.id }),
    ).toMatchObject({ ok: true, text: "data" });
    for (let i = 0; i < 2; i++)
      expect(
        await files.handle({ action: "download", artifactId: artifact.id }),
      ).toMatchObject({
        ok: true,
        artifact,
        download: {
          path: `/api/agent/sessions/s/artifacts/${artifact.fileId}`,
        },
      });
    expect(calls).toBe(2);
    files.setArtifactPublisher(async () => {
      throw new ArtifactDownloadError(
        "ARTIFACT_TOO_LARGE",
        "not-retryable",
        "File exceeds transfer capacity",
      );
    });
    expect(
      await files.handle({ action: "download", artifactId: artifact.id }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "ARTIFACT_TOO_LARGE",
        stage: "export",
        recovery: "not-retryable",
      },
    });
  });
  it("uses the same owner-addressed listing and paged reading for session text", async () => {
    const files = new SimulationFiles();
    const created = await files.handle({ action: "create" });
    if (!created.ok || !("workspace" in created)) throw Error("create");
    const owner = {
      kind: "session-workspace",
      workspaceId: created.workspace.id,
    };
    await files.handle({
      action: "update",
      owner,
      expectedRevision: 0,
      entry: "run.cir",
      writes: [{ path: "run.cir", text: "op\r\n" }],
    });
    expect(await files.handle({ action: "list", owner })).toMatchObject({
      source: {
        revision: 1,
        files: [{ path: "run.cir", kind: "authored", byteLength: 4 }],
      },
    });
    expect(
      await files.handle({
        action: "read",
        owner,
        path: "run.cir",
        maxChars: 2,
      }),
    ).toMatchObject({
      owner,
      revision: 1,
      text: "op",
      textDigest: await sha256("op\r\n"),
      nextOffset: 2,
    });
    expect(await files.handle({ action: "discard", owner })).toEqual({
      ok: true,
      discarded: true,
    });
    expect(
      await files.handle({ action: "read", owner, path: "run.cir" }),
    ).toMatchObject({ ok: false, error: { code: "WORKSPACE_UNAVAILABLE" } });
  });
  it("shares atomic patching with source files and commits only one concurrent revision", async () => {
    const files = new SimulationFiles();
    const created = await files.handle({ action: "create" });
    if (!created.ok || !("workspace" in created)) throw Error("create failed");
    const workspaceId = created.workspace.id;
    const written = await files.handle({
      action: "update",
      owner: { kind: "session-workspace", workspaceId },
      expectedRevision: 0,
      entry: "run.cir",
      writes: [{ path: "run.cir", text: "op\n" }],
    });
    expect(written).toMatchObject({ ok: true, source: { revision: 1 } });
    const textDigest = await sha256("op\n");
    const patch = (text: string) =>
      files.handle({
        action: "update",
        owner: { kind: "session-workspace", workspaceId },
        expectedRevision: 1,
        patches: [
          { path: "run.cir", textDigest, startOffset: 0, endOffset: 2, text },
        ],
      });
    const results = await Promise.all([
      patch("ac dec 10 1 1e6"),
      patch("tran 1n 1u"),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({
      error: { code: "WORKSPACE_REVISION_CONFLICT" },
    });
    expect(
      await files.handle({
        action: "list",
        owner: { kind: "session-workspace", workspaceId },
      }),
    ).toMatchObject({
      ok: true,
      source: { revision: 2 },
    });
  });

  it("does not revive a discarded workspace after asynchronous patch hashing", async () => {
    const files = new SimulationFiles();
    const created = await files.handle({ action: "create" });
    if (!created.ok || !("workspace" in created)) throw Error("create failed");
    const workspaceId = created.workspace.id;
    await files.handle({
      action: "update",
      owner: { kind: "session-workspace", workspaceId },
      expectedRevision: 0,
      entry: "run.cir",
      writes: [{ path: "run.cir", text: "op" }],
    });
    const pending = files.handle({
      action: "update",
      owner: { kind: "session-workspace", workspaceId },
      expectedRevision: 1,
      patches: [
        {
          path: "run.cir",
          textDigest: await sha256("op"),
          startOffset: 0,
          endOffset: 2,
          text: "op\n",
        },
      ],
    });
    files.clear();
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_REVISION_CONFLICT" },
    });
    expect(await files.handle({ action: "list" })).toEqual({
      ok: true,
      workspaces: [],
    });
  });
  it("recovers draft identities after a lost create reply without leaking file bodies", async () => {
    const files = new SimulationFiles();
    const created = await files.handle({ action: "create" });
    if (!created.ok || !("workspace" in created)) throw Error("create failed");
    expect(await files.handle({ action: "list" })).toEqual({
      ok: true,
      workspaces: [
        {
          id: created.workspace.id,
          revision: 0,
          entry: null,
          expiresAt: created.workspace.expiresAt,
          configPath: "experiment.json",
        },
      ],
    });
    files.clear();
    expect(await files.handle({ action: "list" })).toEqual({
      ok: true,
      workspaces: [],
    });
  });
  it("cannot publish an in-flight artifact into a cleared session", async () => {
    const files = new SimulationFiles();
    const pending = files.put("old", "text/plain", "old content");
    files.clear();
    await expect(pending).rejects.toThrow("SESSION_CHANGED");
    const fresh = await files.put("new", "text/plain", "new");
    expect(
      await files.handle({ action: "artifact", artifactId: fresh.id }),
    ).toMatchObject({ ok: true, text: "new" });
  });
  it("pages immutable evidence without changing its full-file digest", async () => {
    const files = new SimulationFiles();
    const text = "数值🚀".repeat(40000),
      artifact = await files.put("raw.txt", "text/plain", text);
    let offset = 0,
      joined = "";
    for (;;) {
      const chunk = await files.handle({
        action: "artifact",
        artifactId: artifact.id,
        offset,
      });
      if (!chunk.ok || !("artifact" in chunk) || !("text" in chunk))
        throw Error(JSON.stringify(chunk));
      expect(chunk.text.length).toBeLessThanOrEqual(65536);
      expect(chunk.artifact.sha256).toBe(artifact.sha256);
      joined += chunk.text;
      if (chunk.nextOffset === null) break;
      offset = chunk.nextOffset;
    }
    expect(joined).toBe(text);
    expect(await sha256(joined)).toBe(artifact.sha256);
  });
  it("keeps immutable evidence for the owning host lifetime, not a short TTL", async () => {
    let now = 0;
    const files = new SimulationFiles(() => now);
    const a = await files.put("x", "text/plain", "x");
    now = 16 * 60000;
    expect(
      await files.handle({ action: "artifact", artifactId: a.id }),
    ).toMatchObject({ ok: true, text: "x" });
    files.clear();
    expect(
      await files.handle({ action: "artifact", artifactId: a.id }),
    ).toMatchObject({ ok: false, error: { code: "ARTIFACT_UNAVAILABLE" } });
  });
});
