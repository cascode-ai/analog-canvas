import { performance } from "node:perf_hooks";

export const editSampling = { warmups: 7, samples: 15 };

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
