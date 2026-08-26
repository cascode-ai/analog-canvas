import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import {
  BROWSER_RECOVERY_FORMAT,
  BROWSER_RECOVERY_MAX_RECORD_BYTES,
  BROWSER_RECOVERY_MAX_SESSIONS,
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
    projectSchemaVersion: project.schemaVersion,
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
    const previous = JSON.parse(projectText);
    previous.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION - 1;
    const previousText = JSON.stringify(previous);
    const review = reviewBrowserRecoveryProject(
      finalizeBrowserRecoveryRecord(
        draft({
          projectText: previousText,
          projectSchemaVersion: CURRENT_PROJECT_SCHEMA_VERSION - 1,
        }),
      ),
    );

    expect(review.status).toBe("valid");
    if (review.status === "valid") {
      expect(review.project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
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

function bigRecord(
  workingCopyId: string,
  recordId: string,
  updatedAt: string,
  bytes: number,
) {
  return finalizeBrowserRecoveryRecord(
    draft({
      recordId,
      workingCopyId,
      updatedAt,
      projectText: "y".repeat(bytes),
    }),
  );
}

describe("planBrowserRecoveryRetention", () => {
  it("keeps the active session plus the newest other session", () => {
    const active = session("copy-active", {
      latest: bigRecord(
        "copy-active",
        "record-active",
        "2026-08-14T10:00:00.000Z",
        100,
      ),
    });
    const recent = session("copy-recent", {
      latest: bigRecord(
        "copy-recent",
        "record-recent",
        "2026-08-14T09:00:00.000Z",
        100,
      ),
    });
    const stale = session("copy-stale", {
      latest: bigRecord(
        "copy-stale",
        "record-stale",
        "2026-08-13T09:00:00.000Z",
        100,
      ),
      previous: bigRecord(
        "copy-stale",
        "record-stale-prev",
        "2026-08-13T08:00:00.000Z",
        100,
      ),
    });
    const plan = planBrowserRecoveryRetention(
      [stale, active, recent],
      "copy-active",
    );
    expect(plan.sessions.map((entry) => entry.workingCopyId)).toEqual([
      "copy-active",
      "copy-recent",
    ]);
    expect(plan.deleteRecordIds).toEqual(["record-stale", "record-stale-prev"]);
  });

  it("keeps the active session even when it is the oldest", () => {
    const active = session("copy-active", {
      latest: bigRecord(
        "copy-active",
        "record-active",
        "2026-08-12T10:00:00.000Z",
        100,
      ),
    });
    const newer = session("copy-newer", {
      latest: bigRecord(
        "copy-newer",
        "record-newer",
        "2026-08-14T10:00:00.000Z",
        100,
      ),
    });
    const newest = session("copy-newest", {
      latest: bigRecord(
        "copy-newest",
        "record-newest",
        "2026-08-14T11:00:00.000Z",
        100,
      ),
    });
    const plan = planBrowserRecoveryRetention(
      [active, newer, newest],
      "copy-active",
    );
    expect(plan.sessions.map((entry) => entry.workingCopyId)).toEqual([
      "copy-newest",
      "copy-active",
    ]);
    expect(plan.deleteRecordIds).toEqual(["record-newer"]);
  });

  it("breaks recency ties deterministically", () => {
    const stamp = "2026-08-14T10:00:00.000Z";
    const a = session("copy-a", {
      latest: bigRecord("copy-a", "record-a", stamp, 100),
    });
    const b = session("copy-b", {
      latest: bigRecord("copy-b", "record-b", stamp, 100),
    });
    const plan = planBrowserRecoveryRetention([b, a], "copy-c");
    expect(plan.sessions.map((entry) => entry.workingCopyId)).toEqual([
      "copy-a",
      "copy-b",
    ]);
    expect(plan.deleteRecordIds).toEqual([]);
  });

  it("drops the oldest inactive previous generation first for the total cap", () => {
    const bytes = BROWSER_RECOVERY_MAX_RECORD_BYTES;
    const activeLatest = bigRecord(
      "copy-active",
      "record-active-latest",
      "2026-08-14T12:00:00.000Z",
      bytes,
    );
    const activePrevious = bigRecord(
      "copy-active",
      "record-active-previous",
      "2026-08-14T11:00:00.000Z",
      bytes,
    );
    const inactiveLatest = bigRecord(
      "copy-old",
      "record-old-latest",
      "2026-08-14T10:00:00.000Z",
      bytes,
    );
    const inactivePrevious = bigRecord(
      "copy-old",
      "record-old-previous",
      "2026-08-14T09:00:00.000Z",
      bytes,
    );
    const plan = planBrowserRecoveryRetention(
      [
        session("copy-active", {
          latest: activeLatest,
          previous: activePrevious,
        }),
        session("copy-old", {
          latest: inactiveLatest,
          previous: inactivePrevious,
        }),
      ],
      "copy-active",
    );
    expect(plan.deleteRecordIds).toEqual(["record-old-previous"]);
    expect(
      plan.sessions.find((entry) => entry.workingCopyId === "copy-old")
        ?.previous,
    ).toBeNull();
  });

  it("prefers the inactive previous generation even when it is newer", () => {
    const bytes = BROWSER_RECOVERY_MAX_RECORD_BYTES;
    const activeLatest = bigRecord(
      "copy-active",
      "record-active-latest",
      "2026-08-14T12:00:00.000Z",
      bytes,
    );
    const activePrevious = bigRecord(
      "copy-active",
      "record-active-previous",
      "2026-08-14T09:00:00.000Z",
      bytes,
    );
    const inactiveLatest = bigRecord(
      "copy-old",
      "record-old-latest",
      "2026-08-14T11:00:00.000Z",
      bytes,
    );
    const inactivePrevious = bigRecord(
      "copy-old",
      "record-old-previous",
      "2026-08-14T10:00:00.000Z",
      bytes,
    );
    const plan = planBrowserRecoveryRetention(
      [
        session("copy-active", {
          latest: activeLatest,
          previous: activePrevious,
        }),
        session("copy-old", {
          latest: inactiveLatest,
          previous: inactivePrevious,
        }),
      ],
      "copy-active",
    );
    expect(plan.deleteRecordIds).toEqual(["record-old-previous"]);
    expect(
      plan.sessions.find((entry) => entry.workingCopyId === "copy-active")
        ?.previous?.recordId,
    ).toBe("record-active-previous");
  });

  it("keeps records that fit exactly under the caps", () => {
    const bytes = BROWSER_RECOVERY_MAX_TOTAL_BYTES / 3;
    const activeLatest = bigRecord(
      "copy-active",
      "record-active-latest",
      "2026-08-14T12:00:00.000Z",
      bytes,
    );
    const activePrevious = bigRecord(
      "copy-active",
      "record-active-previous",
      "2026-08-14T11:00:00.000Z",
      bytes,
    );
    const inactiveLatest = bigRecord(
      "copy-old",
      "record-old-latest",
      "2026-08-14T10:00:00.000Z",
      bytes,
    );
    const plan = planBrowserRecoveryRetention(
      [
        session("copy-active", {
          latest: activeLatest,
          previous: activePrevious,
        }),
        session("copy-old", { latest: inactiveLatest }),
      ],
      "copy-active",
    );
    expect(plan.deleteRecordIds).toEqual([]);
    expect(plan.sessions).toHaveLength(2);
  });

  it("never plans deletion of the active latest record", () => {
    const bytes = BROWSER_RECOVERY_MAX_RECORD_BYTES;
    const activeLatest = bigRecord(
      "copy-active",
      "record-active-latest",
      "2026-08-14T12:00:00.000Z",
      bytes,
    );
    const activePrevious = bigRecord(
      "copy-active",
      "record-active-previous",
      "2026-08-14T11:00:00.000Z",
      bytes,
    );
    const inactiveLatest = bigRecord(
      "copy-old",
      "record-old-latest",
      "2026-08-14T10:00:00.000Z",
      bytes,
    );
    const inactivePrevious = bigRecord(
      "copy-old",
      "record-old-previous",
      "2026-08-14T09:00:00.000Z",
      bytes,
    );
    const plan = planBrowserRecoveryRetention(
      [
        session("copy-active", {
          latest: activeLatest,
          previous: activePrevious,
        }),
        session("copy-old", {
          latest: inactiveLatest,
          previous: inactivePrevious,
        }),
      ],
      "copy-active",
    );
    expect(plan.deleteRecordIds).not.toContain("record-active-latest");
    expect(plan.deleteRecordIds).toEqual(["record-old-previous"]);
    expect(plan.sessions).toHaveLength(BROWSER_RECOVERY_MAX_SESSIONS);
  });
});
