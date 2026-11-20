import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const baseline = "76408337cbb89c78f6b55349c1141465717018b3";
export const sampleCount = { open: 5, interaction: 30, edit: 9 };
const arrays = ["flat-128", "flat-512", "flat-2048", "hier-2048"];
export const matrix = {
  open: {
    cases: arrays,
    counts: {
      open: sampleCount.open,
      openToSelectedInstance: sampleCount.open,
    },
  },
  ...Object.fromEntries(
    [
      "fitPan",
      "fitZoomIn",
      "fitFromDetail",
      "detailPan",
      "detailZoom",
      "detailPick",
      "frameGap",
    ].map((action) => [
      action,
      {
        family: "view",
        cases: arrays,
        counts: { [action]: sampleCount.interaction },
      },
    ]),
  ),
  move: {
    family: "edit",
    cases: arrays.slice(0, 3),
    counts: { move: sampleCount.edit, undoMove: sampleCount.edit },
  },
  delete: {
    family: "edit",
    cases: arrays.slice(0, 3),
    counts: { delete: sampleCount.edit, undoDelete: sampleCount.edit },
  },
  hierarchy: {
    cases: ["hier-2048"],
    counts: {
      descend: sampleCount.interaction,
      ascend: sampleCount.interaction,
    },
  },
  trace: {
    cases: ["high-fanout"],
    counts: { firstVdd: sampleCount.interaction },
  },
  model: {
    cases: arrays,
    counts: { parse: sampleCount.edit, moveTransaction: sampleCount.edit },
  },
  exports: { family: "contracts", cases: ["five-transistor-ota"], counts: {} },
  agent: {
    family: "contracts",
    cases: ["high-fanout"],
    counts: {
      fullTraceModel: sampleCount.edit,
      fullTraceAgent: sampleCount.edit,
    },
  },
};

const inputNames = [
  ...new Set(Object.values(matrix).flatMap((entry) => entry.cases)),
];
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

export function summarize(samples, minimum) {
  assert.ok(
    samples.length >= minimum,
    "Missing samples: " + samples.length + " of " + minimum,
  );
  assert.ok(
    samples.every((n) => Number.isFinite(n) && n > 0),
    "Expected positive finite durations",
  );
  const sorted = samples.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    n: sorted.length,
    p50Ms:
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    ...(sorted.length >= sampleCount.interaction && {
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    }),
    maxMs: sorted.at(-1),
    samples,
  };
}

export function assembleReport(directory) {
  const results = {};
  let commit, build, harness, inputs, environment;
  for (const [group, { cases, counts }] of Object.entries(matrix)) {
    for (const name of cases) {
      const key = group + "-" + name;
      const result = readJson(join(directory, key + ".json"));
      assert.ok(
        result.complete && result.group === group && result.name === name,
        "Incomplete " + key,
      );
      assert.match(result.commit, /^[0-9a-f]{40}$/);
      commit ??= result.commit;
      build ??= result.build;
      assert.match(result.harness, /^[0-9a-f]{64}$/);
      harness ??= result.harness;
      assert.equal(result.harness, harness, "Mixed sampling code in " + key);
      assert.equal(result.build, build, "Mixed production bundles in " + key);
      inputs ??= result.inputs;
      environment ??= result.environment;
      assert.equal(result.commit, commit, "Mixed product revisions in " + key);
      assert.deepEqual(
        result.inputs,
        inputs,
        "Mixed portable inputs in " + key,
      );
      assert.deepEqual(
        result.environment,
        environment,
        "Mixed browser or machine environment in " + key,
      );
      for (const [metric, n] of Object.entries(counts)) {
        assert.deepEqual(
          result.metrics[metric],
          summarize(result.metrics[metric]?.samples ?? [], n),
          key + " " + metric,
        );
      }
      if (matrix[group].family === "contracts" || group === "model") {
        assert.ok(
          Object.keys(result.signatures ?? {}).length > 0,
          "Missing semantic results for " + key,
        );
      }
      results[key] = result;
    }
  }
  for (const name of inputNames) assert.match(inputs[name], /^[0-9a-f]{64}$/);
  return { commit, build, harness, inputs, environment, results };
}

export function compareReports(reference, candidate) {
  assert.equal(
    reference.commit,
    baseline,
    "Comparison requires the fixed baseline",
  );
  assert.deepEqual(
    reference.inputs,
    candidate.inputs,
    "Baseline and candidate must use the same input bytes",
  );
  assert.deepEqual(
    reference.environment,
    candidate.environment,
    "Browser, machine, and viewport must match",
  );
  assert.equal(
    reference.harness,
    candidate.harness,
    "Baseline and candidate must use identical sampling code",
  );
  const ratios = {};
  for (const [key, result] of Object.entries(candidate.results)) {
    const original = reference.results[key];
    assert.deepEqual(
      result.signatures,
      original.signatures,
      "Semantic output differs in " + key,
    );
    assert.deepEqual(
      result.workload,
      original.workload,
      "Changed camera or physical target in " + key,
    );
    ratios[key] = {};
    for (const [metric, summary] of Object.entries(result.metrics)) {
      const previous = original.metrics[metric];
      const control = ["flat-128", "flat-512", "hier-2048"].includes(
        result.name,
      );
      const limit = Math.max(previous.p50Ms * 1.15, previous.p50Ms + 8);
      ratios[key][metric] = {
        median: {
          baselineMs: previous.p50Ms,
          candidateMs: summary.p50Ms,
          ratio: summary.p50Ms / previous.p50Ms,
        },
        ...(summary.p95Ms !== undefined && {
          p95: {
            baselineMs: previous.p95Ms,
            candidateMs: summary.p95Ms,
            ratio: summary.p95Ms / previous.p95Ms,
          },
        }),
        ...(control && {
          controlMedianCeilingMs: limit,
          controlPass: summary.p50Ms <= limit,
        }),
      };
    }
  }
  return ratios;
}
