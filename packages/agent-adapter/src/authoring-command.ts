import { z } from "zod";
import {
  PointSchema,
  StableIdSchema,
  RichTextDocumentSchema,
  PlacementSchema,
  InstanceSchema,
} from "@icm/model";

/** Small server-planned conveniences; results still commit as existing edits. */
const SelectionSchema = z.strictObject({
  instanceIds: z.array(StableIdSchema).max(256).default([]),
  routeIds: z.array(StableIdSchema).max(256).default([]),
  junctionIds: z.array(StableIdSchema).max(256).default([]),
  annotationIds: z.array(StableIdSchema).max(256).default([]),
  draftingIds: z.array(StableIdSchema).max(256).default([]),
});
export const AgentAuthoringCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("place-components"),
    instances: z.array(InstanceSchema).min(1).max(64),
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
    kind: z.literal("place-cell"),
    childDocumentId: StableIdSchema,
    instanceId: StableIdSchema,
    reference: z.string().min(1).max(128).optional(),
    placement: PlacementSchema,
  }),
  z.strictObject({
    kind: z.literal("place-existing"),
    instanceId: StableIdSchema,
    placement: PlacementSchema,
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
    instanceIds: z.array(StableIdSchema).min(1).max(256),
    delta: PointSchema,
  }),
  z.strictObject({
    kind: z.literal("unplace"),
    instanceIds: z.array(StableIdSchema).min(1).max(256),
  }),
  z.strictObject({
    kind: z.literal("reset-cell"),
    mode: z.enum(["clear-drawing", "reset-placement", "reset-body"]),
  }),
  z.strictObject({
    kind: z.literal("create-cell"),
    id: StableIdSchema,
    name: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("rename-cell"),
    id: StableIdSchema,
    name: z.string().min(1).max(128),
  }),
  z.strictObject({ kind: z.literal("delete-cell"), id: StableIdSchema }),
  z.strictObject({
    kind: z.literal("bind-cell-parameter"),
    instanceId: StableIdSchema,
    field: z.string().min(1).max(128),
    name: z.string().min(1).max(128),
    defaultValue: z.string().min(1).max(1024).optional(),
  }),
  z.strictObject({
    kind: z.literal("rename-cell-parameter"),
    oldName: z.string().min(1).max(128),
    newName: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("set-cell-parameter-default"),
    name: z.string().min(1).max(128),
    defaultValue: z.string().min(1).max(1024),
  }),
  z.strictObject({
    kind: z.literal("remove-cell-parameter"),
    name: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("rename-cell-terminal"),
    terminalId: StableIdSchema,
    name: z.string().min(1).max(128),
    mergeExistingPort: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("remove-cell-terminal"),
    terminalId: StableIdSchema,
  }),
]);
export type AgentAuthoringCommand = z.infer<typeof AgentAuthoringCommandSchema>;
