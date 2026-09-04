// The container's whole job: accept a deck, run ngspice on it, return what
// ngspice said. It decides nothing about the circuit.
//
// A container wakes with a fresh disk and sleeps after ten idle minutes, so
// every run writes its deck, reads its output, and leaves nothing behind that
// a later run could depend on.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const NGSPICE_BIN = process.env.NGSPICE_BIN ?? "/usr/bin/ngspice";
const MODEL_ROOT = process.env.SKY130_MODEL_ROOT ?? "/opt/sky130/sky130A";
const PORT = Number(process.env.PORT ?? 8080);
/** Refuse a deck larger than this rather than spend a container waking for it. */
const MAX_DECK_BYTES = 2 * 1024 * 1024;

function commandOutput(binary, args) {
  return new Promise((resolve) => {
    execFile(binary, args, (error, stdout, stderr) => {
      resolve(error ? "unreported" : `${stdout ?? ""}${stderr ?? ""}`.trim());
    });
  });
}

function ngspiceVersion(output) {
  const match = output.match(/\bngspice[-\s]+([0-9][A-Za-z0-9.+-]*)/iu);
  return match ? `ngspice-${match[1]}` : "unreported";
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

async function observeEnvironment() {
  const [versionOutput, binarySha256, modelTreeSha256] = await Promise.all([
    commandOutput(NGSPICE_BIN, ["--version"]),
    sha256File(NGSPICE_BIN),
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

const environmentPromise = observeEnvironment();
// Keep a missing binary or model tree observable through /health and /run
// instead of letting Node treat the startup probe as an unhandled rejection.
environmentPromise.catch(() => undefined);

/**
 * Run ngspice in batch mode over one deck.
 *
 * `-b` is batch, so the author's own `.control` block drives the run and we
 * add no analysis of our own. Both streams are captured because ngspice
 * splits its diagnostics across them: the parse warning that silently drops a
 * device arrives on one, the fatal error on the other, and the caller needs
 * both to tell a dropped device from a clean run.
 */
function runNgspice(deckPath, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let timedOut = false;
    const child = execFile(
      NGSPICE_BIN,
      ["-b", deckPath],
      {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        // execFile reports a timeout as a killed process, which is also what
        // a crash looks like; the flag set by the timer is what separates
        // them, because a timeout is an answer and a crash is not.
        //
        // A child that died by a signal we did not send (the kernel's OOM
        // killer, measured on 2026-09-04 while a 1 GiB instance parsed the
        // Sky130 corner) reports error.code as null, which the first version
        // of this harness read as exit 0 — a "completed" run with an empty
        // log. A signal death is a failure, and it says which signal.
        const signal = error?.signal ?? null;
        const numericCode = typeof error?.code === "number" ? error.code : null;
        const exitCode = timedOut
          ? null
          : error
            ? (numericCode ?? (signal ? 128 : 1))
            : 0;
        resolve({
          log: `${stdout ?? ""}${stderr ?? ""}`,
          exitCode,
          signal: timedOut ? null : signal,
          timedOut,
          durationMs: Date.now() - startedAt,
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

async function handleRun(body) {
  const deck = typeof body?.deck === "string" ? body.deck : null;
  if (!deck) return { status: 400, payload: { error: "missing-deck" } };
  if (Buffer.byteLength(deck, "utf8") > MAX_DECK_BYTES) {
    return { status: 413, payload: { error: "deck-too-large" } };
  }
  const timeoutMs = Number.isFinite(body?.timeoutMs)
    ? Math.max(1, Math.trunc(body.timeoutMs))
    : 30_000;

  const directory = await mkdtemp(join(tmpdir(), "icm-sim-"));
  const deckPath = join(directory, "deck.cir");
  try {
    await writeFile(deckPath, deck, "utf8");
    const result = await runNgspice(deckPath, timeoutMs);
    return {
      status: 200,
      payload: { ...result, environment: await environmentPromise },
    };
  } finally {
    // The disk does not survive a sleep, but a woken container serves many
    // runs before sleeping and one author's deck is not another's business.
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

const server = createServer((request, response) => {
  const send = (status, payload) => {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
  };

  if (request.method === "GET" && request.url === "/health") {
    environmentPromise.then(
      (environment) => send(200, { status: "ready", environment }),
      (error) => send(503, { status: "not-ready", error: String(error) }),
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
      ({ status, payload }) => send(status, payload),
      (error) => send(500, { error: String(error) }),
    );
  });
});

server.listen(PORT, () => {
  console.log(`ngspice harness listening on ${PORT}`);
});
