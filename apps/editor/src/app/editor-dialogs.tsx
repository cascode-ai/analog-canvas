// The editor's dialogs and banners: recovery, replace guard, Project Info,
// search, insert, Cell properties, External Circuits, Cell import, netlist
// preflight, Gallery publishing and version history, and the Agent
// connection and file approval.
import {
  lazy,
  Suspense,
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import { claimNow } from "../agent/claim-clock";
import { agentConnectionControls } from "../agent/workspace-agent";
import { planProjectCellImport } from "@icm/edit-engine";
import type { runErcChecks } from "@icm/derived";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { ReferenceWindowProps } from "../features/editor-shell/reference-panel";
import type { SimulationSourceLocation } from "@icm/simulation-service/contract";
import type { createEditorCommandRouter } from "../commands/editor-command";
import type {
  EditorDocumentController,
  useDocumentController,
} from "../document/document-controller";
import type { UseRecoveryCoordinatorResult } from "../document/recovery-coordinator";
import type { useProjectFileLifecycle } from "../document/use-project-file-lifecycle";
import type {
  CellInsertCandidate,
  ExternalSubcircuitInsertCandidate,
  ProjectComponentInsertCandidate,
} from "../features/component-insert/insert-component-dialog";
import type { useComponentPlacement } from "../features/component-insert/use-component-placement";
import type { createEditorFileCommands } from "../features/editor-shell/editor-file-commands";
import type { createGalleryExampleCommands } from "../features/editor-shell/gallery-example-commands";
import {
  canUpdateGalleryPublication,
  galleryFixOf,
  publishProjectToGallery,
  updateGalleryEntry,
} from "../features/editor-shell/gallery-publish";
import type { projectWithTopologyRoot } from "../features/editor-shell/gallery-topology-project";
import type { PublishGalleryDraft } from "../features/editor-shell/publish-gallery-dialog";
import type { useEditorPanels } from "../features/editor-shell/use-editor-panels";
import { loadCloudProjectForCellImport } from "../features/hierarchy/cloud-cell-import";
import type { createEditorNavigationController } from "../features/hierarchy/editor-navigation-controller";
import type { createProjectStructureCommands } from "../features/hierarchy/project-structure-commands";
import type { useNetlistExportPreferences } from "../features/netlist-export/netlist-export-preferences";
import { primeGalleryPreview } from "../gallery-client";
import { dismissWorkspaceReopen } from "../document/workspace-reopen";
// The reference window beside the canvas: loaded apart from the editor's
// first payload.
const ReferenceWindow = lazy(() =>
  import("../features/editor-shell/reference-panel").then((module) => ({
    default: module.ReferenceWindow,
  })),
);
import {
  closeOwnReference,
  keepOwnReferenceImage,
  useOwnReferenceImage,
  useOwnReferenceOpen,
} from "../features/editor-shell/own-reference";
import type { GalleryEntryContext } from "../features/editor-shell/gallery-example-commands";
import { CIRCUIT_CLIPBOARD_MIME } from "../features/clipboard/system-clipboard";
import { isTypingTarget } from "./editor-runtime-helpers";
// A paste is the reference image's unless a text field or a circuit takes it.
const ownReferenceTakesPaste = (event: ClipboardEvent) =>
  !isTypingTarget(event.target) &&
  !event.clipboardData?.types.includes(CIRCUIT_CLIPBOARD_MIME);
import type { EditorServices } from "../services/editor-services";
import { DEFAULT_VIEWBOX } from "./default-view-box";
import { EditorDialogLayer } from "./editor-dialog-layer";
import type { createEditorTransactionCommands } from "./editor-transaction-commands";
import type {
  useAgentProjectResources,
  useEditorAgentConnection,
} from "./use-agent-hosts";
import type { useEditorDerivedModel } from "./use-editor-derived-model";
import type {
  useGalleryPublicationLink,
  useGalleryPublicationRecord,
  useGalleryPublishing,
  useGalleryRefresh,
} from "./use-gallery-publishing";
import type { useProjectTabSessions } from "./use-project-tab-sessions";

type DocumentControllerState = ReturnType<typeof useDocumentController>;
type ProjectFileLifecycle = ReturnType<typeof useProjectFileLifecycle>;
type EditorPanels = ReturnType<typeof useEditorPanels>;
type GalleryRefresh = ReturnType<typeof useGalleryRefresh>;
type GalleryPublishing = ReturnType<typeof useGalleryPublishing>;
type AgentProjectResources = ReturnType<typeof useAgentProjectResources>;
type AgentProjectResourcesOptions = Parameters<
  typeof useAgentProjectResources
>[0];
type AgentConnection = ReturnType<typeof useEditorAgentConnection>;
type TransactionCommands = ReturnType<typeof createEditorTransactionCommands>;
type ProjectStructureCommands = ReturnType<
  typeof createProjectStructureCommands
>;
type GalleryExampleCommands = ReturnType<typeof createGalleryExampleCommands>;
type EditorDerivedModel = ReturnType<typeof useEditorDerivedModel>;
type ComponentPlacement = ReturnType<typeof useComponentPlacement>;
type NavigationController = ReturnType<typeof createEditorNavigationController>;
type ProjectTabSessions = ReturnType<typeof useProjectTabSessions>;

/** The dialog layer, with each dialog bound to the editor while it is open. */
export function EditorDialogs({
  projectStore,
  nativeProjectStore,
  exportDelivery,
  publicAgentUiEnabled,
  setStatus,
  searchOpen,
  searchQuery,
  setSearchQuery,
  agentPanelOpen,
  setAgentPanelOpen,
  closeSearch,
  galleryLoadGenerationRef,
  setGalleryRefreshSignal,
  recoveryFailureDismissed,
  setRecoveryFailureDismissed,
  chunkLoadFailure,
  setChunkLoadFailure,
  recoveryState,
  recoverySessions,
  project,
  document,
  dispatchProjectTransaction,
  editorDocumentController,
  projectSessionId,
  galleryTopologyProject,
  cellPropertiesId,
  setCellPropertiesId,
  importCellOpen,
  setImportCellOpen,
  renameCellTerminal,
  setCellSymbolBodySize,
  setCellSymbolPortPlacement,
  cellManagerOpen,
  setCellManagerOpen,
  modelEditorDefinitionId,
  setModelEditorDefinitionId,
  modelEditorLocation,
  setModelEditorLocation,
  netlistPreflightOpen,
  setNetlistPreflightOpen,
  netlistPreferences,
  netlistRootDocumentId,
  publishGalleryOpen,
  setPublishGalleryOpen,
  openedFromCheckNotice,
  versionHistoryOpen,
  setVersionHistoryOpen,
  publishSession,
  cloudProjects,
  galleryEntryContext,
  publicationLinkLoading,
  publicationLinkError,
  publicationLinkNotice,
  setPublicationLinkRetry,
  publishGates,
  publishQuota,
  openProjectInTabRef,
  agentFileCandidate,
  localDelivery,
  cloudBinding,
  replaceGuard,
  replaceGuardSaving,
  recoveryDialogOpen,
  startupRecovery,
  setRecoveryDialogOpen,
  isDirtyWork,
  downloadCurrentProjectBackup,
  cancelReplaceGuard,
  confirmReplaceGuard,
  saveAndContinueReplaceGuard,
  dismissStartupRecovery,
  restoreRecoverySession,
  downloadRecoveryBackup,
  deleteRecoverySessionFromDialog,
  linkExistingPublication,
  startupCloudRestoreAttemptedRef,
  agentSession,
  approveAgentFileCandidate,
  rejectAgentFileCandidate,
  commitStructure,
  renameCell,
  setGalleryEntryContext,
  setTopCell,
  renameProject,
  updateCellPortDirection,
  moveCellPort,
  editCellParameter,
  setExternalSubcircuitDefinition,
  removeExternalSubcircuitDefinition,
  openGalleryEntryById,
  publishDraft,
  setPublishDraft,
  searchResults,
  requestElectricalDiagnostics,
  cellInsertCandidates,
  insertDialogExternalCandidates,
  insertDialogProjectComponents,
  cancelComponentInsertFromHook,
  insertDialogOpen,
  insertInitialSelectionId,
  insertScope,
  recentSymbolIds,
  jumpToCaller,
  placeExternalCircuit,
  openCreatedCell,
  navigateToNetlistDiagnostic,
  selectSearchResult,
  jumpToProjectDiagnostic,
  editorCommands,
  exportDesignNetlist,
  workspaceReopen,
  setWorkspaceReopen,
  reopenClosedWindowTabs,
  recordGalleryPublication,
}: {
  projectStore: EditorServices["projectStore"];
  nativeProjectStore: EditorServices["nativeProjectStore"];
  exportDelivery: EditorServices["exportDelivery"];
  publicAgentUiEnabled: boolean;
  setStatus: Dispatch<SetStateAction<string>>;
  searchOpen: EditorPanels["searchOpen"];
  searchQuery: EditorPanels["searchQuery"];
  setSearchQuery: EditorPanels["setSearchQuery"];
  agentPanelOpen: EditorPanels["agentPanelOpen"];
  setAgentPanelOpen: EditorPanels["setAgentPanelOpen"];
  closeSearch: EditorPanels["closeSearch"];
  galleryLoadGenerationRef: GalleryRefresh["galleryLoadGenerationRef"];
  setGalleryRefreshSignal: GalleryRefresh["setGalleryRefreshSignal"];
  recoveryFailureDismissed: boolean;
  setRecoveryFailureDismissed: Dispatch<SetStateAction<boolean>>;
  chunkLoadFailure: string | null;
  setChunkLoadFailure: Dispatch<SetStateAction<string | null>>;
  recoveryState: UseRecoveryCoordinatorResult["state"];
  recoverySessions: UseRecoveryCoordinatorResult["sessions"];
  project: CircuitProject;
  document: SchematicDocument;
  dispatchProjectTransaction: DocumentControllerState["dispatchProjectTransaction"];
  editorDocumentController: EditorDocumentController;
  projectSessionId: string;
  galleryTopologyProject: ReturnType<typeof projectWithTopologyRoot>;
  cellPropertiesId: string | null;
  setCellPropertiesId: Dispatch<SetStateAction<string | null>>;
  importCellOpen: boolean;
  setImportCellOpen: Dispatch<SetStateAction<boolean>>;
  renameCellTerminal: ProjectStructureCommands["renameCellTerminal"];
  setCellSymbolBodySize: ProjectStructureCommands["setCellSymbolBodySize"];
  setCellSymbolPortPlacement: ProjectStructureCommands["setCellSymbolPortPlacement"];
  cellManagerOpen: boolean;
  setCellManagerOpen: Dispatch<SetStateAction<boolean>>;
  modelEditorDefinitionId: string | null;
  setModelEditorDefinitionId: Dispatch<SetStateAction<string | null>>;
  modelEditorLocation: SimulationSourceLocation | undefined;
  setModelEditorLocation: Dispatch<
    SetStateAction<SimulationSourceLocation | undefined>
  >;
  netlistPreflightOpen: boolean;
  setNetlistPreflightOpen: Dispatch<SetStateAction<boolean>>;
  netlistPreferences: ReturnType<typeof useNetlistExportPreferences>;
  netlistRootDocumentId: string | undefined;
  publishGalleryOpen: GalleryPublishing["publishGalleryOpen"];
  setPublishGalleryOpen: GalleryPublishing["setPublishGalleryOpen"];
  openedFromCheckNotice: GalleryPublishing["openedFromCheckNotice"];
  versionHistoryOpen: GalleryPublishing["versionHistoryOpen"];
  setVersionHistoryOpen: GalleryPublishing["setVersionHistoryOpen"];
  publishSession: GalleryPublishing["publishSession"];
  cloudProjects: GalleryPublishing["cloudProjects"];
  galleryEntryContext: GalleryPublishing["galleryEntryContext"];
  publicationLinkLoading: GalleryPublishing["publicationLinkLoading"];
  publicationLinkError: GalleryPublishing["publicationLinkError"];
  publicationLinkNotice: GalleryPublishing["publicationLinkNotice"];
  setPublicationLinkRetry: GalleryPublishing["setPublicationLinkRetry"];
  publishGates: GalleryPublishing["publishGates"];
  publishQuota: GalleryPublishing["publishQuota"];
  openProjectInTabRef: AgentProjectResourcesOptions["openProjectInTabRef"];
  agentFileCandidate: AgentProjectResources["agentFileCandidate"];
  localDelivery: ReferenceWindowProps["localDelivery"];
  cloudBinding: ProjectFileLifecycle["cloudBinding"];
  replaceGuard: ProjectFileLifecycle["replaceGuard"];
  replaceGuardSaving: ProjectFileLifecycle["replaceGuardSaving"];
  recoveryDialogOpen: ProjectFileLifecycle["recoveryDialogOpen"];
  startupRecovery: ProjectFileLifecycle["startupRecovery"];
  setRecoveryDialogOpen: ProjectFileLifecycle["setRecoveryDialogOpen"];
  isDirtyWork: ProjectFileLifecycle["isDirtyWork"];
  downloadCurrentProjectBackup: ProjectFileLifecycle["downloadCurrentProjectBackup"];
  cancelReplaceGuard: ProjectFileLifecycle["cancelReplaceGuard"];
  confirmReplaceGuard: ProjectFileLifecycle["confirmReplaceGuard"];
  saveAndContinueReplaceGuard: ProjectFileLifecycle["saveAndContinueReplaceGuard"];
  dismissStartupRecovery: ProjectFileLifecycle["dismissStartupRecovery"];
  restoreRecoverySession: ProjectFileLifecycle["restoreRecoverySession"];
  downloadRecoveryBackup: ProjectFileLifecycle["downloadRecoveryBackup"];
  deleteRecoverySessionFromDialog: ProjectFileLifecycle["deleteRecoverySessionFromDialog"];
  linkExistingPublication: ReturnType<typeof useGalleryPublicationLink>;
  startupCloudRestoreAttemptedRef: RefObject<boolean>;
  agentSession: AgentConnection["agentSession"];
  approveAgentFileCandidate: AgentConnection["approveAgentFileCandidate"];
  rejectAgentFileCandidate: AgentConnection["rejectAgentFileCandidate"];
  commitStructure: TransactionCommands["commitStructure"];
  renameCell: ProjectStructureCommands["renameCell"];
  setGalleryEntryContext: Dispatch<SetStateAction<GalleryEntryContext | null>>;
  setTopCell: ProjectStructureCommands["setTopCell"];
  renameProject: ProjectStructureCommands["renameProject"];
  updateCellPortDirection: ProjectStructureCommands["updateCellPortDirection"];
  moveCellPort: ProjectStructureCommands["moveCellPort"];
  editCellParameter: ProjectStructureCommands["editCellParameter"];
  setExternalSubcircuitDefinition: ProjectStructureCommands["setExternalSubcircuitDefinition"];
  removeExternalSubcircuitDefinition: ProjectStructureCommands["removeExternalSubcircuitDefinition"];
  openGalleryEntryById: GalleryExampleCommands["openGalleryEntryById"];
  publishDraft: PublishGalleryDraft | null;
  setPublishDraft: Dispatch<SetStateAction<PublishGalleryDraft | null>>;
  searchResults: EditorDerivedModel["searchResults"];
  requestElectricalDiagnostics: () => ReturnType<typeof runErcChecks>;
  cellInsertCandidates: readonly CellInsertCandidate[];
  insertDialogExternalCandidates: readonly ExternalSubcircuitInsertCandidate[];
  insertDialogProjectComponents: readonly ProjectComponentInsertCandidate[];
  cancelComponentInsertFromHook: ComponentPlacement["cancelComponentInsert"];
  insertDialogOpen: ComponentPlacement["insertDialogOpen"];
  insertInitialSelectionId: ComponentPlacement["insertInitialSelectionId"];
  insertScope: ComponentPlacement["insertScope"];
  recentSymbolIds: ComponentPlacement["recentSymbolIds"];
  jumpToCaller: NavigationController["jumpToCaller"];
  /** Start placing an external circuit; false when it has no symbol. */
  placeExternalCircuit: (definitionId: string) => boolean;
  /** Open a Cell a transaction just created, once the Project holds it. */
  openCreatedCell(documentId: string): void;
  navigateToNetlistDiagnostic: NavigationController["navigateToNetlistDiagnostic"];
  selectSearchResult: NavigationController["selectSearchResult"];
  jumpToProjectDiagnostic: NavigationController["jumpToProjectDiagnostic"];
  editorCommands: ReturnType<typeof createEditorCommandRouter>;
  exportDesignNetlist: ReturnType<
    typeof createEditorFileCommands
  >["exportDesignNetlist"];
  workspaceReopen: ProjectTabSessions["workspaceReopen"];
  setWorkspaceReopen: ProjectTabSessions["setWorkspaceReopen"];
  reopenClosedWindowTabs: ProjectTabSessions["reopenClosedWindowTabs"];
  recordGalleryPublication: ReturnType<typeof useGalleryPublicationRecord>;
}) {
  const ownReferenceOpen = useOwnReferenceOpen();
  const ownReference = useOwnReferenceImage(projectSessionId);
  const keepReferenceImage = useCallback(
    (file: File) => keepOwnReferenceImage(projectSessionId, file),
    [projectSessionId],
  );
  // The window's saved name and description stay with the drawing: its
  // name, its Gallery entry's (already saved there) or its draft's for
  // Publish.
  const referenceSaved = ({
    name,
    description,
  }: {
    name: string;
    description: string;
  }) => {
    renameProject(name);
    if (galleryEntryContext) {
      const savedId = galleryEntryContext.id;
      setGalleryEntryContext((current) =>
        current?.id === savedId ? { ...current, name, description } : current,
      );
      galleryLoadGenerationRef.current += 1;
      setGalleryRefreshSignal((previous) => previous + 1);
      setStatus(`Saved "${name}" in the gallery`);
      return;
    }
    setPublishDraft((previous) => ({
      ...previous,
      name,
      description,
      tags: previous?.tags ?? [],
      editedFields: {
        ...previous?.editedFields,
        name: true,
        description: true,
        tags: previous?.editedFields?.tags ?? false,
      },
    }));
    setStatus(`Saved "${name}"; Publish starts from it`);
  };
  const galleryEntry = import.meta.env?.ICM_DESKTOP
    ? null
    : galleryEntryContext;
  return (
    <>
      {/* The drawing's name, description and reference image, beside it. */}
      <Suspense fallback={null}>
        <ReferenceWindow
          key={`${projectSessionId}:${galleryEntry?.id ?? ""}`}
          open={ownReferenceOpen}
          onClose={closeOwnReference}
          entry={galleryEntry}
          session={publishSession}
          draft={{
            name: project.name,
            description: publishDraft?.description ?? "",
          }}
          image={ownReference}
          onImage={keepReferenceImage}
          takesPaste={ownReferenceTakesPaste}
          onSaved={referenceSaved}
          localDelivery={localDelivery}
        />
      </Suspense>
      <EditorDialogLayer
        chunkLoadFailure={
          chunkLoadFailure === null
            ? null
            : {
                feature: chunkLoadFailure,
                onDismiss: () => setChunkLoadFailure(null),
              }
        }
        recoveryFailure={
          (recoveryState === "quota-exceeded" ||
            recoveryState === "unavailable" ||
            recoveryState === "failed") &&
          isDirtyWork() &&
          !recoveryFailureDismissed
            ? {
                state: recoveryState,
                onDownload: () => void downloadCurrentProjectBackup(),
                onDismiss: () => setRecoveryFailureDismissed(true),
              }
            : null
        }
        recoveryAvailable={
          startupRecovery?.latest
            ? {
                projectName: startupRecovery.projectName,
                updatedAt: startupRecovery.latest.updatedAt,
                onRestore: () => {
                  startupCloudRestoreAttemptedRef.current = true;
                  dismissStartupRecovery();
                  restoreRecoverySession(
                    startupRecovery.workingCopyId,
                    "latest",
                  );
                },
                onDownload: () =>
                  downloadRecoveryBackup(
                    startupRecovery.workingCopyId,
                    "latest",
                  ),
                onDismiss: dismissStartupRecovery,
              }
            : null
        }
        workspaceReopen={
          workspaceReopen
            ? {
                names: workspaceReopen.summary.names,
                savedAt: workspaceReopen.summary.savedAt,
                onReopen: () => void reopenClosedWindowTabs(),
                onDismiss: () => {
                  dismissWorkspaceReopen(workspaceReopen.summary.savedAt);
                  setWorkspaceReopen(null);
                },
              }
            : null
        }
        recentRecovery={
          recoveryDialogOpen && recoverySessions.length > 0
            ? {
                sessions: recoverySessions,
                onRestore: restoreRecoverySession,
                onDownloadBackup: downloadRecoveryBackup,
                onDeleteSession: deleteRecoverySessionFromDialog,
                onClose: () => setRecoveryDialogOpen(false),
              }
            : null
        }
        replaceGuard={
          replaceGuard !== null
            ? {
                intent: replaceGuard.intent,
                cloudProjectLimit: projectStore?.limit ?? 0,
                exportOnly: projectStore === null,
                nativeSave: nativeProjectStore !== undefined,
                saving: replaceGuardSaving,
                onCancel: cancelReplaceGuard,
                onSaveAndContinue: saveAndContinueReplaceGuard,
                onDiscard: confirmReplaceGuard,
              }
            : null
        }
        search={
          searchOpen
            ? {
                open: searchOpen,
                query: searchQuery,
                results: searchResults,
                onQueryChange: setSearchQuery,
                onSelect: selectSearchResult,
                onClose: closeSearch,
              }
            : null
        }
        insertComponent={
          insertDialogOpen
            ? {
                open: insertDialogOpen,
                styleProfileId: document.presentation.styleProfileId,
                recentSymbolIds,
                cells: cellInsertCandidates,
                externalDefinitions: insertDialogExternalCandidates,
                projectComponents: insertDialogProjectComponents,
                scope: insertScope,
                initialSelectionId: insertInitialSelectionId,
                onApply: (request) =>
                  editorCommands.execute({
                    id: "insert.start",
                    launch: { kind: "quick", request },
                  }),
                onCancel: cancelComponentInsertFromHook,
              }
            : null
        }
        cellManager={
          cellManagerOpen
            ? {
                open: cellManagerOpen,
                initialExternalId: modelEditorDefinitionId,
                initialModelLocation: modelEditorLocation,
                project,
                onClose: () => {
                  setCellManagerOpen(false);
                  setModelEditorDefinitionId(null);
                  setModelEditorLocation(undefined);
                },
                onJumpToCaller: jumpToCaller,
                externalDefinitions: project.externalSubcircuitDefinitions,
                onSetExternalDefinition: setExternalSubcircuitDefinition,
                onCopyModelText: (text) => exportDelivery.copyText(text),
                onApplyModelSource: (edit) => {
                  const result = dispatchProjectTransaction({
                    transactionId: `model-${crypto.randomUUID()}`,
                    projectId: project.id,
                    expectedStructureRevision: project.structureRevision,
                    actor: { kind: "human", id: "human-local" },
                    edits: [edit],
                  });
                  return {
                    ok: result.ok,
                    definitionId: edit.definitions[0]!.definitionId,
                    message: result.ok
                      ? "Applied shared model definition"
                      : (result.diagnostics[0]?.message ??
                        result.error.message),
                  };
                },
                onSaveModelDraft: (edits, definitionId) => {
                  const result = dispatchProjectTransaction({
                    transactionId: `model-draft-${crypto.randomUUID()}`,
                    projectId: project.id,
                    expectedStructureRevision: project.structureRevision,
                    actor: { kind: "human", id: "human-local" },
                    edits,
                  });
                  return {
                    ok: result.ok,
                    definitionId,
                    message: result.ok
                      ? "Saved draft. Applied model bytes are unchanged."
                      : (result.diagnostics[0]?.message ??
                        result.error.message),
                  };
                },
                onRemoveExternalDefinition: removeExternalSubcircuitDefinition,
                onPlaceExternal: (definitionId) =>
                  void placeExternalCircuit(definitionId),
              }
            : null
        }
        cellProperties={
          cellPropertiesId
            ? {
                project,
                cellId: cellPropertiesId,
                onClose: () => setCellPropertiesId(null),
                onRename: renameCell,
                onRenamePin: (cellId, terminalId, name) =>
                  renameCellTerminal(terminalId, name, cellId),
                onSetPinDirection: (cellId, portId, direction) =>
                  updateCellPortDirection(portId, direction, cellId),
                onMovePin: (cellId, portId, delta) =>
                  moveCellPort(portId, delta, cellId),
                onEditParameter: (cellId, name, change) =>
                  editCellParameter(name, change, cellId),
                onSymbolSizeChange: setCellSymbolBodySize,
                onPinSideChange: setCellSymbolPortPlacement,
                onSetTop: (cellId) => void setTopCell(cellId),
              }
            : null
        }
        importCell={
          importCellOpen
            ? {
                cloudProjects,
                activeCloudProjectId: cloudBinding?.id ?? null,
                ...(!import.meta.env?.ICM_DESKTOP
                  ? { onLoadCloudProject: loadCloudProjectForCellImport }
                  : {}),
                onImportCloudCell: async (source, sourceDocumentId) => {
                  const plan = planProjectCellImport(
                    project,
                    source,
                    sourceDocumentId,
                  );
                  if (!plan.ok) {
                    return { ok: false, message: plan.message };
                  }
                  if (plan.status === "already-imported") {
                    setStatus(
                      "Cell is already imported; opened the existing copy",
                    );
                    return {
                      ok: true,
                      message: "Cell already imported",
                      documentId: plan.rootDocumentId,
                    };
                  }
                  const committed = commitStructure("import-cloud-cell", [
                    ...plan.edits,
                  ]);
                  if (!committed) {
                    return {
                      ok: false,
                      message:
                        "Cell import was rejected; refresh and try again",
                    };
                  }
                  setStatus(
                    `Imported ${plan.importedDocumentIds.length} Cell${plan.importedDocumentIds.length === 1 ? "" : "s"} from ${source.name}`,
                  );
                  return {
                    ok: true,
                    message: "Cell imported",
                    documentId: plan.rootDocumentId,
                  };
                },
                onImported: (documentId) => {
                  setImportCellOpen(false);
                  if (documentId) openCreatedCell(documentId);
                },
                onClose: () => setImportCellOpen(false),
              }
            : null
        }
        netlistPreflight={
          netlistPreflightOpen
            ? {
                open: netlistPreflightOpen,
                project,
                format: netlistPreferences.format,
                rootDocumentId: netlistRootDocumentId,
                // The dialog only renders while open, so this IS the
                // explicit check the author asked for.
                electricalDiagnostics: requestElectricalDiagnostics(),
                onClose: () => setNetlistPreflightOpen(false),
                onNavigate: navigateToNetlistDiagnostic,
                onNavigateElectrical: jumpToProjectDiagnostic,
                onExport: (namingProfile) =>
                  void exportDesignNetlist(
                    netlistPreferences.format,
                    namingProfile,
                  ),
              }
            : null
        }
        publishGallery={
          !import.meta.env?.ICM_DESKTOP && publishGalleryOpen
            ? {
                draft: publishDraft,
                onDraftChange: setPublishDraft,
                ownReference,
                defaultName: galleryEntryContext?.name ?? project.name,
                session: publishSession,
                gateReport: publishGates,
                topologyProject: galleryTopologyProject,
                openedFromCheckNotice,
                publicationLinkLoading,
                publicationLinkError,
                publicationLinkNotice,
                onRetryPublicationLink: () =>
                  setPublicationLinkRetry((value) => value + 1),
                ...(cloudBinding
                  ? { onLinkExisting: linkExistingPublication }
                  : {}),
                updateTarget: canUpdateGalleryPublication(
                  galleryEntryContext,
                  publishSession,
                  publishQuota?.fixes,
                )
                  ? {
                      id: galleryEntryContext!.id,
                      name: galleryEntryContext!.name,
                    }
                  : null,
                fix: galleryFixOf(galleryEntryContext, publishSession)
                  ? {
                      of: galleryFixOf(galleryEntryContext, publishSession)!,
                      edits: publishQuota?.fixes ?? null,
                    }
                  : null,
                updateDefaults: galleryEntryContext
                  ? {
                      description: galleryEntryContext.description,
                      tags: galleryEntryContext.tags,
                      aiGenerated: galleryEntryContext.aiGenerated === true,
                    }
                  : null,
                agentEdited: editorDocumentController.agentEdited,
                quota: publishQuota,
                publish: (fields) =>
                  publishProjectToGallery(project, fields, fetch, cloudBinding),
                ...(galleryEntryContext
                  ? {
                      publishUpdate: (fields) =>
                        updateGalleryEntry(
                          galleryEntryContext.id,
                          project,
                          fields,
                          fetch,
                          cloudBinding,
                        ),
                    }
                  : {}),
                onPublished: (outcome) => {
                  if (
                    recordGalleryPublication(
                      outcome,
                      projectSessionId,
                      "person",
                    )
                  ) {
                    setPublishGalleryOpen(false);
                    setPublishDraft(null);
                  }
                },
                ...(galleryEntryContext
                  ? {
                      onShowHistory: () => {
                        setPublishGalleryOpen(false);
                        setVersionHistoryOpen(true);
                      },
                    }
                  : {}),
                onClose: () => setPublishGalleryOpen(false),
              }
            : null
        }
        versionHistory={
          !import.meta.env?.ICM_DESKTOP &&
          versionHistoryOpen &&
          galleryEntryContext
            ? {
                entryId: galleryEntryContext.id,
                entryName: galleryEntryContext.name,
                onBranch: async (snapshot) => {
                  // The tab guard reads the committed dialog state. Waiting a
                  // frame can still race a concurrent React render here.
                  flushSync(() => setVersionHistoryOpen(false));
                  return openProjectInTabRef.current(
                    snapshot,
                    DEFAULT_VIEWBOX,
                    {
                      source: "opened-file",
                      persistenceState: "dirty",
                    },
                  );
                },
                onRestored: ({ previewRevision }) => {
                  void primeGalleryPreview(
                    galleryEntryContext.id,
                    previewRevision,
                  );
                  galleryLoadGenerationRef.current += 1;
                  setGalleryRefreshSignal((previous) => previous + 1);
                  setVersionHistoryOpen(false);
                  setStatus("Version restored — reloading the entry");
                  void openGalleryEntryById(galleryEntryContext.id);
                },
                onClose: () => setVersionHistoryOpen(false),
              }
            : null
        }
        agentConnection={
          !import.meta.env?.ICM_DESKTOP &&
          publicAgentUiEnabled &&
          agentSession &&
          agentPanelOpen
            ? {
                ...agentConnectionControls(agentSession),
                open: agentPanelOpen,
                now: claimNow(),
                onClose: () => setAgentPanelOpen(false),
              }
            : null
        }
        agentFileApproval={
          publicAgentUiEnabled && agentFileCandidate
            ? {
                candidate: agentFileCandidate,
                onReject: rejectAgentFileCandidate,
                onApprove: approveAgentFileCandidate,
              }
            : null
        }
      />
    </>
  );
}
