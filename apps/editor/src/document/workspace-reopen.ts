import { createId } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import {
  BROWSER_RECOVERY_SOURCES,
  type BrowserRecoverySource,
} from "./browser-recovery-contract";
import {
  createBrowserRecoveryStore,
  type BrowserRecoveryStore,
} from "./browser-recovery-store";
import { readDeletedCloudProjects } from "./cloud-project-session";
import {
  browserWorkspaceStore,
  UnreadableWorkspaceError,
  type createProjectWorkspaceStore,
  type ProjectWorkspace,
} from "./project-workspace";
import {
  recoveryRecordOf,
  WORKING_COPY_STORAGE_KEY,
} from "./recovery-coordinator";

/** What the reopen offer shows for a closed window's tabs. */
export interface WorkspaceReopenSummary {
  savedAt: number;
  names: string[];
}

/** The fields of a saved tab read here; the rest stays opaque. */
interface SavedTabFacts {
  dirty?: unknown;
  unsafe?: unknown;
  publication?: unknown;
  projectText?: unknown;
  file?: {
    cloudBinding?: { id?: unknown; revision?: unknown } | null;
    nativeBinding?: unknown;
  } | null;
  recovery?: { workingCopyId?: unknown; source?: unknown } | null;
}

function cloudIdOf(session: unknown): string | null {
  const id = (session as SavedTabFacts | null)?.file?.cloudBinding?.id;
  return typeof id === "string" && id ? id : null;
}

/** A saved tab holds work no saved Project has. */
export function holdsUnsavedWork(session: unknown): boolean {
  const tab = session as SavedTabFacts | null;
  return Boolean(tab && (tab.dirty === true || tab.unsafe === true));
}

/**
 * A saved tab as an unbound draft with unsaved work, the way the Shelf's
 * Delete leaves an open tab: closing it asks first, and its next Save
 * creates a new Cloud Project.
 */
function unboundDraft(session: unknown): Record<string, unknown> {
  const tab = session as SavedTabFacts & Record<string, unknown>;
  return {
    ...tab,
    dirty: true,
    unsafe: true,
    publication: null,
    file: {
      ...tab.file,
      cloudBinding: null,
      savedBaseline: null,
      safeSnapshotToken: null,
      persistenceState: "dirty",
    },
  };
}

const UNSAVED_COPY = " (unsaved copy)";
/** The longest Project name a Cloud Project keeps. */
const PROJECT_NAME_LIMIT = 120;

/**
 * A saved tab's unsaved edits as an independent Project, the way Duplicate
 * makes one: its own identity, named as an unsaved copy and bound to no
 * Cloud Project, so it stands beside the tab that holds the saved version.
 */
function unsavedCopy(session: unknown): Record<string, unknown> {
  const project = parseProject(
    (session as SavedTabFacts).projectText as string,
  );
  project.id = createId("project");
  project.name = `${project.name.slice(0, PROJECT_NAME_LIMIT - UNSAVED_COPY.length)}${UNSAVED_COPY}`;
  return { ...unboundDraft(session), projectText: serializeProject(project) };
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

/**
 * The closed window's tabs this window takes when it reopens them (#1250),
 * in their order. A tab of a Cloud Project already open here is not doubled
 * when it holds nothing unsaved. One with unsaved edits is never left behind
 * (#1599): it comes back as an unsaved copy beside the open tab, so neither
 * can save over the other. Every tab with unsaved work is thus among those
 * taken, and the closed window's record may go once they are saved here.
 * Throws when such a tab cannot be read.
 */
export function planWorkspaceReopen(
  record: ProjectWorkspace,
  openCloudIds: ReadonlySet<string>,
): { id: string; session: unknown; copy: boolean }[] {
  return record.tabs.flatMap(
    ({
      id,
      session,
    }): {
      id: string;
      session: unknown;
      copy: boolean;
    }[] => {
      const cloudId = cloudIdOf(session);
      if (!cloudId || !openCloudIds.has(cloudId))
        return [{ id, session, copy: false }];
      return holdsUnsavedWork(session)
        ? [{ id, session: unsavedCopy(session), copy: true }]
        : [];
    },
  );
}

/**
 * Tabs of Cloud Projects deleted while this browser tab was away from the
 * editor (on the account page) come back as unbound drafts with unsaved
 * work, as if the editor's own Shelf had deleted them: closing one asks
 * first, and its next Save creates a new Cloud Project (#1599).
 */
export function forgetDeletedCloudProjects(
  record: ProjectWorkspace,
  deleted: ReadonlySet<string>,
): ProjectWorkspace {
  const gone = (session: unknown) => {
    const cloudId = cloudIdOf(session);
    return cloudId !== null && deleted.has(cloudId);
  };
  if (!record.tabs.some(({ session }) => gone(session))) return record;
  return {
    ...record,
    tabs: record.tabs.map((tab) =>
      gone(tab.session) ? { ...tab, session: unboundDraft(tab.session) } : tab,
    ),
  };
}

/**
 * A page that does not bring its window's saved tabs back, because its
 * address asks for something else, saves its own tabs in their place.
 * Before that, every saved tab with unsaved work is stored in browser
 * recovery as a closed session of its own, which File → Recover Unsaved
 * Work lists (#1599). Storing them evicts none of the recovery copies these
 * tabs or `resumed` (the working copy the page resumes) already have, so a
 * startup Restore offer stays. `kept` counts the tabs stored; `left` counts
 * those that could not be, and while any is left the saved tabs must stay.
 */
export async function keepDisplacedTabs(
  workspaces: Pick<ReturnType<typeof createProjectWorkspaceStore>, "read">,
  recovery: Pick<BrowserRecoveryStore, "writeRecord">,
  windowId: string,
  resumed: string | null = null,
  now: () => string = () => new Date().toISOString(),
): Promise<{ kept: number; left: number }> {
  let record: ProjectWorkspace | null;
  try {
    record = await workspaces.read(windowId, "", { allowRouteChange: true });
  } catch (error) {
    // No page can bring an unreadable record back.
    if (error instanceof UnreadableWorkspaceError) return { kept: 0, left: 0 };
    throw error;
  }
  const tabs = record?.tabs ?? [];
  const kept: string[] = [];
  const held = [
    ...(resumed ? [resumed] : []),
    ...tabs.flatMap(({ session }) => {
      const id = (session as SavedTabFacts | null)?.recovery?.workingCopyId;
      return typeof id === "string" ? [id] : [];
    }),
  ];
  let left = 0;
  for (const { session } of tabs) {
    if (!holdsUnsavedWork(session)) continue;
    const tab = session as SavedTabFacts;
    const binding = tab.file?.cloudBinding;
    const source = tab.recovery?.source as BrowserRecoverySource;
    // A fresh identity: the page taking this window over resumes the
    // working copy its last tab used and would write over it.
    const workingCopyId = createId("working-copy");
    try {
      const outcome = await recovery.writeRecord(
        recoveryRecordOf(
          {
            project: parseProject(tab.projectText as string),
            session: {
              workingCopyId,
              source: BROWSER_RECOVERY_SOURCES.includes(source)
                ? source
                : "recovered",
            },
            unsavedAtSnapshot: true,
            cloudBinding:
              typeof binding?.id === "string" &&
              typeof binding.revision === "number"
                ? { id: binding.id, revision: binding.revision }
                : null,
          },
          `${workingCopyId}-displaced`,
          now(),
        ),
        // Neither the copies these tabs had nor one stored a moment ago for
        // another tab of the same Project gives way to this one.
        [...held, ...kept],
      );
      if (outcome.status === "stored" || outcome.status === "unchanged")
        kept.push(workingCopyId);
      else left++;
    } catch {
      left++;
    }
  }
  return { kept: kept.length, left };
}

/**
 * The tabs a window brings back as the editor starts, read before the editor
 * shows anything; tabs of Cloud Projects deleted meanwhile on the account
 * page come back unbound. When the address starts the window afresh instead,
 * its tabs with unsaved work go to recovery first (#1599); while one cannot,
 * an error keeps the new page from saving tabs over them.
 */
export async function readWindowWorkspace(
  windowId: string,
  url: string,
  allowRouteChange: boolean,
): Promise<{
  workspace: ProjectWorkspace | null;
  error?: string;
  notice?: string;
}> {
  const store = browserWorkspaceStore();
  const workspace = await store.read(windowId, url, { allowRouteChange });
  if (workspace)
    return {
      workspace: forgetDeletedCloudProjects(
        workspace,
        readDeletedCloudProjects(),
      ),
    };
  const recovery = createBrowserRecoveryStore();
  try {
    const { kept, left } = await keepDisplacedTabs(
      store,
      recovery,
      windowId,
      // The working copy this page's recovery resumes.
      sessionStorage.getItem(WORKING_COPY_STORAGE_KEY),
    );
    if (left)
      return {
        workspace: null,
        error:
          "This window's unsaved tabs could not be moved to recovery, so they are left in place: open /editor?resume=1 to bring them back. Tabs opened here are not kept; export your work before leaving.",
      };
    return {
      workspace: null,
      ...(kept
        ? {
            notice: `${kept === 1 ? "An unsaved tab" : `${kept} unsaved tabs`} this window had open went to File → Recover Unsaved Work…`,
          }
        : {}),
    };
  } finally {
    recovery.close();
  }
}
