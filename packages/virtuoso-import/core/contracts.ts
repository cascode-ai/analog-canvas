import { z } from "zod";

export const Point = z.tuple([z.number().finite(), z.number().finite()]);
const Parameter = z.strictObject({
  name: z.string().min(1),
  type: z.string().nullable(),
  value: z.json(),
});
const Pin = z.looseObject({
  worldCenter: Point,
  localCenter: Point.optional(),
  instanceId: z.string().nullable().optional(),
});
const Terminal = z.looseObject({
  name: z.string().min(1),
  netId: z.string().nullable(),
  pins: z.array(Pin),
});
export const SnapshotSchema = z.looseObject({
  format: z.literal("analog-agent.schematic"),
  schemaVersion: z.literal(1),
  source: z.looseObject({
    library: z.string(),
    cell: z.string(),
    view: z.string(),
  }),
  coordinates: z.looseObject({ yAxis: z.literal("up") }),
  instances: z.array(
    z.looseObject({
      id: z.string().min(1),
      name: z.string().min(1),
      library: z.string().min(1),
      cell: z.string().min(1),
      view: z.string().min(1),
      symbolId: z.string(),
      position: Point,
      properties: z.array(Parameter),
      effectiveCdfParameters: z.array(Parameter),
      terminals: z.array(Terminal),
      simulationInfo: z
        .looseObject({
          status: z.enum(["available", "unavailable"]),
          simulators: z.array(
            z.looseObject({
              name: z.string(),
              termOrder: z.union([z.array(z.string()), z.string(), z.null()]),
              componentName: z.string().nullable(),
              modelName: z.string().nullable(),
            }),
          ),
        })
        .optional(),
    }),
  ),
  symbols: z.array(
    z.looseObject({
      id: z.string(),
      terminals: z.array(
        z.looseObject({ name: z.string(), pins: z.array(Pin) }),
      ),
    }),
  ),
  nets: z.array(
    z.looseObject({
      id: z.string().min(1),
      name: z.string().min(1),
      isGlobal: z.boolean(),
      terminals: z.array(
        z.strictObject({ instanceId: z.string(), pinName: z.string() }),
      ),
    }),
  ),
  terminals: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      netId: z.string(),
      pins: z.array(Pin),
    }),
  ),
  shapes: z.array(
    z.looseObject({
      id: z.string(),
      netId: z.string().nullable(),
      type: z.string(),
      attachedWireId: z.string().min(1).nullable().optional(),
    }),
  ),
  warnings: z.array(z.string()),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
export const MasterSchema = z.strictObject({
  library: z.string().min(1),
  cell: z.string().min(1),
  view: z.string().min(1),
});
export type Master = z.infer<typeof MasterSchema>;
const StringMap = z.record(z.string().min(1), z.string().min(1));
export const MappingSchema = z.strictObject({
  symbol: z.string().min(1),
  pins: StringMap,
  parameters: StringMap,
});
export type Mapping = z.infer<typeof MappingSchema>;
const DiagnosticSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  objectId: z.string().optional(),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
export const InventoryItemSchema = z.strictObject({
  id: z.string(),
  master: MasterSchema,
  signature: z.string(),
  pinNames: z.array(z.string()),
  parameterNames: z.array(z.string()),
  componentNames: z.array(z.string()),
  modelNames: z.array(z.string()),
  termOrders: z.array(
    z.strictObject({ simulator: z.string(), pins: z.array(z.string()) }),
  ),
  instances: z.array(
    z.strictObject({
      id: z.string(),
      parameters: z.array(Parameter),
      symbolId: z.string(),
      pinNames: z.array(z.string()).optional(),
      view: z.string().optional(),
    }),
  ),
  evidenceStatus: z.enum(["available", "unavailable"]),
  warnings: z.array(DiagnosticSchema),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;
export const InventorySchema = z.strictObject({
  format: z.literal("virtuoso-canvas.inventory"),
  version: z.literal(1),
  snapshotDigest: z.string(),
  source: MasterSchema,
  items: z.array(InventoryItemSchema),
  warnings: z.array(DiagnosticSchema),
});
export type Inventory = z.infer<typeof InventorySchema>;
export const PackageEntrySchema = z.strictObject({
  master: MasterSchema,
  signature: z.string(),
  mapping: MappingSchema,
  evidence: z.strictObject({
    pinNames: z.array(z.string()),
    parameterNames: z.array(z.string()),
    componentNames: z.array(z.string()),
    modelNames: z.array(z.string()),
    termOrders: z.array(
      z.strictObject({ simulator: z.string(), pins: z.array(z.string()) }),
    ),
    evidenceStatus: z.enum(["available", "unavailable"]),
  }),
  reviewedBy: z.string().min(1),
  reviewedAt: z.string().datetime(),
});
export type PackageEntry = z.infer<typeof PackageEntrySchema>;
export const MappingPackageSchema = z.strictObject({
  format: z.literal("virtuoso-canvas.mapping-package"),
  version: z.literal(1),
  name: z.string().min(1),
  entries: z.array(PackageEntrySchema),
});
export type MappingPackage = z.infer<typeof MappingPackageSchema>;
export const BuiltinRulesSchema = z.strictObject({
  version: z.literal(1),
  rules: z.array(
    z.strictObject({
      id: z.string(),
      master: MasterSchema,
      mapping: MappingSchema,
    }),
  ),
});
export type BuiltinRules = z.infer<typeof BuiltinRulesSchema>;
export const CandidateSchema = z.strictObject({
  id: z.string(),
  mapping: MappingSchema,
  origin: z.enum(["personal", "builtin", "heuristic"]),
  confidence: z.enum(["reviewed", "exact-rule", "structural-hint"]),
  reasons: z.array(z.string()),
});
export const ProposalSchema = z.strictObject({
  format: z.literal("virtuoso-canvas.mapping-proposal"),
  version: z.literal(1),
  id: z.string(),
  inventory: InventorySchema,
  items: z.array(
    z.strictObject({
      itemId: z.string(),
      status: z.enum(["confirmed", "needs-review", "unknown"]),
      candidates: z.array(CandidateSchema),
      warnings: z.array(DiagnosticSchema),
    }),
  ),
});
export type Proposal = z.infer<typeof ProposalSchema>;
export const DecisionsSchema = z.strictObject({
  format: z.literal("virtuoso-canvas.mapping-decisions"),
  version: z.literal(1),
  proposalId: z.string(),
  reviewedBy: z.string().min(1),
  decisions: z.array(
    z.strictObject({
      itemId: z.string(),
      action: z.enum(["approve", "reject", "pending"]),
      candidateId: z.string().optional(),
      mapping: MappingSchema.optional(),
    }),
  ),
});
export type Decisions = z.infer<typeof DecisionsSchema>;
export interface SymbolSpec {
  id: string;
  pins: string[];
  parameters: string[];
  deviceClass?: string;
}
export type Catalog = readonly SymbolSpec[];
export interface OperationOptions {
  signal?: AbortSignal;
  onProgress?: (event: {
    stage: string;
    completed: number;
    total: number;
  }) => void;
}
export class BackendError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: unknown = null,
  ) {
    super(message);
    this.name = "BackendError";
  }
}
export { z };
