import type { LocalWorkspace } from "./local-workspace.js";

/** Task receipt, not a replacement for the complete on-disk registration. */
export function workspaceSyncReceipt(
  result: Awaited<ReturnType<LocalWorkspace["sync"]>>,
) {
  const { runs: _history, files, ...current } = result;
  // Small selections are directly usable; archives have their complete index.
  const inline = files.length <= 16;
  return {
    ...current,
    files: inline
      ? files.map(({ id, outputPath, reused, timing }) => ({
          id,
          outputPath,
          reused,
          timing,
        }))
      : [],
    filesOmitted: inline ? 0 : files.length,
    projection: "summary",
    fileMetadata: { indexPath: result.indexPath, runId: result.runId },
  };
}
