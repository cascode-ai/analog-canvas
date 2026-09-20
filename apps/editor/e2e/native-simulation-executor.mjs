import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assembleNativeExecutionOutput } from "@icm/simulation-service";
import { createSimulationEnvironmentMetadata } from "@icm/spice-run";
import { executeVacask } from "../../../containers/vacask/execute.mjs";
import { initializeVacaskRuntime } from "../../../containers/vacask/runtime.mjs";
import { SimulationRunSupervisor } from "../../../containers/ngspice/run-supervisor.mjs";

export const agentNativeSource = readFileSync(
  resolve("netlists/vacask-agent-divider/agent.sim"),
  "utf8",
);
export const agentNativeProfile = "agent-native-divider";

// Both modes exercise the public browser compiler/result service. Default CI
// replays unedited native evidence, not fabricated numbers. Explicit real mode
// executes the same prepared input and refuses missing executable configuration.
// WebSocket Agent transport is still a test peer, not public MCP acceptance.
export async function createAgentNativeExecutor({
  largeTransient = false,
} = {}) {
  const live = process.env.ICM_E2E_VACASK_REAL === "1";
  if (largeTransient && !live)
    throw new Error("Large transient requires real execution");
  const limits = {
    maxInputFiles: 24,
    maxInputBytes: 1048576,
    maxOutputBytes: largeTransient ? 64 * 1024 * 1024 : 1048576,
    maxLogBytes: 65536,
    maxRawFiles: 16,
    maxEntries: 256,
  };
  const capabilities = {
    configured: true,
    rawfileCollection: "native-multi-ascii",
    inputs: ["source"],
    analyses: largeTransient ? ["op", "ac", "tran"] : ["op", "ac"],
    parsedAnalyses: largeTransient ? ["op", "ac", "tran"] : ["op", "ac"],
    profiles: [{ id: agentNativeProfile, corners: [] }],
    maxTimeoutMs: 15000,
    maxInputFiles: limits.maxInputFiles,
    maxInputBytes: limits.maxInputBytes,
    maxOutputBytes: limits.maxOutputBytes,
    cancel: false,
  };
  let root, runtime;
  const supervisor = new SimulationRunSupervisor({ maxTimeoutMs: 15000 });
  try {
    if (live) {
      if (!process.env.VACASK_BIN || !process.env.VACASK_MODULES)
        throw new Error(
          "Real browser journey requires VACASK_BIN and VACASK_MODULES.",
        );
      root = await mkdtemp(join(tmpdir(), "icm-agent-native-"));
      const startupPath = join(root, "startup.toml");
      await writeFile(startupPath, "# Controlled local browser proof\n");
      runtime = await initializeVacaskRuntime({
        executor: "local-host",
        profileId: agentNativeProfile,
        binary: resolve(process.env.VACASK_BIN),
        modules: resolve(process.env.VACASK_MODULES),
        startupPath,
        runRoot: root,
        ...(process.env.ICM_VACASK_LIBRARY_PATH
          ? { libraryPath: process.env.ICM_VACASK_LIBRARY_PATH }
          : {}),
      });
    }
    const environment =
      runtime?.environment ??
      (await createSimulationEnvironmentMetadata({
        executor: "local-host",
        reproducibility: "observed",
        profileId: agentNativeProfile,
        platform: "win32/x64",
        simulator: { name: "vacask", version: "0.3.4", binarySha256: null },
        models: null,
        startupSha256: null,
      }));
    return {
      capabilities,
      // Test-owned runtime identity exists before submission, independently of
      // the run under inspection. Acceptance must not trust its own result.
      environment,
      async execute(input) {
        if (input.language !== "vacask")
          throw new Error("Expected native input.");
        let output;
        if (runtime) {
          const reply = await executeVacask(input, runtime, limits, supervisor);
          if (!reply.ok) throw new Error(JSON.stringify(reply));
          output = reply.output;
        } else {
          // Never replay valid records for an unrelated or broken authored deck.
          if (
            input.files.find((f) => f.path === input.entryPath)?.text !==
            agentNativeSource
          )
            throw new Error(
              "Captured evidence requires the exact native fixture source.",
            );
          output = await assembleNativeExecutionOutput(
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
        }
        return {
          ...output.result,
          rawfiles: output.rawfiles,
          executedFiles: output.executedFiles,
          cancelled: output.cancelled,
          collectionStatus: output.collectionStatus,
        };
      },
      async close() {
        await supervisor.shutdown();
        if (root) await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (root) await rm(root, { recursive: true, force: true });
    throw error;
  }
}
