import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AgentProductionCircuitRequestSchema } from "./schema.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("Agent session protocol documentation", () => {
  it("validates raw HTTP examples and separates preview from commit identity", () => {
    const examples = [
      ...readFileSync(resolve(repositoryRoot, "docs/agent/examples.md"), "utf8")
        .replaceAll("\r\n", "\n")
        .matchAll(/```json\n([\s\S]*?)\n```/g),
    ].map((match) => JSON.parse(match[1]!));
    for (const example of examples)
      expect(
        AgentProductionCircuitRequestSchema.safeParse(example),
      ).toMatchObject({ success: true });
    const [, preview, commit] = examples;
    expect(preview.edits).toEqual(commit.edits);
    expect(preview.expectedRevision).toBe(commit.expectedRevision);
    expect(preview.dryRun).toBe(true);
    expect(commit.dryRun).toBe(false);
    expect(preview.requestId).not.toBe(commit.requestId);
    expect(preview.transactionId).not.toBe(commit.transactionId);
  });
});
