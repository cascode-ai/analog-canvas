import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { newestSnapshot, olderSnapshots } from "./gallery-snapshots.mjs";

const capture = (time, run = 1) => `gallery-${time}Z-${run}-1`;
const verified = { consistentCapture: true, offlineRestoreVerified: true };

let directory;

function snapshot(
  name,
  { manifest = verified, database = true, file = "gallery.sqlite" } = {},
) {
  const path = join(directory, name);
  mkdirSync(path);
  if (database) {
    const db = new DatabaseSync(join(path, file));
    db.exec("CREATE TABLE gallery_entries (id TEXT PRIMARY KEY)");
    db.close();
  } else writeFileSync(join(path, file), "damaged in transit");
  if (manifest)
    writeFileSync(join(path, "manifest.json"), JSON.stringify(manifest));
}

const paths = (...names) => names.map((name) => join(directory, name));

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "icm-gallery-retention-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("downloaded Gallery snapshots", () => {
  it("selects every capture older than the newest two, oldest first", () => {
    for (const [time, run] of [
      ["2026-10-07T10-04-29", 5],
      ["2026-09-20T16-33-11", 1],
      ["2026-10-06T21-12-50", 4],
      ["2026-09-24T07-46-54", 2],
      ["2026-10-04T10-36-38", 3],
    ])
      snapshot(capture(time, run));
    expect(
      olderSnapshots(directory, 2, capture("2026-10-07T10-04-29", 5)),
    ).toEqual(
      paths(
        capture("2026-09-20T16-33-11", 1),
        capture("2026-09-24T07-46-54", 2),
        capture("2026-10-04T10-36-38", 3),
      ),
    );
  });

  it("neither counts nor selects partial, failed or foreign entries", () => {
    snapshot(capture("2026-09-20T16-33-11"));
    snapshot(capture("2026-09-24T07-46-54"));
    // Broken newer downloads must not push a good capture out.
    snapshot(capture("2026-10-05T08-00-00"), { manifest: null });
    snapshot(capture("2026-10-05T09-00-00"), {
      manifest: { consistentCapture: true },
    });
    snapshot(capture("2026-10-05T10-00-00"), { database: false });
    snapshot(capture("2026-10-05T11-00-00"), { manifest: null });
    writeFileSync(
      join(directory, capture("2026-10-05T11-00-00"), "manifest.json"),
      "{ truncated",
    );
    snapshot("gallery-notes");
    mkdirSync(join(directory, "local-replica"));
    writeFileSync(join(directory, ".DS_Store"), "");
    symlinkSync(
      join(directory, capture("2026-09-20T16-33-11")),
      join(directory, capture("2026-10-06T00-00-00")),
    );
    snapshot(capture("2026-10-07T10-04-29"));
    expect(
      olderSnapshots(directory, 2, capture("2026-10-07T10-04-29")),
    ).toEqual(paths(capture("2026-09-20T16-33-11")));
  });

  it("keeps the capture just obtained even when newer ones exist", () => {
    for (const time of [
      "2026-09-20T16-33-11",
      "2026-09-24T07-46-54",
      "2026-10-06T21-12-50",
      "2026-10-07T10-04-29",
    ])
      snapshot(capture(time));
    expect(
      olderSnapshots(directory, 2, capture("2026-09-24T07-46-54")),
    ).toEqual(paths(capture("2026-09-20T16-33-11")));
  });

  it("keeps whole-store captures by their own database", () => {
    const store = (time) => `store-${time}Z-7-1`;
    for (const time of [
      "2026-10-01T10-00-00",
      "2026-10-05T10-00-00",
      "2026-10-07T10-00-00",
    ])
      snapshot(store(time), { file: "store.sqlite" });
    // A Gallery-shaped copy among them is not a store capture.
    snapshot(store("2026-10-08T10-00-00"));
    expect(
      olderSnapshots(
        directory,
        2,
        store("2026-10-07T10-00-00"),
        "store.sqlite",
      ),
    ).toEqual(paths(store("2026-10-01T10-00-00")));
  });

  it("finds the newest downloaded snapshot that holds a database", () => {
    for (const name of [
      "gallery-2026-09-24T10-12-44Z-1-1",
      "gallery-2026-09-25T07-16-02Z-2-1",
    ])
      snapshot(name);
    // The newest capture is still downloading: it has no database yet.
    mkdirSync(join(directory, "gallery-2026-09-26T01-00-00Z-3-1"));
    expect(newestSnapshot(directory)).toBe(
      join(directory, "gallery-2026-09-25T07-16-02Z-2-1", "gallery.sqlite"),
    );
    expect(newestSnapshot(join(directory, "absent"))).toBeNull();
  });

  it("selects nothing while there are at most two captures", () => {
    snapshot(capture("2026-10-06T21-12-50"));
    snapshot(capture("2026-10-07T10-04-29"));
    expect(
      olderSnapshots(directory, 2, capture("2026-10-07T10-04-29")),
    ).toEqual([]);
  });
});
