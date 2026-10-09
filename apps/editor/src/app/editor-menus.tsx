// The editor's menus bound to its commands: the header with its project tabs,
// File, Edit and Circuit menus and toolbars, and the canvas context menu.
import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  deriveRoutingAffectedClosure,
  type HierarchyFrame,
} from "@icm/derived";
import type { WireSource } from "@icm/edit-engine";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { createEditorCommandRouter } from "../commands/editor-command";
import type { UseRecoveryCoordinatorResult } from "../document/recovery-coordinator";
import type { useProjectFileLifecycle } from "../document/use-project-file-lifecycle";
import type { SchematicClipboard } from "../features/clipboard/clipboard";
import type { CellInsertCandidate } from "../features/component-insert/insert-component-dialog";
import { fullInsertLaunch } from "../features/component-insert/insert-launch";
import type { createEditorFileCommands } from "../features/editor-shell/editor-file-commands";
import { ProjectTabs } from "../features/editor-shell/project-tabs";
import type { useEditorPanels } from "../features/editor-shell/use-editor-panels";
import type { createEditorNavigationController } from "../features/hierarchy/editor-navigation-controller";
import type { createProjectStructureCommands } from "../features/hierarchy/project-structure-commands";
import {
  hasResettableLabels,
  resetLabelLookEdits,
} from "../features/instance-display/reset-label-look";
import type { useNetlistExportPreferences } from "../features/netlist-export/netlist-export-preferences";
import { EDGE_ALIGNMENT_MODES } from "../features/selection/align-selection";
import { CanvasContextMenu } from "../features/selection/canvas-context-menu";
import type { useSelectionController } from "../features/selection/selection-controller";
import type { summarizeVisualDiagnostics } from "../features/selection/selection-inspector-details";
import { hasVisualSelection } from "../features/selection/visual-selection";
import type { useInteractionState } from "../interaction/interaction-state";
import type { EditorServices } from "../services/editor-services";
import { EditorAppChrome } from "./editor-app-chrome";
import type { EditorProjectPanelMode } from "./editor-project-dock";
import type { createEditorTransactionCommands } from "./editor-transaction-commands";
import type { useProjectCheck } from "./use-project-check";
import type { useEditorAgentConnection } from "./use-agent-hosts";
import type { useEditorDerivedModel } from "./use-editor-derived-model";
import type { useGalleryPublishing } from "./use-gallery-publishing";
import {
  loadNativeProjectWorkspace,
  type useNativeProjectTabs,
} from "./use-native-project-tabs";
import type { useProjectTabSessions } from "./use-project-tab-sessions";
import type { useSimulationSurface } from "./use-simulation-surface";

type ProjectFileLifecycle = ReturnType<typeof useProjectFileLifecycle>;
type EditorPanels = ReturnType<typeof useEditorPanels>;
type SelectionController = ReturnType<typeof useSelectionController>;
type InteractionState = ReturnType<
  typeof useInteractionState<SchematicClipboard>
>;
type TransactionCommands = ReturnType<typeof createEditorTransactionCommands>;
type ProjectStructureCommands = ReturnType<
  typeof createProjectStructureCommands
>;
type EditorDerivedModel = ReturnType<typeof useEditorDerivedModel>;
type NavigationController = ReturnType<typeof createEditorNavigationController>;
type FileCommands = ReturnType<typeof createEditorFileCommands>;
type GalleryPublishing = ReturnType<typeof useGalleryPublishing>;
type SimulationSurface = ReturnType<typeof useSimulationSurface>;
type AgentConnection = ReturnType<typeof useEditorAgentConnection>;
type ProjectTabSessions = ReturnType<typeof useProjectTabSessions>;
type NativeProjectTabs = ReturnType<typeof useNativeProjectTabs>;

/** The header: project tabs, menus and toolbars, bound to the editor. */
export function EditorMenuBar({
  identity,
  projectStore,
  nativeProjectStore,
  NativeFileCommands,
  capabilities,
  publicAgentUiEnabled,
  publicSimulationUiEnabled,
  setStatus,
  userComponentsOpen,
  setUserComponentsOpen,
  leftPanelMode,
  setSelectionOpen,
  searchOpen,
  toggleLibraryPanel,
  visibleLibraryPanelOpen,
  recoverySessions,
  project,
  document,
  documentStack,
  visualSelection,
  selectionFilterOpen,
  cellManagerOpen,
  setCellManagerOpen,
  netlistPreflightOpen,
  setNetlistPreflightOpen,
  projectPanel,
  setProjectPanel,
  netlistPreferences,
  documentSettingsOpen,
  setDocumentSettingsOpen,
  setProjectInfoOpen,
  projectNameEditing,
  publishGalleryOpen,
  setPublishGalleryOpen,
  setOpenedFromCheckNotice,
  cloudProjects,
  reloadCloudProjects,
  analogSimulationState,
  openAnalogSimulation,
  nativeBinding,
  savedProjectBaseline,
  isDirtyWork,
  hasUnsavedChanges,
  saveProjectToCloud,
  saveProjectToNative,
  isSaveInFlight,
  saveBusy,
  exportProjectFile,
  createNewProject,
  revertToSavedProjectBaseline,
  openRecoveryDialog,
  openProjectFile,
  openCloudProjectById,
  agentSession,
  openAgentConnection,
  tool,
  transact,
  renameProject,
  selectedEndpoint,
  projectInputRef,
  tabProjectInputRef,
  hasHierarchyEnterSelection,
  flightlines,
  displayedFlightlines,
  crossings,
  projectCheck,
  visualDiagnosticSummary,
  cellInsertCandidates,
  alignmentParticipantCount,
  internalSelection,
  projectInstanceCount,
  selectDocumentFromHierarchy,
  enterSelectedHierarchy,
  returnToTopDocument,
  toggleProjectPanel,
  toggleExamplesPanel,
  cancelAllTransientInteraction,
  placeCellInstance,
  editorCommands,
  importSpiceFiles,
  exportSvg,
  exportRaster,
  exportDesignNetlist,
  nativeWorkspaceSaving,
  createTabSession,
  projectTabs,
  recentNativeFiles,
  nativeBusy,
  setNativeBusy,
  nativeOperation,
  refreshNativeFiles,
  openNativeProject,
  closeNativeTab,
  closeNativeTabs,
  saveNativeTab,
  leaveForGallery,
}: {
  identity: EditorServices["identity"];
  projectStore: EditorServices["projectStore"];
  nativeProjectStore: EditorServices["nativeProjectStore"];
  NativeFileCommands: EditorServices["NativeFileCommands"];
  capabilities: EditorServices["capabilities"];
  publicAgentUiEnabled: boolean;
  publicSimulationUiEnabled: boolean;
  setStatus: Dispatch<SetStateAction<string>>;
  userComponentsOpen: boolean;
  setUserComponentsOpen: Dispatch<SetStateAction<boolean>>;
  leftPanelMode: EditorPanels["leftPanelMode"];
  setSelectionOpen: EditorPanels["setSelectionOpen"];
  searchOpen: EditorPanels["searchOpen"];
  toggleLibraryPanel: EditorPanels["toggleLibraryPanel"];
  visibleLibraryPanelOpen: boolean;
  recoverySessions: UseRecoveryCoordinatorResult["sessions"];
  project: CircuitProject;
  document: SchematicDocument;
  documentStack: HierarchyFrame[];
  visualSelection: SelectionController["selection"];
  selectionFilterOpen: boolean;
  cellManagerOpen: boolean;
  setCellManagerOpen: Dispatch<SetStateAction<boolean>>;
  netlistPreflightOpen: boolean;
  setNetlistPreflightOpen: Dispatch<SetStateAction<boolean>>;
  projectPanel: EditorProjectPanelMode | null;
  setProjectPanel: Dispatch<SetStateAction<EditorProjectPanelMode | null>>;
  netlistPreferences: ReturnType<typeof useNetlistExportPreferences>;
  documentSettingsOpen: boolean;
  setDocumentSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setProjectInfoOpen: Dispatch<SetStateAction<boolean>>;
  projectNameEditing: RefObject<boolean>;
  publishGalleryOpen: GalleryPublishing["publishGalleryOpen"];
  setPublishGalleryOpen: GalleryPublishing["setPublishGalleryOpen"];
  setOpenedFromCheckNotice: GalleryPublishing["setOpenedFromCheckNotice"];
  cloudProjects: GalleryPublishing["cloudProjects"];
  reloadCloudProjects: GalleryPublishing["reloadCloudProjects"];
  analogSimulationState: SimulationSurface["analogSimulationState"];
  openAnalogSimulation: SimulationSurface["openAnalogSimulation"];
  nativeBinding: ProjectFileLifecycle["nativeBinding"];
  savedProjectBaseline: ProjectFileLifecycle["savedProjectBaseline"];
  isDirtyWork: ProjectFileLifecycle["isDirtyWork"];
  hasUnsavedChanges: ProjectFileLifecycle["hasUnsavedChanges"];
  saveProjectToCloud: ProjectFileLifecycle["saveProjectToCloud"];
  saveProjectToNative: ProjectFileLifecycle["saveProjectToNative"];
  isSaveInFlight: ProjectFileLifecycle["isSaveInFlight"];
  saveBusy: ProjectFileLifecycle["saveBusy"];
  exportProjectFile: ProjectFileLifecycle["exportProjectFile"];
  createNewProject: ProjectFileLifecycle["createNewProject"];
  revertToSavedProjectBaseline: ProjectFileLifecycle["revertToSavedProjectBaseline"];
  openRecoveryDialog: ProjectFileLifecycle["openRecoveryDialog"];
  openProjectFile: ProjectFileLifecycle["openProjectFile"];
  openCloudProjectById: ProjectFileLifecycle["openCloudProjectById"];
  agentSession: AgentConnection["agentSession"];
  openAgentConnection: AgentConnection["openAgentConnection"];
  tool: InteractionState["tool"];
  transact: TransactionCommands["transact"];
  renameProject: ProjectStructureCommands["renameProject"];
  selectedEndpoint: WireSource | null;
  projectInputRef: RefObject<HTMLInputElement | null>;
  tabProjectInputRef: RefObject<HTMLInputElement | null>;
  hasHierarchyEnterSelection: boolean;
  flightlines: EditorDerivedModel["flightlines"];
  displayedFlightlines: EditorDerivedModel["displayedFlightlines"];
  crossings: EditorDerivedModel["crossings"];
  projectCheck: ReturnType<typeof useProjectCheck>;
  visualDiagnosticSummary: ReturnType<typeof summarizeVisualDiagnostics>;
  cellInsertCandidates: readonly CellInsertCandidate[];
  alignmentParticipantCount: number;
  internalSelection: ReturnType<typeof deriveRoutingAffectedClosure>;
  projectInstanceCount: number;
  selectDocumentFromHierarchy: NavigationController["selectDocumentFromHierarchy"];
  enterSelectedHierarchy: NavigationController["enterSelectedHierarchy"];
  returnToTopDocument: NavigationController["returnToTopDocument"];
  toggleProjectPanel: (mode: EditorProjectPanelMode) => void;
  toggleExamplesPanel: () => void;
  cancelAllTransientInteraction: () => void;
  placeCellInstance: () => void;
  editorCommands: ReturnType<typeof createEditorCommandRouter>;
  importSpiceFiles: FileCommands["importSpiceFiles"];
  exportSvg: FileCommands["exportSvg"];
  exportRaster: FileCommands["exportRaster"];
  exportDesignNetlist: FileCommands["exportDesignNetlist"];
  nativeWorkspaceSaving: RefObject<boolean>;
  createTabSession: ProjectTabSessions["createTabSession"];
  projectTabs: ProjectTabSessions["projectTabs"];
  recentNativeFiles: NativeProjectTabs["recentNativeFiles"];
  nativeBusy: NativeProjectTabs["nativeBusy"];
  setNativeBusy: NativeProjectTabs["setNativeBusy"];
  nativeOperation: NativeProjectTabs["nativeOperation"];
  refreshNativeFiles: NativeProjectTabs["refreshNativeFiles"];
  openNativeProject: NativeProjectTabs["openNativeProject"];
  closeNativeTab: NativeProjectTabs["closeNativeTab"];
  closeNativeTabs: NativeProjectTabs["closeNativeTabs"];
  saveNativeTab: NativeProjectTabs["saveNativeTab"];
  leaveForGallery: () => void;
}) {
  return (
    <EditorAppChrome
      communityEnabled={capabilities.community}
      externalLinksEnabled={capabilities.externalLinks}
      identityEnabled={identity !== null}
      projectTabs={
        <>
          <ProjectTabs
            cloudEnabled={projectStore !== null}
            tabs={projectTabs.tabs}
            activeId={projectTabs.activeId}
            busy={
              projectTabs.busy ||
              (nativeProjectStore !== undefined && (nativeBusy || saveBusy))
            }
            onSelect={projectTabs.select}
            onRename={(id, name) => {
              if (id === projectTabs.activeId) renameProject(name);
            }}
            onEditingChange={(editing) => {
              projectNameEditing.current = editing;
            }}
            onClose={(id) => {
              if (nativeProjectStore) void closeNativeTab(id);
              else void projectTabs.close(id, () => createTabSession());
            }}
            onCloseMany={(ids) => {
              if (nativeProjectStore) void closeNativeTabs(ids);
              else void projectTabs.closeMany(ids, () => createTabSession());
            }}
            {...(nativeProjectStore
              ? {
                  onSaveClose: async (id: string) => {
                    const { saveAndCloseNativeTab } =
                      await loadNativeProjectWorkspace();
                    return saveAndCloseNativeTab(id, {
                      busy: () =>
                        nativeOperation.current ||
                        nativeWorkspaceSaving.current ||
                        isSaveInFlight(),
                      setBusy: (busy) => {
                        nativeWorkspaceSaving.current = busy;
                        setNativeBusy(busy);
                      },
                      save: saveNativeTab,
                      entries: projectTabs.entries,
                      close: closeNativeTab,
                      report: setStatus,
                    });
                  },
                }
              : {})}
            onNew={() => {
              void projectTabs.open(() => createTabSession());
            }}
            onOpenFile={() =>
              nativeProjectStore
                ? void openNativeProject()
                : tabProjectInputRef.current?.click()
            }
            cloudProjects={cloudProjects}
            onRefreshShelf={() => {
              void reloadCloudProjects();
            }}
            onOpenShelf={(id) => {
              void openCloudProjectById(id, true);
            }}
          />
          <input
            ref={tabProjectInputRef}
            hidden
            type="file"
            accept=".json,.icproj.json"
            data-testid="tab-project-file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void openProjectFile(file, { inTab: true });
            }}
          />
        </>
      }
      {...(publicSimulationUiEnabled
        ? { simulationAction: openAnalogSimulation }
        : {})}
      simulationState={analogSimulationState}
      projectName={project.name}
      projectSchemaVersion={project.schemaVersion}
      hasUnsavedWork={hasUnsavedChanges()}
      onOpenGallery={leaveForGallery}
      fileCommands={{
        ...(NativeFileCommands ? { NativeFileCommands } : {}),
        ...(nativeProjectStore
          ? {
              nativeFiles: {
                projectName: project.name,
                path: nativeBinding?.path ?? null,
                recent: recentNativeFiles,
                busy: nativeBusy || saveBusy,
                refresh: () => void refreshNativeFiles(),
                open: (id?: string) => void openNativeProject(id),
                saveAs: () => void saveProjectToNative(undefined, true),
                forget: (id: string) => {
                  void nativeProjectStore
                    .forget(id)
                    .then(refreshNativeFiles)
                    .catch((error: unknown) => setStatus(String(error)));
                },
              },
            }
          : {}),
        cloudEnabled: projectStore !== null,
        canRevert: savedProjectBaseline !== null && isDirtyWork(),
        hasRecoverySessions: recoverySessions.some(
          (session) =>
            session.latest?.unsavedAtSnapshot === true ||
            (session.latest !== null && session.latest.review !== "valid"),
        ),
        checkAndSave: {
          enabled: !saveBusy && !projectCheck.busy,
          execute: () => void projectCheck.checkAndSave(),
        },
        projectInputRef,
        onNewProject: createNewProject,
        onSave: () =>
          void (nativeProjectStore
            ? saveProjectToNative()
            : projectStore
              ? saveProjectToCloud()
              : exportProjectFile()),
        onImportProject: (file) => void openProjectFile(file),
        onImportSpice: (files, namingProfile) =>
          void importSpiceFiles(files, namingProfile),
        onExportProject: () => void exportProjectFile(),
        onExportSvg: () => void exportSvg(),
        onExportRaster: (format) => void exportRaster(format),
        onRevert: revertToSavedProjectBaseline,
        onOpenRecovery: openRecoveryDialog,
        onOpenInfo: () => setProjectInfoOpen(true),
      }}
      searchOpen={searchOpen}
      selectionFilterOpen={selectionFilterOpen}
      cellManagerOpen={cellManagerOpen}
      onManageCells={() => setCellManagerOpen(true)}
      userComponentsOpen={userComponentsOpen}
      onOpenUserComponents={() => {
        cancelAllTransientInteraction();
        setUserComponentsOpen(true);
      }}
      onInsertComponent={() =>
        editorCommands.execute({
          id: "insert.start",
          launch: fullInsertLaunch(),
        })
      }
      placeProjectCell={{
        enabled: cellInsertCandidates.length > 0,
        execute: placeCellInstance,
      }}
      onOpenSelectionFilter={() =>
        editorCommands.execute({ id: "selection.filter.open" })
      }
      onOpenSearch={() => editorCommands.execute({ id: "search.open" })}
      deleteSelection={{
        enabled:
          hasVisualSelection(visualSelection) || selectedEndpoint !== null,
        execute: () => editorCommands.execute({ id: "selection.delete" }),
      }}
      copySelectionImages={(["png", "svg"] as const).map((format) => ({
        label: `Copy selection as ${format.toUpperCase()}`,
        enabled: editorCommands.state({
          id: "selection.copy-image",
          format,
        }).enabled,
        execute: () =>
          editorCommands.execute({
            id: "selection.copy-image",
            format,
          }),
      }))}
      rotate={{
        enabled: editorCommands.state({ id: "transform.rotate" }).enabled,
        execute: () => editorCommands.execute({ id: "transform.rotate" }),
      }}
      mirrorLeftRight={{
        enabled: editorCommands.state({
          id: "transform.mirror",
          direction: "left-right",
        }).enabled,
        execute: () =>
          editorCommands.execute({
            id: "transform.mirror",
            direction: "left-right",
          }),
      }}
      mirrorTopBottom={{
        enabled: editorCommands.state({
          id: "transform.mirror",
          direction: "top-bottom",
        }).enabled,
        execute: () =>
          editorCommands.execute({
            id: "transform.mirror",
            direction: "top-bottom",
          }),
      }}
      alignmentActions={
        alignmentParticipantCount >= 2
          ? EDGE_ALIGNMENT_MODES.map(({ mode, label }) => {
              const state = editorCommands.state({
                id: "selection.align",
                mode,
              });
              return {
                mode,
                label,
                enabled: state.enabled,
                execute: () =>
                  editorCommands.execute({ id: "selection.align", mode }),
              };
            })
          : []
      }
      instanceCodeOpen={projectPanel === "instances"}
      netlistPreflightOpen={netlistPreflightOpen}
      onOpenInstanceCode={() => {
        toggleProjectPanel("instances");
      }}
      netlistFormat={netlistPreferences.format}
      onOpenNetlistConfiguration={() => {
        toggleProjectPanel("netlist-configuration");
      }}
      onOpenNetlistPreflight={() => setNetlistPreflightOpen(true)}
      onExportNetlist={(format) => void exportDesignNetlist(format)}
      agentAction={
        publicAgentUiEnabled
          ? {
              label:
                agentSession.status === "idle"
                  ? "Connect Agent"
                  : "Manage Agent",
              execute: openAgentConnection,
            }
          : null
      }
      publishGalleryOpen={publishGalleryOpen}
      onPublishGallery={() => {
        setOpenedFromCheckNotice(false);
        setPublishGalleryOpen(true);
      }}
      drawingToolbar={{
        communityEnabled: capabilities.community,
        leftPanelMode,
        libraryPanelOpen: visibleLibraryPanelOpen,
        projectPanel:
          projectPanel === "project-code"
            ? "project-code"
            : projectPanel
              ? "netlist"
              : null,
        leftPanelsDisabled: false,
        styleProfileId: document.presentation.styleProfileId,
        onStartInsert: (launch) =>
          editorCommands.execute({ id: "insert.start", launch }),
        tool,
        documentSettingsOpen,
        undo: {
          enabled: editorCommands.state({ id: "history.undo" }).enabled,
          execute: () => editorCommands.execute({ id: "history.undo" }),
        },
        redo: {
          enabled: editorCommands.state({ id: "history.redo" }).enabled,
          execute: () => editorCommands.execute({ id: "history.redo" }),
        },
        onToggleExamples: toggleExamplesPanel,
        onToggleLibrary: toggleLibraryPanel,
        onToggleNetlist: () => toggleProjectPanel("netlist"),
        onToggleProjectCode: () => toggleProjectPanel("project-code"),
        onActivateTool: (nextTool) =>
          editorCommands.execute({
            id: "tool.activate",
            tool: nextTool,
          }),
        onAddText: () => editorCommands.execute({ id: "drafting.add-text" }),
        onOpenDocumentSettings: () => {
          setDocumentSettingsOpen((open) => !open);
          setProjectPanel(null);
          setSelectionOpen(true);
        },
        resetLabels: {
          enabled: hasResettableLabels(document),
          execute: () => {
            const edits = resetLabelLookEdits(document, project);
            if (edits.length === 0) {
              setStatus("Every label already has the default look");
              return;
            }
            if (transact(edits).ok)
              setStatus(
                `Reset ${edits.length} label${edits.length === 1 ? "" : "s"} to the default size and look`,
              );
          },
        },
      }}
      hierarchyToolbar={{
        documents: project.documents,
        activeDocumentId: document.id,
        topDocumentId: project.topDocumentId,
        navigationDepth: documentStack.length,
        canEnter: hasHierarchyEnterSelection,
        onTop: returnToTopDocument,
        onSelectDocument: selectDocumentFromHierarchy,
        onEnter: enterSelectedHierarchy,
        onManageCells: () => setCellManagerOpen(true),
        onPlaceCell: placeCellInstance,
      }}
      telemetry={{
        snapshot: {
          selectedInternalRouteCount: internalSelection.internalRoutes.length,
          revision: document.revision,
          sourceStatus: document.sourceStatus,
          documentCount: project.documents.length,
          projectName: project.name,
          activeDocumentId: document.id,
          activeDocumentName: document.name,
          activeInstanceCount: document.instances.length,
          instanceCount: projectInstanceCount,
          netCount: document.nets.length,
          activeTool: tool,
          flightlineCount: flightlines.length,
          displayedFlightlineCount: displayedFlightlines.length,
          crossingCount: crossings.length,
          annotationCount: document.annotations.length,
          structuralDiagnosticCount: visualDiagnosticSummary.structural.length,
          diagnosticCheckStatus: projectCheck.status,
          visualDiagnosticCount: visualDiagnosticSummary.observations.length,
          blockingDiagnosticCount: visualDiagnosticSummary.blockingCount,
        },
      }}
    />
  );
}

/** The canvas context menu for the selection under the pointer. */
export function EditorCanvasContextMenu({
  canvasContextMenu,
  setCanvasContextMenu,
  visualSelection,
  hasHierarchyEnterSelection,
  alignmentParticipantCount,
  enterSelectedHierarchy,
  openSelectedComponentDefinition,
  hasDefinitionSelection,
  editorCommands,
}: {
  canvasContextMenu: { x: number; y: number };
  setCanvasContextMenu: Dispatch<
    SetStateAction<{ x: number; y: number } | null>
  >;
  visualSelection: SelectionController["selection"];
  hasHierarchyEnterSelection: boolean;
  alignmentParticipantCount: number;
  enterSelectedHierarchy: NavigationController["enterSelectedHierarchy"];
  openSelectedComponentDefinition: () => void;
  hasDefinitionSelection: boolean;
  editorCommands: ReturnType<typeof createEditorCommandRouter>;
}) {
  return (
    <CanvasContextMenu
      position={canvasContextMenu}
      alignmentEnabled={alignmentParticipantCount >= 2}
      onAlign={(mode) =>
        editorCommands.execute({ id: "selection.align", mode })
      }
      actions={[
        {
          label: "Edit Component Definition (E)",
          enabled: hasDefinitionSelection,
          execute: openSelectedComponentDefinition,
        },
        ...(hasHierarchyEnterSelection
          ? [
              {
                label: "Enter Cell (E)",
                enabled: true,
                execute: enterSelectedHierarchy,
              },
            ]
          : []),
        {
          label: "Properties (Q)",
          enabled: editorCommands.state({ id: "properties.open" }).enabled,
          execute: () => editorCommands.execute({ id: "properties.open" }),
        },
        {
          label: "Copy (C)",
          enabled:
            hasVisualSelection(visualSelection) &&
            editorCommands.state({ id: "selection.copy" }).enabled,
          execute: () => editorCommands.execute({ id: "selection.copy" }),
        },
        {
          label: "Rotate 90° (R)",
          enabled: editorCommands.state({ id: "transform.rotate" }).enabled,
          execute: () => editorCommands.execute({ id: "transform.rotate" }),
        },
        {
          label: "Mirror left/right (Shift+R)",
          enabled: editorCommands.state({
            id: "transform.mirror",
            direction: "left-right",
          }).enabled,
          execute: () =>
            editorCommands.execute({
              id: "transform.mirror",
              direction: "left-right",
            }),
        },
        {
          label: "Mirror top/bottom (Ctrl+R)",
          enabled: editorCommands.state({
            id: "transform.mirror",
            direction: "top-bottom",
          }).enabled,
          execute: () =>
            editorCommands.execute({
              id: "transform.mirror",
              direction: "top-bottom",
            }),
        },
        {
          label: "Delete",
          enabled: hasVisualSelection(visualSelection),
          execute: () => editorCommands.execute({ id: "selection.delete" }),
        },
      ]}
      onClose={() => setCanvasContextMenu(null)}
    />
  );
}
