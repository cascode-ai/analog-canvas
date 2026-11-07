import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const mcpDistribution = JSON.parse(
  await readFile(resolve(root, "config/agent-mcp-distribution.json"), "utf8"),
);
// One source for the release version: the workspace manifest. Hard-coding it
// here and in the smoke script is what broke the 0.1.0 to 0.2.0 bump.
const { version } = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const output = resolve(root, `output/release/analog-canvas-v${version}`);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, "output/mcp"), resolve(output, "mcp"), {
  recursive: true,
});
await writeFile(
  resolve(output, "release.json"),
  `${JSON.stringify(
    {
      name: "analog-canvas",
      version,
      node: mcpDistribution.node,
      mcp: `mcp/analog-canvas-mcp-v${mcpDistribution.version}/bin/analog-canvas-mcp.mjs`,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`${output}\n`);
