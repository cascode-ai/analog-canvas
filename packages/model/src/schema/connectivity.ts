import { z } from "zod";

import { StableIdSchema } from "./common.js";
import { TerminalRefSchema } from "./instance.js";
import { SourceSpanSchema } from "./source.js";

/** Logical-Net electrical role shared by derived and Agent contracts. */
export const NetPowerDomainSchema = z.enum([
  "none",
  "vdd",
  "ground",
  "conflict",
]);
export const NetSchema = z.strictObject({
  id: StableIdSchema,
  terminals: z.array(TerminalRefSchema),
});

export const ConnectivityNameClaimOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("net-label"),
    annotationId: StableIdSchema,
  }),
  z.strictObject({
    kind: z.literal("power-marker"),
    objectId: StableIdSchema,
  }),
  z.strictObject({ kind: z.literal("explicit-net-property") }),
]);

/** Persisted typed naming and import provenance for one Base Net. */
export const ConnectivityEvidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: StableIdSchema,
    kind: z.literal("name-claim"),
    netId: StableIdSchema,
    name: z.string().trim().min(1).max(256),
    owner: ConnectivityNameClaimOwnerSchema,
    scope: z.enum(["local", "global"]),
    /** Electrical classification carried by the marker, never inferred from its symbol. */
    powerDomain: z.enum(["vdd", "ground"]).optional(),
  }),
  z.strictObject({
    id: StableIdSchema,
    kind: z.literal("spice-source"),
    netId: StableIdSchema,
    sourceNetId: StableIdSchema,
    sourceRef: SourceSpanSchema.optional(),
  }),
]);

// ADR 0013 / WP-R7 NoConnect: explicit electrical declaration for an open Pin.
export const NoConnectEndpointSchema = z.strictObject({
  kind: z.literal("terminal"),
  instanceId: StableIdSchema,
  pinName: z.string().min(1),
});
export const NoConnectSchema = z.strictObject({
  id: StableIdSchema,
  endpoint: NoConnectEndpointSchema,
  reason: z.string().optional(),
});
