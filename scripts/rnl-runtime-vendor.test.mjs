import { copyFileSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import line from "../packages/rnl/src/rnl-version-line.json" with { type: "json" };
import {
  inspectPackage,
  restorePrevious,
  vendorCommit,
} from "./rnl-runtime-vendor.mjs";

const vendored = new URL(
  `../packages/rnl/vendor/${line.runtime.file}`,
  import.meta.url,
);
const sha = "5347dcb2f0b1a8f7c3e9d4a6b2c1e0f9a8b7c6d5";

let root;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/** A checkout holding the vendored runtime as it stands, and its dependents. */
async function checkout() {
  root = await mkdtemp(join(tmpdir(), "rnl-vendor-test-"));
  await mkdir(join(root, "packages/rnl/src"), { recursive: true });
  await mkdir(join(root, "packages/rnl/vendor"), { recursive: true });
  await mkdir(join(root, "apps/editor"), { recursive: true });
  await copyFile(
    vendored,
    join(root, "packages/rnl/vendor", line.runtime.file),
  );
  const { previous: _previous, ...current } = line;
  await writeFile(
    join(root, "packages/rnl/src/rnl-version-line.json"),
    JSON.stringify(current),
  );
  await writeFile(
    join(root, "packages/rnl/package.json"),
    JSON.stringify({
      devDependencies: {
        "@rich-netlist/runtime": `file:vendor/${line.runtime.file}`,
      },
    }),
  );
  await writeFile(
    join(root, "apps/editor/package.json"),
    JSON.stringify({
      dependencies: {
        "@rich-netlist/runtime": `file:../../packages/rnl/vendor/${line.runtime.file}`,
      },
    }),
  );
}

const json = async (path) =>
  JSON.parse(await readFile(join(root, path), "utf8"));

/** Upstream as `gh` answers: one nightly run that built the package from `sha`. */
function gh(args) {
  if (args[0] === "api") return `${sha}\n`;
  if (args[0] === "run" && args[1] === "list")
    return JSON.stringify(
      args.includes("core-nightly.yml") && args.includes(sha)
        ? [{ databaseId: 42 }]
        : [],
    );
  if (args[0] === "run" && args[1] === "download") {
    expect(args).toEqual(expect.arrayContaining(["42", "--name", "core-npm"]));
    const dir = args[args.indexOf("--dir") + 1];
    // The nightly names its package by the workspace version, not the commit.
    copyFileSync(vendored, join(dir, "rich-netlist-runtime-0.5.5.tgz"));
    return "";
  }
  throw new Error(`unexpected gh ${args.join(" ")}`);
}

it("names the vendored file the dependents use", async () => {
  const manifest = async (path) =>
    JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
  expect(
    (await manifest("packages/rnl/package.json")).devDependencies[
      "@rich-netlist/runtime"
    ],
  ).toBe(`file:vendor/${line.runtime.file}`);
  expect(
    (await manifest("apps/editor/package.json")).dependencies[
      "@rich-netlist/runtime"
    ],
  ).toBe(`file:../../packages/rnl/vendor/${line.runtime.file}`);
});

it("says what a runtime package is, with the integrity pnpm locks", async () => {
  const lock = await readFile(
    new URL("../pnpm-lock.yaml", import.meta.url),
    "utf8",
  );
  const built = inspectPackage(await readFile(vendored));
  expect(built).toMatchObject({
    name: "@rich-netlist/runtime",
    version: line.runtime.version,
    solver: false,
  });
  expect(lock).toContain(built.integrity);
});

it("vendors CI's build of a commit, points the dependents at it and keeps the one it replaces", async () => {
  await checkout();
  const result = await vendorCommit({
    root,
    commit: "5347dcb2",
    gh,
    git: () => "abc1234\n",
  });
  const file = "rich-netlist-runtime-main-5347dcb2.tgz";
  expect(await readdir(join(root, "packages/rnl/vendor"))).toEqual([file]);
  expect(result.runtime).toEqual({
    package: "@rich-netlist/runtime",
    source: "commit",
    commit: sha,
    version: line.runtime.version,
    file,
    built:
      "rich-netlist/rnl actions run 42 (core-nightly.yml, artifact core-npm)",
    solver: false,
    integrity: inspectPackage(await readFile(vendored)).integrity,
  });
  expect(result.previous).toEqual({ ...line.runtime, kept: "abc1234" });
  expect(await json("packages/rnl/src/rnl-version-line.json")).toEqual(result);
  expect(
    (await json("apps/editor/package.json")).dependencies[
      "@rich-netlist/runtime"
    ],
  ).toBe(`file:../../packages/rnl/vendor/${file}`);
  expect(
    (await json("packages/rnl/package.json")).devDependencies[
      "@rich-netlist/runtime"
    ],
  ).toBe(`file:vendor/${file}`);
});

it("refuses a commit no CI run built the package from", async () => {
  await checkout();
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
    line.runtime.file,
  ]);
});

it("restores the combination before, from the commit that kept it, and back again", async () => {
  await checkout();
  const previous = {
    ...line.runtime,
    commit: "b4c3f857578893a95844db6c754e6fdb5eed9b43",
    version: "0.6.0-dev.b4c3f857",
    file: "rich-netlist-runtime-0.6.0-dev.b4c3f857.tgz",
    kept: "751e0e3ad",
  };
  await writeFile(
    join(root, "packages/rnl/src/rnl-version-line.json"),
    JSON.stringify({
      ...(await json("packages/rnl/src/rnl-version-line.json")),
      previous,
    }),
  );
  const old = Buffer.from("old runtime bytes");
  const git = (args) => {
    if (args[0] === "show") {
      expect(args[1]).toBe(`751e0e3ad:packages/rnl/vendor/${previous.file}`);
      return old;
    }
    return "def5678\n";
  };
  const restored = await restorePrevious({ root, git });
  expect(restored.runtime.file).toBe(previous.file);
  expect(restored.runtime).not.toHaveProperty("kept");
  expect(restored.previous).toMatchObject({
    file: line.runtime.file,
    kept: "def5678",
  });
  expect(await readdir(join(root, "packages/rnl/vendor"))).toEqual([
    previous.file,
  ]);
  expect(
    (await json("apps/editor/package.json")).dependencies[
      "@rich-netlist/runtime"
    ],
  ).toBe(`file:../../packages/rnl/vendor/${previous.file}`);
  expect(
    (await json("packages/rnl/package.json")).devDependencies[
      "@rich-netlist/runtime"
    ],
  ).toBe(`file:vendor/${previous.file}`);
});
