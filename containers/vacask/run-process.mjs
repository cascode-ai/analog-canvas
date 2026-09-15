import { spawn } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { isRunLocalPath } from "../simulation/run-local-files.mjs";

/** Operator-owned runtime configuration, never arguments supplied by a deck.
 * File staging, environment qualification and OS resource isolation belong to
 * the enclosing executor. This module owns only one supervised native process. */
export function vacaskRunCommand({ binary, startupPath }, entryPath) {
  if (
    !isAbsolute(binary) ||
    !isAbsolute(startupPath) ||
    !isRunLocalPath(entryPath)
  )
    throw new Error("Invalid native runtime or entry path.");
  return {
    command: binary,
    args: ["--tomlfile", startupPath, "-n", "1", "-b", "1", `./${entryPath}`],
  };
}

export function vacaskRunEnvironment(runtime, directory) {
  if (!isAbsolute(directory) || !isAbsolute(runtime.modules))
    throw new Error(
      "Native working directory and module root must be absolute.",
    );
  return {
    PATH:
      process.platform === "win32"
        ? join(process.env.SystemRoot ?? "C:\\Windows", "System32")
        : "/usr/local/bin:/usr/bin:/bin",
    ...(process.platform === "win32"
      ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" }
      : {}),
    HOME: directory,
    TMPDIR: directory,
    TMP: directory,
    TEMP: directory,
    LANG: "C",
    LC_ALL: "C",
    TERM: "dumb",
    SIM_MODULE_PATH: runtime.modules,
    OMP_NUM_THREADS: "1",
    OPENBLAS_NUM_THREADS: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    // A controlled deployment may need an explicit dynamic-library root.
    // Never inherit LD_LIBRARY_PATH, PYTHONPATH, tokens or the host HOME.
    ...(runtime.libraryPath ? { LD_LIBRARY_PATH: runtime.libraryPath } : {}),
  };
}

function cappedSink(maxBytes) {
  const chunks = [];
  let bytes = 0,
    truncated = false;
  return {
    write(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const available = maxBytes - bytes;
      if (buffer.length > available) truncated = true;
      if (available > 0) {
        const retained = buffer.subarray(0, available);
        chunks.push(retained);
        bytes += retained.length;
      }
    },
    text: () => Buffer.concat(chunks, bytes).toString("utf8"),
    get truncated() {
      return truncated;
    },
  };
}

/** Use the existing run lease: admission, cancellation, process deadline and
 * fail-stop watchdog stay in SimulationRunSupervisor, not a second state machine.
 * Collection is permitted only after this resolves. POSIX detached sessions let
 * the supervisor reap descendants; Windows local descendants still require an
 * enclosing Job Object before this can be advertised as a hostile-code sandbox. */
export async function runVacaskProcess(
  runtime,
  directory,
  entryPath,
  run,
  maxLogBytes,
) {
  if (!Number.isSafeInteger(maxLogBytes) || maxLogBytes < 2)
    throw new Error("Native log limit must be at least two bytes.");
  const { command, args } = vacaskRunCommand(runtime, entryPath);
  const env = vacaskRunEnvironment(runtime, directory);
  if (run.cancelled)
    return {
      stdout: "",
      stderr: "",
      truncated: false,
      exitCode: null,
      signal: null,
      timedOut: false,
      cancelled: true,
      spawnError: null,
      durationMs: 0,
    };
  return new Promise((resolve) => {
    const started = Date.now();
    const stdout = cappedSink(Math.ceil(maxLogBytes / 2));
    const stderr = cappedSink(Math.floor(maxLogBytes / 2));
    let exited,
      spawnError = null,
      graceTimer,
      settled = false;
    const child = spawn(command, args, {
      cwd: directory,
      env,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(graceTimer);
      run.detachProcess(child);
      resolve({
        stdout: stdout.text(),
        stderr: stderr.text(),
        truncated: stdout.truncated || stderr.truncated,
        exitCode:
          run.timedOut || run.cancelled || spawnError
            ? null
            : typeof exited?.code === "number"
              ? exited.code
              : 128,
        signal: exited?.signal ?? null,
        timedOut: run.timedOut,
        cancelled: run.cancelled,
        spawnError,
        durationMs: Date.now() - started,
      });
    };
    child.stdout?.on("data", (chunk) => stdout.write(chunk));
    child.stderr?.on("data", (chunk) => stderr.write(chunk));
    child.stdout?.on("error", () => {});
    child.stderr?.on("error", () => {});
    child.on("exit", (code, signal) => {
      exited = { code, signal };
      run.terminateAttachedProcess();
      // Descendants can keep inherited pipes open after the parent exits.
      graceTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        settle();
      }, 200);
    });
    child.on("close", settle);
    child.on("error", (error) => {
      spawnError = {
        code: error.code ?? "SPAWN_FAILED",
        message: error.message,
      };
      settle();
    });
    run.attachProcess(child);
  });
}
