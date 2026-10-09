// The Gallery's simulation check (#1545): an entry's testbench run again by
// the server, and judged by the Specs it states.
//
// The Worker prepares each simulation folder from the stored Project with
// the code the Simulation panel prepares a run with, submits it as a
// managed run through the same admission, queue, limits and retries every
// run takes, and reads its Specs with the panel's own evaluation. The runs
// belong to an account of their own, so they keep one slot apart from the
// Owner's, and one folder runs at a time: the queue moves on in the
// five-minute schedule, never faster than the simulator answers.

import type { CircuitProject, ProjectSimulationFolder } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import {
  CapabilitiesSchema,
  ExecutionFailure,
  createManagedHostedExecutor,
  executionSpecReport,
  formatSimulationSpec,
  prepareFolderExecutionInput,
  sha256,
  type Capabilities,
  type ExecutionInput,
  type Problem,
  type SimulationSpecResult,
} from "@icm/simulation-service";
import type { SessionUser } from "./auth";
import { callGallery } from "./gallery-requests";
import type { GalleryEnv } from "./gallery-store";
import {
  SIMULATION_CHECK_RULE_VERSION,
  type SimulationCheck,
  type SimulationCheckFolder,
} from "./gallery-store-simulation-checks";
import { routeSimulationRequest } from "./simulation";
import {
  routeManagedSimulationRequest,
  type SimulationOperationsEnv,
  type SimulationOperationsRuntime,
} from "./simulation-operations";

/**
 * The account the checks' managed runs belong to. Nobody signs in as it;
 * its runs take the per-account slot (one waiting, one running) apart from
 * any person's, and only an administrator reads them.
 */
const SIMULATION_CHECK_ACCOUNT: SessionUser = {
  id: "gallery-simulation-check",
  displayName: "Gallery simulation check",
  email: null,
  provider: "gallery",
  role: "user",
  isAdmin: false,
};

const CHECK_RUNTIME: SimulationOperationsRuntime = {
  principalOf: async () => SIMULATION_CHECK_ACCOUNT,
  now: () => Date.now(),
  uuid: () => crypto.randomUUID(),
};

/** In-process requests; nothing leaves the Worker by this origin. */
const CHECK_ORIGIN = "https://gallery-simulation-check.internal";

/** How long one scheduled pass keeps checking: within its five minutes. */
const SIMULATION_CHECK_PASS_MS = 4 * 60_000;

/**
 * The largest run result a check reads. Its Specs come from the log, so a
 * check collects no waveform file from ngspice; a native run's files still
 * come back, and one this large is not read into the Worker.
 */
const MAX_CHECK_RESULT_BYTES = 8 * 1024 * 1024;

const MAX_CHECK_SPECS = 24;
const MAX_CHECK_TEXT = 300;

/**
 * Problems that say the simulator cannot take the run yet, or its answer is
 * not in: the folder waits at the head of the queue for the next pass, and
 * the same request then finds the same run.
 */
const WAITING_CODES = new Set([
  "RUN_RESPONSE_UNKNOWN",
  "OWNER_QUEUE_LIMIT",
  "OWNER_ACTIVE_LIMIT",
  "GLOBAL_QUEUE_LIMIT",
  "SIMULATION_DRAINED",
  "SIMULATION_CONTROL_UNAVAILABLE",
  "simulation-queue-unavailable",
  "simulation-operations-not-configured",
]);

type SimulationCheckEnv = GalleryEnv & SimulationOperationsEnv;

/**
 * One pass over the queue: when it ends, and how long one result read
 * waits at the server for a run to finish (the managed executor's 20 s).
 */
interface CheckPass {
  deadline: number;
  resultWaitMs?: number | undefined;
}

/** The capabilities of one Profile, as the editor discovers them. */
async function profileCapabilities(
  env: SimulationOperationsEnv,
  profileId: string,
): Promise<Capabilities> {
  const response = await routeSimulationRequest(
    new Request(`${CHECK_ORIGIN}/api/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "capabilities",
        environment: { profileId },
      }),
    }),
    env,
  );
  const parsed = CapabilitiesSchema.safeParse(
    await response?.json().catch(() => null),
  );
  if (response?.ok && parsed.success) return parsed.data;
  const refused = response !== null && response.status < 500;
  throw new ExecutionFailure({
    code: refused
      ? "SIMULATION_PROFILE_UNAVAILABLE"
      : "SIMULATION_CAPABILITIES_UNAVAILABLE",
    message: refused
      ? `This deployment does not run the Profile ${profileId}.`
      : "The simulator's capabilities could not be read.",
    stage: "prepare",
    recovery: refused ? "fix-input" : "retry-after",
  });
}

/** A response's text, or null once it passes `limit` bytes. */
async function boundedText(
  response: Response,
  limit: number,
): Promise<string | null> {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (reader) {
    const item = await reader.read();
    if (item.done) break;
    bytes += item.value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(item.value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * The managed-run routes, answered in-process for the check's account: the
 * editor's managed executor speaks to them as it does over the network. A
 * result read after the pass's deadline is not made, so the pass ends while
 * the run goes on; the next pass asks for the same run again.
 */
function checkFetch(env: SimulationOperationsEnv, deadline: number) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), CHECK_ORIGIN);
    const result = url.pathname.endsWith("/result");
    if (result && Date.now() >= deadline)
      throw new Error("This pass is over; the run is read in the next one.");
    const response =
      (await routeManagedSimulationRequest(
        new Request(url, init),
        env,
        CHECK_RUNTIME,
      )) ?? Response.json({ error: "not-found" }, { status: 404 });
    if (!result || !response.ok) return response;
    const text = await boundedText(response, MAX_CHECK_RESULT_BYTES);
    return text === null
      ? Response.json(
          {
            error: "SIMULATION_CHECK_RESULT_TOO_LARGE",
            message: `The run's result is larger than ${MAX_CHECK_RESULT_BYTES} bytes, more than a check reads.`,
            stage: "read",
            recovery: "not-retryable",
            state: "succeeded",
          },
          { status: 409 },
        )
      : new Response(text, {
          status: response.status,
          headers: response.headers,
        });
  }) as typeof fetch;
}

function clipped(text: string, limit = MAX_CHECK_TEXT): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function folderFailure(
  folder: ProjectSimulationFolder,
  problem: Pick<Problem, "code" | "message">,
): SimulationCheckFolder {
  return {
    name: clipped(folder.name, 80),
    status: "error",
    code: problem.code,
    message: clipped(problem.message),
    specs: [],
  };
}

/** A Spec the testbench states: a condition, or an attempt at one. */
function statesSpec(result: SimulationSpecResult): boolean {
  return result.expected !== null || result.reason === "invalid-spec";
}

/**
 * Run one folder and judge it: `error` when it cannot be prepared or its run
 * does not complete, `fail` when a Spec it states does not pass, else
 * `pass`. "waiting" when the simulator cannot answer yet. `checkKey` names
 * this folder of this check; with the prepared input's digest it is the
 * run's request id, so a later pass finds the same run, and an input a
 * deploy prepares differently starts a run of its own.
 */
async function checkFolder(
  env: SimulationOperationsEnv,
  project: CircuitProject,
  folder: ProjectSimulationFolder,
  checkKey: string,
  pass: CheckPass,
): Promise<SimulationCheckFolder | "waiting"> {
  let prepared: Awaited<ReturnType<typeof prepareFolderExecutionInput>>;
  try {
    prepared = await prepareFolderExecutionInput(
      project,
      folder,
      undefined,
      (profileId) => profileCapabilities(env, profileId),
    );
  } catch (error) {
    if (!(error instanceof ExecutionFailure)) throw error;
    return error.problem.recovery === "retry-after"
      ? "waiting"
      : folderFailure(folder, error.problem);
  }
  if (!prepared.ok) return folderFailure(folder, prepared.error);
  // Specs are read from the log, so ngspice is asked for no waveform file.
  const input: ExecutionInput =
    prepared.input.collection && "rawfile" in prepared.input.collection
      ? { ...prepared.input, collection: { rawfile: null } }
      : prepared.input;
  const preparedDigest = await sha256(JSON.stringify(input));
  const requestId = `${checkKey}/${preparedDigest.slice(0, 16)}`;
  const executor = createManagedHostedExecutor({
    fetch: checkFetch(env, pass.deadline),
    ...(pass.resultWaitMs === undefined
      ? {}
      : { resultWaitMs: pass.resultWaitMs }),
  });
  let output: Awaited<ReturnType<typeof executor.execute>>;
  try {
    output = await executor.execute(input, requestId, undefined, {
      preparedId: requestId,
      preparedDigest,
    });
  } catch (error) {
    if (!(error instanceof ExecutionFailure)) throw error;
    return WAITING_CODES.has(error.problem.code)
      ? "waiting"
      : folderFailure(folder, error.problem);
  }
  const { specs } = executionSpecReport(input, output, {
    runId: requestId,
    preparedId: requestId,
    inputDigest: preparedDigest,
  });
  const { result } = output;
  const environment = result.metadata.environment;
  const stated = specs.results.filter(statesSpec);
  const missed = stated.find((spec) => spec.judgment !== "pass");
  const completed = result.outcome.status === "completed" && !output.cancelled;
  const firstError = result.diagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );
  return {
    name: clipped(folder.name, 80),
    status: !completed ? "error" : missed ? "fail" : "pass",
    ...(!completed
      ? {
          code: output.cancelled
            ? "run-cancelled"
            : `run-${result.outcome.status}`,
          ...(firstError ? { message: clipped(firstError.text) } : {}),
        }
      : missed
        ? { code: missed.reason, message: clipped(missed.detail) }
        : {}),
    simulator: `${environment.simulator.name} ${environment.simulator.version}`,
    ...(environment.profileId ? { profileId: environment.profileId } : {}),
    specs: stated.slice(0, MAX_CHECK_SPECS).map((spec) => ({
      name: clipped(spec.name, 80),
      expected: formatSimulationSpec(spec.expected),
      value: spec.value,
      unit: clipped(spec.unit, 24),
      judgment: spec.judgment,
      ...(spec.judgment === "pass" ? {} : { reason: spec.reason }),
    })),
  };
}

/**
 * An entry's verdict from its folders' results: no folder is
 * `no-testbench`; a folder that errs or fails decides it; else it passes
 * when its testbench states a Spec at all.
 */
function simulationCheckVerdict(
  folders: SimulationCheckFolder[],
  folderCount: number,
  checkedAt: string,
): SimulationCheck {
  const missed = folders.find((folder) => folder.status !== "pass");
  const status: SimulationCheck["status"] =
    folderCount === 0
      ? "no-testbench"
      : missed
        ? missed.status
        : folders.some((folder) => folder.specs.length > 0)
          ? "pass"
          : "fail";
  const reason =
    status === "no-testbench"
      ? "no-testbench"
      : missed
        ? (missed.code ?? missed.status)
        : status === "fail"
          ? "no-specs"
          : undefined;
  return {
    status,
    checkedAt,
    rule: SIMULATION_CHECK_RULE_VERSION,
    simulator: folders.find((folder) => folder.simulator)?.simulator ?? null,
    ...(reason ? { reason } : {}),
    folders,
  };
}

interface NextCheck {
  job: {
    entryId: string;
    checkId: string;
    folderIndex: number;
    folders: SimulationCheckFolder[];
  } | null;
  digest?: string;
  projectText?: string;
}

/** The next folder of the queue's first entry, checked: what to record. */
async function checkNext(
  env: SimulationCheckEnv,
  next: NextCheck & { job: NonNullable<NextCheck["job"]> },
  pass: CheckPass,
): Promise<
  { folder?: SimulationCheckFolder; verdict?: SimulationCheck } | "waiting"
> {
  const { job } = next;
  const at = () => new Date().toISOString();
  let project: CircuitProject;
  try {
    project = parseProject(next.projectText ?? "");
  } catch (error) {
    const folder: SimulationCheckFolder = {
      name: "Project",
      status: "error",
      code: "project-unreadable",
      message: clipped(error instanceof Error ? error.message : String(error)),
      specs: [],
    };
    return { verdict: simulationCheckVerdict([folder], 1, at()) };
  }
  const folders = project.simulationFolders;
  if (folders.length === 0)
    return { verdict: simulationCheckVerdict([], 0, at()) };
  const folder = folders[job.folderIndex];
  if (!folder)
    return {
      verdict: simulationCheckVerdict(job.folders, folders.length, at()),
    };
  const checked = await checkFolder(
    env,
    project,
    folder,
    `gallery-simulation-check/${job.checkId}/${job.folderIndex}`,
    pass,
  ).catch((error: unknown) =>
    folderFailure(folder, {
      code: "check-failed",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  if (checked === "waiting") return "waiting";
  const results = [...job.folders, checked];
  return checked.status === "pass" && results.length < folders.length
    ? { folder: checked }
    : {
        folder: checked,
        verdict: simulationCheckVerdict(results, folders.length, at()),
      };
}

/**
 * Move the Owner's queue on: check folder after folder, the queue's first
 * entry first, until the queue is empty, the simulator cannot answer yet,
 * or the pass's time is up. Answers how many entries got their verdict.
 */
export async function advanceSimulationChecks(
  env: SimulationCheckEnv,
  options: { budgetMs?: number; resultWaitMs?: number } = {},
): Promise<number> {
  const pass: CheckPass = {
    deadline: Date.now() + (options.budgetMs ?? SIMULATION_CHECK_PASS_MS),
    resultWaitMs: options.resultWaitMs,
  };
  let finished = 0;
  while (Date.now() < pass.deadline) {
    const { payload: next } = await callGallery<NextCheck>(
      env,
      "simulation-check-next",
      {},
    );
    if (!next.job) break;
    const step = await checkNext(env, { ...next, job: next.job }, pass);
    if (step === "waiting") break;
    const { payload } = await callGallery<{
      recorded?: boolean;
      done?: boolean;
    }>(env, "simulation-check-record", {
      entryId: next.job.entryId,
      checkId: next.job.checkId,
      folderIndex: next.job.folderIndex,
      digest: next.digest,
      ...step,
    });
    if (payload.recorded && payload.done) finished += 1;
  }
  return finished;
}
