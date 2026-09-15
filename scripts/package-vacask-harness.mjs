import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "vite";

// Package the existing entrypoint, never a second HTTP/runtime implementation.
// Runtime binaries, models, Python, configuration and locks are separate inputs.
export async function packageVacaskHarness(directory) {
  const root = resolve(import.meta.dirname, "..");
  const output = resolve(directory);
  await mkdir(output); // Exclusive output; never erase earlier evidence.
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    build: {
      ssr: join(root, "containers/vacask/entrypoint.mjs"),
      outDir: output,
      emptyOutDir: false,
      target: "node24",
      minify: false,
      rollupOptions: { output: { entryFileNames: "vacask-harness.mjs" } },
    },
    ssr: { noExternal: true },
  });
  assert.deepEqual(
    await readdir(output),
    ["vacask-harness.mjs"],
    "The portable harness must be one self-contained file",
  );
  const bytes = await readFile(join(output, "vacask-harness.mjs"));
  const manifest = {
    status: "packaged-not-deployed",
    entry: "vacask-harness.mjs",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    node: ">=24",
  };
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx" },
  );
  return manifest;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.length !== 3)
    throw Error(
      "Usage: node scripts/package-vacask-harness.mjs <new-output-directory>",
    );
  console.log(JSON.stringify(await packageVacaskHarness(process.argv[2])));
}
