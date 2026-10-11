// How the editor is entered and left: the link a window opens with, links
// opened into restored tabs, a Gallery entry opening in a tab, and leaving
// for the Gallery.
import {
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { CircuitProject, GridRect } from "@icm/model";
import {
  branchGalleryVersion,
  loadGalleryVersionProject,
} from "../components/gallery-version-project";
import type { ProjectWorkspace } from "../document/project-workspace";
import type { UseRecoveryCoordinatorResult } from "../document/recovery-coordinator";
import type { useProjectFileLifecycle } from "../document/use-project-file-lifecycle";
import type { useUnsavedWorkGuard } from "../document/use-unsaved-work-guard";
import type {
  GalleryEntryContext,
  createGalleryExampleCommands,
} from "../features/editor-shell/gallery-example-commands";
import type { useNetlistExportPreferences } from "../features/netlist-export/netlist-export-preferences";
import { prepareNetlistExample } from "../features/netlist-export/netlist-process";
import { localhostExamplesEnabled } from "../gallery-client";
import type { EditorServices } from "../services/editor-services";
import { DEFAULT_VIEWBOX } from "./default-view-box";
import type { useAgentProjectResources } from "./use-agent-hosts";
import type { useGalleryPublishing } from "./use-gallery-publishing";
import type { useProjectTabSessions } from "./use-project-tab-sessions";

type ProjectFileLifecycle = ReturnType<typeof useProjectFileLifecycle>;
type GalleryExampleCommands = ReturnType<typeof createGalleryExampleCommands>;
type GalleryPublishing = ReturnType<typeof useGalleryPublishing>;
type ProjectTabSessions = ReturnType<typeof useProjectTabSessions>;
type AgentProjectResourcesOptions = Parameters<
  typeof useAgentProjectResources
>[0];
type BootLink = ReturnType<typeof useBootLink>;

/**
 * Takes `new=1` out of the address once the new circuit is open. The address
 * is what the window's tabs are saved under, so a refresh then brings back
 * what was drawn, and only a fresh New Circuit starts another.
 */
function forgetNewProjectRequest(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get("new") !== "1") return;
  url.searchParams.delete("new");
  window.history.replaceState(
    window.history.state,
    "",
    url.pathname + url.search + url.hash,
  );
}

/** Opens what the window's link asks for, once, as the editor boots. */
export function useBootLink({
  initialGalleryEntryId,
  restoredWorkspace,
  capabilities,
  bootRequestsNewProject,
  preparedInitialProject,
  setStatus,
  netlistPreferences,
  openProjectInTabRef,
  restoreAfterRefresh,
  replaceActiveProject,
  openCloudProjectById,
  openGalleryEntryById,
}: {
  initialGalleryEntryId: string | null;
  restoredWorkspace: ProjectWorkspace | null;
  capabilities: EditorServices["capabilities"];
  bootRequestsNewProject: boolean;
  preparedInitialProject: CircuitProject;
  setStatus: Dispatch<SetStateAction<string>>;
  netlistPreferences: ReturnType<typeof useNetlistExportPreferences>;
  openProjectInTabRef: AgentProjectResourcesOptions["openProjectInTabRef"];
  restoreAfterRefresh: ProjectFileLifecycle["restoreAfterRefresh"];
  replaceActiveProject: ProjectFileLifecycle["replaceActiveProject"];
  openCloudProjectById: ProjectFileLifecycle["openCloudProjectById"];
  openGalleryEntryById: GalleryExampleCommands["openGalleryEntryById"];
}) {
  // A Gallery URL is an explicit open intent, even when another project tab
  // was active when this browser window last saved its workspace.
  const restoredGalleryLink = useRef(
    capabilities.community && restoredWorkspace && !restoreAfterRefresh
      ? initialGalleryEntryId
      : null,
  );
  const restoredCloudLink = useRef(
    restoredWorkspace && !restoreAfterRefresh && !initialGalleryEntryId
      ? new URLSearchParams(window.location.search).get("project")
      : null,
  );
  // So is New Circuit: it opens a new tab beside the ones brought back,
  // rather than showing the circuit this window drew last.
  const restoredNewLink = useRef(
    restoredWorkspace !== null &&
      !restoreAfterRefresh &&
      bootRequestsNewProject,
  );

  // boot Project only; ordinary sessions never re-run these.
  const bootTargetHandled = useRef(false);
  useEffect(() => {
    if (
      import.meta.env?.ICM_DESKTOP ||
      !capabilities.community ||
      bootTargetHandled.current
    )
      return;
    bootTargetHandled.current = true;
    // A safe recovery refresh reloads the same URL: the pending restore owns
    // this boot. Re-running the URL's boot target here would fork the
    // working-copy identity and orphan the snapshot the restore is about to
    // read.
    if (restoreAfterRefresh || restoredWorkspace) return;
    const exampleId = new URLSearchParams(window.location.search).get(
      "example",
    );
    // A tile on the shelf opens straight into its Project.
    const shelfProjectId = new URLSearchParams(window.location.search).get(
      "project",
    );
    const requestsNewProject = bootRequestsNewProject;
    if (initialGalleryEntryId) {
      void openGalleryEntryById(initialGalleryEntryId, false, true);
      return;
    }
    const historySearch = new URLSearchParams(window.location.search);
    const historyEntryId = historySearch.get("history");
    if (historyEntryId) {
      const versionId = historySearch.get("version");
      const versionNo = Number(historySearch.get("versionNo"));
      if (!versionId || !Number.isInteger(versionNo) || versionNo < 1) {
        setStatus("Invalid historical branch link");
        return;
      }
      setStatus("Opening historical version as a new branch…");
      void loadGalleryVersionProject(historyEntryId, versionId)
        .then(async (snapshot) => {
          await openProjectInTabRef.current(
            branchGalleryVersion(snapshot, versionNo),
            DEFAULT_VIEWBOX,
            { source: "opened-file", persistenceState: "dirty" },
          );
        })
        .catch((error: unknown) =>
          setStatus(error instanceof Error ? error.message : String(error)),
        );
      return;
    }
    if (requestsNewProject) {
      replaceActiveProject(preparedInitialProject, DEFAULT_VIEWBOX);
      setStatus("Created a new Project");
      return;
    }
    if (shelfProjectId) {
      setStatus("Opening your Cloud Project…");
      void openCloudProjectById(shelfProjectId, true);
      return;
    }
    if (exampleId) {
      if (!localhostExamplesEnabled()) {
        setStatus("Built-in examples are available only on localhost");
        return;
      }
      void import("../examples/library-examples")
        .then(({ createLibraryExampleProject, libraryProjectExamples }) => {
          const exampleProject = createLibraryExampleProject(exampleId);
          const example = libraryProjectExamples.find(
            (candidate) => candidate.id === exampleId,
          );
          if (!exampleProject || !example) return;
          replaceActiveProject(
            prepareNetlistExample(
              exampleProject,
              netlistPreferences.preferences.profiles[
                netlistPreferences.selected
              ],
            ),
            DEFAULT_VIEWBOX,
          );
          setStatus(`Opened example: ${example.name}`);
        })
        .catch(() => {
          setStatus("Built-in example could not load");
        });
    }
  }, [initialGalleryEntryId, restoreAfterRefresh]);
  return { restoredGalleryLink, restoredCloudLink, restoredNewLink };
}

/** Opens a Gallery entry in a tab, or in the boot placeholder it replaces. */
export function useGalleryTabEntry({
  initialGalleryEntryId,
  restoredWorkspace,
  preparedInitialProject,
  project,
  projectSessionId,
  setGalleryDailyLimit,
  setGalleryEntryContext,
  codeDraftDirty,
  openGalleryProjectInTabRef,
  isDirtyWork,
  hasUnsafeWork,
  replaceActiveProject,
  createTabSession,
  projectTabs,
}: {
  initialGalleryEntryId: string | null;
  restoredWorkspace: ProjectWorkspace | null;
  preparedInitialProject: CircuitProject;
  project: CircuitProject;
  projectSessionId: string;
  setGalleryDailyLimit: GalleryPublishing["setGalleryDailyLimit"];
  setGalleryEntryContext: GalleryPublishing["setGalleryEntryContext"];
  codeDraftDirty: boolean;
  openGalleryProjectInTabRef: RefObject<
    (
      project: CircuitProject,
      view: GridRect,
      context: GalleryEntryContext,
    ) => Promise<boolean>
  >;
  isDirtyWork: ProjectFileLifecycle["isDirtyWork"];
  hasUnsafeWork: ProjectFileLifecycle["hasUnsafeWork"];
  replaceActiveProject: ProjectFileLifecycle["replaceActiveProject"];
  createTabSession: ProjectTabSessions["createTabSession"];
  projectTabs: ProjectTabSessions["projectTabs"];
}) {
  // The daily-limit card speaks about one attempt; another tab or a
  // replaced project is not it.
  useEffect(
    () => setGalleryDailyLimit(null),
    [projectTabs.activeId, projectSessionId],
  );
  openGalleryProjectInTabRef.current = (next, view, context) => {
    // A fresh deep link has only a boot placeholder, not a user Project to
    // preserve. Fill it so opening a Gallery circuit does not leave an empty
    // extra tab; restored workspaces always take the additive path below.
    if (
      !restoredWorkspace &&
      initialGalleryEntryId === context.id &&
      projectTabs.tabs.length === 1 &&
      project.id === preparedInitialProject.id &&
      !isDirtyWork() &&
      !hasUnsafeWork() &&
      !codeDraftDirty
    ) {
      replaceActiveProject(next, view);
      setGalleryEntryContext(context);
      return Promise.resolve(true);
    }
    return projectTabs.open(
      () => ({
        ...createTabSession(next, view, {
          source: "opened-file",
          persistenceState: "unbound",
        }),
        publication: context,
      }),
      null,
      context.id,
    );
  };
}

/** Opens the link a window was given into the tabs it brought back. */
export function useRestoredTabLinks({
  restoringWorkspace,
  bootRequestsNewProject,
  setStatus,
  codeDraftDirty,
  openCloudProjectById,
  openGalleryEntryById,
  refreshGalleryEntry,
  restoredGalleryLink,
  restoredCloudLink,
  restoredNewLink,
  restoredTabs,
  projectTabs,
}: {
  restoringWorkspace: boolean;
  bootRequestsNewProject: boolean;
  setStatus: Dispatch<SetStateAction<string>>;
  codeDraftDirty: boolean;
  openCloudProjectById: ProjectFileLifecycle["openCloudProjectById"];
  openGalleryEntryById: GalleryExampleCommands["openGalleryEntryById"];
  refreshGalleryEntry: GalleryExampleCommands["refreshGalleryEntry"];
  restoredGalleryLink: BootLink["restoredGalleryLink"];
  restoredCloudLink: BootLink["restoredCloudLink"];
  restoredNewLink: BootLink["restoredNewLink"];
  restoredTabs: ProjectTabSessions["restoredTabs"];
  projectTabs: ProjectTabSessions["projectTabs"];
}) {
  useEffect(() => {
    const entryId = restoredGalleryLink.current;
    if (restoringWorkspace || !entryId) return;
    const matching = projectTabs
      .entries()
      .find(({ session }) => session.publication?.id === entryId);
    if (matching && matching.id !== projectTabs.activeId) {
      void projectTabs.select(matching.id).then((selected) => {
        if (!selected) restoredGalleryLink.current = null;
      });
      return;
    }
    restoredGalleryLink.current = null;
    if (!matching) {
      void openGalleryEntryById(entryId, false, true);
    } else if (
      !matching.session.dirty &&
      !matching.session.unsafe &&
      !codeDraftDirty
    ) {
      void refreshGalleryEntry(matching.session.publication!);
    }
  }, [restoringWorkspace, projectTabs.activeId]);
  useEffect(() => {
    const cloudId = restoredCloudLink.current;
    if (restoringWorkspace || !cloudId) return;
    restoredCloudLink.current = null;
    void openCloudProjectById(cloudId, true);
  }, [restoringWorkspace]);
  useEffect(() => {
    if (restoringWorkspace || !restoredNewLink.current) return;
    restoredNewLink.current = false;
    forgetNewProjectRequest();
    // Tabs that could not be restored leave their message standing.
    if (restoredTabs.value) setStatus("Created a new Project");
  }, [restoringWorkspace]);
  useEffect(() => {
    // A new circuit this window opened fresh is simply the working one now.
    if (bootRequestsNewProject && !restoredNewLink.current)
      forgetNewProjectRequest();
  }, []);
}

/**
 * Leaves the editor for the Gallery wall or AnalogArena, keeping a recovery
 * copy.
 */
export function createLeaveEditor({
  project,
  stageRecovery,
  flushRecovery,
  captureAuthoredProject,
  cloudBinding,
  isDirtyWork,
  guardDirtyReplacement,
  dropDiscardedWork,
  allowNextBrowserUnload,
}: {
  project: CircuitProject;
  stageRecovery: UseRecoveryCoordinatorResult["stage"];
  flushRecovery: UseRecoveryCoordinatorResult["flushNow"];
  captureAuthoredProject: () => Promise<CircuitProject | null>;
  cloudBinding: ProjectFileLifecycle["cloudBinding"];
  isDirtyWork: ProjectFileLifecycle["isDirtyWork"];
  guardDirtyReplacement: ProjectFileLifecycle["guardDirtyReplacement"];
  dropDiscardedWork: ProjectTabSessions["dropDiscardedWork"];
  allowNextBrowserUnload: ReturnType<typeof useUnsavedWorkGuard>;
}) {
  // The header's Gallery and Arena links and the daily-limit card leave the
  // same way: through the guard for unsaved work, with a recovery copy kept.
  const leaveFor = (intent: string, path: string) => (): void => {
    void guardDirtyReplacement(intent, async (discarded) => {
      if (discarded) await dropDiscardedWork();
      else {
        const snapshot = await captureAuthoredProject();
        if (!snapshot) return;
        stageRecovery(snapshot, {
          unsavedAtSnapshot: isDirtyWork() || snapshot !== project,
          cloudBinding,
        });
        await flushRecovery();
      }
      allowNextBrowserUnload();
      window.location.assign(path);
    });
  };
  return {
    toGallery: leaveFor("Go to Gallery", "/"),
    toArena: leaveFor("Go to Arena", "/arena"),
  };
}
