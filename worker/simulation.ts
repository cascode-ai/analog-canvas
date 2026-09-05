/**
 * The simulation route: a netlist and the author's testbench in, ngspice's
 * answer out.
 *
 * The Worker cannot run ngspice — a V8 isolate executes JavaScript and
 * WebAssembly, never a native binary — so the run happens in a container and
 * this module is the boundary in front of it. It adds nothing to the circuit
 * and interprets nothing about it: ADR 0055 puts the testbench in the
 * author's hands, and a diagnosis in ngspice's own words.
 *
 * The container binding is OPTIONAL on purpose. `wrangler.jsonc` is shared by
 * every deploy of this Worker, so a binding for a capability the account may
 * not have enabled would break deploys that have nothing to do with
 * simulation. Absent binding is answered as "not configured" — a fact about
 * the deployment, phrased so nobody mistakes it for a fact about the circuit.
 */
import {
  buildSimulationDeck,
  deckNeedsModelLibrary,
  deckRequestsRawfile,
  evaluateSimulationRun,
  createSimulationInputMetadata,
  isSimulationInputRevision,
  resolveTimeoutMs,
  SKY130_LIBRARY_PATH,
  SKY130_LIBRARY_SECTION,
  simulationConfigurationMetadata,
  verifySimulationEnvironmentMetadata,
  type ModelLibrarySelection,
  type SimulationResult,
} from "@icm/spice-run";
import hostedSky130Profile from "../containers/ngspice/hosted-sky130-profile.json";

/** What a container-backed runner has to offer this module. */
export interface NgspiceRunner {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export interface SimulationEnv {
  /** Present once Containers is enabled for the account and bound. */
  NGSPICE?: { getByName(name: string): NgspiceRunner };
  /**
   * A harness running elsewhere — the same image, on a host the operator
   * runs, reached over HTTPS through a tunnel. When set it is the simulator;
   * the container binding, if any, is left asleep. The Worker stays the only
   * public door: the host answers only to this token.
   */
  SIMULATION_UPSTREAM_URL?: string;
  SIMULATION_UPSTREAM_TOKEN?: string;
  /**
   * Preview policy, not circuit state. Both executors may be configured at
   * once; this chooses the one used when a caller names no target.
   */
  SIMULATION_DEFAULT_EXECUTOR?: string;
  /** Where the models live inside the image. */
  SKY130_LIB_PATH?: string;
  /** Section in the sectioned Sky130 library; `tt` when omitted. */
  SKY130_LIB_SECTION?: string;
  /** Must match the selected harness' SIMULATION_MAX_OUTPUT_BYTES. */
  SIMULATION_MAX_OUTPUT_BYTES?: string;
}

// The continuous (unbinned) Sky130 library the benchmark image ships; the
// binned checkout it also carries caps device width at 100 µm (#551).

/** A deck this large is a mistake upstream, not a simulation worth waking for. */
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

function advertisedMaxOutputBytes(env: SimulationEnv): number {
  const configured = Number(env.SIMULATION_MAX_OUTPUT_BYTES);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_OUTPUT_BYTES;
}

/**
 * Cloudflare Containers are owned by a named Durable Object. An image deploy
 * does not evict an already-warm object immediately, so a fixed key can route
 * a new Worker to the previous Profile for the rest of its idle lifetime.
 * Keying the object by the versioned Profile identity makes a Profile change
 * start a fresh container while unchanged deploys keep their warm instance.
 */
const CLOUDFLARE_CONTAINER_INSTANCE_KEY = `profile:${hostedSky130Profile.id}`;

interface SimulationRequestBody {
  operation?: unknown;
  mode?: unknown;
  environment?: {
    profileId?: unknown;
    corner?: unknown;
    temperatureC?: unknown;
  };
  files?: unknown;
  entryPath?: unknown;
  runToken?: unknown;
  preparedDeck?: unknown;
  netlist?: unknown;
  testbench?: unknown;
  timeoutMs?: unknown;
  inputRevision?: unknown;
  executorTarget?: unknown;
}

export type SimulationExecutorTarget = "cloudflare-container" | "operator-host";

interface SelectedRunner {
  target: SimulationExecutorTarget;
  runner: NgspiceRunner;
}

interface HostedExecutionMetadata {
  target: SimulationExecutorTarget;
}

/**
 * The harness on an operator-run host, spoken to exactly as the container
 * is: the same `/run` path, the same body, plus the bearer token the host
 * requires. Only the path of the caller's URL is kept, so the route module
 * never has to know which kind of runner it was handed.
 */
function remoteRunner(base: string, token: string | undefined): NgspiceRunner {
  return {
    fetch: (input, init) => {
      const target = new URL(new URL(input).pathname, base);
      const headers = new Headers(init?.headers);
      if (token) headers.set("authorization", `Bearer ${token}`);
      return fetch(target, { ...init, headers });
    },
  };
}

/**
 * Resolve one explicitly named executor. A Preview deployment may register
 * both at once; selecting one never wakes, probes, or retries through the
 * other. An uncertain run must not be duplicated on a fallback executor.
 */
function runnerFor(
  env: SimulationEnv,
  key: string,
  target: SimulationExecutorTarget,
): SelectedRunner | null {
  if (target === "operator-host") {
    const upstream = env.SIMULATION_UPSTREAM_URL?.trim();
    return upstream
      ? {
          target,
          runner: remoteRunner(upstream, env.SIMULATION_UPSTREAM_TOKEN),
        }
      : null;
  }
  return env.NGSPICE ? { target, runner: env.NGSPICE.getByName(key) } : null;
}

function isExecutorTarget(value: unknown): value is SimulationExecutorTarget {
  return value === "cloudflare-container" || value === "operator-host";
}

function defaultExecutorTarget(
  env: SimulationEnv,
): SimulationExecutorTarget | "invalid" {
  const configured = env.SIMULATION_DEFAULT_EXECUTOR?.trim();
  if (configured) return isExecutorTarget(configured) ? configured : "invalid";

  // Backwards-compatible default: a deployment that configured only the
  // upstream host keeps using it; otherwise the bound container is canonical.
  return env.SIMULATION_UPSTREAM_URL?.trim()
    ? "operator-host"
    : "cloudflare-container";
}

/**
 * How much of a refusal's body is worth carrying back. A refusal is a
 * sentence, not a payload; more than this is a container misbehaving, and it
 * is clipped rather than relayed.
 */
const MAX_REFUSAL_MESSAGE_CHARS = 400;

function clipRefusalText(text: string): string {
  return text.length > MAX_REFUSAL_MESSAGE_CHARS
    ? `${text.slice(0, MAX_REFUSAL_MESSAGE_CHARS)}\u2026`
    : text;
}

/**
 * Why the container refused, in its own words.
 *
 * The status code alone is not a diagnosis, and this route used to answer
 * every refusal with nothing else. The harness already distinguishes a
 * container that is running someone else's circuit (`simulator-busy`, with a
 * retry hint) from one that could not make a directory for the run at all
 * (`run-directory-unavailable`, naming the failure it hit) — and both arrived
 * here as a bare number.
 *
 * On 2026-09-04 that cost the preview channel an outage: a container whose
 * run root was unwritable answered one 500 and then held its single slot
 * forever, so every later request came back `503`. From outside, `503` is
 * also what an honestly busy simulator says. The fault was one line in the
 * harness, and finding it meant inferring container state from the sequence
 * of status codes across repeated probes, because the sentence that named it
 * was discarded here. Carrying that sentence costs nothing.
 *
 * Carried, never trusted: this is another service's output, so it is read as
 * text, bounded, and reported under its own keys rather than spread into the
 * response where it could shadow a field of this route's own.
 */
async function describeRefusal(
  response: Response,
): Promise<{ reason?: string; message?: string }> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    // A refusal whose body cannot even be read still has its status, which
    // is what the caller had before this existed.
    return {};
  }
  const trimmed = body.trim();
  if (trimmed.length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Not JSON. A proxy in front of the container, or a harness that died
    // before it could answer in its own format, replies in plain text — and
    // that text is then the only clue there is.
    return { message: clipRefusalText(trimmed) };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { message: clipRefusalText(trimmed) };
  }
  const fields = parsed as { error?: unknown; message?: unknown };
  const reason = typeof fields.error === "string" ? fields.error : null;
  const message = typeof fields.message === "string" ? fields.message : null;
  if (reason === null && message === null) {
    return { message: clipRefusalText(trimmed) };
  }
  return {
    ...(reason === null ? {} : { reason: clipRefusalText(reason) }),
    ...(message === null ? {} : { message: clipRefusalText(message) }),
  };
}

export async function routeSimulationRequest(
  request: Request,
  env: SimulationEnv,
  runnerKey = CLOUDFLARE_CONTAINER_INSTANCE_KEY,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/simulate") return null;
  if (request.method !== "POST") {
    return Response.json({ error: "method-not-allowed" }, { status: 405 });
  }

  let body: SimulationRequestBody;
  try {
    body = (await request.json()) as SimulationRequestBody;
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return Response.json({ error: "invalid-request" }, { status: 400 });
  if (
    body.executorTarget !== undefined &&
    !isExecutorTarget(body.executorTarget)
  ) {
    return Response.json(
      {
        error: "invalid-executor-target",
        message:
          'executorTarget must be "cloudflare-container" or "operator-host".',
      },
      { status: 400 },
    );
  }

  const configuredDefault = defaultExecutorTarget(env);
  if (configuredDefault === "invalid") {
    return Response.json(
      {
        error: "simulation-executor-configuration-invalid",
        message:
          "SIMULATION_DEFAULT_EXECUTOR does not name a supported Preview executor.",
      },
      { status: 503 },
    );
  }
  const target = body.executorTarget ?? configuredDefault;
  const selected = runnerFor(env, runnerKey, target);
  if (body.operation === "capabilities") {
    return Response.json({
      configured: !!selected,
      inputs: ["structured", "raw"],
      analyses: hostedSky130Profile.qualifiedScope.analyses,
      parsedAnalyses: ["op", "ac", "tran"],
      profiles: [
        {
          id: hostedSky130Profile.id,
          corners: [env.SKY130_LIB_SECTION ?? SKY130_LIBRARY_SECTION],
        },
      ],
      modelLibrary: {
        path: env.SKY130_LIB_PATH ?? SKY130_LIBRARY_PATH,
        section: env.SKY130_LIB_SECTION ?? SKY130_LIBRARY_SECTION,
      },
      maxTimeoutMs: 120000,
      maxInputBytes: MAX_INPUT_BYTES,
      maxOutputBytes: advertisedMaxOutputBytes(env),
      cancel: true,
    });
  }
  if (!selected) {
    const noExecutorConfigured =
      !env.NGSPICE && !env.SIMULATION_UPSTREAM_URL?.trim();
    return Response.json(
      noExecutorConfigured
        ? {
            error: "simulation-not-configured",
            message:
              "This deployment has neither a simulation container bound nor a simulator host configured, so no circuit can be run here.",
          }
        : {
            error: "simulation-executor-unavailable",
            execution: { target },
            message: `The Preview executor "${target}" is not configured in this deployment.`,
          },
      { status: 503 },
    );
  }
  const execution: HostedExecutionMetadata = { target: selected.target };
  if (
    body.runToken !== undefined &&
    (typeof body.runToken !== "string" ||
      !/^[0-9a-f-]{36}$/u.test(body.runToken))
  )
    return Response.json({ error: "invalid-run-token" }, { status: 400 });
  if (body.operation === "cancel") {
    if (!body.runToken)
      return Response.json({ error: "invalid-run-token" }, { status: 400 });
    try {
      const response = await selected.runner.fetch("http://container/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runToken: body.runToken }),
      });
      return Response.json(
        response.ok
          ? { accepted: true }
          : { error: "cancel-refused", ...(await describeRefusal(response)) },
        { status: response.ok ? 200 : 502 },
      );
    } catch {
      return Response.json(
        { error: "cancel-response-unknown" },
        { status: 502 },
      );
    }
  }
  if (body.operation !== undefined)
    return Response.json({ error: "invalid-operation" }, { status: 400 });
  if (
    body.environment &&
    (body.environment.profileId !== hostedSky130Profile.id ||
      (body.environment.corner !== undefined &&
        body.environment.corner !==
          (env.SKY130_LIB_SECTION ?? SKY130_LIBRARY_SECTION)))
  )
    return Response.json(
      { error: "simulation-profile-unavailable" },
      { status: 400 },
    );
  const files = body.files ?? [];
  const safePath = (p: unknown): p is string =>
    typeof p === "string" &&
    p.length > 0 &&
    p.length <= 240 &&
    !p.startsWith("/") &&
    !/[\\:\u0000-\u001f]/u.test(p) &&
    p.split("/").every((v) => !!v && v !== "." && v !== "..") &&
    p.toLowerCase() !== ".spiceinit";
  if (
    !Array.isArray(files) ||
    files.length > 24 ||
    files.some((f) => !f || !safePath(f.path) || typeof f.text !== "string") ||
    files.reduce((n, f) => n + new TextEncoder().encode(f.text).length, 0) >
      MAX_INPUT_BYTES ||
    (body.entryPath !== undefined && !safePath(body.entryPath))
  )
    return Response.json({ error: "invalid-input-files" }, { status: 400 });
  const netlist = typeof body.netlist === "string" ? body.netlist : null;
  const testbench = typeof body.testbench === "string" ? body.testbench : null;
  if (
    (body.mode !== "raw" && !netlist) ||
    netlist === null ||
    !testbench ||
    !isSimulationInputRevision(body.inputRevision)
  ) {
    return Response.json(
      {
        error: "invalid-request",
        message:
          "A simulation needs a circuit netlist and the testbench you wrote for it.",
      },
      { status: 400 },
    );
  }
  const inputRevision = body.inputRevision;

  const timeoutMs = resolveTimeoutMs(
    typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
  );
  let deck: string;
  let modelLibrary: ModelLibrarySelection | null;
  try {
    // The corner load is the expensive part of every run; a deck with no
    // device to model is spared it (see deckNeedsModelLibrary).
    modelLibrary = deckNeedsModelLibrary(`${netlist}\n${testbench}`)
      ? {
          directive: "lib",
          path: env.SKY130_LIB_PATH ?? SKY130_LIBRARY_PATH,
          section: env.SKY130_LIB_SECTION ?? SKY130_LIBRARY_SECTION,
        }
      : null;
    // Raw input is already an executable deck: preserve its title, control
    // program and includes. Model directives in raw files remain author-owned.
    if (body.mode === "raw") {
      modelLibrary = null;
      deck = testbench;
    } else deck = buildSimulationDeck({ netlist, testbench }, modelLibrary);
  } catch (error) {
    return Response.json(
      {
        error: "simulation-environment-invalid",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
  if (new TextEncoder().encode(deck).length > MAX_INPUT_BYTES) {
    return Response.json({ error: "deck-too-large" }, { status: 413 });
  }

  let containerResponse: Response;
  if (body.preparedDeck !== undefined && body.preparedDeck !== deck)
    return Response.json(
      {
        error: "prepared-environment-changed",
        message:
          "The deployment no longer composes this exact prepared deck. Prepare again.",
      },
      { status: 409 },
    );
  try {
    containerResponse = await selected.runner.fetch("http://container/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deck,
        timeoutMs,
        files,
        ...(body.entryPath ? { entryPath: body.entryPath } : {}),
        ...(body.runToken ? { runToken: body.runToken } : {}),
      }),
    });
  } catch (error) {
    return Response.json(
      {
        error: "simulator-unreachable",
        execution,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
  if (containerResponse.status === 401 || containerResponse.status === 403) {
    // The host did not accept this deployment's token. A deployment fact,
    // named as one, so nobody reads it as the circuit being refused.
    return Response.json(
      {
        error: "simulator-unauthorized",
        execution,
        message:
          "The simulator host refused this deployment's credentials; check SIMULATION_UPSTREAM_TOKEN.",
      },
      { status: 502 },
    );
  }
  if (!containerResponse.ok) {
    return Response.json(
      {
        error: "simulator-refused",
        execution,
        status: containerResponse.status,
        ...(await describeRefusal(containerResponse)),
      },
      { status: 502 },
    );
  }

  const raw = (await containerResponse.json()) as {
    log?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    exitCode?: unknown;
    signal?: unknown;
    timedOut?: unknown;
    cancelled?: unknown;
    durationMs?: unknown;
    environment?: unknown;
    // Present once the harness reads back the file a deck wrote. Optional
    // because a deck that never calls `write` leaves nothing to send.
    rawfile?: unknown;
    rawfileFormat?: unknown;
    rawfileRequested?: unknown;
    truncatedOutputs?: unknown;
  };
  const environment = await verifySimulationEnvironmentMetadata(
    raw.environment,
  );
  if (!environment) {
    return Response.json(
      {
        error: "simulator-protocol-invalid",
        execution,
        message: "The simulator did not identify its execution environment.",
      },
      { status: 502 },
    );
  }
  const log = typeof raw.log === "string" ? raw.log : "";
  const rawfileExpected = deckRequestsRawfile(deck);
  // New harnesses report the same fact they used when collecting artifacts.
  // Accept an absent field during a rolling deployment, but never accept an
  // explicit disagreement: one side would otherwise judge a different run
  // contract from the other.
  if (
    typeof raw.rawfileRequested === "boolean" &&
    raw.rawfileRequested !== rawfileExpected
  ) {
    return Response.json(
      {
        error: "simulator-protocol-invalid",
        execution,
        message:
          "The simulator disagreed with the Worker about whether the deck requested a rawfile.",
      },
      { status: 502 },
    );
  }
  const rawfile = typeof raw.rawfile === "string" ? raw.rawfile : null;
  const truncatedOutputs = Array.isArray(raw.truncatedOutputs)
    ? raw.truncatedOutputs
    : [];
  const evaluated = evaluateSimulationRun(
    { rawfile: rawfileExpected ? "required" : "not-required" },
    {
      log,
      ...(typeof raw.stdout === "string" ? { stdout: raw.stdout } : {}),
      ...(typeof raw.stderr === "string" ? { stderr: raw.stderr } : {}),
      exitCode: typeof raw.exitCode === "number" ? raw.exitCode : null,
      signal: typeof raw.signal === "string" ? raw.signal : null,
      timedOut: raw.timedOut === true,
      durationMs: typeof raw.durationMs === "number" ? raw.durationMs : 0,
      rawfile,
      rawfileFormat:
        raw.rawfileFormat === "ascii" || raw.rawfileFormat === "binary"
          ? raw.rawfileFormat
          : null,
      rawfileTruncated: truncatedOutputs.includes("rawfile"),
    },
    { timeoutMs },
  );
  const result: SimulationResult & { execution: HostedExecutionMetadata } = {
    execution,
    outcome: evaluated.outcome,
    diagnostics: evaluated.diagnostics,
    log,
    // Omitted rather than null when there is nothing to carry: the field's
    // contract is that its presence means numbers were read.
    ...(evaluated.data ? { data: evaluated.data } : {}),
    durationMs: typeof raw.durationMs === "number" ? raw.durationMs : 0,
    metadata: {
      schemaVersion: 1,
      input: await createSimulationInputMetadata({
        ...(inputRevision ? { inputRevision } : {}),
        netlist,
        testbench,
        deck,
      }),
      configuration: simulationConfigurationMetadata(modelLibrary),
      environment,
    },
  };
  return Response.json(
    {
      ...result,
      ...(body.runToken
        ? {
            cancelled: raw.cancelled === true,
            executedDeck: deck,
            ...(rawfile !== null ? { rawfile } : {}),
          }
        : {}),
    },
    { status: 200 },
  );
}
