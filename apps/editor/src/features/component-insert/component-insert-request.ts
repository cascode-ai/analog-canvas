import type { Rotation } from "@icm/model";

export interface SymbolInsertRequest {
  kind: "symbol";
  symbolId: string;
  symbolName: string;
  parameters: Record<string, string>;
  initialRotation: Rotation;
  showReference: boolean;
  referenceText: string | null;
  showValue: boolean;
  portName?: string;
  portDirection?: "input" | "output" | "inout" | "passive";
}

export interface VddRailInsertRequest {
  kind: "vdd-rail";
  symbolId: "vdd";
  symbolName: "Power Rail";
  netName: string;
}

export interface DrawingToolInsertRequest {
  kind: "drawing-tool";
  symbolId: string;
  symbolName: string;
  tool: "arrow" | "construction-line" | "rectangle" | "circle";
}

export interface PolarityAnnotationInsertRequest {
  kind: "polarity-annotation";
  symbolId: string;
  symbolName: string;
  polarity: "both" | "positive" | "negative";
  initialRotation: Rotation;
}

export interface DraftTextAnnotationInsertRequest {
  kind: "drafting-text";
  symbolId: string;
  symbolName: string;
  text: string;
  initialRotation: Rotation;
}

export interface CellInsertRequest {
  kind: "cell";
  symbolId: string;
  symbolName: string;
  childDocumentId: string;
  cellName: string;
  parameters: Record<string, string>;
  initialRotation: Rotation;
  showReference: boolean;
  referenceText: string | null;
  showValue: true;
}

export interface ExternalSubcircuitInsertRequest {
  kind: "external-subcircuit";
  symbolId: string;
  symbolName: string;
  definitionId: string;
  masterName: string;
  parameters: Record<string, string>;
  initialRotation: Rotation;
  showReference: boolean;
  referenceText: string | null;
  showValue: true;
}

export type ComponentInsertRequest =
  | SymbolInsertRequest
  | CellInsertRequest
  | ExternalSubcircuitInsertRequest
  | VddRailInsertRequest
  | DrawingToolInsertRequest
  | PolarityAnnotationInsertRequest
  | DraftTextAnnotationInsertRequest;
