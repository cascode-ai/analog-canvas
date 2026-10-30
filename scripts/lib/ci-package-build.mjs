import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  globSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";

const filters = [
  "@icm/agent-adapter...",
  "@icm/exporters...",
  "@icm/simulation-service...",
];
const selection = filters.flatMap((filter) => ["--filter", filter]);
const receiptPath = "output/ci-packages.json";

function pnpm(root, args, stdio = "pipe") {
  // All arguments are repository-owned selectors/commands, never shell input.
  if (args.some((arg) => !/^[-@A-Za-z0-9_./:*!]+$/u.test(arg)))
    throw new Error("Unsafe package build argument");
  return execFileSync(
    process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm",
    process.platform === "win32"
      ? ["/d", "/v:off", "/s", "/c", `pnpm ${args.join(" ")}`]
      : args,
    { cwd: root, encoding: "utf8", stdio, timeout: 180000 },
  );
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}
function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function packages(root) {
  return JSON.parse(
    pnpm(root, [...selection, "list", "--depth", "-1", "--json"]),
  )
    .map(({ name, path }) => {
      const directory = relative(root, path).replaceAll("\\", "/");
      if (
        !/^packages\/[^/]+$/u.test(directory) ||
        !/^@[a-z0-9-]+\/[a-z0-9-]+$/u.test(name)
      )
        throw new Error(`Unexpected shared package: ${name} at ${directory}`);
      return { name, directory };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}
function identity(root) {
  const inputs = git(root, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    "packages",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
  ])
    .split("\0")
    .filter(Boolean)
    .sort();
  return {
    commit: git(root, ["rev-parse", "HEAD"]).trim(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    pnpm: pnpm(root, ["--version"]).trim(),
    inputs: digest(
      JSON.stringify(
        inputs.map((path) => [path, digest(readFileSync(resolve(root, path)))]),
      ),
    ),
  };
}
function inventory(root, shared) {
  const files = {};
  for (const { directory } of shared) {
    const paths = globSync(`${directory}/dist/**/*`, { cwd: root })
      .filter((path) => statSync(resolve(root, path)).isFile())
      .sort();
    if (!paths.some((path) => path.endsWith(".js")))
      throw new Error(`Missing built output for ${directory}`);
    for (const path of paths)
      files[path.replaceAll("\\", "/")] = digest(
        readFileSync(resolve(root, path)),
      );
  }
  return files;
}

export function buildStandalonePackages(root) {
  pnpm(root, [...selection, "build"], "inherit");
}

export function producePackageBuild(root) {
  buildStandalonePackages(root);
  const shared = packages(root);
  if (shared.length === 0) throw new Error("No shared packages selected");
  const receipt = {
    schemaVersion: 1,
    identity: identity(root),
    packages: shared,
    files: inventory(root, shared),
  };
  mkdirSync(dirname(resolve(root, receiptPath)), { recursive: true });
  writeFileSync(
    resolve(root, receiptPath),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(
    `Shared package build: ${shared.length} packages, ${Object.keys(receipt.files).length} files`,
  );
}

export function verifyPackageBuild(root) {
  const receipt = JSON.parse(readFileSync(resolve(root, receiptPath), "utf8"));
  if (receipt.schemaVersion !== 1)
    throw new Error("Unsupported package build receipt");
  const expected = identity(root);
  for (const key of Object.keys(expected)) {
    if (receipt.identity?.[key] !== expected[key])
      throw new Error(`Package build identity mismatch: ${key}`);
  }
  const shared = packages(root);
  if (JSON.stringify(receipt.packages) !== JSON.stringify(shared))
    throw new Error("Package build selection mismatch");
  if (JSON.stringify(receipt.files) !== JSON.stringify(inventory(root, shared)))
    throw new Error("Package build files missing, stale or changed");
  return shared;
}

export function buildRemainingPackages(root) {
  const shared = verifyPackageBuild(root);
  pnpm(
    root,
    [
      "-r",
      ...shared.flatMap(({ name }) => ["--filter", `!${name}`]),
      "--if-present",
      "build",
    ],
    "inherit",
  );
}
