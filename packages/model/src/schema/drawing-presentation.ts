import { z } from "zod";

import { HexColorSchema, StableIdSchema } from "./common.js";

export const BodyFillSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("background") }),
  z.strictObject({ kind: z.literal("color"), color: HexColorSchema }),
]);
export type BodyFill = z.infer<typeof BodyFillSchema>;

export const DrawingOrderEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("instance"), id: StableIdSchema }),
  z.strictObject({ kind: z.literal("annotation"), id: StableIdSchema }),
  z.strictObject({ kind: z.literal("drafting"), id: StableIdSchema }),
  z.strictObject({ kind: z.literal("electrical") }),
  z.strictObject({ kind: z.literal("circuit-marks") }),
]);
export type DrawingOrderEntry = z.infer<typeof DrawingOrderEntrySchema>;
export type DrawingObjectEntry = Extract<DrawingOrderEntry, { id: string }>;
