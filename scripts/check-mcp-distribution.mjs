import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const distribution = JSON.parse(
  await readFile(resolve(root, "config/agent-mcp-distribution.json"), "utf8"),
);

const expectedTag = `mcp-v${distribution.version}`;
const expectedAsset = `analog-canvas-mcp-server-${distribution.version}.tgz`;
const failures = [];

if (distribution.schemaVersion !== 1) failures.push("schemaVersion must be 1");
if (distribution.release.tag !== expectedTag)
  failures.push(`release.tag must be ${expectedTag}`);
if (distribution.release.asset !== expectedAsset)
  failures.push(`release.asset must be ${expectedAsset}`);
if (distribution.release.buildPlatform !== "linux")
  failures.push("release.buildPlatform must be linux for GitHub Actions");
if (!/^\d+\.\d+\.\d+$/u.test(distribution.version))
  failures.push("version must be plain semver");
if (!/^[a-f0-9]{64}$/u.test(distribution.release.sha256))
  failures.push("release.sha256 must contain the packaged tarball SHA-256");
if (distribution.npmPublished !== false && distribution.npmPublished !== true)
  failures.push("npmPublished must be boolean");

// The declared version is the single source of truth; the workspace package
// version is decorative and drifts silently when bumps skip it.
const workspacePackage = JSON.parse(
  await readFile(resolve(root, "apps/mcp-server/package.json"), "utf8"),
);
if (workspacePackage.version !== distribution.version)
  failures.push(
    `apps/mcp-server/package.json version ${workspacePackage.version} must ` +
      `match the distribution version ${distribution.version}`,
  );

if (failures.length > 0) {
  throw new Error(`Invalid MCP distribution:\n- ${failures.join("\n- ")}`);
}

process.stdout.write(
  `MCP distribution ${distribution.version} is internally consistent.\n`,
);
