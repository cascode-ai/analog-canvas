import { deckRequestsRawfile } from "./deck.js";
import { evaluateSimulationRun } from "./verdict.js";
import {
  createSimulationInputMetadata,
  simulationConfigurationMetadata,
  verifySimulationEnvironmentMetadata,
} from "./metadata.js";
import type { ModelLibrarySelection, SimulationResult } from "./contract.js";

export interface NgspiceOutputContext {
  netlist: string;
  testbench: string;
  deck: string;
  inputRevision?: string | undefined;
  timeoutMs: number;
  modelLibrary: ModelLibrarySelection | null;
  collection?: { rawfile?: unknown } | undefined;
  runToken?: unknown;
  execution?: { target: "cloudflare-container" | "operator-host" };
}

export interface NgspiceRawOutput {
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
  rawfileName?: unknown;
  collection?: { rawfile?: unknown };
  rawfileError?: unknown;
  truncatedOutputs?: unknown;
}

/** Same numerical/collection verdict on the executor and legacy Worker path. */
export async function assembleNgspiceOutput(
  raw: NgspiceRawOutput,
  context: NgspiceOutputContext,
) {
  const {
    netlist,
    testbench,
    deck,
    inputRevision,
    timeoutMs,
    modelLibrary,
    collection,
    runToken,
    execution,
  } = context;
  const environment = await verifySimulationEnvironmentMetadata(
    raw.environment,
  );
  if (!environment) {
    throw new Error(
      "The simulator did not identify its execution environment.",
    );
  }
  const log = typeof raw.log === "string" ? raw.log : "";
  const rawfileExpected =
    collection === undefined
      ? deckRequestsRawfile(deck)
      : collection.rawfile !== null;
  if (
    collection !== undefined &&
    (raw.collection?.rawfile !== collection.rawfile ||
      raw.rawfileRequested !== rawfileExpected ||
      ((typeof raw.rawfile === "string" || raw.rawfileFormat === "binary") &&
        (collection.rawfile === null ||
          raw.rawfileName !== collection.rawfile)))
  )
    throw new Error(
      "The executor did not honor the declared output collection. Update the harness and prepare again.",
    );
  // New harnesses report the same fact they used when collecting artifacts.
  // Accept an absent field during a rolling deployment, but never accept an
  // explicit disagreement: one side would otherwise judge a different run
  // contract from the other.
  if (
    typeof raw.rawfileRequested === "boolean" &&
    raw.rawfileRequested !== rawfileExpected
  ) {
    throw new Error(
      "The simulator disagreed with the Worker about whether the deck requested a rawfile.",
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
  const result: SimulationResult & {
    execution?: NgspiceOutputContext["execution"];
  } = {
    ...(execution ? { execution } : {}),
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
  return {
    ...result,
    ...(runToken
      ? {
          cancelled: raw.cancelled === true,
          executedDeck: deck,
          ...(rawfile !== null ? { rawfile } : {}),
        }
      : {}),
  };
}
