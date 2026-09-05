import {
  AnnotationSchema,
  DerivedPointSchema,
  DerivedRectSchema,
  DraftingDiagnosticSchema,
  DraftingObjectSchema,
  LayoutConstraintSchema,
  LayoutGroupSchema,
  JunctionRoleSchema,
  NoConnectSchema,
  NetPowerDomainSchema,
  PlacementSchema,
  PointSchema,
  ResolvedDraftingGeometrySchema,
  PresentationIntentSchema,
  GridRectSchema,
  RouteEndpointSchema,
  RouteLegSchema,
  RoutePresentationSchema,
  SourceSpanSchema,
  StableIdSchema,
  SymbolLocalPointSchema,
  InstanceStyleOverrideSchema,
  SignalFlowParametersSchema,
  ExternalSubcircuitDefinitionSchema,
  CellNetlistInterfaceSchema,
  MosBulkDefaultsSchema,
  SimulationSetupSchema,
} from "@icm/model";
import { ObjectLocatorSchema, HierarchyFrameSchema } from "@icm/derived";
import {
  ProjectStructureEditSchema,
  SchematicEditSchema,
} from "@icm/edit-engine";
import { z } from "zod";
import { AgentAuthoringCommandSchema } from "./authoring-command.js";
export { AgentAuthoringCommandSchema } from "./authoring-command.js";
export type { AgentAuthoringCommand } from "./authoring-command.js";

export const AGENT_API_VERSION = "2.0" as const;
export const AGENT_SNAPSHOT_VERSION = "2.0" as const;
export const AgentApiVersionSchema = z.literal(AGENT_API_VERSION);
const RequestBaseSchema = z.strictObject({
  apiVersion: AgentApiVersionSchema,
  requestId: StableIdSchema,
});

export const AgentPermissionsSchema = z.strictObject({
  snapshot: z.boolean(),
  render: z.boolean(),
  sourceSpans: z.boolean(),
  /** Grants non-persisting selection, Net-highlight, and viewport control. */
  semanticControl: z.boolean().optional(),
  edit: z.strictObject({
    geometry: z.boolean(),
    connectivity: z.boolean(),
    presentation: z.boolean(),
  }),
});

export const AgentLimitsSchema = z.strictObject({
  maxSnapshotBytes: z.number().int().positive().max(20_000_000),
  maxTransactionEdits: z.number().int().positive().max(256),
  maxRenderBytes: z.number().int().positive().max(20_000_000),
  maxRequestBytes: z.number().int().positive().max(2_000_000),
  changeHistoryEntries: z.number().int().positive().max(256),
});
export const AgentCapabilitiesRequestSchema = RequestBaseSchema.extend({
  operation: z.literal("capabilities"),
});
/** Named non-Circuit resource advertised by a live browser Agent session. */
export const AgentFileResourceCapabilitySchema = z.strictObject({
  path: z.literal("/api/agent/sessions/{sessionId}/files"),
  operations: z.array(
    z.enum([
      "download",
      "stage",
      "inspect",
      "discard",
      "request-approval",
      "simulation-input",
    ]),
  ),
  maxBytes: z.number().int().positive(),
  humanApprovalOperations: z.array(z.literal("request-approval")),
});
/** Separate, short-request Simulation Resource over the shared run registry. */
export const AgentSimulationResourceCapabilitySchema = z.strictObject({
  path: z.literal("/api/agent/sessions/{sessionId}/simulation"),
  operations: z.array(
    z.enum(["prepare", "start", "read", "cancel", "export", "capabilities"]),
  ),
  analyses: z.array(z.enum(["op", "ac"])),
  maxTimeoutMs: z.number().int().positive(),
  synchronous: z.literal(false),
});
export const AgentSnapshotRequestSchema = RequestBaseSchema.extend({
  operation: z.literal("snapshot"),
  documentId: StableIdSchema,
  includeSourceSpans: z.boolean().optional(),
  traceNet: z
    .strictObject({
      netId: StableIdSchema,
      hierarchyPath: z.array(HierarchyFrameSchema).max(32).optional(),
    })
    .optional(),
});
export const AgentWireIntentAnchorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("endpoint"),
    endpoint: RouteEndpointSchema,
  }),
  z.strictObject({
    kind: z.literal("route-segment"),
    routeId: StableIdSchema,
    legId: StableIdSchema,
    point: PointSchema,
  }),
  z.strictObject({ kind: z.literal("free"), point: PointSchema }),
]);
export const AgentWireIntentSchema = z.strictObject({
  id: StableIdSchema,
  from: AgentWireIntentAnchorSchema,
  to: AgentWireIntentAnchorSchema,
  waypoints: z.array(PointSchema).max(256).optional(),
  routingMode: z.enum(["orthogonal", "octilinear", "free"]).optional(),
  cornerOrder: z
    .enum(["auto", "diagonal-first", "orthogonal-first"])
    .optional(),
});

/** Public subset of the canonical derived `ObjectLocator` runtime schema. */
export const AgentObjectLocatorSchema = ObjectLocatorSchema.omit({
  sourceRef: true,
}).extend({
  kind: z.enum([
    "instance",
    "net",
    "route",
    "junction",
    "terminal",
    "annotation",
    "no-connect",
  ]),
});

/**
 * Semantic intents deliberately live inside `transact` so the public operation
 * set remains small. Unlike edits and wire intents, they never enter the
 * Edit Engine and therefore cannot change a Document revision or history.
 */
export const AgentSemanticIntentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("activate-document") }),
  z.strictObject({
    kind: z.literal("select"),
    locator: AgentObjectLocatorSchema,
  }),
  z.strictObject({
    kind: z.literal("highlight-net"),
    netId: StableIdSchema,
    endpoint: RouteEndpointSchema.optional(),
  }),
  z.strictObject({ kind: z.literal("fit-document") }),
  z.strictObject({ kind: z.literal("clear-focus") }),
]);

/**
 * Agent writes use the exact current authoring contract. This boundary is
 * intentionally narrower than the internal Edit Engine union where product
 * policy forbids a removed asset or style.
 */
export const AgentSchematicEditSchema = SchematicEditSchema.superRefine(
  (edit, context) => {
    if (
      edit.kind === "add_cell_terminal" ||
      edit.kind === "update_cell_terminal" ||
      edit.kind === "remove_cell_terminal" ||
      edit.kind === "reorder_cell_terminals" ||
      edit.kind === "set_cell_formal_parameters" ||
      edit.kind === "set_cell_symbol_presentation"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Cell interface and Cell-symbol edits must be wrapped in structureEdits",
      });
    }
    if (edit.kind === "add_instance") {
      if (edit.instance.symbolId === "vdd") {
        context.addIssue({
          code: "custom",
          path: ["instance", "symbolId"],
          message: "Use add_power_rail; vdd is not a symbol asset",
        });
      }
    }

    if (edit.kind === "set_instance_symbol" && edit.symbolId === "vdd") {
      context.addIssue({
        code: "custom",
        path: ["symbolId"],
        message: "Use add_power_rail; vdd is not a symbol asset",
      });
    }

    if (
      edit.kind === "set_presentation_style" &&
      edit.styleProfileId === "textbook-monochrome-v1"
    ) {
      context.addIssue({
        code: "custom",
        path: ["styleProfileId"],
        message: "Use the current Razavi product style profile",
      });
    }
  },
);
const TransactionPayloadShape = {
  edits: z.array(AgentSchematicEditSchema).min(1).max(256).optional(),
  wireIntent: AgentWireIntentSchema.optional(),
  semanticIntent: AgentSemanticIntentSchema.optional(),
  command: AgentAuthoringCommandSchema.optional(),
  structureEdits: z
    .array(ProjectStructureEditSchema)
    .min(1)
    .max(256)
    .optional(),
};
function oneTransactionForm(
  request: {
    edits?: unknown;
    wireIntent?: unknown;
    semanticIntent?: unknown;
    structureEdits?: unknown;
    command?: unknown;
  },
  context: z.RefinementCtx,
): void {
  const forms = [
    request.edits,
    request.wireIntent,
    request.semanticIntent,
    request.structureEdits,
    request.command,
  ];
  if (forms.filter((form) => form !== undefined).length !== 1) {
    context.addIssue({
      code: "custom",
      message:
        "Provide exactly one of edits, wireIntent, semanticIntent, structureEdits, or command",
    });
  }
}
export const AgentTransactionPayloadSchema = z
  .strictObject(TransactionPayloadShape)
  .superRefine(oneTransactionForm);
export const AgentTransactRequestSchema = RequestBaseSchema.extend({
  operation: z.literal("transact"),
  documentId: StableIdSchema,
  transactionId: StableIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  expectedStructureRevision: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().optional(),
  ...TransactionPayloadShape,
}).superRefine((request, context) => {
  oneTransactionForm(request, context);
  if (
    request.structureEdits &&
    request.expectedStructureRevision === undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["expectedStructureRevision"],
      message: "Structural transactions require expectedStructureRevision",
    });
  }
});
export const AgentRenderRequestSchema = RequestBaseSchema.extend({
  operation: z.literal("render"),
  documentId: StableIdSchema,
  mode: z.enum(["formal", "diagnostics"]),
  bounds: GridRectSchema.optional(),
});

/** Production and local clients use exactly the same four-operation contract. */
export const AgentProductionCircuitRequestSchema = z.discriminatedUnion(
  "operation",
  [
    AgentCapabilitiesRequestSchema,
    AgentSnapshotRequestSchema,
    AgentTransactRequestSchema,
    AgentRenderRequestSchema,
  ],
);
export const AgentCircuitRequestSchema = AgentProductionCircuitRequestSchema;
// Visual diagnostics are derived from rendered geometry. Text measurement and
// rotated drafting AABBs legitimately produce fractional coordinates even
// though persisted schematic coordinates remain integer-grid values.
const AgentDiagnosticBoundsSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

export const AgentDiagnosticSchema = z.strictObject({
  primary: ObjectLocatorSchema.omit({ sourceRef: true }).optional(),
  related: z.array(ObjectLocatorSchema.omit({ sourceRef: true })).optional(),
  code: z.string().min(1),
  domain: z.enum(["schema", "spice", "erc", "routing", "visual"]).optional(),
  severity: z.enum(["error", "warning", "info"]),
  category: z.enum(["structural", "observation"]).optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  gateEligible: z.boolean().optional(),
  message: z.string(),
  objectIds: z.array(StableIdSchema).optional(),
  path: z.array(z.union([z.string(), z.number().int()])).optional(),
  revision: z.number().int().nonnegative().optional(),
  bounds: AgentDiagnosticBoundsSchema.optional(),
  point: DerivedPointSchema.optional(),
  parameters: z
    .record(
      z.string(),
      z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
    )
    .optional(),
});
export const AgentDiffSchema = z.strictObject({
  documentId: StableIdSchema,
  fromRevision: z.number().int().nonnegative(),
  toRevision: z.number().int().nonnegative(),
  editKinds: z.array(z.string().min(1)),
  changedObjectIds: z.array(StableIdSchema),
});
const SnapshotPrimitiveSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
]);

const AgentSnapshotLogicalNetIdSchema = StableIdSchema.describe(
  "Resolved Logical-Net representative valid only for this Snapshot Document revision; refresh after any committed edit",
);

export const AgentSnapshotPinSchema = z.strictObject({
  name: z.string().min(1),
  role: z.string().min(1).nullable(),
  direction: z.enum(["north", "east", "south", "west"]).nullable(),
  visibility: z.enum(["visible", "implicit", "conditional", "unknown"]),
  localPosition: SymbolLocalPointSchema.nullable(),
  connection: z
    .strictObject({
      contactPoint: DerivedPointSchema,
      gridLanding: PointSchema,
      escapePath: z.array(DerivedPointSchema),
      outward: DerivedPointSchema.nullable(),
    })
    .nullable(),
  netId: AgentSnapshotLogicalNetIdSchema.nullable(),
});

const AgentNetlistFactsSchema = z.strictObject({
  binding: z
    .discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("primitive"),
        deviceClass: z.string().min(1),
      }),
      z.strictObject({
        kind: z.literal("model"),
        deviceClass: z.string().min(1),
        name: z.string().min(1),
      }),
      z.strictObject({
        kind: z.literal("subcircuit"),
        childDocumentId: StableIdSchema,
      }),
      z.strictObject({
        kind: z.literal("external-subcircuit"),
        definitionId: StableIdSchema,
      }),
      z.strictObject({
        kind: z.literal("unresolved-subcircuit"),
        name: z.string().min(1),
      }),
    ])
    .optional(),
  parameters: z.record(z.string(), z.string()),
  terminalMapping: z
    .array(
      z.strictObject({
        sourcePosition: z.number().int().nonnegative(),
        pinName: z.string().min(1),
      }),
    )
    .optional(),
});

export const AgentSnapshotInstanceSchema = z.strictObject({
  styleOverride: InstanceStyleOverrideSchema.optional(),
  signalFlowParameters: SignalFlowParametersSchema.optional(),
  id: StableIdSchema,
  reference: z.string().min(1).nullable(),
  masterName: z.string().min(1).nullable(),
  symbolId: StableIdSchema,
  symbolVariantId: StableIdSchema.nullable(),
  target: z.string().nullable(),
  model: z.string().nullable(),
  parameters: z.record(z.string(), SnapshotPrimitiveSchema),
  placement: PlacementSchema.nullable(),
  bounds: DerivedRectSchema.nullable(),
  pins: z.array(AgentSnapshotPinSchema),
  mosBulk: z
    .strictObject({
      status: z.enum([
        "explicit",
        "cell-default",
        "instance-override",
        "supply-default",
        "no-connect",
        "unresolved",
      ]),
      netId: StableIdSchema.nullable(),
    })
    .optional(),
  sourceRef: SourceSpanSchema.optional(),
  netlist: AgentNetlistFactsSchema.optional(),
});

export const AgentSnapshotNetSchema = z.strictObject({
  id: AgentSnapshotLogicalNetIdSchema,
  name: z.string().min(1).nullable(),
  scope: z.enum(["local", "global"]),
  powerDomain: NetPowerDomainSchema,
  terminals: z.array(
    z.strictObject({
      instanceId: StableIdSchema,
      pinName: z.string().min(1),
    }),
  ),
  routeIds: z.array(StableIdSchema),
  junctionIds: z.array(StableIdSchema),
});

export const AgentSnapshotRouteSchema = z.strictObject({
  id: StableIdSchema,
  netId: AgentSnapshotLogicalNetIdSchema,
  start: RouteEndpointSchema,
  legs: z.array(RouteLegSchema).min(1),
  presentation: RoutePresentationSchema.optional(),
  polyline: z.array(DerivedPointSchema).min(2).nullable(),
});

export const AgentSnapshotJunctionSchema = z.strictObject({
  id: StableIdSchema,
  netId: AgentSnapshotLogicalNetIdSchema,
  position: PointSchema,
  role: JunctionRoleSchema.optional(),
});

export const AgentSnapshotNoConnectSchema = NoConnectSchema;

export const AgentSnapshotDocumentSchema = z.strictObject({
  netlist: CellNetlistInterfaceSchema.optional(),
  mosBulkDefaults: MosBulkDefaultsSchema.optional(),
  id: StableIdSchema,
  name: z.string().min(1),
  revision: z.number().int().nonnegative(),
  sourceStatus: z.enum([
    "in-sync",
    "geometry-only-changed",
    "connectivity-modified",
  ]),
  sourceBinding: z
    .strictObject({
      cellName: z.string().min(1),
      sourceRef: SourceSpanSchema.optional(),
    })
    .optional(),
  bounds: DerivedRectSchema.nullable(),
  presentation: PresentationIntentSchema,
  cellInterface: z
    .strictObject({
      name: z.string().min(1),
      terminals: z.array(
        z.strictObject({
          id: StableIdSchema,
          name: z.string().min(1),
          netId: StableIdSchema,
          direction: z.enum(["input", "output", "inout", "passive"]),
          interfaceInstanceIds: z.array(StableIdSchema).length(1),
        }),
      ),
    })
    .nullable(),
  instances: z.array(AgentSnapshotInstanceSchema),
  nets: z.array(AgentSnapshotNetSchema),
  routes: z.array(AgentSnapshotRouteSchema),
  junctions: z.array(AgentSnapshotJunctionSchema),
  noConnects: z.array(AgentSnapshotNoConnectSchema),
  annotations: z.array(AnnotationSchema),
  // ADR 0010 WP-R4: each drafting object carries its canonical shape plus the
  // derived resolved geometry (position(s)/bounds/diagnostics) computed from
  // the single resolveDraftingObjectGeometry entry.
  drafting: z.strictObject({
    objects: z.array(
      z.strictObject({
        object: DraftingObjectSchema,
        // P1: strict typed contract — no z.unknown. The derived geometry and
        // its diagnostics are validated by the shared model schemas; the entry
        // carries only resolvedGeometry (which includes bounds), not a
        // duplicate top-level bounds.
        resolvedGeometry: ResolvedDraftingGeometrySchema,
        diagnostics: z.array(DraftingDiagnosticSchema),
      }),
    ),
  }),
  layoutGroups: z.array(LayoutGroupSchema),
  constraints: z.array(LayoutConstraintSchema),
  diagnostics: z.array(AgentDiagnosticSchema),
});

export const AgentProjectIndexDocumentSchema = z.strictObject({
  id: StableIdSchema,
  name: z.string().min(1),
  instanceCount: z.number().int().nonnegative(),
  netCount: z.number().int().nonnegative(),
  references: z.array(
    z.strictObject({
      instanceId: StableIdSchema,
      targetName: z.string().min(1),
      targetDocumentId: StableIdSchema.nullable(),
    }),
  ),
});

export const AgentSessionSnapshotSchema = z.strictObject({
  snapshotVersion: z.literal(AGENT_SNAPSHOT_VERSION),
  electricalTopologyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  byteLength: z.number().int().nonnegative(),
  project: z.strictObject({
    externalSubcircuitDefinitions: z
      .array(ExternalSubcircuitDefinitionSchema)
      .optional(),
    id: StableIdSchema,
    name: z.string().min(1),
    structureRevision: z.number().int().nonnegative(),
    topDocumentId: StableIdSchema,
    documents: z.array(AgentProjectIndexDocumentSchema).min(1),
    /**
     * The Project's saved simulation intent, exactly as persisted, or null
     * when none is configured. An Agent reads what a human set up here rather
     * than guessing a Testbench root, and the Simulation Resource runs this
     * same setup when a `run` carries no inline one. It is the setup, never a
     * result: results, run ids, and prepared decks are transient by contract
     * (`docs/specs/simulation.md`, "Persistence and compatibility").
     */
    simulation: SimulationSetupSchema.nullable(),
  }),
  document: AgentSnapshotDocumentSchema,
});

const ResponseBaseSchema = z.strictObject({
  apiVersion: AgentApiVersionSchema,
  requestId: StableIdSchema,
});
export const AgentCapabilitiesResponseSchema = ResponseBaseSchema.extend({
  operation: z.literal("capabilities"),
  ok: z.literal(true),
  capabilities: z.strictObject({
    apiVersions: z.tuple([z.literal(AGENT_API_VERSION)]),
    snapshotVersions: z.tuple([z.literal(AGENT_SNAPSHOT_VERSION)]),
    operations: z.tuple([
      z.literal("capabilities"),
      z.literal("snapshot"),
      z.literal("transact"),
      z.literal("render"),
    ]),
    editKinds: z.array(z.string().min(1)),
    commandKinds: z.array(z.string()).optional(),
    transactionForms: z.array(z.string()).optional(),
    permissions: AgentPermissionsSchema,
    limits: AgentLimitsSchema,
    resources: z
      .strictObject({
        file: AgentFileResourceCapabilitySchema,
        simulation: AgentSimulationResourceCapabilitySchema.optional(),
      })
      .optional(),
  }),
});
const TraceNetRefSchema = z.strictObject({
  documentId: StableIdSchema,
  netId: StableIdSchema,
  hierarchyPath: z.array(HierarchyFrameSchema),
});
const TraceInterfaceSchema = z.strictObject({
  parentDocumentId: StableIdSchema,
  instanceId: StableIdSchema,
  parentPinName: z.string(),
  childDocumentId: StableIdSchema,
  childTerminalName: z.string(),
  childNetId: StableIdSchema,
});
export const AgentNetTraceSchema = z.strictObject({
  highlights: z.array(
    TraceNetRefSchema.extend({
      routes: z.array(StableIdSchema),
      junctions: z.array(StableIdSchema),
      visibleEndpoints: z.array(RouteEndpointSchema),
    }),
  ),
  hops: z.array(
    z.union([
      z.strictObject({
        direction: z.enum(["up", "down"]),
        from: TraceNetRefSchema,
        to: TraceNetRefSchema,
        frame: TraceInterfaceSchema,
      }),
      z.strictObject({
        direction: z.literal("global"),
        from: TraceNetRefSchema,
        to: TraceNetRefSchema,
        foldedName: z.string(),
      }),
    ]),
  ),
});
export const AgentSnapshotResponseSchema = ResponseBaseSchema.extend({
  apiVersion: z.literal(AGENT_API_VERSION),
  operation: z.literal("snapshot"),
  ok: z.literal(true),
  revision: z.number().int().nonnegative(),
  snapshot: AgentSessionSnapshotSchema,
  diagnostics: z.array(AgentDiagnosticSchema),
  trace: AgentNetTraceSchema.nullable().optional(),
});

export const AgentSemanticIntentResultSchema = z.strictObject({
  kind: z.enum([
    "activate-document",
    "select",
    "highlight-net",
    "fit-document",
    "clear-focus",
  ]),
  documentId: StableIdSchema,
  objectIds: z.array(StableIdSchema),
  netId: StableIdSchema.optional(),
});
export const AgentTransactSuccessResponseSchema = ResponseBaseSchema.extend({
  operation: z.literal("transact"),
  ok: z.literal(true),
  applied: z.boolean(),
  revision: z.number().int().nonnegative(),
  proposedRevision: z.number().int().nonnegative(),
  diff: AgentDiffSchema,
  diagnostics: z.array(AgentDiagnosticSchema),
  diagnosticDelta: z
    .strictObject({
      added: z.array(AgentDiagnosticSchema),
      removed: z.array(AgentDiagnosticSchema),
    })
    .optional(),
  resolvedRoutes: z
    .array(
      z.strictObject({
        routeId: StableIdSchema,
        polyline: z.array(DerivedPointSchema).min(2),
      }),
    )
    .optional(),
  /** Present only for a successful non-persisting semantic transaction. */
  semantic: AgentSemanticIntentResultSchema.optional(),
  projectStructure: z
    .strictObject({
      fromRevision: z.number().int().nonnegative(),
      toRevision: z.number().int().nonnegative(),
      changedDocumentIds: z.array(StableIdSchema),
      documentIds: z.array(StableIdSchema).optional(),
      topDocumentId: StableIdSchema.optional(),
    })
    .optional(),
});
export const AgentRenderResponseSchema = ResponseBaseSchema.extend({
  operation: z.literal("render"),
  ok: z.literal(true),
  revision: z.number().int().nonnegative(),
  artifact: z.strictObject({
    mediaType: z.literal("image/svg+xml"),
    encoding: z.literal("base64"),
    data: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    byteLength: z.number().int().nonnegative(),
    mode: z.enum(["formal", "diagnostics"]),
  }),
  diagnostics: z.array(AgentDiagnosticSchema),
});
export const AgentErrorResponseSchema = ResponseBaseSchema.extend({
  operation: z.enum(["error", "snapshot", "transact", "render"]),
  ok: z.literal(false),
  revision: z.number().int().nonnegative().optional(),
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string(),
  }),
  diagnostics: z.array(AgentDiagnosticSchema),
});

export const AgentProductionCircuitResponseSchema = z.union([
  AgentCapabilitiesResponseSchema,
  AgentSnapshotResponseSchema,
  AgentTransactSuccessResponseSchema,
  AgentRenderResponseSchema,
  AgentErrorResponseSchema,
]);
export const AgentCircuitResponseSchema = AgentProductionCircuitResponseSchema;
export const AgentCircuitRequestJsonSchema = z.toJSONSchema(
  AgentProductionCircuitRequestSchema,
  { target: "draft-2020-12", reused: "ref" },
);
export const AgentCircuitResponseJsonSchema = z.toJSONSchema(
  AgentProductionCircuitResponseSchema,
  { target: "draft-2020-12", reused: "ref" },
);

export type AgentPermissions = z.infer<typeof AgentPermissionsSchema>;
export type AgentLimits = z.infer<typeof AgentLimitsSchema>;
export type AgentCircuitRequest = z.infer<
  typeof AgentProductionCircuitRequestSchema
>;
export type AgentProductionCircuitRequest = z.infer<
  typeof AgentProductionCircuitRequestSchema
>;
export type AgentCapabilitiesRequest = z.infer<
  typeof AgentCapabilitiesRequestSchema
>;
export type AgentSnapshotRequest = z.infer<typeof AgentSnapshotRequestSchema>;
export type AgentTransactRequest = z.infer<typeof AgentTransactRequestSchema>;
export type AgentSemanticIntent = z.infer<typeof AgentSemanticIntentSchema>;
export type AgentObjectLocator = z.infer<typeof AgentObjectLocatorSchema>;
export type AgentRenderRequest = z.infer<typeof AgentRenderRequestSchema>;
export type AgentCircuitResponse = z.infer<typeof AgentCircuitResponseSchema>;
export type AgentProductionCircuitResponse = z.infer<
  typeof AgentProductionCircuitResponseSchema
>;
export type AgentDiagnostic = z.infer<typeof AgentDiagnosticSchema>;
export type AgentDiff = z.infer<typeof AgentDiffSchema>;
export type AgentSessionSnapshot = z.infer<typeof AgentSessionSnapshotSchema>;
export type AgentSnapshotDocument = z.infer<typeof AgentSnapshotDocumentSchema>;
export type AgentFileResourceCapability = z.infer<
  typeof AgentFileResourceCapabilitySchema
>;
export type AgentSimulationResourceCapability = z.infer<
  typeof AgentSimulationResourceCapabilitySchema
>;
