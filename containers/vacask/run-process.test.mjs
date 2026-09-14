import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import {
  runVacaskProcess,
  vacaskRunCommand,
  vacaskRunEnvironment,
} from "./run-process.mjs";
import { SimulationRunSupervisor } from "../ngspice/run-supervisor.mjs";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
const runtime = {
  binary: resolve("runtime/vacask"),
  modules: resolve("runtime/modules"),
  startupPath: resolve("runtime/startup.toml"),
};
const cwd = resolve("private-run");
let child;
beforeEach(() => {
  vi.useFakeTimers();
  child = new EventEmitter();
  child.pid = 123;
  child.stdout = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  child.stderr = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  vi.mocked(spawn).mockReturnValue(child);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function execute(timeoutMs = 1_000) {
  const terminate = vi.fn();
  const supervisor = new SimulationRunSupervisor({
    terminate,
    failStop: vi.fn(),
  });
  const promise = supervisor.tryExecute(
    { timeoutMs, token: "owned" },
    async (lease) => {
      const result = await runVacaskProcess(runtime, cwd, "run.sim", lease, 10);
      lease.phase("collecting");
      lease.phase("cleaning");
      return result;
    },
  );
  return { supervisor, terminate, promise };
}

describe("native supervised process", () => {
  it("fixes native arguments and does not inherit host secrets or runtime overrides", () => {
    vi.stubEnv("SIMULATION_ACCESS_TOKEN", "secret");
    vi.stubEnv("PYTHONPATH", "host-python");
    vi.stubEnv("LD_LIBRARY_PATH", "host-libs");
    expect(vacaskRunCommand(runtime, "--help").args).toEqual([
      "--tomlfile",
      runtime.startupPath,
      "-n",
      "1",
      "-b",
      "1",
      "./--help",
    ]);
    for (const entry of [
      "../run.sim",
      "/run.sim",
      "C:/run.sim",
      "a\\b",
      "a\nb",
    ])
      expect(() => vacaskRunCommand(runtime, entry)).toThrow();
    const env = vacaskRunEnvironment(runtime, cwd);
    expect(env).toMatchObject({
      HOME: cwd,
      TMPDIR: cwd,
      SIM_MODULE_PATH: runtime.modules,
    });
    expect(env).not.toHaveProperty("SIMULATION_ACCESS_TOKEN");
    expect(env).not.toHaveProperty("PYTHONPATH");
    expect(env).not.toHaveProperty("LD_LIBRARY_PATH");
    expect(env.OMP_NUM_THREADS).toBe("1");
  });
  it("bounds separate logs, reaps the session and never calls signal death success", async () => {
    const run = execute();
    child.stdout.emit("data", Buffer.from("abcdefgh"));
    child.stderr.emit("data", Buffer.from("12345678"));
    child.emit("exit", null, "SIGKILL");
    child.emit("close");
    const result = (await run.promise).value;
    expect(result).toMatchObject({
      stdout: "abcde",
      stderr: "12345",
      truncated: true,
      exitCode: 128,
      signal: "SIGKILL",
    });
    expect(run.terminate).toHaveBeenCalledWith(child, "SIGKILL");
    expect(run.supervisor.snapshot()).toEqual({ state: "idle" });
  });
  it.each(["timeout", "cancel"])(
    "uses the existing %s lease transition and allows another run",
    async (reason) => {
      const run = execute(40);
      if (reason === "timeout") await vi.advanceTimersByTimeAsync(40);
      else {
        expect(run.supervisor.cancel("not-owned")).toBe(false);
        expect(run.supervisor.cancel("owned")).toBe(true);
      }
      expect(run.terminate).toHaveBeenCalledWith(child, "SIGKILL");
      child.emit("exit", null, "SIGKILL");
      child.emit("close");
      expect((await run.promise).value).toMatchObject({
        exitCode: null,
        timedOut: reason === "timeout",
        cancelled: reason === "cancel",
      });
      expect(
        (await run.supervisor.tryExecute({}, async () => "next")).value,
      ).toBe("next");
    },
  );
  it("settles an unavailable binary as failure and releases its lease", async () => {
    const run = execute();
    child.emit(
      "error",
      Object.assign(new Error("missing executable"), { code: "ENOENT" }),
    );
    expect((await run.promise).value).toMatchObject({
      exitCode: null,
      spawnError: { code: "ENOENT" },
    });
    expect(run.supervisor.snapshot()).toEqual({ state: "idle" });
  });
  it("does not wait forever for inherited pipes after the parent exit", async () => {
    const run = execute();
    child.emit("exit", 0, null);
    await vi.advanceTimersByTimeAsync(200);
    expect((await run.promise).value.exitCode).toBe(0);
    expect(child.stdout.destroy).toHaveBeenCalledOnce();
    expect(child.stderr.destroy).toHaveBeenCalledOnce();
  });
  it("does not spawn a process when already cancelled during preparation", async () => {
    const result = await runVacaskProcess(
      runtime,
      cwd,
      "run.sim",
      { cancelled: true },
      10,
    );
    expect(result).toMatchObject({
      cancelled: true,
      exitCode: null,
      durationMs: 0,
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")(
    "reaps real POSIX descendants before collection and reuses the slot after timeout",
    async () => {
      vi.useRealTimers();
      const actual = await vi.importActual("node:child_process");
      vi.mocked(spawn).mockImplementation(actual.spawn);
      const { mkdtemp, writeFile, access, rm } =
        await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const directory = await mkdtemp(join(tmpdir(), "icm-process-tree-"));
      const binary = join(directory, "fake-runtime");
      const supervisor = new SimulationRunSupervisor();
      const invoke = (timeoutMs) =>
        supervisor.tryExecute({ timeoutMs }, async (lease) => {
          const result = await runVacaskProcess(
            { ...runtime, binary },
            directory,
            "run.sim",
            lease,
            1024,
          );
          lease.phase("collecting");
          lease.phase("cleaning");
          return result;
        });
      try {
        await writeFile(
          binary,
          `#!${process.execPath}
const {spawn}=require('node:child_process');
spawn(process.execPath,['-e',"setTimeout(()=>require('node:fs').writeFileSync('leaked','yes'),600)"],{stdio:'inherit'});
console.log('started');
setTimeout(()=>process.exit(0),30);
`,
          { mode: 0o700 },
        );
        const completed = (await invoke(2000)).value;
        expect(completed.exitCode).toBe(0);
        expect(completed.stdout).toContain("started");
        await new Promise((resolve) => setTimeout(resolve, 800));
        await expect(access(join(directory, "leaked"))).rejects.toThrow();
        await writeFile(
          binary,
          `#!${process.execPath}\nsetTimeout(()=>require('node:fs').writeFileSync('late','yes'),600);\n`,
          { mode: 0o700 },
        );
        expect((await invoke(40)).value).toMatchObject({
          timedOut: true,
          exitCode: null,
        });
        await new Promise((resolve) => setTimeout(resolve, 800));
        await expect(access(join(directory, "late"))).rejects.toThrow();
        expect(supervisor.snapshot()).toEqual({ state: "idle" });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
