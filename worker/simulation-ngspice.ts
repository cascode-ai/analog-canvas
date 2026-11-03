/**
 * The simulation route: a netlist and the author's testbench in, ngspice's
 * answer out.
 *
 * The Worker cannot run ngspice — a V8 isolate executes JavaScript and
 * WebAssembly, never a native binary — so the run happens in a container and
 * this module is the boundary in front of it. It adds nothing to the circuit
 * and interprets nothing about it: Simulation rationale puts the testbench in the
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
  assembleNgspiceOutput,
  NGSPICE_MAX_RAWFILE_BYTES,
  SIMULATION_EXECUTOR_TRANSFER_HEADER,
  createSimulationInputMetadata,
  isSimulationInputRevision,
  resolveTimeoutMs,
  simulationConfigurationMetadata,
  verifySimulationEnvironmentMetadata,
  type ModelLibrarySelection,
} from "@icm/spice-run";
import {
  CAPABILITIES_ACCEPT_CELL_LIBRARIES,
  CAPABILITIES_ACCEPT_CELL_MASTERS,
  readExecutionReceipt,
  encodeExecutionReceipt,
  EXECUTION_RECEIPT_HEADER,
  boundExecutionStream,
  sha256,
} from "@icm/simulation-service";
import hostedSky130Profile from "../containers/ngspice/hosted-sky130-profile.json" with { type: "json" };
import { isSimulationInputPath } from "@icm/model";

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
const DEFAULT_MAX_OUTPUT_BYTES = NGSPICE_MAX_RAWFILE_BYTES;

function advertisedMaxOutputBytes(env: SimulationEnv): number {
  const configured = Number(env.SIMULATION_MAX_OUTPUT_BYTES);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_OUTPUT_BYTES;
}

export type NgspiceProfile = Omit<
  typeof hostedSky130Profile,
  "cellLibraries"
> & {
  cellLibraries: ((typeof hostedSky130Profile.cellLibraries)[number] & {
    masters?: string[];
  })[];
};

async function matchesProfile(value: unknown, profile: NgspiceProfile) {
  const actual = await verifySimulationEnvironmentMetadata(value);
  return (
    !!actual &&
    actual.executor === "hosted-container" &&
    actual.reproducibility === "pinned" &&
    actual.profileId === profile.id &&
    actual.platform === profile.platform &&
    actual.simulator.name === profile.simulator.name &&
    actual.simulator.version === profile.simulator.version &&
    actual.simulator.binarySha256 === profile.simulator.binarySha256 &&
    actual.models?.id === profile.models.id &&
    actual.models.contentSha256 === profile.models.contentSha256 &&
    actual.startupSha256 === profile.startup.contentSha256
  );
}

export interface SimulationRequestBody {
  operation?: unknown;
  /** What a capabilities caller understands beyond the original shape. */
  accepts?: unknown;
  mode?: unknown;
  environment?: {
    profileId?: unknown;
    corner?: unknown;
    temperatureC?: unknown;
  };
  files?: unknown;
  dependencies?: unknown;
  entryPath?: unknown;
  runToken?: unknown;
  preparedDeck?: unknown;
  collection?: unknown;
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
      const target = new URL(
        new URL(input).pathname.slice(1),
        `${base.replace(/\/$/u, "")}/`,
      );
      const headers = new Headers(init?.headers);
      if (token) headers.set("authorization", `Bearer ${token}`);
      return fetch(target, { ...init, headers, redirect: "manual" });
    },
  };
}

/**
 * Resolve one explicitly named executor. A configured deployment may register
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

export async function routeNgspiceSimulationRequest(
  request: Request,
  env: SimulationEnv,
  runnerKey: string | undefined = undefined,
  profile: NgspiceProfile = hostedSky130Profile,
): Promise<Response | null> {
  const modelDependency = {
    id: profile.models.id,
    sha256: profile.models.contentSha256,
  };
  const cellLibrariesAvailable = profile.cellLibraries.map((library) => ({
    id: library.id,
    sha256: library.contentSha256,
    cells: library.cells,
    ...(library.masters ? { masters: library.masters } : {}),
    directive: library.library.directive as "include",
  }));
  const profileDependencies = [modelDependency, ...cellLibrariesAvailable];
  const isCellLibrary = (dependency: { id: unknown; sha256: unknown }) =>
    cellLibrariesAvailable.some(
      (library) =>
        library.id === dependency.id && library.sha256 === dependency.sha256,
    );
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
  const selected = runnerFor(env, runnerKey ?? `profile:${profile.id}`, target);
  const defaultCorner =
    env.SKY130_LIB_SECTION ?? profile.models.library.sections[0]!;
  if (!profile.qualifiedScope.sections.includes(defaultCorner))
    return Response.json(
      {
        error: "simulation-executor-configuration-invalid",
        message: `SKY130_LIB_SECTION does not name a qualified corner: ${defaultCorner}`,
      },
      { status: 503 },
    );
  if (body.operation === "capabilities") {
    // The running collector is authoritative, including during a rolling deploy.
    let outputBytes = advertisedMaxOutputBytes(env);
    // New model Profiles stay undiscoverable until the executor proves its
    // identity. Preserve the historical SKY130 offline discovery contract.
    let ready = profile.id === hostedSky130Profile.id && !!selected;
    // Only the cell libraries the running simulator measured are offered: a
    // host that predates them, or does not answer, offers none (#1596).
    let mounted: unknown[] = [];
    if (selected) {
      try {
        const health = await selected.runner.fetch("http://container/health", {
          signal: AbortSignal.timeout(5000),
        });
        const facts = (await health.json()) as {
          status?: unknown;
          environment?: unknown;
          limits?: { outputBytes?: number };
          dependencies?: unknown;
        };
        if (
          health.ok &&
          facts.status === "ready" &&
          (await matchesProfile(facts.environment, profile))
        )
          ready = true;
        if (
          Number.isSafeInteger(facts.limits?.outputBytes) &&
          facts.limits!.outputBytes! > 0
        )
          outputBytes = facts.limits!.outputBytes!;
        if (Array.isArray(facts.dependencies)) mounted = facts.dependencies;
      } catch {
        /* Keep the configured declaration when health is unavailable. */
      }
    }
    // A client that predates cell libraries parses a strict shape and asks
    // for none; it keeps that shape, and its single model dependency.
    const accepts = Array.isArray(body.accepts) ? body.accepts : [];
    const cellLibraries = accepts.includes(CAPABILITIES_ACCEPT_CELL_LIBRARIES)
      ? {
          cellLibraries: cellLibrariesAvailable.filter(
            (library) =>
              (!library.masters ||
                accepts.includes(CAPABILITIES_ACCEPT_CELL_MASTERS)) &&
              mounted.some(
                (item) =>
                  !!item &&
                  typeof item === "object" &&
                  (item as { id?: unknown }).id === library.id &&
                  (item as { sha256?: unknown }).sha256 === library.sha256,
              ),
          ),
        }
      : {};
    return Response.json({
      configured: ready,
      rawfileCollection: "declared-single-ascii",
      maxInputFiles: 24,
      inputs: ["structured", "raw"],
      analyses: profile.qualifiedScope.analyses,
      parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
      profiles: [
        {
          id: profile.id,
          label: profile.displayName ?? profile.id,
          corners: profile.qualifiedScope.sections,
          devices: profile.qualifiedScope.devices,
          dependencies: [modelDependency],
          ...cellLibraries,
        },
      ],
      modelLibrary: {
        path: env.SKY130_LIB_PATH ?? profile.models.library.runtimePath,
        section: defaultCorner,
      },
      maxTimeoutMs: 120000,
      maxInputBytes: MAX_INPUT_BYTES,
      maxOutputBytes: outputBytes,
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
    (body.environment.profileId !== profile.id ||
      (body.environment.corner !== undefined &&
        (typeof body.environment.corner !== "string" ||
          !profile.qualifiedScope.sections.includes(body.environment.corner))))
  )
    return Response.json(
      { error: "simulation-profile-unavailable" },
      { status: 400 },
    );
  const files = body.files ?? [];
  const dependencies = body.dependencies ?? [];
  const safePath = (p: unknown): p is string =>
    typeof p === "string" && isSimulationInputPath(p);
  if (
    !Array.isArray(files) ||
    files.length > 24 ||
    files.some((f) => !f || !safePath(f.path) || typeof f.text !== "string") ||
    files.reduce((n, f) => n + new TextEncoder().encode(f.text).length, 0) >
      MAX_INPUT_BYTES ||
    !Array.isArray(dependencies) ||
    dependencies.length > 24 ||
    dependencies.some(
      (dependency) =>
        !dependency ||
        !profileDependencies.some(
          (available) =>
            available.id === dependency.id &&
            available.sha256 === dependency.sha256,
        ) ||
        !safePath(dependency.mountPath),
    ) ||
    dependencies.some((dependency, index) =>
      dependencies.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index &&
          candidate.mountPath === dependency.mountPath,
      ),
    ) ||
    dependencies.some((dependency) =>
      files.some((file) => file.path === dependency.mountPath),
    ) ||
    (dependencies.length > 0 && body.mode !== "raw") ||
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
    modelLibrary =
      profile.id !== hostedSky130Profile.id ||
      deckNeedsModelLibrary(`${netlist}\n${testbench}`)
        ? {
            directive: "lib",
            path: env.SKY130_LIB_PATH ?? profile.models.library.runtimePath,
            section:
              (body.environment?.corner as string | undefined) ?? defaultCorner,
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
  const collection = body.collection as { rawfile?: unknown } | undefined;
  if (
    collection !== undefined &&
    (!collection ||
      typeof collection !== "object" ||
      Array.isArray(collection) ||
      Object.keys(collection).length !== 1 ||
      !("rawfile" in collection) ||
      (collection.rawfile !== null &&
        (!safePath(collection.rawfile) ||
          [
            body.entryPath ?? "deck.cir",
            ".spiceinit",
            ...files.map((f) => f.path),
            ...dependencies.map((d) => d.mountPath),
          ].some(
            (path) =>
              path === collection.rawfile ||
              String(path).startsWith(`${collection.rawfile}/`) ||
              String(collection.rawfile).startsWith(`${path}/`),
          ))))
  )
    return Response.json(
      { error: "invalid-output-collection" },
      { status: 400 },
    );

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
      headers: {
        "content-type": "application/json",
        [SIMULATION_EXECUTOR_TRANSFER_HEADER]: "receipt-v1",
      },
      body: JSON.stringify({
        deck,
        outputContext: {
          netlist,
          testbench,
          inputRevision,
          modelLibrary,
          execution,
        },
        timeoutMs,
        files,
        dependencies,
        ...(collection === undefined ? {} : { collection }),
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

  try {
    const receipt = readExecutionReceipt(
      containerResponse.headers.get(EXECUTION_RECEIPT_HEADER),
    );
    if (receipt) {
      const expected = await createSimulationInputMetadata({
        netlist,
        testbench,
        deck,
        ...(inputRevision ? { inputRevision } : {}),
      });
      const actual = await verifySimulationEnvironmentMetadata(
        receipt.metadata.environment,
      );
      if (
        !containerResponse.body ||
        receipt.runToken !== body.runToken ||
        receipt.execution?.target !== target ||
        !actual ||
        actual.executor !== "hosted-container" ||
        actual.reproducibility !== "pinned" ||
        actual.profileId !== profile.id ||
        actual.platform !== profile.platform ||
        actual.simulator.version !== profile.simulator.version ||
        actual.simulator.binarySha256 !== profile.simulator.binarySha256 ||
        actual.models?.id !== profile.models.id ||
        actual.models?.contentSha256 !== profile.models.contentSha256 ||
        actual.startupSha256 !== profile.startup.contentSha256 ||
        actual.simulator.name !== "ngspice" ||
        Object.entries(expected).some(
          ([key, value]) =>
            receipt.metadata.input[key as keyof typeof expected] !== value,
        ) ||
        receipt.executedFilesSha256 !== (await sha256(JSON.stringify(files))) ||
        // The cell libraries this run mounted, as the executor measured them.
        JSON.stringify(receipt.cellLibraries ?? []) !==
          JSON.stringify(
            dependencies
              .filter(isCellLibrary)
              .map(({ id, sha256 }) => ({ id, sha256 })),
          ) ||
        JSON.stringify(receipt.metadata.configuration) !==
          JSON.stringify(simulationConfigurationMetadata(modelLibrary))
      )
        throw new Error("Changed streaming input/runtime evidence");
      return new Response(
        boundExecutionStream(containerResponse.body, receipt.byteLength),
        {
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
            [EXECUTION_RECEIPT_HEADER]: encodeExecutionReceipt(receipt),
          },
        },
      );
    }
    const payload = (await containerResponse.json()) as {
      environment?: unknown;
    };
    if (
      profile.id !== hostedSky130Profile.id &&
      !(await matchesProfile(payload.environment, profile))
    )
      throw new Error("Simulation result does not match the selected Profile");
    return Response.json(
      await assembleNgspiceOutput(payload, {
        netlist,
        testbench,
        deck,
        inputRevision,
        timeoutMs,
        modelLibrary,
        collection,
        execution,
        runToken: body.runToken,
        // The deck and these files are everything this run sent; the
        // Profile's library is mounted beside them. Without them every
        // notice about a library model card would count as dropped input.
        files,
      }),
    );
  } catch (error) {
    await containerResponse.body?.cancel().catch(() => undefined);
    return Response.json(
      {
        error: "simulator-protocol-invalid",
        execution,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
