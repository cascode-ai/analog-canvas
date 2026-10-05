import type { NetlistDeviceClass, StableId } from "@icm/model";
import type { ReviewedExternalBindingId } from "@icm/devices";
import type { ObjectLocator } from "@icm/derived";

export type DesignNetlistDeviceClass = NetlistDeviceClass | "hierarchical";

export interface DesignNetlistNode {
  pinName: string;
  /** Authored terminal identity when an external binding renames the port. */
  canvasPinName?: string;
  netName: string;
}

export interface DesignNetlistParameter {
  name: string;
  rawValue: string;
}

/** Definition-owned defaults; absence means the caller must supply a value. */
export interface DesignNetlistFormalParameter {
  name: string;
  defaultValue?: string;
}

export interface DesignNetlistInstance {
  id: StableId;
  reference: string;
  /** The binding determines invocation kind, independently of the canvas name. */
  invocationKind: "primitive" | "subcircuit";
  reviewedExternalBindingId?: ReviewedExternalBindingId;
  deviceClass: DesignNetlistDeviceClass;
  target: string | null;
  nodes: DesignNetlistNode[];
  parameters: DesignNetlistParameter[];
  /** F/H resolve their controlling voltage-source reference after dialect projection. */
  controlSourceInstanceId?: StableId;
  controlSourceReference?: string;
  controlCurrentSign?: 1 | -1;
  controlTerminal?: {
    instanceId: StableId;
    pinName: string;
    direction: "into" | "out";
  };
  /** Compiler-owned probe; never a canvas Instance. */
  terminalCurrentSense?: { instanceId: StableId; pinName: string };
}

/** A model card a Cell carries itself, printed inside its own body. */
export interface DesignNetlistModel {
  name: string;
  /** The SPICE model type, such as `SW`. */
  type: string;
  parameters: DesignNetlistParameter[];
}

export interface DesignNetlistCell {
  /** Compiler-owned model bodies are never editable Canvas Documents. */
  origin?: "generated-model";
  id: StableId;
  name: string;
  ports: Array<{ id: StableId; name: string; netName: string }>;
  nets: Array<{
    id: StableId;
    name: string;
    scope: "local" | "global";
  }>;
  instances: DesignNetlistInstance[];
  /** Ordered definition defaults retained without conflating absence and "". */
  formalParameters?: DesignNetlistFormalParameter[];
  /** Model cards only this Cell's own instances use, such as the ideal switch. */
  models?: DesignNetlistModel[];
}

/** Referenced external interfaces deliberately do not produce an empty body. */
export interface DesignNetlistExternalMaster {
  id: StableId;
  name: string;
  terminals: Array<{
    id: StableId;
    name: string;
    direction: "input" | "output" | "inout" | "passive";
  }>;
  formalParameters: DesignNetlistFormalParameter[];
}

/**
 * A subcircuit the netlist defines itself because a drawn device means it: a
 * T-coil or transformer written as its coupled windings. Each is printed once
 * per file, ahead of the Cells that call it.
 */
export interface DesignNetlistMagneticSubcircuit {
  kind: "magnetic";
  name: string;
  ports: string[];
  /** Every parameter with its library default; each call passes its own. */
  formalParameters: Array<{ name: string; defaultValue: string }>;
  /** Each winding runs from its dotted node, the one SPICE reads as the dot. */
  inductors: Array<{
    name: string;
    nodes: [string, string];
    parameter: string;
  }>;
  coupling: { name: string; inductors: [string, string]; parameter: string };
  capacitors: Array<{
    name: string;
    nodes: [string, string];
    parameter: string;
  }>;
}

export interface DesignNetlistIR {
  topCellId: StableId;
  cells: DesignNetlistCell[];
  externalMasters?: DesignNetlistExternalMaster[];
  /** One compiler-owned definition inventory, transported unchanged to every backend. */
  generatedDefinitions?: DesignNetlistGeneratedDefinition[];
  globals: string[];
}

export type DesignNetlistGeneratedDefinition =
  | DesignNetlistMagneticSubcircuit
  | {
      kind: "behavioral";
      name: string;
    };

export type NetlistDiagnosticSeverity = "error" | "warning";

export interface NetlistDiagnostic {
  code: string;
  severity: NetlistDiagnosticSeverity;
  documentId: StableId;
  objectIds: StableId[];
  /** Canonical evidence for the preflight and other consumers to navigate. */
  primary: ObjectLocator;
  parameter?: string;
  message: string;
}

export interface DesignNetlistAnalysisResult {
  ir: DesignNetlistIR | null;
  diagnostics: NetlistDiagnostic[];
}
