import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { APP_ORIGIN } from "./app-protocol.js";
import { createProjectFileHandler } from "./project-files.js";
import { createProjectLibrary } from "./project-library.js";
import { createEmptyProject } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function setup(managed = false) {
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
    promptDirectory: vi.fn(async (): Promise<string | null> => null),
    confirm: vi.fn(async () => true),
    recoverCreation: vi.fn(
      async (
        _path: string,
        _canRetry: boolean,
      ): Promise<"retry" | "new" | "cancel"> => "retry",
    ),
    reveal: vi.fn(async (_path: string) => {}),
  };
  const index = join(root, "recent.json");
  const library = managed
    ? createProjectLibrary({
        stateDirectory: root,
        defaultRoot: join(root, "Projects"),
      })
    : undefined;
  const handler = createProjectFileHandler(dialogs, index, library);
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
      file: {
        id: string;
        revision: number;
        path: string;
        name: string;
        byteDigest: string;
      };
      files: { id: string; path: string }[];
      text: string;
      message: string;
      root: string;
      projects: {
        id: string;
        name: string;
        path: string;
        favorite: boolean;
        recycled: boolean;
        error?: string;
      }[];
      versions: { id: string; text: string }[];
      currentText: string;
    };
  };
  return { root, a, b, index, dialogs, handler, call, library };
}
const request = (text: string, binding: unknown = null, saveAs = false) => ({
  name: "A.icproj.json",
  text,
  binding,
  saveAs,
});
describe("native Project storage", () => {
  it("lets a failed Save As choose a new destination while preserving the first attempt", async () => {
    const { call, a, b, root, dialogs, library } = await setup(true);
    const source = serializeProject(createEmptyProject("source", "Source"));
    await writeFile(a, source);
    const opened = await call("open");
    const history = await library!.historyDirectory(b);
    await mkdir(dirname(history), { recursive: true });
    await writeFile(history, "history unavailable");
    dialogs.promptSave.mockResolvedValueOnce(b);
    const body = {
      ...request(source, opened.file, true),
      creationKey: "failed-save-as",
    };
    expect((await call("save", body)).status).toBe("failed");
    dialogs.recoverCreation.mockResolvedValueOnce("cancel");
    expect((await call("save", body)).status).toBe("cancelled");
    const c = join(root, "C.icproj.json");
    dialogs.recoverCreation.mockResolvedValueOnce("new");
    dialogs.promptSave.mockResolvedValueOnce(c);
    const changed = serializeProject(createEmptyProject("copy", "Newer edits"));
    const saved = await call("save", { ...body, text: changed });
    expect(saved.status).toBe("saved");
    expect(saved.file.path).toBe(c);
    expect(await readFile(c, "utf8")).toBe(changed);
    expect(await readFile(a, "utf8")).toBe(source);
    expect(await readFile(history, "utf8")).toBe("history unavailable");
  });
  it("refuses an external write after a retry receipt is checked", async () => {
    const { call, b, root, dialogs, library } = await setup(true);
    const saved = await call(
      "save",
      request(serializeProject(createEmptyProject("source", "Source"))),
    );
    const history = await library!.historyDirectory(b);
    await mkdir(dirname(history), { recursive: true });
    await writeFile(history, "history unavailable");
    dialogs.promptSave.mockResolvedValueOnce(b);
    const body = {
      ...request(
        serializeProject(createEmptyProject("copy", "Copy")),
        saved.file,
        true,
      ),
      creationKey: "racing-retry",
    };
    expect((await call("save", body)).status).toBe("failed");
    await rm(history);
    dialogs.recoverCreation.mockImplementationOnce(async () => {
      await writeFile(b, "concurrent external writer");
      return "retry";
    });
    expect((await call("save", body)).status).toBe("conflict");
    expect(await readFile(b, "utf8")).toBe("concurrent external writer");
    dialogs.recoverCreation.mockResolvedValueOnce("new");
    const c = join(root, "new-destination.icproj.json");
    dialogs.promptSave.mockResolvedValueOnce(c);
    expect((await call("save", body)).file.path).toBe(c);
    expect(dialogs.recoverCreation).toHaveBeenLastCalledWith(b, false);
    expect(await readFile(b, "utf8")).toBe("concurrent external writer");
  });
  it("reuses an external Save As destination after losing its committed receipt", async () => {
    const { call, a, b, index, dialogs, root } = await setup(true);
    const source = serializeProject(createEmptyProject("source", "Source"));
    await writeFile(a, source);
    const opened = await call("open");
    const copy = serializeProject(createEmptyProject("copy", "Copy"));
    dialogs.promptSave.mockResolvedValueOnce(b);
    const body = {
      ...request(copy, opened.file, true),
      creationKey: "external-copy",
    };
    const first = await call("save", body);
    expect(first.status).toBe("saved");
    const restarted = createProjectFileHandler(
      dialogs,
      index,
      createProjectLibrary({
        stateDirectory: root,
        defaultRoot: join(root, "Projects"),
      }),
    );
    const retry = async () =>
      (
        await restarted(
          new Request(`${APP_ORIGIN}/desktop/project/save`, {
            method: "POST",
            headers: { origin: APP_ORIGIN },
            body: JSON.stringify(body),
          }),
        )
      ).json();
    expect((await retry()).file.path).toBe(b);
    expect(dialogs.promptSave).toHaveBeenCalledTimes(1);
    expect(await readFile(a, "utf8")).toBe(source);
    await writeFile(b, "external change");
    expect((await retry()).status).toBe("failed");
    expect(await readFile(b, "utf8")).toBe("external change");
  });
  it("retries an interrupted keyed allocation without deleting its retained destination", async () => {
    const { call, library } = await setup(true);
    const text = serializeProject(createEmptyProject("draft", "Draft"));
    const creationKey = "interrupted-first-save";
    const path = await library!.allocate({
      key: creationKey,
      bytes: Buffer.from(text),
    });
    const history = await library!.historyDirectory(path);
    // A real filesystem obstruction makes journal preparation fail before commit.
    await mkdir(dirname(history), { recursive: true });
    await writeFile(history, "obstruction");
    const body = { ...request(text), creationKey };
    expect((await call("save", body)).status).toBe("failed");
    expect(
      await readFile(join(dirname(path), ".creation.json"), "utf8"),
    ).toContain(creationKey);
    await rm(history);
    expect((await call("save", body)).file.path).toBe(path);
    expect((await call("library")).projects).toHaveLength(1);
    expect(await readFile(path, "utf8")).toBe(text);
  });
  it("reconciles a committed first Save and library copy after their receipts are lost", async () => {
    const { call, root, index, dialogs } = await setup(true);
    const text = serializeProject(createEmptyProject("draft", "Draft"));
    const body = { ...request(text), creationKey: "working-copy:first-save" };
    const first = await call("save", body);
    const restarted = createProjectFileHandler(
      dialogs,
      index,
      createProjectLibrary({
        stateDirectory: root,
        defaultRoot: join(root, "Projects"),
      }),
    );
    const retry = async (route: string, data: unknown) =>
      (
        await restarted(
          new Request(`${APP_ORIGIN}/desktop/project/${route}`, {
            method: "POST",
            headers: { origin: APP_ORIGIN },
            body: JSON.stringify(data),
          }),
        )
      ).json();
    const replay = await retry("save", body);
    expect(replay.status).toBe("saved");
    expect(replay.file.path).toBe(first.file.path);
    expect((await call("library")).projects).toHaveLength(1);
    const entry = (await call("library")).projects[0]!;
    const copy = {
      id: entry.id,
      action: "duplicate",
      creationKey: "copy-click",
    };
    expect((await call("library-action", copy)).status).toBe("done");
    expect((await retry("library-action", copy)).status).toBe("done");
    expect((await call("library")).projects).toHaveLength(2);
    expect(
      (
        await retry("save", {
          ...body,
          text: serializeProject(createEmptyProject("other", "Unexpected")),
        })
      ).status,
    ).toBe("failed");
    expect(await readFile(first.file.path, "utf8")).toBe(text);
  });
  it("views and restores external-file history through recent IDs without granting external deletion", async () => {
    const { call, a } = await setup(true);
    const project = createEmptyProject("external", "Earlier", "top");
    const before = serializeProject(project);
    await writeFile(a, before);
    const opened = await call("open");
    project.name = "Current";
    const saved = await call(
      "save",
      request(serializeProject(project), opened.file),
    );
    const id = (await call("recent")).files[0]!.id;
    const history = await call("history", { id });
    expect(history.versions[0]?.text).toBe(before);
    const restore = {
      id,
      action: "restore-version",
      version: history.versions[0]!.id,
      expectedText: history.currentText,
    };
    expect((await call("library-action", restore)).status).toBe("conflict");
    await call("release", { id: saved.file.id });
    expect(
      (await call("library-action", { ...restore, expectedText: "stale" }))
        .status,
    ).toBe("conflict");
    expect(
      (await call("library-action", { ...restore, action: "branch-version" }))
        .status,
    ).toBe("done");
    const branch = (await call("library")).projects[0]!;
    expect(parseProject(await readFile(branch.path, "utf8")).id).not.toBe(
      project.id,
    );
    expect(await readFile(a, "utf8")).toBe(history.currentText);
    expect((await call("library-action", restore)).status).toBe("done");
    expect(await readFile(a, "utf8")).toBe(before);
    expect(
      (await call("library-action", { id, action: "delete" })).status,
    ).toBe("failed");
    expect(await readFile(a, "utf8")).toBe(before);
  });
  it("recovers an interrupted first library save and shows missing managed files as damaged", async () => {
    const { call } = await setup(true);
    const listing = await call("library");
    const directory = join(listing.root, randomUUID());
    await mkdir(join(directory, ".history"), { recursive: true });
    await writeFile(join(directory, ".pending-create"), "1");
    const after = randomUUID();
    const text = serializeProject(
      createEmptyProject("interrupted", "Recovered first save"),
    );
    await writeFile(join(directory, ".history", `${after}.icproj.json`), text);
    await writeFile(
      join(directory, ".history", "manifest.json"),
      JSON.stringify({
        version: 1,
        versions: [],
        pending: { before: null, after, versions: [] },
      }),
    );
    const recovered = await call("library");
    expect(recovered.projects[0]?.name).toBe("Recovered first save");
    expect(await readFile(join(directory, "project.icproj.json"), "utf8")).toBe(
      text,
    );
    await rm(join(directory, "project.icproj.json"));
    const missing = await call("library");
    expect(missing.projects[0]?.error).toMatch(/missing/i);
  });
  it("copies a remembered external file into the library and exports saved bytes without changing its write grant", async () => {
    const { call, a, library } = await setup(true);
    const text = serializeProject(
      createEmptyProject("external", "External original", "top"),
    );
    await writeFile(a, text);
    const opened = await call("open");
    const recentId = (await call("recent")).files[0]!.id;
    expect((await call("copy-to-library", { id: a })).status).toBe("failed");
    expect((await call("copy-to-library", { id: recentId })).status).toBe(
      "done",
    );
    const entry = (await library!.list()).projects[0]!;
    const copy = parseProject(await readFile(entry.path, "utf8"));
    expect(copy.id).not.toBe("external");
    expect(copy.documents).toEqual(parseProject(text).documents);
    expect((await call("saved-copy", { id: entry.id })).text).toBe(
      serializeProject(copy),
    );
    expect((await call("saved-copy", { id: recentId })).text).toBe(text);
    expect((await call("save", request(text, opened.file))).file).toMatchObject(
      { id: opened.file.id, path: a },
    );
    expect(await readFile(a, "utf8")).toBe(text);
  });
  it("recovers an interrupted history journal on either side of the atomic project replacement", async () => {
    for (const replaced of [false, true]) {
      const { call, dialogs, root, index } = await setup(true);
      const before = serializeProject(
        createEmptyProject("source", "Before", "top"),
      );
      const after = serializeProject(
        createEmptyProject("source", "After", "top"),
      );
      const saved = await call("save", request(before));
      const entry = (await call("library")).projects[0]!;
      const directory = join(dirname(saved.file.path), ".history");
      const beforeId = "11111111-1111-4111-8111-111111111111";
      const afterId = "22222222-2222-4222-8222-222222222222";
      await writeFile(join(directory, `${beforeId}.icproj.json`), before);
      await writeFile(join(directory, `${afterId}.icproj.json`), after);
      await writeFile(
        join(directory, "manifest.json"),
        JSON.stringify({
          version: 1,
          versions: [],
          pending: {
            before: beforeId,
            after: afterId,
            versions: [{ id: beforeId, savedAt: 1 }],
          },
        }),
      );
      if (replaced) await writeFile(saved.file.path, after);
      const restarted = createProjectFileHandler(
        dialogs,
        index,
        createProjectLibrary({
          stateDirectory: root,
          defaultRoot: join(root, "Projects"),
        }),
      );
      const result = await restarted(
        new Request(`${APP_ORIGIN}/desktop/project/history`, {
          method: "POST",
          headers: { origin: APP_ORIGIN },
          body: JSON.stringify({ id: entry.id }),
        }),
      );
      const history = await result.json();
      expect(history.status).toBe("listed");
      expect(history.currentText).toBe(replaced ? after : before);
      expect(
        history.versions.map((version: { text: string }) => version.text),
      ).toEqual(replaced ? [before] : []);
      expect(
        JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
      ).not.toHaveProperty("pending");
    }
  });
  it("keeps damaged project entries visible and can locate a recycled or external file without granting arbitrary paths", async () => {
    const { call, dialogs, root } = await setup(true);
    const text = serializeProject(
      createEmptyProject("source", "Recoverable", "top"),
    );
    const saved = await call("save", request(text));
    const entry = (await call("library")).projects[0]!;
    await call("release", { id: saved.file.id });
    await call("library-action", { id: entry.id, action: "delete" });
    const recycled = (await call("library")).projects[0]!;
    expect((await call("reveal", { id: recycled.id })).status).toBe("done");
    expect(dialogs.reveal).toHaveBeenLastCalledWith(recycled.path);
    await writeFile(
      recycled.path,
      JSON.stringify({ name: "Broken", documents: "invalid" }),
    );
    const damaged = (await call("library")).projects[0]!;
    expect(damaged.error).toBeTruthy();
    expect((await call("reveal", { id: damaged.id })).status).toBe("done");
    expect(
      (await call("reveal", { id: join(root, "unauthorized") })).status,
    ).toBe("failed");
  });
  it("reauthorizes exact saved bytes independently of recent shortcuts and their twenty-entry limit", async () => {
    const { call, dialogs, index, root } = await setup(true);
    const project = createEmptyProject("source", "Persisted", "top");
    const text = serializeProject(project);
    const saved = await call("save", request(text));
    await call("forget", { id: (await call("recent")).files[0]!.id });
    for (let i = 0; i < 21; i++) {
      const path = join(root, `recent-${i}.icproj.json`);
      await writeFile(path, text);
      dialogs.promptOpen.mockResolvedValue(path);
      await call("open");
    }
    expect((await call("recent")).files).toHaveLength(20);
    const restarted = createProjectFileHandler(
      dialogs,
      index,
      createProjectLibrary({
        stateDirectory: root,
        defaultRoot: join(root, "Projects"),
      }),
    );
    const resume = async (path: string) =>
      (
        await restarted(
          new Request(`${APP_ORIGIN}/desktop/project/resume`, {
            method: "POST",
            headers: { origin: APP_ORIGIN },
            body: JSON.stringify({ path, byteDigest: saved.file.byteDigest }),
          }),
        )
      ).json();
    const rebound = await resume(saved.file.path);
    expect(rebound.status).toBe("opened");
    expect(rebound.file.id).not.toBe(saved.file.id);
    expect((await resume(join(root, "unknown.icproj.json"))).status).toBe(
      "conflict",
    );
    await writeFile(saved.file.path, `${text}\n`);
    expect((await resume(saved.file.path)).status).toBe("conflict");
    await writeFile(
      saved.file.path,
      serializeProject({ ...project, name: "External edit" }),
    );
    expect((await resume(saved.file.path)).status).toBe("conflict");
  });
  it("retains an overwritten destination and its history in the recycle area without mixing project histories", async () => {
    const { call, dialogs, b } = await setup(true);
    const sourceText = serializeProject(
      createEmptyProject("source", "Source", "top"),
    );
    const source = await call("save", request(sourceText));
    const target = createEmptyProject("target", "Target earlier", "top");
    await writeFile(b, serializeProject(target));
    dialogs.promptOpen.mockResolvedValue(b);
    const opened = await call("open");
    target.name = "Target current";
    const current = await call(
      "save",
      request(serializeProject(target), opened.file),
    );
    await call("release", { id: current.file.id });
    dialogs.promptSave.mockResolvedValue(b);
    const copied = await call(
      "save",
      request(
        serializeProject(createEmptyProject("copy", "Copy", "top")),
        source.file,
        true,
      ),
    );
    expect(copied.status).toBe("saved");
    const backup = (await call("library")).projects.find((p) => p.recycled)!;
    expect(backup.name).toBe("Target current");
    await call("library-action", { id: backup.id, action: "restore" });
    const restored = (await call("library")).projects.find(
      (p) => p.name === "Target current",
    )!;
    const history = await call("history", { id: restored.id });
    expect(parseProject(history.versions[0]!.text).name).toBe("Target earlier");
    expect((await call("history", { id: copied.file.id })).versions).toEqual(
      [],
    );
    expect(await readFile(source.file.path, "utf8")).toBe(sourceText);
    expect(dialogs.confirm).toHaveBeenCalled();
  });
  it("Save As cannot replace its source and can explicitly create a fresh library destination", async () => {
    const { call, dialogs } = await setup(true);
    const original = serializeProject(
      createEmptyProject("original", "A", "top"),
    );
    const saved = await call("save", request(original));
    dialogs.promptSave.mockResolvedValue(saved.file.path);
    expect((await call("save", request("copy", saved.file, true))).status).toBe(
      "conflict",
    );
    const copy = await call("save", {
      ...request(
        serializeProject(createEmptyProject("copy", "B", "top")),
        saved.file,
        true,
      ),
      intoLibrary: true,
    });
    expect(copy.status).toBe("saved");
    expect(copy.file.path).not.toBe(saved.file.path);
    expect(await readFile(saved.file.path, "utf8")).toBe(original);
    expect((await call("library")).projects).toHaveLength(2);
  });
  it("restores history with conflict protection, preserves the replaced version, and refuses Save when history is damaged", async () => {
    const { call } = await setup(true);
    const project = createEmptyProject("source", "Earlier", "top");
    const first = await call("save", request(serializeProject(project)));
    project.name = "Current";
    const saved = await call(
      "save",
      request(serializeProject(project), first.file),
    );
    const entry = (await call("library")).projects[0]!;
    const history = await call("history", { id: entry.id });
    const body = {
      id: entry.id,
      action: "restore-version",
      version: history.versions[0]!.id,
      expectedText: history.currentText,
    };
    expect((await call("library-action", body)).status).toBe("conflict");
    await call("release", { id: saved.file.id });
    expect(
      (await call("library-action", { ...body, expectedText: "stale" })).status,
    ).toBe("conflict");
    expect((await call("library-action", body)).status).toBe("done");
    expect(parseProject(await readFile(entry.path, "utf8")).name).toBe(
      "Earlier",
    );
    expect(
      parseProject((await call("history", { id: entry.id })).versions[0]!.text)
        .name,
    ).toBe("Current");
    const reopened = await call("open", undefined, {
      "x-recent-project": entry.id,
    });
    await writeFile(
      join(dirname(entry.path), ".history", "manifest.json"),
      "corrupt",
    );
    const bytes = await readFile(entry.path, "utf8");
    expect(
      (await call("save", request("new content", reopened.file))).status,
    ).toBe("failed");
    expect(await readFile(entry.path, "utf8")).toBe(bytes);
  });
  it("manages independent saved copies, favorites, rename and recoverable deletion without editing an open file", async () => {
    const { call } = await setup(true);
    const project = createEmptyProject("source", "Original", "top");
    const saved = await call("save", request(serializeProject(project)));
    const entry = (await call("library")).projects[0]!;
    expect(
      (
        await call("library-action", {
          id: entry.id,
          action: "rename",
          name: "Unsafe",
        })
      ).status,
    ).toBe("conflict");
    await call("release", { id: saved.file.id });
    expect(
      (
        await call("library-action", {
          id: entry.id,
          action: "rename",
          name: "Renamed",
        })
      ).status,
    ).toBe("done");
    await call("library-action", {
      id: entry.id,
      action: "favorite",
      favorite: true,
    });
    await call("library-action", { id: entry.id, action: "duplicate" });
    let entries = (await call("library")).projects;
    expect(entries).toHaveLength(2);
    expect(entries.find((p) => p.id === entry.id)?.favorite).toBe(true);
    const duplicate = entries.find((p) => p.id !== entry.id)!;
    expect(parseProject(await readFile(duplicate.path, "utf8")).id).not.toBe(
      project.id,
    );
    expect(parseProject(await readFile(entry.path, "utf8")).id).toBe(
      project.id,
    );
    await call("library-action", { id: entry.id, action: "delete" });
    entries = (await call("library")).projects;
    const removed = entries.find((p) => p.recycled)!;
    expect(removed.name).toBe("Renamed");
    await call("library-action", { id: removed.id, action: "restore" });
    entries = (await call("library")).projects;
    expect(entries.every((p) => !p.recycled)).toBe(true);
    expect(parseProject(await readFile(entry.path, "utf8")).name).toBe(
      "Renamed",
    );
  });
  it("keeps the latest three earlier saves and does not rotate history for unchanged Save", async () => {
    const { call } = await setup(true);
    let saved = await call("save", request("version 1"));
    for (const text of [
      "version 2",
      "version 3",
      "version 4",
      "version 5",
      "version 5",
    ])
      saved = await call("save", request(text, saved.file));
    expect(saved.status).toBe("saved");
    const history = await call("history", { id: saved.file.id });
    expect(history.versions.map((v) => v.text)).toEqual([
      "version 4",
      "version 3",
      "version 2",
    ]);
  });
  it("saves a new project into its library without a dialog and finds it after restart", async () => {
    const { call, root, dialogs, index } = await setup(true);
    const text = serializeProject(
      createEmptyProject("project-a", "Amplifier", "top"),
    );
    const first = await call("save", request(text));
    expect(first.status).toBe("saved");
    expect(dialogs.promptSave).not.toHaveBeenCalled();
    expect(first.file.path.startsWith(join(root, "Projects"))).toBe(true);
    expect(await readFile(first.file.path, "utf8")).toBe(text);
    const next = createProjectFileHandler(
      dialogs,
      index,
      createProjectLibrary({
        stateDirectory: root,
        defaultRoot: join(root, "Projects"),
      }),
    );
    const response = await next(
      new Request(`${APP_ORIGIN}/desktop/project/library`, {
        method: "POST",
        headers: { origin: APP_ORIGIN },
      }),
    );
    const listed = await response.json();
    expect(listed.projects).toHaveLength(1);
    expect(listed.projects[0].name).toBe("Amplifier");
    const opened = await next(
      new Request(`${APP_ORIGIN}/desktop/project/open`, {
        method: "POST",
        headers: {
          origin: APP_ORIGIN,
          "x-recent-project": listed.projects[0].id,
        },
      }),
    );
    expect((await opened.json()).text).toBe(text);
  });
  it("keeps earlier libraries accessible and lets a user recover damaged settings by choosing a directory", async () => {
    const { call, root, dialogs, index } = await setup(true);
    await call(
      "save",
      request(serializeProject(createEmptyProject("a", "Earlier", "top"))),
    );
    const other = join(root, "Other");
    await mkdir(other);
    dialogs.promptDirectory.mockResolvedValue(other);
    expect((await call("library-directory")).root).toBe(other);
    const next = await call(
      "save",
      request(serializeProject(createEmptyProject("b", "Later", "top"))),
    );
    expect(next.file.path.startsWith(other)).toBe(true);
    expect((await call("library")).projects.map((p) => p.name).sort()).toEqual([
      "Earlier",
      "Later",
    ]);
    await writeFile(join(root, "project-library.json"), "damaged");
    const restarted = createProjectFileHandler(
      dialogs,
      index,
      createProjectLibrary({
        stateDirectory: root,
        defaultRoot: join(root, "Projects"),
      }),
    );
    const response = await restarted(
      new Request(`${APP_ORIGIN}/desktop/project/library-directory`, {
        method: "POST",
        headers: { origin: APP_ORIGIN },
      }),
    );
    const result = await response.json();
    expect(result.status).toBe("listed");
    expect(result.projects[0].name).toBe("Later");
    expect(
      await readFile(join(root, "project-library.json.damaged"), "utf8"),
    ).toBe("damaged");
  });
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
