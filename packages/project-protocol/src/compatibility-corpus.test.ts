import { withProjectComponentDefinitions } from "@icm/symbols";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";
import {
  parseProject,
  serializeProject,
  tryParseProjectWithMetadata,
} from "./index.js";

interface CompatibilityCorpus {
  readonly current: readonly string[];
  readonly migrated: readonly { path: string; sourceSchemaVersion: number }[];
  readonly rejected: readonly { path: string; error: string }[];
}

const repositoryRoot = process.cwd();
const corpus = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, "fixtures/projects/compatibility-corpus.json"),
    "utf8",
  ),
) as CompatibilityCorpus;

function readProject(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

function trackedProjectPaths(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--", "fixtures/projects", "netlists"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter((path) =>
      /^(?:fixtures\/projects\/.+\/project|netlists\/.+)\.icproj\.json$/u.test(
        path,
      ),
    )
    .sort();
}

function assertCurrentForm(serialized: string): void {
  const project = parseProject(serialized);
  expect(project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
  expect(serializeProject(project)).toBe(serialized);
  expect(serialized).not.toContain('"spice.');
  expect(serialized).not.toContain('"routeAttachment"');
}

describe("supported Project compatibility corpus", () => {
  it("lists every shipped fixture and saved circuit Project exactly once", () => {
    const listed = [
      ...corpus.current,
      ...corpus.migrated.map((entry) => entry.path),
      ...corpus.rejected.map((entry) => entry.path),
    ].sort();
    const discovered = trackedProjectPaths();

    expect(listed).toEqual(discovered);
  });

  it("keeps every accepted fixture in canonical current form", () => {
    for (const path of corpus.current) {
      assertCurrentForm(readProject(path));
    }
  });

  it("loads retained migration witnesses and saves canonical current Projects", () => {
    for (const entry of corpus.migrated) {
      const original = readProject(entry.path);
      const result = tryParseProjectWithMetadata(original);
      expect(result.ok, entry.path).toBe(true);
      if (!result.ok) continue;
      expect(result.sourceSchemaVersion).toBe(entry.sourceSchemaVersion);
      expect(result.migrated).toBe(true);
      const saved = serializeProject(result.project);
      assertCurrentForm(saved);
      expect(parseProject(saved)).toEqual(
        withProjectComponentDefinitions(result.project),
      );
    }
  });

  it("retains invalid fixture cases as explicit rejected inputs", () => {
    for (const entry of corpus.rejected) {
      expect(() => parseProject(readProject(entry.path))).toThrow(entry.error);
    }
  });
});
