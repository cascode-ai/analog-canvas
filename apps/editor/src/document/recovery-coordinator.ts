// Recovery coordinator: bridges committed Projects and the IndexedDB store.
//
// Responsibilities, and nothing more:
//
// - give the current browser tab a working-copy identity persisted in
//   sessionStorage so an ordinary reload continues the same session;
// - coalesce bursts of committed Projects with the existing recovery
//   scheduler, serialize/validate once per debounced batch, and enqueue the
//   IndexedDB write through a serial chain so an in-flight write can never
//   lose a newer revision;
// - publish typed recovery state (`pending`/`stored`/failures) instead of a
//   single ambiguous status string;
// - fork a fresh working-copy identity at replacement boundaries while the
//   outgoing Project's records stay retained in the store;
// - summarize stored sessions (with valid/corrupt/unsupported-schema
//   classification) and read/delete exactly one session on demand.
//
// The coordinator never mutates the live Project and never clears another
// session's records. Storage failures only change coordinator state and user
// messaging, never Project content.

import { projectTextHasMeaningfulContent } from "./project-content";
import { useEffect, useRef, useState } from "react";

import { serializeProject } from "@icm/project-protocol";
import type { CircuitProject } from "@icm/model";

import {
  finalizeBrowserRecoveryRecord,
  reviewBrowserRecoveryProject,
  type BrowserRecoveryCloudBinding,
  type BrowserRecoveryFormalFileHint,
  type BrowserRecoveryGeneration,
  type BrowserRecoveryRecordV2,
  type BrowserRecoverySession,
  type BrowserRecoverySource,
} from "./browser-recovery-contract";
import {
  createBrowserRecoveryStore,
  migrateLegacyProjectRecovery,
  type BrowserRecoveryStorageFailure,
  type BrowserRecoveryStore,
} from "./browser-recovery-store";
import {
  createRecoveryScheduler,
  type RecoveryClearTimeout,
  type RecoverySetTimeout,
} from "./recovery-scheduler";

export const WORKING_COPY_STORAGE_KEY = "icm.working-copy.v1";
export const RECOVERY_WRITE_DELAY_MS = 400;

export type RecoveryState =
  "idle" | "pending" | "stored" | "unavailable" | "quota-exceeded" | "failed";

export interface RecoveryGenerationSummary {
  recordId: string;
  updatedAt: string;
  review: "valid" | "corrupt" | "unsupported-schema";
  /** Top-document revision at the time of the snapshot, when known. */
  revision: number | null;
  /** `null` means the field predates this additive recovery metadata. */
  unsavedAtSnapshot: boolean | null;
  /** Whether the snapshot clears the meaningful-content threshold. */
  meaningfulContent: boolean;
}

export interface RecoveryStageOptions {
  /** Defaults to true because normal staging follows a committed edit. */
  unsavedAtSnapshot?: boolean;
  cloudBinding?: BrowserRecoveryCloudBinding | null;
}

export interface RecoverySessionSummary {
  workingCopyId: string;
  projectId: string;
  projectName: string;
  source: BrowserRecoverySource;
  /** Most recent `updatedAt` across the session's generations. */
  updatedAt: string;
  latest: RecoveryGenerationSummary | null;
  previous: RecoveryGenerationSummary | null;
}

export type RecoveryProjectRead =
  | {
      status: "valid";
      project: CircuitProject;
      record: BrowserRecoveryRecordV2;
    }
  | { status: "corrupt"; message: string }
  | { status: "unsupported-schema"; message: string; projectText: string }
  | { status: "missing"; message: string }
  | {
      status: "failed";
      failure: BrowserRecoveryStorageFailure;
      message: string;
    };

export interface RecoverySessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RecoveryCoordinatorEvents {
  onStateChange?(state: RecoveryState): void;
  onSessionsChange?(sessions: RecoverySessionSummary[]): void;
  onWorkingCopyChange?(workingCopyId: string): void;
  onNotice?(message: string): void;
}

export interface RecoveryCoordinator {
  readonly store: BrowserRecoveryStore;
  readonly workingCopyId: string;
  readonly state: RecoveryState;
  readonly sessions: RecoverySessionSummary[];
  /** Schedule a debounced recovery write for a successfully committed Project. */
  stage(project: CircuitProject, options?: RecoveryStageOptions): void;
  /** Drop a pending write without storing it (replacement boundary). */
  cancelPending(): void;
  /** Flush any pending write and wait for the write chain to settle. */
  flushNow(): Promise<RecoveryState>;
  /**
   * Fork a new working-copy identity for an incoming Project; pending writes
   * for the outgoing identity are dropped, its stored records are retained.
   */
  beginWorkingCopy(source: BrowserRecoverySource): string;
  /** Attach a formal-file hint to subsequent records (file service, WP-3). */
  noteFormalFileHint(hint: BrowserRecoveryFormalFileHint): void;
  /** Re-read stored records and publish fresh session summaries. */
  discover(): Promise<void>;
  /** Validate one stored generation and return its Project or typed failure. */
  readSessionProject(
    workingCopyId: string,
    generation: BrowserRecoveryGeneration,
  ): Promise<RecoveryProjectRead>;
  /** Delete every record of one session; other sessions are untouched. */
  deleteSession(workingCopyId: string): Promise<boolean>;
  dispose(): void;
}

export interface CreateRecoveryCoordinatorOptions {
  store?: BrowserRecoveryStore;
  events?: RecoveryCoordinatorEvents;
  delayMs?: number;
  setTimeout?: RecoverySetTimeout;
  clearTimeout?: RecoveryClearTimeout;
  getSessionStorage?: () => RecoverySessionStorage | null;
  createId?: () => string;
  now?: () => string;
}

function randomId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function defaultSessionStorage(): RecoverySessionStorage | null {
  try {
    const storage = globalThis.sessionStorage as RecoverySessionStorage | null;
    return storage ?? null;
  } catch {
    return null;
  }
}

function summarizeGeneration(
  record: BrowserRecoveryRecordV2 | null,
): RecoveryGenerationSummary | null {
  if (record === null) return null;
  const review = reviewBrowserRecoveryProject(record);
  return {
    recordId: record.recordId,
    updatedAt: record.updatedAt,
    review:
      review.status === "valid" || review.status === "corrupt"
        ? review.status
        : "unsupported-schema",
    revision:
      review.status === "valid" ? (readTopRevision(record) ?? null) : null,
    unsavedAtSnapshot: record.unsavedAtSnapshot ?? null,
    meaningfulContent:
      review.status === "valid" &&
      projectTextHasMeaningfulContent(record.projectText),
  };
}

function readTopRevision(record: BrowserRecoveryRecordV2): number | undefined {
  return record.documentRevisions[record.topDocumentId];
}

export function createRecoveryCoordinator(
  options: CreateRecoveryCoordinatorOptions = {},
): RecoveryCoordinator {
  const events = options.events ?? {};
  const store = options.store ?? createBrowserRecoveryStore();
  const getSessionStorage = options.getSessionStorage ?? defaultSessionStorage;
  const createId = options.createId ?? (() => randomId("working-copy"));
  const now = options.now ?? (() => new Date().toISOString());

  const storage = getSessionStorage();
  let workingCopyId = storage?.getItem(WORKING_COPY_STORAGE_KEY) ?? "";
  if (workingCopyId.length === 0) {
    workingCopyId = createId();
    try {
      storage?.setItem(WORKING_COPY_STORAGE_KEY, workingCopyId);
    } catch {
      // A tab-scoped identity that cannot persist still works for this page.
    }
  }
  let currentSource: BrowserRecoverySource = "new";
  let formalFileHint: BrowserRecoveryFormalFileHint | undefined;
  let state: RecoveryState = "idle";
  let sessions: RecoverySessionSummary[] = [];
  let recordCounter = 0;

  function publishState(next: RecoveryState): void {
    if (state === next) return;
    state = next;
    events.onStateChange?.(next);
  }

  function publishSessions(next: RecoverySessionSummary[]): void {
    sessions = next;
    events.onSessionsChange?.(next);
  }

  // Serial write chain: a store write that is still in flight when the next
  // debounced batch fires must not drop the newer revision, and this tab must
  // never race two write transactions against the same session.
  let writeChain: Promise<void> = Promise.resolve();

  interface RecoveryCandidate {
    project: CircuitProject;
    unsavedAtSnapshot: boolean;
    cloudBinding: BrowserRecoveryCloudBinding | null;
  }

  function enqueueWrite(candidate: RecoveryCandidate): void {
    publishState("pending");
    writeChain = writeChain.then(async () => {
      let record: BrowserRecoveryRecordV2;
      try {
        record = buildRecord(candidate);
      } catch (error) {
        publishState("failed");
        events.onNotice?.(
          `Recovery snapshot could not be serialized: ${
            error instanceof Error ? error.message : "invalid Project"
          }`,
        );
        return;
      }
      const outcome = await store.writeRecord(record);
      if (outcome.status === "stored" || outcome.status === "unchanged") {
        publishState("stored");
        return;
      }
      if (outcome.status === "rejected-too-large") {
        publishState("failed");
        events.onNotice?.(
          "Recovery snapshot exceeds the 4 MB browser limit; the previous copy was kept. Download the Project to keep it safe.",
        );
        return;
      }
      publishState(
        outcome.failure === "quota-exceeded"
          ? "quota-exceeded"
          : outcome.failure === "storage-unavailable"
            ? "unavailable"
            : "failed",
      );
    });
  }

  function buildRecord(candidate: RecoveryCandidate): BrowserRecoveryRecordV2 {
    const { project } = candidate;
    recordCounter += 1;
    const documentRevisions: Record<string, number> = {};
    for (const document of project.documents) {
      documentRevisions[document.id] = document.revision;
    }
    return finalizeBrowserRecoveryRecord({
      recordId: `${workingCopyId}-snapshot-${recordCounter}`,
      workingCopyId,
      generation: "latest",
      projectId: project.id,
      projectName: project.name,
      projectSchemaVersion: project.schemaVersion,
      topDocumentId: project.topDocumentId,
      documentRevisions,
      source: currentSource,
      updatedAt: now(),
      projectText: serializeProject(project),
      unsavedAtSnapshot: candidate.unsavedAtSnapshot,
      ...(candidate.cloudBinding === null
        ? {}
        : { cloudBinding: candidate.cloudBinding }),
      ...(formalFileHint === undefined ? {} : { formalFileHint }),
    });
  }

  const scheduler = createRecoveryScheduler<RecoveryCandidate>({
    delayMs: options.delayMs ?? RECOVERY_WRITE_DELAY_MS,
    write: enqueueWrite,
    ...(options.setTimeout === undefined
      ? {}
      : { setTimeout: options.setTimeout }),
    ...(options.clearTimeout === undefined
      ? {}
      : { clearTimeout: options.clearTimeout }),
  });

  return {
    store,

    get workingCopyId(): string {
      return workingCopyId;
    },

    get state(): RecoveryState {
      return state;
    },

    get sessions(): RecoverySessionSummary[] {
      return sessions;
    },

    stage(project: CircuitProject, options: RecoveryStageOptions = {}): void {
      scheduler.schedule({
        project,
        unsavedAtSnapshot: options.unsavedAtSnapshot ?? true,
        cloudBinding: options.cloudBinding ?? null,
      });
    },

    cancelPending(): void {
      scheduler.cancel();
    },

    async flushNow(): Promise<RecoveryState> {
      scheduler.flush();
      await writeChain;
      return state;
    },

    beginWorkingCopy(source: BrowserRecoverySource): string {
      scheduler.cancel();
      workingCopyId = createId();
      currentSource = source;
      formalFileHint = undefined;
      try {
        storage?.setItem(WORKING_COPY_STORAGE_KEY, workingCopyId);
      } catch {
        // Persisted identity is best-effort; the in-memory identity rules.
      }
      events.onWorkingCopyChange?.(workingCopyId);
      return workingCopyId;
    },

    noteFormalFileHint(hint: BrowserRecoveryFormalFileHint): void {
      formalFileHint = hint;
    },

    async discover(): Promise<void> {
      const read = await store.readAll();
      if (read.status === "failed") {
        publishSessions([]);
        return;
      }
      if (read.undecodableCount > 0) {
        events.onNotice?.(
          `${read.undecodableCount} browser recovery record(s) are in an unreadable future format and were left untouched`,
        );
      }
      const summaries = [...read.sessions]
        .map((session: BrowserRecoverySession) => ({
          workingCopyId: session.workingCopyId,
          projectId:
            session.latest?.projectId ?? session.previous?.projectId ?? "",
          projectName:
            session.latest?.projectName ?? session.previous?.projectName ?? "",
          source: session.latest?.source ?? session.previous?.source ?? "new",
          updatedAt:
            session.latest?.updatedAt ?? session.previous?.updatedAt ?? "",
          latest: summarizeGeneration(session.latest),
          previous: summarizeGeneration(session.previous),
        }))
        .filter(
          (summary) => summary.latest !== null || summary.previous !== null,
        )
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      publishSessions(summaries);
    },

    async readSessionProject(
      targetWorkingCopyId: string,
      generation: BrowserRecoveryGeneration,
    ): Promise<RecoveryProjectRead> {
      const read = await store.readAll();
      if (read.status === "failed") {
        return {
          status: "failed",
          failure: read.failure ?? "storage-failed",
          message: read.message ?? "recovery storage failed",
        };
      }
      const session = read.sessions.find(
        (candidate) => candidate.workingCopyId === targetWorkingCopyId,
      );
      const record = session ? session[generation] : null;
      if (session === undefined || record === null) {
        return {
          status: "missing",
          message: "no stored recovery record for this working copy",
        };
      }
      const review = reviewBrowserRecoveryProject(record);
      if (review.status === "valid") {
        return { status: "valid", project: review.project, record };
      }
      if (review.status === "unsupported-schema") {
        return {
          status: "unsupported-schema",
          message: review.message,
          projectText: review.projectText,
        };
      }
      return { status: "corrupt", message: review.message };
    },

    async deleteSession(targetWorkingCopyId: string): Promise<boolean> {
      const outcome = await store.deleteSession(targetWorkingCopyId);
      return outcome.status === "deleted";
    },

    dispose(): void {
      scheduler.dispose();
    },
  };
}

export interface UseRecoveryCoordinatorOptions {
  store?: BrowserRecoveryStore;
  delayMs?: number;
}

export interface UseRecoveryCoordinatorResult {
  state: RecoveryState;
  sessions: RecoverySessionSummary[];
  /** True once startup discovery (after any migration) has settled. */
  ready: boolean;
  workingCopyId: string;
  stage: (project: CircuitProject, options?: RecoveryStageOptions) => void;
  cancelPending: () => void;
  flushNow: () => Promise<RecoveryState>;
  beginWorkingCopy: (source: BrowserRecoverySource) => string;
  noteFormalFileHint: (hint: BrowserRecoveryFormalFileHint) => void;
  discover: () => Promise<void>;
  readSessionProject: (
    workingCopyId: string,
    generation: BrowserRecoveryGeneration,
  ) => Promise<RecoveryProjectRead>;
  deleteSession: (workingCopyId: string) => Promise<boolean>;
}

/**
 * Browser-only recovery lifecycle; safe during server/static rendering (the
 * mount effect, migration, and discovery simply never run there).
 */
export function useRecoveryCoordinator(
  onNotice?: (message: string) => void,
  options: UseRecoveryCoordinatorOptions = {},
): UseRecoveryCoordinatorResult {
  const [state, setState] = useState<RecoveryState>("idle");
  const [sessions, setSessions] = useState<RecoverySessionSummary[]>([]);
  const [ready, setReady] = useState(false);
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;

  const [coordinator] = useState(() =>
    createRecoveryCoordinator({
      ...(options.store === undefined ? {} : { store: options.store }),
      ...(options.delayMs === undefined ? {} : { delayMs: options.delayMs }),
      events: {
        onStateChange: (next) => setState(next),
        onSessionsChange: (next) => setSessions(next),
        onWorkingCopyChange: (next) => setWorkingCopyId(next),
        onNotice: (message) => noticeRef.current?.(message),
      },
    }),
  );
  const [currentWorkingCopyId, setWorkingCopyId] = useState(
    () => coordinator.workingCopyId,
  );

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const migration = await migrateLegacyProjectRecovery({
        store: coordinator.store,
      });
      if (migration.status === "retained") {
        noticeRef.current?.(
          `The previous browser recovery could not be migrated (${migration.reason}); it was left in place`,
        );
      }
      await coordinator.discover();
      if (!disposed) setReady(true);
    })().catch(() => {
      if (!disposed) setReady(true);
    });
    const flushWhenHidden = () => {
      if (globalThis.document?.visibilityState === "hidden") {
        void coordinator.flushNow();
      }
    };
    const flushOnPageHide = () => {
      void coordinator.flushNow();
    };
    globalThis.window?.addEventListener("visibilitychange", flushWhenHidden);
    globalThis.window?.addEventListener("pagehide", flushOnPageHide);
    return () => {
      disposed = true;
      globalThis.window?.removeEventListener(
        "visibilitychange",
        flushWhenHidden,
      );
      globalThis.window?.removeEventListener("pagehide", flushOnPageHide);
      coordinator.dispose();
    };
  }, [coordinator]);

  return {
    state,
    sessions,
    ready,
    workingCopyId: currentWorkingCopyId,
    stage: (project, stageOptions) => coordinator.stage(project, stageOptions),
    cancelPending: () => coordinator.cancelPending(),
    flushNow: () => coordinator.flushNow(),
    beginWorkingCopy: (source) => {
      const next = coordinator.beginWorkingCopy(source);
      setWorkingCopyId(next);
      return next;
    },
    noteFormalFileHint: (hint) => coordinator.noteFormalFileHint(hint),
    discover: () => coordinator.discover(),
    readSessionProject: (id, generation) =>
      coordinator.readSessionProject(id, generation),
    deleteSession: (id) => coordinator.deleteSession(id),
  };
}
