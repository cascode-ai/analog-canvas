// The container's whole job: accept a deck, run ngspice on it, return what
// ngspice said. It decides nothing about the circuit.
//
// It does decide how that deck is allowed to run, and that is the harder
// half. What executes here is somebody else's SPICE: a `.control` block is a
// small language with file access, and the author of a deck is not the
// operator of this container. So the run is boxed in on every side that can
// be boxed in from inside the process — a fresh directory per run that is
// also the only writable place the simulator can see, an environment built
// from nothing rather than inherited, one job at a time, a deadline that
// kills the whole process group rather than one pid, and a cap on every byte
// that comes back. The container's own answer for what it cannot enforce
// from in here — who it runs as, and what the model tree permits — is in the
// Dockerfile beside this file.
//
// A container wakes with a fresh disk and sleeps after ten idle minutes, so
// every run writes its deck, reads its output, and leaves nothing behind
// that a later run could depend on.
import { execFile, spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, relative, dirname } from "node:path";

import { SimulationRunSupervisor } from "./run-supervisor.mjs";

const MODEL_ROOT = process.env.SKY130_MODEL_ROOT ?? "/opt/sky130/sky130A";
const PROFILE_PATH = process.env.SIMULATION_PROFILE_PATH?.trim() || null;
const STARTUP_PATH = process.env.SIMULATION_STARTUP_PATH?.trim() || null;
const PORT = Number(process.env.PORT ?? 8080);

/**
 * Who may start a run. Inside Cloudflare the only caller is the Worker that
 * owns the container binding, so nothing is configured and every `/run` is
 * accepted. On an operator's own host the harness sits behind a tunnel with a
 * public hostname, and then the Worker must present this token or the host
 * is a free simulator for whoever finds the name. `/health` stays open either
 * way: it reports the image's identity, not a circuit, and an uptime check
 * should not need a secret.
 */
const ACCESS_TOKEN = (process.env.SIMULATION_ACCESS_TOKEN ?? "").trim();

/** Constant-time: a token compared byte by byte leaks its prefix by timing. */
function authorized(request) {
  if (!ACCESS_TOKEN) return true;
  const header = request.headers.authorization ?? "";
  const match = /^Bearer\s+(\S+)$/u.exec(header);
  if (!match) return false;
  const presented = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(ACCESS_TOKEN, "utf8");
  return (
    presented.length === expected.length && timingSafeEqual(presented, expected)
  );
}

/**
 * Where a run's private directory is made. A directory the image gives to the
 * unprivileged run user, not the shared world-writable `/tmp`: two things
 * live under `/tmp` on a general-purpose image and neither of them should be
 * reachable by a deck.
 */
const RUN_ROOT = process.env.SIMULATION_RUN_ROOT ?? tmpdir();

/** Refuse a deck larger than this rather than spend a container waking for it. */
const MAX_DECK_BYTES = 2 * 1024 * 1024;

/**
 * The ceiling on everything this container hands back for one run: the log
 * and, when the deck asked for one, the rawfile. A deck can print without
 * bound — a `.control` loop around `print` is three lines — and the answer to
 * that is a cap and a truthful `truncated`, never a quietly shortened result
 * that reads like the whole one.
 */
const MAX_OUTPUT_BYTES = positiveEnv(
  "SIMULATION_MAX_OUTPUT_BYTES",
  1024 * 1024,
);

/** Requested when the caller names no deadline of its own. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The deadline ceiling. The Worker in front of this already clamps to
 * `MAX_SIMULATION_TIMEOUT_MS`, but a container that trusts its caller for how
 * long to occupy its only slot has no limit at all — the clamp is repeated
 * here because this is the side that pays for it.
 */
const MAX_TIMEOUT_MS = positiveEnv("SIMULATION_MAX_TIMEOUT_MS", 120_000);
const LIFECYCLE_GRACE_MS = positiveEnv(
  "SIMULATION_RUN_LIFECYCLE_GRACE_MS",
  10_000,
);

/**
 * Kernel limits handed to the simulator. `RLIMIT_NPROC` is the fork bomb's
 * ceiling; `RLIMIT_FSIZE` bounds what one `write` can pour onto the scratch
 * disk, which the output cap does not — that cap governs what is returned,
 * not what is written.
 *
 * Neither is set unless the image sets it, and the image does. They are not
 * defaulted here on purpose: `RLIMIT_NPROC` counts every process the account
 * owns, so a number chosen for a container that runs one simulator would
 * refuse to fork on a developer's machine, where the same account already
 * owns hundreds. The numbers belong where the account is known, which is the
 * Dockerfile.
 */
const MAX_PROCESSES = optionalPositiveEnv("SIMULATION_MAX_PROCESSES");
/** `ulimit -f` counts 512-byte blocks in dash and 1 KiB blocks in bash. */
const MAX_FILE_BLOCKS = optionalPositiveEnv("SIMULATION_MAX_FILE_BLOCKS");

/** How long the startup identity probe may take before it is given up on. */
const PROBE_TIMEOUT_MS = positiveEnv("SIMULATION_PROBE_TIMEOUT_MS", 5_000);

/** The deck, and the only file this harness itself puts in the run directory. */
const DECK_NAME = "deck.cir";
const SPICEINIT_NAME = ".spiceinit";
const DEFAULT_STARTUP = "set filetype=ascii\n";

function positiveEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

/** A limit the image may set and this harness does not invent. */
function optionalPositiveEnv(name) {
  if (process.env[name] === undefined) return null;
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : null;
}

const runSupervisor = new SimulationRunSupervisor({
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  maxTimeoutMs: MAX_TIMEOUT_MS,
  lifecycleGraceMs: LIFECYCLE_GRACE_MS,
});

/**
 * Ask a binary something, with a deadline.
 *
 * The deadline is the point. This runs at startup to identify the simulator,
 * and `/health` and the first run both wait on the answer — so a binary that
 * does not return from `--version` would leave the container permanently not
 * ready and permanently unable to say why. An unanswered probe reports
 * `unreported` and the container gets on with its job.
 */
function commandOutput(binary, args) {
  return new Promise((resolve) => {
    execFile(
      binary,
      args,
      {
        timeout: PROBE_TIMEOUT_MS,
        killSignal: "SIGKILL",
        // The identity probe is the simulator too, so it gets the same
        // constructed environment a run does, and a working directory that is
        // neither the harness's own nor the scratch root a run is made under.
        // Measured, not theorised: while these tests were being written, a
        // stand-in that ignored `--version` wrote its output file into the
        // repository the harness had been started from.
        cwd: "/",
        env: runEnvironment("/nonexistent"),
      },
      (error, stdout, stderr) => {
        resolve(error ? "unreported" : `${stdout ?? ""}${stderr ?? ""}`.trim());
      },
    );
  });
}

function ngspiceVersion(output) {
  const match = output.match(/\bngspice[-\s]+([0-9][A-Za-z0-9.+-]*)/iu);
  return match ? `ngspice-${match[1]}` : "unreported";
}

async function isExecutable(path) {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the simulator without assuming where the base image put it.
 *
 * `NGSPICE_BIN` names it when the image knows; when that path is not there —
 * which is what a swapped base image looks like from in here (issue #551) —
 * `ngspice` is looked up on PATH instead. A miss returns the path that was
 * looked for, so `/health` reports a missing binary rather than this
 * resolving into something else.
 */
async function resolveNgspiceBinary() {
  const configured = process.env.NGSPICE_BIN ?? "/usr/bin/ngspice";
  if (await isExecutable(configured)) return configured;
  const name = configured.includes("/") ? "ngspice" : configured || "ngspice";
  const search = (process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin").split(
    ":",
  );
  for (const directory of search) {
    if (directory.length === 0) continue;
    const candidate = join(directory, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return configured;
}

async function sha256File(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

async function loadEnvironmentProfile() {
  if (PROFILE_PATH === null) return null;
  const profile = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
  if (
    profile?.schemaVersion !== 1 ||
    typeof profile.id !== "string" ||
    typeof profile.platform !== "string" ||
    profile.simulator?.name !== "ngspice" ||
    typeof profile.simulator.version !== "string" ||
    !isSha256(profile.simulator.binarySha256) ||
    typeof profile.models?.id !== "string" ||
    !isSha256(profile.models.contentSha256) ||
    typeof profile.models.library?.runtimePath !== "string" ||
    !profile.models.library.runtimePath.startsWith("/") ||
    !isSha256(profile.startup?.contentSha256)
  ) {
    throw new Error(`Simulation Profile ${PROFILE_PATH} is malformed.`);
  }
  if (STARTUP_PATH === null) {
    throw new Error(
      "A pinned Simulation Profile requires SIMULATION_STARTUP_PATH.",
    );
  }
  return profile;
}

async function sha256Tree(root) {
  const hash = createHash("sha256");
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      const name = relative(root, path).replaceAll("\\", "/");
      hash.update(JSON.stringify(name));
      hash.update("\0");
      const bytes = await readFile(path);
      hash.update(String(bytes.byteLength));
      hash.update("\0");
      hash.update(bytes);
      hash.update("\0");
    }
  }
  await visit(root);
  return hash.digest("hex");
}

async function observeEnvironment(ngspiceBin) {
  const profile = await loadEnvironmentProfile();
  const startupText =
    STARTUP_PATH === null
      ? DEFAULT_STARTUP
      : await readFile(STARTUP_PATH, "utf8");
  const [versionOutput, binarySha256, modelTreeSha256, startupSha256] =
    await Promise.all([
      commandOutput(ngspiceBin, ["--version"]),
      sha256File(ngspiceBin),
      sha256Tree(MODEL_ROOT),
      Promise.resolve(createHash("sha256").update(startupText).digest("hex")),
    ]);
  const platform = `${process.platform}/${process.arch}`;
  const version = ngspiceVersion(versionOutput);
  if (profile !== null) {
    const mismatches = [
      ["platform", profile.platform, platform],
      ["simulator version", profile.simulator.version, version],
      [
        "simulator binary SHA-256",
        profile.simulator.binarySha256,
        binarySha256,
      ],
      ["model tree SHA-256", profile.models.contentSha256, modelTreeSha256],
      ["startup SHA-256", profile.startup.contentSha256, startupSha256],
    ].filter(([, expected, actual]) => expected !== actual);
    if (mismatches.length > 0) {
      throw new Error(
        `Simulation environment does not match Profile ${profile.id}: ${mismatches
          .map(
            ([label, expected, actual]) =>
              `${label} expected ${expected}, observed ${actual}`,
          )
          .join("; ")}`,
      );
    }
  }
  const facts = {
    executor: "hosted-container",
    reproducibility: profile === null ? "observed" : "pinned",
    profileId: profile?.id ?? null,
    platform,
    simulator: {
      name: "ngspice",
      version,
      binarySha256,
    },
    models: {
      id: profile?.models.id ?? "sky130A",
      contentSha256: modelTreeSha256,
    },
    startupSha256: profile === null ? null : startupSha256,
  };
  return {
    environment: {
      ...facts,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(facts))
        .digest("hex"),
    },
    startupText,
    dependency:
      profile === null
        ? null
        : {
            id: profile.models.id,
            sha256: profile.models.contentSha256,
            runtimePath: profile.models.library.runtimePath,
          },
  };
}

/**
 * What this container will and will not do, in the numbers it enforces.
 * Reported by `/health` and with every run so a deploy check, and a reader of
 * one result, can see the boundary rather than infer it.
 */
const LIMITS = {
  deckBytes: MAX_DECK_BYTES,
  outputBytes: MAX_OUTPUT_BYTES,
  ...runSupervisor.limits,
  maxProcesses: MAX_PROCESSES,
  maxFileBlocks: MAX_FILE_BLOCKS,
};

/**
 * Settle on a directory this container can actually make run directories in.
 *
 * The image prepares one and hands it over in `SIMULATION_RUN_ROOT`, and that
 * is the one to use — it belongs to the run account and to nothing else. But
 * a container runtime may mount over it, and a run root that cannot be
 * written is not a circuit problem and must not look like one. So it is
 * probed once, at startup, by making and removing a directory in it; a root
 * that fails the probe falls back to the platform's temporary directory, and
 * `/health` says which one is in use so a deploy check can see the
 * difference.
 */
let runRootFailures = [];

async function resolveRunRoot() {
  const candidates = [RUN_ROOT, tmpdir()];
  const failures = [];
  for (const candidate of candidates) {
    try {
      await mkdir(candidate, { recursive: true });
      const probe = await mkdtemp(join(candidate, "probe-"));
      await rm(probe, { recursive: true, force: true });
      return candidate;
    } catch (error) {
      failures.push(`${candidate}: ${String(error)}`);
    }
  }
  // Nothing worked. Hand back the configured one so the per-run failure names
  // the directory the image meant to use, and report the probe's findings.
  runRootFailures = failures;
  return RUN_ROOT;
}

const runRootPromise = resolveRunRoot();
const ngspiceBinaryPromise = resolveNgspiceBinary();
const environmentPromise = ngspiceBinaryPromise.then(observeEnvironment);
// Keep a missing binary or model tree observable through /health and /run
// instead of letting Node treat the startup probe as an unhandled rejection.
environmentPromise.catch(() => undefined);
const runtimeReadyPromise = Promise.all([
  ngspiceBinaryPromise,
  environmentPromise,
  runRootPromise,
]);
runtimeReadyPromise.catch(() => undefined);

/**
 * A capped sink for one of the simulator's two streams.
 *
 * Each stream gets its own half of the budget on purpose. ngspice splits its
 * diagnostics across stdout and stderr — the parse warning that silently
 * drops a device on one, the fatal error on the other — so a single shared
 * budget would let a flood of printed values on stdout push the one line that
 * explains the run out of the answer.
 */
function createCappedSink(limit) {
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  return {
    write(chunk) {
      if (bytes >= limit) {
        truncated = true;
        return;
      }
      const room = limit - bytes;
      if (chunk.length > room) {
        chunks.push(chunk.subarray(0, room));
        bytes = limit;
        truncated = true;
        return;
      }
      chunks.push(chunk);
      bytes += chunk.length;
    },
    get truncated() {
      return truncated;
    },
    text() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

/**
 * The environment the simulator runs in, built rather than inherited.
 *
 * `process.env` in a hosted container holds whatever the platform put there,
 * and a `.control` block can print all of it. Nothing in that set is a
 * simulator input, so none of it is passed: the child gets a PATH, a HOME and
 * a TMPDIR that are the run's own directory, and a C locale so numbers parse
 * the same way whatever the host is set to.
 */
function runEnvironment(directory) {
  return {
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: directory,
    TMPDIR: directory,
    LANG: "C",
    LC_ALL: "C",
    TERM: "dumb",
  };
}

/**
 * Start the simulator, under the image's kernel limits when it set any.
 *
 * `exec` means the shell is replaced by ngspice rather than sitting above it,
 * so the pid we hold is the simulator's own and the process group has no
 * extra member in it. A shell without `ulimit`, or one refusing a limit,
 * still runs the deck: the limits are a ceiling on a hostile deck, not a
 * precondition for an honest one.
 */
function simulatorCommand(binary) {
  const preamble = [
    MAX_FILE_BLOCKS === null
      ? null
      : `ulimit -f ${MAX_FILE_BLOCKS} 2>/dev/null || true`,
    MAX_PROCESSES === null
      ? null
      : `ulimit -u ${MAX_PROCESSES} 2>/dev/null || true`,
  ].filter((clause) => clause !== null);
  if (preamble.length === 0) {
    return { command: binary, args: ["-b", DECK_NAME] };
  }
  return {
    command: "/bin/sh",
    args: [
      "-c",
      `${preamble.join("; ")}; exec "$@"`,
      "sh",
      binary,
      "-b",
      DECK_NAME,
    ],
  };
}

/**
 * Run ngspice in batch mode over one deck, inside one directory.
 *
 * `-b` is batch, so the author's own `.control` block drives the run and we
 * add no analysis of our own. The deck is named relatively against the run's
 * cwd so the temporary path never appears in the log the author reads. Both
 * streams are captured because ngspice splits its diagnostics across them,
 * and the caller needs both to tell a dropped device from a clean run.
 */
function runNgspice(binary, directory, run, entryPath = DECK_NAME) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const stdout = createCappedSink(Math.ceil(MAX_OUTPUT_BYTES / 2));
    const stderr = createCappedSink(Math.floor(MAX_OUTPUT_BYTES / 2));
    const { command, args } = simulatorCommand(binary);
    args[args.length - 1] = `./${entryPath}`;
    let settled = false;
    let exited = null;
    let spawnError = null;
    let graceTimer = null;

    const child = spawn(command, args, {
      cwd: directory,
      env: runEnvironment(directory),
      // Its own session, so the deadline can reach everything the deck
      // started and not just the process we launched.
      detached: true,
      // No stdin: a batch run has nothing to read, and an inherited one is a
      // way for a deck to hang forever waiting on it.
      stdio: ["ignore", "pipe", "pipe"],
    });
    run.attachProcess(child);

    const settle = () => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      const timedOut = run.timedOut;
      run.detachProcess(child);
      const signal = exited?.signal ?? null;
      const numericCode = typeof exited?.code === "number" ? exited.code : null;
      // A child that died by a signal we did not send (the kernel's OOM
      // killer, measured on 2026-09-04 while a 1 GiB instance parsed the
      // Sky130 corner) reports no exit code, which the first version of this
      // harness read as exit 0 — a "completed" run with an empty log. A
      // signal death is a failure, and it says which signal.
      const exitCode = timedOut
        ? null
        : spawnError
          ? null
          : (numericCode ?? (signal ? 128 : 1));
      resolve({
        stdout: stdout.text(),
        stderr: stderr.text(),
        truncated: stdout.truncated || stderr.truncated,
        exitCode,
        signal: timedOut ? null : signal,
        timedOut,
        spawnError,
        durationMs: Date.now() - startedAt,
      });
    };

    child.stdout?.on("data", (chunk) => stdout.write(chunk));
    child.stderr?.on("data", (chunk) => stderr.write(chunk));
    child.stdout?.on("error", () => {});
    child.stderr?.on("error", () => {});

    child.on("exit", (code, signal) => {
      exited = { code, signal };
      // Reap anything the deck left behind, then stop waiting for the pipes.
      // A grandchild holding the inherited stdout open is exactly why `close`
      // alone is not the end of a run.
      run.terminateAttachedProcess();
      graceTimer = setTimeout(settle, 200);
      graceTimer.unref?.();
    });
    child.on("close", settle);
    child.on("error", (error) => {
      spawnError = error;
      settle();
    });
  });
}

/** Whether the deck asked the simulator to write vectors out at all. */
function deckRequestsRawfile(deck) {
  for (const raw of deck.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("*")) continue;
    if (/^\.save\b/iu.test(line)) return true;
    if (/(^|\s|;)write(\s|$)/iu.test(line)) return true;
  }
  return false;
}

/**
 * Read back the rawfile the deck wrote, capped like everything else.
 *
 * Not parsed here, deliberately: reading a rawfile into vectors is a contract
 * with its own tests and its own owner, and a container that half-parses is a
 * second place for that contract to live. This returns the text and the name
 * of the file it came from. A binary rawfile is reported by name with no
 * text rather than as mojibake — ngspice writes ASCII when the run's
 * `.spiceinit` asks for it, and a deck that overrides that gets a name back
 * saying so.
 */
async function readRawfile(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return { rawfile: null, rawfileName: null, rawfileFormat: null };
  }
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name !== DECK_NAME && name !== SPICEINIT_NAME)
    .sort();
  const preferred =
    candidates.find((name) => name.toLowerCase().endsWith(".raw")) ??
    candidates[0];
  if (!preferred) {
    return { rawfile: null, rawfileName: null, rawfileFormat: null };
  }

  let handle;
  try {
    handle = await open(join(directory, preferred), "r");
    // One byte past the cap, so "exactly at the cap" and "cut short" are
    // distinguishable rather than both looking complete.
    const buffer = Buffer.alloc(MAX_OUTPUT_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const read = buffer.subarray(0, bytesRead);
    if (read.includes(0)) {
      return {
        rawfile: null,
        rawfileName: preferred,
        rawfileFormat: "binary",
      };
    }
    const truncated = bytesRead > MAX_OUTPUT_BYTES;
    return {
      rawfile: read.subarray(0, MAX_OUTPUT_BYTES).toString("utf8"),
      rawfileName: preferred,
      rawfileFormat: "ascii",
      truncated,
    };
  } catch {
    return { rawfile: null, rawfileName: null, rawfileFormat: null };
  } finally {
    await handle?.close().catch(() => {});
  }
}

const cancelledTokens = new Map();
async function handleRun(body) {
  const deck = typeof body?.deck === "string" ? body.deck : null;
  if (!deck) return { status: 400, payload: { error: "missing-deck" } };
  const token = typeof body?.runToken === "string" ? body.runToken : undefined;
  if (
    body.runToken !== undefined &&
    (!token || !/^[0-9a-f-]{36}$/u.test(token))
  )
    return { status: 400, payload: { error: "invalid-run-token" } };
  for (const [key, expires] of cancelledTokens)
    if (expires < Date.now()) cancelledTokens.delete(key);
  if (token && cancelledTokens.has(token))
    return { status: 409, payload: { error: "run-cancelled" } };
  const files = body.files ?? [];
  const dependencies = body.dependencies ?? [];
  const entryPath = body.entryPath ?? DECK_NAME;
  const safePath = (p) =>
    typeof p === "string" &&
    p.length > 0 &&
    p.length < 241 &&
    !p.startsWith("/") &&
    !/[\\:\u0000-\u001f]/u.test(p) &&
    p.split("/").every((part) => part && part !== "." && part !== "..") &&
    p.toLowerCase() !== ".spiceinit";
  if (
    !Array.isArray(files) ||
    files.length > 24 ||
    !Array.isArray(dependencies) ||
    dependencies.length > 24 ||
    !safePath(entryPath) ||
    files.some((f) => !f || !safePath(f.path) || typeof f.text !== "string") ||
    dependencies.some(
      (dependency) =>
        !dependency ||
        typeof dependency.id !== "string" ||
        typeof dependency.sha256 !== "string" ||
        !safePath(dependency.mountPath),
    ) ||
    dependencies.some((dependency, index) =>
      dependencies.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index &&
          candidate.mountPath === dependency.mountPath,
      ),
    ) ||
    dependencies.some(
      (dependency) =>
        dependency.mountPath === entryPath ||
        files.some((file) => file.path === dependency.mountPath),
    ) ||
    files.reduce((n, f) => n + Buffer.byteLength(f.text, "utf8"), 0) >
      MAX_DECK_BYTES
  )
    return { status: 400, payload: { error: "invalid-input-files" } };
  if (Buffer.byteLength(deck, "utf8") > MAX_DECK_BYTES) {
    return { status: 413, payload: { error: "deck-too-large" } };
  }

  let runtime;
  try {
    runtime = await runtimeReadyPromise;
  } catch (error) {
    return {
      status: 503,
      payload: {
        error: "simulator-not-ready",
        message: `The simulator runtime is not ready: ${String(error)}`,
      },
    };
  }

  const [binary, observed, runRoot] = runtime;
  if (
    dependencies.some(
      (dependency) =>
        observed.dependency === null ||
        dependency.id !== observed.dependency.id ||
        dependency.sha256 !== observed.dependency.sha256,
    )
  )
    return {
      status: 400,
      payload: { error: "simulation-dependency-unavailable" },
    };
  const admission = await runSupervisor.tryExecute(
    { timeoutMs: body?.timeoutMs, token },
    async (run) => {
      let directory = null;
      try {
        // Every run gets a private cwd, HOME and TMPDIR. The model tree is
        // outside it and read-only.
        try {
          directory = await mkdtemp(join(runRoot, "run-"));
        } catch (error) {
          return {
            status: 500,
            payload: {
              error: "run-directory-unavailable",
              message: `The simulator could not make a directory for this run: ${String(error)}`,
            },
          };
        }
        for (const file of files) {
          await mkdir(dirname(join(directory, file.path)), { recursive: true });
          await writeFile(join(directory, file.path), file.text, "utf8");
        }
        for (const dependency of dependencies) {
          await mkdir(dirname(join(directory, dependency.mountPath)), {
            recursive: true,
          });
          await symlink(
            observed.dependency.runtimePath,
            join(directory, dependency.mountPath),
          );
        }
        await mkdir(dirname(join(directory, entryPath)), { recursive: true });
        await writeFile(join(directory, entryPath), deck, "utf8");
        await writeFile(
          join(directory, SPICEINIT_NAME),
          observed.startupText,
          "utf8",
        );

        if (token && cancelledTokens.has(token)) runSupervisor.cancel(token);
        const result = await runNgspice(binary, directory, run, entryPath);
        run.phase("collecting");
        const rawfileRequested = deckRequestsRawfile(deck);
        const raw = rawfileRequested
          ? await readRawfile(directory)
          : { rawfile: null, rawfileName: null, rawfileFormat: null };

        const truncatedOutputs = [
          ...(result.truncated ? ["log"] : []),
          ...(raw.truncated ? ["rawfile"] : []),
        ];
        const log = `${result.stdout}${result.stderr}${
          result.truncated
            ? `\n*** output truncated by the simulation harness at ${MAX_OUTPUT_BYTES} bytes ***\n`
            : ""
        }`;

        return {
          status: 200,
          payload: {
            log,
            // Keep the streams separate as execution facts. `log` remains
            // during the rolling protocol transition and for human display.
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            signal: result.signal,
            timedOut: result.timedOut,
            cancelled: run.cancelled,
            durationMs: result.durationMs,
            rawfileRequested,
            truncated: truncatedOutputs.length > 0,
            truncatedOutputs,
            rawfile: raw.rawfile,
            rawfileName: raw.rawfileName,
            rawfileFormat: raw.rawfileFormat,
            limits: { ...LIMITS, timeoutMs: run.timeoutMs },
            environment: observed.environment,
          },
        };
      } finally {
        run.phase("cleaning");
        if (directory) {
          await rm(directory, { recursive: true, force: true }).catch(() => {});
        }
      }
    },
  );

  if (admission.kind === "busy") {
    return {
      status: 503,
      headers: { "retry-after": String(admission.retryAfterSeconds) },
      payload: {
        error: "simulator-busy",
        message:
          "This simulator runs one circuit at a time and is running another one.",
        retryAfterSeconds: admission.retryAfterSeconds,
      },
    };
  }
  return admission.value;
}

const server = createServer((request, response) => {
  const send = (status, payload, headers = {}) => {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      ...headers,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
  };

  if (request.method === "GET" && request.url === "/health") {
    // Answered while a run is in flight, on purpose: a deploy check that can
    // only ask when the container is idle cannot tell a busy simulator from a
    // broken one. The run root is reported because a container that cannot
    // write one answers every run with the same failure, and a deploy check
    // should be able to see that before a circuit does.
    runtimeReadyPromise.then(
      ([, observed, runRoot]) => {
        const activity = runSupervisor.snapshot();
        send(activity.state === "fatal" ? 503 : 200, {
          status: activity.state === "fatal" ? "not-ready" : "ready",
          activity,
          limits: LIMITS,
          runRoot,
          ...(runRootFailures.length > 0 ? { runRootFailures } : {}),
          environment: observed.environment,
        });
      },
      (error) =>
        send(503, {
          status: "not-ready",
          activity: runSupervisor.snapshot(),
          limits: LIMITS,
          error: String(error),
        }),
    );
    return;
  }
  if (request.method !== "POST" || !["/run", "/cancel"].includes(request.url)) {
    send(404, { error: "not-found" });
    return;
  }
  if (!authorized(request)) {
    // Refused before the body is read: an unauthorized caller gets no say in
    // how much this process buffers, and no hint about the slot's state.
    send(401, { error: "unauthorized" }, { "www-authenticate": "Bearer" });
    request.resume();
    return;
  }

  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_DECK_BYTES * 2) {
      send(413, { error: "request-too-large" });
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      send(400, { error: "invalid-json" });
      return;
    }
    if (request.url === "/cancel") {
      if (
        typeof body.runToken !== "string" ||
        !/^[0-9a-f-]{36}$/iu.test(body.runToken)
      ) {
        send(400, { error: "invalid-run-token" });
        return;
      }
      for (const [key, expires] of cancelledTokens)
        if (expires < Date.now()) cancelledTokens.delete(key);
      if (!cancelledTokens.has(body.runToken) && cancelledTokens.size >= 256) {
        send(503, { error: "cancel-capacity" });
        return;
      }
      cancelledTokens.set(body.runToken, Date.now() + 180000);
      runSupervisor.cancel(body.runToken);
      send(200, { accepted: true });
      return;
    }
    handleRun(body).then(
      ({ status, payload, headers }) => send(status, payload, headers),
      (error) => send(500, { error: String(error) }),
    );
  });
});

await mkdir(RUN_ROOT, { recursive: true }).catch(() => {});
server.listen(PORT, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  // The port, not the requested one: the tests ask for an ephemeral port and
  // read it back from here.
  console.log(`ngspice harness listening on ${port}`);
});
