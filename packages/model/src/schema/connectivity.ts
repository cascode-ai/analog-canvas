import { z } from "zod";

import { StableIdSchema } from "./common.js";
import { TerminalRefSchema } from "./instance.js";
import { SourceSpanSchema } from "./source.js";

export const NetPowerDomainSchema = z.enum([
  "none",
  "vdd",
  "ground",
  "conflict",
]);
/** Legacy schema-21 import lineage. Runtime connectivity never reads it. */
export const NetOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("authored") }),
  z.strictObject({
    kind: z.literal("spice-import"),
    sourceNetIds: z.array(StableIdSchema).min(1).max(256),
  }),
]);
export const NetSchema = z.strictObject({
  id: StableIdSchema,
  /** @deprecated Inert schema-21 projection; Logical Net evidence is authoritative. */
  name: z.string().min(1).optional(),
  /** @deprecated Base Nets are physical; marker evidence carries logical scope. */
  scope: z.enum(["local", "global"]),
  /** @deprecated Base Nets have no power role; retained until schema-23 cleanup. */
  powerDomain: NetPowerDomainSchema.optional(),
  terminals: z.array(TerminalRefSchema),
  /** @deprecated Import lineage is represented by spice-source evidence. */
  origin: NetOriginSchema.optional(),
});

export const ConnectivityNameClaimOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("net-label"),
    annotationId: StableIdSchema,
  }),
  z.strictObject({
    kind: z.literal("free-port"),
    instanceId: StableIdSchema,
  }),
  z.strictObject({
    kind: z.literal("power-marker"),
    objectId: StableIdSchema,
  }),
  z.strictObject({ kind: z.literal("explicit-net-property") }),
]);

/** Persisted reason why Base Nets participate in one logical connectivity. */
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
  z.strictObject({
    id: StableIdSchema,
    kind: z.literal("explicit-equivalence"),
    memberNetIds: z.array(StableIdSchema).min(2).max(256),
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
