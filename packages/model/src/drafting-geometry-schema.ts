import { z } from "zod";

import {
  DerivedPointSchema,
  DerivedRectSchema,
  RotationSchema,
  StableIdSchema,
} from "./schema.js";

// ADR 0010 WP-R4/P1: strict Zod schemas for the derived drafting geometry and
// its diagnostics, shared by the Agent Snapshot (which must not use z.unknown)
// and any consumer that validates resolved geometry. The runtime shapes are
// produced by @icm/derived resolveDraftingObjectGeometry; these schemas make
// the wire contract explicit and generated OpenAPI typed.

export const DraftingDiagnosticSchema = z.strictObject({
  code: z.enum([
    "DRAFTING_ANCHOR_TARGET_MISSING",
    "DRAFTING_ROUTE_SEGMENT_INVALID",
    "DRAFTING_SYMBOL_UNRESOLVED",
  ]),
  severity: z.literal("warning"),
  draftingObjectId: StableIdSchema,
  anchorRole: z.enum(["anchor", "from", "to", "target"]),
  targetObjectIds: z.array(StableIdSchema),
  message: z.string(),
  bounds: DerivedRectSchema.optional(),
});

export const ResolvedDraftingGeometrySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    position: DerivedPointSchema,
    textPosition: DerivedPointSchema,
    rotation: RotationSchema,
    polarityLines: z.array(
      z.strictObject({
        role: z.enum(["positive-horizontal", "positive-vertical", "negative"]),
        from: DerivedPointSchema,
        to: DerivedPointSchema,
      }),
    ),
    bounds: DerivedRectSchema,
    diagnostics: z.array(DraftingDiagnosticSchema),
  }),
  z.strictObject({
    kind: z.literal("arrow"),
    from: DerivedPointSchema,
    to: DerivedPointSchema,
    points: z.array(DerivedPointSchema),
    vertices: z.array(DerivedPointSchema),
    curveControls: z.array(DerivedPointSchema.nullable()),
    center: DerivedPointSchema,
    bounds: DerivedRectSchema,
    diagnostics: z.array(DraftingDiagnosticSchema),
  }),
  z.strictObject({
    kind: z.literal("leader"),
    anchor: DerivedPointSchema,
    target: DerivedPointSchema,
    bounds: DerivedRectSchema,
    diagnostics: z.array(DraftingDiagnosticSchema),
  }),
  z.strictObject({
    kind: z.literal("callout"),
    textPosition: DerivedPointSchema,
    target: DerivedPointSchema,
    rotation: RotationSchema,
    textBounds: DerivedRectSchema,
    bounds: DerivedRectSchema,
    diagnostics: z.array(DraftingDiagnosticSchema),
  }),
  z.strictObject({
    kind: z.literal("construction-line"),
    points: z.array(DerivedPointSchema),
    vertices: z.array(DerivedPointSchema),
    curveControls: z.array(DerivedPointSchema.nullable()),
    bounds: DerivedRectSchema,
    diagnostics: z.array(DraftingDiagnosticSchema),
  }),
  z.strictObject({
    kind: z.literal("rectangle"),
    center: DerivedPointSchema,
    width: z.number().positive(),
    height: z.number().positive(),
    rotation: z.number().finite(),
    corners: z.array(DerivedPointSchema).length(4),
    bounds: DerivedRectSchema,
    diagnostics: z.array(DraftingDiagnosticSchema),
  }),
  z.strictObject({
    kind: z.literal("circle"),
    center: DerivedPointSchema,
    radius: z.number().positive(),
    bounds: DerivedRectSchema,
    diagnostics: z.array(DraftingDiagnosticSchema),
  }),
  z.strictObject({
    kind: z.literal("floating-symbol"),
    position: DerivedPointSchema,
    rotation: RotationSchema,
    bounds: DerivedRectSchema,
    diagnostics: z.array(DraftingDiagnosticSchema),
  }),
]);
