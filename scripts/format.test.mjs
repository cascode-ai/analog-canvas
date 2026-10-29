import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const roots = [];
const cli = resolve("scripts/format.mjs");
function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
function put(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function commit(root) {
  git(root, "add", ".");
  git(root, "commit", "-qm", "fixture");
  return git(root, "rev-parse", "HEAD");
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ci-format-"));
  roots.push(root);
  git(root, "init", "-q");
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "Fixture");
  for (const path of ["package.json", "references/one.json"])
    put(root, path, "{}\n");
  for (const path of [
    "apps/editor/old.ts",
    "packages/model/one.ts",
    "scripts/one.mjs",
  ])
    put(root, path, "export const value = 1;\n");
  return root;
}
function check(root, base) {
  return spawnSync(process.execPath, [cli, "--check"], {
    cwd: root,
    env: { ...process.env, FORMAT_BASE_SHA: base ?? "" },
    encoding: "utf8",
  });
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("checks the changed file and leaves pre-existing formatting outside its scope", () => {
  const root = fixture();
  put(root, "apps/editor/old.ts", "export const old=1\n");
  const base = commit(root);
  put(root, "apps/editor/changed.ts", "export const value = 2;\n");
  commit(root);
  expect(check(root, base).status).toBe(0);
  put(root, "apps/editor/changed.ts", "export const value=2\n");
  commit(root);
  const result = check(root, base);
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain("changed.ts");
});

it.each([
  ".prettierrc",
  "apps/editor/prettier.config.mjs",
  ".prettierignore",
  ".editorconfig",
  "pnpm-lock.yaml",
  "package.json",
])("checks the full format domain when %s changes", (path) => {
  const root = fixture();
  put(root, "apps/editor/old.ts", "export const old=1\n");
  const base = commit(root);
  put(
    root,
    path,
    path.endsWith(".mjs")
      ? "export default {};\n"
      : path.endsWith(".json") || path === ".prettierrc"
        ? '{"singleQuote":true}\n'
        : "# changed\n",
  );
  commit(root);
  const result = check(root, base);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("Full formatting check:");
  expect(result.stdout + result.stderr).toContain("old.ts");
});

it("handles deleted files and literal renamed paths containing spaces and glob characters", () => {
  const root = fixture();
  const base = commit(root);
  git(root, "mv", "apps/editor/old.ts", "apps/editor/[renamed] 中文 space.ts");
  git(root, "rm", "packages/model/one.ts");
  commit(root);
  expect(check(root, base).status).toBe(0);
  put(root, "apps/editor/[renamed] 中文 space.ts", "export const value=1\n");
  commit(root);
  expect(check(root, base).status).toBe(1);
});

it.each(["package.yaml", "apps/editor/package.yaml"])(
  "checks existing sources when %s changes Prettier options",
  (path) => {
    const root = fixture();
    const base = commit(root);
    put(root, path, "prettier:\n  semi: false\n");
    commit(root);
    const result = check(root, base);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Full formatting check:");
    expect(result.stdout + result.stderr).toContain("old.ts");
  },
);

it.each(["delete", "rename"])(
  "falls back when a configuration is removed by %s",
  (operation) => {
    const root = fixture();
    put(root, ".prettierrc", "{}\n");
    put(root, "apps/editor/old.ts", "export const old=1\n");
    const base = commit(root);
    if (operation === "delete") git(root, "rm", ".prettierrc");
    else git(root, "mv", ".prettierrc", "old-format-config.txt");
    commit(root);
    const result = check(root, base);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Full formatting check:");
  },
);

it.each(["", "bad-base", "0".repeat(40)])(
  "checks everything without a trustworthy base: %s",
  (base) => {
    const root = fixture();
    put(root, "apps/editor/old.ts", "export const old=1\n");
    commit(root);
    const result = check(root, base);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("old.ts");
  },
);

it("falls back and fails when the selected file's configuration cannot be read", () => {
  const root = fixture();
  put(root, ".prettierrc", "{broken");
  const base = commit(root);
  put(root, "apps/editor/changed.ts", "export const value = 2;\n");
  commit(root);
  const result = check(root, base);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain("Full formatting check:");
});

it("does not invoke an unbounded check for an empty formatting selection", () => {
  const root = fixture();
  put(root, "apps/editor/old.ts", "export const old=1\n");
  const base = commit(root);
  put(root, "docs/note.md", "text\n");
  commit(root);
  expect(check(root, base).status).toBe(0);
});
