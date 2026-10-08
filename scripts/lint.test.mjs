import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "..");
const oxlint = join(repo, "node_modules", "oxlint", "bin", "oxlint");

/** oxlint's diagnostics for this file alone, as verify:pr lints a change. */
const lintAlone = (path) =>
  new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [oxlint, "--format=json", path],
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

/**
 * Lints each `[tree, name, source]` probe alone, from a fresh directory of
 * its tree so it is the only file of its kind there, and gives each tree's
 * `[rule, line]` diagnostics.
 */
async function lintProbes(probes) {
  const directories = [];
  try {
    const reports = await Promise.all(
      probes.map(async ([tree, name, source]) => {
        const directory = await mkdtemp(join(repo, tree, "lint-probe-"));
        directories.push(directory);
        const file = join(directory, name);
        await writeFile(file, source);
        const diagnostics = await lintAlone(relative(repo, file));
        return [
          tree,
          diagnostics.map((item) => [item.code, item.labels[0].span.line]),
        ];
      }),
    );
    return Object.fromEntries(reports);
  } finally {
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  }
}

const floatingRemove = (typed) =>
  [
    'import { rm } from "node:fs/promises";',
    "",
    `export function clean(directory${typed ? ": string" : ""}) {`,
    "  rm(directory, { recursive: true, force: true });",
    "}",
    "",
  ].join("\n");

describe("pnpm lint on one file", () => {
  it("knows Node's promises in a file no package tsconfig includes", async () => {
    // Trees no app or package tsconfig.json includes.
    const probes = [
      ["packages/model/src", "probe.test.ts"],
      ["apps/local-host/src", "probe.test.ts"],
      ["apps/editor/e2e", "probe.spec.ts"],
      ["apps/editor/dev", "probe.ts"],
      ["apps/desktop/src", "probe.ts"],
      ["worker", "probe.ts"],
      ["scripts", "probe.mjs"],
    ];
    expect(
      await lintProbes(
        probes.map(([tree, name]) => [
          tree,
          name,
          floatingRemove(name.endsWith(".ts")),
        ]),
      ),
    ).toEqual(
      Object.fromEntries(
        probes.map(([tree]) => [
          tree,
          [["typescript(no-floating-promises)", 4]],
        ]),
      ),
    );
  }, 60_000);

  it("still reports a union switch that leaves a member to its default", async () => {
    const source = [
      'export function label(kind: "net" | "power"): string {',
      "  switch (kind) {",
      '    case "net":',
      '      return "Net";',
      "    default:",
      '      return "Label";',
      "  }",
      "}",
      "",
    ].join("\n");
    expect(
      await lintProbes([["packages/model/src", "probe.ts", source]]),
    ).toEqual({
      "packages/model/src": [["typescript(switch-exhaustiveness-check)", 2]],
    });
  }, 60_000);
});
