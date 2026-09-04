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
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const MODEL_ROOT = process.env.SKY130_MODEL_ROOT ?? "/opt/sky130/sky130A";
const PORT = Number(process.env.PORT ?? 8080);

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

/** Seconds a caller is asked to wait when the single slot is taken. */
const BUSY_RETRY_AFTER_SECONDS = 2;

/** How long the startup identity probe may take before it is given up on. */
const PROBE_TIMEOUT_MS = positiveEnv("SIMULATION_PROBE_TIMEOUT_MS", 5_000);

/** The deck, and the only file this harness itself puts in the run directory. */
const DECK_NAME = "deck.cir";
const SPICEINIT_NAME = ".spiceinit";

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
  const [versionOutput, binarySha256, modelTreeSha256] = await Promise.all([
    commandOutput(ngspiceBin, ["--version"]),
    sha256File(ngspiceBin),
    sha256Tree(MODEL_ROOT),
  ]);
  const facts = {
    executor: "hosted-container",
    // The current Docker inputs are not locked yet. This must not say pinned
    // until the image is verified against the accepted environment lock.
    reproducibility: "observed",
    platform: `${process.platform}/${process.arch}`,
    simulator: {
      name: "ngspice",
      version: ngspiceVersion(versionOutput),
      binarySha256,
    },
    models: { id: "sky130A", contentSha256: modelTreeSha256 },
  };
  return {
    ...facts,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(facts))
      .digest("hex"),
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
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  maxTimeoutMs: MAX_TIMEOUT_MS,
  maxProcesses: MAX_PROCESSES,
  maxFileBlocks: MAX_FILE_BLOCKS,
  concurrentRuns: 1,
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

/**
 * One job at a time, held by a flag rather than a queue.
 *
 * This is not `max_instances` wearing another hat. That setting bounds how
 * many containers Cloudflare will run; this bounds how many runs one of them
 * accepts, and it is the only one of the two that a second request inside an
 * already-busy container can see. Refusing is the honest answer: two ngspice
 * processes on one core do not both finish sooner, they both miss their
 * deadline, and the second caller would rather be told to come back.
 */
let busy = false;

function acquireSlot() {
  if (busy) return false;
  busy = true;
  return true;
}

function releaseSlot() {
  busy = false;
}

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
 * Kill the run's whole process group.
 *
 * `detached: true` gives the simulator its own session, so its pid is also
 * its process-group id and the negative pid reaches everything it started.
 * Signalling the pid alone was the bug: a deck whose `.control` block shells
 * out leaves the child running with the pipes still open, so the deadline
 * expired and the work did not stop.
 */
function killProcessGroup(child, signal) {
  if (typeof child.pid !== "number") return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone; nothing to stop.
    }
  }
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
function runNgspice(binary, directory, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const stdout = createCappedSink(Math.ceil(MAX_OUTPUT_BYTES / 2));
    const stderr = createCappedSink(Math.floor(MAX_OUTPUT_BYTES / 2));
    const { command, args } = simulatorCommand(binary);
    let timedOut = false;
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

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child, "SIGKILL");
    }, timeoutMs);

    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
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
      killProcessGroup(child, "SIGKILL");
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

function resolveTimeoutMs(requested) {
  if (!Number.isFinite(requested)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_TIMEOUT_MS);
}

async function handleRun(body) {
  const deck = typeof body?.deck === "string" ? body.deck : null;
  if (!deck) return { status: 400, payload: { error: "missing-deck" } };
  if (Buffer.byteLength(deck, "utf8") > MAX_DECK_BYTES) {
    return { status: 413, payload: { error: "deck-too-large" } };
  }
  const timeoutMs = resolveTimeoutMs(body?.timeoutMs);

  if (!acquireSlot()) {
    return {
      status: 503,
      headers: { "retry-after": String(BUSY_RETRY_AFTER_SECONDS) },
      payload: {
        error: "simulator-busy",
        message:
          "This simulator runs one circuit at a time and is running another one.",
        retryAfterSeconds: BUSY_RETRY_AFTER_SECONDS,
      },
    };
  }

  /** Assigned inside the try, read by the finally; null if it never got made. */
  let directory = null;
  // Everything from here to the end of the run is inside the slot, so it is
  // all inside the try that gives the slot back. Making the run's directory
  // used to sit between the two: a container whose run root was not writable
  // answered one 500 and then refused every later request as busy, forever,
  // because the only path that released the slot was never reached. Measured
  // on the preview channel, 2026-09-04.
  try {
    // Every run gets its own directory, made fresh and removed whole. It is
    // the cwd, so a deck's relative file access lands here and nowhere else;
    // it is HOME, so the `.spiceinit` ngspice reads is the one written below
    // and never a shared file another run could have left; and it is TMPDIR.
    // The model tree the deck includes is outside it and read-only.
    try {
      directory = await mkdtemp(join(await runRootPromise, "run-"));
    } catch (error) {
      // A run that could not start is not a run that failed. Only this
      // failure is named here; anything later is the run's own and reaches
      // the generic handler with its own words.
      return {
        status: 500,
        payload: {
          error: "run-directory-unavailable",
          message: `The simulator could not make a directory for this run: ${String(error)}`,
        },
      };
    }
    await writeFile(join(directory, DECK_NAME), deck, "utf8");
    // ASCII rawfiles, so `write` produces something a reader can read.
    // ngspice's default is binary; this is the environment's setting, not an
    // edit to the deck, and the author's own `.control` block overrides it.
    await writeFile(
      join(directory, SPICEINIT_NAME),
      "set filetype=ascii\n",
      "utf8",
    );

    const binary = await ngspiceBinaryPromise;
    const result = await runNgspice(binary, directory, timeoutMs);
    const raw = deckRequestsRawfile(deck)
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
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        truncated: truncatedOutputs.length > 0,
        truncatedOutputs,
        rawfile: raw.rawfile,
        rawfileName: raw.rawfileName,
        rawfileFormat: raw.rawfileFormat,
        limits: { ...LIMITS, timeoutMs },
        environment: await environmentPromise,
      },
    };
  } finally {
    // The disk does not survive a sleep, but a woken container serves many
    // runs before sleeping and one author's deck is not another's business.
    if (directory) {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
    releaseSlot();
  }
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
    Promise.all([environmentPromise, runRootPromise]).then(
      ([environment, runRoot]) =>
        send(200, {
          status: "ready",
          busy,
          limits: LIMITS,
          runRoot,
          ...(runRootFailures.length > 0 ? { runRootFailures } : {}),
          environment,
        }),
      (error) =>
        send(503, {
          status: "not-ready",
          busy,
          limits: LIMITS,
          error: String(error),
        }),
    );
    return;
  }
  if (request.method !== "POST" || request.url !== "/run") {
    send(404, { error: "not-found" });
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
