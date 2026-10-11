# Performance Budgets

Status: `accepted`

Primary owner: `scripts/performance-baseline.mjs`

## Representative workload

The release benchmark uses a deterministic generated Project with 500 placed
two-terminal instances and 499 logical nets. It measures canonical save,
formal SVG render, a complete Agent Snapshot, and one atomic Edit Engine
transaction. SPICE import is measured against the checked ngspice baseline
corpus. A second deterministic workload with 200 Nets, 200 Routes, 400
Junctions, and 200 route-bound Net Labels protects the document connectivity
index from accidental per-Net full-document rescans.

A loaded catalog with 10,000 additional unused definitions protects Project
overlay construction and placed-symbol resolution from library-size-dependent
validation on each edit. Catalog loading is measured separately from editing.
The 500-instance Project also exercises a prepared dry run followed by the
same real atomic commit. Dense copy correctness uses the generated fixture
with 400 instances, 1,300 Routes and 500 Junctions; optional production-browser
measurements cover copy-to-ghost and drop-to-next-ghost, with Undo per sample.

## CI-safe budgets

| Operation                                           |   Budget |
| --------------------------------------------------- | -------: |
| Generate and validate representative Project        | 2,000 ms |
| Canonical serialize                                 | 1,000 ms |
| Formal SVG render                                   | 2,000 ms |
| Complete Agent Snapshot                             | 1,000 ms |
| One-instance Edit Engine transaction                | 1,000 ms |
| Build multi-Net document connectivity index         | 1,000 ms |
| Formal SVG render of multi-Net workload             | 2,000 ms |
| Atomic filesystem save                              | 1,000 ms |
| ngspice baseline import                             | 2,000 ms |
| Project overlay over a loaded 10,000-symbol catalog | 1,000 ms |
| Commit a matching prepared 500-instance transaction | 1,000 ms |

These are release regression ceilings, not UI latency claims. The benchmark
records measured values and environment metadata. It performs warm-up and uses
whole-operation timings; unit tests assert structure, while the release script
enforces budgets.

## Editing contract

GUI, Agent and Project transactions retain one canonical executor and the
same persisted Project and Agent schemas. Preparation is an internal hint:
the engine may reuse only its own validated calculation when source content,
document identity/revision, edits, resolved symbol definitions, external
definitions and moved-pin inputs still match. A changed context or forged
hint executes normally; stale revision and history fences still reject.
Preview results and public transaction results remain detached mutable values.

The editor owns immutable validated snapshots. Read caches reuse equal facts
only on owned snapshots, and refresh when those facts change. Captured Project
definitions override the loaded catalog; caller-owned mutable catalogs are
validated again. Copy previews use the same canonical normalization in an
isolated geometry context, retaining target names, interfaces and MOS body
policy. Final placement still normalizes against all target conductors and
remains one Undo step across its existing insertion and contact phases.

For a representative medium circuit, record at least 30 warm production-browser
samples with viewport, browser version and machine context. The working target
for single-component copy and wire input-to-paint P95 is below 100 ms on the
same machine. Report measured results and remaining costs; this target is not
a portable CI threshold or a promise for every circuit size.

## Change policy

A budget increase requires a recorded reason and a representative fixture
review. A faster developer machine is not evidence for lowering a budget.
