import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_SESSION_LIMITS } from "./session-state.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readRepositoryText(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("Agent session protocol documentation", () => {
  it("tracks the deployed credential and idempotency lifetimes", () => {
    const claimMinutes = DEFAULT_AGENT_SESSION_LIMITS.claimTtlMs / 60_000;
    const bearerHours = DEFAULT_AGENT_SESSION_LIMITS.tokenTtlMs / 3_600_000;
    const sessionDays = DEFAULT_AGENT_SESSION_LIMITS.sessionTtlMs / 86_400_000;
    const resultMinutes =
      DEFAULT_AGENT_SESSION_LIMITS.resultCacheTtlMs / 60_000;
    const documents = ["docs/specs/web-agent-session.md"];

    for (const relativePath of documents) {
      const text = readRepositoryText(relativePath);
      expect(text, relativePath).toMatch(
        new RegExp(`${claimMinutes}(?:-| )minute`, "u"),
      );
      expect(text, relativePath).toContain(`${bearerHours} hours`);
      expect(text, relativePath).toContain(`${sessionDays} days`);
      expect(text, relativePath).toContain(`${resultMinutes} minutes`);
    }
  });
});
