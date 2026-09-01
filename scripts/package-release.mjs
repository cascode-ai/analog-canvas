import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const mcpDistribution = JSON.parse(
  await readFile(resolve(root, "config/agent-mcp-distribution.json"), "utf8"),
);
// One source for the release version: the workspace manifest. Hard-coding it
// here and in the two smoke scripts is what broke the 0.1.0 to 0.2.0 bump.
const { version } = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const output = resolve(
  root,
  `output/release/interactive-circuit-maker-v${version}`,
);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, "apps/editor/dist"), resolve(output, "editor"), {
  recursive: true,
});
await cp(resolve(root, "apps/local-host/dist"), resolve(output, "host"), {
  recursive: true,
});
await cp(resolve(root, "output/mcp"), resolve(output, "mcp"), {
  recursive: true,
});
await writeFile(
  resolve(output, "start.mjs"),
  `import { resolve } from "node:path";\nimport { startLocalHost } from "./host/index.js";\nconst running = await startLocalHost({ editorRoot: resolve(import.meta.dirname, "editor"), port: 4173 });\nprocess.stdout.write(\`Interactive Circuit Maker v${version}: \${running.origin}\\n\`);\n`,
);
const manifest = JSON.parse(
  await readFile(
    resolve(root, "apps/editor/public/manifest.webmanifest"),
    "utf8",
  ),
);
await writeFile(
  resolve(output, "release.json"),
  `${JSON.stringify(
    {
      name: "interactive-circuit-maker",
      version,
      node: mcpDistribution.node,
      pwa: manifest.name,
      mcp: `mcp/analog-canvas-mcp-v${mcpDistribution.version}/bin/analog-canvas-mcp.mjs`,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`${output}\n`);
