import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CURRENT_SYMBOL_LIBRARY_LOCK } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  parseProject,
  serializeProject,
  tryParseProjectWithMetadata,
} from "./index.js";

const legacyText = readFileSync(
  resolve(
    process.cwd(),
    "fixtures/projects/legacy-symbol-library/project.icproj.json",
  ),
  "utf8",
);
const retiredLock = {
  hash: "development",
  id: "builtin-analog",
  version: "0.0.0",
};

/** The fixture saved today, so loading it migrates nothing but its lock. */
const currentText = serializeProject(parseProject(legacyText));

function withLock(lock: unknown): string {
  const raw = JSON.parse(currentText) as Record<string, unknown>;
  return JSON.stringify({ ...raw, symbolLibrary: lock });
}

describe("retired Symbol Library lock", () => {
  it("loads the development lock as the current lock and saves it", () => {
    const result = tryParseProjectWithMetadata(legacyText);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceSchemaVersion).toBe(70);
    expect(result.migrated).toBe(true);
    expect(result.project.symbolLibrary).toEqual(CURRENT_SYMBOL_LIBRARY_LOCK);
    const saved = serializeProject(result.project);
    expect(saved).not.toContain("builtin-analog");
    expect(serializeProject(parseProject(saved))).toBe(saved);
  });

  it("marks a current-schema file carrying the retired lock as migrated", () => {
    const result = tryParseProjectWithMetadata(withLock(retiredLock));
    expect(result.ok && result.migrated).toBe(true);
    expect(result.ok && result.project.symbolLibrary).toEqual(
      CURRENT_SYMBOL_LIBRARY_LOCK,
    );
  });

  it("keeps every other lock exactly as written", () => {
    for (const lock of [
      { ...retiredLock, hash: "other" },
      { id: "builtin-analog", version: "1", hash: "development" },
      { id: "vendor-symbols", version: "2", hash: "abc" },
    ]) {
      const result = tryParseProjectWithMetadata(withLock(lock));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.migrated).toBe(false);
      expect(result.project.symbolLibrary).toEqual(lock);
    }
  });
});
