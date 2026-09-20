import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
} from "@icm/spice-run";
import type { ExecutionInput } from "@icm/simulation-service";
import {
  encodeExecutionReceipt,
  EXECUTION_RECEIPT_HEADER,
  sha256,
} from "@icm/simulation-service";
import type { SimulationEnv, SimulationRunner } from "./simulation";

/** Protocol-only fixture. These fake digests certify no model or deployment. */
export const nativeEnvironment = await createSimulationEnvironmentMetadata({
  executor: "hosted-container",
  reproducibility: "pinned",
  profileId: "native-test-v1",
  platform: "linux/x64",
  simulator: { name: "vacask", version: "0.3.4", binarySha256: "a".repeat(64) },
  models: { id: "test-modules", contentSha256: "b".repeat(64) },
  startupSha256: "c".repeat(64),
});
export const nativeCapabilities = {
  configured: true,
  rawfileCollection: "native-multi-ascii",
  inputs: ["source"],
  analyses: ["op", "dc", "ac", "tran", "noise"],
  parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
  profiles: [
    {
      id: nativeEnvironment.profileId!,
      corners: ["tt", "ss"],
      dependencies: [{ id: "models", sha256: "d".repeat(64) }],
    },
  ],
  maxInputFiles: 24,
  maxInputBytes: 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxTimeoutMs: 120000,
  cancel: true,
};
export const nativeHealth = {
  status: "ready",
  environment: nativeEnvironment,
  capabilities: nativeCapabilities,
};
export function nativeInput(): ExecutionInput {
  const text = "Native protocol proof\ncontrol\nendc\n";
  return {
    language: "vacask",
    mode: "raw",
    netlist: "",
    testbench: text,
    preparedDeck: text,
    entryPath: "run.sim",
    inputRevision: "revision-a",
    environment: { profileId: nativeEnvironment.profileId!, corner: "tt" },
    files: [{ path: "run.sim", text }],
    dependencies: [],
    collection: { kind: "native-multi-ascii" },
  };
}
export async function nativeReply(input = nativeInput()) {
  return {
    outcome: { status: "completed" },
    diagnostics: [],
    log: "protocol fixture",
    durationMs: 1,
    metadata: {
      schemaVersion: 1,
      configuration: { modelLibrary: null },
      environment: nativeEnvironment,
      input: await createSimulationInputMetadata({
        inputRevision: input.inputRevision,
        netlist: "",
        testbench: input.testbench,
        deck: input.preparedDeck!,
      }),
    },
    rawfiles: [],
    executedFiles: input.files,
    cancelled: false,
  };
}
export function nativeWorkerEnv(
  run?: SimulationRunner["fetch"],
): SimulationEnv & { VACASK: NonNullable<SimulationEnv["VACASK"]> } {
  return {
    SIMULATION_PROFILE_ID: nativeEnvironment.profileId!,
    VACASK: {
      getByName: () => ({
        fetch: async (url, init) =>
          new URL(url).pathname === "/health"
            ? Response.json(nativeHealth)
            : run
              ? run(url, init)
              : Response.json(
                  await nativeReply(JSON.parse(String(init?.body))),
                ),
      }),
    },
  };
}

export async function nativeStreamingReply(
  input: ExecutionInput & {
    runToken: string;
    execution: { target: "cloudflare-container" | "operator-host" };
  },
  corrupt = false,
) {
  const payload = {
    ...(await nativeReply(input)),
    collectionStatus: "complete",
    execution: input.execution,
  };
  const text = JSON.stringify(payload);
  return new Response(corrupt ? text.replace("protocol", "tampered") : text, {
    headers: {
      "content-type": "application/json",
      [EXECUTION_RECEIPT_HEADER]: encodeExecutionReceipt({
        schemaVersion: 1,
        runToken: input.runToken,
        byteLength: new TextEncoder().encode(text).length,
        sha256: await sha256(text),
        executedFilesSha256: await sha256(
          JSON.stringify(payload.executedFiles),
        ),
        metadata: payload.metadata,
        outcome: payload.outcome,
        execution: input.execution,
        cancelled: false,
        collectionStatus: "complete",
      }),
    },
  });
}
