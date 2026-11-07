#!/usr/bin/env node
// Runs every containers/**/*.test.py with the system Python 3 (unittest, no
// third-party packages). The regional host's runners are Python; their tests
// gate CI like the Worker's. Linux behaviour (symlinks, systemd paths) is the
// contract, so a host that cannot create symlinks skips those cases itself.
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const python =
  process.env.ICM_PYTHON ??
  (process.platform === "win32" ? "python" : "python3");
const tests = globSync("containers/**/*.test.py", { cwd: root }).sort();
let failed = 0;
for (const test of tests) {
  const result = spawnSync(python, ["-I", test], {
    cwd: root,
    encoding: "utf8",
  });
  const tail = `${result.stdout}${result.stderr}`
    .trim()
    .split("\n")
    .slice(-3)
    .join("\n");
  console.log(`${result.status === 0 ? "ok  " : "FAIL"} ${test}\n${tail}`);
  if (result.status !== 0) failed++;
}
if (!tests.length) throw new Error("No Python tests found");
process.exit(failed ? 1 : 0);
