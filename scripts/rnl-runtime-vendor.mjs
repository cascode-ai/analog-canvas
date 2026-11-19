// The rnl runtime Analog Canvas builds against (#2102): an rnl release on
// npm, checked against the SHA-256 its GitHub release lists, or the npm
// package upstream CI built from one commit of rich-netlist/rnl, never a local
// build; and a way back to the combination before it for the rollback drill.
// Where each package came from is recorded in
// packages/rnl/src/rnl-version-line.json.
//
//   pnpm rnl:runtime:vendor -- --npm <version>  that release, from npm
//   pnpm rnl:runtime:vendor -- --commit <sha>   CI's build of that commit
//   pnpm rnl:runtime:vendor -- --restore        the combination before
//
// Then `pnpm install` refreshes pnpm-lock.yaml, and the RNL suites decide.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const REPO = "rich-netlist/rnl";
const REGISTRY = "https://registry.npmjs.org";
/** The upstream workflows that build and test the npm package from a commit. */
const WORKFLOWS = ["core-nightly.yml", "core-release.yml"];
const ARTIFACT = "core-npm";
const PACKAGE = "@rich-netlist/runtime";
const LINE = "packages/rnl/src/rnl-version-line.json";
const VENDOR = "packages/rnl/vendor";
/** Each package that depends on the runtime, and how it names the vendor folder. */
const DEPENDENTS = {
  "packages/rnl/package.json": "file:vendor/",
  "apps/editor/package.json": "file:../../packages/rnl/vendor/",
};

/** A file of a gzipped tar archive, by its path in the archive, or null. */
export function tarEntry(tgz, path) {
  const tar = gunzipSync(tgz);
  for (let at = 0; at + 512 <= tar.length;) {
    const header = tar.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/su, "");
    const prefix = field(345, 155);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    if (name === path) return tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

/** What a runtime package is: its name, version, whether it ships the solver, and its pnpm integrity. */
export function inspectPackage(tgz) {
  const manifest = tarEntry(tgz, "package/package.json");
  if (!manifest) throw new Error("The archive has no package/package.json");
  const { name, version } = JSON.parse(manifest.toString("utf8"));
  return {
    name,
    version,
    solver: tarEntry(tgz, "package/rnl_solver_wasm.wasm") !== null,
    integrity: `sha512-${createHash("sha512").update(tgz).digest("base64")}`,
  };
}

/** The newest successful upstream run that built the npm package from a commit. */
export function ciRunFor(commit, gh) {
  for (const workflow of WORKFLOWS) {
    const [run] = JSON.parse(
      gh([
        "run",
        "list",
        "--repo",
        REPO,
        "--workflow",
        workflow,
        "--commit",
        commit,
        "--status",
        "success",
        "--limit",
        "1",
        "--json",
        "databaseId",
      ]),
    );
    if (run) return { workflow, run: run.databaseId };
  }
  return null;
}

async function readJson(root, path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

async function writeJson(root, path, value) {
  await writeFile(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

/** Point every dependent at a runtime: its exact npm version, or its vendored file. */
async function depend(root, runtime) {
  for (const [path, folder] of Object.entries(DEPENDENTS)) {
    const manifest = await readJson(root, path);
    const field = manifest.dependencies?.[PACKAGE]
      ? "dependencies"
      : "devDependencies";
    manifest[field][PACKAGE] =
      runtime.source === "npm" ? runtime.version : `${folder}${runtime.file}`;
    await writeJson(root, path, manifest);
  }
}

/**
 * Make `runtime` the current one: its file (if it is vendored) in place of
 * the current one's, the dependents pointed at it, and the current one kept
 * as `previous` with the Analog Canvas commit (`kept`) that holds it.
 */
async function replace(root, line, runtime, tgz, git) {
  if (runtime.file) {
    // Git keeps no empty folder: with an npm release there is none.
    await mkdir(join(root, VENDOR), { recursive: true });
    await writeFile(join(root, VENDOR, runtime.file), tgz);
  }
  if (line.runtime.file && line.runtime.file !== runtime.file)
    await unlink(join(root, VENDOR, line.runtime.file));
  await depend(root, runtime);
  line.previous = {
    ...line.runtime,
    kept: git(["rev-parse", "--short", "HEAD"]).trim(),
  };
  line.runtime = runtime;
  await writeJson(root, LINE, line);
  return line;
}

/** The SHA-256 a release's SHA256SUMS.txt lists for one file, or undefined. */
export function listedSha256(sums, file) {
  for (const row of sums.split(/\r?\n/u)) {
    const [hash, name] = row.trim().split(/\s+\*?/u);
    if (name === file) return hash;
  }
  return undefined;
}

/**
 * Lock an rnl release from npm: the package npm serves, checked to be the
 * runtime and to have the SHA-256 that the release `core-v<version>` lists in
 * SHA256SUMS.txt, recorded with its tag's commit. The dependents name the
 * exact version, and pnpm-lock.yaml its integrity.
 */
export async function lockRelease({ root, version, get, gh, git }) {
  const tag = `core-v${version}`;
  const { dist } = JSON.parse(
    (await get(`${REGISTRY}/${PACKAGE}/${version}`)).toString("utf8"),
  );
  const tgz = await get(dist.tarball);
  const built = inspectPackage(tgz);
  if (built.name !== PACKAGE || built.version !== version)
    throw new Error(
      `npm served ${built.name} ${built.version}, not ${PACKAGE} ${version}`,
    );
  if (built.integrity !== dist.integrity)
    throw new Error(
      `npm's ${PACKAGE} ${version} does not have the integrity npm lists`,
    );
  // The release's checksum, so npm and the release are the same bytes.
  const sha256 = createHash("sha256").update(tgz).digest("hex");
  const listed = listedSha256(
    gh([
      "release",
      "download",
      tag,
      "--repo",
      REPO,
      "--pattern",
      "SHA256SUMS.txt",
      "--output",
      "-",
    ]),
    `rich-netlist-runtime-${version}.tgz`,
  );
  if (listed !== sha256)
    throw new Error(
      `npm's ${PACKAGE} ${version} has SHA-256 ${sha256}; the release ${tag} lists ${listed ?? "no runtime package"}`,
    );
  const commit = gh([
    "api",
    `repos/${REPO}/commits/${tag}`,
    "--jq",
    ".sha",
  ]).trim();
  return await replace(
    root,
    await readJson(root, LINE),
    {
      package: PACKAGE,
      source: "npm",
      commit,
      version,
      built: `npm, the ${REPO} release ${tag}`,
      sha256,
      solver: built.solver,
      integrity: built.integrity,
    },
    tgz,
    git,
  );
}

/**
 * Vendor CI's build of one upstream commit: download its `core-npm`
 * artifact, check it is the runtime, and make it the current one.
 */
export async function vendorCommit({ root, commit, gh, git }) {
  const sha = gh([
    "api",
    `repos/${REPO}/commits/${commit}`,
    "--jq",
    ".sha",
  ]).trim();
  const found = ciRunFor(sha, gh);
  if (!found)
    throw new Error(
      `No successful ${WORKFLOWS.join(" or ")} run of ${REPO} built the npm package from ${sha}: vendor a commit the nightly build or a pull request's checks built`,
    );
  const dir = await mkdtemp(join(tmpdir(), "rnl-runtime-"));
  try {
    gh([
      "run",
      "download",
      String(found.run),
      "--repo",
      REPO,
      "--name",
      ARTIFACT,
      "--dir",
      dir,
    ]);
    const [archive] = (await readdir(dir)).filter((name) =>
      name.endsWith(".tgz"),
    );
    if (!archive)
      throw new Error(`Run ${found.run} has no package in ${ARTIFACT}`);
    const tgz = await readFile(join(dir, archive));
    const built = inspectPackage(tgz);
    if (built.name !== PACKAGE)
      throw new Error(`Run ${found.run} built ${built.name}, not ${PACKAGE}`);
    return await replace(
      root,
      await readJson(root, LINE),
      {
        package: PACKAGE,
        source: "commit",
        commit: sha,
        version: built.version,
        file: `rich-netlist-runtime-main-${sha.slice(0, 8)}.tgz`,
        built: `${REPO} actions run ${found.run} (${found.workflow}, artifact ${ARTIFACT})`,
        solver: built.solver,
        integrity: built.integrity,
      },
      tgz,
      git,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Go back to the combination before the current one, for the rollback drill:
 * its file from the Analog Canvas commit that kept it (an npm release has no
 * file: pnpm fetches it by its version), the dependents pointed at it, and
 * the two swapped in the record, so that a second restore returns.
 */
export async function restorePrevious({ root, git }) {
  const line = await readJson(root, LINE);
  if (!line.previous?.kept)
    throw new Error(`${LINE} names no previous runtime to restore`);
  const { kept, ...restored } = line.previous;
  const bytes = restored.file
    ? git(["show", `${kept}:${VENDOR}/${restored.file}`], {
        encoding: "buffer",
      })
    : null;
  return replace(root, line, restored, bytes, git);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const run =
    (command) =>
    (args, options = {}) =>
      execFileSync(command, args, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 1 << 28,
        ...options,
      });
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const value = (flag) =>
    args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const [commit, version] = [value("--commit"), value("--npm")];
  const get = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const name = (runtime) =>
    runtime.file ?? `${runtime.package}@${runtime.version}`;
  try {
    const line = args.includes("--restore")
      ? await restorePrevious({ root, git: run("git") })
      : version
        ? await lockRelease({
            root,
            version,
            get,
            gh: run("gh"),
            git: run("git"),
          })
        : commit
          ? await vendorCommit({ root, commit, gh: run("gh"), git: run("git") })
          : null;
    if (!line)
      throw new Error("Give --npm <version>, --commit <sha> or --restore");
    console.log(
      `Runtime: ${name(line.runtime)} (${line.runtime.built}); before it: ${name(line.previous)}.\nRun pnpm install, then the RNL suites; record both combinations in the pull request.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
