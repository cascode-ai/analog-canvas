import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";

import { tryParseProjectWithMetadata } from "./load.js";
import { serializeProject } from "./save.js";
import {
  upgradeSchema32To33,
  upgradeSchema32To33WithReport,
} from "./transforms/explicit-equivalence.js";

function schema32Project(): Record<string, unknown> {
  const current = createEmptyProject("connectivity", "Connectivity");
  return {
    ...(JSON.parse(serializeProject(current)) as Record<string, unknown>),
    schemaVersion: 32,
  };
}

function firstDocument(
  project: Record<string, unknown>,
): Record<string, unknown> {
  const documents = project.documents;
  if (!Array.isArray(documents) || typeof documents[0] !== "object") {
    throw new Error("Expected one Project Document");
  }
  return documents[0] as Record<string, unknown>;
}

function addOwnerlessEquivalence(project: Record<string, unknown>): void {
  const document = firstDocument(project);
  document.nets = [
    { id: "net-a", terminals: [] },
    { id: "net-b", terminals: [] },
  ];
  document.connectivityEvidence = [
    {
      id: "hidden-union",
      kind: "explicit-equivalence",
      memberNetIds: ["net-a", "net-b"],
    },
  ];
}

describe("schema 32 to 33 migration (ownerless Net equivalence)", () => {
  it("changes only the version stamp when no hidden equivalence exists", () => {
    const previous = schema32Project();

    expect(upgradeSchema32To33(previous)).toEqual({
      ...previous,
      schemaVersion: 33,
    });
    expect(upgradeSchema32To33WithReport(previous).report).toEqual({
      changed: false,
    });
  });

  it("loads an ordinary schema-32 Project through canonical schema 35", () => {
    const result = tryParseProjectWithMetadata(
      JSON.stringify(schema32Project()),
    );

    expect(result).toMatchObject({
      ok: true,
      sourceSchemaVersion: 32,
      migrated: true,
      project: { schemaVersion: 35 },
    });
  });

  it("rejects ownerless equivalence instead of guessing replacement semantics", () => {
    const previous = schema32Project();
    addOwnerlessEquivalence(previous);

    expect(tryParseProjectWithMetadata(JSON.stringify(previous))).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "INVALID_PROJECT",
          message:
            "Schema 32 explicit-equivalence has no authoring owner and cannot be migrated safely; replace it with physical topology, owner-addressed Net Labels, or hierarchy terminals",
          path: ["documents", 0, "connectivityEvidence", 0],
        },
      ],
    });
  });

  it("does not admit the retired record in a current schema-35 Project", () => {
    const current = schema32Project();
    current.schemaVersion = 34;
    addOwnerlessEquivalence(current);

    const result = tryParseProjectWithMetadata(JSON.stringify(current));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_PROJECT",
          path: ["documents", 0, "connectivityEvidence", 0, "kind"],
        }),
      ]),
    );
  });
});
