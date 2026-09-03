import { describe, expect, it } from "vitest";
import type { AgentDiagnostic } from "@icm/agent-adapter";
import {
  changedObjectIds,
  countDiagnostics,
  snapshotSummary,
  SnapshotCache,
  type CachedSnapshot,
} from "./snapshot-cache.js";
import { testSnapshot } from "./test-support/snapshot-fixture.js";

function cachedEntry(revision = 5): CachedSnapshot {
  return {
    documentId: "main",
    revision,
    snapshot: testSnapshot(),
    diagnostics: [],
    fetchedAt: 1_000,
    requestId: "req-1",
    dirty: false,
  };
}

describe("snapshot cache", () => {
  it("counts the authoritative response diagnostics once, not both projections", () => {
    const entry = cachedEntry();
    const extra: AgentDiagnostic[] = [
      ...entry.snapshot.document.diagnostics,
      { code: "ERC_FLOATING", severity: "error", message: "floating pin" },
    ];
    const summary = snapshotSummary({ ...entry, diagnostics: extra });
    expect(summary).toEqual({
      projectId: "project-1",
      documentId: "main",
      documentName: "Main",
      revision: 5,
      instanceCount: 2,
      netCount: 2,
      errors: 1,
      warnings: 1,
    });
  });

  it("counts severities deterministically", () => {
    const { errors, warnings } = countDiagnostics([
      { code: "A", severity: "error", message: "a" },
      { code: "B", severity: "warning", message: "b" },
      { code: "C", severity: "info", message: "c" },
      { code: "D", severity: "error", message: "d" },
    ]);
    expect(errors).toBe(2);
    expect(warnings).toBe(1);
  });

  it("marks dirty on revision change and clears it on refresh", () => {
    const cache = new SnapshotCache();
    cache.set(cachedEntry());
    cache.markDirty("main", 6);
    const dirty = cache.get("main");
    expect(dirty?.revision).toBe(6);
    expect(dirty?.dirty).toBe(true);
    cache.set({ ...cachedEntry(6), requestId: "req-2" });
    expect(cache.get("main")?.dirty).toBe(false);
    expect(cache.documents()).toEqual(["main"]);
  });

  it("diffs added, removed, and content-changed object ids", () => {
    const before = testSnapshot();
    const after = testSnapshot();
    after.document.instances.push({
      ...after.document.instances[1]!,
      id: "instance-3",
      reference: "R2",
    });
    after.document.nets[0]!.name = "VoutX";
    const changed = changedObjectIds(before, after);
    expect(changed).toContain("instance-3");
    expect(changed).toContain("net-vout");
    expect(changed).not.toContain("instance-1");
  });
});
