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
  createSimulationInputMetadata,
  isSimulationInputRevision,
  readNgspiceRun,
  resolveTimeoutMs,
  simulationConfigurationMetadata,
  verifySimulationEnvironmentMetadata,
  type ModelLibrarySelection,
  type SimulationResult,
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

const DEFAULT_LIB_PATH =
  "/opt/sky130/sky130A/libs.tech/ngspice/sky130.lib.spice";
const DEFAULT_LIB_SECTION = "tt";

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
          path: env.SKY130_LIB_PATH ?? DEFAULT_LIB_PATH,
          section: env.SKY130_LIB_SECTION ?? DEFAULT_LIB_SECTION,
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
      { error: "simulator-refused", status: containerResponse.status },
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
  // What ngspice said and what it produced decide the outcome together, in
  // the one place both surfaces share, so a failure always arrives with a
  // reason and a run that returned its measurements is never called failed.
  const { outcome, diagnostics } = readNgspiceRun({
    log,
    exitCode: typeof raw.exitCode === "number" ? raw.exitCode : null,
    signal: typeof raw.signal === "string" && raw.signal ? raw.signal : null,
    timedOut: raw.timedOut === true,
    timeoutMs,
  });
  const result: SimulationResult = {
    outcome,
    diagnostics,
    log,
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
