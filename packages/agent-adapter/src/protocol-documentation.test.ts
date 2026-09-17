import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_SESSION_LIMITS } from "./session-state.js";
import { AgentProductionCircuitRequestSchema } from "./schema.js";
import { agentCircuitOpenApi } from "./openapi.js";
import { agentApiHelp } from "./agent-api-help.generated.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readRepositoryText(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("Agent session protocol documentation", () => {
  it("publishes every canonical operation description without a second prose source", () => {
    const operations = Object.values(agentCircuitOpenApi.paths).flatMap(
      (path) => Object.values(path),
    );
    expect(operations.map((operation) => operation.operationId).sort()).toEqual(
      Object.keys(agentApiHelp).sort(),
    );
    for (const operation of operations) {
      expect(operation.description).toBe(
        agentApiHelp[operation.operationId as keyof typeof agentApiHelp],
      );
    }
  });
  it("validates raw HTTP examples and separates preview from commit identity", () => {
    const examples = [
      ...readRepositoryText("docs/agent/examples.md")
        .replaceAll("\r\n", "\n")
        .matchAll(/```json\n([\s\S]*?)\n```/g),
    ].map((match) => JSON.parse(match[1]!));
    expect(examples).toHaveLength(3);
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
  it("tracks the deployed credential and idempotency lifetimes", () => {
    const claimMinutes = DEFAULT_AGENT_SESSION_LIMITS.claimTtlMs / 60_000;
    const bearerHours = DEFAULT_AGENT_SESSION_LIMITS.tokenTtlMs / 3_600_000;
    const idleMinutes = DEFAULT_AGENT_SESSION_LIMITS.sessionTtlMs / 60_000;
    const resultMinutes =
      DEFAULT_AGENT_SESSION_LIMITS.resultCacheTtlMs / 60_000;
    const documents = ["docs/specs/web-agent-session.md"];

    for (const relativePath of documents) {
      const text = readRepositoryText(relativePath);
      expect(text, relativePath).toMatch(
        new RegExp(`${claimMinutes}(?:-| )minute`, "u"),
      );
      expect(text, relativePath).toContain(`${bearerHours} hours`);
      expect(text, relativePath).toContain(
        `${idleMinutes} minutes of inactivity`,
      );
      expect(text, relativePath).toContain(`${resultMinutes} minutes`);
    }
  });
});
