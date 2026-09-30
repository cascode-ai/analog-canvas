import { CURRENT_PROJECT_FILE_VERSION } from "@icm/project-protocol";
import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_MODEL_SCHEMA_VERSION } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import {
  BROWSER_RECOVERY_FORMAT,
  BROWSER_RECOVERY_MAX_CLOSED_SESSIONS,
  BROWSER_RECOVERY_MAX_RECORD_BYTES,
  BROWSER_RECOVERY_MAX_TOTAL_BYTES,
  browserRecoveryByteLength,
  browserRecoveryRecordKey,
  decodeBrowserRecoveryRecord,
  finalizeBrowserRecoveryRecord,
  planBrowserRecoveryRetention,
  reviewBrowserRecoveryProject,
  rotateBrowserRecoverySession,
  type BrowserRecoveryRecordDraft,
  type BrowserRecoverySession,
} from "./browser-recovery-contract";

const project = createEmptyProject("project-alpha", "Alpha Amp");
const projectText = serializeProject(project);

function draft(overrides: Partial<BrowserRecoveryRecordDraft> = {}) {
  return {
    recordId: "record-1",
    workingCopyId: "working-copy-a",
    generation: "latest" as const,
    projectId: project.id,
    projectName: project.name,
    projectSchemaVersion: CURRENT_PROJECT_FILE_VERSION,
    topDocumentId: project.topDocumentId,
    documentRevisions: { [project.topDocumentId]: 3 },
    source: "new" as const,
    updatedAt: "2026-08-14T10:00:00.000Z",
    projectText,
    ...overrides,
  };
}

function session(
  workingCopyId: string,
  generations: {
    latest?: ReturnType<typeof finalizeBrowserRecoveryRecord>;
    previous?: ReturnType<typeof finalizeBrowserRecoveryRecord>;
  },
): BrowserRecoverySession {
  return {
    workingCopyId,
    latest: generations.latest ?? null,
    previous: generations.previous ?? null,
  };
}

describe("browserRecoveryByteLength", () => {
  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    expect(browserRecoveryByteLength("abc")).toBe(3);
    expect(browserRecoveryByteLength("电路")).toBe(6);
  });
});

describe("browserRecoveryRecordKey", () => {
  it("keys by working copy plus generation so tabs cannot collide", () => {
    expect(browserRecoveryRecordKey("copy-a", "latest")).toBe("copy-a#latest");
    expect(browserRecoveryRecordKey("copy-a", "latest")).not.toBe(
      browserRecoveryRecordKey("copy-b", "latest"),
    );
    expect(browserRecoveryRecordKey("copy-a", "latest")).not.toBe(
      browserRecoveryRecordKey("copy-a", "previous"),
    );
  });
});

describe("finalizeBrowserRecoveryRecord", () => {
  it("builds a record with the format tag and recomputed byte length", () => {
    const record = finalizeBrowserRecoveryRecord(draft());
    expect(record.format).toBe(BROWSER_RECOVERY_FORMAT);
    expect(record.byteLength).toBe(browserRecoveryByteLength(projectText));
  });

  it("omits the formal file hint when absent and keeps it when present", () => {
    expect(
      finalizeBrowserRecoveryRecord(draft()).formalFileHint,
    ).toBeUndefined();
    expect(
      finalizeBrowserRecoveryRecord(
        draft({ formalFileHint: { name: "amp.icproj.json" } }),
      ).formalFileHint,
    ).toEqual({ name: "amp.icproj.json" });
  });

  it("preserves additive unsaved-state metadata without requiring it", () => {
    expect(
      finalizeBrowserRecoveryRecord(draft()).unsavedAtSnapshot,
    ).toBeUndefined();
    expect(
      finalizeBrowserRecoveryRecord(draft({ unsavedAtSnapshot: true }))
        .unsavedAtSnapshot,
    ).toBe(true);
  });

  it("keeps the transient Cloud binding outside Project JSON", () => {
    const record = finalizeBrowserRecoveryRecord(
      draft({ cloudBinding: { id: "cloud-1", revision: 4 } }),
    );
    expect(record.cloudBinding).toEqual({ id: "cloud-1", revision: 4 });
    expect(JSON.parse(record.projectText)).not.toHaveProperty("cloudBinding");
    expect(
      decodeBrowserRecoveryRecord({
        ...record,
        cloudBinding: { id: "cloud-1", revision: 0 },
      }),
    ).toMatchObject({ status: "corrupt" });
  });
});

describe("decodeBrowserRecoveryRecord", () => {
  it("round-trips a finalized record", () => {
    const record = finalizeBrowserRecoveryRecord(draft());
    const decoded = decodeBrowserRecoveryRecord({
      ...record,
      projectText: `${record.projectText}`,
    });
    expect(decoded).toEqual({ status: "valid", record });
  });

  it("never trusts the persisted byte length", () => {
    const record = finalizeBrowserRecoveryRecord(draft());
    const decoded = decodeBrowserRecoveryRecord({
      ...record,
      byteLength: 1,
    });
    expect(decoded.status).toBe("valid");
    if (decoded.status === "valid") {
      expect(decoded.record.byteLength).toBe(
        browserRecoveryByteLength(projectText),
      );
    }
  });

  it("rejects non-objects, wrong formats, and non-record shapes", () => {
    expect(decodeBrowserRecoveryRecord(null)).toMatchObject({
      status: "corrupt",
    });
    expect(decodeBrowserRecoveryRecord("nope")).toMatchObject({
      status: "corrupt",
    });
    expect(decodeBrowserRecoveryRecord([])).toMatchObject({
      status: "corrupt",
    });
    const record = finalizeBrowserRecoveryRecord(draft());
    expect(
      decodeBrowserRecoveryRecord({ ...record, format: "other-format-v9" }),
    ).toMatchObject({ status: "corrupt" });
    expect(
      decodeBrowserRecoveryRecord({ ...record, generation: "ancient" }),
    ).toMatchObject({ status: "corrupt" });
    expect(
      decodeBrowserRecoveryRecord({ ...record, source: "mystery" }),
    ).toMatchObject({ status: "corrupt" });
    expect(
      decodeBrowserRecoveryRecord({ ...record, projectId: "" }),
    ).toMatchObject({ status: "corrupt" });
    expect(
      decodeBrowserRecoveryRecord({ ...record, projectSchemaVersion: 0 }),
    ).toMatchObject({ status: "corrupt" });
    expect(
      decodeBrowserRecoveryRecord({ ...record, byteLength: "lots" }),
    ).toMatchObject({ status: "corrupt" });
    expect(
      decodeBrowserRecoveryRecord({ ...record, updatedAt: "yesterday" }),
    ).toMatchObject({ status: "corrupt" });
    expect(
      decodeBrowserRecoveryRecord({
        ...record,
        documentRevisions: { "document-main": -1 },
      }),
    ).toMatchObject({ status: "corrupt" });
    expect(
      decodeBrowserRecoveryRecord({ ...record, unsavedAtSnapshot: "yes" }),
    ).toMatchObject({ status: "corrupt" });
    expect(
      decodeBrowserRecoveryRecord({
        ...record,
        documentRevisions: { "": 1 },
      }),
    ).toMatchObject({ status: "corrupt" });
    expect(
      decodeBrowserRecoveryRecord({
        ...record,
        formalFileHint: { name: 7 },
      }),
    ).toMatchObject({ status: "corrupt" });
    expect(
      decodeBrowserRecoveryRecord({
        ...record,
        formalFileHint: { name: "amp.icproj.json", lastConfirmedWriteAt: 5 },
      }),
    ).toMatchObject({ status: "corrupt" });
  });
});

describe("reviewBrowserRecoveryProject", () => {
  it("accepts a record whose envelope agrees with the Project", () => {
    const record = finalizeBrowserRecoveryRecord(draft());
    const review = reviewBrowserRecoveryProject(record);
    expect(review.status).toBe("valid");
    if (review.status === "valid") {
      expect(review.project.id).toBe(project.id);
      expect(review.project.schemaVersion).toBe(project.schemaVersion);
    }
  });

  it("accepts a previous-schema recovery envelope after upgrading its Project", () => {
    const previous = JSON.parse(JSON.stringify(project));
    previous.schemaVersion = CURRENT_MODEL_SCHEMA_VERSION - 1;
    if (previous.schemaVersion < 50) {
      previous.simulationSetups = previous.simulationFolders;
      delete previous.simulationFolders;
    }
    const previousText = JSON.stringify(previous);
    const review = reviewBrowserRecoveryProject(
      finalizeBrowserRecoveryRecord(
        draft({
          projectText: previousText,
          projectSchemaVersion: CURRENT_MODEL_SCHEMA_VERSION - 1,
        }),
      ),
    );

    expect(review.status).toBe("valid");
    if (review.status === "valid") {
      expect(review.project.schemaVersion).toBe(CURRENT_MODEL_SCHEMA_VERSION);
    }
  });

  it("classifies envelope disagreement as corrupt", () => {
    expect(
      reviewBrowserRecoveryProject(
        finalizeBrowserRecoveryRecord(draft({ projectId: "other-project" })),
      ),
    ).toMatchObject({ status: "corrupt" });
    expect(
      reviewBrowserRecoveryProject(
        finalizeBrowserRecoveryRecord(
          draft({ topDocumentId: "document-elsewhere" }),
        ),
      ),
    ).toMatchObject({ status: "corrupt" });
    expect(
      reviewBrowserRecoveryProject(
        finalizeBrowserRecoveryRecord(draft({ projectSchemaVersion: 8 })),
      ),
    ).toMatchObject({ status: "corrupt" });
  });

  it("classifies non-JSON Project text as corrupt", () => {
    const review = reviewBrowserRecoveryProject(
      finalizeBrowserRecoveryRecord(draft({ projectText: "not json" })),
    );
    expect(review).toMatchObject({ status: "corrupt" });
  });

  it("preserves unsupported-schema bytes as raw data, not corruption", () => {
    const futureText = JSON.stringify({
      ...JSON.parse(projectText),
      schemaVersion: 99,
    });
    const review = reviewBrowserRecoveryProject(
      finalizeBrowserRecoveryRecord(draft({ projectText: futureText })),
    );
    expect(review.status).toBe("unsupported-schema");
    if (review.status === "unsupported-schema") {
      expect(review.projectText).toBe(futureText);
      expect(review.detectedSchemaVersion).toBe(99);
    }
  });

  it("does not trust the envelope schema version over the stored text", () => {
    const pastText = JSON.stringify({
      ...JSON.parse(projectText),
      schemaVersion: 4,
    });
    const review = reviewBrowserRecoveryProject(
      finalizeBrowserRecoveryRecord(
        draft({ projectText: pastText, projectSchemaVersion: 4 }),
      ),
    );
    expect(review.status).toBe("unsupported-schema");
  });
});

describe("rotateBrowserRecoverySession", () => {
  it("rotates latest to previous for changed content", () => {
    const first = finalizeBrowserRecoveryRecord(
      draft({ recordId: "record-1", updatedAt: "2026-08-14T10:00:00.000Z" }),
    );
    const second = finalizeBrowserRecoveryRecord(
      draft({
        recordId: "record-2",
        updatedAt: "2026-08-14T10:01:00.000Z",
        projectText: serializeProject({ ...project, name: "Alpha Amp v2" }),
        projectName: "Alpha Amp v2",
      }),
    );
    const rotation = rotateBrowserRecoverySession(
      session("working-copy-a", { latest: first }),
      second,
    );
    expect(rotation.status).toBe("rotated");
    if (rotation.status === "rotated") {
      expect(rotation.session.latest?.recordId).toBe("record-2");
      expect(rotation.session.previous?.recordId).toBe("record-1");
    }
  });

  it("does not consume a generation for identical Project text", () => {
    const first = finalizeBrowserRecoveryRecord(
      draft({ recordId: "record-1" }),
    );
    const repeat = finalizeBrowserRecoveryRecord(
      draft({ recordId: "record-2", updatedAt: "2026-08-14T10:05:00.000Z" }),
    );
    const rotation = rotateBrowserRecoverySession(
      session("working-copy-a", { latest: first }),
      repeat,
    );
    expect(rotation.status).toBe("unchanged");
    if (rotation.status === "unchanged") {
      expect(rotation.session.latest?.recordId).toBe("record-1");
    }
  });

  it("updates save metadata in place without rotating identical content", () => {
    const first = finalizeBrowserRecoveryRecord(
      draft({ recordId: "record-1", unsavedAtSnapshot: true }),
    );
    const saved = finalizeBrowserRecoveryRecord(
      draft({
        recordId: "record-2",
        updatedAt: "2026-08-14T10:05:00.000Z",
        unsavedAtSnapshot: false,
        formalFileHint: { name: "amp.icproj.json" },
      }),
    );
    const rotation = rotateBrowserRecoverySession(
      session("working-copy-a", { latest: first }),
      saved,
    );
    expect(rotation.status).toBe("updated");
    if (rotation.status === "updated") {
      expect(rotation.session.latest?.recordId).toBe("record-2");
      expect(rotation.session.latest?.unsavedAtSnapshot).toBe(false);
      expect(rotation.session.previous).toBeNull();
    }
  });

  it("updates a Cloud binding in place without consuming previous", () => {
    const first = finalizeBrowserRecoveryRecord(
      draft({ recordId: "record-1" }),
    );
    const bound = finalizeBrowserRecoveryRecord(
      draft({
        recordId: "record-2",
        cloudBinding: { id: "cloud-1", revision: 1 },
      }),
    );
    const rotation = rotateBrowserRecoverySession(
      session("working-copy-a", { latest: first }),
      bound,
    );
    expect(rotation.status).toBe("updated");
    if (rotation.status === "updated") {
      expect(rotation.session.latest?.cloudBinding).toEqual({
        id: "cloud-1",
        revision: 1,
      });
      expect(rotation.session.previous).toBeNull();
    }
  });

  it("keeps an empty session's previous slot empty", () => {
    const first = finalizeBrowserRecoveryRecord(draft());
    const rotation = rotateBrowserRecoverySession(
      session("working-copy-a", {}),
      first,
    );
    expect(rotation.status).toBe("rotated");
    if (rotation.status === "rotated") {
      expect(rotation.session.previous).toBeNull();
    }
  });

  it("rejects an oversized candidate and returns the unchanged session", () => {
    const first = finalizeBrowserRecoveryRecord(draft());
    const oversized = finalizeBrowserRecoveryRecord(
      draft({
        recordId: "record-oversized",
        projectText: `${projectText}\n${"x".repeat(
          BROWSER_RECOVERY_MAX_RECORD_BYTES,
        )}`,
      }),
    );
    const rotation = rotateBrowserRecoverySession(
      session("working-copy-a", { latest: first }),
      oversized,
    );
    expect(rotation.status).toBe("rejected-too-large");
    if (rotation.status === "rejected-too-large") {
      expect(rotation.session.latest?.recordId).toBe("record-1");
      expect(rotation.byteLength).toBeGreaterThan(
        BROWSER_RECOVERY_MAX_RECORD_BYTES,
      );
    }
  });
});

/**
 * A record of `bytes` Project text. Each working copy holds its own Project
 * unless `projectId` says otherwise.
 */
function bigRecord(
  workingCopyId: string,
  recordId: string,
  updatedAt: string,
  bytes: number,
  projectId = `project-${workingCopyId}`,
) {
  return finalizeBrowserRecoveryRecord(
    draft({
      recordId,
      workingCopyId,
      updatedAt,
      projectId,
      projectText: "y".repeat(bytes),
    }),
  );
}

function copy(
  workingCopyId: string,
  updatedAt: string,
  options: { bytes?: number; projectId?: string; previousAt?: string } = {},
) {
  const bytes = options.bytes ?? 100;
  return session(workingCopyId, {
    latest: bigRecord(
      workingCopyId,
      `${workingCopyId}-latest`,
      updatedAt,
      bytes,
      options.projectId,
    ),
    ...(options.previousAt
      ? {
          previous: bigRecord(
            workingCopyId,
            `${workingCopyId}-previous`,
            options.previousAt,
            bytes,
            options.projectId,
          ),
        }
      : {}),
  });
}

describe("planBrowserRecoveryRetention", () => {
  it("keeps every open working copy, however many tabs are open", () => {
    // Issue #1250: a third edited tab evicted the first tab's unsaved copy.
    const open = ["tab-a", "tab-b", "tab-c", "tab-d"];
    const plan = planBrowserRecoveryRetention(
      open.map((id, index) =>
        copy(id, `2026-09-30T1${index}:00:00.000Z`, {
          previousAt: `2026-09-30T0${index}:00:00.000Z`,
        }),
      ),
      new Set(open),
    );
    expect(plan.deleteRecordIds).toEqual([]);
    expect(plan.sessions.map((entry) => entry.workingCopyId).sort()).toEqual(
      open,
    );
    expect(plan.overCapacity).toBe(false);
  });

  it("keeps closed copies of other Projects beside the open ones", () => {
    const plan = planBrowserRecoveryRetention(
      [
        copy("open", "2026-09-30T12:00:00.000Z"),
        copy("closed-1", "2026-09-29T12:00:00.000Z"),
        copy("closed-2", "2026-09-28T12:00:00.000Z"),
      ],
      new Set(["open"]),
    );
    expect(plan.sessions.map((entry) => entry.workingCopyId)).toEqual([
      "open",
      "closed-1",
      "closed-2",
    ]);
    expect(plan.deleteRecordIds).toEqual([]);
  });

  it("keeps one closed copy per Project, so restores cannot push another Project out", () => {
    // One Project restored twice left three sessions of it; the unrelated
    // Project's only copy must survive them.
    const plan = planBrowserRecoveryRetention(
      [
        copy("restored-again", "2026-09-30T15:49:00.000Z", {
          projectId: "project-dut",
        }),
        copy("restored", "2026-09-30T15:20:00.000Z", {
          projectId: "project-dut",
        }),
        copy("original", "2026-09-30T14:00:00.000Z", {
          projectId: "project-dut",
          previousAt: "2026-09-30T13:00:00.000Z",
        }),
        copy("other", "2026-09-29T09:00:00.000Z"),
      ],
      new Set(),
    );
    expect(plan.sessions.map((entry) => entry.workingCopyId)).toEqual([
      "restored-again",
      "other",
    ]);
    expect(plan.deleteRecordIds).toEqual([
      "restored-latest",
      "original-latest",
      "original-previous",
    ]);
  });

  it("never drops an open copy for a newer copy of the same Project", () => {
    const plan = planBrowserRecoveryRetention(
      [
        copy("closed-newer", "2026-09-30T12:00:00.000Z", {
          projectId: "project-p",
        }),
        copy("open-older", "2026-09-30T10:00:00.000Z", {
          projectId: "project-p",
        }),
      ],
      new Set(["open-older"]),
    );
    expect(plan.sessions.map((entry) => entry.workingCopyId)).toEqual([
      "closed-newer",
      "open-older",
    ]);
    expect(plan.deleteRecordIds).toEqual([]);
  });

  it("keeps at most the newest closed sessions", () => {
    const closed = Array.from(
      { length: BROWSER_RECOVERY_MAX_CLOSED_SESSIONS + 2 },
      (_, index) =>
        copy(
          `closed-${String(index).padStart(2, "0")}`,
          new Date(Date.UTC(2026, 8, 1, index)).toISOString(),
        ),
    );
    const plan = planBrowserRecoveryRetention(closed, new Set());
    expect(plan.sessions).toHaveLength(BROWSER_RECOVERY_MAX_CLOSED_SESSIONS);
    expect(plan.deleteRecordIds).toEqual([
      "closed-01-latest",
      "closed-00-latest",
    ]);
  });

  it("breaks recency ties deterministically", () => {
    const stamp = "2026-08-14T10:00:00.000Z";
    const plan = planBrowserRecoveryRetention(
      [copy("copy-b", stamp), copy("copy-a", stamp)],
      new Set(["copy-c"]),
    );
    expect(plan.sessions.map((entry) => entry.workingCopyId)).toEqual([
      "copy-a",
      "copy-b",
    ]);
    expect(plan.deleteRecordIds).toEqual([]);
  });

  it("drops closed previous generations first, oldest first, for the byte cap", () => {
    const bytes = BROWSER_RECOVERY_MAX_RECORD_BYTES;
    const plan = planBrowserRecoveryRetention(
      [
        copy("open", "2026-08-14T12:00:00.000Z", {
          bytes,
          previousAt: "2026-08-14T08:00:00.000Z",
        }),
        copy("closed", "2026-08-14T11:00:00.000Z", {
          bytes,
          previousAt: "2026-08-14T10:00:00.000Z",
        }),
      ],
      new Set(["open"]),
    );
    expect(plan.deleteRecordIds).toEqual(["closed-previous"]);
    expect(
      plan.sessions.find((entry) => entry.workingCopyId === "open")?.previous
        ?.recordId,
    ).toBe("open-previous");
    expect(plan.overCapacity).toBe(false);
  });

  it("drops a whole closed session before any open latest copy", () => {
    const bytes = BROWSER_RECOVERY_MAX_RECORD_BYTES;
    const plan = planBrowserRecoveryRetention(
      [
        copy("open-a", "2026-08-14T12:00:00.000Z", { bytes }),
        copy("open-b", "2026-08-14T11:00:00.000Z", { bytes }),
        copy("closed", "2026-08-14T13:00:00.000Z", { bytes }),
        copy("closed-old", "2026-08-14T09:00:00.000Z", { bytes }),
      ],
      new Set(["open-a", "open-b"]),
    );
    expect(plan.deleteRecordIds).toEqual(["closed-old-latest"]);
    expect(plan.overCapacity).toBe(false);
  });

  it("keeps records that fit exactly under the cap", () => {
    const bytes = BROWSER_RECOVERY_MAX_TOTAL_BYTES / 3;
    const plan = planBrowserRecoveryRetention(
      [
        copy("open", "2026-08-14T12:00:00.000Z", {
          bytes,
          previousAt: "2026-08-14T11:00:00.000Z",
        }),
        copy("closed", "2026-08-14T10:00:00.000Z", { bytes }),
      ],
      new Set(["open"]),
    );
    expect(plan.deleteRecordIds).toEqual([]);
    expect(plan.sessions).toHaveLength(2);
    expect(plan.overCapacity).toBe(false);
  });

  it("keeps every open latest copy when they alone exceed the cap, and says so", () => {
    const bytes = BROWSER_RECOVERY_MAX_RECORD_BYTES;
    const open = ["open-a", "open-b", "open-c", "open-d"];
    const plan = planBrowserRecoveryRetention(
      [
        ...open.map((id, index) =>
          copy(id, `2026-08-14T1${index}:00:00.000Z`, {
            bytes,
            previousAt: `2026-08-14T0${index}:00:00.000Z`,
          }),
        ),
        copy("closed", "2026-08-14T15:00:00.000Z", { bytes }),
      ],
      new Set(open),
    );
    for (const id of open)
      expect(plan.deleteRecordIds).not.toContain(`${id}-latest`);
    expect(plan.deleteRecordIds).toContain("closed-latest");
    expect(plan.sessions.map((entry) => entry.workingCopyId).sort()).toEqual(
      open,
    );
    expect(plan.overCapacity).toBe(true);
  });
});
