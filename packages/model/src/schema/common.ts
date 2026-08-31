import { z } from "zod";
export const CURRENT_PROJECT_SCHEMA_VERSION = 35;

export const StableIdSchema = z.string().min(1).max(256);
/** Strict persisted/presentation hex color token. Format: `#RRGGBB`. */
export const HexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/u, "Color must be #RRGGBB hex format");
/** A persisted Document page point before its Document-grid relation is known. */
export const GridPointSchema = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
});
/** A grid-domain rectangle. Alignment is validated with a Document grid. */
export const GridRectSchema = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
/** Read-only renderer/diagnostic geometry. It may be fractional. */
export const DerivedPointSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
});
/** Read-only renderer/diagnostic bounds. Empty geometry may have zero extent. */
export const DerivedRectSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});
/** Symbol-library artwork coordinates, unrelated to a Document page grid. */
export const SymbolLocalPointSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
});
export const SymbolLocalRectSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});
// Compatibility aliases remain internal migration aids. New code must name
// Grid* or Derived* explicitly at package boundaries.
export const PointSchema = GridPointSchema;
export const RectSchema = GridRectSchema;
export const RotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
export const MirrorSchema = z.enum(["none", "x"]);
export const OrientationSchema = z.strictObject({
  rotation: RotationSchema,
  mirror: MirrorSchema,
});
