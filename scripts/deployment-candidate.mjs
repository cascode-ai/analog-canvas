import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";

import { BROTLI_CONTENT_TYPES } from "../worker/brotli-assets.ts";

const MANIFEST_NAME = "candidate.json";
const WORKER_ENTRY = "worker/index.js";
const EDITOR_DIRECTORY = "editor";

function slash(path) {
  return path.split(sep).join("/");
}

async function payloadFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const path = join(directory, entry.name);
    const relativePath = slash(relative(root, path));
    if (relativePath === MANIFEST_NAME) continue;
    if (entry.isDirectory()) files.push(...(await payloadFiles(root, path)));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`Candidate payload cannot contain ${relativePath}`);
  }
  return files;
}

const compress = promisify(brotliCompress);

/**
 * Write a quality-11 `<file>.br` beside each compressible asset of the
 * candidate, where it is smaller. Only the candidate gets them: every other
 * consumer of apps/editor/dist sees the plain build (worker/brotli-assets.ts).
 */
async function compressAssets(assets) {
  const names = (await readdir(assets, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        Object.hasOwn(BROTLI_CONTENT_TYPES, extname(entry.name).slice(1)),
    )
    .map((entry) => entry.name);
  await Promise.all(
    Array.from({ length: availableParallelism() }, async () => {
      for (let name = names.shift(); name; name = names.shift()) {
        const bytes = await readFile(join(assets, name));
        const compressed = await compress(bytes, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
            [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
          },
        });
        if (compressed.byteLength < bytes.byteLength)
          await writeFile(join(assets, `${name}.br`), compressed);
      }
    }),
  );
}

async function payloadInventory(root) {
  const files = await payloadFiles(root);
  let bytes = 0;
  for (const name of files) bytes += (await stat(join(root, name))).size;
  return { fileCount: files.length, bytes };
}

function requireCommit(commit) {
  assert.match(
    commit,
    /^[0-9a-f]{40}$/u,
    "Candidate commit must be a full SHA",
  );
  return commit;
}

export async function createDeploymentCandidate({
  outputDirectory,
  workerBundleDirectory,
  editorDirectory,
  commit,
  version,
}) {
  const output = resolve(outputDirectory);
  requireCommit(commit);
  assert.match(version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u);
  await mkdir(output);
  await cp(resolve(workerBundleDirectory), join(output, "worker"), {
    recursive: true,
  });
  await cp(resolve(editorDirectory), join(output, EDITOR_DIRECTORY), {
    recursive: true,
  });
  await compressAssets(join(output, EDITOR_DIRECTORY, "assets"));
  const worker = await stat(join(output, WORKER_ENTRY));
  assert(worker.isFile(), `Candidate is missing ${WORKER_ENTRY}`);
  const editor = await stat(join(output, EDITOR_DIRECTORY, "index.html"));
  assert(editor.isFile(), "Candidate is missing editor/index.html");
  const inventory = await payloadInventory(output);
  const manifest = {
    schemaVersion: 1,
    commit,
    version,
    workerEntry: WORKER_ENTRY,
    editorDirectory: EDITOR_DIRECTORY,
    ...inventory,
  };
  await writeFile(
    join(output, MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export async function verifyDeploymentCandidate(
  outputDirectory,
  expectedCommit,
) {
  const output = resolve(outputDirectory);
  const manifest = JSON.parse(
    await readFile(join(output, MANIFEST_NAME), "utf8"),
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.commit, requireCommit(expectedCommit));
  assert.equal(manifest.workerEntry, WORKER_ENTRY);
  assert.equal(manifest.editorDirectory, EDITOR_DIRECTORY);
  const inventory = await payloadInventory(output);
  assert.deepEqual(inventory, {
    fileCount: manifest.fileCount,
    bytes: manifest.bytes,
  });
  await stat(join(output, manifest.workerEntry));
  await stat(join(output, manifest.editorDirectory, "index.html"));
  return manifest;
}

export async function verifyDeployedCandidate(
  outputDirectory,
  baseUrl,
  fetchImpl = fetch,
) {
  const output = resolve(outputDirectory);
  const manifest = JSON.parse(
    await readFile(join(output, MANIFEST_NAME), "utf8"),
  );
  const localShell = await readFile(
    join(output, manifest.editorDirectory, "index.html"),
    "utf8",
  );
  const entry = localShell.match(/src="(\/assets\/[^" ]+\.js)"/u)?.[1];
  assert(entry, "Candidate editor shell has no JavaScript entry");
  const shellResponse = await fetchImpl(new URL("/editor", baseUrl), {
    cache: "no-store",
  });
  assert.equal(
    shellResponse.status,
    200,
    "Deployed editor shell is unavailable",
  );
  const remoteShell = await shellResponse.text();
  assert(
    remoteShell.includes(`src="${entry}"`),
    "Deployment is not serving the accepted candidate entry",
  );
  const entryResponse = await fetchImpl(new URL(entry, baseUrl), {
    cache: "no-store",
    headers: { "accept-encoding": "br" },
  });
  assert.equal(
    entryResponse.status,
    200,
    "Deployed candidate entry is unavailable",
  );
  const entryPath = join(
    output,
    manifest.editorDirectory,
    entry.replace(/^\//u, ""),
  );
  const localEntry = await readFile(entryPath);
  const compressed = await stat(`${entryPath}.br`).then(
    () => true,
    () => false,
  );
  if (compressed)
    assert.equal(
      entryResponse.headers.get("content-encoding"),
      "br",
      "Deployment is not serving the candidate's brotli entry",
    );
  assert.deepEqual(
    Buffer.from(await entryResponse.arrayBuffer()),
    localEntry,
    "Deployed entry bytes differ from the accepted candidate",
  );
  return { commit: manifest.commit, version: manifest.version, entry };
}

async function packageVersion() {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  return packageJson.version;
}

async function main() {
  const [command, outputDirectory, argument, workerBundleDirectory] =
    process.argv.slice(2);
  if (command === "create") {
    assert(outputDirectory && argument && workerBundleDirectory);
    const manifest = await createDeploymentCandidate({
      outputDirectory,
      commit: argument,
      workerBundleDirectory,
      editorDirectory: new URL("../apps/editor/dist", import.meta.url).pathname,
      version: await packageVersion(),
    });
    console.log(
      `Candidate ${manifest.version} contains ${manifest.fileCount} files (${manifest.bytes} bytes).`,
    );
    return;
  }
  if (command === "verify") {
    assert(outputDirectory && argument);
    const manifest = await verifyDeploymentCandidate(outputDirectory, argument);
    console.log(
      `Candidate ${manifest.version} has the expected source, file count and payload size.`,
    );
    return;
  }
  if (command === "verify-live") {
    assert(outputDirectory && argument);
    const result = await verifyDeployedCandidate(outputDirectory, argument);
    console.log(
      `Serving candidate ${result.version} at ${new URL(argument).origin}.`,
    );
    return;
  }
  throw new Error(
    `usage: ${basename(process.argv[1])} create <output> <commit> <worker-bundle> | verify <output> <commit> | verify-live <output> <url>`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
