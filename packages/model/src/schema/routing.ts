import { z } from "zod";

import { PointSchema, StableIdSchema } from "./common.js";
import { HexColorSchema } from "./instance.js";

export const RouteEndpointSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("terminal"),
    instanceId: StableIdSchema,
    pinName: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal("junction"), junctionId: StableIdSchema }),
]);
export const SegmentModeSchema = z.enum([
  "auto",
  "escape",
  "manual",
  "locked",
  "trunk",
]);
export const RoutePresentationSchema = z.enum([
  "wire",
  "bulk-dashed",
  "power-rail",
]);
/** Optional visual overrides for one electrical Route. */
export const RouteStyleOverrideSchema = z.strictObject({
  color: HexColorSchema.optional(),
});
export const RouteLegTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("bend"),
    bendId: StableIdSchema,
    position: PointSchema,
  }),
  z.strictObject({
    kind: z.literal("endpoint"),
    endpoint: RouteEndpointSchema,
  }),
]);
export const RouteLegSchema = z.strictObject({
  id: StableIdSchema,
  to: RouteLegTargetSchema,
  mode: SegmentModeSchema,
});
export const RouteBranchSchema = z
  .strictObject({
    id: StableIdSchema,
    netId: StableIdSchema,
    start: RouteEndpointSchema,
    legs: z.array(RouteLegSchema).min(1),
    // Electrical connectivity is always owned by `netId` and the endpoints.
    presentation: RoutePresentationSchema.optional(),
    // Omission inherits the document style profile (Razavi defaults to black).
    styleOverride: RouteStyleOverrideSchema.optional(),
  })
  .superRefine((route, context) => {
    for (const [index, leg] of route.legs.entries()) {
      const isFinal = index === route.legs.length - 1;
      if (isFinal && leg.to.kind !== "endpoint") {
        context.addIssue({
          code: "custom",
          message: "The final route leg must end at an endpoint",
          path: ["legs", index, "to"],
        });
      } else if (!isFinal && leg.to.kind !== "bend") {
        context.addIssue({
          code: "custom",
          message: "Only the final route leg may end at an endpoint",
          path: ["legs", index, "to"],
        });
      }
    }
  });
export const JunctionRoleSchema = z.enum([
  "branch",
  "label-anchor",
  "route-anchor",
]);
export const JunctionSchema = z.strictObject({
  id: StableIdSchema,
  netId: StableIdSchema,
  position: PointSchema,
  // Omitted role preserves the legacy branch-anchor topology. Visible dots are
  // derived from contact directions rather than guaranteed by this role.
  role: JunctionRoleSchema.optional(),
});
