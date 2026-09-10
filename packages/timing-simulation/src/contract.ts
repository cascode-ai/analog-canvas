import type { SchematicDocument } from "@icm/model";

export type LogicValue = "0" | "1" | "X" | "Z";

export interface DigitalSimulationProfile {
  /** Inclusive end of the run, expressed as an integer number of picoseconds. */
  readonly stopTimePs: number;
  /** Base-Net IDs selected by the user. Logical-Net equivalence is resolved at run time. */
  readonly savedNetIds: readonly string[];
  readonly maxDeltaCycles?: number;
  /** Explicit startup state for stateful Instances. Unspecified DFFs start at X. */
  readonly initialStateByInstanceId?: Readonly<Record<string, "0" | "1">>;
}

export interface DigitalTransition {
  readonly timePs: number;
  readonly value: LogicValue;
}

export interface DigitalTrace {
  readonly netId: string;
  readonly baseNetIds: readonly string[];
  readonly name: string;
  readonly transitions: readonly DigitalTransition[];
}

export type SimulationDiagnosticCode =
  | "SIM_INVALID_PROFILE"
  | "SIM_UNKNOWN_SAVED_NET"
  | "SIM_UNSUPPORTED_COMPONENT"
  | "SIM_MISSING_PIN"
  | "SIM_INVALID_PARAMETER"
  | "SIM_REFERENCE_NOT_GROUND"
  | "SIM_SHORTED_SOURCE"
  | "SIM_LOGICAL_NET_CONFLICT"
  | "SIM_DID_NOT_SETTLE";

export interface SimulationDiagnostic {
  readonly code: SimulationDiagnosticCode;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly objectIds: readonly string[];
}

export interface DigitalSimulationResult {
  readonly documentId: string;
  readonly documentRevision: number;
  readonly inputFingerprint: string;
  readonly stopTimePs: number;
  readonly traces: readonly DigitalTrace[];
  readonly diagnostics: readonly SimulationDiagnostic[];
  readonly completed: boolean;
}

export interface DigitalSimulationRequest {
  readonly document: SchematicDocument;
  readonly profile: DigitalSimulationProfile;
}
