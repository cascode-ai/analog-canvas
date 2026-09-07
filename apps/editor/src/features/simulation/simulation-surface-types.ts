import type {
  CircuitProject,
  ObjectLocator,
  ProjectSimulationSetup,
  SimulationExpression,
} from "@icm/model";
import type { Problem } from "@icm/simulation-service/contract";
import type { BrowserSimulationSession } from "./browser-simulation-session";
import type { OperatingPointCanvasProjection } from "./operating-point-projection";
export interface SpiceSimulationSurfaceProps {
  open: boolean;
  maximized: boolean;
  project: CircuitProject;
  activeDocumentId: string;
  draftContext?: {
    readonly setupId: string;
    readonly setupName: string;
    readonly dutDocumentId: string;
    readonly rootDocumentId: string;
  };
  selectedSetupId: string | null;
  onSelectSetupId(setupId: string): void;
  session: BrowserSimulationSession;
  onToggleMaximized(): void;
  onMinimize(): void;
  onExit(): void;
  onSaveSetup(setup: ProjectSimulationSetup): SimulationSetupSaveResult;
  onDeleteSetup(setupId: string): boolean;
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
    probe: Extract<SimulationExpression, { kind: "voltage" | "current" }>,
    rootDocumentId?: string,
  ): void;
  onFocusDiagnostic?(locator: ObjectLocator): void;
  /** Session-only OP values ready for exact object-addressed canvas display. */
  onOperatingPointProjection?(
    projection: OperatingPointCanvasProjection | null,
  ): void;
}

export type SimulationSetupSaveResult =
  | { readonly status: "applied" | "unchanged" }
  | { readonly status: "rejected"; readonly problem: Problem };
