import { describe, expect, it, vi } from "vitest";
import {
  SimulationFiles,
  sha256,
  SimulationFileResultSchema,
  type ProjectSimulationFileHost,
  type ProjectSourceSnapshot,
} from "./files.js";
import { ProblemSchema, problem } from "./contract.js";

const owner = { kind: "project-folder" as const, folderId: "folder-a" };
function fixture() {
  let time = 0;
  let snapshot: ProjectSourceSnapshot | undefined = {
    projectSessionId: "project-session",
    structureRevision: 7,
    folder: {
      id: owner.folderId,
      name: "AC",
      version: 4,
      input: {
        kind: "source",
        entry: "run.cir",
        configPath: "config.json",
        files: [
          { path: "run.cir", text: "* 🧪\r\n.control\r\nop\r\n.endc\r\n" },
          { path: "config.json", text: "{}" },
        ],
        circuitBindings: [
          {
            id: "dut",
            path: "dut.spice",
            documentId: "doc",
            emission: "subcircuit",
          },
        ],
        dependencies: [
          { id: "models", mountPath: "models.lib", sha256: "a".repeat(64) },
        ],
      },
    },
  };
  const commit = vi.fn<ProjectSimulationFileHost["commit"]>(
    (expected, folder) => {
      if (
        !snapshot ||
        expected.projectSessionId !== snapshot.projectSessionId ||
        expected.structureRevision !== snapshot.structureRevision
      )
        return problem("PROJECT_REVISION_CONFLICT", "Reread", "input");
      snapshot = {
        ...snapshot,
        structureRevision: snapshot.structureRevision + 1,
        folder,
      };
      return { ok: true, snapshot };
    },
  );
  const host: ProjectSimulationFileHost = {
    read: (id) => (id === owner.folderId ? snapshot : undefined),
    commit,
  };
  const files = new SimulationFiles(() => time, host);
  return {
    files,
    commit,
    get snapshot() {
      return snapshot!;
    },
    advance() {
      time += 1000 * 60 * 60;
    },
    replace() {
      snapshot = { ...snapshot!, projectSessionId: "replacement" };
    },
    remove() {
      snapshot = undefined;
    },
  };
}

describe("Project and session File Resource ownership", () => {
  it("saves unfinished buffers explicitly and clears them only when their file is applied", async () => {
    const f = fixture();
    const draft = {
      path: "run.cir",
      base: f.snapshot.folder.input.files[0]!.text,
      text: ".control\nac dec\n",
    };
    const saved = await f.files.handle({
      action: "update",
      owner,
      expectedRevision: 7,
      drafts: [draft],
    });
    expect(saved).toMatchObject({ ok: true, source: { drafts: [draft] } });
    expect(
      f.snapshot.folder.input.files.find((file) => file.path === draft.path)!
        .text,
    ).toBe(draft.base);
    const applied = await f.files.handle({
      action: "update",
      owner,
      expectedRevision: 8,
      writes: [{ path: draft.path, text: draft.text }],
    });
    expect(applied.ok).toBe(true);
    expect(f.snapshot.folder.input.drafts).toEqual([]);
    expect(
      f.snapshot.folder.input.files.find((file) => file.path === draft.path)!
        .text,
    ).toBe(draft.text);
  });
  it("lists ownership without file bodies and pages exact bytes/digests through the shared codec", async () => {
    const f = fixture();
    const listed = await f.files.handle({ action: "list", owner });
    expect(SimulationFileResultSchema.safeParse(listed).success).toBe(true);
    expect(listed).toMatchObject({
      source: {
        owner,
        revision: 7,
        entry: "run.cir",
        files: [
          { path: "run.cir", kind: "authored" },
          { path: "config.json", kind: "authored" },
          { path: "dut.spice", kind: "generated" },
          { path: "models.lib", kind: "dependency" },
        ],
      },
    });
    expect(JSON.stringify(listed)).not.toContain(".control");
    const original = f.snapshot.folder.input.files[0]!.text;
    let offset = 0,
      text = "";
    do {
      const reply = await f.files.handle({
        action: "read",
        owner,
        path: "run.cir",
        offset,
        maxChars: 3,
      });
      if (!reply.ok || !("textDigest" in reply))
        throw Error(JSON.stringify(reply));
      expect(reply.textDigest).toBe(await sha256(original));
      expect(SimulationFileResultSchema.safeParse(reply).success).toBe(true);
      text += reply.text;
      if (reply.nextOffset === null) break;
      offset = reply.nextOffset;
    } while (true);
    expect(text).toBe(original);
  });

  it("atomically renames and patches references with one host commit; incomplete syntax is saveable", async () => {
    const f = fixture(),
      original = f.snapshot.folder.input.files[0]!.text;
    const result = await f.files.handle({
      action: "update",
      owner,
      expectedRevision: 7,
      entry: "scripts/main.cir",
      removes: ["run.cir"],
      writes: [{ path: "scripts/main.cir", text: original }],
      patches: [
        {
          path: "config.json",
          textDigest: await sha256("{}"),
          startOffset: 1,
          endOffset: 2,
          text: "broken",
        },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      source: { revision: 8, entry: "scripts/main.cir" },
    });
    expect(f.commit).toHaveBeenCalledTimes(1);
    expect(f.snapshot.folder.input.files).toEqual([
      { path: "config.json", text: "{broken" },
      { path: "scripts/main.cir", text: original },
    ]);
    expect(
      await f.files.handle({
        action: "update",
        owner,
        expectedRevision: 8,
        removes: ["scripts/main.cir", "config.json"],
      }),
    ).toMatchObject({
      ok: true,
      source: {
        revision: 9,
        entry: "scripts/main.cir",
        configPath: "config.json",
      },
    });
  });

  it("does not expire or discard saved Project files with session drafts", async () => {
    const f = fixture();
    await f.files.handle({ action: "create" });
    const writes = Array.from({ length: 30 }, (_, i) => ({
      path: `parts/${i}.cir`,
      text: "* part",
    }));
    expect(
      await f.files.handle({
        action: "update",
        owner,
        expectedRevision: 7,
        writes,
      }),
    ).toMatchObject({ ok: true });
    f.advance();
    f.files.clear();
    expect(await f.files.handle({ action: "list" })).toEqual({
      ok: true,
      workspaces: [],
    });
    expect(await f.files.handle({ action: "list", owner })).toMatchObject({
      ok: true,
      source: { revision: 8 },
    });
    expect(f.snapshot.folder.input.files).toHaveLength(32);
    expect(await f.files.handle({ action: "discard", owner })).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_FILE_INVALID" },
    });
    expect(f.snapshot.folder.input.files).toHaveLength(32);
  });

  it("keeps generated/dependency ownership and rejects the complete mixed edit on stale text", async () => {
    const f = fixture();
    for (const path of ["dut.spice", "models.lib"])
      expect(
        await f.files.handle({
          action: "update",
          owner,
          expectedRevision: 7,
          writes: [{ path, text: "overwrite" }],
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "SIMULATION_GENERATED_FILE_READ_ONLY" },
      });
    expect(
      await f.files.handle({
        action: "update",
        owner,
        expectedRevision: 7,
        writes: [{ path: "new.cir", text: "ok" }],
        patches: [
          {
            path: "run.cir",
            textDigest: "0".repeat(64),
            startOffset: 0,
            endOffset: 0,
            text: "x",
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_TEXT_REVISION_CONFLICT" },
    });
    expect(f.commit).not.toHaveBeenCalled();
    expect(
      await f.files.handle({ action: "read", owner, path: "run.cir" }),
    ).toMatchObject({ ok: true });
  });

  it("returns the current structure revision and commits only one racing patch", async () => {
    const f = fixture();
    const textDigest = await sha256(f.snapshot.folder.input.files[0]!.text);
    const update = (text: string) =>
      f.files.handle({
        action: "update",
        owner,
        expectedRevision: 7,
        patches: [
          { path: "run.cir", textDigest, startOffset: 0, endOffset: 0, text },
        ],
      });
    const replies = await Promise.all([update("* a\n"), update("* b\n")]);
    expect(replies.filter((r) => r.ok)).toHaveLength(1);
    const failure = replies.find((r) => !r.ok)!;
    expect(failure).toMatchObject({
      error: { code: "PROJECT_REVISION_CONFLICT", currentRevision: 8 },
    });
    if (!failure.ok)
      expect(ProblemSchema.safeParse(failure.error).success).toBe(true);
    expect(f.commit).toHaveBeenCalledTimes(1);
  });

  it.each(["replace", "clear", "remove"] as const)(
    "does not publish an in-flight patch after %s",
    async (action) => {
      const f = fixture();
      const textDigest = await sha256(f.snapshot.folder.input.files[0]!.text);
      const pending = f.files.handle({
        action: "update",
        owner,
        expectedRevision: 7,
        patches: [
          {
            path: "run.cir",
            textDigest,
            startOffset: 0,
            endOffset: 0,
            text: "stale",
          },
        ],
      });
      if (action === "clear") f.files.clear();
      else f[action]();
      expect(await pending).toMatchObject({
        ok: false,
        error: { code: "PROJECT_REVISION_CONFLICT" },
      });
      expect(f.commit).not.toHaveBeenCalled();
    },
  );

  it("does not manufacture Project storage if the owner host is not attached", async () => {
    const files = new SimulationFiles();
    expect(
      await files.handle({ action: "update", owner, expectedRevision: 0 }),
    ).toMatchObject({
      ok: false,
      error: { code: "PROJECT_FILES_UNAVAILABLE", recovery: "retry-after" },
    });
    expect(await files.handle({ action: "create" })).toMatchObject({
      ok: true,
    });
  });
});
