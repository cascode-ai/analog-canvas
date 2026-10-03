import type {
  createProjectWorkspaceStore,
  ProjectWorkspace,
} from "./project-workspace";

/** What the reopen offer shows for a closed window's tabs. */
export interface WorkspaceReopenSummary {
  savedAt: number;
  names: string[];
}

/** The fields of a saved tab this offer reads; the rest stays opaque. */
interface SavedTabFacts {
  dirty?: unknown;
  unsafe?: unknown;
  publication?: unknown;
  projectText?: unknown;
  file?: { cloudBinding?: unknown; nativeBinding?: unknown } | null;
}

/**
 * A closed window's tabs are worth reopening when one holds unsaved work or
 * stands for a saved Project, Gallery entry or file. A window that only ever
 * showed an untouched New Circuit offers nothing.
 */
export function worthReopening(record: ProjectWorkspace): boolean {
  return record.tabs.some(({ session }) => {
    const tab = session as SavedTabFacts | null;
    return Boolean(
      tab &&
      (tab.dirty === true ||
        tab.unsafe === true ||
        tab.publication ||
        tab.file?.cloudBinding ||
        tab.file?.nativeBinding),
    );
  });
}

function projectName(text: unknown): string {
  if (typeof text !== "string") return "Untitled";
  try {
    const name = (JSON.parse(text) as { name?: unknown } | null)?.name;
    return typeof name === "string" && name.trim() ? name : "Untitled";
  } catch {
    return "Untitled";
  }
}

export function workspaceReopenSummary(
  record: ProjectWorkspace,
): WorkspaceReopenSummary {
  return {
    savedAt: record.savedAt,
    names: record.tabs.map(({ session }) =>
      projectName((session as SavedTabFacts | null)?.projectText),
    ),
  };
}

/**
 * The newest workspace a closed window left with something worth reopening
 * (#1250). Open windows keep theirs; without a list of open windows nothing
 * is offered, as before.
 */
export async function findWorkspaceReopenOffer(
  store: Pick<
    ReturnType<typeof createProjectWorkspaceStore>,
    "latestElsewhere"
  >,
  windowId: string,
  openWindows: ReadonlySet<string> | null,
): Promise<{
  record: ProjectWorkspace;
  summary: WorkspaceReopenSummary;
} | null> {
  if (!openWindows) return null;
  const record = await store.latestElsewhere(
    windowId,
    (candidate) =>
      openWindows.has(candidate.windowId) || !worthReopening(candidate),
  );
  return record ? { record, summary: workspaceReopenSummary(record) } : null;
}
