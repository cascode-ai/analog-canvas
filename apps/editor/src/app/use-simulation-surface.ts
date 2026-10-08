// The analog Simulation surface's state in the editor: the open folder, the
// workspace's open/minimized/maximized session, and the Outputs picked on the
// canvas with the signal previewed there.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  computeNetHighlight,
  type HierarchyFrame,
  type ProjectConnectivityIndex,
} from "@icm/derived";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { WireSource } from "@icm/edit-engine";
import type {
  EditorDocumentController,
  useDocumentController,
} from "../document/document-controller";
import type { ControlPickState } from "../features/properties/controlled-source-canvas-pick";
import { BrowserSimulationSession } from "../features/simulation/browser-simulation-session";
import type { resolveSimulationTransport } from "../features/simulation/deployment-transport";
import { createSimulationProjectFileHost } from "../features/simulation/project-file-host";
import type { ProjectRunHistory } from "../features/simulation/project-run-history";
import { deriveSimulationProbeOptions } from "../features/simulation/simulation-probe-options";
import {
  sameSimulationOccurrence,
  terminalCurrentDirectionPartners,
} from "../features/simulation/terminal-current-pick";
import type { EditorTool } from "../interaction/interaction-state";
import type { EditorProjectPanelMode } from "./editor-project-dock";
import type {
  HighlightedNetOrigin,
  useEditorDerivedModel,
} from "./use-editor-derived-model";

type DocumentControllerState = ReturnType<typeof useDocumentController>;
type ActiveSimulationFolder = ReturnType<typeof useActiveSimulationFolder>;
type SimulationSurface = ReturnType<typeof useSimulationSurface>;
type SimulationPicking = ReturnType<typeof useSimulationPicking>;

/** The Simulation folder the workspace shows, reset with each Project. */
export function useActiveSimulationFolder({
  project,
  projectSessionId,
}: {
  project: CircuitProject;
  projectSessionId: string;
}) {
  const [activeSimulationFolderId, setActiveSimulationFolderId] = useState<
    string | null
  >(null);
  const activeSimulationFolder =
    project.simulationFolders.find(
      (folder) => folder.id === activeSimulationFolderId,
    ) ?? project.simulationFolders[0];
  useEffect(() => {
    setActiveSimulationFolderId(null);
  }, [projectSessionId]);
  return {
    activeSimulationFolderId,
    setActiveSimulationFolderId,
    activeSimulationFolder,
  };
}

/** The Simulation workspace: open, minimized or maximized, and its session. */
export function useSimulationSurface({
  publicSimulationUiEnabled,
  dispatchProjectTransaction,
  editorDocumentController,
  projectSessionId,
  simulationTransport,
  setProjectPanel,
  projectRunHistory,
}: {
  publicSimulationUiEnabled: boolean;
  dispatchProjectTransaction: DocumentControllerState["dispatchProjectTransaction"];
  editorDocumentController: EditorDocumentController;
  projectSessionId: string;
  simulationTransport: ReturnType<typeof resolveSimulationTransport>;
  setProjectPanel: Dispatch<SetStateAction<EditorProjectPanelMode | null>>;
  projectRunHistory: ProjectRunHistory;
}) {
  const [simulationPickMode, setSimulationPickModeState] = useState<
    "net" | "terminal" | null
  >(null);
  const [analogSimulationState, setAnalogSimulationState] = useState<
    "closed" | "open" | "maximized" | "minimized"
  >("closed");
  const simulationSourceBuffer = useRef<{
    dirty: boolean;
    flush(): Promise<boolean>;
  } | null>(null);
  const analogSimulationOpened = analogSimulationState !== "closed";
  const analogSimulationOpen =
    analogSimulationState === "open" || analogSimulationState === "maximized";
  const analogSimulationMaximized = analogSimulationState === "maximized";
  const humanSimulationSession = useMemo(
    () =>
      analogSimulationOpened
        ? new BrowserSimulationSession({
            runHistory: projectRunHistory,
            owner: "human",
            getProjectSessionId: () =>
              editorDocumentController.projectSessionId,
            getProject: () => editorDocumentController.project,
            projectFiles: createSimulationProjectFileHost({
              getProject: () => editorDocumentController.project,
              getProjectSessionId: () =>
                editorDocumentController.projectSessionId,
              dispatch: (request) => dispatchProjectTransaction(request),
              actor: { kind: "human", id: "human-local" },
            }),
            transport: simulationTransport,
          })
        : null,
    [
      analogSimulationOpened,
      projectRunHistory,
      editorDocumentController,
      projectSessionId,
      simulationTransport,
    ],
  );
  useEffect(
    () => () => {
      void humanSimulationSession?.clear();
    },
    [humanSimulationSession],
  );
  const openAnalogSimulation = (): void => {
    if (!publicSimulationUiEnabled) return;
    setProjectPanel(null);
    setAnalogSimulationState("open");
  };
  const minimizeAnalogSimulation = (): void => {
    setSimulationPickModeState(null);
    setAnalogSimulationState("minimized");
  };
  const toggleAnalogSimulationMaximized = (): void => {
    setAnalogSimulationState((current) =>
      current === "maximized" ? "open" : "maximized",
    );
  };
  const exitAnalogSimulation = (): void => {
    setSimulationPickModeState(null);
    void humanSimulationSession?.clear();
    setAnalogSimulationState("closed");
  };
  return {
    simulationPickMode,
    setSimulationPickModeState,
    analogSimulationState,
    setAnalogSimulationState,
    simulationSourceBuffer,
    analogSimulationOpened,
    analogSimulationOpen,
    analogSimulationMaximized,
    humanSimulationSession,
    openAnalogSimulation,
    minimizeAnalogSimulation,
    toggleAnalogSimulationMaximized,
    exitAnalogSimulation,
  };
}

/** What is being picked on the canvas for Simulation, and what was picked. */
export function useSimulationPicking({
  document,
  projectSessionId,
  activeSimulationFolderId,
  analogSimulationOpen,
  simulationPickMode,
  setSimulationPickModeState,
  setControlPickState,
}: {
  document: SchematicDocument;
  projectSessionId: string;
  activeSimulationFolderId: ActiveSimulationFolder["activeSimulationFolderId"];
  analogSimulationOpen: boolean;
  simulationPickMode: SimulationSurface["simulationPickMode"];
  setSimulationPickModeState: SimulationSurface["setSimulationPickModeState"];
  setControlPickState: Dispatch<SetStateAction<ControlPickState | null>>;
}) {
  const [codeNetPreview, setCodeNetPreview] =
    useState<HighlightedNetOrigin | null>(null);
  const simulationPickNetsActive = simulationPickMode === "net";
  const simulationPickTerminalsActive = simulationPickMode === "terminal";
  const simulationPickActive = simulationPickMode !== null;
  const [simulationHoverNetId, setSimulationHoverNetId] = useState<
    string | null
  >(null);
  const [analogPickedNet, setAnalogPickedNet] = useState<{
    sequence: number;
    documentId: string;
    netId: string;
    occurrence?: readonly string[];
  } | null>(null);
  const [analogPickedTerminal, setAnalogPickedTerminal] = useState<{
    sequence: number;
    documentId: string;
    instanceId: string;
    pinName: string;
    directionPinName?: string;
    occurrence?: readonly string[];
  } | null>(null);
  const [simulationTerminalPickStart, setSimulationTerminalPickStart] =
    useState<{
      documentId: string;
      instanceId: string;
      pinName: string;
      partnerPinNames: readonly string[];
      occurrence?: readonly string[];
    } | null>(null);
  useEffect(() => {
    // Net-pick is a hierarchy traversal mode: keep it armed while the author
    // enters a DUT Cell, so an internal Net can be picked with its occurrence
    // path intact. Closing/minimising Simulation still cancels it explicitly.
    if (!analogSimulationOpen) setSimulationPickModeState(null);
    setSimulationTerminalPickStart(null);
    setSimulationHoverNetId(null);
    setControlPickState(null);
  }, [document.id]);
  useEffect(() => {
    setSimulationPickModeState(null);
    setAnalogPickedNet(null);
    setAnalogPickedTerminal(null);
    setSimulationTerminalPickStart(null);
    setControlPickState(null);
  }, [projectSessionId]);
  useEffect(() => {
    setSimulationTerminalPickStart(null);
  }, [activeSimulationFolderId]);
  return {
    codeNetPreview,
    setCodeNetPreview,
    simulationPickNetsActive,
    simulationPickTerminalsActive,
    simulationPickActive,
    simulationHoverNetId,
    setSimulationHoverNetId,
    analogPickedNet,
    setAnalogPickedNet,
    analogPickedTerminal,
    setAnalogPickedTerminal,
    simulationTerminalPickStart,
    setSimulationTerminalPickStart,
  };
}

/** Picking Simulation Outputs on the canvas, and the Nets those picks light. */
export function useSimulationPickCommands({
  setStatus,
  project,
  document,
  projectConnectivityIndex,
  documentStack,
  activeSimulationFolder,
  analogSimulationOpen,
  simulationPickMode,
  setSimulationPickModeState,
  setControlPickState,
  controlPickMode,
  codeNetPreview,
  simulationPickNetsActive,
  simulationPickTerminalsActive,
  simulationHoverNetId,
  setSimulationHoverNetId,
  setAnalogPickedNet,
  setAnalogPickedTerminal,
  simulationTerminalPickStart,
  setSimulationTerminalPickStart,
  logicalNets,
  activateTool,
}: {
  setStatus: Dispatch<SetStateAction<string>>;
  project: CircuitProject;
  document: SchematicDocument;
  projectConnectivityIndex: ProjectConnectivityIndex;
  documentStack: HierarchyFrame[];
  activeSimulationFolder: ActiveSimulationFolder["activeSimulationFolder"];
  analogSimulationOpen: boolean;
  simulationPickMode: SimulationSurface["simulationPickMode"];
  setSimulationPickModeState: SimulationSurface["setSimulationPickModeState"];
  setControlPickState: Dispatch<SetStateAction<ControlPickState | null>>;
  controlPickMode: "net" | "sensor" | null;
  codeNetPreview: SimulationPicking["codeNetPreview"];
  simulationPickNetsActive: boolean;
  simulationPickTerminalsActive: boolean;
  simulationHoverNetId: SimulationPicking["simulationHoverNetId"];
  setSimulationHoverNetId: SimulationPicking["setSimulationHoverNetId"];
  setAnalogPickedNet: SimulationPicking["setAnalogPickedNet"];
  setAnalogPickedTerminal: SimulationPicking["setAnalogPickedTerminal"];
  simulationTerminalPickStart: SimulationPicking["simulationTerminalPickStart"];
  setSimulationTerminalPickStart: SimulationPicking["setSimulationTerminalPickStart"];
  logicalNets: ReturnType<typeof useEditorDerivedModel>["logicalNets"];
  activateTool: (nextTool: EditorTool) => void;
}) {
  const simulationPickHighlight = useMemo(
    () =>
      (simulationPickNetsActive || controlPickMode === "net") &&
      simulationHoverNetId
        ? computeNetHighlight(
            projectConnectivityIndex,
            document.id,
            simulationHoverNetId,
            undefined,
            documentStack,
          )
        : undefined,
    [
      document.id,
      documentStack,
      projectConnectivityIndex,
      simulationHoverNetId,
      simulationPickMode,
      controlPickMode,
    ],
  );
  const codeNetHighlight = useMemo(
    () =>
      analogSimulationOpen &&
      codeNetPreview &&
      codeNetPreview.documentId === document.id &&
      JSON.stringify(codeNetPreview.hierarchyPath) ===
        JSON.stringify(documentStack)
        ? computeNetHighlight(
            projectConnectivityIndex,
            document.id,
            codeNetPreview.netId,
            undefined,
            documentStack,
          )
        : undefined,
    [
      analogSimulationOpen,
      codeNetPreview,
      document.id,
      documentStack,
      projectConnectivityIndex,
    ],
  );
  const canonicalSimulationNetId = (netId: string): string | null => {
    const group =
      logicalNets.byBaseNetId.get(netId) ??
      logicalNets.groups.find((candidate) => candidate.id === netId);
    return group?.baseNetIds[0] ?? null;
  };
  const simulationPickRootDocumentId =
    activeSimulationFolder?.input.circuitBindings.find(
      (binding) => binding.emission === "top-level",
    )?.documentId;
  const simulationPickOccurrence: readonly string[] | undefined =
    documentStack.length > 0
      ? documentStack.map((frame) => frame.instanceId)
      : simulationPickRootDocumentId === document.id
        ? []
        : undefined;
  const activeSimulationPickOccurrence = (): readonly string[] | undefined =>
    simulationPickOccurrence;
  const simulationCurrentProbeOptions = useMemo(
    () =>
      simulationPickTerminalsActive && simulationPickRootDocumentId
        ? deriveSimulationProbeOptions(project, simulationPickRootDocumentId)
            .terminalCurrent
        : [],
    [project, simulationPickRootDocumentId, simulationPickTerminalsActive],
  );
  const simulationCurrentTargetsInView = useMemo(
    () =>
      simulationCurrentProbeOptions.filter(
        ({ target }) =>
          target.documentId === document.id &&
          (simulationPickOccurrence === undefined ||
            sameSimulationOccurrence(
              target.occurrence,
              simulationPickOccurrence,
            )),
      ),
    [document.id, simulationCurrentProbeOptions, simulationPickOccurrence],
  );
  const simulationCurrentPinNamesByInstance = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const { target } of simulationCurrentTargetsInView) {
      const pins = result.get(target.instanceId) ?? [];
      if (!pins.includes(target.pinName)) pins.push(target.pinName);
      result.set(target.instanceId, pins);
    }
    return result;
  }, [simulationCurrentTargetsInView]);
  const simulationCurrentEndpointKeys = useMemo(
    () =>
      new Set(
        simulationCurrentTargetsInView.map(
          ({ target }) => `${target.instanceId}\u0000${target.pinName}`,
        ),
      ),
    [simulationCurrentTargetsInView],
  );
  const pickAnalogSimulationNet = (netId: string): void => {
    const baseNetId = canonicalSimulationNetId(netId);
    if (!baseNetId) {
      setStatus(`Could not resolve Net ${netId}`);
      return;
    }
    const group = logicalNets.byBaseNetId.get(baseNetId);
    const occurrence = activeSimulationPickOccurrence();
    setAnalogPickedNet((current) => ({
      sequence: (current?.sequence ?? 0) + 1,
      documentId: document.id,
      netId: baseNetId,
      ...(occurrence === undefined ? {} : { occurrence }),
    }));
    setStatus(`Added voltage Output ${group?.name ?? baseNetId}`);
  };
  const pickSimulationTerminal = (endpoint: WireSource): void => {
    if (endpoint.endpoint.kind !== "terminal" || !analogSimulationOpen) return;
    const terminal = endpoint.endpoint;
    const occurrence = activeSimulationPickOccurrence();
    const referenceFor = (instanceId: string): string =>
      document.instances.find((instance) => instance.id === instanceId)
        ?.reference ?? instanceId;
    const clickedKey = `${terminal.instanceId}\u0000${terminal.pinName}`;
    if (!simulationCurrentEndpointKeys.has(clickedKey)) {
      setStatus(
        `${referenceFor(terminal.instanceId)}.${terminal.pinName} is not a measurable current terminal in this Testbench occurrence`,
      );
      return;
    }
    const commitPick = (
      picked: {
        documentId: string;
        instanceId: string;
        pinName: string;
        occurrence?: readonly string[];
      },
      directionPinName?: string,
    ): void => {
      setAnalogPickedTerminal((current) => ({
        sequence: (current?.sequence ?? 0) + 1,
        ...picked,
        ...(directionPinName ? { directionPinName } : {}),
      }));
      setSimulationTerminalPickStart(null);
      const reference = referenceFor(picked.instanceId);
      setStatus(
        directionPinName
          ? `Added current ${reference}.${picked.pinName} → ${reference}.${directionPinName} · positive current enters ${picked.pinName}`
          : `Added terminal current ${reference}.${picked.pinName} · positive current enters the terminal`,
      );
    };
    if (
      simulationTerminalPickStart &&
      simulationTerminalPickStart.documentId === document.id &&
      simulationTerminalPickStart.instanceId === terminal.instanceId &&
      sameSimulationOccurrence(
        simulationTerminalPickStart.occurrence,
        occurrence,
      )
    ) {
      if (simulationTerminalPickStart.pinName === terminal.pinName) {
        setSimulationTerminalPickStart(null);
        setStatus("Current direction cancelled · choose the first terminal");
        return;
      }
      if (
        simulationTerminalPickStart.partnerPinNames.includes(terminal.pinName)
      ) {
        commitPick(simulationTerminalPickStart, terminal.pinName);
        return;
      }
    }

    const instance = document.instances.find(
      (candidate) => candidate.id === terminal.instanceId,
    );
    const measurablePins =
      simulationCurrentPinNamesByInstance.get(terminal.instanceId) ?? [];
    const partnerPinNames = instance
      ? terminalCurrentDirectionPartners(
          instance,
          terminal.pinName,
          measurablePins,
        )
      : [];
    const picked = {
      documentId: document.id,
      instanceId: terminal.instanceId,
      pinName: terminal.pinName,
      ...(occurrence === undefined ? {} : { occurrence }),
    };
    if (partnerPinNames.length === 0) {
      commitPick(picked);
      return;
    }
    setSimulationTerminalPickStart({ ...picked, partnerPinNames });
    setStatus(
      `Current starts at ${referenceFor(terminal.instanceId)}.${terminal.pinName} · choose ${partnerPinNames.join(" or ")} to confirm direction`,
    );
  };
  const setSimulationPickMode = (mode: "net" | "terminal" | null): void => {
    if (mode) activateTool("pointer");
    if (mode) setControlPickState(null);
    setSimulationPickModeState(mode);
    if (mode !== "terminal") setSimulationTerminalPickStart(null);
    if (mode !== "net") setSimulationHoverNetId(null);
    setStatus(
      mode === "net"
        ? "Pick Nets: click a wire, label, junction, or connected pin · Esc exits"
        : mode === "terminal"
          ? "Pick current: choose a device terminal, then its direction · Esc exits"
          : "Finished picking simulation Outputs",
    );
  };
  const setSimulationNetPickMode = (active: boolean): void =>
    setSimulationPickMode(active ? "net" : null);
  const setSimulationTerminalPickMode = (active: boolean): void =>
    setSimulationPickMode(active ? "terminal" : null);
  return {
    simulationPickHighlight,
    codeNetHighlight,
    simulationCurrentEndpointKeys,
    pickAnalogSimulationNet,
    pickSimulationTerminal,
    setSimulationPickMode,
    setSimulationNetPickMode,
    setSimulationTerminalPickMode,
  };
}
