# Performance Budgets

Status: `accepted`

Primary owner: `scripts/performance-baseline.mjs`

## Workloads and budgets

The release benchmark's deterministic workloads and per-operation ceilings
live in the script's `budgets` and `config/performance-edit-baseline.json`.
It must keep covering: a 500-instance Project (canonical save, formal SVG, complete Agent Snapshot, one
atomic transaction, a prepared dry run then the same real commit); the
ngspice baseline import corpus; 200 Nets / 200 Routes / 400 Junctions / 200
route-bound labels (guards against per-Net full-document rescans); and a
catalog with 10,000 extra unused definitions (guards against
library-size-dependent validation per edit; catalog loading measured
separately). Budgets are release regression ceilings over warmed,
whole-operation timings, not UI latency claims; unit tests assert structure,
the script enforces budgets.

Rotate, Undo, twelve-instance paste and wire commit each have an independent
CI-calibrated ceiling on that Project. Repeated fresh-editor samples measure
planning, commit and history, excluding setup and result verification. Their
median must pass normally and fail with an injected 2× operation cost. Normal
and injected checks run in separate processes through the release CLI, with
matching setup and prewarm counts; a crash is not slowdown-rejection evidence.
Calibration records evidence without qualifying a release; changing the
reference requires both normal and slowdown checks on the CI runner.
The fixed Windows workstation reference provides a separate local ceiling;
it does not qualify CI or promise the same sensitivity on other hardware.
References are selected by platform, architecture, CI/local mode and CPU model;
uncalibrated environments fail with a request for calibration evidence.

Raising a budget needs a recorded reason and a representative fixture
review; a faster machine is no reason to lower one. The same policy covers
`scripts/editor-bundle-budget.mjs`.

## Editing contract

- GUI, Agent and Project transactions keep one canonical executor and the
  same persisted Project and Agent schemas.
- Preparation is an internal hint: the engine reuses only its own validated
  calculation while source content, document identity/revision, edits,
  resolved symbols, external definitions and moved-pin inputs still match. A
  changed context or forged hint executes normally; stale revision and history
  fences still reject. Preview and transaction results stay detached mutable
  values.
- Read caches reuse facts only on editor-owned immutable snapshots and refresh
  when they change. Captured Project definitions override the loaded catalog;
  caller-owned mutable catalogs are revalidated.
- Copy previews use the same canonical normalization in an isolated geometry
  context (target names, interfaces, MOS body policy). Final placement
  normalizes against all target conductors and stays one Undo step.

Browser target (not a CI threshold): single-component copy and wire
input-to-paint P95 below 100 ms over ≥ 30 warm production-browser samples on
a representative medium circuit, with viewport, browser and machine recorded.
