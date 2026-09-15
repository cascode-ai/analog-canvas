import { afterEach, describe, it, expect } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import { compileSourceSimulation } from "../packages/netlist/dist/index.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

// Synthetic results exercise only the on-disk receipt contract. They must never
// be confused with the real 19-experiment numerical acceptance journey.
function fixture(mode) {
  const root = mkdtempSync(join(tmpdir(), "icm-native-analysis-test-"));
  roots.push(root);
  const text = readFileSync(
    "apps/editor/src/examples/simulation-rc.icproj.json",
    "utf8",
  );
  const project = parseProject(text),
    folder = project.simulationFolders[0];
  const compiled = compileSourceSimulation(project, folder);
  if (!compiled.ok) throw Error(JSON.stringify(compiled));
  const dir = join(root, "results", "rc", folder.id),
    file = join(root, "project.json");
  const write = (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  write(file, text);
  write(
    join(root, "manifest.json"),
    JSON.stringify({
      projects: [{ slug: "rc", file, folders: [{ id: folder.id }] }],
    }),
  );
  const receipt = {
    status: "passed",
    runs: [{ folderId: folder.id, runId: "run-test" }],
    ...(mode === "export-error"
      ? { exportWarnings: [{ message: "plot failed" }] }
      : {}),
  };
  write(join(root, "results", "rc", "receipt.json"), JSON.stringify(receipt));
  const run = {
    id: "run-test",
    state: "finished",
    artifacts: [],
    ...(mode === "run-error" ? { error: { code: "ARTIFACT_CAPACITY" } } : {}),
  };
  const artifact = (name, text) => {
    write(join(dir, name), text);
    run.artifacts.push({
      name,
      sha256: createHash("sha256").update(text).digest("hex"),
    });
  };
  for (const f of compiled.files)
    artifact(
      "executed/" + f.path,
      f.text + (mode === "input-mismatch" ? "\nchanged" : ""),
    );
  const result = {
    outcome: { status: "completed" },
    metadata: {
      environment: {
        profileId: compiled.config.environment.profileId,
        simulator: { name: "vacask" },
        fingerprint: "a".repeat(64),
      },
    },
    data: {
      analyses: [
        {
          analysis: "ac",
          frequencyHz: [1, 2],
          probes: [{ name: "out", real: [1, 1], imag: [0, 0] }],
        },
      ],
    },
  };
  artifact("result.json", JSON.stringify(result));
  if (mode === "corrupt") write(join(dir, "result.json"), "{}");
  if (mode === "bad-measurements")
    artifact("native-measurements.json", "not json");
  if (mode !== "missing-plot")
    write(
      join(dir, "plot-0.svg"),
      mode === "zip-as-svg"
        ? "PK\u0003\u0004"
        : '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
  write(join(dir, "run.json"), JSON.stringify(run));
  return root;
}

describe("native acceptance CLI evidence boundary", () => {
  it.each([
    ["valid-subset", "all 19"],
    ["run-error", "evidence publication failed"],
    ["export-error", "Browser/export errors"],
    ["corrupt", "stale or corrupt result.json"],
    ["input-mismatch", "delivered Project must match"],
    ["bad-measurements", "JSON"],
    ["missing-plot", "ENOENT"],
    ["zip-as-svg", "Invalid SVG export"],
  ])("%s cannot produce a passing acceptance receipt", (mode, message) => {
    const root = fixture(mode);
    const run = spawnSync(
      process.execPath,
      ["scripts/analyze-native-simulation-examples.mjs", root],
      { encoding: "utf8", windowsHide: true, timeout: 15000 },
    );
    expect(run.error).toBeUndefined();
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(message);
    expect(() => readFileSync(join(root, "acceptance.json"))).toThrow();
  });
});
