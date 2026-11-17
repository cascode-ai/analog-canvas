// The rnl runtime Analog Canvas builds against (#2102), until a release on
// npm reads the language it writes: the npm package upstream CI built from
// one commit of rich-netlist/rnl, never a local build, and a way back to the
// combination before it for the rollback drill. Where each package came from
// is recorded in packages/rnl/src/rnl-version-line.json.
//
//   pnpm rnl:runtime:vendor -- --commit <sha>   CI's build of that commit
//   pnpm rnl:runtime:vendor -- --restore        the combination before
//
// Then `pnpm install` refreshes pnpm-lock.yaml, and the RNL suites decide.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
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

/** Point every dependent at a vendored file. */
async function depend(root, file) {
  for (const [path, folder] of Object.entries(DEPENDENTS)) {
    const manifest = await readJson(root, path);
    const field = manifest.dependencies?.[PACKAGE]
      ? "dependencies"
      : "devDependencies";
    manifest[field][PACKAGE] = `${folder}${file}`;
    await writeJson(root, path, manifest);
  }
}

/**
 * Vendor CI's build of one upstream commit: download its `core-npm`
 * artifact, check it is the runtime, put it beside the one it replaces,
 * point the dependents at it and record both, the replaced one as
 * `previous` with the Analog Canvas commit (`kept`) that holds its file.
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
    const line = await readJson(root, LINE);
    const file = `rich-netlist-runtime-main-${sha.slice(0, 8)}.tgz`;
    await writeFile(join(root, VENDOR, file), tgz);
    if (line.runtime.file !== file)
      await unlink(join(root, VENDOR, line.runtime.file));
    await depend(root, file);
    line.previous = {
      ...line.runtime,
      kept: git(["rev-parse", "--short", "HEAD"]).trim(),
    };
    line.runtime = {
      package: PACKAGE,
      source: "commit",
      commit: sha,
      version: built.version,
      file,
      built: `${REPO} actions run ${found.run} (${found.workflow}, artifact ${ARTIFACT})`,
      solver: built.solver,
      integrity: built.integrity,
    };
    await writeJson(root, LINE, line);
    return line;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Go back to the combination before the current one, for the rollback drill:
 * its file from the Analog Canvas commit that kept it, the dependents pointed
 * at it, and the two swapped in the record, so that a second restore returns.
 */
export async function restorePrevious({ root, git }) {
  const line = await readJson(root, LINE);
  const { previous, runtime } = line;
  if (!previous?.kept)
    throw new Error(`${LINE} names no previous runtime to restore`);
  const bytes = git(["show", `${previous.kept}:${VENDOR}/${previous.file}`], {
    encoding: "buffer",
  });
  await writeFile(join(root, VENDOR, previous.file), bytes);
  if (runtime.file !== previous.file)
    await unlink(join(root, VENDOR, runtime.file));
  await depend(root, previous.file);
  const { kept: _kept, ...restored } = previous;
  line.runtime = restored;
  line.previous = {
    ...runtime,
    kept: git(["rev-parse", "--short", "HEAD"]).trim(),
  };
  await writeJson(root, LINE, line);
  return line;
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
  const commit = args[args.indexOf("--commit") + 1];
  try {
    const line = args.includes("--restore")
      ? await restorePrevious({ root, git: run("git") })
      : args.includes("--commit") && commit
        ? await vendorCommit({ root, commit, gh: run("gh"), git: run("git") })
        : null;
    if (!line) throw new Error("Give --commit <sha> or --restore");
    console.log(
      `Runtime: ${line.runtime.file} (${line.runtime.built}); before it: ${line.previous.file}.\nRun pnpm install, then the RNL suites; record both combinations in the pull request.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
