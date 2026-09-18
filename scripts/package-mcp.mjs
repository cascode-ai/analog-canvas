import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { build } from "vite";

import {
  assertDeclaredReleaseSha,
  VERIFY_DECLARED_RELEASE_SHA_FLAG,
} from "./lib/mcp-release-integrity.mjs";

const root = resolve(import.meta.dirname, "..");
const distribution = JSON.parse(
  await readFile(resolve(root, "config/agent-mcp-distribution.json"), "utf8"),
);
const version = distribution.version;
const packageName = `analog-canvas-mcp-v${version}`;
const outputRoot = resolve(root, "output/mcp");
const output = resolve(outputRoot, packageName);
const binDirectory = resolve(output, "bin");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(binDirectory, { recursive: true });
await build({
  root,
  configFile: false,
  logLevel: "warn",
  define: { __ANALOG_CANVAS_MCP_VERSION__: JSON.stringify(version) },
  build: {
    ssr: resolve(root, "apps/mcp-server/src/main.ts"),
    outDir: binDirectory,
    emptyOutDir: true,
    target: "node24",
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: "analog-canvas-mcp.mjs",
      },
    },
  },
  ssr: { noExternal: true },
});

const executable = resolve(binDirectory, "analog-canvas-mcp.mjs");
const source = await readFile(executable, "utf8");
// An unstamped declaration (empty digest while a bump awaits its Linux
// build) must not trip the self-embedding guard.
if (
  distribution.release.sha256 &&
  source.includes(distribution.release.sha256)
) {
  throw new Error("MCP bundle must not embed its own release digest");
}
await writeFile(
  executable,
  source.startsWith("#!") ? source : `#!/usr/bin/env node\n${source}`,
);
await chmod(executable, 0o755).catch(() => undefined);

await writeFile(
  resolve(output, "package.json"),
  `${JSON.stringify(
    {
      name: distribution.packageName,
      version,
      description: "Local MCP adapter for the Analog Canvas browser editor",
      type: "module",
      bin: { [distribution.binaryName]: "bin/analog-canvas-mcp.mjs" },
      files: ["bin", "README.md"],
      engines: { node: distribution.node },
      license: "UNLICENSED",
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  resolve(output, "README.md"),
  `# Analog Canvas MCP\n\nLocal stdio MCP adapter for Analog Canvas. The package embeds the compact tools and their execution Resources, keeps the revocable connector in the user's profile, and never exposes the short-lived bearer to the model.\n\nConfigure an MCP host to run \`${distribution.binaryName}\` from this package. Set \`ANALOG_CANVAS_API_URL\` only for a non-production deployment. The public bootstrap manifest is available at \`https://analog-canvas.tokenzhang.com/api/agent/mcp-manifest.json\`.\n`,
);

const packCommand =
  process.platform === "win32"
    ? {
        file: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", "npm pack . --pack-destination .."],
      }
    : { file: "npm", args: ["pack", ".", "--pack-destination", ".."] };
execFileSync(packCommand.file, packCommand.args, {
  cwd: output,
  stdio: "inherit",
});

const tarball = resolve(outputRoot, distribution.release.asset);
const digest = createHash("sha256")
  .update(await readFile(tarball))
  .digest("hex");
assertDeclaredReleaseSha({
  verify: process.argv.includes(VERIFY_DECLARED_RELEASE_SHA_FLAG),
  platform: process.platform,
  buildPlatform: distribution.release.buildPlatform,
  expectedSha: distribution.release.sha256,
  actualSha: digest,
});
await writeFile(
  resolve(outputRoot, "SHA256SUMS.txt"),
  `${digest}  ${distribution.release.asset}\n`,
);
await writeFile(
  resolve(outputRoot, "mcp-bootstrap-release.json"),
  `${JSON.stringify(
    {
      version,
      tag: distribution.release.tag,
      asset: distribution.release.asset,
      sha256: digest,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`${output}\n`);
