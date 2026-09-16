import { validateNativeExecutionInput } from "@icm/simulation-service";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { isRunLocalPath } from "../simulation/run-local-files.mjs";
import { collectVacaskRawfiles } from "./rawfile-collector.mjs";
import { runVacaskProcess } from "./run-process.mjs";

const rejection = (code, message, recovery = "fix-input") => ({
  ok: false,
  error: { code, message, stage: "start", recovery },
});
const key = (path) =>
  process.platform === "win32" ? path.toLowerCase() : path;
const safePath = (path) =>
  isRunLocalPath(path) &&
  (process.platform !== "win32" ||
    path
      .split("/")
      .every(
        (part) =>
          !/[ .]$/u.test(part) &&
          !/[<>"|?*]/u.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      ));
const overlap = (a, b) =>
  a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

export function validVacaskLimits(limits) {
  return (
    !!limits &&
    [
      "maxInputBytes",
      "maxInputFiles",
      "maxOutputBytes",
      "maxRawFiles",
      "maxEntries",
      "maxLogBytes",
    ].every((name) => Number.isSafeInteger(limits[name]) && limits[name] > 0) &&
    limits.maxLogBytes >= 2 &&
    limits.maxLogBytes <= limits.maxOutputBytes
  );
}

/** Validate the existing ExecutionInput; no alternate deck/composition protocol.
 * Runtime dependencies/identity are operator-owned and must already be verified
 * before this function is exposed by a hosted endpoint. */
export function validateVacaskJob(input, runtime, limits) {
  if (!validVacaskLimits(limits))
    return rejection(
      "simulator-not-ready",
      "Invalid native execution limits.",
      "retry-after",
    );
  if (
    runtime.environment?.simulator?.name !== "vacask" ||
    ![
      runtime.runRoot,
      runtime.startupPath,
      runtime.binary,
      runtime.modules,
    ].every((path) => typeof path === "string" && isAbsolute(path))
  )
    return rejection(
      "simulator-not-ready",
      "The native runtime has not been configured.",
      "retry-after",
    );
  const checked = validateNativeExecutionInput(input, {
    profileId: runtime.environment.profileId,
    dependencies: runtime.dependencies ?? [],
    maxInputFiles: limits.maxInputFiles,
    maxInputBytes: limits.maxInputBytes,
  });
  if (!checked.ok) return checked;
  const paths = [
    ...input.files.map((f) => f.path),
    ...input.dependencies.map((d) => d.mountPath),
  ];
  // Native filesystem restrictions augment, never replace, portable admission.
  if (
    paths.some((path) => !safePath(path)) ||
    paths.some((path, i) =>
      paths.slice(i + 1).some((other) => overlap(key(path), key(other))),
    )
  )
    return rejection(
      "invalid-input-files",
      "Input paths collide or are invalid on this platform.",
    );
  const mounts = [];
  for (const dep of input.dependencies) {
    const found = (runtime.dependencies ?? []).find(
      (d) => d.id === dep.id && d.sha256 === dep.sha256,
    );
    if (!found || !isAbsolute(found.runtimePath ?? ""))
      return rejection(
        "simulation-dependency-unavailable",
        `Dependency ${dep.id} is not mounted on this runtime.`,
        "reprepare",
      );
    mounts.push({ mountPath: dep.mountPath, runtimePath: found.runtimePath });
  }
  return { ok: true, mounts };
}

/** Whole job owns one existing lease through staging, process, collection and
 * cleanup. No staging code belongs in a GUI/MCP-specific execution adapter.
 * Returns execution facts, not invented numerical success. The existing result
 * reader and metadata adapter remain responsible for the product result. */
export async function runVacaskJob(input, runtime, limits, supervisor) {
  const checked = validateVacaskJob(input, runtime, limits);
  if (!checked.ok) return checked;
  // Capture before the first await; a local caller cannot mutate admitted files.
  const snapshot = {
    entryPath: input.entryPath,
    timeoutMs: input.timeoutMs,
    runToken: input.runToken,
    files: input.files.map(({ path, text }) => ({ path, text })),
    dependencies: input.dependencies.map(({ mountPath }) => ({ mountPath })),
  };
  const admitted = await supervisor.tryExecute(
    { timeoutMs: snapshot.timeoutMs, token: snapshot.runToken },
    async (lease) => {
      let directory;
      try {
        directory = await mkdtemp(join(runtime.runRoot, "run-"));
        for (const file of snapshot.files) {
          await mkdir(dirname(join(directory, file.path)), { recursive: true });
          await writeFile(join(directory, file.path), file.text, {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          });
        }
        for (const mount of checked.mounts) {
          await mkdir(dirname(join(directory, mount.mountPath)), {
            recursive: true,
          });
          const info = await stat(mount.runtimePath);
          if (!info.isDirectory() && !info.isFile())
            throw new Error("Unsupported runtime dependency.");
          await symlink(
            mount.runtimePath,
            join(directory, mount.mountPath),
            info.isDirectory() ? "dir" : "file",
          );
        }
        const execution = await runVacaskProcess(
          runtime,
          directory,
          snapshot.entryPath,
          lease,
          limits.maxLogBytes,
        );
        lease.phase("collecting");
        const remainingBytes =
          limits.maxOutputBytes -
          Buffer.byteLength(execution.stdout) -
          Buffer.byteLength(execution.stderr);
        const collected =
          execution.spawnError ||
          (execution.cancelled && execution.durationMs === 0)
            ? { rawfiles: [], diagnostics: [], truncated: false }
            : remainingBytes <= 0
              ? {
                  rawfiles: [],
                  diagnostics: [
                    {
                      severity: "error",
                      text: "VACASK output budget exhausted by execution logs; raw data was not collected.",
                    },
                  ],
                  truncated: true,
                }
              : await collectVacaskRawfiles(directory, {
                  inputPaths: [
                    ...snapshot.files.map((file) => file.path),
                    ...snapshot.dependencies.map((dep) => dep.mountPath),
                  ],
                  maxBytes: remainingBytes,
                  maxFiles: limits.maxRawFiles,
                  maxEntries: limits.maxEntries,
                });
        return {
          ok: true,
          timeoutMs: lease.timeoutMs,
          execution,
          rawfiles: collected.rawfiles,
          executedFiles:
            execution.spawnError ||
            (execution.cancelled && execution.durationMs === 0)
              ? []
              : snapshot.files,
          diagnostics: collected.diagnostics,
          truncated: execution.truncated || collected.truncated,
        };
      } catch (error) {
        return rejection(
          "native-job-failed",
          `Native job failed (${typeof error?.code === "string" ? error.code : "execution"}).`,
          "retry-after",
        );
      } finally {
        lease.phase("cleaning");
        if (directory) {
          try {
            await rm(directory, { recursive: true, force: true });
          } catch {
            // Do not silently release a slot while its writable data remains.
            lease.failCleanup();
            throw new Error(
              "Native run cleanup failed; the executor was retired.",
            );
          }
        }
      }
    },
  );
  return admitted.kind === "busy"
    ? {
        ...rejection(
          "simulator-busy",
          "The simulator is occupied.",
          "retry-after",
        ),
        retryAfterSeconds: admitted.retryAfterSeconds,
      }
    : admitted.value;
}
