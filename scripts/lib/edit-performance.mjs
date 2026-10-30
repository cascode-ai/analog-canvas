import { performance } from "node:perf_hooks";

export const editSampling = { warmups: 7, samples: 15 };

export function selectEditReference(references, platform, arch, ci = false) {
  const key = `${platform}-${arch}${ci ? "-ci" : "-local"}`;
  // A Linux workstation may check against the CI ceiling, but never qualifies CI.
  const selected =
    references[key] ??
    (!ci && platform === "linux" ? references["linux-x64-ci"] : undefined);
  if (!selected || selected.environment.arch !== arch)
    throw new Error(
      `No editing performance reference for ${key}; use --calibrate-edits and review the resulting reference before checking`,
    );
  return { key: references[key] ? key : "linux-x64-ci", ...selected };
}

function delay(milliseconds) {
  const end = performance.now() + milliseconds;
  while (performance.now() < end) {
    /* Deliberate CPU delay for rejection evidence. */
  }
}

/** Each sample owns a fresh editor. Only run(), including an injected delay, is timed. */
export function sampleEditWorkload(createWorkload, budgetMs, options = {}) {
  const now = options.now ?? (() => performance.now());
  const slowdown = options.slowdown ?? 1;
  const wait = options.delay ?? delay;
  const samplesMs = [];
  for (
    let index = -editSampling.warmups;
    index < editSampling.samples;
    index += 1
  ) {
    const workload = createWorkload();
    const started = now();
    workload.run();
    if (slowdown > 1) wait((now() - started) * (slowdown - 1));
    const elapsed = now() - started;
    workload.verify();
    if (index >= 0) samplesMs.push(elapsed);
  }
  const medianMs = [...samplesMs].sort((a, b) => a - b)[
    Math.floor(samplesMs.length / 2)
  ];
  return {
    samplesMs,
    medianMs,
    budgetMs,
    passed: budgetMs === undefined ? null : medianMs <= budgetMs,
  };
}
