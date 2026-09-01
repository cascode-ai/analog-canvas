// The container's whole job: accept a deck, run ngspice on it, return what
// ngspice said. It decides nothing about the circuit.
//
// A container wakes with a fresh disk and sleeps after ten idle minutes, so
// every run writes its deck, reads its output, and leaves nothing behind that
// a later run could depend on.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NGSPICE_BIN = process.env.NGSPICE_BIN ?? "/usr/bin/ngspice";
const PORT = Number(process.env.PORT ?? 8080);
/** Refuse a deck larger than this rather than spend a container waking for it. */
const MAX_DECK_BYTES = 2 * 1024 * 1024;

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
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, killSignal: "SIGKILL" },
      (error, stdout, stderr) => {
        // execFile reports a timeout as a killed process, which is also what
        // a crash looks like; the flag set by the timer is what separates
        // them, because a timeout is an answer and a crash is not.
        resolve({
          log: `${stdout ?? ""}${stderr ?? ""}`,
          exitCode: timedOut ? null : (error?.code ?? 0),
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
    return { status: 200, payload: result };
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
    send(200, { status: "ready", ngspice: NGSPICE_BIN });
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
