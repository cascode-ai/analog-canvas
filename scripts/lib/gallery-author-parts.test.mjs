import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  claimedTransistors,
  countAuthorParts,
  drawnTransistors,
  readAuthorEntries,
} from "./gallery-author-parts.mjs";

let directory;
let snapshot;

/** A drawing with `mos` transistors and `resistors` resistors on its top Cell. */
function drawing(mos, resistors = 0) {
  const instances = [
    ...Array.from({ length: mos }, (_, i) => ({ id: `M${i}`, type: "nmos" })),
    ...Array.from({ length: resistors }, (_, i) => ({
      id: `R${i}`,
      type: "resistor",
    })),
    { id: "P1", type: "port" },
  ];
  return JSON.stringify({
    topDocumentId: "top",
    documents: [{ id: "top", instances }],
    componentDefinitions: [
      { symbol: { id: "nmos" }, electrical: { deviceClass: "mos" } },
      { symbol: { id: "resistor" }, electrical: { deviceClass: "resistor" } },
      { symbol: { id: "port" } },
    ],
  });
}

function seed(rows) {
  const db = new DatabaseSync(snapshot);
  db.exec(`CREATE TABLE gallery_entries (
    id TEXT PRIMARY KEY, name TEXT, author TEXT, status TEXT,
    created_at TEXT, owner_user_id TEXT, project_text TEXT,
    component_count INTEGER NOT NULL DEFAULT 0,
    component_count_version INTEGER NOT NULL DEFAULT 0)`);
  const insert = db.prepare(
    "INSERT INTO gallery_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const row of rows)
    insert.run(
      row.id,
      row.name,
      row.author ?? "Maker",
      row.status ?? "public",
      row.createdAt,
      row.owner ?? "owner-1",
      row.projectText ?? drawing(row.parts),
      row.parts,
      row.rule ?? 1,
    );
  db.close();
}

const day = (n) => `2026-10-${String(n).padStart(2, "0")}T08:00:00.000Z`;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "icm-gallery-author-parts-lib-"));
  snapshot = join(directory, "gallery.sqlite");
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("an author's Gallery part counts", () => {
  it("reads the transistor count a name states", () => {
    expect(claimedTransistors("13T-Adder")).toBe(13);
    expect(claimedTransistors("10-T full adder design")).toBe(10);
    expect(claimedTransistors("The Full adder using 26 transistor")).toBe(26);
    expect(claimedTransistors("Hybrid full adder (HFA-22T).")).toBe(22);
    expect(claimedTransistors("CMOS Schmitt trigger")).toBeNull();
    expect(claimedTransistors("OTA")).toBeNull();
  });

  it("counts the public circuits after the counted ones, by number or by entry", () => {
    seed([
      { id: "a", name: "First", createdAt: day(1), parts: 6 },
      {
        id: "b",
        name: "Withdrawn early",
        createdAt: day(2),
        parts: 30,
        status: "recycled",
      },
      { id: "c", name: "Second", createdAt: day(3), parts: 12 },
      { id: "d", name: "13T-Adder", createdAt: day(4), parts: 10 },
      {
        id: "e",
        name: "Retaken",
        createdAt: day(5),
        parts: 20,
        status: "recycled",
      },
      { id: "f", name: "Third", createdAt: day(6), parts: 3 },
      {
        id: "x",
        name: "Someone else",
        createdAt: day(7),
        parts: 50,
        author: "Other",
        owner: "owner-2",
      },
    ]);
    const { owner, entries } = readAuthorEntries(snapshot, { author: "maker" });
    expect(owner).toBe("owner-1");
    const byNumber = countAuthorParts(entries, { from: 2 });
    expect(countAuthorParts(entries, { after: "a" })).toEqual(byNumber);
    expect(
      byNumber.circuits.map((entry) => [entry.number, entry.id, entry.parts]),
    ).toEqual([
      [2, "c", 12],
      [3, "d", 10],
      [4, "f", 3],
    ]);
    expect(byNumber.circuits[1].transistors).toEqual({
      claimed: 13,
      drawn: 10,
    });
    expect(byNumber.withdrawn.map((entry) => entry.id)).toEqual(["b", "e"]);
    expect(byNumber).toMatchObject({ parts: 25, nextAfter: "f" });
    expect(countAuthorParts(entries, { after: "f" })).toMatchObject({
      circuits: [],
      parts: 0,
      nextAfter: "f",
    });
  });

  it("refuses an ambiguous byline, an unknown boundary and uncounted circuits", () => {
    seed([
      { id: "a", name: "Mine", createdAt: day(1), parts: 12 },
      {
        id: "b",
        name: "Not counted yet",
        createdAt: day(2),
        parts: 0,
        rule: 0,
      },
      {
        id: "c",
        name: "Namesake",
        createdAt: day(3),
        parts: 5,
        owner: "owner-2",
      },
    ]);
    expect(() => readAuthorEntries(snapshot, { author: "Maker" })).toThrow(
      /Several accounts.*--owner/,
    );
    expect(() => readAuthorEntries(snapshot, { author: "Nobody" })).toThrow(
      /No Gallery entry/,
    );
    const { entries } = readAuthorEntries(snapshot, { owner: "owner-1" });
    expect(() => countAuthorParts(entries, { after: "zzz" })).toThrow(
      /No entry zzz/,
    );
    expect(() => countAuthorParts(entries, { from: 9 })).toThrow(
      /only 2 public/,
    );
    expect(() => countAuthorParts(entries, { from: 2 })).toThrow(
      /not stored yet for b/,
    );
  });

  it("flags a stated transistor count only for a one-Cell drawing", () => {
    expect(drawnTransistors(drawing(10, 3))).toBe(10);
    const hierarchy = JSON.parse(drawing(4));
    hierarchy.documents.push({ id: "cell", instances: [] });
    expect(drawnTransistors(JSON.stringify(hierarchy))).toBeNull();
    seed([
      {
        id: "h",
        name: "24T full adder",
        createdAt: day(1),
        parts: 6,
        projectText: JSON.stringify(hierarchy),
      },
    ]);
    const { entries } = readAuthorEntries(snapshot, { author: "Maker" });
    expect(countAuthorParts(entries).circuits[0]).not.toHaveProperty(
      "transistors",
    );
  });
});
