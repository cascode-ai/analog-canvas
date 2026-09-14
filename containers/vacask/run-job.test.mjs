import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVacaskJob, validateVacaskJob } from "./run-job.mjs";
import { runVacaskProcess } from "./run-process.mjs";
import { SimulationRunSupervisor } from "../ngspice/run-supervisor.mjs";
vi.mock("./run-process.mjs", () => ({ runVacaskProcess: vi.fn() }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original();
  return { ...fs, rm: vi.fn(fs.rm) };
});
const actualFs = await vi.importActual("node:fs/promises");
const limits = {
  maxInputFiles: 8,
  maxInputBytes: 1024,
  maxOutputBytes: 1024,
  maxLogBytes: 64,
  maxRawFiles: 8,
  maxEntries: 64,
};
const hash = "a".repeat(64);
let root, runtime, input, supervisor, failStop;
const execution = () => ({
  stdout: "",
  stderr: "",
  exitCode: 0,
  signal: null,
  spawnError: null,
  cancelled: false,
  timedOut: false,
  truncated: false,
  durationMs: 1,
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "icm-native-job-"));
  runtime = {
    runRoot: root,
    binary: join(root, "vacask"),
    modules: root,
    startupPath: join(root, "startup.toml"),
    environment: { profileId: "local-proof", simulator: { name: "vacask" } },
  };
  input = {
    language: "vacask",
    mode: "raw",
    collection: { kind: "native-multi-ascii" },
    environment: { profileId: "local-proof" },
    netlist: "",
    testbench: "Title\ncontrol\nendc\n",
    preparedDeck: "Title\ncontrol\nendc\n",
    entryPath: "entry/run.sim",
    files: [{ path: "entry/run.sim", text: "Title\ncontrol\nendc\n" }],
    dependencies: [],
  };
  failStop = vi.fn();
  supervisor = new SimulationRunSupervisor({ failStop });
  vi.mocked(rm).mockImplementation(actualFs.rm);
  vi.mocked(runVacaskProcess).mockImplementation(
    async (_runtime, directory) => {
      await writeFile(join(directory, "result.raw"), "Title: proof\n");
      return execution();
    },
  );
});
afterEach(async () => {
  await actualFs.rm(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("native job ownership", () => {
  it.each([
    ["language", undefined, "native-input-required"],
    ["mode", "structured", "native-input-required"],
    ["preparedDeck", "different", "prepared-input-changed"],
    ["testbench", "different", "prepared-input-changed"],
    ["netlist", "another deck", "prepared-input-changed"],
    ["entryPath", "../outside", "invalid-input-files"],
    ["runToken", "bad-token", "invalid-run-token"],
  ])(
    "rejects invalid %s before staging or execution",
    async (field, value, code) => {
      input[field] = value;
      expect(
        await runVacaskJob(input, runtime, limits, supervisor),
      ).toMatchObject({ ok: false, error: { code } });
      expect(runVacaskProcess).not.toHaveBeenCalled();
      expect(await readdir(root)).toEqual([]);
    },
  );
  it("rejects duplicate and parent/child ownership for files and dependency mounts", () => {
    for (const path of ["entry/run.sim", "entry", "entry/run.sim/child"])
      expect(
        validateVacaskJob(
          { ...input, files: [...input.files, { path, text: "" }] },
          runtime,
          limits,
        ),
      ).toMatchObject({ ok: false, error: { code: "invalid-input-files" } });
    input.dependencies = [{ id: "models", sha256: hash, mountPath: "entry" }];
    expect(validateVacaskJob(input, runtime, limits)).toMatchObject({
      ok: false,
      error: { code: "invalid-input-files" },
    });
  });
  it("requires exact runtime Profile and dependency digest instead of trusting a caller path", () => {
    input.environment.profileId = "elsewhere";
    expect(validateVacaskJob(input, runtime, limits).error.recovery).toBe(
      "reprepare",
    );
    input.environment.profileId = "local-proof";
    input.dependencies = [{ id: "models", sha256: hash, mountPath: "models" }];
    runtime.dependencies = [
      { id: "models", sha256: "b".repeat(64), runtimePath: root },
    ];
    expect(validateVacaskJob(input, runtime, limits).error.code).toBe(
      "simulation-dependency-unavailable",
    );
    runtime.dependencies[0].sha256 = hash;
    expect(validateVacaskJob(input, runtime, limits)).toMatchObject({
      ok: true,
      mounts: [{ mountPath: "models", runtimePath: root }],
    });
  });
  it("enforces aggregate input bytes, file count and explicit output limits", () => {
    expect(
      validateVacaskJob(input, runtime, { ...limits, maxInputBytes: 1 }).error
        .code,
    ).toBe("input-too-large");
    expect(
      validateVacaskJob(input, runtime, { ...limits, maxOutputBytes: 1 }).error
        .code,
    ).toBe("simulator-not-ready");
    expect(
      validateVacaskJob(
        { ...input, files: [...input.files, { path: "extra", text: "" }] },
        runtime,
        { ...limits, maxInputFiles: 1 },
      ).error.code,
    ).toBe("invalid-input-files");
  });
  it("captures source before awaiting, excludes input artifacts, cleans before releasing", async () => {
    input.files.push({ path: "authored.raw", text: "not a result" });
    const expected = structuredClone(input.files);
    const resultPromise = runVacaskJob(input, runtime, limits, supervisor);
    input.files[0].text = "caller changed after admission";
    const result = await resultPromise;
    expect(result.ok).toBe(true);
    expect(result.executedFiles).toEqual(expected);
    expect(result.rawfiles).toEqual([
      { path: "result.raw", text: "Title: proof\n" },
    ]);
    expect(await readdir(root)).toEqual([]);
    expect(supervisor.snapshot()).toEqual({ state: "idle" });
  });
  it("preserves failed-process facts without pretending retained partial output is success", async () => {
    vi.mocked(runVacaskProcess).mockImplementation(
      async (_runtime, directory) => {
        await writeFile(join(directory, "partial.raw"), "partial");
        return { ...execution(), exitCode: 1, stderr: "analysis failed" };
      },
    );
    const result = await runVacaskJob(input, runtime, limits, supervisor);
    expect(result.execution.exitCode).toBe(1);
    expect(result.rawfiles[0].text).toBe("partial");
    expect(result).not.toHaveProperty("data");
    expect(await readdir(root)).toEqual([]);
  });
  it("shares the byte allowance between execution log and raw files", async () => {
    vi.mocked(runVacaskProcess).mockImplementation(
      async (_runtime, directory) => {
        await writeFile(join(directory, "out.raw"), "abcdefgh");
        return { ...execution(), stdout: "log!" };
      },
    );
    const result = await runVacaskJob(
      input,
      runtime,
      { ...limits, maxLogBytes: 4, maxOutputBytes: 10 },
      supervisor,
    );
    expect(result.truncated).toBe(true);
    expect(result.rawfiles[0].text).toBe("abcdef");
    expect(result.diagnostics).not.toHaveLength(0);
  });
  it("does not invent executed input after spawn failure and can retry a corrected job", async () => {
    vi.mocked(runVacaskProcess).mockResolvedValueOnce({
      ...execution(),
      exitCode: null,
      spawnError: { code: "ENOENT" },
    });
    const failed = await runVacaskJob(input, runtime, limits, supervisor);
    expect(failed.executedFiles).toEqual([]);
    expect(failed.rawfiles).toEqual([]);
    expect(
      (await runVacaskJob(input, runtime, limits, supervisor)).execution
        .exitCode,
    ).toBe(0);
    expect(await readdir(root)).toEqual([]);
  });
  it("does not stage a second concurrent job and keeps the existing lease through collection", async () => {
    let release;
    vi.mocked(runVacaskProcess).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(execution());
        }),
    );
    const first = runVacaskJob(input, runtime, limits, supervisor);
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(
      (await runVacaskJob(input, runtime, limits, supervisor)).error.code,
    ).toBe("simulator-busy");
    expect(await readdir(root)).toHaveLength(1);
    release();
    await first;
    expect(await readdir(root)).toEqual([]);
  });
  it("retires on cleanup failure instead of accepting another task over orphaned writable state", async () => {
    vi.mocked(rm).mockRejectedValueOnce(
      Object.assign(new Error("permission denied"), { code: "EACCES" }),
    );
    await expect(
      runVacaskJob(input, runtime, limits, supervisor),
    ).rejects.toThrow("cleanup failed");
    expect(failStop).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "run-cleanup-failed" }),
    );
    expect(supervisor.snapshot().state).toBe("fatal");
    expect(
      (await runVacaskJob(input, runtime, limits, supervisor)).error.code,
    ).toBe("simulator-busy");
  });
});
