import { z } from "zod";

import { PointSchema, StableIdSchema } from "./common.js";

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
export const RouteBranchSchema = z
  .strictObject({
    id: StableIdSchema,
    netId: StableIdSchema,
    from: RouteEndpointSchema,
    to: RouteEndpointSchema,
    waypoints: z.array(PointSchema),
    segmentModes: z.array(SegmentModeSchema),
    // Electrical connectivity is always owned by `netId` and the endpoints.
    presentation: RoutePresentationSchema.optional(),
  })
  .superRefine((route, context) => {
    if (route.segmentModes.length !== route.waypoints.length + 1) {
      context.addIssue({
        code: "custom",
        message: "A route requires one segment mode per geometric segment",
        path: ["segmentModes"],
      });
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
