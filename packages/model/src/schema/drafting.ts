import { z } from "zod";

import {
  OrientationSchema,
  PointSchema,
  RotationSchema,
  StableIdSchema,
} from "./common.js";
import { VisualAnchorSchema } from "./annotations.js";
import { RichTextDocumentSchema } from "./rich-text.js";

const DraftingObjectBaseSchema = z.strictObject({
  id: StableIdSchema,
  locked: z.boolean(),
  zIndex: z.number().int().nonnegative(),
  anchor: VisualAnchorSchema,
  styleOverride: z
    .strictObject({
      sizeScale: z.number().finite().positive().optional(),
      weight: z.enum(["normal", "bold"]).optional(),
      italic: z.boolean().optional(),
      lineStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
      arrowHead: z.enum(["none", "filled", "open"]).optional(),
      /** Free multiplier over the profile's annotation stroke (schema 27
       * widened the previous four-step ladder); document-level
       * annotationStrokeScale composes multiplicatively on top. */
      strokeScale: z.number().finite().min(0.25).max(4).optional(),
      /** Explicit stroke color; absent means the profile foreground. */
      color: z
        .string()
        .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u)
        .optional(),
      arrowHeadScale: z
        .union([z.literal(0.75), z.literal(1), z.literal(1.25), z.literal(1.5)])
        .optional(),
    })
    .optional(),
});

export const DraftTextSchema = DraftingObjectBaseSchema.extend({
  kind: z.literal("text"),
  content: RichTextDocumentSchema,
  alignment: z.enum(["start", "middle", "end"]),
  rotation: RotationSchema,
  typographyToken: z.enum(["caption", "body", "label"]).optional(),
  /** Fixed vector polarity marks surrounding editable center text. */
  polarity: z.enum(["both", "positive", "negative"]).optional(),
});
export const DraftArrowSchema = DraftingObjectBaseSchema.extend({
  kind: z.literal("arrow"),
  from: VisualAnchorSchema,
  to: VisualAnchorSchema,
  waypoints: z.array(PointSchema).optional(),
  curveControls: z.array(PointSchema.nullable()).optional(),
});
export const DraftLeaderSchema = DraftingObjectBaseSchema.extend({
  kind: z.literal("leader"),
  target: VisualAnchorSchema,
});
export const DraftCalloutSchema = DraftingObjectBaseSchema.extend({
  kind: z.literal("callout"),
  content: RichTextDocumentSchema,
  alignment: z.enum(["start", "middle", "end"]),
  rotation: RotationSchema,
  typographyToken: z.enum(["caption", "body", "label"]).optional(),
  target: VisualAnchorSchema,
});
export const DraftConstructionLineSchema = DraftingObjectBaseSchema.extend({
  kind: z.literal("construction-line"),
  points: z.array(PointSchema).min(2),
  curveControls: z.array(PointSchema.nullable()).optional(),
  lineStyle: z.enum(["solid", "dashed", "dotted"]),
});
export const DraftRectangleSchema = DraftingObjectBaseSchema.extend({
  kind: z.literal("rectangle"),
  center: PointSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  rotation: z.number().finite().min(0).lt(360),
  lineStyle: z.enum(["solid", "dashed", "dotted"]),
});
/**
 * A circle is a stroke-only drafting primitive.  Unlike a rectangle it is
 * intentionally orientation-free: its center/radius are the complete
 * persistent geometry, which avoids a meaningless rotation property.
 */
export const DraftCircleSchema = DraftingObjectBaseSchema.extend({
  kind: z.literal("circle"),
  center: PointSchema,
  radius: z.number().int().positive(),
  lineStyle: z.enum(["solid", "dashed", "dotted"]),
});
export const DraftFloatingSymbolSchema = DraftingObjectBaseSchema.extend({
  kind: z.literal("floating-symbol"),
  symbolId: StableIdSchema,
  transform: OrientationSchema,
});
export const DraftingObjectSchema = z.discriminatedUnion("kind", [
  DraftTextSchema,
  DraftArrowSchema,
  DraftLeaderSchema,
  DraftCalloutSchema,
  DraftConstructionLineSchema,
  DraftRectangleSchema,
  DraftCircleSchema,
  DraftFloatingSymbolSchema,
]);
export const DraftingLayerSchema = z.strictObject({
  objects: z.array(DraftingObjectSchema),
});
