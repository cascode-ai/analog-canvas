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
export type ProjectModelSource = z.infer<
  typeof Schema.ProjectModelSourceSchema
>;
export type Instance = z.infer<typeof Schema.InstanceSchema>;
export type Net = z.infer<typeof Schema.NetSchema>;
export type ConnectivityEvidence = z.infer<
  typeof Schema.ConnectivityEvidenceSchema
>;
export type RouteEndpoint = z.infer<typeof Schema.RouteEndpointSchema>;
export type SegmentMode = z.infer<typeof Schema.SegmentModeSchema>;
export type RouteBranch = z.infer<typeof Schema.RouteBranchSchema>;
export type RoutePresentation = z.infer<typeof Schema.RoutePresentationSchema>;
export type RouteStyleOverride = z.infer<
  typeof Schema.RouteStyleOverrideSchema
>;
export type NoConnect = z.infer<typeof Schema.NoConnectSchema>;
export type RouteAnnotationAttachment = z.infer<
  typeof Schema.RouteAnnotationAttachmentSchema
>;
export type AnnotationTextBinding = z.infer<
  typeof Schema.AnnotationTextBindingSchema
>;
export type Annotation = z.infer<typeof Schema.AnnotationSchema>;
export type VisualAnchor = z.infer<typeof Schema.VisualAnchorSchema>;
export type DraftingObject = z.infer<typeof Schema.DraftingObjectSchema>;
export type LayoutGroup = z.infer<typeof Schema.LayoutGroupSchema>;
export type LayoutConstraint = z.infer<typeof Schema.LayoutConstraintSchema>;
export type SchematicDocument = z.infer<typeof Schema.SchematicDocumentSchema>;
export type SimulationAnalysisSpec = z.infer<
  typeof Schema.SimulationAnalysisSpecSchema
>;
export type SimulationDeviceOperatingPointSpec = z.infer<
  typeof Schema.SimulationDeviceOperatingPointSpecSchema
>;
export type SimulationMeasurementSpec = z.infer<
  typeof Schema.SimulationMeasurementSpecSchema
>;
export type SimulationRunPlanAxis = z.infer<
  typeof Schema.SimulationRunPlanAxisSchema
>;
export type SimulationVoltageProbeAnchor = z.infer<
  typeof Schema.SimulationVoltageProbeAnchorSchema
>;
export type SimulationVoltageProbe = z.infer<
  typeof Schema.SimulationVoltageProbeSchema
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
/** @internal Tests type structured setup fixtures with it. */
export type SimulationStructuredSetup = {
  version: 3;
  input: SimulationStructuredInput;
};
/** @internal Tests type raw setup fixtures with it. */
export type SimulationRawSetup = {
  version: 3;
  input: SimulationRawInput;
};
export type LegacySimulationSetup = z.infer<
  typeof Schema.LegacySimulationSetupSchema
>;
export type LegacyProjectSimulationSetup = z.infer<
  typeof Schema.LegacyProjectSimulationSetupSchema
>;
export type ProjectSimulationFolder = z.infer<
  typeof Schema.ProjectSimulationFolderSchema
>;
export type CircuitProject = z.infer<typeof Schema.CircuitProjectSchema>;
