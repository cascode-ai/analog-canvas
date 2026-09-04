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
  classifySimulationOutcome,
  deckNeedsModelLibrary,
  describeExitStatus,
  createSimulationInputMetadata,
  isSimulationInputRevision,
  readNgspiceDiagnostics,
  readSimulationData,
  resolveTimeoutMs,
  SKY130_LIBRARY_PATH,
  SKY130_LIBRARY_SECTION,
  simulationConfigurationMetadata,
  verifySimulationEnvironmentMetadata,
  type ModelLibrarySelection,
  type SimulationResult,
  type SimulationResultData,
} from "@icm/spice-run";

/** What a container-backed runner has to offer this module. */
export interface NgspiceRunner {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export interface SimulationEnv {
  /** Present once Containers is enabled for the account and bound. */
  NGSPICE?: { getByName(name: string): NgspiceRunner };
  /** Where the models live inside the image. */
  SKY130_LIB_PATH?: string;
  /** Section in the sectioned Sky130 library; `tt` when omitted. */
  SKY130_LIB_SECTION?: string;
}

// The continuous (unbinned) Sky130 library the benchmark image ships; the
// binned checkout it also carries caps device width at 100 µm (#551).

/** A deck this large is a mistake upstream, not a simulation worth waking for. */
const MAX_INPUT_BYTES = 2 * 1024 * 1024;

interface SimulationRequestBody {
  netlist?: unknown;
  testbench?: unknown;
  timeoutMs?: unknown;
  inputRevision?: unknown;
}

/**
 * A container instance per author, so one person's long analysis never queues
 * behind another's. The name is opaque; nothing about a run is kept between
 * runs, because a woken container starts with a fresh disk.
 */
function runnerFor(env: SimulationEnv, key: string): NgspiceRunner | null {
  return env.NGSPICE ? env.NGSPICE.getByName(key) : null;
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
  runnerKey = "shared",
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/simulate") return null;
  if (request.method !== "POST") {
    return Response.json({ error: "method-not-allowed" }, { status: 405 });
  }

  const runner = runnerFor(env, runnerKey);
  if (!runner) {
    // Deployment state, not circuit state. Said plainly so an author is not
    // left wondering what is wrong with their design.
    return Response.json(
      {
        error: "simulation-not-configured",
        message:
          "This deployment has no simulation container bound, so no circuit can be run here.",
      },
      { status: 503 },
    );
  }

  let body: SimulationRequestBody;
  try {
    body = (await request.json()) as SimulationRequestBody;
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const netlist = typeof body.netlist === "string" ? body.netlist : null;
  const testbench = typeof body.testbench === "string" ? body.testbench : null;
  if (
    !netlist ||
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
    deck = buildSimulationDeck({ netlist, testbench }, modelLibrary);
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
  try {
    containerResponse = await runner.fetch("http://container/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deck, timeoutMs }),
    });
  } catch (error) {
    return Response.json(
      {
        error: "simulator-unreachable",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
  if (!containerResponse.ok) {
    return Response.json(
      {
        error: "simulator-refused",
        status: containerResponse.status,
        ...(await describeRefusal(containerResponse)),
      },
      { status: 502 },
    );
  }

  const raw = (await containerResponse.json()) as {
    log?: unknown;
    exitCode?: unknown;
    signal?: unknown;
    timedOut?: unknown;
    durationMs?: unknown;
    environment?: unknown;
    // Present once the harness reads back the file a deck wrote. Optional
    // because a deck that never calls `write` leaves nothing to send.
    rawfile?: unknown;
    rawfileFormat?: unknown;
  };
  const environment = await verifySimulationEnvironmentMetadata(
    raw.environment,
  );
  if (!environment) {
    return Response.json(
      {
        error: "simulator-protocol-invalid",
        message: "The simulator did not identify its execution environment.",
      },
      { status: 502 },
    );
  }
  const log = typeof raw.log === "string" ? raw.log : "";
  const diagnostics = readNgspiceDiagnostics(log);
  const timedOut = raw.timedOut === true;
  // A simulator that died by a signal, or that printed nothing at all,
  // did not complete: a batch run always prints at least its banner and
  // the analysis it did. Exit 0 with no output was measured on 2026-09-04
  // when the kernel killed ngspice mid-corner-load; it must never read as
  // success (ADR 0055 amendment, item 10).
  if (!timedOut && typeof raw.signal === "string" && raw.signal) {
    diagnostics.push({
      severity: "error",
      text: `The simulator was terminated by ${raw.signal} before it finished.`,
    });
  } else if (!timedOut && log.trim().length === 0) {
    diagnostics.push({
      severity: "error",
      text: "The simulator produced no output, so this run has no result.",
    });
  }
  // The numbers, when the harness sent a rawfile back.
  //
  // This is where a simulation stops being a wall of console text. Until it
  // was wired up, `@icm/spice-run` could read a rawfile and nothing asked it
  // to: the route returned `log` and the editor had no numbers to draw. A
  // deck that never calls `write` still returns no data, and that is a fact
  // about the testbench rather than a failure.
  //
  // The reading's own diagnostics join the run's, which is what finally makes
  // the outcome depend on whether the measurements came back. `#568` could
  // only stop an exit code from condemning a correct run; this is the other
  // half — a run that printed a batch log and wrote no vectors is now the
  // failure it always was, where an exit code of zero called it a success.
  let data: SimulationResultData | undefined;
  const rawfile = typeof raw.rawfile === "string" ? raw.rawfile : null;
  if (raw.rawfileFormat === "binary") {
    diagnostics.push({
      severity: "error",
      text:
        "The simulator wrote a binary rawfile, which carries no numbers this " +
        "reader can use. Put `set filetype=ascii` before `write`.",
    });
  } else if (rawfile !== null && rawfile.trim().length > 0) {
    const reading = readSimulationData(rawfile);
    diagnostics.push(...reading.diagnostics);
    if (reading.status === "read") data = reading.data;
  }
  // Reported, never decisive: see describeExitStatus. Pushed after the checks
  // above so a signal or a silent run still reads as the error it is.
  const exitStatus = describeExitStatus(
    typeof raw.exitCode === "number" ? raw.exitCode : null,
  );
  if (exitStatus) diagnostics.push(exitStatus);
  const result: SimulationResult = {
    outcome: classifySimulationOutcome(diagnostics, {
      timedOut,
      timeoutMs,
    }),
    diagnostics,
    log,
    // Omitted rather than null when there is nothing to carry: the field's
    // contract is that its presence means numbers were read.
    ...(data ? { data } : {}),
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
  return Response.json(result, { status: 200 });
}
