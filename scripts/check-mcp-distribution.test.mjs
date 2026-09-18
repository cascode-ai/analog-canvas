import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "check-mcp-distribution.mjs");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture({ version = "0.15.6", packageVersion = version } = {}) {
  const root = mkdtempSync(join(tmpdir(), "icm-mcp-check-"));
  roots.push(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "apps/mcp-server"), { recursive: true });
  copyFileSync(script, join(root, "scripts/check-mcp-distribution.mjs"));
  writeFileSync(
    join(root, "config/agent-mcp-distribution.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        name: "analog-canvas",
        version,
        node: ">=24.0.0",
        packageName: "@analog-canvas/mcp-server",
        binaryName: "analog-canvas-mcp",
        npmPublished: false,
        release: {
          buildPlatform: "linux",
          repository: "cascode-ai/analog-canvas",
          tag: `mcp-v${version}`,
          asset: `analog-canvas-mcp-server-${version}.tgz`,
          sha256: "a".repeat(64),
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "apps/mcp-server/package.json"),
    `${JSON.stringify({ name: "@icm/mcp-server", version: packageVersion }, null, 2)}\n`,
  );
  return root;
}

function run(root) {
  try {
    return {
      code: 0,
      output: execFileSync(
        process.execPath,
        [join(root, "scripts/check-mcp-distribution.mjs")],
        {
          encoding: "utf8",
          stdio: "pipe",
        },
      ),
    };
  } catch (error) {
    return { code: error.status, output: String(error.stderr) };
  }
}

describe("check-mcp-distribution", () => {
  it("accepts a consistent declaration", () => {
    const root = fixture();
    const { code, output } = run(root);
    expect(code).toBe(0);
    expect(output).toContain("internally consistent");
  });

  it("fails when the workspace package version drifts from the declaration", () => {
    // The drift was real: the workspace package sat at 0.15.0 while the
    // declared release was 0.15.6, because nothing compared them.
    const root = fixture({ packageVersion: "0.15.0" });
    const { code, output } = run(root);
    expect(code).not.toBe(0);
    expect(output).toMatch(
      /version 0\.15\.0 must match the distribution version 0\.15\.6/su,
    );
  });
});
