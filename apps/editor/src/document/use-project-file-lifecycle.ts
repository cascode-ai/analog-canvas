import { useEffect, useRef, useState } from "react";

import { createEmptyProject, createId } from "@icm/model";
import type { CircuitProject, GridRect, SchematicDocument } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import {
  builtInSymbols,
  findUnsupportedProjectSymbolIds,
  InMemorySymbolResolver,
} from "@icm/symbols";

import { materializeRazaviProjectBulkConnections } from "../presentation/razavi-presentation";
import type {
  BrowserRecoveryFormalFileHint,
  BrowserRecoveryGeneration,
  BrowserRecoverySource,
} from "./browser-recovery-contract";
import type { RecoveryCoordinator } from "./recovery-coordinator";
import {
  downloadTextArtifact,
  formatProjectOpenDiagnostics,
  projectFileBaseName,
  requestProjectDownload,
  stageProjectFile,
} from "./project-file-service";
import { projectChangeToken } from "./project-session-lifecycle";
import { projectHasMeaningfulContent } from "./project-content";
import { normalizeImportedProjectConductors } from "./project-conductor-normalization";
import {
  CLOUD_PROJECT_LIMIT,
  openCloudProject,
  saveCloudProject,
  type CloudProjectBinding,
  type CloudProjectSaveOutcome,
  type CloudProjectSummary,
} from "../features/editor-shell/cloud-projects";
import {
  forgetRecentCloudProject,
  readRecentCloudProjectId,
  rememberRecentCloudProject,
} from "./cloud-project-session";

export const REFRESH_RESTORE_STORAGE_KEY = "icm.restore-after-refresh.v1";

const projectImportSymbolResolver = new InMemorySymbolResolver(builtInSymbols);

export interface SavedProjectBaseline {
  project: CircuitProject;
  viewBox: GridRect;
}

export type PersistenceState =
  "unbound" | "clean" | "dirty" | "saving" | "offline" | "conflict" | "failed";

interface ReplaceGuardState {
  intent: string;
  perform: () => void | Promise<void>;
}

export interface ReplaceProjectOptions {
  source?: BrowserRecoverySource;
  keepWorkingCopy?: boolean;
  formalFileHint?: BrowserRecoveryFormalFileHint;
  persistenceState?: PersistenceState;
  cloudBinding?: CloudProjectBinding | null;
  savedBaseline?: SavedProjectBaseline | null;
}

type RecoveryLifecycle = Pick<
  RecoveryCoordinator,
  | "workingCopyId"
  | "stage"
  | "cancelPending"
  | "flushNow"
  | "beginWorkingCopy"
  | "noteFormalFileHint"
  | "discover"
  | "readSessionProject"
  | "deleteSession"
> & {
  ready: boolean;
  sessions: RecoveryCoordinator["sessions"];
};

export interface UseProjectFileLifecycleOptions {
  project: CircuitProject;
  projectSessionId: string;
  viewBox: GridRect;
  defaultViewBox: GridRect;
  recovery: RecoveryLifecycle;
  installProject(project: CircuitProject, viewBox: GridRect): SchematicDocument;
  setStatus(message: string): void;
  onCloudProjectSaved(project: CloudProjectSummary): void;
}

export function useProjectFileLifecycle({
  project,
  projectSessionId,
  viewBox,
  defaultViewBox,
  recovery,
  installProject,
  setStatus,
  onCloudProjectSaved,
}: UseProjectFileLifecycleOptions) {
  // Read-only initializer: consuming the one-shot flag here would be a render
  // side effect, and a discarded render (StrictMode's double pass, a Suspense
  // retry) would eat the flag before the committed render sees it.
  const [restoreAfterRefresh] = useState(
    () =>
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(REFRESH_RESTORE_STORAGE_KEY) === "true",
  );
  useEffect(() => {
    if (restoreAfterRefresh) {
      window.sessionStorage.removeItem(REFRESH_RESTORE_STORAGE_KEY);
    }
  }, [restoreAfterRefresh]);
  const [startupCloudProjectId] = useState(readRecentCloudProjectId);
  const refreshRestoreAttemptedRef = useRef(false);
  const saveInFlightRef = useRef<Promise<CloudProjectSaveOutcome> | null>(null);
  const liveProjectRef = useRef(project);
  liveProjectRef.current = project;
  const liveSessionRef = useRef(projectSessionId);
  liveSessionRef.current = projectSessionId;
  /** Change token of the last snapshot published or exported; see hasUnsafeWork. */
  const safeSnapshotTokenRef = useRef<string | null>(null);
  const [persistenceState, setPersistenceState] =
    useState<PersistenceState>("unbound");
  const [cloudBinding, setCloudBinding] = useState<CloudProjectBinding | null>(
    null,
  );
  const [savedProjectBaseline, setSavedProjectBaseline] =
    useState<SavedProjectBaseline | null>(null);
  const persistenceChangeRef = useRef<{
    session: string;
    token: string;
  } | null>(null);
  const [replaceGuard, setReplaceGuard] = useState<ReplaceGuardState | null>(
    null,
  );
  const [replaceGuardSaving, setReplaceGuardSaving] = useState(false);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false);
  const [
    dismissedStartupRecoveryRecordId,
    setDismissedStartupRecoveryRecordId,
  ] = useState<string | null>(null);

  function isDirtyWork(): boolean {
    return (
      persistenceState === "dirty" ||
      persistenceState === "saving" ||
      persistenceState === "offline" ||
      persistenceState === "conflict" ||
      persistenceState === "failed"
    );
  }

  /**
   * The one predicate every leave/replace/refresh guard shares: there is
   * meaningful drawing, the persistence state says it has not reached the
   * Cloud, AND no equally safe copy of exactly these bytes exists anywhere
   * else. Publishing to the gallery or exporting the Project file stamps
   * the current snapshot safe — the drawing is recoverable from there, so
   * prompting again would be crying wolf.
   */
  function hasUnsafeWork(): boolean {
    if (!isDirtyWork()) return false;
    const live = liveProjectRef.current;
    if (!projectHasMeaningfulContent(live)) return false;
    return (
      safeSnapshotTokenRef.current === null ||
      projectChangeToken(live) !== safeSnapshotTokenRef.current
    );
  }

  function noteProjectSnapshotSafe(): void {
    safeSnapshotTokenRef.current = projectChangeToken(liveProjectRef.current);
  }

  function replaceActiveProject(
    nextProject: CircuitProject,
    nextViewBox: GridRect = defaultViewBox,
    options: ReplaceProjectOptions = {},
  ): SchematicDocument {
    recovery.cancelPending();
    if (options.keepWorkingCopy !== true) {
      recovery.beginWorkingCopy(options.source ?? "new");
    }
    if (options.formalFileHint !== undefined) {
      recovery.noteFormalFileHint(options.formalFileHint);
    }
    const prepared = materializeRazaviProjectBulkConnections(nextProject);
    safeSnapshotTokenRef.current = null;
    const nextDocument = installProject(prepared.project, nextViewBox);
    const nextPersistenceState =
      options.persistenceState ??
      (options.source === "spice-import" || options.source === "recovered"
        ? "dirty"
        : options.source === "cloud-project"
          ? "clean"
          : "unbound");
    setPersistenceState(nextPersistenceState);
    const nextCloudBinding = options.cloudBinding ?? null;
    setCloudBinding(nextCloudBinding);
    setSavedProjectBaseline(options.savedBaseline ?? null);
    if (nextCloudBinding) {
      rememberRecentCloudProject(nextCloudBinding.id);
    } else {
      forgetRecentCloudProject();
    }
    recovery.stage(prepared.project, {
      unsavedAtSnapshot:
        nextPersistenceState !== "clean" && nextPersistenceState !== "unbound",
      cloudBinding: nextCloudBinding,
    });
    return nextDocument;
  }

  async function performProjectSaveToCloud(
    candidate: CircuitProject,
  ): Promise<CloudProjectSaveOutcome> {
    // Capture before the recovery/network awaits: save exactly the checked version.
    const savedCandidate = structuredClone(candidate);
    const savedCandidateToken = projectChangeToken(savedCandidate);
    setPersistenceState("saving");
    setStatus(`Saving ${savedCandidate.name} to Cloud`);
    recovery.stage(savedCandidate, { unsavedAtSnapshot: true, cloudBinding });
    await recovery.flushNow();
    const outcome = await saveCloudProject(savedCandidate, cloudBinding);
    if (liveSessionRef.current !== projectSessionId) return outcome;
    if (outcome.status === "saved") {
      const nextBinding = {
        id: outcome.project.id,
        revision: outcome.project.revision,
      };
      setCloudBinding(nextBinding);
      rememberRecentCloudProject(nextBinding.id);
      setSavedProjectBaseline({
        project: savedCandidate,
        viewBox: { ...viewBox },
      });
      const liveProject = liveProjectRef.current;
      let stillMatchesSavedCandidate =
        projectChangeToken(liveProject) === savedCandidateToken;
      recovery.stage(liveProject, {
        unsavedAtSnapshot: !stillMatchesSavedCandidate,
        cloudBinding: nextBinding,
      });
      await recovery.flushNow();
      if (liveSessionRef.current !== projectSessionId) return outcome;
      stillMatchesSavedCandidate =
        projectChangeToken(liveProjectRef.current) === savedCandidateToken;
      setPersistenceState(stillMatchesSavedCandidate ? "clean" : "dirty");
      onCloudProjectSaved(outcome.project);
      setStatus(
        stillMatchesSavedCandidate
          ? `Saved ${savedCandidate.name} to Cloud`
          : `Saved ${savedCandidate.name} to Cloud; newer edits remain unsaved`,
      );
      return outcome;
    }
    if (outcome.status === "unreachable") {
      setPersistenceState("offline");
      setStatus(`Cloud unavailable; work remains local (${outcome.message})`);
      return outcome;
    }
    if (outcome.status === "conflict") {
      setPersistenceState("conflict");
      setStatus(
        `Cloud Project changed elsewhere at revision ${outcome.project.revision}; current work was not overwritten`,
      );
      return outcome;
    }
    setPersistenceState("failed");
    setStatus(
      outcome.status === "signed-out"
        ? "Sign in to save this Cloud Project"
        : outcome.status === "too-large"
          ? "Project is too large for Cloud storage; download a backup"
          : outcome.status === "limit"
            ? `Cloud Project limit reached (${outcome.projects.length}/${CLOUD_PROJECT_LIMIT})`
            : outcome.status === "not-found"
              ? "Cloud Project no longer exists; current work remains local"
              : outcome.message,
    );
    return outcome;
  }

  function saveProjectToCloud(
    candidate: CircuitProject = project,
  ): Promise<CloudProjectSaveOutcome> {
    const inFlight = saveInFlightRef.current;
    if (inFlight) return inFlight;
    const operation = performProjectSaveToCloud(candidate).catch(
      (error: unknown): CloudProjectSaveOutcome => {
        const message = error instanceof Error ? error.message : "Save failed";
        if (liveSessionRef.current === projectSessionId) {
          setPersistenceState("failed");
          setStatus(`Save failed; work remains local (${message})`);
        }
        return { status: "rejected", message };
      },
    );
    saveInFlightRef.current = operation;
    const clear = () => {
      if (saveInFlightRef.current === operation) saveInFlightRef.current = null;
    };
    void operation.then(clear, clear);
    return operation;
  }

  function exportProjectFile(): void {
    const outcome = requestProjectDownload(project);
    if (outcome.status !== "download-requested") {
      setStatus(`Export failed: ${outcome.message}`);
      return;
    }
    // The bytes now live in a local file: leaving no longer loses them.
    noteProjectSnapshotSafe();
    recovery.noteFormalFileHint({
      name: outcome.fileName,
      lastDownloadRequestedAt: new Date().toISOString(),
    });
    setStatus(`Export requested: ${outcome.fileName}`);
  }

  function downloadCurrentProjectBackup(): void {
    let projectText: string;
    try {
      projectText = serializeProject(project);
    } catch (error) {
      setStatus(
        `Backup failed: ${error instanceof Error ? error.message : "serialization failed"}`,
      );
      return;
    }
    const fileName = `${projectFileBaseName(project.name)}-backup.icproj.json`;
    const outcome = downloadTextArtifact(projectText, fileName);
    setStatus(
      outcome.status === "download-requested"
        ? `Backup requested: ${outcome.fileName}`
        : `Backup failed: ${outcome.message}`,
    );
  }

  async function guardDirtyReplacement(
    intent: string,
    perform: () => void | Promise<void>,
  ): Promise<void> {
    if (!hasUnsafeWork()) {
      await perform();
      return;
    }
    recovery.stage(project, { unsavedAtSnapshot: true, cloudBinding });
    await recovery.flushNow();
    setReplaceGuard({
      intent,
      perform,
    });
  }

  function cancelReplaceGuard(): void {
    if (replaceGuardSaving) return;
    setReplaceGuard(null);
  }

  function confirmReplaceGuard(): void {
    if (replaceGuardSaving) return;
    const guard = replaceGuard;
    if (!guard) return;
    setReplaceGuardSaving(true);
    void (async () => {
      recovery.cancelPending();
      await recovery.deleteSession(recovery.workingCopyId);
      setReplaceGuard(null);
      await guard.perform();
      setReplaceGuardSaving(false);
    })();
  }

  function saveAndContinueReplaceGuard(): void {
    const guard = replaceGuard;
    if (!guard || replaceGuardSaving) return;
    setReplaceGuardSaving(true);
    void (async () => {
      const outcome = await saveProjectToCloud();
      if (outcome.status === "saved") {
        setReplaceGuard(null);
        await guard.perform();
      }
      setReplaceGuardSaving(false);
    })();
  }

  function createNewProject(): void {
    void guardDirtyReplacement("Create a new Project", () => {
      const next = createEmptyProject(
        createId("project"),
        "New Circuit",
        createId("document"),
      );
      replaceActiveProject(next, defaultViewBox, { source: "new" });
      setStatus("Created a new Project");
    });
  }

  function revertToSavedProjectBaseline(): void {
    const baseline = savedProjectBaseline;
    if (!baseline || !isDirtyWork()) return;
    void guardDirtyReplacement("Revert to the last saved Project", () => {
      const restored = replaceActiveProject(
        baseline.project,
        baseline.viewBox,
        {
          source: "cloud-project",
          persistenceState: "clean",
          cloudBinding,
          savedBaseline: baseline,
        },
      );
      setStatus(`Reverted to saved Project revision ${restored.revision}`);
    });
  }

  function openRecoveryDialog(): void {
    void (async () => {
      await recovery.discover();
      setRecoveryDialogOpen(true);
    })();
  }

  function restoreRecoverySession(
    workingCopyId: string,
    generation: BrowserRecoveryGeneration,
  ): void {
    void (async () => {
      const read = await recovery.readSessionProject(workingCopyId, generation);
      if (read.status !== "valid") {
        setStatus(
          read.status === "unsupported-schema"
            ? "Recovery uses a newer Project schema and cannot be restored; download it instead"
            : `Recovery is not readable: ${
                read.status === "missing" ? "no stored record" : read.message
              }`,
        );
        return;
      }
      const unsupported = findUnsupportedProjectSymbolIds(
        read.project,
        builtInSymbols,
      );
      if (unsupported.length > 0) {
        setStatus(
          `Recovery uses unsupported non-Razavi symbols: ${unsupported.join(", ")}`,
        );
        return;
      }
      await guardDirtyReplacement(
        `Restore recovered Project ${read.project.name}`,
        async () => {
          const recoveredDocument = replaceActiveProject(
            read.project,
            defaultViewBox,
            {
              source: "recovered",
              persistenceState: "dirty",
              cloudBinding: read.record.cloudBinding ?? null,
            },
          );
          setRecoveryDialogOpen(false);
          await recovery.discover();
          setStatus(`Restored recovery revision ${recoveredDocument.revision}`);
        },
      );
    })();
  }

  function downloadRecoveryBackup(
    workingCopyId: string,
    generation: BrowserRecoveryGeneration,
  ): void {
    void (async () => {
      const read = await recovery.readSessionProject(workingCopyId, generation);
      const summary = recovery.sessions.find(
        (session) => session.workingCopyId === workingCopyId,
      );
      if (read.status === "valid" || read.status === "unsupported-schema") {
        const text =
          read.status === "valid" ? read.record.projectText : read.projectText;
        const name =
          summary?.projectName ??
          (read.status === "valid" ? read.record.projectName : "recovery");
        const fileName = `${projectFileBaseName(name)}-backup.icproj.json`;
        const outcome = downloadTextArtifact(text, fileName);
        setStatus(
          outcome.status === "download-requested"
            ? `Download requested: ${outcome.fileName}`
            : `Download failed: ${outcome.message}`,
        );
        return;
      }
      setStatus(
        `Backup not available: ${
          read.status === "missing" ? "no stored record" : read.message
        }`,
      );
    })();
  }

  function deleteRecoverySessionFromDialog(workingCopyId: string): void {
    void (async () => {
      const removed = await recovery.deleteSession(workingCopyId);
      await recovery.discover();
      setStatus(
        removed ? "Deleted recovery copy" : "Could not delete recovery copy",
      );
    })();
  }

  function refreshApp(): void {
    void (async () => {
      recovery.stage(project, {
        unsavedAtSnapshot: isDirtyWork(),
        cloudBinding,
      });
      await recovery.flushNow();
      window.sessionStorage.setItem(REFRESH_RESTORE_STORAGE_KEY, "true");
      window.location.reload();
    })();
  }

  async function openProjectFile(
    file: File | null,
    options: { allowExactCurrentReplacement?: boolean } = {},
  ): Promise<void> {
    if (!file) return;
    const staged = await stageProjectFile(file, (candidate) =>
      findUnsupportedProjectSymbolIds(candidate, builtInSymbols),
    );
    if (staged.status === "rejected") {
      setStatus(
        `Project not opened — ${formatProjectOpenDiagnostics(staged.diagnostics)}`,
      );
      return;
    }
    const normalized = normalizeImportedProjectConductors(
      staged.project,
      projectImportSymbolResolver,
    );
    const openedProject = normalized.project;
    const normalizedDocumentCount = normalized.changedDocumentIds.length;
    const performOpen = () => {
      replaceActiveProject(openedProject, defaultViewBox, {
        source: "opened-file",
        formalFileHint: { name: staged.fileName },
        persistenceState:
          staged.migrated || normalizedDocumentCount > 0 ? "dirty" : "unbound",
      });
      setStatus(
        staged.migrated
          ? `Imported and upgraded ${staged.fileName} from schema ${staged.sourceSchemaVersion} to schema ${openedProject.schemaVersion}${normalizedDocumentCount > 0 ? ` and normalized Wire topology in ${normalizedDocumentCount} Cell${normalizedDocumentCount === 1 ? "" : "s"}` : ""} — save to Cloud or export to keep the upgrade`
          : normalizedDocumentCount > 0
            ? `Opened ${staged.fileName} and normalized Wire topology in ${normalizedDocumentCount} Cell${normalizedDocumentCount === 1 ? "" : "s"} — save to Cloud or export to keep the repair`
            : `Opened ${staged.fileName} at revision ${staged.topDocumentRevision}`,
      );
    };
    if (
      options.allowExactCurrentReplacement &&
      serializeProject(openedProject) === serializeProject(project)
    ) {
      performOpen();
      return;
    }
    await guardDirtyReplacement(`Open ${file.name}`, performOpen);
  }

  async function openCloudProjectById(projectId: string): Promise<void> {
    const fetched = await openCloudProject(projectId);
    if (fetched.status !== "opened") {
      if (fetched.status === "not-found") forgetRecentCloudProject();
      setStatus(
        fetched.status === "signed-out"
          ? "Sign in again to open Cloud Projects"
          : fetched.status === "not-found"
            ? "That Cloud Project no longer exists"
            : `Could not reach Cloud Projects (${fetched.message})`,
      );
      return;
    }
    const cloud = fetched.project;
    const staged = await stageProjectFile(
      {
        name: `${cloud.name}.icproj.json`,
        text: () => Promise.resolve(cloud.projectText),
      },
      (candidate) => findUnsupportedProjectSymbolIds(candidate, builtInSymbols),
    );
    if (staged.status === "rejected") {
      setStatus(
        `Cloud Project not opened — ${formatProjectOpenDiagnostics(staged.diagnostics)}`,
      );
      return;
    }
    const install = () => {
      const baseline = {
        project: structuredClone(staged.project),
        viewBox: { ...defaultViewBox },
      };
      replaceActiveProject(staged.project, defaultViewBox, {
        source: "cloud-project",
        persistenceState: "clean",
        cloudBinding: { id: cloud.id, revision: cloud.revision },
        savedBaseline: baseline,
      });
      setStatus(`Opened Cloud Project ${cloud.name}`);
    };
    if (serializeProject(staged.project) === serializeProject(project)) {
      install();
      return;
    }
    await guardDirtyReplacement(`Open Cloud Project ${cloud.name}`, install);
  }

  useEffect(() => {
    if (!restoreAfterRefresh || !recovery.ready) return;
    if (refreshRestoreAttemptedRef.current) return;
    refreshRestoreAttemptedRef.current = true;
    void (async () => {
      const read = await recovery.readSessionProject(
        recovery.workingCopyId,
        "latest",
      );
      if (read.status !== "valid") {
        setStatus("No restorable recovery was found for this refresh");
        return;
      }
      const unsupported = findUnsupportedProjectSymbolIds(
        read.project,
        builtInSymbols,
      );
      if (unsupported.length > 0) {
        setStatus(
          `Recovery uses unsupported non-Razavi symbols: ${unsupported.join(", ")}`,
        );
        return;
      }
      const restoredDocument = replaceActiveProject(
        read.project,
        defaultViewBox,
        {
          source: "recovered",
          keepWorkingCopy: true,
          persistenceState:
            read.record.unsavedAtSnapshot === false && read.record.cloudBinding
              ? "clean"
              : read.record.unsavedAtSnapshot === false
                ? "unbound"
                : "dirty",
          cloudBinding: read.record.cloudBinding ?? null,
          savedBaseline:
            read.record.unsavedAtSnapshot === false && read.record.cloudBinding
              ? {
                  project: structuredClone(read.project),
                  viewBox: { ...defaultViewBox },
                }
              : null,
        },
      );
      setStatus(`Restored recovery revision ${restoredDocument.revision}`);
    })();
    // The recovery coordinator methods are stable for one mounted editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreAfterRefresh, recovery.ready, recovery.workingCopyId]);

  const currentProjectChangeToken = projectChangeToken(project);
  useEffect(() => {
    const baseline = persistenceChangeRef.current;
    if (baseline === null || baseline.session !== projectSessionId) {
      persistenceChangeRef.current = {
        session: projectSessionId,
        token: currentProjectChangeToken,
      };
      return;
    }
    if (baseline.token !== currentProjectChangeToken) {
      persistenceChangeRef.current = {
        session: projectSessionId,
        token: currentProjectChangeToken,
      };
      const matchesSavedProject =
        savedProjectBaseline !== null &&
        projectChangeToken(savedProjectBaseline.project) ===
          currentProjectChangeToken;
      setPersistenceState(matchesSavedProject ? "clean" : "dirty");
    }
  }, [currentProjectChangeToken, projectSessionId, savedProjectBaseline]);

  const startupRecovery =
    !restoreAfterRefresh && !isDirtyWork()
      ? (recovery.sessions.find(
          (session) =>
            session.workingCopyId === recovery.workingCopyId &&
            session.latest?.review === "valid" &&
            session.latest.unsavedAtSnapshot === true &&
            session.latest.recordId !== dismissedStartupRecoveryRecordId &&
            // Tiny sketches are not worth a banner; the manual Recover menu
            // still lists every snapshot.
            session.latest.meaningfulContent,
        ) ?? null)
      : null;
  const canRestoreStartupCloudProject =
    recovery.ready &&
    !restoreAfterRefresh &&
    !isDirtyWork() &&
    startupRecovery === null;

  return {
    persistenceState,
    cloudBinding,
    savedProjectBaseline,
    replaceGuard,
    replaceGuardSaving,
    recoveryDialogOpen,
    startupRecovery,
    startupCloudProjectId,
    canRestoreStartupCloudProject,
    restoreAfterRefresh,
    setRecoveryDialogOpen,
    isDirtyWork,
    hasUnsafeWork,
    noteProjectSnapshotSafe,
    replaceActiveProject,
    saveProjectToCloud,
    isSaveInFlight: () => saveInFlightRef.current !== null,
    saveBusy: persistenceState === "saving",
    exportProjectFile,
    downloadCurrentProjectBackup,
    guardDirtyReplacement,
    cancelReplaceGuard,
    confirmReplaceGuard,
    saveAndContinueReplaceGuard,
    dismissStartupRecovery: () =>
      setDismissedStartupRecoveryRecordId(
        startupRecovery?.latest?.recordId ?? null,
      ),
    createNewProject,
    revertToSavedProjectBaseline,
    openRecoveryDialog,
    restoreRecoverySession,
    downloadRecoveryBackup,
    deleteRecoverySessionFromDialog,
    refreshApp,
    openProjectFile,
    openCloudProjectById,
  };
}
