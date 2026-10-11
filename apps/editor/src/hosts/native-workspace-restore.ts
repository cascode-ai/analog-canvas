import type { ProjectFileSession } from "../document/use-project-file-lifecycle";
import {
  browserWorkspaceStore,
  workspaceWindowId,
  type ProjectWorkspace,
} from "../document/project-workspace";
import { resumeNativeFile } from "./native-project-store";

/** Desktop has one main window. Reopen its last workspace, then reacquire file
 * grants from remembered targets and acknowledged baselines, never saved paths alone. */
let restoration: ReturnType<typeof restoreWorkspace> | undefined;

export function restoreNativeWorkspace(workspace: ProjectWorkspace | null) {
  // One renderer boot acquires one set of grants. React's StrictMode effect
  // replay must join that operation rather than race the main-process file lock.
  return (restoration ??= restoreWorkspace(workspace));
}

async function restoreWorkspace(workspace: ProjectWorkspace | null) {
  const windowId = workspaceWindowId();
  const previous =
    workspace ?? (await browserWorkspaceStore().latestElsewhere(windowId));
  if (!previous) return { workspace: null };
  const next = structuredClone(previous);
  next.windowId = windowId;
  next.url = "/editor";
  let detached = 0;
  let unsaved = 0;
  const boundPaths = new Set<string>();
  for (const tab of next.tabs) {
    const session = tab.session as {
      file?: ProjectFileSession;
      dirty?: boolean;
      unsafe?: boolean;
      publication?: unknown;
      recovery?: { workingCopyId: string };
    };
    if (session.dirty || session.unsafe) unsaved++;
    if (session.file) session.file.cloudBinding = null;
    session.publication = null;
    if (!session.file?.nativeBinding) continue;
    try {
      const path = session.file.nativeBinding.path;
      if (!session.file.savedBaseline || boundPaths.has(path.toLowerCase()))
        throw new Error("No unique acknowledged baseline");
      session.file.nativeBinding = await resumeNativeFile(
        path,
        session.file.nativeBinding.byteDigest,
      );
      boundPaths.add(path.toLowerCase());
      if (session.file.persistenceState === "saving")
        session.file.persistenceState = "dirty";
    } catch {
      session.file.nativeBinding = null;
      session.file.savedBaseline = null;
      session.file.persistenceState = "dirty";
      // This is now an independent recovered copy, not a retry of its original
      // first-save allocation. Unbound interrupted creations retain their id.
      if (session.recovery)
        session.recovery.workingCopyId = crypto.randomUUID();
      session.dirty = session.unsafe = true;
      detached++;
    }
  }
  const notice = [
    unsaved
      ? `Recovered unsaved edits in ${unsaved} Project(s). Saved files stay unchanged until you save.`
      : "",
    detached
      ? `${detached} recovered Project(s) could not be rebound because the saved file changed or was unavailable. Their edits are kept; Save creates a separate library Project.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { workspace: next, ...(notice ? { notice } : {}) };
}
