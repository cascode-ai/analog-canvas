import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it, expect } from "vitest";

it("validates a complete visual audit without an origin, credential or writes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gallery-curation-"));
  try {
    const report = path.join(dir, "report.json");
    const row = {
      id: "circuit-1",
      previewRevision: "existing-revision",
      imageReviewed: true,
      tags: ["amplifier"],
      issues: [],
    };
    writeFileSync(report, JSON.stringify({ total: 1, entries: [row] }));
    const output = execFileSync(
      process.execPath,
      ["scripts/curate-gallery.mjs", "--report", report],
      { encoding: "utf8" },
    );
    expect(JSON.parse(output)).toEqual({
      reviewed: 1,
      needsAttention: 0,
      mode: "validate-only",
    });
    writeFileSync(
      report,
      JSON.stringify({ total: 1, entries: [{ ...row, imageReviewed: false }] }),
    );
    expect(() =>
      execFileSync(
        process.execPath,
        ["scripts/curate-gallery.mjs", "--report", report],
        { stdio: "pipe" },
      ),
    ).toThrow();
    writeFileSync(report, JSON.stringify({ total: 2, entries: [row] }));
    expect(() =>
      execFileSync(
        process.execPath,
        ["scripts/curate-gallery.mjs", "--report", report],
        { stdio: "pipe" },
      ),
    ).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
