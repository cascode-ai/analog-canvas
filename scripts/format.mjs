import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { createRequire } from "node:module";
import { matchesGlob } from "node:path";
import { resolveConfig } from "prettier";

const patterns = [
  "apps/**/*.{ts,tsx,json,css,html}",
  "packages/**/*.{ts,tsx,json}",
  "references/**/*.json",
  "scripts/**/*.mjs",
  "*.{json,yaml}",
];
const mode = process.argv[2];
if (!["--check", "--write"].includes(mode)) {
  throw new Error("Usage: node scripts/format.mjs --check|--write");
}

let paths = patterns;
const base = process.env.FORMAT_BASE_SHA;
if (mode === "--check" && base !== undefined) {
  try {
    if (!/^[a-f0-9]{40}$/u.test(base)) throw new Error("invalid base SHA");
    execFileSync("git", ["merge-base", "--is-ancestor", base, "HEAD"], {
      stdio: "pipe",
    });
    const changed = execFileSync(
      "git",
      ["diff", "--name-only", "-z", "--no-renames", base, "HEAD", "--"],
      { encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean);
    const config = changed.find((path) =>
      /(?:^|\/)(?:\.prettierrc(?:\..+)?|prettier\.config\..+|\.prettierignore|\.editorconfig|\.gitignore|package\.(?:json|yaml)|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/u.test(
        path,
      ),
    );
    if (config) throw new Error(`format configuration changed: ${config}`);
    paths = changed.filter(
      (path) =>
        patterns.some((pattern) => matchesGlob(path, pattern)) &&
        lstatSync(path, { throwIfNoEntry: false })?.isFile(),
    );
    // Config lookup errors must never turn into a trusted partial check.
    for (const path of paths) await resolveConfig(path, { editorconfig: true });
    console.log(`Formatting changed files: ${paths.length}`);
  } catch (error) {
    paths = patterns;
    console.log(`Full formatting check: ${error.message}`);
  }
}
if (paths.length > 0) {
  const require = createRequire(import.meta.url);
  const result = spawnSync(
    process.execPath,
    [require.resolve("prettier/bin/prettier.cjs"), mode, "--", ...paths],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
