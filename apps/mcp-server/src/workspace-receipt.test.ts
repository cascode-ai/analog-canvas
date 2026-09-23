import { describe, expect, it } from "vitest";
import { workspaceSyncReceipt } from "./workspace-receipt.js";

describe("task-scoped sync receipts", () => {
  const result = (count: number) => ({
    ok: true,
    filesystem: "mcp-host",
    basePath: "/base",
    indexPath: "/base/index.json",
    workPath: "/base/work",
    serverUrl: "https://canvas.test",
    projectId: "p",
    projectIdentity: "cloud:p",
    workspaceFileCount: count,
    runs: Array.from({ length: 100 }, (_, i) => ({
      runId: `old-${i}`,
      execution: "completed" as const,
      collection: "complete" as const,
      files: 100,
    })),
    runId: "run",
    transfer: { selected: count, downloaded: count, reused: 0, remaining: 0 },
    files: Array.from({ length: count }, (_, i) => ({
      ok: true,
      id: `f${i}`,
      name: `f${i}`,
      mediaType: "text/plain",
      byteLength: 1,
      sha256: "a".repeat(64),
      outputPath: `/base/f${i}`,
      reused: false,
      timing: { elapsedMs: 1, remoteWaitMs: 0 },
    })),
  });
  it("keeps small selection paths and omits unrelated history", () => {
    const full = result(2);
    const receipt = workspaceSyncReceipt(full);
    expect(receipt.files).toHaveLength(2);
    expect(receipt.files[0]?.outputPath).toBe("/base/f0");
    expect(receipt).not.toHaveProperty("runs");
    expect(receipt.files[0]).not.toHaveProperty("sha256");
    expect(full.runs).toHaveLength(100);
    expect(full.files[0]?.sha256).toHaveLength(64);
  });
  it("bounds archive receipts without hiding failure or the full directory location", () => {
    const full = {
      ...result(100),
      ok: false,
      error: {
        code: "WORKSPACE_DOWNLOAD_INCOMPLETE",
        fileId: "bad",
        message: "denied",
      },
    };
    const receipt = workspaceSyncReceipt(full);
    expect(receipt).toMatchObject({
      ok: false,
      files: [],
      filesOmitted: 100,
      error: full.error,
      fileMetadata: { indexPath: full.indexPath, runId: "run" },
    });
    expect(JSON.stringify(receipt).length).toBeLessThan(1000);
    expect(full.files).toHaveLength(100);
  });
});
