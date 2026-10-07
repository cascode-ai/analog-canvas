import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseOptions } from "./gallery-author-parts.mjs";

let directory;
let snapshot;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "icm-gallery-author-parts-"));
  snapshot = join(directory, "gallery.sqlite");
  const db = new DatabaseSync(snapshot);
  db.exec(`CREATE TABLE gallery_entries (
    id TEXT PRIMARY KEY, name TEXT, author TEXT, status TEXT, created_at TEXT,
    owner_user_id TEXT, project_text TEXT, component_count INTEGER,
    component_count_version INTEGER)`);
  const drawing = JSON.stringify({ documents: [{ id: "top", instances: [] }] });
  const insert = db.prepare(
    "INSERT INTO gallery_entries VALUES (?, ?, 'Maker', ?, ?, 'owner-1', ?, ?, 1)",
  );
  insert.run("a", "First", "public", "2026-10-01T08:00:00Z", drawing, 6);
  insert.run("b", "Rejected", "rejected", "2026-10-02T08:00:00Z", drawing, 9);
  insert.run(
    "c",
    "Second, revised",
    "public",
    "2026-10-03T08:00:00Z",
    drawing,
    12,
  );
  db.close();
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("Gallery author part counts command", () => {
  it("prints the counts and writes the itemized CSV", () => {
    const csv = join(directory, "bill.csv");
    const output = execFileSync(
      process.execPath,
      [
        "scripts/gallery-author-parts.mjs",
        "--author",
        "Maker",
        "--backup",
        snapshot,
        "--csv",
        csv,
      ],
      { encoding: "utf8" },
    );
    expect(output).toContain("Maker：第 1–2 个，共 2 个电路，18 个元件");
    expect(output).toContain("被拒、不计入：Rejected（b）");
    expect(output).not.toContain("元（");
    expect(output).toContain("--after c");
    const rows = readFileSync(csv, "utf8")
      .replace(/^﻿/u, "")
      .trim()
      .split("\n");
    expect(rows[0]).toBe("序号,上传时间 (UTC),电路,元件数,备注,链接");
    expect(rows[2]).toContain('"Second, revised",12,,');
    expect(rows.at(-1)).toBe("合计,,2 个电路,18,,");
  });

  it("asks for a whole circuit number and one boundary", () => {
    expect(() => parseOptions([])).toThrow(/--author NAME/);
    expect(() => parseOptions(["--author", "Maker", "--from", "1.5"])).toThrow(
      /circuit number/,
    );
    expect(() =>
      parseOptions(["--author", "Maker", "--from", "2", "--after", "a"]),
    ).toThrow(/pass one/);
    expect(parseOptions(["--author", "Maker", "--from", "51"])).toEqual({
      author: "Maker",
      from: 51,
    });
  });
});
