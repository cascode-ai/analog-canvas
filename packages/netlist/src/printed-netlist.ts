import type { PrintedParameterConversion } from "./parameter-projection.js";
import type { ProjectModelSourceLocation } from "./project-model-source.js";

/** Character ranges in generated circuit source; independent of simulator syntax. */
export interface PrintedNetlistInstance {
  documentId: string;
  instanceId: string;
  startOffset: number;
  endOffset: number;
}

export interface PrintedNetlistParameter extends PrintedNetlistInstance {
  parameter: string;
  /** The exact generated value at this range, not the original project spelling. */
  rawValue: string;
}

/** Editable fields in a design export, tied to stable schematic identities. */
export interface PrintedNetlistField extends PrintedNetlistInstance {
  kind: "reference" | "target" | "parameter";
  parameter?: string;
  rawValue: string;
  /** Optional for identity projections and existing callers. */
  conversion?: PrintedParameterConversion;
}

export interface DesignNetlistLocations {
  instances: PrintedNetlistInstance[];
  fields: PrintedNetlistField[];
  modelSources?: ProjectModelSourceLocation[];
}
