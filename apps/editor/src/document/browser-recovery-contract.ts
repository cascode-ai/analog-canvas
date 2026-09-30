// Browser recovery record contract (v2).
//
// A `.icproj.json` export stays the portable, user-owned artifact while a
// Cloud Project is the formal saved state. Browser recovery is a bounded,
// origin-local safety copy
// of committed Project text, kept in an application-specific IndexedDB store.
// This module owns the pure, browser-API-free half of that contract:
//
// - the versioned envelope shape and its executable limits;
// - structural decode of untrusted stored records (byte length is always
//   recomputed, never trusted from storage);
// - classification of a record's Project text into valid, corrupt, or
//   unsupported-schema, where unsupported-schema bytes stay exportable raw
//   data instead of being treated as corrupt;
// - latest/previous generation rotation with identical-text deduplication;
// - deterministic retention planning: open working copies are protected, one
//   copy is kept per Project, and a total-byte cap bounds the rest.
//
// Storage (WP-1) and React coordination (WP-2) build on these functions; they
// must not re-implement the rules independently.

import {
  parseProjectWithMetadata,
  ProjectFormatError,
} from "@icm/project-protocol";
import type { CircuitProject } from "@icm/model";

export const BROWSER_RECOVERY_FORMAT = "analog-canvas-browser-recovery-v2";

/**
 * Most sessions kept for working copies no editor has open. Open ones are
 * never counted against it: bytes, not a count, bound unsaved work.
 */
export const BROWSER_RECOVERY_MAX_CLOSED_SESSIONS = 20;

/** Maximum UTF-8 byte length of one recovery record's Project text. */
export const BROWSER_RECOVERY_MAX_RECORD_BYTES = 4 * 1024 * 1024;

/** Maximum total UTF-8 bytes of all records owned by this store. */
export const BROWSER_RECOVERY_MAX_TOTAL_BYTES = 12 * 1024 * 1024;

export const BROWSER_RECOVERY_GENERATIONS = ["latest", "previous"] as const;
export const BROWSER_RECOVERY_SOURCES = [
  "new",
  "opened-file",
  "spice-import",
  "cloud-project",
  "recovered",
] as const;

export type BrowserRecoveryGeneration =
  (typeof BROWSER_RECOVERY_GENERATIONS)[number];
export type BrowserRecoverySource = (typeof BROWSER_RECOVERY_SOURCES)[number];

export interface BrowserRecoveryFormalFileHint {
  name: string;
  lastConfirmedWriteAt?: string;
  lastDownloadRequestedAt?: string;
}

export interface BrowserRecoveryCloudBinding {
  id: string;
  revision: number;
}

/**
 * Versioned envelope, deliberately separate from the canonical Project
 * schema. Never add this shape to `packages/model` or `.icproj.json`.
 */
export interface BrowserRecoveryRecordV2 {
  format: typeof BROWSER_RECOVERY_FORMAT;
  recordId: string;
  workingCopyId: string;
  generation: BrowserRecoveryGeneration;
  projectId: string;
  projectName: string;
  projectSchemaVersion: number;
  topDocumentId: string;
  documentRevisions: Record<string, number>;
  /**
   * The Project's structure revision, which moves on every edit anywhere in
   * it. Two copies of one Project are told apart by it: a Cell's own
   * revision stands still while the rest of the Project changes.
   */
  structureRevision?: number;
  source: BrowserRecoverySource;
  updatedAt: string;
  /** UTF-8 byte length of `projectText`; always recomputed, never trusted. */
  byteLength: number;
  projectText: string;
  /** Whether this snapshot is ahead of the acknowledged Cloud Project. */
  unsavedAtSnapshot?: boolean;
  cloudBinding?: BrowserRecoveryCloudBinding;
  formalFileHint?: BrowserRecoveryFormalFileHint;
}

/** Input accepted by {@link finalizeBrowserRecoveryRecord}. */
export interface BrowserRecoveryRecordDraft {
  recordId: string;
  workingCopyId: string;
  generation: BrowserRecoveryGeneration;
  projectId: string;
  projectName: string;
  projectSchemaVersion: number;
  topDocumentId: string;
  documentRevisions: Record<string, number>;
  structureRevision?: number;
  source: BrowserRecoverySource;
  updatedAt: string;
  projectText: string;
  unsavedAtSnapshot?: boolean;
  cloudBinding?: BrowserRecoveryCloudBinding;
  formalFileHint?: BrowserRecoveryFormalFileHint;
}

/**
 * Records are keyed by working-copy identity plus generation, never by
 * `projectId` alone: two tabs with different `workingCopyId` values therefore
 * cannot target the same stored key.
 */
export function browserRecoveryRecordKey(
  workingCopyId: string,
  generation: BrowserRecoveryGeneration,
): string {
  return `${workingCopyId}#${generation}`;
}

export function browserRecoveryByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Build a storable record, computing `byteLength` from the Project text. */
export function finalizeBrowserRecoveryRecord(
  draft: BrowserRecoveryRecordDraft,
): BrowserRecoveryRecordV2 {
  return {
    format: BROWSER_RECOVERY_FORMAT,
    recordId: draft.recordId,
    workingCopyId: draft.workingCopyId,
    generation: draft.generation,
    projectId: draft.projectId,
    projectName: draft.projectName,
    projectSchemaVersion: draft.projectSchemaVersion,
    topDocumentId: draft.topDocumentId,
    documentRevisions: draft.documentRevisions,
    ...(draft.structureRevision === undefined
      ? {}
      : { structureRevision: draft.structureRevision }),
    source: draft.source,
    updatedAt: draft.updatedAt,
    byteLength: browserRecoveryByteLength(draft.projectText),
    projectText: draft.projectText,
    ...(draft.unsavedAtSnapshot === undefined
      ? {}
      : { unsavedAtSnapshot: draft.unsavedAtSnapshot }),
    ...(draft.cloudBinding === undefined
      ? {}
      : { cloudBinding: draft.cloudBinding }),
    ...(draft.formalFileHint === undefined
      ? {}
      : { formalFileHint: draft.formalFileHint }),
  };
}

export type BrowserRecoveryDecodeResult =
  | { status: "valid"; record: BrowserRecoveryRecordV2 }
  | { status: "corrupt"; message: string };

/**
 * Structurally validate untrusted stored input BEFORE any attempt to parse
 * `projectText`. The persisted `byteLength` is replaced by the recomputed
 * UTF-8 length so downstream limits cannot be bypassed by a forged value.
 */
export function decodeBrowserRecoveryRecord(
  input: unknown,
): BrowserRecoveryDecodeResult {
  const corrupt = (message: string): BrowserRecoveryDecodeResult => ({
    status: "corrupt",
    message,
  });
  if (typeof input !== "object" || input === null) {
    return corrupt("recovery record is not an object");
  }
  const raw = input as Record<string, unknown>;
  if (raw.format !== BROWSER_RECOVERY_FORMAT) {
    return corrupt(`unexpected recovery format: ${String(raw.format)}`);
  }
  for (const field of [
    "recordId",
    "workingCopyId",
    "projectId",
    "projectName",
    "topDocumentId",
    "updatedAt",
    "projectText",
  ] as const) {
    if (typeof raw[field] !== "string" || raw[field].length === 0) {
      return corrupt(`field ${field} is not a non-empty string`);
    }
  }
  const generation = raw.generation;
  if (
    typeof generation !== "string" ||
    !BROWSER_RECOVERY_GENERATIONS.includes(
      generation as BrowserRecoveryGeneration,
    )
  ) {
    return corrupt(`invalid generation: ${String(generation)}`);
  }
  const source = raw.source;
  if (
    typeof source !== "string" ||
    !BROWSER_RECOVERY_SOURCES.includes(source as BrowserRecoverySource)
  ) {
    return corrupt(`invalid source: ${String(source)}`);
  }
  if (
    typeof raw.projectSchemaVersion !== "number" ||
    !Number.isInteger(raw.projectSchemaVersion) ||
    raw.projectSchemaVersion < 1
  ) {
    return corrupt("projectSchemaVersion is not a positive integer");
  }
  if (typeof raw.byteLength !== "number" || !Number.isFinite(raw.byteLength)) {
    return corrupt("byteLength is not a finite number");
  }
  if (Number.isNaN(Date.parse(raw.updatedAt as string))) {
    return corrupt("updatedAt is not a valid timestamp");
  }
  const documentRevisions = raw.documentRevisions;
  if (
    typeof documentRevisions !== "object" ||
    documentRevisions === null ||
    Array.isArray(documentRevisions)
  ) {
    return corrupt("documentRevisions is not an object");
  }
  for (const [documentId, revision] of Object.entries(documentRevisions)) {
    if (documentId.length === 0) {
      return corrupt("documentRevisions contains an empty document id");
    }
    if (
      typeof revision !== "number" ||
      !Number.isInteger(revision) ||
      revision < 0
    ) {
      return corrupt(`documentRevisions[${documentId}] is not a revision`);
    }
  }
  if (raw.formalFileHint !== undefined) {
    const hint = raw.formalFileHint;
    if (typeof hint !== "object" || hint === null) {
      return corrupt("formalFileHint is not an object");
    }
    if (typeof (hint as Record<string, unknown>).name !== "string") {
      return corrupt("formalFileHint.name is not a string");
    }
    for (const field of [
      "lastConfirmedWriteAt",
      "lastDownloadRequestedAt",
    ] as const) {
      const value = (hint as Record<string, unknown>)[field];
      if (value !== undefined && typeof value !== "string") {
        return corrupt(`formalFileHint.${field} is not a string`);
      }
    }
  }
  if (
    raw.structureRevision !== undefined &&
    (typeof raw.structureRevision !== "number" ||
      !Number.isInteger(raw.structureRevision) ||
      raw.structureRevision < 0)
  ) {
    return corrupt("structureRevision is not a revision");
  }
  if (
    raw.unsavedAtSnapshot !== undefined &&
    typeof raw.unsavedAtSnapshot !== "boolean"
  ) {
    return corrupt("unsavedAtSnapshot is not a boolean");
  }
  if (raw.cloudBinding !== undefined) {
    const binding = raw.cloudBinding;
    if (
      typeof binding !== "object" ||
      binding === null ||
      typeof (binding as Record<string, unknown>).id !== "string" ||
      (binding as Record<string, unknown>).id === "" ||
      typeof (binding as Record<string, unknown>).revision !== "number" ||
      !Number.isInteger((binding as Record<string, unknown>).revision) ||
      ((binding as Record<string, unknown>).revision as number) < 1
    ) {
      return corrupt("cloudBinding is invalid");
    }
  }

  const projectText = raw.projectText as string;
  const record: BrowserRecoveryRecordV2 = {
    format: BROWSER_RECOVERY_FORMAT,
    recordId: raw.recordId as string,
    workingCopyId: raw.workingCopyId as string,
    generation: generation as BrowserRecoveryGeneration,
    projectId: raw.projectId as string,
    projectName: raw.projectName as string,
    projectSchemaVersion: raw.projectSchemaVersion as number,
    topDocumentId: raw.topDocumentId as string,
    documentRevisions: raw.documentRevisions as Record<string, number>,
    ...(raw.structureRevision === undefined
      ? {}
      : { structureRevision: raw.structureRevision as number }),
    source: source as BrowserRecoverySource,
    updatedAt: raw.updatedAt as string,
    byteLength: browserRecoveryByteLength(projectText),
    projectText,
    ...(raw.unsavedAtSnapshot === undefined
      ? {}
      : { unsavedAtSnapshot: raw.unsavedAtSnapshot as boolean }),
    ...(raw.cloudBinding === undefined
      ? {}
      : {
          cloudBinding: raw.cloudBinding as BrowserRecoveryCloudBinding,
        }),
    ...(raw.formalFileHint === undefined
      ? {}
      : {
          formalFileHint: raw.formalFileHint as BrowserRecoveryFormalFileHint,
        }),
  };
  return { status: "valid", record };
}

function isUnsupportedSchemaError(error: unknown): boolean {
  return (
    error instanceof ProjectFormatError &&
    error.diagnostics.some(
      (diagnostic) => diagnostic.code === "UNSUPPORTED_SCHEMA_VERSION",
    )
  );
}

export type BrowserRecoveryProjectReview =
  | { status: "valid"; project: CircuitProject }
  | {
      status: "unsupported-schema";
      /** Raw Project text preserved for download; never installed as a Project. */
      projectText: string;
      detectedSchemaVersion: number | null;
      message: string;
    }
  | { status: "corrupt"; message: string };

/**
 * Parse and cross-check a decoded record's Project text. A future schema
 * version must classify as `unsupported-schema` with the raw bytes preserved —
 * it is not corruption, and a schema bump must never erase such a record.
 */
export function reviewBrowserRecoveryProject(
  record: BrowserRecoveryRecordV2,
): BrowserRecoveryProjectReview {
  try {
    const parsed = parseProjectWithMetadata(record.projectText);
    const project = parsed.project;
    if (project.id !== record.projectId) {
      return {
        status: "corrupt",
        message: "record projectId does not match the stored Project",
      };
    }
    if (parsed.sourceSchemaVersion !== record.projectSchemaVersion) {
      return {
        status: "corrupt",
        message: "record schema version does not match the stored Project",
      };
    }
    if (project.topDocumentId !== record.topDocumentId) {
      return {
        status: "corrupt",
        message: "record topDocumentId does not match the stored Project",
      };
    }
    return { status: "valid", project };
  } catch (error) {
    if (isUnsupportedSchemaError(error)) {
      let detected: number | null = null;
      try {
        const parsed: unknown = JSON.parse(record.projectText);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof (parsed as Record<string, unknown>).schemaVersion === "number"
        ) {
          detected = (parsed as Record<string, unknown>)
            .schemaVersion as number;
        }
      } catch {
        // Structural decode already proved the text is a string; a failed
        // JSON.parse here still classifies as corrupt below.
        return {
          status: "corrupt",
          message: error instanceof Error ? error.message : "invalid data",
        };
      }
      return {
        status: "unsupported-schema",
        projectText: record.projectText,
        detectedSchemaVersion: detected,
        message: error instanceof Error ? error.message : "invalid data",
      };
    }
    return {
      status: "corrupt",
      message: error instanceof Error ? error.message : "invalid data",
    };
  }
}

/** Stored generations for one working-copy session. */
export interface BrowserRecoverySession {
  workingCopyId: string;
  latest: BrowserRecoveryRecordV2 | null;
  previous: BrowserRecoveryRecordV2 | null;
}

export type BrowserRecoveryRotation =
  | { status: "unchanged"; session: BrowserRecoverySession }
  | { status: "updated"; session: BrowserRecoverySession }
  | { status: "rotated"; session: BrowserRecoverySession }
  | {
      status: "rejected-too-large";
      session: BrowserRecoverySession;
      byteLength: number;
    };

/**
 * Rotate the latest/previous generations for one session. An unchanged
 * Project text must not consume another generation; an oversized candidate is
 * rejected and returns the prior session untouched so the last good record
 * survives.
 */
export function rotateBrowserRecoverySession(
  session: BrowserRecoverySession,
  candidate: BrowserRecoveryRecordV2,
): BrowserRecoveryRotation {
  const byteLength = browserRecoveryByteLength(candidate.projectText);
  if (byteLength > BROWSER_RECOVERY_MAX_RECORD_BYTES) {
    return {
      status: "rejected-too-large",
      session,
      byteLength,
    };
  }
  if (
    session.latest !== null &&
    session.latest.projectText === candidate.projectText
  ) {
    const sameHint =
      session.latest.formalFileHint?.name === candidate.formalFileHint?.name &&
      session.latest.formalFileHint?.lastConfirmedWriteAt ===
        candidate.formalFileHint?.lastConfirmedWriteAt &&
      session.latest.formalFileHint?.lastDownloadRequestedAt ===
        candidate.formalFileHint?.lastDownloadRequestedAt;
    const sameCloudBinding =
      session.latest.cloudBinding?.id === candidate.cloudBinding?.id &&
      session.latest.cloudBinding?.revision ===
        candidate.cloudBinding?.revision;
    if (
      session.latest.unsavedAtSnapshot === candidate.unsavedAtSnapshot &&
      sameHint &&
      sameCloudBinding
    ) {
      return { status: "unchanged", session };
    }
    return {
      status: "updated",
      session: {
        ...session,
        latest: candidate,
      },
    };
  }
  return {
    status: "rotated",
    session: {
      workingCopyId: session.workingCopyId,
      latest: candidate,
      previous: session.latest,
    },
  };
}

export interface BrowserRecoveryRetentionPlan {
  /** Sessions to keep, possibly with pruned generations. */
  sessions: BrowserRecoverySession[];
  /** Record ids to delete from the store. */
  deleteRecordIds: string[];
  /**
   * The protected copies alone exceed the total byte cap. They are all kept,
   * and the editor says that not all unsaved work fits.
   */
  overCapacity: boolean;
}

function sessionRecency(session: BrowserRecoverySession): number {
  const stamps = [session.latest, session.previous]
    .filter((record) => record !== null)
    .map((record) => Date.parse(record.updatedAt));
  return Math.max(...stamps);
}

function recordBytes(record: BrowserRecoveryRecordV2 | null): number {
  return record ? browserRecoveryByteLength(record.projectText) : 0;
}

function sessionProjectId(session: BrowserRecoverySession): string {
  return session.latest?.projectId ?? session.previous?.projectId ?? "";
}

/**
 * Plan retention over all owned records, by three rules in order:
 *
 * - A protected session, a working copy some editor tab has open (every tab,
 *   not only the active one), keeps its `latest` whatever else happens:
 *   unsaved work that is still open is never evicted to make room.
 * - One copy per Project: a session no tab has open is dropped once a more
 *   recent session holds the same Project, so restoring or reloading one
 *   Project cannot push another Project's only copy out. At most
 *   {@link BROWSER_RECOVERY_MAX_CLOSED_SESSIONS} closed sessions stay.
 * - Bytes bound the rest. Over the total cap, `previous` generations go
 *   first (closed sessions, then open ones, oldest first), then whole closed
 *   sessions, oldest first. When the open copies alone exceed the cap they
 *   are all kept and the plan says so.
 */
export function planBrowserRecoveryRetention(
  sessions: BrowserRecoverySession[],
  protectedWorkingCopyIds: ReadonlySet<string>,
): BrowserRecoveryRetentionPlan {
  const deleteRecordIds: string[] = [];
  const drop = (session: BrowserRecoverySession): void => {
    for (const record of [session.latest, session.previous]) {
      if (record !== null) deleteRecordIds.push(record.recordId);
    }
  };
  const isProtected = (session: BrowserRecoverySession): boolean =>
    protectedWorkingCopyIds.has(session.workingCopyId);
  const ordered = sessions
    .filter((session) => session.latest !== null || session.previous !== null)
    .sort((a, b) => {
      const recency = sessionRecency(b) - sessionRecency(a);
      if (recency !== 0) return recency;
      return a.workingCopyId < b.workingCopyId
        ? -1
        : a.workingCopyId > b.workingCopyId
          ? 1
          : 0;
    });

  // Newest first: the first session seen for a Project is its copy.
  const seenProjects = new Set<string>();
  let closedKept = 0;
  const survivors: BrowserRecoverySession[] = [];
  for (const session of ordered) {
    const projectId = sessionProjectId(session);
    if (!isProtected(session)) {
      if (
        seenProjects.has(projectId) ||
        closedKept >= BROWSER_RECOVERY_MAX_CLOSED_SESSIONS
      ) {
        drop(session);
        continue;
      }
      closedKept += 1;
    }
    seenProjects.add(projectId);
    survivors.push({ ...session });
  }

  let total = survivors.reduce(
    (sum, session) =>
      sum + recordBytes(session.latest) + recordBytes(session.previous),
    0,
  );
  const oldestFirst = [...survivors].reverse();
  const closed = oldestFirst.filter((session) => !isProtected(session));
  const open = oldestFirst.filter(isProtected);
  const dropOrder: Array<{
    session: BrowserRecoverySession;
    generation: "latest" | "previous";
  }> = [
    ...closed.map((session) => ({ session, generation: "previous" as const })),
    ...open.map((session) => ({ session, generation: "previous" as const })),
    ...closed.map((session) => ({ session, generation: "latest" as const })),
  ];
  for (const { session, generation } of dropOrder) {
    if (total <= BROWSER_RECOVERY_MAX_TOTAL_BYTES) break;
    const record = session[generation];
    if (record === null) continue;
    session[generation] = null;
    deleteRecordIds.push(record.recordId);
    total -= recordBytes(record);
  }

  return {
    sessions: survivors.filter(
      (session) => session.latest !== null || session.previous !== null,
    ),
    deleteRecordIds,
    overCapacity: total > BROWSER_RECOVERY_MAX_TOTAL_BYTES,
  };
}
