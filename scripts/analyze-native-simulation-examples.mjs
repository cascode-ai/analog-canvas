import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import {
  analyzeNativeExampleRuns,
  validateNativeExampleResult,
} from "./lib/native-example-acceptance.mjs";
import { prepareSourceExecutionInput } from "../packages/simulation-service/dist/index.js";

const root = resolve(process.argv[2] ?? "output/native-simulation-examples");
const read = async (path) => JSON.parse(await readFile(path, "utf8"));
const manifest = await read(join(root, "manifest.json"));
const runs = new Map();
for (const project of manifest.projects) {
  const currentProject = parseProject(await readFile(project.file, "utf8"));
  const receipt = await read(
    join(root, "results", project.slug, "receipt.json"),
  );
  assert.equal(receipt.status, "passed", `${project.slug}: incomplete MCP run`);
  assert(
    !receipt.browserErrors?.length && !receipt.exportWarnings?.length,
    "Browser/export errors invalidate live acceptance",
  );
  assert.deepEqual(
    receipt.runs.map((r) => r.folderId).sort(),
    project.folders.map((f) => f.id).sort(),
    "Receipt must cover each experiment exactly once",
  );
  for (const folder of project.folders) {
    const dir = join(root, "results", project.slug, folder.id);
    const runReceipt = await read(join(dir, "run.json"));
    assert.equal(
      receipt.runs.find((r) => r.folderId === folder.id)?.runId,
      runReceipt.id,
      `${folder.id}: result must belong to this batch`,
    );
    assert(runReceipt.artifacts.some((a) => a.name === "result.json"));
    assert.equal(runReceipt.state, "finished", `${folder.id}: run unfinished`);
    assert(!runReceipt.error, `${folder.id}: evidence publication failed`);
    assert.equal(
      new Set(runReceipt.artifacts.map((a) => a.name)).size,
      runReceipt.artifacts.length,
      "Duplicate artifact paths",
    );
    for (const artifact of runReceipt.artifacts) {
      assert(
        artifact.name
          .split("/")
          .every((p) => p && p !== "." && p !== ".." && !/[\\:]/u.test(p)),
        "Unsafe artifact path",
      );
      const bytes = await readFile(join(dir, artifact.name));
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        artifact.sha256,
        `${folder.id}: stale or corrupt ${artifact.name}`,
      );
    }
    assert(
      receipt.capabilities,
      "Receipt must retain the capabilities used by Prepare",
    );
    const prepared = await prepareSourceExecutionInput(
      currentProject,
      currentProject.simulationFolders.find((f) => f.id === folder.id),
      receipt.capabilities,
    );
    assert(prepared.ok, JSON.stringify(prepared));
    for (const file of prepared.input.files)
      assert.equal(
        await readFile(join(dir, "executed", file.path), "utf8"),
        file.text,
        `${folder.id}/${file.path}: delivered Project must match the simulated electrical input`,
      );
    const result = await read(join(dir, "result.json"));
    assert.equal(result.outcome.status, "completed", folder.id);
    const analyses = result.data?.analyses ?? [];
    assert(analyses.length > 0, `${folder.id}: no captured results`);
    // Current runs record native metrics once in Specs. Historical evidence
    // bundles may still carry the pre-Spec measurement artifact.
    const specs = await read(join(dir, "specs.json")).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const measurements = specs
      ? specs.results.map((spec) => ({
          ...spec,
          status: Number.isFinite(spec.value) ? "available" : "unavailable",
        }))
      : await read(join(dir, "native-measurements.json")).catch((error) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
    assert(
      measurements.every((m) => m.status === "available"),
      `${folder.id}: failed native measurement`,
    );
    // Exports are evidence, never repaired or silently skipped by the analyzer.
    for (let i = 0; i < analyses.length; i++) {
      if (analyses[i].analysis === "op") continue;
      const svg = await readFile(join(dir, `plot-${i}.svg`)).catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      if (svg)
        assert(svg.toString("utf8").includes("<svg"), "Invalid SVG export");
      else {
        const zip = await readFile(join(dir, `plot-${i}.zip`));
        assert.equal(
          zip.subarray(0, 4).toString("hex"),
          "504b0304",
          "Missing/invalid grouped plot export",
        );
      }
    }
    runs.set(folder.id, {
      project: project.slug,
      name: folder.name,
      result,
      analyses,
      measurements,
    });
  }
}
const summary = analyzeNativeExampleRuns(runs);
await writeFile(
  join(root, "acceptance.json"),
  JSON.stringify(summary, null, 2) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify(summary, null, 2));
assert.equal(
  summary.status,
  "passed",
  "Electrical sanity checks failed; inspect acceptance.json. This is not model qualification.",
);
