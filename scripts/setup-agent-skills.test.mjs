import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, expect, test } from "vitest";

const script = readFileSync(
  new URL("./setup-agent-skills.mjs", import.meta.url),
);
const fixtures = [];

afterEach(() => {
  for (const root of fixtures.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(names = ["alpha", "zeta"]) {
  const root = mkdtempSync(join(tmpdir(), "claude skills-"));
  fixtures.push(root);
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts", "setup-agent-skills.mjs"), script);
  mkdirSync(join(root, ".agents", "skills"), { recursive: true });
  for (const name of names) {
    mkdirSync(join(root, ".agents", "skills", name));
    writeFileSync(
      join(root, ".agents", "skills", name, "SKILL.md"),
      `---\nname: ${name}\ndisable-model-invocation: true\n---\nOriginal instructions\n`,
    );
  }
  return root;
}

function run(root, ...args) {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts", "setup-agent-skills.mjs"), ...args],
    {
      cwd: join(root, "scripts"),
      encoding: "utf8",
    },
  );
  return { status: result.status, output: result.stdout + result.stderr };
}

function link(target, path) {
  symlinkSync(
    process.platform === "win32" ? target : relative(join(path, ".."), target),
    path,
    process.platform === "win32" ? "junction" : "dir",
  );
}

test("fresh checkout registers whole folders, preserves originals and is repeatable", () => {
  const root = fixture();
  const source = join(root, ".agents", "skills", "alpha");
  const destination = join(root, ".claude", "skills", "alpha");
  const original = readFileSync(join(source, "SKILL.md"), "utf8");
  writeFileSync(join(source, "REFERENCE.md"), "Supporting reference");
  expect(run(root)).toEqual({
    status: 0,
    output: expect.stringContaining("2 new links"),
  });
  expect(lstatSync(destination).isSymbolicLink()).toBe(true);
  expect(realpathSync(destination)).toBe(realpathSync(source));
  expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toBe(original);
  expect(readFileSync(join(destination, "REFERENCE.md"), "utf8")).toBe(
    "Supporting reference",
  );
  writeFileSync(join(source, "REFERENCE.md"), "Updated reference");
  expect(readFileSync(join(destination, "REFERENCE.md"), "utf8")).toBe(
    "Updated reference",
  );
  expect(run(root)).toEqual({
    status: 0,
    output: expect.stringContaining("0 new links"),
  });
  expect(run(root, "--check").status).toBe(0);
});

test("unrelated custom skills remain alongside registered project skills", () => {
  const root = fixture();
  const custom = join(root, ".claude", "skills", "custom");
  mkdirSync(custom, { recursive: true });
  writeFileSync(join(custom, "SKILL.md"), "User-owned instructions");
  expect(run(root).status).toBe(0);
  expect(readFileSync(join(custom, "SKILL.md"), "utf8")).toBe(
    "User-owned instructions",
  );
  expect(existsSync(join(root, ".agents", "skills", "custom"))).toBe(false);
});

test("same-name user content prevents any registration without being overwritten", () => {
  const root = fixture();
  const custom = join(root, ".claude", "skills", "zeta");
  mkdirSync(custom, { recursive: true });
  writeFileSync(join(custom, "SKILL.md"), "User-owned zeta");
  expect(run(root)).toEqual({
    status: 1,
    output: expect.stringContaining(custom),
  });
  expect(existsSync(join(root, ".claude", "skills", "alpha"))).toBe(false);
  expect(readFileSync(join(custom, "SKILL.md"), "utf8")).toBe(
    "User-owned zeta",
  );
});

test("previous whole-directory registration is accepted unchanged", () => {
  const root = fixture();
  mkdirSync(join(root, ".claude"));
  const destination = join(root, ".claude", "skills");
  link(join(root, ".agents", "skills"), destination);
  expect(run(root).status).toBe(0);
  expect(run(root, "--check").status).toBe(0);
  expect(lstatSync(destination).isSymbolicLink()).toBe(true);
});

test("foreign and dangling links are preserved and rejected", () => {
  for (const dangling of [false, true]) {
    const root = fixture();
    const external = join(root, "external");
    mkdirSync(external);
    mkdirSync(join(root, ".claude", "skills"), { recursive: true });
    const destination = join(root, ".claude", "skills", "alpha");
    link(external, destination);
    if (dangling) rmSync(external, { recursive: true });
    expect(run(root)).toEqual({
      status: 1,
      output: expect.stringContaining(destination),
    });
    expect(lstatSync(destination).isSymbolicLink()).toBe(true);
    expect(existsSync(join(root, ".claude", "skills", "zeta"))).toBe(false);
  }
});

test("registration root files and foreign directory links are preserved", () => {
  for (const kind of ["file", "link", "parent-link"]) {
    const root = fixture();
    const claude = join(root, ".claude");
    const external = join(root, "external");
    mkdirSync(external);
    if (kind === "parent-link") {
      link(external, claude);
    } else {
      mkdirSync(claude);
      if (kind === "file") writeFileSync(join(claude, "skills"), "User file");
      else link(external, join(claude, "skills"));
    }
    expect(run(root).status).toBe(1);
    expect(existsSync(join(external, "alpha"))).toBe(false);
    expect(existsSync(join(external, "skills"))).toBe(false);
    if (kind === "file")
      expect(readFileSync(join(claude, "skills"), "utf8")).toBe("User file");
    else
      expect(
        lstatSync(
          kind === "parent-link" ? claude : join(claude, "skills"),
        ).isSymbolicLink(),
      ).toBe(true);
  }
});

test("check mode reports missing links without creating directories", () => {
  const root = fixture();
  expect(run(root, "--check")).toEqual({
    status: 1,
    output: expect.stringContaining("pnpm setup:skills"),
  });
  expect(existsSync(join(root, ".claude"))).toBe(false);
});

test("empty sources fail instead of reporting successful registration", () => {
  const root = fixture([]);
  mkdirSync(join(root, ".agents", "skills", "not-a-skill"));
  expect(run(root)).toEqual({
    status: 1,
    output: expect.stringContaining("No project skills found"),
  });
  expect(existsSync(join(root, ".claude"))).toBe(false);
});
