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
  readNgspiceDiagnostics,
  resolveTimeoutMs,
  type SimulationResult,
} from "./simulation-contract";

/** What a container-backed runner has to offer this module. */
export interface NgspiceRunner {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export interface SimulationEnv {
  /** Present once Containers is enabled for the account and bound. */
  NGSPICE?: { getByName(name: string): NgspiceRunner };
  /** Where the models live inside the image. */
  SKY130_LIB_PATH?: string;
}

const DEFAULT_LIB_PATH =
  "/opt/sky130/sky130A/libs.tech/ngspice/sky130.lib.spice";

/** A deck this large is a mistake upstream, not a simulation worth waking for. */
const MAX_INPUT_BYTES = 2 * 1024 * 1024;

interface SimulationRequestBody {
  netlist?: unknown;
  testbench?: unknown;
  timeoutMs?: unknown;
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
  if (!netlist || !testbench) {
    return Response.json(
      {
        error: "invalid-request",
        message:
          "A simulation needs a circuit netlist and the testbench you wrote for it.",
      },
      { status: 400 },
    );
  }

  const timeoutMs = resolveTimeoutMs(
    typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
  );
  const deck = buildSimulationDeck(
    { netlist, testbench },
    env.SKY130_LIB_PATH ?? DEFAULT_LIB_PATH,
  );
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
    timedOut?: unknown;
    durationMs?: unknown;
  };
  const log = typeof raw.log === "string" ? raw.log : "";
  const diagnostics = readNgspiceDiagnostics(log);
  const result: SimulationResult = {
    outcome: classifySimulationOutcome(diagnostics, {
      timedOut: raw.timedOut === true,
      timeoutMs,
      exitCode: typeof raw.exitCode === "number" ? raw.exitCode : null,
    }),
    diagnostics,
    log,
    durationMs: typeof raw.durationMs === "number" ? raw.durationMs : 0,
  };
  return Response.json(result, { status: 200 });
}
