import { describe, it, expect } from "vitest";
import { SimulationFiles, sha256 } from "./files.js";
describe("simulation File Resource evidence", () => {
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
      if (!chunk.ok || !("artifact" in chunk))
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
  it("expiration reports unavailability rather than serving another artifact", async () => {
    let now = 0;
    const files = new SimulationFiles(() => now);
    const a = await files.put("x", "text/plain", "x");
    now = 16 * 60000;
    expect(
      await files.handle({ action: "artifact", artifactId: a.id }),
    ).toMatchObject({ ok: false, error: { code: "ARTIFACT_UNAVAILABLE" } });
  });
});
