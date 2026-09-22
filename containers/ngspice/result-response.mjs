import { createHash, webcrypto } from "node:crypto";
import {
  assembleNgspiceOutput,
  buildSimulationDeck,
  SIMULATION_EXECUTOR_RESPONSE_MAX_BYTES,
  SIMULATION_EXECUTOR_STREAM_MAX_BYTES,
} from "@icm/spice-run";
import {
  encodeExecutionReceipt,
  EXECUTION_RECEIPT_HEADER,
} from "@icm/simulation-service";
globalThis.crypto ??= webcrypto;

/** Assemble once on the large-memory executor; proxies forward verified bytes. */
export async function ngspiceResultResponse(input, raw, streaming) {
  const context = input.outputContext;
  if (
    !streaming ||
    !context ||
    !/^[0-9a-f-]{36}$/iu.test(input.runToken ?? "")
  ) {
    const body = JSON.stringify(raw);
    if (Buffer.byteLength(body) > SIMULATION_EXECUTOR_RESPONSE_MAX_BYTES)
      return {
        status: 502,
        body: JSON.stringify({
          error: "executor-response-too-large",
          message:
            "The run executed; this legacy client cannot receive its full output. Use the current streaming client.",
        }),
        headers: {},
      };
    return { status: 200, body, headers: {} };
  }
  if (
    typeof context.netlist !== "string" ||
    typeof context.testbench !== "string" ||
    (context.testbench !== input.deck &&
      buildSimulationDeck(context, context.modelLibrary) !== input.deck)
  )
    throw new Error("Output context does not match executed deck");
  const payload = await assembleNgspiceOutput(raw, {
    ...context,
    deck: input.deck,
    collection: input.collection,
    timeoutMs: raw.limits.timeoutMs,
    runToken: input.runToken,
  });
  const collectionStatus =
    raw.truncatedOutputs?.includes("rawfile") ||
    (raw.rawfileRequested && !payload.data)
      ? "partial"
      : "complete";
  const body = JSON.stringify({
    ...payload,
    collectionStatus,
  });
  const byteLength = Buffer.byteLength(body);
  if (byteLength > SIMULATION_EXECUTOR_STREAM_MAX_BYTES)
    return {
      status: 502,
      body: JSON.stringify({
        error: "executor-response-too-large",
        message:
          "The run executed, but its result exceeds the transfer resource budget. No partial numerical result is certified.",
      }),
      headers: {},
    };
  return {
    status: 200,
    body,
    headers: {
      [EXECUTION_RECEIPT_HEADER]: encodeExecutionReceipt({
        schemaVersion: 1,
        runToken: input.runToken,
        byteLength,
        sha256: createHash("sha256").update(body).digest("hex"),
        executedFilesSha256: createHash("sha256")
          .update(JSON.stringify(input.files ?? []))
          .digest("hex"),
        outcome: payload.outcome,
        metadata: payload.metadata,
        ...(payload.execution ? { execution: payload.execution } : {}),
        cancelled: raw.cancelled === true,
        collectionStatus,
      }),
    },
  };
}
