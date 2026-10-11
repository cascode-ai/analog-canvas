// The Simulation workspace in the editor's right dock: its folders, examples,
// source edits, and the Outputs picked on the canvas.
import { Suspense, type Dispatch, type SetStateAction } from "react";
import type { CircuitProject, Instance, SchematicDocument } from "@icm/model";
import type { SimulationSourceLocation } from "@icm/simulation-service/contract";
import type { useDocumentController } from "../document/document-controller";
import type { useProjectFileLifecycle } from "../document/use-project-file-lifecycle";
import type { createEditorNavigationController } from "../features/hierarchy/editor-navigation-controller";
import type { BrowserSimulationSession } from "../features/simulation/browser-simulation-session";
import type { ProjectRunHistory } from "../features/simulation/project-run-history";
import { simulationProbeHierarchyPath } from "../features/simulation/simulation-probe-options";
import { DEFAULT_VIEWBOX } from "./default-view-box";
import type { createEditorTransactionCommands } from "./editor-transaction-commands";
import { LazySpiceSimulationSurface } from "./lazy-editor-dialogs";
import type { useEditorAgentConnection } from "./use-agent-hosts";
import type {
  useActiveSimulationFolder,
  useSimulationPicking,
  useSimulationSurface,
} from "./use-simulation-surface";

type DocumentControllerState = ReturnType<typeof useDocumentController>;
type ProjectFileLifecycle = ReturnType<typeof useProjectFileLifecycle>;
type AgentConnection = ReturnType<typeof useEditorAgentConnection>;
type ActiveSimulationFolder = ReturnType<typeof useActiveSimulationFolder>;
type SimulationSurface = ReturnType<typeof useSimulationSurface>;
type SimulationPicking = ReturnType<typeof useSimulationPicking>;

/** The Simulation workspace bound to the active Project and canvas. */
export function EditorSimulationSurface({
  projectSessionId,
  humanSimulationSession,
  projectRunHistory,
  project,
  document,
  selectedInstance,
  activeSimulationFolder,
  activeSimulationFolderId,
  setActiveSimulationFolderId,
  publicAgentUiEnabled,
  agentSession,
  openAgentConnection,
  guardDirtyReplacement,
  replaceActiveProject,
  setAnalogSimulationState,
  setStatus,
  analogSimulationOpen,
  analogSimulationMaximized,
  toggleAnalogSimulationMaximized,
  minimizeAnalogSimulation,
  exitAnalogSimulation,
  transact,
  openProjectModelSource,
  simulationSourceBuffer,
  dispatchProjectTransaction,
  simulationPickNetsActive,
  analogPickedNet,
  setSimulationNetPickMode,
  simulationPickTerminalsActive,
  analogPickedTerminal,
  setSimulationTerminalPickMode,
  navigateToLocator,
  setCodeNetPreview,
}: {
  projectSessionId: string;
  humanSimulationSession: BrowserSimulationSession;
  projectRunHistory: ProjectRunHistory | null;
  project: CircuitProject;
  document: SchematicDocument;
  selectedInstance: Instance | undefined;
  activeSimulationFolder: ActiveSimulationFolder["activeSimulationFolder"];
  activeSimulationFolderId: ActiveSimulationFolder["activeSimulationFolderId"];
  setActiveSimulationFolderId: ActiveSimulationFolder["setActiveSimulationFolderId"];
  publicAgentUiEnabled: boolean;
  agentSession: AgentConnection["agentSession"];
  openAgentConnection: AgentConnection["openAgentConnection"];
  guardDirtyReplacement: ProjectFileLifecycle["guardDirtyReplacement"];
  replaceActiveProject: ProjectFileLifecycle["replaceActiveProject"];
  setAnalogSimulationState: SimulationSurface["setAnalogSimulationState"];
  setStatus: Dispatch<SetStateAction<string>>;
  analogSimulationOpen: boolean;
  analogSimulationMaximized: boolean;
  toggleAnalogSimulationMaximized: () => void;
  minimizeAnalogSimulation: () => void;
  exitAnalogSimulation: () => void;
  transact: ReturnType<typeof createEditorTransactionCommands>["transact"];
  openProjectModelSource: (
    sourceId: string,
    location?: SimulationSourceLocation,
  ) => void;
  simulationSourceBuffer: SimulationSurface["simulationSourceBuffer"];
  dispatchProjectTransaction: DocumentControllerState["dispatchProjectTransaction"];
  simulationPickNetsActive: boolean;
  analogPickedNet: SimulationPicking["analogPickedNet"];
  setSimulationNetPickMode: (active: boolean) => void;
  simulationPickTerminalsActive: boolean;
  analogPickedTerminal: SimulationPicking["analogPickedTerminal"];
  setSimulationTerminalPickMode: (active: boolean) => void;
  navigateToLocator: ReturnType<
    typeof createEditorNavigationController
  >["navigateToLocator"];
  setCodeNetPreview: SimulationPicking["setCodeNetPreview"];
}) {
  if (!projectRunHistory) return null;
  return (
    <Suspense fallback={null}>
      <LazySpiceSimulationSurface
        key={projectSessionId}
        session={humanSimulationSession}
        runHistory={projectRunHistory}
        project={project}
        activeDocumentId={document.id}
        selectedCircuitObject={
          selectedInstance
            ? {
                documentId: document.id,
                instanceId: selectedInstance.id,
              }
            : undefined
        }
        selectedFolderId={activeSimulationFolder?.id ?? null}
        onSelectFolderId={setActiveSimulationFolderId}
        agentGuidance={
          publicAgentUiEnabled && agentSession
            ? {
                status: agentSession.status,
                onOpen: openAgentConnection,
              }
            : undefined
        }
        onOpenExample={async (exampleProject) => {
          await guardDirtyReplacement(
            `Open ${exampleProject.name} example`,
            () => {
              replaceActiveProject(exampleProject, DEFAULT_VIEWBOX);
              setActiveSimulationFolderId(
                exampleProject.simulationFolders[0]?.id ?? null,
              );
              setAnalogSimulationState("open");
              setStatus(`Opened simulation example: ${exampleProject.name}`);
            },
          );
        }}
        open={analogSimulationOpen}
        maximized={analogSimulationMaximized}
        onToggleMaximized={toggleAnalogSimulationMaximized}
        onMinimize={minimizeAnalogSimulation}
        onExit={exitAnalogSimulation}
        onHistoryBoundary={(direction) => {
          transact([{ kind: direction }]);
        }}
        onOpenModelSource={openProjectModelSource}
        onSourceBuffer={(buffer) => {
          simulationSourceBuffer.current = buffer;
        }}
        onSaveFolder={(
          folder,
          expectedRevision = project.structureRevision,
        ) => {
          const result = dispatchProjectTransaction({
            transactionId: `upsert-simulation-${crypto.randomUUID()}`,
            projectId: project.id,
            expectedStructureRevision: expectedRevision,
            actor: { kind: "human", id: "human-local" },
            edits: [{ kind: "upsert_simulation_folder", folder }],
          });
          if (result.ok) {
            setActiveSimulationFolderId(folder.id);
            setStatus(
              result.applied
                ? `Updated simulation folder ${folder.name}`
                : `Simulation folder ${folder.name} is already up to date`,
            );
            return {
              status: result.applied ? "applied" : "unchanged",
            };
          }
          const firstDiagnostic = result.diagnostics[0];
          const message = firstDiagnostic?.message ?? result.error.message;
          setStatus(`${result.error.code}: ${message}`);
          return {
            status: "rejected",
            problem: {
              code: result.error.code,
              message,
              stage: "input",
              recovery: "fix-input",
              ...(result.diagnostics.length
                ? {
                    diagnostics: result.diagnostics.map((diagnostic) => ({
                      code: diagnostic.code,
                      message: diagnostic.message,
                      severity: diagnostic.severity,
                      ...(diagnostic.path?.length
                        ? { field: diagnostic.path.join(".") }
                        : {}),
                    })),
                  }
                : {}),
            },
          };
        }}
        onDeleteFolder={(
          folderId,
          expectedRevision = project.structureRevision,
        ) => {
          const result = dispatchProjectTransaction({
            transactionId: `remove-simulation-folder-${crypto.randomUUID()}`,
            projectId: project.id,
            expectedStructureRevision: expectedRevision,
            actor: { kind: "human", id: "human-local" },
            edits: [{ kind: "remove_simulation_folder", folderId }],
          });
          const committed = result.ok;
          if (!result.ok)
            setStatus(`${result.error.code}: ${result.error.message}`);
          if (committed && activeSimulationFolderId === folderId) {
            setActiveSimulationFolderId(null);
          }
          return committed;
        }}
        pickNetsActive={simulationPickNetsActive}
        pickedNet={analogPickedNet}
        onPickNetsChange={setSimulationNetPickMode}
        pickTerminalsActive={simulationPickTerminalsActive}
        pickedTerminal={analogPickedTerminal}
        onPickTerminalsChange={setSimulationTerminalPickMode}
        onFocusDiagnostic={(locator) =>
          navigateToLocator(locator, `Located ${locator.kind}`)
        }
        onPreviewSignal={(target) => {
          const hierarchyPath =
            target &&
            simulationProbeHierarchyPath(
              project,
              target.rootDocumentId,
              target.occurrence,
            );
          setCodeNetPreview(
            target && hierarchyPath
              ? {
                  documentId: target.documentId,
                  netId: target.netId,
                  hierarchyPath,
                }
              : null,
          );
        }}
      />
    </Suspense>
  );
}
