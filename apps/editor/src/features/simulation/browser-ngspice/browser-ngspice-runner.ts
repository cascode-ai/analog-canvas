/**
 * The hosted container's `/health`, `/run` and `/cancel`, answered on this
 * computer by ngspice in a Web Worker. The Worker route
 * (worker/simulation-ngspice.ts) composes the deck and evaluates the run in
 * the page, as it does in front of the container; this runner stands where
 * the container stands. One run at a time; cancelling or passing the
 * deadline terminates the Worker, as the harness kills the process group.
 */
import {
  NGSPICE_MAX_LOG_BYTES,
  deckRequestsRawfile,
  type SimulationEnvironmentMetadata,
} from "@icm/spice-run";
import type { NgspiceRunner } from "../../../../../../worker/simulation-ngspice";
import { BROWSER_NGSPICE_PROFILE as profile } from "./browser-ngspice-environment";
import type {
  BrowserNgspiceWorkerReply,
  BrowserNgspiceWorkerRequest,
} from "./browser-ngspice-protocol";
import type { NgspiceBatchOutput } from "./ngspice-batch";

/** The part of a Web Worker the runner drives. */
export interface NgspiceWorker {
  postMessage(message: BrowserNgspiceWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<BrowserNgspiceWorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

const MAX_DECK_BYTES = 2 * 1024 * 1024;
/**
 * The longest rawfile the page carries through the route. The route's result
 * holds the text and the numbers read from it in one JSON string, about twice
 * the text, and V8 strings stop at 2^29 characters, so a longer file would
 * fail the run's assembly; it is reported uncollected instead, with the
 * reason in the log.
 */
const MAX_CARRIED_RAWFILE_CHARS = 192 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const LIMITS = {
  deckBytes: MAX_DECK_BYTES,
  // The whole rawfile is kept; memory is its only bound.
  outputBytes: null,
  logBytes: NGSPICE_MAX_LOG_BYTES,
};

/** What a run may mount: each Profile library, by identity, at its runtime path. */
const MOUNTABLE = [
  {
    id: profile.models.id,
    sha256: profile.models.contentSha256,
    runtimePath: profile.models.library.runtimePath,
    cells: false,
  },
  ...profile.cellLibraries.map((library) => ({
    id: library.id,
    sha256: library.contentSha256,
    runtimePath: library.library.runtimePath,
    cells: true,
  })),
];

interface RunBody {
  deck: string;
  files?: { path: string; text: string }[];
  dependencies?: { id: string; sha256: string; mountPath: string }[];
  entryPath?: string;
  collection?: { rawfile: string | null };
  timeoutMs?: number;
  runToken?: string;
}

type Ending =
  | { kind: "finished"; output: NgspiceBatchOutput }
  | { kind: "failed"; message: string }
  | { kind: "not-ready"; message: string }
  | { kind: "timed-out" | "cancelled" };

export function createBrowserNgspiceRunner(
  createWorker: () => NgspiceWorker,
): NgspiceRunner {
  let worker: NgspiceWorker | undefined;
  let nextId = 0;
  let environment: SimulationEnvironmentMetadata | undefined;
  let active: {
    token: string | undefined;
    stop(kind: "cancelled"): void;
  } | null = null;
  // Cancellations that arrived before their run, kept as long as a run may wait.
  const cancelledTokens = new Map<string, number>();
  const json = (payload: unknown, status = 200, headers?: HeadersInit) =>
    Response.json(payload, { status, ...(headers ? { headers } : {}) });

  function execute(body: RunBody, entryPath: string) {
    return new Promise<{ ending: Ending; durationMs: number }>((resolve) => {
      const id = ++nextId;
      const current = (worker ??= createWorker());
      const timeoutMs = Math.max(1, body.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      let startedAt: number | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (ending: Ending) => {
        if (active?.stop !== stop) return;
        active = null;
        clearTimeout(timer);
        current.onmessage = null;
        current.onerror = null;
        if (ending.kind !== "finished") {
          // A run stopped mid-way, or a Worker that broke, is not reused.
          current.terminate();
          if (worker === current) worker = undefined;
        }
        resolve({
          ending,
          durationMs:
            ending.kind === "finished"
              ? ending.output.durationMs
              : startedAt === undefined
                ? 0
                : Math.round(performance.now() - startedAt),
        });
      };
      const stop = (kind: "cancelled" | "timed-out"): void => settle({ kind });
      active = { token: body.runToken, stop };
      current.onmessage = ({ data }) => {
        if (data.id !== id) return;
        if (data.kind === "started") {
          environment = data.environment;
          startedAt = performance.now();
          timer = setTimeout(() => stop("timed-out"), timeoutMs);
        } else settle(data);
      };
      current.onerror = (event) =>
        settle({
          kind: startedAt === undefined ? "not-ready" : "failed",
          message: event.message || "The simulator's Worker stopped.",
        });
      current.postMessage({
        id,
        request: {
          deck: body.deck,
          entryPath,
          files: body.files ?? [],
          mounts: (body.dependencies ?? []).map((dependency) => ({
            mountPath: dependency.mountPath,
            target: MOUNTABLE.find((item) => item.id === dependency.id)!
              .runtimePath,
          })),
          ...(body.collection === undefined
            ? {}
            : { collection: body.collection }),
        },
      });
    });
  }

  async function run(body: RunBody): Promise<Response> {
    if (typeof body?.deck !== "string" || body.deck.length === 0)
      return json({ error: "missing-deck" }, 400);
    const token = body.runToken;
    for (const [key, expires] of cancelledTokens)
      if (expires < Date.now()) cancelledTokens.delete(key);
    if (token !== undefined && cancelledTokens.delete(token))
      return json({ error: "run-cancelled" }, 409);
    if (
      (body.dependencies ?? []).some(
        (dependency) =>
          !MOUNTABLE.some(
            (item) =>
              item.id === dependency.id && item.sha256 === dependency.sha256,
          ),
      )
    )
      return json({ error: "simulation-dependency-unavailable" }, 400);
    if (active)
      return json(
        {
          error: "simulator-busy",
          message:
            "This browser runs one circuit at a time and is running another one.",
        },
        503,
        { "retry-after": "2" },
      );
    const entryPath = body.entryPath ?? "deck.cir";
    const { ending, durationMs } = await execute(body, entryPath);
    if (ending.kind === "not-ready")
      return json(
        { error: "simulator-not-ready", message: ending.message },
        503,
      );
    if (ending.kind === "cancelled" && !environment)
      return json({ error: "run-cancelled" }, 409);
    if (!environment)
      return json(
        {
          error: "simulator-not-ready",
          message: "The in-browser simulator did not identify itself.",
        },
        503,
      );
    const rawfileRequested =
      body.collection === undefined
        ? deckRequestsRawfile(body.deck)
        : body.collection.rawfile !== null;
    const output: NgspiceBatchOutput =
      ending.kind === "finished"
        ? ending.output
        : {
            stdout: "",
            stderr:
              ending.kind === "failed"
                ? `*** ngspice stopped: ${ending.message} ***\n`
                : "",
            truncated: false,
            exitCode: ending.kind === "failed" ? 134 : null,
            signal: ending.kind === "failed" ? "SIGABRT" : null,
            durationMs,
            rawfileRequested,
            rawfile: null,
            rawfileName: null,
            rawfileFormat: null,
          };
    const mountedCells = (body.dependencies ?? [])
      .filter((dependency) =>
        MOUNTABLE.some((item) => item.cells && item.id === dependency.id),
      )
      .map(({ id, sha256 }) => ({ id, sha256 }));
    const reply = (output: NgspiceBatchOutput) =>
      json({
        log: `${output.stdout}${output.stderr}${
          output.truncated
            ? `\n*** output truncated by the simulation harness at ${NGSPICE_MAX_LOG_BYTES} bytes ***\n`
            : ""
        }`,
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: output.exitCode,
        signal: output.signal,
        timedOut: ending.kind === "timed-out",
        cancelled: ending.kind === "cancelled",
        durationMs,
        rawfileRequested: output.rawfileRequested,
        ...(body.collection === undefined
          ? {}
          : { collection: body.collection }),
        ...(output.rawfileError ? { rawfileError: output.rawfileError } : {}),
        truncated: output.truncated,
        truncatedOutputs: output.truncated ? ["log"] : [],
        rawfile: output.rawfile,
        rawfileName: output.rawfileName,
        rawfileFormat: output.rawfileFormat,
        limits: {
          ...LIMITS,
          timeoutMs: Math.max(1, body.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        },
        environment,
        ...(mountedCells.length > 0 ? { cellLibraries: mountedCells } : {}),
      });
    // A rawfile too long to carry is reported uncollected, and says why.
    const uncollected = (rawfile: string) => ({
      ...output,
      stderr: `${output.stderr}*** The rawfile (${Math.round(rawfile.length / 1048576)} MB) is longer than this browser can carry; save fewer vectors or points. ***\n`,
      rawfile: null,
      rawfileName: null,
      rawfileFormat: null,
      rawfileError: "unreadable-output",
    });
    if (
      output.rawfile !== null &&
      output.rawfile.length > MAX_CARRIED_RAWFILE_CHARS
    )
      return reply(uncollected(output.rawfile));
    try {
      return reply(output);
    } catch (error) {
      if (!(error instanceof RangeError) || output.rawfile === null)
        throw error;
      return reply(uncollected(output.rawfile));
    }
  }

  return {
    async fetch(input, init) {
      const path = new URL(input).pathname;
      if (path === "/health")
        return json({
          status: "ready",
          // Measured by the first run; until then the Profile's discovery
          // stands without it.
          ...(environment ? { environment } : {}),
          limits: LIMITS,
          dependencies: MOUNTABLE.map(({ id, sha256 }) => ({ id, sha256 })),
        });
      const body = JSON.parse(String(init?.body ?? "{}")) as RunBody;
      if (path === "/cancel") {
        if (typeof body.runToken === "string") {
          if (active && active.token === body.runToken)
            active.stop("cancelled");
          else cancelledTokens.set(body.runToken, Date.now() + 10 * 60_000);
        }
        return json({ accepted: true });
      }
      if (path === "/run") return run(body);
      return json({ error: "not-found" }, 404);
    },
  };
}
