import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "mcp-release-bump.mjs");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Fixture layout mirrors the repository: the distribution declaration owns
 * the release identity and the workspace package version follows it.
 */
function fixture({
  version = "0.15.6",
  buildPlatform = process.platform,
  sha256 = "a".repeat(64),
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "icm-mcp-bump-"));
  roots.push(root);
  const configPath = join(root, "config/agent-mcp-distribution.json");
  const workspacePath = join(root, "apps/mcp-server/package.json");
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "apps/mcp-server"), { recursive: true });
  writeFileSync(
    configPath,
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
          buildPlatform,
          repository: "cascode-ai/analog-canvas",
          tag: `mcp-v${version}`,
          asset: `analog-canvas-mcp-server-${version}.tgz`,
          sha256,
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    workspacePath,
    `${JSON.stringify({ name: "@icm/mcp-server", version: "0.15.0" }, null, 2)}\n`,
  );
  return { root, configPath, workspacePath };
}

function run(root, args) {
  try {
    return {
      code: 0,
      output: execFileSync(
        process.execPath,
        [
          script,
          ...args,
          // The script resolves its defaults from its own location, so point
          // it at the fixture explicitly instead of trusting cwd.
          "--config",
          join(root, "config/agent-mcp-distribution.json"),
          "--workspace-package",
          join(root, "apps/mcp-server/package.json"),
        ],
        { cwd: root, encoding: "utf8", stdio: "pipe" },
      ),
    };
  } catch (error) {
    return { code: error.status, output: String(error.stderr) };
  }
}

function writeBuild(root, assetName, digest) {
  const buildDir = join(root, "output/mcp");
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(join(buildDir, "SHA256SUMS.txt"), `${digest}  ${assetName}\n`);
  return buildDir;
}

describe("mcp-release-bump --version", () => {
  it("accepts the argument separator forwarded by pnpm scripts", () => {
    const { root, configPath } = fixture();
    expect(run(root, ["--", "--version", "0.15.7"]).code).toBe(0);
    expect(JSON.parse(readFileSync(configPath, "utf8")).version).toBe("0.15.7");
  });
  it("rewrites the release identity, clears the digest, and syncs the workspace package", () => {
    const { root, configPath, workspacePath } = fixture();
    const { code, output } = run(root, ["--version", "0.15.7"]);
    expect(code).toBe(0);
    const distribution = JSON.parse(readFileSync(configPath, "utf8"));
    expect(distribution.version).toBe("0.15.7");
    expect(distribution.release.tag).toBe("mcp-v0.15.7");
    expect(distribution.release.asset).toBe(
      "analog-canvas-mcp-server-0.15.7.tgz",
    );
    // An unstamped declaration must stay red in the distribution check.
    expect(distribution.release.sha256).toBe("");
    expect(JSON.parse(readFileSync(workspacePath, "utf8")).version).toBe(
      "0.15.7",
    );
    expect(output).toContain("--stamp");
  });

  it("keeps the file formatting stable", () => {
    const { root, configPath } = fixture();
    run(root, ["--version", "0.15.7"]);
    const text = readFileSync(configPath, "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('  "release": {');
  });

  it("refuses the current version", () => {
    const { root } = fixture({ version: "0.15.7" });
    expect(run(root, ["--version", "0.15.7"]).output).toMatch(
      /already declares/su,
    );
  });

  it("refuses a non-semver version", () => {
    const { root } = fixture();
    expect(run(root, ["--version", "next"]).output).toMatch(/plain semver/su);
  });

  it("requires exactly one mode", () => {
    const { root } = fixture();
    expect(run(root, []).output).toMatch(/exactly one mode/su);
    expect(run(root, ["--version", "0.15.7", "--stamp"]).output).toMatch(
      /exactly one mode/su,
    );
  });
});

describe("mcp-release-bump --stamp", () => {
  it("writes the built digest for the declared asset", () => {
    const { root, configPath } = fixture({ sha256: "" });
    const digest = "b".repeat(64);
    const buildDir = writeBuild(
      root,
      "analog-canvas-mcp-server-0.15.6.tgz",
      digest,
    );
    const { code, output } = run(root, ["--stamp", "--build-dir", buildDir]);
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(configPath, "utf8")).release.sha256).toBe(
      digest,
    );
    expect(output).toContain(digest);
  });

  it("refuses a build output naming another asset", () => {
    const { root } = fixture({ sha256: "" });
    const buildDir = writeBuild(
      root,
      "analog-canvas-mcp-server-0.15.5.tgz",
      "b".repeat(64),
    );
    expect(run(root, ["--stamp", "--build-dir", buildDir]).output).toMatch(
      /was not built/su,
    );
  });

  it("refuses to stamp off the declared build platform", () => {
    const otherPlatform = process.platform === "linux" ? "darwin" : "linux";
    const { root } = fixture({ buildPlatform: otherPlatform, sha256: "" });
    const buildDir = writeBuild(
      root,
      "analog-canvas-mcp-server-0.15.6.tgz",
      "b".repeat(64),
    );
    expect(run(root, ["--stamp", "--build-dir", buildDir]).output).toMatch(
      /declared digest comes from a/su,
    );
  });
});
