// Bundle the headless drawing workspace (#1498) into one Node module,
// output/headless/analog-canvas-headless.mjs, which the workspace build of
// the MCP's --local mode and the batch runner load.
//
//   node scripts/package-headless.mjs [out-dir]
import { resolve } from "node:path";
import { bundleHeadless } from "./lib/headless-bundle.mjs";

const outDir = resolve(
  import.meta.dirname,
  "..",
  process.argv[2] ?? "output/headless",
);
console.log(
  `Bundled the headless workspace into ${await bundleHeadless(outDir)}`,
);
