import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const usage = `
Bump or stamp the MCP distribution declared in config/agent-mcp-distribution.json.

  node scripts/mcp-release-bump.mjs --version 0.15.7
      Writes the new version, tag and asset name, clears release.sha256, and
      syncs the workspace package version. Build the release on the declared
      platform and stamp before committing: the distribution check fails until
      the digest is stamped, so an unstamped bump never reaches CI green.

  node scripts/mcp-release-bump.mjs --stamp [--build-dir output/mcp]
      Reads SHA256SUMS.txt from the packaging output and writes its digest
      into release.sha256. Refuses to run off the declared build platform:
      npm pack metadata is part of the immutable tarball digest.

Options:
  --version <semver>       Bump mode.
  --stamp                  Stamp mode.
  --config <path>          Distribution declaration (default config/agent-mcp-distribution.json).
  --workspace-package <p>  Workspace package to keep in sync (default apps/mcp-server/package.json).
  --build-dir <dir>        Packaging output holding SHA256SUMS.txt (default output/mcp).
`;

function parseArgs(argv) {
  const options = {
    version: undefined,
    stamp: false,
    config: resolve(
      import.meta.dirname,
      "../config/agent-mcp-distribution.json",
    ),
    workspacePackage: resolve(
      import.meta.dirname,
      "../apps/mcp-server/package.json",
    ),
    buildDir: resolve(import.meta.dirname, "../output/mcp"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--version") options.version = argv[(index += 1)];
    else if (arg === "--stamp") options.stamp = true;
    else if (arg === "--config") options.config = resolve(argv[(index += 1)]);
    else if (arg === "--workspace-package")
      options.workspacePackage = resolve(argv[(index += 1)]);
    else if (arg === "--build-dir")
      options.buildDir = resolve(argv[(index += 1)]);
    else throw new Error(`Unknown argument: ${arg}\n${usage}`);
  }
  const modes = [options.version !== undefined, options.stamp].filter(
    Boolean,
  ).length;
  if (modes !== 1)
    throw new Error(
      "Choose exactly one mode: --version <semver> or --stamp.\n" + usage,
    );
  return options;
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeJson(path, value) {
  await writeFile(path, serialize(value));
}

function requireSemver(version) {
  if (!SEMVER_PATTERN.test(version ?? ""))
    throw new Error(
      `--version must be plain semver (x.y.z); received ${version}`,
    );
  return version;
}

async function bumpVersion(options) {
  const version = requireSemver(options.version);
  const distribution = JSON.parse(await readFile(options.config, "utf8"));
  if (distribution.version === version)
    throw new Error(
      `The distribution already declares ${version}; pick a different version.`,
    );
  const previous = {
    version: distribution.version,
    tag: distribution.release.tag,
    asset: distribution.release.asset,
  };
  distribution.version = version;
  distribution.release.tag = `mcp-v${version}`;
  distribution.release.asset = `analog-canvas-mcp-server-${version}.tgz`;
  // The digest does not exist until the release platform packages this
  // version; an empty value keeps the distribution check red until stamped.
  distribution.release.sha256 = "";
  await writeJson(options.config, distribution);

  const workspacePackage = JSON.parse(
    await readFile(options.workspacePackage, "utf8"),
  );
  workspacePackage.version = version;
  await writeJson(options.workspacePackage, workspacePackage);

  process.stdout.write(
    [
      `MCP distribution ${previous.version} -> ${version}`,
      `  tag: ${previous.tag} -> ${distribution.release.tag}`,
      `  asset: ${previous.asset} -> ${distribution.release.asset}`,
      `  synced ${options.workspacePackage} to ${version}`,
      "",
      "Next (in order, before committing):",
      `  1. package the release on ${distribution.release.buildPlatform}: pnpm mcp:package`,
      "  2. stamp the digest: pnpm mcp:release:bump -- --stamp",
      "  3. pnpm mcp:distribution:check",
      "",
    ].join("\n"),
  );
}

async function stampDigest(options) {
  const distribution = JSON.parse(await readFile(options.config, "utf8"));
  if (process.platform !== distribution.release.buildPlatform)
    throw new Error(
      `The declared digest comes from a ${distribution.release.buildPlatform} build ` +
        `(npm pack metadata is part of the tarball digest); received ${process.platform}. ` +
        "Package the release there, then stamp.",
    );
  const sumsPath = resolve(options.buildDir, "SHA256SUMS.txt");
  const sums = await readFile(sumsPath, "utf8");
  const entries = sums
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^([a-f0-9]{64})\s+(\S+)$/u.exec(line);
      if (!match) throw new Error(`Unreadable SHA256SUMS line: ${line}`);
      return { digest: match[1], name: match[2] };
    });
  const entry = entries.find(
    (candidate) => candidate.name === distribution.release.asset,
  );
  if (!entry)
    throw new Error(
      `SHA256SUMS.txt names ${entries.map((item) => item.name).join(", ")}; ` +
        `the declared asset ${distribution.release.asset} was not built. ` +
        "Run pnpm mcp:package on the declared build platform first.",
    );
  if (!SHA256_PATTERN.test(entry.digest))
    throw new Error(`SHA256SUMS.txt digest is not sha256 hex: ${entry.digest}`);
  const previousDigest = distribution.release.sha256;
  distribution.release.sha256 = entry.digest;
  await writeJson(options.config, distribution);
  process.stdout.write(
    `Stamped ${distribution.release.asset} -> ${entry.digest}` +
      (previousDigest && previousDigest !== entry.digest
        ? ` (replacing ${previousDigest})`
        : "") +
      "\nRun pnpm mcp:distribution:check, then commit the declaration.\n",
  );
}

const options = parseArgs(process.argv.slice(2));
if (options.stamp) await stampDigest(options);
else await bumpVersion(options);
