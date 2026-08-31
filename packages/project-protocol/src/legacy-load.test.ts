/**
 * Issue #446: a Project saved days earlier ("上周保存的project") was refused
 * with UNSUPPORTED_SCHEMA_VERSION. The `.icproj.json` file is the canonical
 * Project — a saved file must keep loading after the schema moves on.
 *
 * The per-version upgrade transforms all exist and are individually tested;
 * what regressed was the loader's acceptance window, which kept only
 * {previous, current} while the schema advanced 11 versions in nine days.
 * These tests pin the whole reachable chain: every version the transform
 * chain can carry must load, oldest first, with the #446 reporter's real
 * file as the end-to-end witness.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";
import { describe, expect, it } from "vitest";

import { serializeProject } from "./save.js";
import { tryParseProjectWithMetadata } from "./load.js";
import { createEmptyProject } from "@icm/model";

const OLDEST_CHAINED_VERSION = 24;

const reporterFile = readFileSync(
  resolve(
    process.cwd(),
    "fixtures/legacy-projects/issue-446-bias-ini.v25.icproj.json",
  ),
  "utf8",
);

/**
 * A minimal Project stamped with an older schemaVersion. The collections a
 * fresh Project carries are empty, and every historical migration step is a
 * no-op over empty collections, so the same minimal shape is a valid
 * starting point at each version — what changes per version is which
 * upgrade steps must run to bring `schemaVersion` forward.
 */
function minimalProjectAt(version: number): string {
  const project = JSON.parse(
    serializeProject(createEmptyProject("legacy-load", "Legacy load")),
  ) as Record<string, unknown>;
  project.schemaVersion = version;
  return JSON.stringify(project);
}

describe("legacy Project loading (#446)", () => {
  it("loads the #446 reporter's real v25 file, contents intact", () => {
    const result = tryParseProjectWithMetadata(reporterFile);
    expect(
      result.ok,
      result.ok
        ? ""
        : `refused: ${result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ")}`,
    ).toBe(true);
    if (!result.ok) return;
    expect(result.sourceSchemaVersion).toBe(25);
    expect(result.migrated).toBe(true);
    expect(result.project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    const document = result.project.documents[0]!;
    // The circuit the reporter drew survives the migration intact.
    expect(result.project.name).toBe("BIAS_INI");
    expect(document.instances).toHaveLength(15);
    expect(document.nets).toHaveLength(11);
    expect(document.routes).toHaveLength(33);
  });

  const versions = Array.from(
    { length: CURRENT_PROJECT_SCHEMA_VERSION - OLDEST_CHAINED_VERSION },
    (_, index) => OLDEST_CHAINED_VERSION + index,
  );
  it.each(versions)("loads a minimal v%i project through the chain", (version) => {
    const result = tryParseProjectWithMetadata(minimalProjectAt(version));
    expect(
      result.ok,
      result.ok
        ? ""
        : `refused: ${result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ")}`,
    ).toBe(true);
    if (!result.ok) return;
    expect(result.sourceSchemaVersion).toBe(version);
    expect(result.migrated).toBe(true);
    expect(result.project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
  });

  it("still refuses versions older than the chain start", () => {
    const result = tryParseProjectWithMetadata(minimalProjectAt(23));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
  });

  it("still loads a current-version project unmigrated", () => {
    const result = tryParseProjectWithMetadata(
      minimalProjectAt(CURRENT_PROJECT_SCHEMA_VERSION),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(false);
  });
});
