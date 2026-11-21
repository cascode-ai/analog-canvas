import type { PrintedParameterConversion } from "./parameter-projection.js";
import type { ProjectModelSourceLocation } from "./project-model-source.js";
import type { RouteEndpoint } from "@icm/model";
import type {
  DesignNetlistCell,
  DesignNetlistInstance,
  DesignNetlistNode,
} from "./ir.js";

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

/** Read-only provenance in the particular text version returned by the writer. */
export interface PrintedNetlistNode extends PrintedNetlistInstance {
  netId: string;
  endpoint?: Extract<RouteEndpoint, { kind: "terminal" }>;
  pinLabel?: string;
}

export type ResolvePrintedNode = (
  cell: DesignNetlistCell,
  instance: DesignNetlistInstance,
  node: DesignNetlistNode,
) => Pick<PrintedNetlistNode, "netId" | "endpoint" | "pinLabel"> | undefined;

export interface DesignNetlistLocations {
  instances: PrintedNetlistInstance[];
  fields: PrintedNetlistField[];
  nodes?: PrintedNetlistNode[];
  modelSources?: ProjectModelSourceLocation[];
}
