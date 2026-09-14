import { assembleNativeExecutionOutput } from "@icm/simulation-service";
import { runVacaskJob, validateVacaskJob } from "./run-job.mjs";

/** One adapter for native local/hosted execution. No metadata or numeric result
 * is assembled by a GUI/MCP caller. Admission Problems remain repairable replies;
 * an admitted process failure returns its truthful result and original files. */
export async function executeVacask(input, runtime, limits, supervisor) {
  const checked = validateVacaskJob(input, runtime, limits);
  if (!checked.ok) return checked;
  const snapshot = {
    language: input.language,
    mode: input.mode,
    netlist: input.netlist,
    testbench: input.testbench,
    inputRevision: input.inputRevision,
    environment: { ...input.environment },
    entryPath: input.entryPath,
    preparedDeck: input.preparedDeck,
    collection: { ...input.collection },
    files: input.files.map(({ path, text }) => ({ path, text })),
    dependencies: input.dependencies.map(({ id, mountPath, sha256 }) => ({
      id,
      mountPath,
      sha256,
    })),
    timeoutMs: input.timeoutMs,
    runToken: input.runToken,
  };
  const job = await runVacaskJob(snapshot, runtime, limits, supervisor);
  if (!job.ok) return job;
  return {
    ok: true,
    output: await assembleNativeExecutionOutput(
      snapshot,
      job,
      runtime.environment,
    ),
  };
}
