import { z } from "zod";
import {
  PointSchema,
  StableIdSchema,
  RichTextDocumentSchema,
  PlacementSchema,
  InstanceSchema,
} from "@icm/model";

/** Small server-planned conveniences; results still commit as existing edits. */
export const AgentPinAnchorSchema = z
  .strictObject({
    pinName: z.string().min(1),
    position: PointSchema,
  })
  .describe(
    "Exact routing grid landing, not artwork contact. Unreachable positions are rejected with the nearest reachable landing.",
  );
const OptionalPinAnchorSchema = AgentPinAnchorSchema.optional().describe(
  "When supplied, solves the origin instead of using placement.position; keeps orientation.",
);
// Reuse schema identities so the full HTTP contract emits one definition per
// shared field shape; runtime constraints are unchanged.
const NameSchema = z.string().min(1).max(128);
const SelectedIdsSchema = z.array(StableIdSchema).max(256).default([]);
const NonemptyIdsSchema = z.array(StableIdSchema).min(1).max(256);
const SelectionSchema = z.strictObject({
  instanceIds: SelectedIdsSchema,
  routeIds: SelectedIdsSchema,
  junctionIds: SelectedIdsSchema,
  annotationIds: SelectedIdsSchema,
  draftingIds: SelectedIdsSchema,
});
const BatchItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("set-port-direction"),
    target: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("terminal"), id: StableIdSchema }),
      z.strictObject({ kind: z.literal("port"), id: StableIdSchema }),
      z.strictObject({ kind: z.literal("port-name"), name: z.string().min(1) }),
    ]),
    direction: z.enum(["input", "output", "inout", "passive"]),
  }),
  z.strictObject({
    kind: z.literal("set-vdd-mode"),
    instanceId: StableIdSchema,
    mode: z.enum(["cell-pin", "global"]),
  }),
  z.strictObject({
    kind: z.literal("remove-cell-terminal"),
    terminalId: StableIdSchema,
  }),
  z.strictObject({
    kind: z.literal("set-instance-display"),
    instanceIds: z.array(StableIdSchema).min(1).max(64),
    showReference: z.boolean().optional(),
    showValue: z.boolean().optional(),
    showParameters: z
      .strictObject({
        k: z.boolean().optional(),
        lp: z.boolean().optional(),
        ls: z.boolean().optional(),
        l1: z.boolean().optional(),
        l2: z.boolean().optional(),
        cb: z.boolean().optional(),
      })
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("set-net-label"),
    annotationId: StableIdSchema,
    netId: StableIdSchema,
    text: RichTextDocumentSchema,
    position: PointSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("set-model"),
    instanceId: StableIdSchema,
    model: z.string().max(128),
  }),
  z
    .strictObject({
      kind: z.literal("move-annotation"),
      annotationId: StableIdSchema,
      position: PointSchema,
    })
    .describe(
      "Absolute drawing position; preserve electrical binding and object ownership.",
    ),
]);
export function isBatchableAuthoringCommand(command: {
  kind: string;
}): command is z.infer<typeof BatchItemSchema> {
  return BatchItemSchema.options.some(
    (option) => option.shape.kind.value === command.kind,
  );
}
export const AgentAuthoringCommandSchema = z.discriminatedUnion("kind", [
  ...BatchItemSchema.options,
  z.strictObject({
    kind: z.literal("route-net"),
    target: z
      .discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("net"), net: z.string().min(1) }),
        z.strictObject({
          kind: z.literal("member"),
          instanceId: StableIdSchema,
          pinName: z.string().min(1),
        }),
        z.strictObject({
          kind: z.literal("pins"),
          pins: z
            .array(
              z.strictObject({
                instanceId: StableIdSchema,
                pinName: z.string().min(1),
              }),
            )
            .min(2)
            .max(64),
        }),
        z.strictObject({
          kind: z.literal("import-net"),
          sourceNetId: StableIdSchema,
        }),
      ])
      .describe(
        "Current Net ID/name, member pin, explicit pins to join, or an original import-reference Net. Routes only missing visible connections.",
      ),
    trunk: z
      .strictObject({ start: PointSchema, end: PointSchema })
      .optional()
      .describe(
        "Straight horizontal/vertical trunk; otherwise use MST guidance. Atomic, not an obstacle autorouter.",
      ),
  }),
  z
    .strictObject({
      kind: z.literal("delete-selection"),
      selection: SelectionSchema,
    })
    .describe(
      "Explicit selection. Includes owned displays and formal interface declarations; unselected wires remain dangling, as in the GUI. Select all object IDs for complete Cell deletion.",
    ),
  z.strictObject({
    kind: z.literal("batch"),
    commands: z
      .array(BatchItemSchema)
      .min(1)
      .max(64)
      .describe(
        "Ordered atomic label, model, display, annotation move, direction, VDD mode or terminal removal commands; one undo, no partial commit.",
      ),
  }),
  z.strictObject({
    kind: z.literal("place-components"),
    instances: z.array(InstanceSchema).min(1).max(64),
    pinAnchors: z
      .record(StableIdSchema, AgentPinAnchorSchema)
      .optional()
      .describe(
        "By new Instance ID. Solves placement.position from this pin; preserves rotation/mirror. No implicit connection.",
      ),
    terminalDirections: z
      .record(StableIdSchema, z.enum(["input", "output", "inout", "passive"]))
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("add-power-rail"),
    start: PointSchema,
    end: PointSchema,
    netId: StableIdSchema.optional(),
    name: NameSchema.optional(),
    scope: z
      .enum(["local", "global"])
      .optional()
      .describe(
        "Defaults to the existing Net scope, otherwise local; global must be intentional.",
      ),
  }),
  z.strictObject({
    kind: z.literal("place-cell"),
    childDocumentId: StableIdSchema,
    instanceId: StableIdSchema,
    reference: NameSchema.optional(),
    placement: PlacementSchema,
    pinAnchor: OptionalPinAnchorSchema,
  }),
  z.strictObject({
    kind: z.literal("place-existing"),
    instanceId: StableIdSchema,
    placement: PlacementSchema,
    pinAnchor: OptionalPinAnchorSchema,
  }),
  z.strictObject({
    kind: z.literal("transform"),
    selection: SelectionSchema,
    transform: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("translate"), delta: PointSchema }),
      z.strictObject({
        kind: z.literal("rotate"),
        degrees: z.union([
          z.literal(45),
          z.literal(90),
          z.literal(135),
          z.literal(180),
          z.literal(225),
          z.literal(270),
          z.literal(315),
        ]),
        center: PointSchema.optional(),
      }),
      z.strictObject({
        kind: z.literal("mirror"),
        axis: z.enum(["x", "y"]),
        center: PointSchema.optional(),
      }),
    ]),
  }),
  z.strictObject({
    kind: z.literal("copy"),
    selection: SelectionSchema,
    offset: PointSchema,
  }),
  z.strictObject({
    kind: z.literal("align"),
    selection: SelectionSchema,
    mode: z.enum(["left", "right", "top", "bottom", "center-x", "center-y"]),
  }),
  z.strictObject({
    kind: z.literal("detach-move"),
    instanceIds: NonemptyIdsSchema,
    delta: PointSchema,
  }),
  z.strictObject({
    kind: z.literal("unplace"),
    instanceIds: NonemptyIdsSchema,
  }),
  z.strictObject({
    kind: z.literal("reset-cell"),
    mode: z.enum(["clear-drawing", "reset-placement", "reset-body"]),
  }),
  z.strictObject({
    kind: z.literal("create-cell"),
    id: StableIdSchema,
    name: NameSchema,
  }),
  z.strictObject({
    kind: z.literal("rename-cell"),
    id: StableIdSchema,
    name: NameSchema,
  }),
  z.strictObject({ kind: z.literal("delete-cell"), id: StableIdSchema }),
  z.strictObject({
    kind: z.literal("bind-cell-parameter"),
    instanceId: StableIdSchema,
    field: NameSchema,
    name: NameSchema,
    defaultValue: z.string().min(1).max(1024).optional(),
  }),
  z.strictObject({
    kind: z.literal("rename-cell-parameter"),
    oldName: NameSchema,
    newName: NameSchema,
  }),
  z.strictObject({
    kind: z.literal("set-cell-parameter-default"),
    name: NameSchema,
    defaultValue: z.string().min(1).max(1024),
  }),
  z.strictObject({
    kind: z.literal("remove-cell-parameter"),
    name: NameSchema,
  }),
  z.strictObject({
    kind: z.literal("rename-cell-terminal"),
    terminalId: StableIdSchema,
    name: NameSchema,
    mergeExistingPort: z.boolean().optional(),
  }),
]);
export type AgentAuthoringCommand = z.infer<typeof AgentAuthoringCommandSchema>;
