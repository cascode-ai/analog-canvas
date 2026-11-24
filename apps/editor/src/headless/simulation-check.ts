/**
 * The Gallery's simulation check (#1545), run on this machine: each folder
 * of a circuit's testbench prepared as the Simulation panel prepares it, run
 * by the local ngspice, and judged by the hosted check's own rule. The run
 * goes through the Worker's ngspice route in-process, with this module's
 * runner standing where the hosted container stands, so the deck, the model
 * library load and the result are composed by the same code; only the
 * simulator and its model files are this machine's. Two Profiles run here:
 * the hosted SKY130 one, and the hosted SG13G2 one, whose startup file loads
 * the IHP models' OSDI modules from where this machine keeps them.
 */
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  readSimulationExperimentConfig,
  type CircuitProject,
} from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import {
  ExecutionFailure,
  createHostedExecutor,
  judgeSimulationCheckFolder,
  prepareFolderExecutionInput,
  sha256,
  simulationCheckFolderFailure,
  simulationCheckVerdict,
  type ExecutionInput,
  type Problem,
  type SimulationCheck,
  type SimulationCheckFolder,
} from "@icm/simulation-service";
import {
  NGSPICE_MAX_LOG_BYTES,
  createSimulationEnvironmentMetadata,
  deckRequestsRawfile,
  type SimulationEnvironmentMetadata,
} from "@icm/spice-run";
import hostedProfile from "../../../../containers/ngspice/hosted-sky130-profile.json" with { type: "json" };
import sg13g2Profile from "../../../../containers/ngspice/sg13g2/profile.json" with { type: "json" };
import {
  routeNgspiceSimulationRequest,
  type NgspiceProfile,
  type NgspiceRunner,
} from "../../../../worker/simulation-ngspice";

/** The ngspice this machine runs, and the files its Profile's libraries are. */
export interface LocalSimulator {
  /** The ngspice binary: a path, or a name looked up on PATH. */
  ngspice: string;
  /**
   * A SPICE library file for each Profile dependency a run mounts, by its
   * id: the models (`sky130A-continuous`; SG13G2's `sg13g2.lib.spice`, in
   * the directory that holds its `models` and `osdi` as the image's
   * /opt/sg13g2 does), a standard-cell library.
   */
  libraries: Readonly<Record<string, string>>;
  /** One run's deadline; 120 s, the hosted ceiling, when left out. */
  timeoutMs?: number;
}

/** The hosted SKY130 ngspice Profile, which a local check runs. */
export const LOCAL_SIMULATION_PROFILE_ID = hostedProfile.id;
/** The dependency id of that Profile's model library. */
export const LOCAL_SIMULATION_MODELS_ID = hostedProfile.models.id;
/** The hosted SG13G2 ngspice Profile, which a local check also runs. */
export const LOCAL_SG13G2_PROFILE_ID = sg13g2Profile.id;
/** The dependency id of that Profile's model library. */
export const LOCAL_SG13G2_MODELS_ID = sg13g2Profile.models.id;

/**
 * The startup file of the hosted SG13G2 image
 * (containers/ngspice/sg13g2/hosted.spiceinit) with its model root, the
 * image's /opt/sg13g2, at `root`: the corner libraries' source path and the
 * IHP Verilog-A models compiled to OSDI.
 */
export function sg13g2Startup(root: string): string {
  return [
    "set filetype=ascii",
    `set sourcepath = ( ${root}/models )`,
    ...["psp103", "psp103_nqs", "r3_cmc"].map(
      (module) => `osdi ${root}/osdi/${module}.osdi`,
    ),
    "",
  ].join("\n");
}

interface LocalProfile {
  profile: NgspiceProfile;
  /** The run's startup file from this machine's libraries; null: it has none. */
  startup(libraries: LocalSimulator["libraries"]): string | null;
}

/** The Profiles a local check runs, each with how its startup file is made here. */
const LOCAL_PROFILES: readonly LocalProfile[] = [
  // The hosted harness's startup file (containers/ngspice/hosted.spiceinit).
  { profile: hostedProfile, startup: () => "set filetype=ascii\n" },
  {
    profile: sg13g2Profile,
    startup: (libraries) => {
      const models = libraries[sg13g2Profile.models.id];
      return models ? sg13g2Startup(dirname(models)) : null;
    },
  },
];

/** A circuit's verdict, or why this machine cannot give one. */
export type LocalSimulationCheck =
  | { kind: "verdict"; check: SimulationCheck }
  | { kind: "cannot-run"; folder: string; code: string; message: string };

const DEFAULT_TIMEOUT_MS = 120_000;

function sha256Bytes(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function ngspiceVersion(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(binary, ["--version"], { timeout: 10_000 }, (error, out, err) => {
      const match = `${out}${err}`.match(
        /\bngspice[-\s]+([0-9][A-Za-z0-9.+-]*)/iu,
      );
      resolve(error || !match ? null : `ngspice-${match[1]}`);
    });
  });
}

/** The executable a binary's path or PATH name means, or null. */
async function resolveBinary(binary: string): Promise<string | null> {
  const candidates = binary.includes("/")
    ? [binary]
    : (process.env.PATH ?? "")
        .split(":")
        .filter(Boolean)
        .map((directory) => join(directory, binary));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

/**
 * This machine's simulator, and how a run reports it: `local-host`,
 * observed rather than pinned, the binary and the model file by their own
 * digests. Null when ngspice does not answer.
 */
async function localSimulatorFacts(
  simulator: LocalSimulator,
  profile: NgspiceProfile,
): Promise<{
  binary: string;
  environment: SimulationEnvironmentMetadata;
} | null> {
  const binary = await resolveBinary(simulator.ngspice);
  const version = binary ? await ngspiceVersion(binary) : null;
  if (!binary || !version) return null;
  const models = simulator.libraries[profile.models.id];
  const environment = await createSimulationEnvironmentMetadata({
    executor: "local-host",
    reproducibility: "observed",
    profileId: profile.id,
    platform: `${process.platform}/${process.arch}`,
    simulator: {
      name: "ngspice",
      version,
      binarySha256: sha256Bytes(await readFile(binary)),
    },
    models: models
      ? {
          id: profile.models.id,
          contentSha256: sha256Bytes(await readFile(models)),
        }
      : null,
    startupSha256: null,
  });
  return { binary, environment };
}

interface RunBody {
  deck: string;
  files?: { path: string; text: string }[];
  dependencies?: { id: string; mountPath: string }[];
  entryPath?: string;
  collection?: { rawfile: string | null };
  timeoutMs?: number;
}

/** Text a stream gave, kept to `limit` bytes. */
function capped(limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  return {
    write(chunk: Buffer) {
      const room = limit - size;
      if (chunk.length > room) truncated = true;
      if (room <= 0) return;
      chunks.push(chunk.subarray(0, room));
      size += Math.min(chunk.length, room);
    },
    text: () => Buffer.concat(chunks).toString("utf8"),
    get truncated() {
      return truncated;
    },
  };
}

/** ngspice in batch mode over one deck, in its own directory and session. */
function runNgspice(
  binary: string,
  directory: string,
  entryPath: string,
  timeoutMs: number,
) {
  return new Promise<{
    stdout: string;
    stderr: string;
    truncated: boolean;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    durationMs: number;
  }>((resolve) => {
    const startedAt = Date.now();
    const stdout = capped(Math.ceil(NGSPICE_MAX_LOG_BYTES / 2));
    const stderr = capped(Math.floor(NGSPICE_MAX_LOG_BYTES / 2));
    const child = spawn(binary, ["-b", `./${entryPath}`], {
      cwd: directory,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: directory,
        TMPDIR: directory,
        LANG: "C",
        LC_ALL: "C",
        TERM: "dumb",
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.write(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.write(chunk));
    let settled = false;
    const settle = (code: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: stdout.text(),
        stderr: stderr.text(),
        truncated: stdout.truncated || stderr.truncated,
        exitCode: timedOut ? null : (code ?? (signal ? 128 : 1)),
        signal: timedOut ? null : signal,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    };
    child.on("close", settle);
    child.on("error", () => settle(null, null));
  });
}

/**
 * The hosted container's `/health` and `/run`, answered by this machine: a
 * run writes its files, links each dependency to the library file standing
 * for it here, and runs the deck as the harness does.
 */
function localRunner(
  simulator: LocalSimulator,
  { profile, startup }: LocalProfile,
  {
    binary,
    environment,
  }: NonNullable<Awaited<ReturnType<typeof localSimulatorFacts>>>,
): NgspiceRunner {
  const refuse = (error: string, message: string) =>
    Response.json({ error, message }, { status: 400 });
  return {
    async fetch(input, init) {
      const path = new URL(input).pathname;
      if (path === "/health")
        return Response.json({
          status: "ready",
          environment,
          // What a run may mount: the Profile's libraries this machine has.
          dependencies: [profile.models, ...profile.cellLibraries]
            .filter((library) => simulator.libraries[library.id])
            .map((library) => ({
              id: library.id,
              sha256: library.contentSha256,
            })),
        });
      if (path === "/cancel") return Response.json({ accepted: true });
      if (path !== "/run") return Response.json({}, { status: 404 });
      const body = JSON.parse(String(init?.body)) as RunBody;
      const entryPath = body.entryPath ?? "deck.cir";
      for (const dependency of body.dependencies ?? [])
        if (!simulator.libraries[dependency.id])
          return refuse(
            "simulation-dependency-unavailable",
            `This machine has no library for ${dependency.id}; name its file with --library ${dependency.id}=<file>.`,
          );
      const startupFile = startup(simulator.libraries);
      if (startupFile === null)
        return refuse(
          "simulation-dependency-unavailable",
          `A run under ${profile.id} loads its startup from the model library; this machine has none for ${profile.models.id}.`,
        );
      const directory = await mkdtemp(join(tmpdir(), "gallery-sim-check-"));
      try {
        for (const file of body.files ?? []) {
          await mkdir(dirname(join(directory, file.path)), { recursive: true });
          await writeFile(join(directory, file.path), file.text, "utf8");
        }
        for (const dependency of body.dependencies ?? []) {
          await mkdir(dirname(join(directory, dependency.mountPath)), {
            recursive: true,
          });
          await symlink(
            simulator.libraries[dependency.id]!,
            join(directory, dependency.mountPath),
          );
        }
        await mkdir(dirname(join(directory, entryPath)), { recursive: true });
        await writeFile(join(directory, entryPath), body.deck, "utf8");
        await writeFile(join(directory, ".spiceinit"), startupFile, "utf8");
        const run = await runNgspice(
          binary,
          directory,
          entryPath,
          // The route clamps it to the hosted ceiling, as it does for the
          // container.
          body.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        );
        return Response.json({
          log: `${run.stdout}${run.stderr}`,
          stdout: run.stdout,
          stderr: run.stderr,
          exitCode: run.exitCode,
          signal: run.signal,
          timedOut: run.timedOut,
          cancelled: false,
          durationMs: run.durationMs,
          // A check reads its Specs from the log; no waveform file is read.
          rawfileRequested:
            body.collection === undefined
              ? deckRequestsRawfile(body.deck)
              : body.collection.rawfile !== null,
          ...(body.collection === undefined
            ? {}
            : { collection: body.collection }),
          truncated: run.truncated,
          truncatedOutputs: run.truncated ? ["log"] : [],
          rawfile: null,
          rawfileName: null,
          rawfileFormat: null,
          environment,
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

/** Recoveries that say the run could not happen here, not that it failed. */
const NOT_HERE = new Set<Problem["recovery"]>([
  "retry-after",
  "retry-same-request",
  "reprepare",
]);
const NOT_HERE_CODES = new Set([
  "simulator-refused",
  "simulator-unreachable",
  "simulation-dependency-unavailable",
]);

function notHere(problem: Pick<Problem, "code" | "recovery">): boolean {
  return NOT_HERE.has(problem.recovery) || NOT_HERE_CODES.has(problem.code);
}

/**
 * Check one circuit's testbench on this machine: folder after folder, until
 * one does not pass, each under the Profile its experiment names. A verdict
 * the hosted rule gives, marked `local`; or `cannot-run` when a folder names
 * a Profile no local check runs, or its run could not happen here (no
 * simulator, no library for a dependency), so nothing is recorded for it.
 */
export async function localSimulationCheck(
  projectText: string,
  simulator: LocalSimulator,
  now: () => Date = () => new Date(),
): Promise<LocalSimulationCheck> {
  const verdict = (
    folders: SimulationCheckFolder[],
    count: number,
  ): LocalSimulationCheck => ({
    kind: "verdict",
    check: {
      ...simulationCheckVerdict(folders, count, now().toISOString()),
      origin: "local",
    },
  });
  let project: CircuitProject;
  try {
    project = parseProject(projectText);
  } catch (error) {
    return verdict(
      [
        simulationCheckFolderFailure(
          { name: "Project" },
          {
            code: "project-unreadable",
            message: error instanceof Error ? error.message : String(error),
          },
        ),
      ],
      1,
    );
  }
  const folders = project.simulationFolders;
  if (folders.length === 0) return verdict([], 0);
  // An unreadable experiment is the default Profile's to refuse, as hosted.
  const profiles = new Map<string, LocalProfile>();
  for (const folder of folders) {
    const config = readSimulationExperimentConfig(folder);
    const profileId = config.ok
      ? config.config.environment.profileId
      : hostedProfile.id;
    const local = LOCAL_PROFILES.find(
      ({ profile }) => profile.id === profileId,
    );
    if (!local)
      return {
        kind: "cannot-run",
        folder: folder.name,
        code: "profile-not-local",
        message: `This folder runs under the Profile ${profileId}; a local check runs ${LOCAL_PROFILES.map(({ profile }) => profile.id).join(" or ")} only.`,
      };
    profiles.set(folder.id, local);
  }
  const executors = new Map<string, ReturnType<typeof createHostedExecutor>>();
  const executorFor = async (local: LocalProfile) => {
    const known = executors.get(local.profile.id);
    if (known) return known;
    const facts = await localSimulatorFacts(simulator, local.profile);
    if (!facts) return null;
    const runner = localRunner(simulator, local, facts);
    const ours = JSON.stringify(facts.environment);
    const executor = createHostedExecutor(
      (async (input: RequestInfo | URL, init?: RequestInit) =>
        (await routeNgspiceSimulationRequest(
          new Request(
            new URL(String(input), "http://local-simulation-check"),
            init,
          ),
          { NGSPICE: { getByName: () => runner } },
          undefined,
          local.profile,
          // This machine's run, which the route would otherwise refuse for
          // not being the Profile's pinned image.
          {
            acceptEnvironment: async (environment) =>
              JSON.stringify(environment) === ours,
          },
        )) ??
        Response.json({ error: "not-found" }, { status: 404 })) as typeof fetch,
    );
    executors.set(local.profile.id, executor);
    return executor;
  };
  const results: SimulationCheckFolder[] = [];
  for (const folder of folders) {
    const cannotRun = (problem: Pick<Problem, "code" | "message">) => ({
      kind: "cannot-run" as const,
      folder: folder.name,
      code: problem.code,
      message: problem.message,
    });
    const executor = await executorFor(profiles.get(folder.id)!);
    if (!executor)
      return cannotRun({
        code: "ngspice-unavailable",
        message: `${simulator.ngspice} does not run here or does not say its version.`,
      });
    let checked: SimulationCheckFolder;
    try {
      const prepared = await prepareFolderExecutionInput(
        project,
        folder,
        undefined,
        (profileId) => executor.capabilities(profileId),
      );
      if (!prepared.ok) {
        if (notHere(prepared.error)) return cannotRun(prepared.error);
        checked = simulationCheckFolderFailure(folder, prepared.error);
      } else {
        // Specs are read from the log, as the hosted check reads them.
        const input: ExecutionInput =
          prepared.input.collection && "rawfile" in prepared.input.collection
            ? { ...prepared.input, collection: { rawfile: null } }
            : prepared.input;
        const preparedDigest = await sha256(JSON.stringify(input));
        const runId = randomUUID();
        const output = await executor.execute(
          input,
          runId,
          simulator.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        );
        checked = judgeSimulationCheckFolder(folder, input, output, {
          runId,
          preparedId: runId,
          inputDigest: preparedDigest,
        });
      }
    } catch (error) {
      if (!(error instanceof ExecutionFailure)) throw error;
      if (notHere(error.problem)) return cannotRun(error.problem);
      checked = simulationCheckFolderFailure(folder, error.problem);
    }
    results.push(checked);
    if (checked.status !== "pass") break;
  }
  return verdict(results, folders.length);
}
