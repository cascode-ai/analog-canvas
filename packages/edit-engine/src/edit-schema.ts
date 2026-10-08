import {
  AnnotationSchema,
  CellSymbolPresentationSchema,
  CellNetlistTerminalSchema,
  DraftingObjectSchema,
  ConnectivityEvidenceSchema,
  InstanceNetlistDataSchema,
  InstanceNetlistBindingSchema,
  InstanceSchema,
  SignalFlowParametersSchema,
  InstanceStyleOverrideSchema,
  JunctionRoleSchema,
  LayoutConstraintSchema,
  LayoutGroupSchema,
  MirrorSchema,
  NoConnectSchema,
  ObjectDocumentStyleSchema,
  PlacementSchema,
  PointSchema,
  RouteBranchSchema,
  RouteEndpointSchema,
  RoutePresentationSchema,
  RouteStyleOverrideSchema,
  RotationSchema,
  StableIdSchema,
  StyleOverridesSchema,
} from "@icm/model";
import { z } from "zod";

/**
 * Public typed-edit protocol. This module owns payload shape only; execution,
 * document lookup, and mutation invariants remain in `transaction.ts`.
 */
export const EditActorSchema = z.strictObject({
  kind: z.enum(["human", "agent"]),
  id: StableIdSchema,
});

const NoopEditSchema = z.strictObject({
  kind: z.literal("noop"),
  reason: z.string().min(1).optional(),
});
/** Remove non-semantic drawing and Route geometry while retaining topology. */
const ClearCellDrawingEditSchema = z.strictObject({
  kind: z.literal("clear_cell_drawing"),
});
/** Return every retained Instance to the tray and remove placement geometry. */
const ResetCellPlacementEditSchema = z.strictObject({
  kind: z.literal("reset_cell_placement"),
});
/** Remove a Cell body while retaining its formal interface projection. */
const ResetCellBodyEditSchema = z.strictObject({
  kind: z.literal("reset_cell_body"),
});
const AddInstanceEditSchema = z.strictObject({
  kind: z.literal("add_instance"),
  instance: InstanceSchema,
});
const RemoveInstanceEditSchema = z.strictObject({
  kind: z.literal("remove_instance"),
  instanceId: StableIdSchema,
});
const SetInstanceSymbolEditSchema = z.strictObject({
  kind: z.literal("set_instance_symbol"),
  instanceId: StableIdSchema,
  symbolId: StableIdSchema,
  symbolVariantId: StableIdSchema.nullable().optional(),
  pinMap: z.record(z.string().min(1), z.string().min(1)).optional(),
});
const PlaceInstanceEditSchema = z.strictObject({
  kind: z.literal("place_instance"),
  instanceId: StableIdSchema,
  placement: PlacementSchema,
});
/** Return a placed Instance to the retained Placement Tray. */
const UnplaceInstanceEditSchema = z.strictObject({
  kind: z.literal("unplace_instance"),
  instanceId: StableIdSchema,
});
const MoveInstanceEditSchema = z.strictObject({
  kind: z.literal("move_instance"),
  instanceId: StableIdSchema,
  position: PointSchema,
});
const RotateInstanceEditSchema = z.strictObject({
  kind: z.literal("rotate_instance"),
  instanceId: StableIdSchema,
  rotation: RotationSchema,
});
const MirrorInstanceEditSchema = z.strictObject({
  kind: z.literal("mirror_instance"),
  instanceId: StableIdSchema,
  mirror: MirrorSchema,
});
const PatchInstanceNetlistParametersEditSchema = z.strictObject({
  kind: z.literal("patch_instance_netlist_parameters"),
  instanceId: StableIdSchema,
  set: z.record(z.string().min(1), z.string().min(1).max(1024)).optional(),
  unset: z.array(z.string().min(1)).max(64).optional(),
});
const SetInstanceReferenceEditSchema = z.strictObject({
  kind: z.literal("set_instance_reference"),
  instanceId: StableIdSchema,
  reference: z.string().min(1).max(128),
});
/**
 * Set, update, or clear per-instance color overrides.
 *
 * - `styleOverride.foreground` / `styleOverride.background`: hex color
 *   strings (`#RRGGBB`).
 * - A non-null object replaces the current override as a whole.
 * - `styleOverride` set to `null` clears all instance style overrides.
 */
const SetInstanceStyleOverrideEditSchema = z.strictObject({
  kind: z.literal("set_instance_style_override"),
  instanceId: StableIdSchema,
  styleOverride: InstanceStyleOverrideSchema.nullable(),
});
/**
 * Replace or clear schematic-only Signal Flow parameters.
 *
 * - `parameters.formula` / `parameters.coefficient`: bounded strings.
 * - A non-null object replaces the current parameters as a whole.
 * - `parameters` set to `null` clears all Signal Flow parameters.
 */
const SetInstanceSignalFlowParametersEditSchema = z.strictObject({
  kind: z.literal("set_instance_signal_flow_parameters"),
  instanceId: StableIdSchema,
  parameters: SignalFlowParametersSchema.nullable(),
});
const SetInstanceBindingEditSchema = z.strictObject({
  kind: z.literal("set_instance_binding"),
  instanceId: StableIdSchema,
  binding: InstanceNetlistBindingSchema.nullable(),
});
const SetInstanceNetlistEditSchema = z.strictObject({
  kind: z.literal("set_instance_netlist"),
  instanceId: StableIdSchema,
  netlist: InstanceNetlistDataSchema,
});
const BulkInstanceNetlistAssignmentSchema = z
  .strictObject({
    instanceId: StableIdSchema,
    reference: z.string().min(1).max(128).optional(),
    binding: InstanceNetlistBindingSchema.nullable().optional(),
    set: z.record(z.string().min(1), z.string().min(1).max(1024)).optional(),
    unset: z.array(z.string().min(1)).max(64).optional(),
  })
  .refine(
    (assignment) =>
      assignment.reference !== undefined ||
      assignment.binding !== undefined ||
      Object.keys(assignment.set ?? {}).length > 0 ||
      (assignment.unset?.length ?? 0) > 0,
    "Bulk assignment must change a typed netlist field",
  );
/** Bounded atomic alternative to expanding one bulk request into many edits. */
export const BulkPatchInstanceNetlistEditSchema = z.strictObject({
  kind: z.literal("bulk_patch_instance_netlist"),
  assignments: z.array(BulkInstanceNetlistAssignmentSchema).min(1).max(5000),
});
/** Establish a formal Cell interface on a Document that does not have one. */
const CreateCellInterfaceEditSchema = z.strictObject({
  kind: z.literal("create_cell_interface"),
  name: z.string().min(1).max(128),
});
const AddCellTerminalEditSchema = z.strictObject({
  kind: z.literal("add_cell_terminal"),
  terminal: CellNetlistTerminalSchema,
  index: z.number().int().nonnegative().optional(),
});
const UpdateCellTerminalEditSchema = z.strictObject({
  kind: z.literal("update_cell_terminal"),
  terminalId: StableIdSchema,
  name: z.string().min(1).max(128).optional(),
  direction: z.enum(["input", "output", "inout", "passive"]).optional(),
});
const RemoveCellTerminalEditSchema = z.strictObject({
  kind: z.literal("remove_cell_terminal"),
  terminalId: StableIdSchema,
});
const ReorderCellTerminalsEditSchema = z.strictObject({
  kind: z.literal("reorder_cell_terminals"),
  terminalIds: z.array(StableIdSchema).max(128),
});
/** Replaces one ordered formal parameter definition list atomically. */
const SetCellFormalParametersEditSchema = z.strictObject({
  kind: z.literal("set_cell_formal_parameters"),
  formalParameters: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(128),
        defaultValue: z.string().min(1).max(1024).optional(),
      }),
    )
    .max(128),
});
const SetRoutePathEditSchema = z.strictObject({
  kind: z.literal("set_route_path"),
  route: RouteBranchSchema,
});
/** Replace or clear one electrical Route's visual overrides. */
const SetRouteStyleOverrideEditSchema = z.strictObject({
  kind: z.literal("set_route_style_override"),
  routeId: StableIdSchema,
  styleOverride: RouteStyleOverrideSchema.nullable(),
});
/**
 * Keep a Document style on objects, or release it with `null` so they follow
 * their Document again. Copy writes the kept style; this edit changes it.
 */
const SetObjectDocumentStyleEditSchema = z.strictObject({
  kind: z.literal("set_object_document_style"),
  objectIds: z.array(StableIdSchema).min(1).max(10000),
  documentStyle: ObjectDocumentStyleSchema.nullable(),
});
const RouteOrthogonalEditSchema = z.strictObject({
  kind: z.literal("route_orthogonal"),
  routeId: StableIdSchema,
  netId: StableIdSchema,
  from: RouteEndpointSchema,
  to: RouteEndpointSchema,
  escapeLength: z.number().int().positive().max(1000).optional(),
  presentation: RoutePresentationSchema.optional(),
});
const AddJunctionEditSchema = z.strictObject({
  kind: z.literal("add_junction"),
  junctionId: StableIdSchema,
  netId: StableIdSchema,
  position: PointSchema,
  role: JunctionRoleSchema.optional(),
  documentStyle: ObjectDocumentStyleSchema.optional(),
  createNet: z.boolean().optional(),
  split: z
    .strictObject({
      routeId: StableIdSchema,
      firstRouteId: StableIdSchema,
      secondRouteId: StableIdSchema,
      legId: StableIdSchema,
    })
    .optional(),
});
const AttachEndpointToRouteEditSchema = z.strictObject({
  kind: z.literal("attach_endpoint_to_route"),
  endpoint: RouteEndpointSchema,
  routeId: StableIdSchema,
  point: PointSchema,
  legId: StableIdSchema,
  firstRouteId: StableIdSchema,
  secondRouteId: StableIdSchema,
});
const RemoveJunctionEditSchema = z.strictObject({
  kind: z.literal("remove_junction"),
  junctionId: StableIdSchema,
});
const MoveJunctionEditSchema = z.strictObject({
  kind: z.literal("move_junction"),
  junctionId: StableIdSchema,
  position: PointSchema,
});
/**
 * Removes only the rendered Route geometry.  The Net's electrical membership
 * is retained, so imported routing guidance can be derived again if needed.
 */
const RemoveRouteGeometryEditSchema = z.strictObject({
  kind: z.literal("remove_route_geometry"),
  routeId: StableIdSchema,
});
const CutConnectionEditSchema = z.strictObject({
  kind: z.literal("cut_connection"),
  routeId: StableIdSchema,
});
const ConnectEndpointsEditSchema = z.strictObject({
  kind: z.literal("connect_endpoints"),
  from: RouteEndpointSchema,
  to: RouteEndpointSchema,
  newNetId: StableIdSchema.optional(),
});
/**
 * Materialize one physical Base Net without assigning a name, owner, terminal,
 * or geometry. Document composition uses this before replaying the source
 * Net's independently typed membership and Evidence edits.
 */
const CreateBaseNetEditSchema = z.strictObject({
  kind: z.literal("create_base_net"),
  netId: StableIdSchema,
});

/** A power rail edit creates/reuses one explicit named Net and its geometry. */
const AddPowerRailEditSchema = z.strictObject({
  kind: z.literal("add_power_rail"),
  netId: StableIdSchema,
  routeId: StableIdSchema,
  startJunctionId: StableIdSchema,
  endJunctionId: StableIdSchema,
  labelId: StableIdSchema,
  netName: z.string().trim().min(1).max(128),
  scope: z.enum(["local", "global"]),
  powerDomain: z.literal("vdd"),
  start: PointSchema,
  end: PointSchema,
});
const MergeNetsEditSchema = z.strictObject({
  kind: z.literal("merge_nets"),
  targetNetId: StableIdSchema,
  sourceNetId: StableIdSchema,
});
const UpsertConnectivityEvidenceEditSchema = z.strictObject({
  kind: z.literal("upsert_connectivity_evidence"),
  evidence: ConnectivityEvidenceSchema,
});
const RemoveConnectivityEvidenceEditSchema = z.strictObject({
  kind: z.literal("remove_connectivity_evidence"),
  evidenceId: StableIdSchema,
});
const SetMosBulkDefaultsEditSchema = z.strictObject({
  kind: z.literal("set_mos_bulk_defaults"),
  nmosNetId: StableIdSchema.nullable().optional(),
  pmosNetId: StableIdSchema.nullable().optional(),
});
const ReconcileMosBulkEditSchema = z.strictObject({
  kind: z.literal("reconcile_mos_bulk"),
  instanceIds: z.array(StableIdSchema).optional(),
});
const ClearMosBulkDefaultEditSchema = z.strictObject({
  kind: z.literal("clear_mos_bulk_default"),
  instanceId: StableIdSchema,
});
const DisconnectEndpointEditSchema = z.strictObject({
  kind: z.literal("disconnect_endpoint"),
  endpoint: z.strictObject({
    kind: z.literal("terminal"),
    instanceId: StableIdSchema,
    pinName: z.string().min(1),
  }),
});
/** Assigns a reviewed non-graphical terminal directly to an existing Net. */
const SetPropertyTerminalNetEditSchema = z.strictObject({
  kind: z.literal("set_property_terminal_net"),
  instanceId: StableIdSchema,
  pinName: z.string().min(1).max(128),
  netId: StableIdSchema.nullable(),
});
const AddNoConnectEditSchema = z.strictObject({
  kind: z.literal("add_no_connect"),
  noConnect: NoConnectSchema,
});
const RemoveNoConnectEditSchema = z.strictObject({
  kind: z.literal("remove_no_connect"),
  noConnectId: StableIdSchema,
});
const SetPresentationStyleEditSchema = z.strictObject({
  kind: z.literal("set_presentation_style"),
  styleProfileId: StableIdSchema,
  /**
   * Optional document style overrides: omitted leaves the persisted value
   * untouched, `null` clears it back to profile defaults, an object replaces
   * it whole.
   */
  styleOverrides: StyleOverridesSchema.nullable().optional(),
});
const SetCellSymbolPresentationEditSchema = z.strictObject({
  kind: z.literal("set_cell_symbol_presentation"),
  /** `null` clears all explicit definition-level symbol intent. */
  presentation: CellSymbolPresentationSchema.nullable(),
});
/** AnnotationSchema already carries optional presentation-only `textColor`. */
const UpsertSchematicAnnotationEditSchema = z.strictObject({
  kind: z.literal("upsert_schematic_annotation"),
  annotation: AnnotationSchema,
});
const RemoveSchematicAnnotationEditSchema = z.strictObject({
  kind: z.literal("remove_schematic_annotation"),
  annotationId: StableIdSchema,
});
const UpsertDraftingObjectEditSchema = z.strictObject({
  kind: z.literal("upsert_drafting_object"),
  object: DraftingObjectSchema,
});
const RemoveDraftingObjectEditSchema = z.strictObject({
  kind: z.literal("remove_drafting_object"),
  objectId: StableIdSchema,
});
const SetLayoutGroupEditSchema = z.strictObject({
  kind: z.literal("set_layout_group"),
  group: LayoutGroupSchema,
});
const RemoveLayoutGroupEditSchema = z.strictObject({
  kind: z.literal("remove_layout_group"),
  groupId: StableIdSchema,
});
const SetLayoutConstraintEditSchema = z.strictObject({
  kind: z.literal("set_layout_constraint"),
  constraint: LayoutConstraintSchema,
});
const RemoveLayoutConstraintEditSchema = z.strictObject({
  kind: z.literal("remove_layout_constraint"),
  constraintId: StableIdSchema,
});
const AlignInstancesEditSchema = z.strictObject({
  kind: z.literal("align_instances"),
  instanceIds: z.array(StableIdSchema).min(2).max(64),
  axis: z.enum(["x", "y"]),
  coordinate: z.number().int().optional(),
});
const UndoEditSchema = z.strictObject({ kind: z.literal("undo") });
const RedoEditSchema = z.strictObject({ kind: z.literal("redo") });

export const SchematicEditSchema = z.discriminatedUnion("kind", [
  NoopEditSchema,
  ClearCellDrawingEditSchema,
  ResetCellPlacementEditSchema,
  ResetCellBodyEditSchema,
  AddInstanceEditSchema,
  RemoveInstanceEditSchema,
  SetInstanceSymbolEditSchema,
  PlaceInstanceEditSchema,
  UnplaceInstanceEditSchema,
  MoveInstanceEditSchema,
  RotateInstanceEditSchema,
  MirrorInstanceEditSchema,
  PatchInstanceNetlistParametersEditSchema,
  SetInstanceReferenceEditSchema,
  SetInstanceStyleOverrideEditSchema,
  SetInstanceSignalFlowParametersEditSchema,
  SetInstanceBindingEditSchema,
  SetInstanceNetlistEditSchema,
  BulkPatchInstanceNetlistEditSchema,
  CreateCellInterfaceEditSchema,
  AddCellTerminalEditSchema,
  UpdateCellTerminalEditSchema,
  RemoveCellTerminalEditSchema,
  ReorderCellTerminalsEditSchema,
  SetCellFormalParametersEditSchema,
  SetRoutePathEditSchema,
  SetRouteStyleOverrideEditSchema,
  SetObjectDocumentStyleEditSchema,
  RouteOrthogonalEditSchema,
  AddJunctionEditSchema,
  AttachEndpointToRouteEditSchema,
  RemoveJunctionEditSchema,
  MoveJunctionEditSchema,
  RemoveRouteGeometryEditSchema,
  CutConnectionEditSchema,
  ConnectEndpointsEditSchema,
  CreateBaseNetEditSchema,
  AddPowerRailEditSchema,
  MergeNetsEditSchema,
  UpsertConnectivityEvidenceEditSchema,
  RemoveConnectivityEvidenceEditSchema,
  SetMosBulkDefaultsEditSchema,
  ReconcileMosBulkEditSchema,
  ClearMosBulkDefaultEditSchema,
  DisconnectEndpointEditSchema,
  SetPropertyTerminalNetEditSchema,
  AddNoConnectEditSchema,
  RemoveNoConnectEditSchema,
  SetPresentationStyleEditSchema,
  SetCellSymbolPresentationEditSchema,
  UpsertSchematicAnnotationEditSchema,
  RemoveSchematicAnnotationEditSchema,
  UpsertDraftingObjectEditSchema,
  RemoveDraftingObjectEditSchema,
  SetLayoutGroupEditSchema,
  RemoveLayoutGroupEditSchema,
  SetLayoutConstraintEditSchema,
  RemoveLayoutConstraintEditSchema,
  AlignInstancesEditSchema,
  UndoEditSchema,
  RedoEditSchema,
]);

// Whole-document Gallery placement compiles one bounded edit per imported
// object. Dense but legitimate circuits can exceed 256 edits, so keep a
// deliberate denial-of-service ceiling while allowing current library scenes.
export const MAX_SCHEMATIC_EDITS_PER_TRANSACTION = 1024;

export const EditTransactionSchema = z.strictObject({
  transactionId: StableIdSchema,
  documentId: StableIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  actor: EditActorSchema,
  dryRun: z.boolean().optional(),
  edits: z
    .array(SchematicEditSchema)
    .min(1)
    .max(MAX_SCHEMATIC_EDITS_PER_TRANSACTION),
});

export type EditActor = z.infer<typeof EditActorSchema>;
export type SchematicEdit = z.infer<typeof SchematicEditSchema>;
export type EditTransaction = z.infer<typeof EditTransactionSchema>;
