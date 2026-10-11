import type {
  ComponentDefinition,
  RichTextDocument,
  Rotation,
} from "@icm/model";
import type { PendingCircuitCapture } from "../user-components/component-placement";

export interface SymbolInsertRequest {
  capture?: PendingCircuitCapture;
  kind: "symbol";
  componentDefinition?: ComponentDefinition;
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
  tool: "arrow" | "polyline" | "construction-line" | "rectangle" | "circle";
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
  /**
   * Text typed before it is placed: the preview carries it and it lands as
   * written. Without it, plain Text opens its editor after the click.
   */
  content?: RichTextDocument;
  alignment?: "start" | "middle" | "end";
  sizeScale?: number;
  /** Open the text editor after the user chooses the placement point. */
  editAfterPlacement?: boolean;
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
  capture?: PendingCircuitCapture;
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
