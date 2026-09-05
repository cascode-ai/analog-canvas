import type { z } from "zod";
import type * as Schema from "./index.js";

export type StableId = z.infer<typeof Schema.StableIdSchema>;
export type GridPoint = z.infer<typeof Schema.GridPointSchema>;
export type GridRect = z.infer<typeof Schema.GridRectSchema>;
export type DerivedPoint = z.infer<typeof Schema.DerivedPointSchema>;
export type DerivedRect = z.infer<typeof Schema.DerivedRectSchema>;
export type SymbolLocalPoint = z.infer<typeof Schema.SymbolLocalPointSchema>;
export type SymbolLocalRect = z.infer<typeof Schema.SymbolLocalRectSchema>;
/** @deprecated Name the coordinate domain as GridPoint or DerivedPoint. */
export type Point = GridPoint;
/** @deprecated Name the coordinate domain as GridRect or DerivedRect. */
export type Rect = GridRect;
export type Rotation = z.infer<typeof Schema.RotationSchema>;
export type Mirror = z.infer<typeof Schema.MirrorSchema>;
export type Orientation = z.infer<typeof Schema.OrientationSchema>;
export type SourcePosition = z.infer<typeof Schema.SourcePositionSchema>;
export type SourceSpan = z.infer<typeof Schema.SourceSpanSchema>;
export type ObjectLocatorKind = z.infer<typeof Schema.ObjectLocatorKindSchema>;
export interface HierarchyFrame {
  parentDocumentId: string;
  instanceId: string;
  childDocumentId: string;
}
export interface ObjectLocator {
  documentId: string;
  hierarchyPath: readonly HierarchyFrame[];
  kind: ObjectLocatorKind;
  objectId: string;
  endpoint?: RouteEndpoint;
  sourceRef?: SourceSpan;
}
export type SourceManifest = z.infer<typeof Schema.SourceManifestSchema>;
export type SymbolLibraryLock = z.infer<typeof Schema.SymbolLibraryLockSchema>;
export type InstanceImportProvenance = z.infer<
  typeof Schema.InstanceImportProvenanceSchema
>;
export type NetlistDeviceClass = z.infer<
  typeof Schema.NetlistDeviceClassSchema
>;
export type InstanceNetlistBinding = z.infer<
  typeof Schema.InstanceNetlistBindingSchema
>;
export type InstanceNetlistData = z.infer<
  typeof Schema.InstanceNetlistDataSchema
>;
export type CellNetlistInterface = z.infer<
  typeof Schema.CellNetlistInterfaceSchema
>;
export type CellNetlistTerminal = z.infer<
  typeof Schema.CellNetlistTerminalSchema
>;
export type ExternalSubcircuitDefinition = z.infer<
  typeof Schema.ExternalSubcircuitDefinitionSchema
>;
export type MosBulkBinding = z.infer<typeof Schema.MosBulkBindingSchema>;
export type InstanceStyleOverride = z.infer<
  typeof Schema.InstanceStyleOverrideSchema
>;
export type TerminalRef = z.infer<typeof Schema.TerminalRefSchema>;
export type Instance = z.infer<typeof Schema.InstanceSchema>;
export type Net = z.infer<typeof Schema.NetSchema>;
export type ConnectivityEvidence = z.infer<
  typeof Schema.ConnectivityEvidenceSchema
>;
export type NetPowerDomain = z.infer<typeof Schema.NetPowerDomainSchema>;
export type RouteEndpoint = z.infer<typeof Schema.RouteEndpointSchema>;
export type SegmentMode = z.infer<typeof Schema.SegmentModeSchema>;
export type RouteLegTarget = z.infer<typeof Schema.RouteLegTargetSchema>;
export type RouteLeg = z.infer<typeof Schema.RouteLegSchema>;
export type RouteBranch = z.infer<typeof Schema.RouteBranchSchema>;
export type RoutePresentation = z.infer<typeof Schema.RoutePresentationSchema>;
export type RouteStyleOverride = z.infer<
  typeof Schema.RouteStyleOverrideSchema
>;
export type Junction = z.infer<typeof Schema.JunctionSchema>;
export type NoConnectEndpoint = z.infer<typeof Schema.NoConnectEndpointSchema>;
export type NoConnect = z.infer<typeof Schema.NoConnectSchema>;
export type JunctionRole = z.infer<typeof Schema.JunctionRoleSchema>;
export type AnnotationKind = z.infer<typeof Schema.AnnotationKindSchema>;
export type RouteMarkerKind = z.infer<typeof Schema.RouteMarkerKindSchema>;
export type RouteAnnotationAttachment = z.infer<
  typeof Schema.RouteAnnotationAttachmentSchema
>;
export type AnnotationTextBinding = z.infer<
  typeof Schema.AnnotationTextBindingSchema
>;
export type Annotation = z.infer<typeof Schema.AnnotationSchema>;
export type VisualAnchor = z.infer<typeof Schema.VisualAnchorSchema>;
export type DraftText = z.infer<typeof Schema.DraftTextSchema>;
export type DraftArrow = z.infer<typeof Schema.DraftArrowSchema>;
export type DraftLeader = z.infer<typeof Schema.DraftLeaderSchema>;
export type DraftCallout = z.infer<typeof Schema.DraftCalloutSchema>;
export type DraftConstructionLine = z.infer<
  typeof Schema.DraftConstructionLineSchema
>;
export type DraftRectangle = z.infer<typeof Schema.DraftRectangleSchema>;
export type DraftCircle = z.infer<typeof Schema.DraftCircleSchema>;
export type DraftFloatingSymbol = z.infer<
  typeof Schema.DraftFloatingSymbolSchema
>;
export type DraftingObject = z.infer<typeof Schema.DraftingObjectSchema>;
export type DraftingLayer = z.infer<typeof Schema.DraftingLayerSchema>;
export type PresentationIntent = z.infer<
  typeof Schema.PresentationIntentSchema
>;
export type LayoutGroup = z.infer<typeof Schema.LayoutGroupSchema>;
export type LayoutConstraint = z.infer<typeof Schema.LayoutConstraintSchema>;
export type SchematicDocument = z.infer<typeof Schema.SchematicDocumentSchema>;
export type SimulationAcAnalysis = z.infer<
  typeof Schema.SimulationAcAnalysisSchema
>;
export type SimulationAnalysisSpec = z.infer<
  typeof Schema.SimulationAnalysisSpecSchema
>;
export type SimulationProbeSpec = z.infer<
  typeof Schema.SimulationProbeSpecSchema
>;
export type SimulationEnvironmentSelection = z.infer<
  typeof Schema.SimulationEnvironmentSelectionSchema
>;
export type SimulationStructuredInput = z.infer<
  typeof Schema.SimulationStructuredInputSchema
>;
export type SimulationRawFile = z.infer<typeof Schema.SimulationRawFileSchema>;
export type SimulationRawDependency = z.infer<
  typeof Schema.SimulationRawDependencySchema
>;
export type SimulationRawInput = z.infer<
  typeof Schema.SimulationRawInputSchema
>;
export type SimulationStructuredSetup = {
  version: 1;
  input: SimulationStructuredInput;
};
export type SimulationRawSetup = {
  version: 1;
  input: SimulationRawInput;
};
export type SimulationSetup = z.infer<typeof Schema.SimulationSetupSchema>;
export type CircuitProject = z.infer<typeof Schema.CircuitProjectSchema>;
