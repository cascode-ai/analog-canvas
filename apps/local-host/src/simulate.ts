/**
 * Simulation on the machine the circuit is already on.
 *
 * ADR 0055 commits to two surfaces behind one interface: a container in the
 * cloud, and this. They differ only in where ngspice lives — same deck, same
 * result shape, same refusal to invent a testbench. The privacy argument is
 * the reason this one exists: a circuit that may not be uploaded can still be
 * simulated by whoever holds it.
 *
 * The simulator is the user's own install, not one we ship. That is a feature:
 * their ngspice, their PDK, their version, and no upload.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import {
  buildSimulationDeck,
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
  deckRequestsRawfile,
  evaluateSimulationRun,
  resolveTimeoutMs,
  simulationConfigurationMetadata,
  type ModelLibrarySelection,
  type SimulationEnvironmentMetadata,
  type SimulationResult,
} from "@icm/spice-run";

export interface LocalSimulationOptions {
  /** The simulator binary; the user's own install by default. */
  ngspicePath?: string;
  /** Explicit model-library directive, path, and optional section. */
  modelLibrary?: ModelLibrarySelection | null;
}

/**
 * Why a local run could not even start. Distinct from a circuit that failed,
 * because "ngspice is not installed" is about the machine and a designer
 * should never read it as a statement about their design.
 */
export interface LocalSimulatorUnavailable {
  kind: "simulator-unavailable";
  message: string;
}

export type LocalSimulationOutcome =
  { kind: "ran"; result: SimulationResult } | LocalSimulatorUnavailable;

const LOCAL_RAWFILE_MAX_BYTES = 16 * 1024 * 1024;

function runProcess(
  binary: string,
  deckPath: string,
  workingDirectory: string,
  timeoutMs: number,
): Promise<{
  log: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  spawnError: Error | null;
}> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let timedOut = false;
    let spawnError: Error | null = null;
    const child = execFile(
      binary,
      ["-b", deckPath],
      {
        cwd: workingDirectory,
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        // ENOENT means no ngspice on this machine, which is a different
        // answer from any circuit outcome and is reported as one.
        if (
          error &&
          (error as NodeJS.ErrnoException).code === "ENOENT" &&
          !timedOut
        ) {
          spawnError = error;
        }
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          log: `${stdout ?? ""}${stderr ?? ""}`,
          exitCode: timedOut
            ? null
            : typeof error?.code === "number"
              ? error.code
              : error
                ? 1
                : 0,
          signal:
            timedOut || typeof error?.signal !== "string" ? null : error.signal,
          timedOut,
          durationMs: Date.now() - startedAt,
          spawnError,
        });
      },
    );
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("exit", () => clearTimeout(timer));
    child.on("error", () => clearTimeout(timer));
  });
}

async function readRunRawfile(directory: string): Promise<{
  rawfile: string | null;
  rawfileFormat: "ascii" | "binary" | null;
  rawfileTruncated: boolean;
}> {
  const candidates = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== "deck.cir")
    .map((entry) => entry.name)
    .sort();
  const name =
    candidates.find((candidate) => candidate.toLowerCase().endsWith(".raw")) ??
    candidates[0];
  if (!name) {
    return { rawfile: null, rawfileFormat: null, rawfileTruncated: false };
  }
  const path = join(directory, name);
  if ((await stat(path)).size > LOCAL_RAWFILE_MAX_BYTES) {
    return { rawfile: null, rawfileFormat: null, rawfileTruncated: true };
  }
  const content = await readFile(path);
  return content.includes(0)
    ? { rawfile: null, rawfileFormat: "binary", rawfileTruncated: false }
    : {
        rawfile: content.toString("utf8"),
        rawfileFormat: "ascii",
        rawfileTruncated: false,
      };
}

function probeVersion(binary: string): Promise<string> {
  return new Promise((resolveVersion) => {
    execFile(binary, ["--version"], (error, stdout, stderr) => {
      const output = error ? "" : `${stdout ?? ""}${stderr ?? ""}`;
      const match = output.match(/\bngspice[-\s]+([0-9][A-Za-z0-9.+-]*)/iu);
      resolveVersion(match ? `ngspice-${match[1]}` : "unreported");
    });
  });
}

async function hashReadableFile(path: string): Promise<string | null> {
  try {
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  } catch {
    return null;
  }
}

async function observeLocalEnvironment(
  binary: string,
  modelLibrary: ModelLibrarySelection | null,
): Promise<SimulationEnvironmentMetadata> {
  const binaryPath =
    isAbsolute(binary) || /[\\/]/u.test(binary) ? resolve(binary) : null;
  const [version, binarySha256, modelSha256] = await Promise.all([
    probeVersion(binary),
    binaryPath ? hashReadableFile(binaryPath) : Promise.resolve(null),
    modelLibrary ? hashReadableFile(modelLibrary.path) : Promise.resolve(null),
  ]);
  return createSimulationEnvironmentMetadata({
    executor: "local-host",
    reproducibility: "observed",
    profileId: null,
    platform: `${process.platform}/${process.arch}`,
    simulator: { name: "ngspice", version, binarySha256 },
    models:
      modelLibrary && modelSha256
        ? { id: "configured-model-library", contentSha256: modelSha256 }
        : null,
    startupSha256: null,
  });
}

export async function simulateLocally(
  request: {
    netlist: string;
    testbench: string;
    timeoutMs?: number;
    inputRevision?: string;
  },
  options: LocalSimulationOptions = {},
): Promise<LocalSimulationOutcome> {
  const binary = options.ngspicePath ?? process.env.NGSPICE_BIN ?? "ngspice";
  const timeoutMs = resolveTimeoutMs(request.timeoutMs);
  // ngspice runs inside the private per-run directory so authored output
  // cannot leak into the host's process cwd. Preserve the existing meaning of
  // a relative configured model path by resolving it before changing cwd.
  const modelLibrary = options.modelLibrary
    ? { ...options.modelLibrary, path: resolve(options.modelLibrary.path) }
    : null;
  const deck = buildSimulationDeck(request, modelLibrary);
  const [inputMetadata, environment] = await Promise.all([
    createSimulationInputMetadata({
      ...(request.inputRevision
        ? { inputRevision: request.inputRevision }
        : {}),
      netlist: request.netlist,
      testbench: request.testbench,
      deck,
    }),
    observeLocalEnvironment(binary, modelLibrary),
  ]);

  const directory = await mkdtemp(join(tmpdir(), "icm-local-sim-"));
  const deckPath = join(directory, "deck.cir");
  try {
    await writeFile(deckPath, deck, "utf8");
    const run = await runProcess(binary, deckPath, directory, timeoutMs);
    if (run.spawnError) {
      return {
        kind: "simulator-unavailable",
        message: `No simulator at "${binary}". Install ngspice, or set NGSPICE_BIN to its path.`,
      };
    }
    const rawfileExpected = deckRequestsRawfile(deck);
    const artifact = rawfileExpected
      ? await readRunRawfile(directory)
      : {
          rawfile: null,
          rawfileFormat: null,
          rawfileTruncated: false,
        };
    const evaluated = evaluateSimulationRun(
      { rawfile: rawfileExpected ? "required" : "not-required" },
      {
        log: run.log,
        stdout: run.stdout,
        stderr: run.stderr,
        exitCode: run.exitCode,
        signal: run.signal,
        timedOut: run.timedOut,
        durationMs: run.durationMs,
        rawfile: artifact.rawfile,
        rawfileFormat: artifact.rawfileFormat,
        rawfileTruncated: artifact.rawfileTruncated,
      },
      { timeoutMs },
    );
    return {
      kind: "ran",
      result: {
        outcome: evaluated.outcome,
        diagnostics: evaluated.diagnostics,
        log: run.log,
        ...(evaluated.data ? { data: evaluated.data } : {}),
        durationMs: run.durationMs,
        metadata: {
          schemaVersion: 1,
          input: inputMetadata,
          configuration: simulationConfigurationMetadata(modelLibrary),
          environment,
        },
      },
    };
  } finally {
    // The deck is the user's circuit; it does not outlive the run.
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
