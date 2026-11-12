import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const CLI = resolve(import.meta.dirname, "canvas-local.mjs");
const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true });
});

/** The command line with no network: an adapter path stands for a release. */
function run(...args) {
  const home = mkdtempSync(join(tmpdir(), "canvas-local-"));
  made.push(home);
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ANALOG_CANVAS_HOME: home,
      ANALOG_CANVAS_MCP: join(home, "analog-canvas-mcp.mjs"),
    },
  });
}

describe("canvas-local command line", () => {
  it("lists its commands", () => {
    const help = run("help");
    expect(help.status).toBe(0);
    for (const command of ["new", "call", "png", "svg", "netlist", "setup"])
      expect(help.stdout).toContain(`  ${command} `);
  });

  it("names a directory that is not a workspace before exporting", () => {
    const result = run("png", join(tmpdir(), "no-such-workspace"));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/is not a workspace; create one with/u);
  });

  it("refuses a version that is not a release", () => {
    const result = spawnSync(
      process.execPath,
      [CLI, "setup", "--version", "latest"],
      { encoding: "utf8", env: { ...process.env, ANALOG_CANVAS_MCP: "" } },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Not a release version: latest");
  });
});
