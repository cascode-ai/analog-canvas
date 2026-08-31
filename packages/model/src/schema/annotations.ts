import { z } from "zod";

import {
  HexColorSchema,
  PointSchema,
  RotationSchema,
  StableIdSchema,
} from "./common.js";
import { RichTextDocumentSchema } from "./rich-text.js";

export const VisualAnchorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("free"), position: PointSchema }),
  z.strictObject({
    kind: z.literal("object"),
    objectId: StableIdSchema,
    localOffset: PointSchema,
    fallbackPosition: PointSchema,
  }),
  z.strictObject({
    kind: z.literal("route"),
    routeId: StableIdSchema,
    legId: StableIdSchema,
    t: z.number().min(0).max(1),
    normalOffset: z.number().finite(),
    direction: z.enum(["forward", "reverse"]),
    orientation: z.enum(["follow", "horizontal"]),
    fallbackPosition: PointSchema,
  }),
]);

export const AnnotationKindSchema = z.enum([
  "instance-label",
  "instance-value",
  "net-label",
  "power-label",
  "route-marker",
]);
/**
 * A bound Annotation is a display of one electrical/domain fact, never a
 * second copy of that fact's text. Literal content is reserved for drawing
 * annotations such as current and voltage markers.
 */
export const AnnotationTextBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    /** The Instance's sole authored Reference; never an object ID. */
    kind: z.literal("instance-reference"),
    instanceId: StableIdSchema,
  }),
  z.strictObject({
    kind: z.literal("instance-value"),
    instanceId: StableIdSchema,
  }),
  z.strictObject({ kind: z.literal("net-name"), netId: StableIdSchema }),
  z.strictObject({
    kind: z.literal("cell-terminal-name"),
    terminalId: StableIdSchema,
  }),
]);
export const RouteMarkerKindSchema = z.enum(["current", "voltage"]);
export const RouteAnnotationAttachmentSchema = z.strictObject({
  routeId: StableIdSchema,
  legId: StableIdSchema,
  t: z.number().min(0).max(1),
  direction: z.enum(["forward", "reverse"]),
  normalOffset: z.number().finite(),
});
export const AnnotationSchema = z
  .strictObject({
    id: StableIdSchema,
    kind: AnnotationKindSchema,
    // Exactly one of content/binding is required. `content` remains accepted
    // only for literal annotations already constructed by fixtures and route
    // marker authoring; all semantic annotation producers write `binding`.
    content: RichTextDocumentSchema.optional(),
    binding: AnnotationTextBindingSchema.optional(),
    /** Same-text RichText formatting for an editable semantic name binding. */
    formatOverride: RichTextDocumentSchema.optional(),
    anchor: VisualAnchorSchema,
    netId: StableIdSchema.optional(),
    alignment: z.enum(["start", "middle", "end"]),
    rotation: RotationSchema,
    locked: z.boolean(),
    sizeScale: z.number().finite().positive().optional(),
    markerKind: RouteMarkerKindSchema.optional(),
    visible: z.boolean().optional(),
    /** Optional presentation-only rendered text color override. */
    textColor: HexColorSchema.optional(),
  })
  .superRefine((annotation, context) => {
    if (Boolean(annotation.content) === Boolean(annotation.binding)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["binding"],
        message:
          "Annotations require exactly one literal content or text binding",
      });
    }
    if (
      annotation.formatOverride &&
      annotation.binding?.kind !== "instance-reference" &&
      annotation.binding?.kind !== "net-name" &&
      annotation.binding?.kind !== "cell-terminal-name"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formatOverride"],
        message:
          "RichText format overrides require an editable Instance, Net, or Cell-terminal name binding",
      });
    }
    if (annotation.markerKind && annotation.kind !== "route-marker") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["markerKind"],
        message: "markerKind is only valid on a route-marker annotation",
      });
    }
    if (
      (annotation.kind === "net-label" || annotation.kind === "power-label") &&
      !annotation.netId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["netId"],
        message: "Net and power labels require a Net identity",
      });
    }
    if (
      annotation.kind !== "net-label" &&
      annotation.kind !== "power-label" &&
      annotation.netId !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["netId"],
        message: "netId is only valid on net and power labels",
      });
    }
    if (annotation.binding?.kind === "net-name") {
      if (
        annotation.kind !== "net-label" &&
        annotation.kind !== "power-label"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["binding"],
          message: "Net-name binding is only valid on Net and power labels",
        });
      }
      if (annotation.netId && annotation.netId !== annotation.binding.netId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["netId"],
          message: "netId must agree with the net-name binding",
        });
      }
    }
  });
