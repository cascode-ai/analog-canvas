import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";

import line from "../packages/rnl/src/rnl-version-line.json" with { type: "json" };
import {
  inspectPackage,
  listedSha256,
  lockRelease,
  restorePrevious,
  vendorCommit,
} from "./rnl-runtime-vendor.mjs";

const PACKAGE = "@rich-netlist/runtime";
const sha = "5347dcb2f0b1a8f7c3e9d4a6b2c1e0f9a8b7c6d5";

/** A gzipped tar archive of files, as npm packs them. */
function pack(files) {
  const blocks = [];
  for (const [path, text] of Object.entries(files)) {
    const body = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(path, 0);
    header.write("0000644\0", 100);
    header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("0", 156);
    header.write("ustar\0", 257);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

/** A runtime package of a version, with or without the solver. */
const runtimePackage = (version, solver = true) =>
  pack({
    "package/package.json": JSON.stringify({ name: PACKAGE, version }),
    ...(solver ? { "package/rnl_solver_wasm.wasm": "\0asm" } : {}),
  });
const integrity = (tgz) =>
  `sha512-${createHash("sha512").update(tgz).digest("base64")}`;

/** A runtime CI built from one commit, vendored. */
const vendoredTgz = runtimePackage("0.6.0-dev.11111111");
const vendored = {
  package: PACKAGE,
  source: "commit",
  commit: "1111111111111111111111111111111111111111",
  version: "0.6.0-dev.11111111",
  file: "rich-netlist-runtime-main-11111111.tgz",
  built: "rich-netlist/rnl actions run 7 (core-nightly.yml, artifact core-npm)",
  solver: true,
  integrity: integrity(vendoredTgz),
};
/** An rnl release on npm. */
const releaseTgz = runtimePackage("0.6.0");
const released = {
  package: PACKAGE,
  source: "npm",
  commit: "9c76ba0abae5dea781bdd83c214e53bebb66d8b5",
  version: "0.6.0",
  built: "npm, the rich-netlist/rnl release core-v0.6.0",
  sha256: createHash("sha256").update(releaseTgz).digest("hex"),
  solver: true,
  integrity: integrity(releaseTgz),
};

let root;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

const json = async (path) =>
  JSON.parse(await readFile(join(root, path), "utf8"));
/** How the two dependents name the runtime. */
const dependency = async () => [
  (await json("packages/rnl/package.json")).devDependencies[PACKAGE],
  (await json("apps/editor/package.json")).dependencies[PACKAGE],
];
const naming = (runtime) =>
  runtime.source === "npm"
    ? [runtime.version, runtime.version]
    : [
        `file:vendor/${runtime.file}`,
        `file:../../packages/rnl/vendor/${runtime.file}`,
      ];

/** A checkout whose dependents use `runtime`, vendored or from npm. */
async function checkout(runtime, previous) {
  root = await mkdtemp(join(tmpdir(), "rnl-vendor-test-"));
  await mkdir(join(root, "packages/rnl/src"), { recursive: true });
  await mkdir(join(root, "apps/editor"), { recursive: true });
  // Git keeps no empty folder: an npm release leaves no vendor folder.
  if (runtime.file) {
    await mkdir(join(root, "packages/rnl/vendor"));
    await writeFile(
      join(root, "packages/rnl/vendor", runtime.file),
      vendoredTgz,
    );
  }
  const { previous: _previous, ...current } = line;
  await writeFile(
    join(root, "packages/rnl/src/rnl-version-line.json"),
    JSON.stringify({ ...current, runtime, ...(previous ? { previous } : {}) }),
  );
  const [rnl, editor] = naming(runtime);
  await writeFile(
    join(root, "packages/rnl/package.json"),
    JSON.stringify({ devDependencies: { [PACKAGE]: rnl } }),
  );
  await writeFile(
    join(root, "apps/editor/package.json"),
    JSON.stringify({ dependencies: { [PACKAGE]: editor } }),
  );
}

/** Upstream as `gh` answers: one nightly run that built the package from `sha`, and the release core-v0.6.0. */
function gh(args) {
  if (args[0] === "api")
    return args[1].endsWith("/core-v0.6.0")
      ? `${released.commit}\n`
      : `${sha}\n`;
  if (args[0] === "run" && args[1] === "list")
    return JSON.stringify(
      args.includes("core-nightly.yml") && args.includes(sha)
        ? [{ databaseId: 42 }]
        : [],
    );
  if (args[0] === "run" && args[1] === "download") {
    expect(args).toEqual(expect.arrayContaining(["42", "--name", "core-npm"]));
    // The nightly names its package by the workspace version, not the commit.
    writeFileSync(
      join(args[args.indexOf("--dir") + 1], "rich-netlist-runtime-0.5.5.tgz"),
      vendoredTgz,
    );
    return "";
  }
  if (args[0] === "release" && args[1] === "download") {
    expect(args).toEqual(
      expect.arrayContaining(["core-v0.6.0", "SHA256SUMS.txt"]),
    );
    return `${"0".repeat(64)}  rnl-x86_64-pc-windows-msvc.zip\n${released.sha256}  rich-netlist-runtime-0.6.0.tgz\n`;
  }
  throw new Error(`unexpected gh ${args.join(" ")}`);
}

/** The npm registry with 0.6.0 published as the bytes `tgz`. */
const registry =
  (tgz = releaseTgz) =>
  async (url) => {
    if (url === "https://registry.npmjs.org/@rich-netlist/runtime/0.6.0")
      return Buffer.from(
        JSON.stringify({
          dist: {
            tarball: "https://registry.npmjs.org/t/runtime-0.6.0.tgz",
            integrity: integrity(tgz),
          },
        }),
      );
    if (url === "https://registry.npmjs.org/t/runtime-0.6.0.tgz") return tgz;
    throw new Error(`unexpected fetch ${url}`);
  };

it("points the dependents at the runtime the version line names", async () => {
  const manifest = async (path) =>
    JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
  expect([
    (await manifest("packages/rnl/package.json")).devDependencies[PACKAGE],
    (await manifest("apps/editor/package.json")).dependencies[PACKAGE],
  ]).toEqual(naming(line.runtime));
});

it("locks the runtime's integrity in pnpm-lock.yaml", async () => {
  const lock = await readFile(
    new URL("../pnpm-lock.yaml", import.meta.url),
    "utf8",
  );
  expect(lock).toContain(line.runtime.integrity);
});

it("says what a runtime package is", () => {
  const plain = runtimePackage("0.6.0", false);
  expect(inspectPackage(plain)).toEqual({
    name: PACKAGE,
    version: "0.6.0",
    solver: false,
    integrity: integrity(plain),
  });
  expect(inspectPackage(vendoredTgz).solver).toBe(true);
});

it("reads a file's SHA-256 from a release's SHA256SUMS.txt", () => {
  const sums = `${"a".repeat(64)}  one.tgz\r\n${"b".repeat(64)} *two.zip\n`;
  expect(listedSha256(sums, "two.zip")).toBe("b".repeat(64));
  expect(listedSha256(sums, "three.tgz")).toBeUndefined();
});

it("vendors CI's build of a commit, points the dependents at it and keeps the one it replaces", async () => {
  await checkout(vendored);
  const result = await vendorCommit({
    root,
    commit: "5347dcb2",
    gh,
    git: () => "abc1234\n",
  });
  const file = "rich-netlist-runtime-main-5347dcb2.tgz";
  expect(await readdir(join(root, "packages/rnl/vendor"))).toEqual([file]);
  expect(result.runtime).toEqual({
    package: PACKAGE,
    source: "commit",
    commit: sha,
    version: vendored.version,
    file,
    built:
      "rich-netlist/rnl actions run 42 (core-nightly.yml, artifact core-npm)",
    solver: true,
    integrity: vendored.integrity,
  });
  expect(result.previous).toEqual({ ...vendored, kept: "abc1234" });
  expect(await json("packages/rnl/src/rnl-version-line.json")).toEqual(result);
  expect(await dependency()).toEqual(naming(result.runtime));
});

it("refuses a commit no CI run built the package from", async () => {
  await checkout(vendored);
  await expect(
    vendorCommit({
      root,
      commit: "deadbeef",
      gh: (args) => (args[0] === "api" ? "deadbeef00\n" : "[]"),
      git: () => "abc1234\n",
    }),
  ).rejects.toThrow(
    /No successful core-nightly\.yml or core-release\.yml run/u,
  );
  expect(await readdir(join(root, "packages/rnl/vendor"))).toEqual([
    vendored.file,
  ]);
});

it("locks a release from npm by its exact version, with the SHA-256 its release lists, and drops the vendored file", async () => {
  await checkout(vendored);
  const result = await lockRelease({
    root,
    version: "0.6.0",
    get: registry(),
    gh,
    git: () => "abc1234\n",
  });
  expect(result.runtime).toEqual(released);
  expect(result.previous).toEqual({ ...vendored, kept: "abc1234" });
  expect(await readdir(join(root, "packages/rnl/vendor"))).toEqual([]);
  expect(await dependency()).toEqual(["0.6.0", "0.6.0"]);
  expect(await json("packages/rnl/src/rnl-version-line.json")).toEqual(result);
});

it("refuses a release whose npm bytes are not the ones its release lists", async () => {
  await checkout(vendored);
  await expect(
    lockRelease({
      root,
      version: "0.6.0",
      get: registry(runtimePackage("0.6.0", false)),
      gh,
      git: () => "abc1234\n",
    }),
  ).rejects.toThrow(/the release core-v0\.6\.0 lists/u);
  expect(await dependency()).toEqual(naming(vendored));
});

it("restores the vendored combination before a release, from the commit that kept it, and back again", async () => {
  await checkout(released, { ...vendored, kept: "751e0e3ad" });
  const git = (args) => {
    if (args[0] === "show") {
      expect(args[1]).toBe(`751e0e3ad:packages/rnl/vendor/${vendored.file}`);
      return vendoredTgz;
    }
    return "def5678\n";
  };
  const restored = await restorePrevious({ root, git });
  expect(restored.runtime).toEqual(vendored);
  expect(restored.previous).toEqual({ ...released, kept: "def5678" });
  expect(await readdir(join(root, "packages/rnl/vendor"))).toEqual([
    vendored.file,
  ]);
  expect(await dependency()).toEqual(naming(vendored));

  const again = await restorePrevious({ root, git });
  expect(again.runtime).toEqual(released);
  expect(again.previous).toMatchObject({
    file: vendored.file,
    kept: "def5678",
  });
  expect(await readdir(join(root, "packages/rnl/vendor"))).toEqual([]);
  expect(await dependency()).toEqual(["0.6.0", "0.6.0"]);
});
