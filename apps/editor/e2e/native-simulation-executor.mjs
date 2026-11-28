import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assembleNativeExecutionOutput } from "@icm/simulation-service";
import { createSimulationEnvironmentMetadata } from "@icm/spice-run";

export const agentNativeSource = readFileSync(
  resolve("netlists/vacask-agent-divider/agent.sim"),
  "utf8",
);
export const agentNativeProfile = "agent-native-divider";

// Replays unedited native evidence through the public browser compiler/result
// service while VACASK engine removal completes in its dedicated follow-up.
export async function createAgentNativeExecutor() {
  const limits = {
    maxInputFiles: 24,
    maxInputBytes: 1048576,
    maxOutputBytes: 1048576,
  };
  const capabilities = {
    configured: true,
    rawfileCollection: "native-multi-ascii",
    inputs: ["source"],
    analyses: ["op", "ac"],
    parsedAnalyses: ["op", "ac"],
    profiles: [{ id: agentNativeProfile, corners: [] }],
    maxTimeoutMs: 15000,
    maxInputFiles: limits.maxInputFiles,
    maxInputBytes: limits.maxInputBytes,
    maxOutputBytes: limits.maxOutputBytes,
    cancel: false,
  };
  const environment = await createSimulationEnvironmentMetadata({
    executor: "local-host",
    reproducibility: "observed",
    profileId: agentNativeProfile,
    platform: "win32/x64",
    simulator: { name: "vacask", version: "0.3.4", binarySha256: null },
    models: null,
    startupSha256: null,
  });
  return {
    capabilities,
    // Test-owned runtime identity exists before submission, independently of
    // the run under inspection. Acceptance must not trust its own result.
    environment,
    async execute(input) {
      if (input.language !== "vacask")
        throw new Error("Expected native input.");
      // Never replay valid records for an unrelated or broken authored deck.
      if (
        input.files.find((f) => f.path === input.entryPath)?.text !==
        agentNativeSource
      )
        throw new Error(
          "Captured evidence requires the exact native fixture source.",
        );
      const output = await assembleNativeExecutionOutput(
        input,
        {
          execution: {
            stdout:
              "Running analysis 'agent_op'.\n  Elapsed time: 0.001\nRunning analysis 'agent_ac'.\n  Elapsed time: 0.001\n",
            stderr: "",
            exitCode: 0,
            signal: null,
            timedOut: false,
            cancelled: false,
            spawnError: null,
            durationMs: 1,
          },
          timeoutMs: 15000,
          rawfiles: await Promise.all(
            ["agent_op", "agent_ac"].map(async (name) => ({
              path: `${name}.raw`,
              text: await readFile(
                resolve(`netlists/vacask-agent-divider/${name}.raw`),
                "utf8",
              ),
            })),
          ),
          executedFiles: input.files,
          diagnostics: [],
          truncated: false,
        },
        environment,
      );
      return {
        ...output.result,
        rawfiles: output.rawfiles,
        executedFiles: output.executedFiles,
        cancelled: output.cancelled,
        collectionStatus: output.collectionStatus,
      };
    },
    async close() {},
  };
}
