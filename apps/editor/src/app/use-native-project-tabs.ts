// Project tabs backed by desktop files: opening, saving and closing them, and
// the bridge the desktop shell asks before the window closes.
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { captureProjectSaveSnapshot } from "../document/project-save-coordinator";
import type { useProjectFileLifecycle } from "../document/use-project-file-lifecycle";
import type {
  NativeSaveOutcome,
  RecentProjectFile,
} from "../hosts/native-project-store";
import type { EditorServices } from "../services/editor-services";
import type { useProjectTabSessions } from "./use-project-tab-sessions";

type ProjectFileLifecycle = ReturnType<typeof useProjectFileLifecycle>;
type ProjectTabSessions = ReturnType<typeof useProjectTabSessions>;

export const loadNativeProjectWorkspace = () =>
  import("../hosts/native-project-workspace");

/** The desktop host's files behind the project tabs. */
export function useNativeProjectTabs({
  nativeProjectStore,
  setStatus,
  replaceGuard,
  recoveryDialogOpen,
  saveProjectToNative,
  isSaveInFlight,
  openProjectFile,
  createTabSession,
  currentEditBlocker,
  projectTabs,
  nativeWorkspaceSaving,
  restoringWorkspace,
}: {
  nativeProjectStore: EditorServices["nativeProjectStore"];
  setStatus: Dispatch<SetStateAction<string>>;
  replaceGuard: ProjectFileLifecycle["replaceGuard"];
  recoveryDialogOpen: ProjectFileLifecycle["recoveryDialogOpen"];
  saveProjectToNative: ProjectFileLifecycle["saveProjectToNative"];
  isSaveInFlight: ProjectFileLifecycle["isSaveInFlight"];
  openProjectFile: ProjectFileLifecycle["openProjectFile"];
  createTabSession: ProjectTabSessions["createTabSession"];
  currentEditBlocker: ProjectTabSessions["currentEditBlocker"];
  projectTabs: ProjectTabSessions["projectTabs"];
  nativeWorkspaceSaving: RefObject<boolean>;
  restoringWorkspace: boolean;
}) {
  const [recentNativeFiles, setRecentNativeFiles] = useState<
    RecentProjectFile[]
  >([]);
  const [nativeBusy, setNativeBusy] = useState(false);
  const nativeOperation = useRef(false);
  const openingLaunchFiles = useRef(false);
  const editBlocker = currentEditBlocker();
  const refreshNativeFiles = async () => {
    if (!nativeProjectStore) return;
    try {
      setRecentNativeFiles(await nativeProjectStore.recent());
    } catch (error) {
      setStatus(`Recent Projects unavailable: ${String(error)}`);
    }
  };
  async function openNativeProject(recentId?: string) {
    if (!nativeProjectStore || nativeOperation.current || isSaveInFlight())
      return;
    nativeOperation.current = true;
    setNativeBusy(true);
    try {
      const { openNativeFile } = await loadNativeProjectWorkspace();
      await openNativeFile(
        nativeProjectStore,
        {
          entries: projectTabs.entries,
          select: projectTabs.select,
          open: openProjectFile,
          report: setStatus,
        },
        recentId,
      );
      await refreshNativeFiles();
    } finally {
      nativeOperation.current = false;
      setNativeBusy(false);
    }
  }
  function closeNativeTab(id: string) {
    return closeNativeTabs([id]);
  }
  /** Closes native tabs, releasing each closed tab's file. */
  async function closeNativeTabs(ids: readonly string[]) {
    const bindings = projectTabs
      .entries()
      .filter((entry) => ids.includes(entry.id))
      .flatMap(({ id, session }) =>
        session.file.nativeBinding
          ? [{ id, binding: session.file.nativeBinding }]
          : [],
      );
    await projectTabs.closeMany(ids, () => createTabSession());
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    for (const { id, binding } of bindings)
      if (!projectTabs.entries().some((entry) => entry.id === id))
        await nativeProjectStore?.release(binding.id);
  }
  async function saveNativeTab(id: string): Promise<NativeSaveOutcome> {
    if (!nativeProjectStore)
      return { status: "failed", message: "Local storage is unavailable" };
    if (id === projectTabs.activeId) {
      const blocker = currentEditBlocker();
      if (blocker)
        return {
          status: "failed",
          message: `Can't save and close yet: ${blocker}.`,
        };
      return saveProjectToNative();
    }
    const { saveBackgroundNativeTab } = await loadNativeProjectWorkspace();
    return saveBackgroundNativeTab(
      nativeProjectStore,
      projectTabs,
      id,
      captureProjectSaveSnapshot,
    );
  }

  const nativeWorkspaceState = () => ({
    dirty: projectTabs
      .entries()
      .filter(({ session }) => session.dirty || session.unsafe)
      .map(({ id, session }) => ({
        id,
        name: session.controller.project.name,
      })),
    busy:
      isSaveInFlight() ||
      projectTabs.busy ||
      nativeOperation.current ||
      nativeWorkspaceSaving.current,
    pendingEdits:
      currentEditBlocker() !== null || !!replaceGuard || recoveryDialogOpen,
  });
  const nativeBridgeRef = useRef({
    state: nativeWorkspaceState,
    openPending: async () => {},
    save: async (): Promise<{ status: string; message?: string }> => ({
      status: "cancelled",
    }),
  });
  nativeBridgeRef.current = {
    state: nativeWorkspaceState,
    openPending: async () => {
      if (
        restoringWorkspace ||
        openingLaunchFiles.current ||
        nativeWorkspaceState().busy ||
        nativeWorkspaceState().pendingEdits
      )
        return;
      openingLaunchFiles.current = true;
      try {
        while (
          !nativeWorkspaceState().busy &&
          !nativeWorkspaceState().pendingEdits
        ) {
          const id = await nativeProjectStore?.nextLaunch?.();
          if (!id) break;
          window.dispatchEvent(new Event("analog-canvas-native-open"));
          await openNativeProject(id);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
      } catch (error) {
        setStatus(`Could not open requested Project: ${String(error)}`);
      } finally {
        openingLaunchFiles.current = false;
      }
    },
    save: async () => {
      const { saveNativeWorkspace } = await loadNativeProjectWorkspace();
      return saveNativeWorkspace(
        nativeWorkspaceState,
        saveNativeTab,
        (busy) => {
          nativeWorkspaceSaving.current = busy;
          setNativeBusy(busy);
        },
      );
    },
  };
  useEffect(() => {
    if (!nativeProjectStore) return;
    const target = window as unknown as Record<string, unknown>;
    const bridge = {
      state: () => nativeBridgeRef.current.state(),
      save: () => nativeBridgeRef.current.save(),
      openPending: () => nativeBridgeRef.current.openPending(),
    };
    target.__analogCanvasDesktop = bridge;
    return () => {
      if (target.__analogCanvasDesktop === bridge)
        delete target.__analogCanvasDesktop;
    };
  }, [nativeProjectStore]);
  useEffect(() => {
    if (!nativeProjectStore) return;
    void nativeBridgeRef.current.openPending();
  }, [
    nativeProjectStore,
    restoringWorkspace,
    nativeBusy,
    projectTabs.busy,
    replaceGuard,
    recoveryDialogOpen,
    editBlocker,
  ]);
  return {
    recentNativeFiles,
    nativeBusy,
    setNativeBusy,
    nativeOperation,
    refreshNativeFiles,
    openNativeProject,
    closeNativeTab,
    closeNativeTabs,
    saveNativeTab,
  };
}
