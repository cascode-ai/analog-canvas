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
  PlacementSchema,
  PointSchema,
  RouteBranchSchema,
  RouteEndpointSchema,
  RoutePresentationSchema,
  RouteStyleOverrideSchema,
  RotationSchema,
  SegmentModeSchema,
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

export const NoopEditSchema = z.strictObject({
  kind: z.literal("noop"),
  reason: z.string().min(1).optional(),
});
/** Remove non-semantic drawing and Route geometry while retaining topology. */
export const ClearCellDrawingEditSchema = z.strictObject({
  kind: z.literal("clear_cell_drawing"),
});
/** Return every retained Instance to the tray and remove placement geometry. */
export const ResetCellPlacementEditSchema = z.strictObject({
  kind: z.literal("reset_cell_placement"),
});
/** Remove a Cell body while retaining its formal interface projection. */
export const ResetCellBodyEditSchema = z.strictObject({
  kind: z.literal("reset_cell_body"),
});
export const AddInstanceEditSchema = z.strictObject({
  kind: z.literal("add_instance"),
  instance: InstanceSchema,
});
export const RemoveInstanceEditSchema = z.strictObject({
  kind: z.literal("remove_instance"),
  instanceId: StableIdSchema,
});
export const SetInstanceSymbolEditSchema = z.strictObject({
  kind: z.literal("set_instance_symbol"),
  instanceId: StableIdSchema,
  symbolId: StableIdSchema,
  symbolVariantId: StableIdSchema.nullable().optional(),
  pinMap: z.record(z.string().min(1), z.string().min(1)).optional(),
});
export const PlaceInstanceEditSchema = z.strictObject({
  kind: z.literal("place_instance"),
  instanceId: StableIdSchema,
  placement: PlacementSchema,
});
/** Return a placed Instance to the retained Placement Tray. */
export const UnplaceInstanceEditSchema = z.strictObject({
  kind: z.literal("unplace_instance"),
  instanceId: StableIdSchema,
});
export const MoveInstanceEditSchema = z.strictObject({
  kind: z.literal("move_instance"),
  instanceId: StableIdSchema,
  position: PointSchema,
});
export const RotateInstanceEditSchema = z.strictObject({
  kind: z.literal("rotate_instance"),
  instanceId: StableIdSchema,
  rotation: RotationSchema,
});
export const MirrorInstanceEditSchema = z.strictObject({
  kind: z.literal("mirror_instance"),
  instanceId: StableIdSchema,
  mirror: MirrorSchema,
});
export const PatchInstanceNetlistParametersEditSchema = z.strictObject({
  kind: z.literal("patch_instance_netlist_parameters"),
  instanceId: StableIdSchema,
  set: z.record(z.string().min(1), z.string().min(1).max(1024)).optional(),
  unset: z.array(z.string().min(1)).max(64).optional(),
});
export const SetInstanceReferenceEditSchema = z.strictObject({
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
export const SetInstanceStyleOverrideEditSchema = z.strictObject({
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
export const SetInstanceSignalFlowParametersEditSchema = z.strictObject({
  kind: z.literal("set_instance_signal_flow_parameters"),
  instanceId: StableIdSchema,
  parameters: SignalFlowParametersSchema.nullable(),
});
export const SetInstanceBindingEditSchema = z.strictObject({
  kind: z.literal("set_instance_binding"),
  instanceId: StableIdSchema,
  binding: InstanceNetlistBindingSchema.nullable(),
});
export const SetInstanceNetlistEditSchema = z.strictObject({
  kind: z.literal("set_instance_netlist"),
  instanceId: StableIdSchema,
  netlist: InstanceNetlistDataSchema,
});
export const BulkInstanceNetlistAssignmentSchema = z
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
export const CreateCellInterfaceEditSchema = z.strictObject({
  kind: z.literal("create_cell_interface"),
  name: z.string().min(1).max(128),
});
export const AddCellTerminalEditSchema = z.strictObject({
  kind: z.literal("add_cell_terminal"),
  terminal: CellNetlistTerminalSchema,
  index: z.number().int().nonnegative().optional(),
});
export const UpdateCellTerminalEditSchema = z.strictObject({
  kind: z.literal("update_cell_terminal"),
  terminalId: StableIdSchema,
  name: z.string().min(1).max(128).optional(),
  direction: z.enum(["input", "output", "inout", "passive"]).optional(),
});
export const RemoveCellTerminalEditSchema = z.strictObject({
  kind: z.literal("remove_cell_terminal"),
  terminalId: StableIdSchema,
});
export const ReorderCellTerminalsEditSchema = z.strictObject({
  kind: z.literal("reorder_cell_terminals"),
  terminalIds: z.array(StableIdSchema).max(128),
});
/** Replaces one ordered formal parameter definition list atomically. */
export const SetCellFormalParametersEditSchema = z.strictObject({
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
export const SetRoutePathEditSchema = z.strictObject({
  kind: z.literal("set_route_path"),
  route: RouteBranchSchema,
});
/** Replace or clear one electrical Route's visual color override. */
export const SetRouteStyleOverrideEditSchema = z.strictObject({
  kind: z.literal("set_route_style_override"),
  routeId: StableIdSchema,
  styleOverride: RouteStyleOverrideSchema.nullable(),
});
export const RouteOrthogonalEditSchema = z.strictObject({
  kind: z.literal("route_orthogonal"),
  routeId: StableIdSchema,
  netId: StableIdSchema,
  from: RouteEndpointSchema,
  to: RouteEndpointSchema,
  escapeLength: z.number().int().positive().max(1000).optional(),
  presentation: RoutePresentationSchema.optional(),
});
export const AddJunctionEditSchema = z.strictObject({
  kind: z.literal("add_junction"),
  junctionId: StableIdSchema,
  netId: StableIdSchema,
  position: PointSchema,
  role: JunctionRoleSchema.optional(),
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
export const AttachEndpointToRouteEditSchema = z.strictObject({
  kind: z.literal("attach_endpoint_to_route"),
  endpoint: RouteEndpointSchema,
  routeId: StableIdSchema,
  point: PointSchema,
  legId: StableIdSchema,
  firstRouteId: StableIdSchema,
  secondRouteId: StableIdSchema,
});
export const RemoveJunctionEditSchema = z.strictObject({
  kind: z.literal("remove_junction"),
  junctionId: StableIdSchema,
});
export const MoveJunctionEditSchema = z.strictObject({
  kind: z.literal("move_junction"),
  junctionId: StableIdSchema,
  position: PointSchema,
});
/**
 * Removes only the rendered Route geometry.  The Net's electrical membership
 * is retained, so imported routing guidance can be derived again if needed.
 */
export const RemoveRouteGeometryEditSchema = z.strictObject({
  kind: z.literal("remove_route_geometry"),
  routeId: StableIdSchema,
});
export const CutConnectionEditSchema = z.strictObject({
  kind: z.literal("cut_connection"),
  routeId: StableIdSchema,
});
export const ConnectEndpointsEditSchema = z.strictObject({
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
export const CreateBaseNetEditSchema = z.strictObject({
  kind: z.literal("create_base_net"),
  netId: StableIdSchema,
});

/** A power rail edit creates/reuses one explicit named Net and its geometry. */
export const AddPowerRailEditSchema = z.strictObject({
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
export const MergeNetsEditSchema = z.strictObject({
  kind: z.literal("merge_nets"),
  targetNetId: StableIdSchema,
  sourceNetId: StableIdSchema,
});
export const UpsertConnectivityEvidenceEditSchema = z.strictObject({
  kind: z.literal("upsert_connectivity_evidence"),
  evidence: ConnectivityEvidenceSchema,
});
export const RemoveConnectivityEvidenceEditSchema = z.strictObject({
  kind: z.literal("remove_connectivity_evidence"),
  evidenceId: StableIdSchema,
});
export const SetMosBulkDefaultsEditSchema = z.strictObject({
  kind: z.literal("set_mos_bulk_defaults"),
  nmosNetId: StableIdSchema.nullable().optional(),
  pmosNetId: StableIdSchema.nullable().optional(),
});
export const ReconcileMosBulkEditSchema = z.strictObject({
  kind: z.literal("reconcile_mos_bulk"),
  instanceIds: z.array(StableIdSchema).optional(),
});
export const ClearMosBulkDefaultEditSchema = z.strictObject({
  kind: z.literal("clear_mos_bulk_default"),
  instanceId: StableIdSchema,
});
export const DisconnectEndpointEditSchema = z.strictObject({
  kind: z.literal("disconnect_endpoint"),
  endpoint: z.strictObject({
    kind: z.literal("terminal"),
    instanceId: StableIdSchema,
    pinName: z.string().min(1),
  }),
});
export const AddNoConnectEditSchema = z.strictObject({
  kind: z.literal("add_no_connect"),
  noConnect: NoConnectSchema,
});
export const RemoveNoConnectEditSchema = z.strictObject({
  kind: z.literal("remove_no_connect"),
  noConnectId: StableIdSchema,
});
export const SetPresentationStyleEditSchema = z.strictObject({
  kind: z.literal("set_presentation_style"),
  styleProfileId: StableIdSchema,
  /**
   * Optional document style overrides: omitted leaves the persisted value
   * untouched, `null` clears it back to profile defaults, an object replaces
   * it whole.
   */
  styleOverrides: StyleOverridesSchema.nullable().optional(),
});
export const SetCellSymbolPresentationEditSchema = z.strictObject({
  kind: z.literal("set_cell_symbol_presentation"),
  /** `null` clears all explicit definition-level symbol intent. */
  presentation: CellSymbolPresentationSchema.nullable(),
});
/** AnnotationSchema already carries optional presentation-only `textColor`. */
export const UpsertSchematicAnnotationEditSchema = z.strictObject({
  kind: z.literal("upsert_schematic_annotation"),
  annotation: AnnotationSchema,
});
export const RemoveSchematicAnnotationEditSchema = z.strictObject({
  kind: z.literal("remove_schematic_annotation"),
  annotationId: StableIdSchema,
});
export const UpsertDraftingObjectEditSchema = z.strictObject({
  kind: z.literal("upsert_drafting_object"),
  object: DraftingObjectSchema,
});
export const RemoveDraftingObjectEditSchema = z.strictObject({
  kind: z.literal("remove_drafting_object"),
  objectId: StableIdSchema,
});
export const SetLayoutGroupEditSchema = z.strictObject({
  kind: z.literal("set_layout_group"),
  group: LayoutGroupSchema,
});
export const RemoveLayoutGroupEditSchema = z.strictObject({
  kind: z.literal("remove_layout_group"),
  groupId: StableIdSchema,
});
export const SetLayoutConstraintEditSchema = z.strictObject({
  kind: z.literal("set_layout_constraint"),
  constraint: LayoutConstraintSchema,
});
export const RemoveLayoutConstraintEditSchema = z.strictObject({
  kind: z.literal("remove_layout_constraint"),
  constraintId: StableIdSchema,
});
export const AlignInstancesEditSchema = z.strictObject({
  kind: z.literal("align_instances"),
  instanceIds: z.array(StableIdSchema).min(2).max(64),
  axis: z.enum(["x", "y"]),
  coordinate: z.number().int().optional(),
});
export const UndoEditSchema = z.strictObject({ kind: z.literal("undo") });
export const RedoEditSchema = z.strictObject({ kind: z.literal("redo") });

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
