import { z } from "zod";

import {
  ArtifactRefSchema,
  Digest,
  EnvironmentSchema,
  Id,
  ProblemSchema,
} from "./contract.js";

/** Durable lifecycle shared by hosted and local control planes. */
export const ManagedRunStateSchema = z.enum([
  "queued",
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "timed-out",
  "cancelled",
  "infrastructure-failed",
  "expired",
]);
export type ManagedRunState = z.infer<typeof ManagedRunStateSchema>;

export const ManagedRunLeaseSchema = z.strictObject({
  id: Id,
  acquiredAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
});
export type ManagedRunLease = z.infer<typeof ManagedRunLeaseSchema>;

export const ManagedRunRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: Id,
  ownerId: Id,
  requestId: Id,
  requestFingerprint: Digest,
  preparedId: Id,
  preparedDigest: Digest,
  inputRevision: z.string(),
  environment: EnvironmentSchema,
  timeoutMs: z.number().int().positive().max(120_000),
  state: ManagedRunStateSchema,
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  queuedAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().optional(),
  finishedAt: z.number().int().nonnegative().optional(),
  cancelRequestedAt: z.number().int().nonnegative().optional(),
  lease: ManagedRunLeaseSchema.optional(),
  error: ProblemSchema.optional(),
  artifacts: z.array(ArtifactRefSchema),
});
export type ManagedRunRecord = z.infer<typeof ManagedRunRecordSchema>;

export const ManagedRunAdmissionSchema = z.strictObject({
  ownerId: Id,
  requestId: Id,
  requestFingerprint: Digest,
  preparedId: Id,
  preparedDigest: Digest,
  inputRevision: z.string(),
  environment: EnvironmentSchema,
  timeoutMs: z.number().int().positive().max(120_000),
  maxAttempts: z.number().int().positive().max(10).default(3),
  artifacts: z.array(ArtifactRefSchema).default([]),
});
export type ManagedRunAdmission = z.infer<typeof ManagedRunAdmissionSchema>;

export const ManagedRunPolicySchema = z.strictObject({
  maxQueuedGlobal: z.number().int().positive(),
  maxQueuedPerOwner: z.number().int().positive(),
  maxActivePerOwner: z.number().int().positive(),
  leaseMs: z.number().int().positive(),
  maxQueueWaitMs: z.number().int().positive(),
  retentionMs: z.number().int().positive(),
});
export type ManagedRunPolicy = z.infer<typeof ManagedRunPolicySchema>;

export const DEFAULT_MANAGED_RUN_POLICY: ManagedRunPolicy = {
  maxQueuedGlobal: 50,
  maxQueuedPerOwner: 1,
  maxActivePerOwner: 1,
  leaseMs: 150_000,
  maxQueueWaitMs: 5 * 60_000,
  retentionMs: 24 * 60 * 60_000,
};

const eventAt = z.number().int().nonnegative();
export const ManagedRunEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("lease-acquired"),
    lease: ManagedRunLeaseSchema,
  }),
  z.strictObject({ kind: z.literal("cancel-requested"), at: eventAt }),
  z.strictObject({
    kind: z.literal("completed"),
    at: eventAt,
    artifacts: z.array(ArtifactRefSchema),
  }),
  z.strictObject({
    kind: z.literal("cancelled"),
    at: eventAt,
    artifacts: z.array(ArtifactRefSchema).optional(),
  }),
  ...(
    ["timed-out", "failed", "infrastructure-failed", "lease-expired"] as const
  ).map((kind) =>
    z.strictObject({
      kind: z.literal(kind),
      at: eventAt,
      error: ProblemSchema,
      artifacts: z.array(ArtifactRefSchema).optional(),
    }),
  ),
  z.strictObject({ kind: z.literal("expired"), at: eventAt }),
  z.strictObject({
    kind: z.literal("queue-expired"),
    at: eventAt,
    error: ProblemSchema,
  }),
]);
export type ManagedRunEvent = z.infer<typeof ManagedRunEventSchema>;

export type ManagedRunTransition =
  | { ok: true; run: ManagedRunRecord; enqueue: boolean }
  | { ok: false; code: "INVALID_RUN_TRANSITION"; state: ManagedRunState };

const terminalStates = new Set<ManagedRunState>([
  "succeeded",
  "failed",
  "timed-out",
  "cancelled",
  "infrastructure-failed",
  "expired",
]);

export function isManagedRunTerminal(state: ManagedRunState): boolean {
  return terminalStates.has(state);
}

export function createManagedRun(
  id: string,
  admission: ManagedRunAdmission,
  now: number,
): ManagedRunRecord {
  return ManagedRunRecordSchema.parse({
    schemaVersion: 1,
    id,
    ...admission,
    state: "queued",
    attempt: 0,
    createdAt: now,
    updatedAt: now,
    queuedAt: now,
  });
}

/** The sole transition table. Adapters persist its result atomically. */
export function transitionManagedRun(
  source: ManagedRunRecord,
  event: ManagedRunEvent,
): ManagedRunTransition {
  const invalid = (): ManagedRunTransition => ({
    ok: false,
    code: "INVALID_RUN_TRANSITION",
    state: source.state,
  });
  const update = (
    fields: Partial<ManagedRunRecord>,
    enqueue = false,
  ): ManagedRunTransition => ({
    ok: true,
    run: ManagedRunRecordSchema.parse({ ...source, ...fields }),
    enqueue,
  });
  const active = source.state === "running" || source.state === "cancelling";

  switch (event.kind) {
    case "lease-acquired":
      if (source.state !== "queued") return invalid();
      if (event.lease.expiresAt <= event.lease.acquiredAt) return invalid();
      return update({
        state: "running",
        attempt: source.attempt + 1,
        startedAt: event.lease.acquiredAt,
        updatedAt: event.lease.acquiredAt,
        lease: event.lease,
        error: undefined,
      });
    case "cancel-requested":
      if (source.state === "queued")
        return update({
          state: "cancelled",
          cancelRequestedAt: event.at,
          finishedAt: event.at,
          updatedAt: event.at,
        });
      if (source.state === "running")
        return update({
          state: "cancelling",
          cancelRequestedAt: event.at,
          updatedAt: event.at,
        });
      if (source.state === "cancelling" || isManagedRunTerminal(source.state))
        return update({ updatedAt: source.updatedAt });
      return invalid();
    case "completed":
      if (!active) return invalid();
      return update({
        state: "succeeded",
        updatedAt: event.at,
        finishedAt: event.at,
        lease: undefined,
        artifacts: [...event.artifacts],
      });
    case "cancelled":
      if (!active) return invalid();
      return update({
        state: "cancelled",
        updatedAt: event.at,
        finishedAt: event.at,
        lease: undefined,
        ...(event.artifacts ? { artifacts: [...event.artifacts] } : {}),
      });
    case "timed-out":
      if (!active) return invalid();
      return update({
        state: "timed-out",
        updatedAt: event.at,
        finishedAt: event.at,
        lease: undefined,
        error: event.error,
        ...(event.artifacts ? { artifacts: [...event.artifacts] } : {}),
      });
    case "failed":
      if (!active) return invalid();
      return update({
        state: "failed",
        updatedAt: event.at,
        finishedAt: event.at,
        lease: undefined,
        error: event.error,
        ...(event.artifacts ? { artifacts: [...event.artifacts] } : {}),
      });
    case "infrastructure-failed":
    case "lease-expired":
      if (!active) return invalid();
      if (source.state !== "cancelling" && source.attempt < source.maxAttempts)
        return update(
          {
            state: "queued",
            updatedAt: event.at,
            queuedAt: event.at,
            lease: undefined,
            error: event.error,
          },
          true,
        );
      return update({
        state:
          source.state === "cancelling" ? "cancelled" : "infrastructure-failed",
        updatedAt: event.at,
        finishedAt: event.at,
        lease: undefined,
        error: event.error,
      });
    case "expired":
      if (!isManagedRunTerminal(source.state)) return invalid();
      return update({ state: "expired", updatedAt: event.at, artifacts: [] });
    case "queue-expired":
      if (source.state !== "queued") return invalid();
      return update({
        state: "expired",
        updatedAt: event.at,
        finishedAt: event.at,
        error: event.error,
        artifacts: [],
      });
  }
}
