import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// Assemble the locked upstream implementation; never fetch a different package.
const require = createRequire(
  new URL("../../../apps/editor/package.json", import.meta.url),
);
const wrangler = createRequire(require.resolve("wrangler/package.json"));
const source = dirname(wrangler.resolve("miniflare/package.json"));
const pkg = JSON.parse(await readFile(resolve(source, "package.json"), "utf8"));
if (pkg.version !== "5.20260911.0-alpha")
  throw new Error("Artifact runtime version differs from the qualified pin");
if (process.argv.length !== 3)
  throw new Error(
    "Usage: node prepare-artifacts.mjs <private-release-directory>",
  );
const target = resolve(process.argv[2], "storage-modules");
await mkdir(target, { recursive: true });
const files = {};
for (const [input, output] of [
  ["dist/src/workers/shared/index.worker.js", "shared.js"],
  ["dist/src/workers/shared/zod.worker.js", "zod.js"],
  ["dist/src/workers/shared/object-entry.worker.js", "object-entry.js"],
  ["dist/src/workers/r2/bucket.worker.js", "bucket.js"],
  ["package.json", "upstream-package.json"],
]) {
  const bytes = await readFile(resolve(source, input));
  await writeFile(resolve(target, output), bytes);
  files[output] = createHash("sha256").update(bytes).digest("hex");
}
const license = await readFile(new URL("storage-LICENSE.txt", import.meta.url));
await writeFile(resolve(target, "LICENSE"), license);
files.LICENSE = createHash("sha256").update(license).digest("hex");
await writeFile(
  resolve(target, "manifest.json"),
  JSON.stringify({ package: pkg.name, version: pkg.version, files }, null, 2) +
    "\n",
);
console.log(
  `Prepared ${Object.keys(files).length} pinned artifact storage files`,
);
