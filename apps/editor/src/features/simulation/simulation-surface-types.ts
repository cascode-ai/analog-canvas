import type {
  CircuitProject,
  ObjectLocator,
  ProjectSimulationFolder,
  SimulationExpression,
  SimulationSourceExpression,
} from "@icm/model";
import type { Problem } from "@icm/simulation-service/contract";
import type { SimulationSignalTarget } from "@icm/netlist";
import type { BrowserSimulationSession } from "./browser-simulation-session";
import type { OperatingPointCanvasProjection } from "./operating-point-projection";
export interface SpiceSimulationSurfaceProps {
  open: boolean;
  maximized: boolean;
  project: CircuitProject;
  activeDocumentId: string;
  selectedCircuitObject?:
    { documentId: string; instanceId: string } | undefined;
  draftContext?: {
    readonly folderId: string;
    readonly folderName: string;
    readonly dutDocumentId: string;
    readonly rootDocumentId: string;
  };
  selectedFolderId: string | null;
  onSelectFolderId(folderId: string): void;
  session: BrowserSimulationSession;
  onToggleMaximized(): void;
  onMinimize(): void;
  onExit(): void;
  onSaveFolder(
    folder: ProjectSimulationFolder,
    expectedRevision?: number,
  ): SimulationFolderSaveResult;
  onDeleteFolder(folderId: string, expectedRevision?: number): boolean;
  onHistoryBoundary(direction: "undo" | "redo"): void;
  onSourceBuffer?(
    buffer: { flush(): Promise<boolean>; dirty: boolean } | null,
  ): void;
  pickNetsActive?: boolean;
  pickedNet?: {
    readonly sequence: number;
    readonly documentId: string;
    readonly netId: string;
    /** Instance ids from the selected Testbench root to this Cell. */
    readonly occurrence?: readonly string[];
  } | null;
  onPickNetsChange?(active: boolean): void;
  pickTerminalsActive?: boolean;
  pickedTerminal?: {
    readonly sequence: number;
    readonly documentId: string;
    readonly instanceId: string;
    readonly pinName: string;
    /** Optional second click used only to present the authored direction. */
    readonly directionPinName?: string;
    /** Instance ids from the selected Testbench root to this Cell. */
    readonly occurrence?: readonly string[];
  } | null;
  onPickTerminalsChange?(active: boolean): void;
  onFocusProbe?(
    probe: Extract<
      SimulationExpression | SimulationSourceExpression,
      { kind: "voltage" | "current" }
    >,
    rootDocumentId?: string,
  ): void;
  /** Transient code preview: never changes selection, camera, or active Cell. */
  onPreviewSignal?(target: SimulationSignalTarget | null): void;
  onFocusDiagnostic?(locator: ObjectLocator): void;
  /** Session-only OP values ready for exact object-addressed canvas display. */
  onOperatingPointProjection?(
    projection: OperatingPointCanvasProjection | null,
  ): void;
}

export type SimulationFolderSaveResult =
  | { readonly status: "applied" | "unchanged" }
  | { readonly status: "rejected"; readonly problem: Problem };
