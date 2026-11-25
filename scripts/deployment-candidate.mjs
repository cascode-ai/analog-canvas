import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";

import { isCompressibleAsset } from "../worker/static-assets.ts";
import { eachConcurrently } from "./lib/each-concurrently.mjs";

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
/** Quality 6 keeps near-max static compression while cutting CI build time ~5x vs 11. */
const BROTLI_ASSET_QUALITY = 6;

/**
 * Write a quality-6 `<file>.br` into `brotliDirectory` for each compressible
 * asset of this build where it is smaller. It never writes into the build:
 * other consumers of apps/editor/dist see it plain.
 */
export async function compressBuildAssets(editorDirectory, brotliDirectory) {
  const assets = join(resolve(editorDirectory), "assets");
  await mkdir(brotliDirectory, { recursive: true });
  const names = (await readdir(assets, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && isCompressibleAsset(entry.name))
    .map((entry) => entry.name);
  let written = 0;
  await eachConcurrently(names, availableParallelism(), async (name) => {
    const bytes = await readFile(join(assets, name));
    const compressed = await compress(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: BROTLI_ASSET_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
      },
    });
    if (compressed.byteLength >= bytes.byteLength) return;
    await writeFile(join(brotliDirectory, `${name}.br`), compressed);
    written += 1;
  });
  return written;
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
  brotliDirectory,
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
  // A sibling never replaces a file of the build.
  for (const name of brotliDirectory ? await readdir(brotliDirectory) : [])
    await copyFile(
      join(brotliDirectory, name),
      join(output, EDITOR_DIRECTORY, "assets", name),
      fsConstants.COPYFILE_EXCL,
    );
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

class TransientLiveVerifyError extends Error {}

async function verifyDeployedCandidateOnce({
  baseUrl,
  entry,
  localEntry,
  compressed,
  fetchImpl,
}) {
  const shellResponse = await fetchImpl(new URL("/editor", baseUrl), {
    cache: "no-store",
  });
  if (shellResponse.status === 404 || shellResponse.status >= 500) {
    throw new TransientLiveVerifyError(
      `Deployed editor shell returned HTTP ${shellResponse.status}`,
    );
  }
  assert.equal(
    shellResponse.status,
    200,
    "Deployed editor shell is unavailable",
  );
  const shellType = shellResponse.headers.get("content-type") ?? "";
  assert.match(
    shellType,
    /text\/html/iu,
    `A client route must receive HTML shell, got: ${shellType}`,
  );
  const remoteShell = await shellResponse.text();
  assert.match(
    remoteShell,
    /<!doctype html>/iu,
    "Deployed editor shell is missing <!doctype html>",
  );
  if (!remoteShell.includes(`src="${entry}"`)) {
    throw new TransientLiveVerifyError(
      "Deployment is not yet serving the accepted candidate entry",
    );
  }
  const entryResponse = await fetchImpl(new URL(entry, baseUrl), {
    cache: "no-store",
    headers: { "accept-encoding": "br" },
  });
  if (entryResponse.status === 401) {
    throw new Error(
      `The live site answered ${entry} with 401: another Worker holds this domain.`,
    );
  }
  if (entryResponse.status === 404 || entryResponse.status >= 500) {
    throw new TransientLiveVerifyError(
      `Deployed candidate entry (br) returned HTTP ${entryResponse.status}`,
    );
  }
  assert.equal(
    entryResponse.status,
    200,
    "Deployed candidate entry is unavailable",
  );
  assert.match(
    entryResponse.headers.get("content-type") ?? "",
    /javascript/iu,
    "Deployed candidate entry is not JavaScript",
  );
  // fetch() decodes the body, so the header shows what was sent.
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
  const gzipResponse = await fetchImpl(new URL(entry, baseUrl), {
    cache: "no-store",
    headers: { "accept-encoding": "gzip" },
  });
  if (gzipResponse.status === 401) {
    throw new Error(
      `The live site answered ${entry} with 401: another Worker holds this domain.`,
    );
  }
  if (gzipResponse.status === 404 || gzipResponse.status >= 500) {
    throw new TransientLiveVerifyError(
      `Deployed entry (gzip) returned HTTP ${gzipResponse.status}`,
    );
  }
  assert.equal(gzipResponse.status, 200, "Deployed entry is unavailable");
  assert.match(
    gzipResponse.headers.get("content-type") ?? "",
    /javascript/iu,
    "Deployed entry is not JavaScript",
  );
  assert.notEqual(
    gzipResponse.headers.get("content-encoding"),
    "br",
    "Deployment sends brotli to a client that does not accept it",
  );
  assert.deepEqual(
    Buffer.from(await gzipResponse.arrayBuffer()),
    localEntry,
    "Deployed entry bytes differ from the accepted candidate",
  );
}

export async function verifyDeployedCandidate(
  outputDirectory,
  baseUrl,
  fetchImpl = fetch,
  { retries = 0, retryDelayMs = 2000 } = {},
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

  for (let attempt = 0; ; attempt += 1) {
    try {
      await verifyDeployedCandidateOnce({
        baseUrl,
        entry,
        localEntry,
        compressed,
        fetchImpl,
      });
      return { commit: manifest.commit, version: manifest.version, entry };
    } catch (error) {
      const retryable =
        error instanceof TransientLiveVerifyError ||
        (error instanceof TypeError && attempt < retries);
      if (!retryable || attempt >= retries) throw error;
      if (retryDelayMs > 0) {
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, retryDelayMs),
        );
      }
    }
  }
}

async function packageVersion() {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  return packageJson.version;
}

async function main() {
  const [
    command,
    outputDirectory,
    argument,
    workerBundleDirectory,
    brotliDirectory,
  ] = process.argv.slice(2);
  const editorDirectory = new URL("../apps/editor/dist", import.meta.url)
    .pathname;
  if (command === "compress") {
    assert(outputDirectory);
    const written = await compressBuildAssets(editorDirectory, outputDirectory);
    console.log(`Wrote ${written} brotli siblings of this build's assets.`);
    return;
  }
  if (command === "create") {
    assert(outputDirectory && argument && workerBundleDirectory);
    const manifest = await createDeploymentCandidate({
      outputDirectory,
      commit: argument,
      workerBundleDirectory,
      editorDirectory,
      brotliDirectory,
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
    const result = await verifyDeployedCandidate(
      outputDirectory,
      argument,
      fetch,
      { retries: 5, retryDelayMs: 2000 },
    );
    console.log(
      `Serving candidate ${result.version} at ${new URL(argument).origin}.`,
    );
    return;
  }
  throw new Error(
    `usage: ${basename(process.argv[1])} compress <brotli-dir> | create <output> <commit> <worker-bundle> [brotli-dir] | verify <output> <commit> | verify-live <output> <url>`,
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
