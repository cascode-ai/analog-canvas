import { z } from "zod";

import {
  HexColorSchema,
  MirrorSchema,
  PointSchema,
  RotationSchema,
  StableIdSchema,
} from "./common.js";
import { SourceSpanSchema } from "./source.js";

/**
 * Optional per-instance visual style override. When absent, the instance
 * renders with the document style profile defaults — preserving the exact
 * appearance of pre-existing projects. Each field is independently optional
 * so an editor can set each color independently.
 *
 * - `foreground`: replaces the profile foreground for this instance's
 *   symbol strokes (lines, polylines, paths, polygon strokes, circle
 *   strokes) and explicit foreground fills.
 * - `background`: paints an opaque fill rectangle behind the instance's
 *   symbol artwork. The symbol's own strokes remain visible on top.
 */
export const InstanceStyleOverrideSchema = z.strictObject({
  foreground: HexColorSchema.optional(),
  background: HexColorSchema.optional(),
});
/**
 * Optional schematic-only Signal Flow formula metadata. These parameters are
 * independent from netlist/SPICE parameters and do not affect electrical
 * connectivity or emitted device bindings.
 */
export const SignalFlowParametersSchema = z.strictObject({
  formula: z.string().min(1).max(256).optional(),
  coefficient: z.string().min(1).max(64).optional(),
  /** User-authored minimum frame size; automatic content fit may exceed it. */
  bodyWidth: z.number().int().min(20).max(1000).multipleOf(10).optional(),
  bodyHeight: z.number().int().min(20).max(500).multipleOf(10).optional(),
});
export const TerminalRefSchema = z.strictObject({
  instanceId: StableIdSchema,
  pinName: z.string().min(1),
});
export const PlacementSchema = z.strictObject({
  position: PointSchema,
  rotation: RotationSchema,
  mirror: MirrorSchema,
});
export const NetlistIdentifierSchema = z.string().min(1).max(128);
export const NetlistParameterNameSchema = NetlistIdentifierSchema;
export const NetlistParameterValueSchema = z.string().min(1).max(1024);
export const NetlistDeviceClassSchema = z.enum([
  "resistor",
  "capacitor",
  "inductor",
  "mos",
  "diode",
  "bjt",
  "voltage-source",
  "current-source",
  // The switch family, designated `S`. A binding of this class emits the SPICE
  // form `S<ref> n+ n- nc+ nc- MODEL` — two switched nodes, two control nodes,
  // and a required model card — so only the voltage-controlled switch reaches
  // emission. The two-terminal switches carry the class and the `S` sequence
  // for the schematic's sake and declare no netlist target.
  "switch",
  "net-marker",
]);
export const InstanceNetlistBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("primitive"),
    deviceClass: NetlistDeviceClassSchema,
  }),
  z.strictObject({
    kind: z.literal("model"),
    deviceClass: NetlistDeviceClassSchema,
    name: NetlistIdentifierSchema,
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
    name: NetlistIdentifierSchema,
  }),
]);
/**
 * A source-order to Symbol-pin mapping. Electrical Net membership still owns
 * connectivity; this preserves the order an imported structural source used
 * without smuggling it through editable `properties` keys.
 */
export const InstanceTerminalMappingSchema = z.strictObject({
  sourcePosition: z.number().int().nonnegative(),
  pinName: z.string().min(1).max(128),
});
export const InstanceNetlistDataSchema = z.strictObject({
  binding: InstanceNetlistBindingSchema.optional(),
  parameters: z
    .record(NetlistParameterNameSchema, NetlistParameterValueSchema)
    .refine((parameters) => Object.keys(parameters).length <= 128, {
      message: "An instance may contain at most 128 netlist parameters",
    }),
});
/**
 * Bounded source evidence that explains imported facts but cannot become a
 * second electrical/netlist authority. It is not part of normal editable
 * properties and no runtime consumer may derive connectivity or hierarchy from
 * `sourceTarget` or mapping metadata.
 */
export const InstanceImportProvenanceSchema = z.strictObject({
  kind: z.enum(["primitive", "model", "subcircuit", "opaque"]),
  /** Source spelling of the bound master; evidence, never Instance identity. */
  sourceMasterName: z.string().min(1),
  sourceTarget: z.string().min(1).max(1024),
  // External source evidence can preserve a target spelling whose resolution
  // status is unavailable; current importers write status when it is known.
  status: z.enum(["resolved", "missing", "unsupported"]).optional(),
  modelType: z.string().min(1).optional(),
  symbolMappingRegistryId: z.string().min(1).max(128).optional(),
  terminalMapping: z.array(InstanceTerminalMappingSchema).max(128).optional(),
});
export const MosBulkBindingSchema = z.strictObject({
  origin: z.enum(["cell-default", "instance-override", "supply-default"]),
  netId: StableIdSchema,
});
export const InstanceSchema = z
  .strictObject({
    id: StableIdSchema,
    symbolId: StableIdSchema,
    symbolVariantId: StableIdSchema.optional(),
    sourceRef: SourceSpanSchema.optional(),
    importProvenance: InstanceImportProvenanceSchema.optional(),
    // Present only for an editor-materialized implicit body connection.
    // Cross-Document composition converts a source Cell policy into an
    // instance-override so the copied body does not inherit target defaults.
    // Explicit SPICE/user B connections need no parallel metadata.
    mosBulkBinding: MosBulkBindingSchema.optional(),
    placement: PlacementSchema.nullable(),
    /**
     * The sole authored Instance reference. It is the ordinary canvas
     * designator and, for an emitting Instance, the emitted SPICE/Spectre
     * reference. It is never an object identity or a master/model name.
     */
    reference: NetlistIdentifierSchema.optional(),
    netlist: InstanceNetlistDataSchema.optional(),
    /**
     * Optional per-instance color override. When absent, the instance renders
     * with document profile defaults (backward compatible). `foreground`
     * replaces stroke/line color; `background` paints a fill behind the
     * symbol artwork without hiding strokes.
     */
    styleOverride: InstanceStyleOverrideSchema.optional(),
    /**
     * Optional schematic-only Signal Flow metadata. It is presentation/dataflow
     * intent only and is intentionally independent from emitted netlist
     * parameters.
     */
    signalFlowParameters: SignalFlowParametersSchema.optional(),
  })
  .superRefine((instance, context) => {
    if (instance.netlist && !instance.reference) {
      context.addIssue({
        code: "custom",
        path: ["reference"],
        message: "An emitting Instance requires one authored reference",
      });
    }
    const terminals = instance.importProvenance?.terminalMapping;
    if (!terminals) return;
    const positions = new Set<number>();
    const pinNames = new Set<string>();
    for (const [index, terminal] of terminals.entries()) {
      if (positions.has(terminal.sourcePosition)) {
        context.addIssue({
          code: "custom",
          path: [
            "importProvenance",
            "terminalMapping",
            index,
            "sourcePosition",
          ],
          message: "Imported terminal source positions must be unique",
        });
      }
      positions.add(terminal.sourcePosition);
      if (pinNames.has(terminal.pinName)) {
        context.addIssue({
          code: "custom",
          path: ["importProvenance", "terminalMapping", index, "pinName"],
          message: "Imported terminal pin names must be unique",
        });
      }
      pinNames.add(terminal.pinName);
    }
  });
/**
 * Persisted electrical supply identity. `conflict` is diagnostic state only;
 * new authoring may choose vdd, ground, or none but never create a
 * short intentionally.
 */
