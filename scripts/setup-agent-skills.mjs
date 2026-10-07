import { lstat, mkdir, readdir, realpath, symlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = join(root, ".agents", "skills");
const claude = join(root, ".claude");
const destination = join(claude, "skills");

async function lstatIfPresent(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function linksTo(path, target) {
  try {
    return (await realpath(path)) === (await realpath(target));
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function setup(check) {
  const names = [];
  for (const child of await readdir(source, { withFileTypes: true })) {
    if (
      child.isDirectory() &&
      (await lstatIfPresent(join(source, child.name, "SKILL.md")))?.isFile()
    ) {
      names.push(child.name);
    }
  }
  names.sort();
  if (names.length === 0)
    throw new Error(`No project skills found in ${source}`);

  const parent = await lstatIfPresent(claude);
  if (parent && !parent.isDirectory()) {
    throw new Error(`${claude} must be a local directory; inspect it first.`);
  }
  const existing = await lstatIfPresent(destination);
  if (existing?.isSymbolicLink() && (await linksTo(destination, source))) {
    console.log(
      `Verified ${names.length} project skills (existing directory link).`,
    );
    return;
  }
  if (existing && !existing.isDirectory()) {
    throw new Error(
      `${destination} conflicts with project registration; inspect it first.`,
    );
  }

  const missing = [];
  const conflicts = [];
  for (const name of names) {
    const path = join(destination, name);
    const current = await lstatIfPresent(path);
    if (!current) {
      missing.push(name);
    } else if (
      !current.isSymbolicLink() ||
      !(await linksTo(path, join(source, name)))
    ) {
      conflicts.push(path);
    }
  }
  if (conflicts.length > 0) {
    throw new Error(
      `Conflicting Claude skills:\n${conflicts.join("\n")}\nInspect these entries and resolve their names or targets, then rerun setup. Existing content was preserved.`,
    );
  }
  if (check && missing.length > 0) {
    throw new Error(
      `Missing Claude registrations: ${missing.join(", ")}. Run pnpm setup:skills in this checkout.`,
    );
  }

  if (!check && missing.length > 0) {
    await mkdir(destination, { recursive: true });
    for (const name of missing) {
      const target = join(source, name);
      await symlink(
        process.platform === "win32" ? target : relative(destination, target),
        join(destination, name),
        process.platform === "win32" ? "junction" : "dir",
      );
    }
  }
  console.log(
    `Verified ${names.length} project skills for Claude Code (${check ? 0 : missing.length} new links).`,
  );
}

const args = process.argv.slice(2).filter((argument) => argument !== "--");
try {
  if (args.some((argument) => !["--check", "--help"].includes(argument))) {
    throw new Error("Usage: node scripts/setup-agent-skills.mjs [--check]");
  }
  if (args.includes("--help")) {
    console.log(
      "Register this checkout's original skills for Claude Code.\nUsage: node scripts/setup-agent-skills.mjs [--check]\n--check verifies without writing.",
    );
  } else {
    await setup(args.includes("--check"));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
