import type { NetlistDeviceClass, StableId } from "@icm/model";
import type { ReviewedExternalBindingId } from "@icm/devices";
import type { ObjectLocator } from "@icm/derived";

export type DesignNetlistDeviceClass = NetlistDeviceClass | "hierarchical";

export interface DesignNetlistNode {
  pinName: string;
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
  /** Card family must agree with the persisted ngspice Reference designator. */
  invocationKind: "primitive" | "subcircuit";
  reviewedExternalBindingId?: ReviewedExternalBindingId;
  deviceClass: DesignNetlistDeviceClass;
  target: string | null;
  nodes: DesignNetlistNode[];
  parameters: DesignNetlistParameter[];
}

export interface DesignNetlistCell {
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

export interface DesignNetlistIR {
  topCellId: StableId;
  cells: DesignNetlistCell[];
  externalMasters?: DesignNetlistExternalMaster[];
  globals: string[];
}

export type NetlistDiagnosticSeverity = "error" | "warning";

export interface NetlistDiagnostic {
  code: string;
  severity: NetlistDiagnosticSeverity;
  documentId: StableId;
  objectIds: StableId[];
  /** Canonical evidence for the preflight and other consumers to navigate. */
  primary: ObjectLocator;
  message: string;
}

export interface DesignNetlistAnalysisResult {
  ir: DesignNetlistIR | null;
  diagnostics: NetlistDiagnostic[];
}
