// The editor's dialogs and banners: recovery, replace guard, Project Info,
// search, insert, Cell Manager, netlist preflight, Gallery publishing and
// version history, and the Agent connection and file approval.
import type { Dispatch, RefObject, SetStateAction } from "react";
import { flushSync } from "react-dom";
import { planProjectCellImport } from "@icm/edit-engine";
import type {
  HierarchyFrame,
  ProjectConnectivityIndex,
  runErcChecks,
  summarizeProjectCells,
} from "@icm/derived";
import type { CircuitProject, SchematicDocument } from "@icm/model";
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
} from "../features/component-insert/insert-component-dialog";
import type { useComponentPlacement } from "../features/component-insert/use-component-placement";
import type { createEditorFileCommands } from "../features/editor-shell/editor-file-commands";
import type { createGalleryExampleCommands } from "../features/editor-shell/gallery-example-commands";
import {
  canUpdateGalleryPublication,
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
  projectConnectivityIndex,
  setDocumentStack,
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
  projectInfoOpen,
  setProjectInfoOpen,
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
  createCell,
  renameCell,
  editProjectInfo,
  deleteCell,
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
  externalSubcircuitInsertCandidates,
  insertDialogExternalCandidates,
  cancelComponentInsertFromHook,
  insertDialogOpen,
  insertInitialSelectionId,
  insertScope,
  recentSymbolIds,
  switchDocument,
  jumpToCaller,
  navigateToLocator,
  navigateToNetlistDiagnostic,
  selectSearchResult,
  jumpToProjectDiagnostic,
  cellManagerEntries,
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
  projectConnectivityIndex: ProjectConnectivityIndex;
  setDocumentStack: Dispatch<SetStateAction<HierarchyFrame[]>>;
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
  projectInfoOpen: boolean;
  setProjectInfoOpen: Dispatch<SetStateAction<boolean>>;
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
  createCell: ProjectStructureCommands["createCell"];
  renameCell: ProjectStructureCommands["renameCell"];
  editProjectInfo: ProjectStructureCommands["editProjectInfo"];
  deleteCell: ProjectStructureCommands["deleteCell"];
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
  externalSubcircuitInsertCandidates: readonly ExternalSubcircuitInsertCandidate[];
  insertDialogExternalCandidates: readonly ExternalSubcircuitInsertCandidate[];
  cancelComponentInsertFromHook: ComponentPlacement["cancelComponentInsert"];
  insertDialogOpen: ComponentPlacement["insertDialogOpen"];
  insertInitialSelectionId: ComponentPlacement["insertInitialSelectionId"];
  insertScope: ComponentPlacement["insertScope"];
  recentSymbolIds: ComponentPlacement["recentSymbolIds"];
  switchDocument: NavigationController["switchDocument"];
  jumpToCaller: NavigationController["jumpToCaller"];
  navigateToLocator: NavigationController["navigateToLocator"];
  navigateToNetlistDiagnostic: NavigationController["navigateToNetlistDiagnostic"];
  selectSearchResult: NavigationController["selectSearchResult"];
  jumpToProjectDiagnostic: NavigationController["jumpToProjectDiagnostic"];
  cellManagerEntries: ReturnType<typeof summarizeProjectCells>;
  editorCommands: ReturnType<typeof createEditorCommandRouter>;
  exportDesignNetlist: ReturnType<
    typeof createEditorFileCommands
  >["exportDesignNetlist"];
  workspaceReopen: ProjectTabSessions["workspaceReopen"];
  setWorkspaceReopen: ProjectTabSessions["setWorkspaceReopen"];
  reopenClosedWindowTabs: ProjectTabSessions["reopenClosedWindowTabs"];
  recordGalleryPublication: ReturnType<typeof useGalleryPublicationRecord>;
}) {
  return (
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
                restoreRecoverySession(startupRecovery.workingCopyId, "latest");
              },
              onDownload: () =>
                downloadRecoveryBackup(startupRecovery.workingCopyId, "latest"),
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
              onDismiss: () => setWorkspaceReopen(null),
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
      projectInfo={
        projectInfoOpen
          ? {
              name: project.name,
              documentName: document.name,
              publication: galleryEntryContext,
              onSave: editProjectInfo,
              onClose: () => setProjectInfoOpen(false),
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
              cells: cellManagerEntries,
              project,
              hierarchyCalls: projectConnectivityIndex.hierarchy.calls,
              onOpenOccurrence: (documentId, hierarchyPath) => {
                navigateToLocator(
                  {
                    documentId,
                    hierarchyPath: [...hierarchyPath],
                    kind: "document",
                    objectId: documentId,
                  },
                  "Opened Cell occurrence",
                );
                setCellManagerOpen(false);
              },
              activeDocumentId: document.id,
              onClose: () => {
                setCellManagerOpen(false);
                setModelEditorDefinitionId(null);
                setModelEditorLocation(undefined);
              },
              onCreate: (name) => {
                createCell(name);
                setCellManagerOpen(false);
              },
              onOpen: (documentId) => {
                setCellManagerOpen(false);
                setDocumentStack([]);
                switchDocument(documentId);
              },
              onRename: renameCell,
              onReorder: (documentIds, topDocumentId) => {
                commitStructure("reorder-cells", [
                  { kind: "reorder_documents", documentIds },
                  { kind: "set_top_document", documentId: topDocumentId },
                ]);
              },
              onDelete: (documentId) => {
                if (deleteCell(documentId)) {
                  setCellManagerOpen(false);
                }
              },
              onJumpToCaller: jumpToCaller,
              onSetPortDirection: (documentId, portId, direction) =>
                updateCellPortDirection(portId, direction, documentId),
              onMovePort: (documentId, portId, delta) =>
                moveCellPort(portId, delta, documentId),
              onEditParameter: (documentId, name, change) =>
                editCellParameter(name, change, documentId),
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
                    : (result.diagnostics[0]?.message ?? result.error.message),
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
                    : (result.diagnostics[0]?.message ?? result.error.message),
                };
              },
              onRemoveExternalDefinition: removeExternalSubcircuitDefinition,
              onPlaceExternal: (definitionId) => {
                const candidate = externalSubcircuitInsertCandidates.find(
                  (item) => item.definitionId === definitionId,
                );
                if (!candidate) {
                  setStatus(
                    "The selected external master has no resolved symbol",
                  );
                  return;
                }
                setCellManagerOpen(false);
                setModelEditorDefinitionId(null);
                editorCommands.execute({
                  id: "insert.start",
                  launch: {
                    kind: "quick",
                    request: {
                      kind: "external-subcircuit",
                      definitionId,
                      symbolId: candidate.symbol.id,
                      symbolName: candidate.masterName,
                      masterName: candidate.masterName,
                      parameters: {},
                      initialRotation: 0,
                      showReference: !candidate.symbol.hierarchicalBlock,
                      referenceText: null,
                      showValue: true,
                    },
                  },
                });
              },
              onPlaceCell: (childDocumentId) => {
                const candidate = cellInsertCandidates.find(
                  (c) => c.childDocumentId === childDocumentId,
                );
                if (!candidate) return;
                setCellManagerOpen(false);
                setModelEditorDefinitionId(null);
                editorCommands.execute({
                  id: "insert.start",
                  launch: {
                    kind: "quick",
                    request: {
                      kind: "cell",
                      symbolId: candidate.symbol.id,
                      symbolName: candidate.cellName,
                      childDocumentId,
                      cellName: candidate.cellName,
                      parameters: {},
                      initialRotation: 0,
                      showReference: false,
                      referenceText: null,
                      showValue: true,
                    },
                  },
                });
              },
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
                    message: "Cell import was rejected; refresh and try again",
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
              )
                ? {
                    id: galleryEntryContext!.id,
                    name: galleryEntryContext!.name,
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
                  recordGalleryPublication(outcome, projectSessionId, "person")
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
                return openProjectInTabRef.current(snapshot, DEFAULT_VIEWBOX, {
                  source: "opened-file",
                  persistenceState: "dirty",
                });
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
        publicAgentUiEnabled && agentSession && agentPanelOpen
          ? {
              open: agentPanelOpen,
              status: agentSession.status,
              pendingOperation: agentSession.pendingOperation,
              claimCode: agentSession.claimCode,
              claimExpiresAt: agentSession.claimExpiresAt,
              scopes: agentSession.scopes,
              expiresAt: agentSession.expiresAt,
              error: agentSession.error,
              backgroundRequests: agentSession.backgroundRequests,
              now: Date.now(),
              onPause: () => void agentSession.pause(),
              onResume: () => void agentSession.resume(),
              onReconnect: agentSession.reconnect,
              onNewConnection: () => void agentSession.newConnection(),
              onRevoke: () => void agentSession.revoke(),
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
  );
}
