import { mkdtemp, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { root } from "./canvas_upstream.mjs";

const personal = await mkdtemp(path.join(os.tmpdir(), "vc-pr-tests-"));
const env = { ...process.env, VC_PERSONAL_DIR: personal };
delete env.VC_ROOT;
for (const key of [
  "PYTHONHOME",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "PYTHONUSERBASE",
])
  delete env[key];
try {
  const tests = (await readdir(path.join(root, "tests"))).filter((name) =>
    name.endsWith(".test.mjs"),
  );
  const run = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-concurrency=2",
      ...tests.map((name) => path.join(root, "tests", name)),
    ],
    { env, stdio: "inherit" },
  );
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
  if (process.exitCode === 0) {
    const python = spawnSync(
      process.env.VC_PYTHON ?? "python3",
      [path.join(root, "tests/test_wire_geometry.py")],
      { env, stdio: "inherit" },
    );
    if (python.error) throw python.error;
    process.exitCode = python.status ?? 1;
  }
} finally {
  await rm(personal, { recursive: true, force: true });
}
