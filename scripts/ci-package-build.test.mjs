import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const compiler = join(
  dirname(require.resolve("typescript/package.json")),
  "bin/tsc",
);
const cli = resolve("scripts/ci-package-build.mjs");
const roots = [];
function put(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(
    join(root, path),
    typeof value === "string" ? value : JSON.stringify(value),
  );
}
function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ci-package-build-"));
  roots.push(root);
  put(root, "package.json", { private: true, packageManager: "pnpm@11.16.0" });
  put(root, "pnpm-workspace.yaml", "packages:\n  - packages/*\n");
  put(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  put(root, ".gitignore", "dist/\noutput/\n");
  for (const name of [
    "agent-adapter",
    "exporters",
    "simulation-service",
    "remaining",
  ]) {
    put(root, `packages/${name}/package.json`, {
      name: `@icm/${name}`,
      type: "module",
      scripts: { build: `node "${compiler}" -p tsconfig.json` },
    });
    put(root, `packages/${name}/tsconfig.json`, {
      compilerOptions: {
        rootDir: "src",
        outDir: "dist",
        module: "ESNext",
        declaration: true,
        skipLibCheck: true,
        types: [],
      },
      include: ["src"],
    });
    put(
      root,
      `packages/${name}/src/index.ts`,
      "export const value: number = 42;\n",
    );
  }
  git(root, "init", "-q");
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "Fixture");
  git(root, "add", ".");
  git(root, "commit", "-qm", "fixture");
  return root;
}
function run(root, mode) {
  return spawnSync(process.execPath, [cli, mode], {
    cwd: root,
    encoding: "utf8",
    timeout: 60000,
  });
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("builds consumable standalone dependencies and accepts the matching artifact", () => {
  const root = fixture();
  const built = run(root, "build");
  expect(built.status, built.stdout + built.stderr).toBe(0);
  const consumer = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import { value } from './packages/agent-adapter/dist/index.js'; console.log(value);",
    ],
    { cwd: root, encoding: "utf8" },
  );
  expect(consumer.stdout.trim()).toBe("42");
  expect(run(root, "verify").status).toBe(0);
}, 60000);

it("rejects artifacts from a different candidate, platform or toolchain", () => {
  const root = fixture();
  expect(run(root, "build").status).toBe(0);
  const receipt = JSON.parse(
    readFileSync(join(root, "output/ci-packages.json"), "utf8"),
  );
  for (const key of ["commit", "platform", "arch", "node", "pnpm", "inputs"]) {
    put(root, "output/ci-packages.json", {
      ...receipt,
      identity: { ...receipt.identity, [key]: "different" },
    });
    const result = run(root, "verify");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`identity mismatch: ${key}`);
  }
}, 60000);

it("rejects missing output, changed bytes and source changed since the build", () => {
  const root = fixture();
  expect(run(root, "build").status).toBe(0);
  const path = "packages/agent-adapter/dist/index.js";
  const original = readFileSync(join(root, path));
  rmSync(join(root, path));
  expect(run(root, "verify").status).toBe(1);
  put(root, path, "export const value = 99;");
  expect(run(root, "verify").status).toBe(1);
  writeFileSync(join(root, path), original);
  put(root, "packages/agent-adapter/src/index.ts", "export const value = 99;");
  const result = run(root, "verify");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("identity mismatch: inputs");
  put(
    root,
    "packages/agent-adapter/src/index.ts",
    "export const value: number = 42;\n",
  );
  put(root, "packages/agent-adapter/src/new.ts", "export const extra = 7;\n");
  expect(run(root, "verify").status).toBe(1);
}, 60000);

it("requires a receipt and builds the remaining workspace after verification", () => {
  const root = fixture();
  expect(run(root, "verify").status).toBe(1);
  expect(run(root, "build").status).toBe(0);
  const result = run(root, "remaining");
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(
    readFileSync(join(root, "packages/remaining/dist/index.js"), "utf8"),
  ).toContain("42");
  expect(run(root, "verify").status).toBe(0);
}, 60000);

it("keeps local standalone setup building fresh output and rejects stale CI output", () => {
  const root = fixture();
  function setup(ci) {
    return spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const {default: setup} = await import(process.env.SETUP_URL); setup({config:{root:process.cwd()},onTestsRerun(){}});",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          ICM_CI_PACKAGE_BUILD: ci ? "1" : "",
          SETUP_URL: pathToFileURL(resolve("scripts/test-standalone-setup.mjs"))
            .href,
        },
        encoding: "utf8",
        timeout: 60000,
      },
    );
  }
  expect(setup(false).status).toBe(0);
  put(root, "packages/agent-adapter/src/index.ts", "export const value = 99;");
  expect(setup(false).status).toBe(0);
  expect(
    readFileSync(join(root, "packages/agent-adapter/dist/index.js"), "utf8"),
  ).toContain("99");
  expect(setup(true).status).toBe(1);
  expect(run(root, "build").status).toBe(0);
  expect(setup(true).status).toBe(0);
  put(
    root,
    "packages/agent-adapter/dist/index.js",
    "export const value = 100;",
  );
  expect(setup(true).status).toBe(1);
}, 60000);
