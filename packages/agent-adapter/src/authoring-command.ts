import { z } from "zod";
import {
  PointSchema,
  StableIdSchema,
  RichTextDocumentSchema,
  PlacementSchema,
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
        degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]),
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
]);
export type AgentAuthoringCommand = z.infer<typeof AgentAuthoringCommandSchema>;
