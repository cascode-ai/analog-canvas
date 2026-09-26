import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { APP_ORIGIN } from "./app-protocol.js";
import { createProjectFileHandler } from "./project-files.js";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function setup() {
  // Saved paths are canonical; on macOS the temporary directory sits behind
  // the /var → /private/var link, so compare against its canonical form.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "analog-native-files-")),
  );
  directories.push(root);
  const a = join(root, "A.icproj.json"),
    b = join(root, "B.icproj.json");
  const dialogs = {
    promptOpen: vi.fn(async (): Promise<string | null> => a),
    promptSave: vi.fn(async (): Promise<string | null> => a),
  };
  const index = join(root, "recent.json");
  const handler = createProjectFileHandler(dialogs, index);
  const call = async (
    route: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await handler(
      new Request(`${APP_ORIGIN}/desktop/project/${route}`, {
        method: "POST",
        headers: { origin: APP_ORIGIN, ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return (await response.json()) as {
      status: string;
      file: { id: string; revision: number; path: string; name: string };
      files: { id: string; path: string }[];
      text: string;
      message: string;
    };
  };
  return { root, a, b, index, dialogs, handler, call };
}
const request = (text: string, binding: unknown = null, saveAs = false) => ({
  name: "A.icproj.json",
  text,
  binding,
  saveAs,
});
describe("native Project storage", () => {
  it("binds first Save and updates the same file without another dialog", async () => {
    const { call, a, dialogs } = await setup();
    const first = await call("save", request("first"));
    expect(first.status).toBe("saved");
    const next = await call("save", request("second", first.file));
    expect(next.file.id).toBe(first.file.id);
    expect(next.file.revision).toBe(2);
    expect(await readFile(a, "utf8")).toBe("second");
    expect(dialogs.promptSave).toHaveBeenCalledTimes(1);
  });
  it("keeps the original binding on cancel and switches only after successful Save As", async () => {
    const { call, a, b, dialogs } = await setup();
    const first = await call("save", request("original"));
    dialogs.promptSave.mockResolvedValueOnce(null);
    expect(
      (await call("save", request("cancelled", first.file, true))).status,
    ).toBe("cancelled");
    expect((await call("save", request("still A", first.file))).status).toBe(
      "saved",
    );
    const current = await call("open");
    dialogs.promptSave.mockResolvedValueOnce(b);
    const copy = await call("save", request("new B", current.file, true));
    expect(copy.file.path).toBe(b);
    expect(await readFile(a, "utf8")).toBe("still A");
    expect(await readFile(b, "utf8")).toBe("new B");
  });
  it("rejects arbitrary paths, expired receipts and stale revisions but allows a new Save As", async () => {
    const { call, b, dialogs } = await setup();
    const saved = await call("save", request("one"));
    await call("save", request("two", saved.file));
    expect((await call("save", request("stale", saved.file))).status).toBe(
      "conflict",
    );
    expect(
      (await call("save", request("unauthorized", { id: b, revision: 1 })))
        .status,
    ).toBe("conflict");
    dialogs.promptSave.mockResolvedValueOnce(b);
    expect(
      (
        await call(
          "save",
          request("recovered", { id: "expired", revision: 1 }, true),
        )
      ).status,
    ).toBe("saved");
    expect(await readFile(b, "utf8")).toBe("recovered");
  });
  it("protects externally changed/deleted files and leaves no temporary file", async () => {
    const { call, a, root } = await setup();
    const saved = await call("save", request("initial"));
    await writeFile(a, "external");
    expect((await call("save", request("my edits", saved.file))).status).toBe(
      "conflict",
    );
    expect(await readFile(a, "utf8")).toBe("external");
    await rm(a);
    expect((await call("save", request("my edits", saved.file))).status).toBe(
      "conflict",
    );
    expect((await readdir(root)).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
  });
  it("reopens the latest disk version after release, without restarting", async () => {
    const { call, a } = await setup();
    const saved = await call("save", request("initial"));
    await writeFile(a, "external");
    expect((await call("open")).file).toEqual(saved.file);
    await call("release", { id: saved.file.id });
    const fresh = await call("open");
    expect(fresh.text).toBe("external");
    expect(fresh.file.id).not.toBe(saved.file.id);
  });
  it("remembers paths across launches and removing a recent entry never deletes the file", async () => {
    const { call, a, index, dialogs } = await setup();
    await call("save", request("persisted"));
    const listed = await call("recent");
    const next = createProjectFileHandler(dialogs, index);
    const response = await next(
      new Request(`${APP_ORIGIN}/desktop/project/open`, {
        method: "POST",
        headers: {
          origin: APP_ORIGIN,
          "x-recent-project": listed.files[0]!.id,
        },
      }),
    );
    expect((await response.json()).text).toBe("persisted");
    expect(dialogs.promptOpen).not.toHaveBeenCalled();
    await call("forget", { id: listed.files[0]!.id });
    expect((await call("recent")).files).toEqual([]);
    expect(await readFile(a, "utf8")).toBe("persisted");
  });
  it("refuses overwrite of another open Project and preserves the prior destination on write failure", async () => {
    const { call, a, b, root, dialogs } = await setup();
    const first = await call("save", request("A"));
    dialogs.promptSave.mockResolvedValueOnce(b);
    const second = await call("save", request("B"));
    dialogs.promptSave.mockResolvedValueOnce(a);
    expect(
      (await call("save", request("wrong", second.file, true))).status,
    ).toBe("conflict");
    dialogs.promptSave.mockResolvedValueOnce(
      join(root, "missing", "fail.json"),
    );
    expect(
      (await call("save", request("failure", first.file, true))).status,
    ).toBe("failed");
    expect(await readFile(a, "utf8")).toBe("A");
    expect(await readFile(b, "utf8")).toBe("B");
  });
  it("rejects wrong-origin requests before dialogs or filesystem access", async () => {
    const { handler, dialogs } = await setup();
    const response = await handler(
      new Request(`${APP_ORIGIN}/desktop/project/open`, {
        method: "POST",
        headers: { origin: "https://outside.test" },
      }),
    );
    expect(response.status).toBe(403);
    expect(dialogs.promptOpen).not.toHaveBeenCalled();
  });
});
