import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "..");
const oxlint = join(repo, "node_modules", "oxlint", "bin", "oxlint");

/** oxlint's diagnostics for these files alone, as verify:pr lints a change. */
const lintAlone = (paths) =>
  new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [oxlint, "--format=json", ...paths],
      { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        try {
          resolve(JSON.parse(stdout).diagnostics);
        } catch {
          reject(error ?? new Error(`oxlint printed no report: ${stderr}`));
        }
      },
    );
  });

const floatingRemove = (typed) =>
  [
    'import { rm } from "node:fs/promises";',
    "",
    `export function clean(directory${typed ? ": string" : ""}) {`,
    "  rm(directory, { recursive: true, force: true });",
    "}",
    "",
  ].join("\n");

// Trees no app or package tsconfig.json includes. Each probe sits in a fresh
// directory of its tree, so it is the only file of its kind there.
const probes = [
  ["packages/model/src", "probe.test.ts"],
  ["apps/local-host/src", "probe.test.ts"],
  ["apps/editor/e2e", "probe.spec.ts"],
  ["apps/editor/dev", "probe.ts"],
  ["apps/desktop/src", "probe.ts"],
  ["worker", "probe.ts"],
  ["scripts", "probe.mjs"],
];

describe("pnpm lint on one file", () => {
  it("knows Node's promises in a file no package tsconfig includes", async () => {
    const directories = [];
    try {
      const reports = await Promise.all(
        probes.map(async ([tree, name]) => {
          const directory = await mkdtemp(join(repo, tree, "lint-probe-"));
          directories.push(directory);
          const file = join(directory, name);
          await writeFile(file, floatingRemove(name.endsWith(".ts")));
          const diagnostics = await lintAlone([relative(repo, file)]);
          return [
            tree,
            diagnostics.map((item) => [item.code, item.labels[0].span.line]),
          ];
        }),
      );
      expect(Object.fromEntries(reports)).toEqual(
        Object.fromEntries(
          probes.map(([tree]) => [
            tree,
            [["typescript(no-floating-promises)", 4]],
          ]),
        ),
      );
    } finally {
      await Promise.all(
        directories.map((directory) =>
          rm(directory, { recursive: true, force: true }),
        ),
      );
    }
  }, 60_000);
});
