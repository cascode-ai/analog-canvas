# Simulation: Open Decisions and Remaining Capabilities

Status: proposed

Owners: simulation integration and release owners.

Source authoring, independent Code workspace, Specs/raw handoff, browser result
archives and cross-Project Cell reuse are implemented. Their contracts live in
[simulation](../specs/simulation.md), [execution](../specs/simulation-execution.md)
and [results](../specs/simulation-results.md). This roadmap contains remaining
capabilities and decisions, not a cutover plan for those existing features.

## Legacy experiment conversion

The explicit helper converts simple version-1 sidecars; advanced bindings,
managed plans, named outputs, device selections, measurements and corners can
still prevent conversion. Decide whether broader translation is worth adding.
Until then, preserve the supported reader and return located conversion limits.

Any extension must demonstrate equivalent effective circuit/conditions and
capture for each supported case, retain source identity and broken references,
and refuse ambiguous translation without changing the saved input. It cannot
silently remove advanced intent or add a second current writer.

## Repeated Noise provenance

One density/integrated pair has qualified numeric handling. Multiple or reordered
Noise invocations without unambiguous provenance retain raw records and a pairing
limitation. General control-loop-to-Noise grouping remains unimplemented.

An extension needs capture-backed record association, repeated/reordered cases
and numerical tolerances. Matching by title or guessing from order alone is not
sufficient evidence. Other supported records must remain usable.

## Recurring candidate acceptance

The [Production delivery workflow](../deployment.md) owns the release route and
live dual-engine smoke checks. GUI, public MCP and cross-Project acceptance
require their own recorded evidence; do not infer that they ran from a successful
deployment or the existence of a test script.

For affected releases, inspect the candidate's actual receipts for source and mapped edits,
error/repair, authorized Cell closure import, execution, Specs/raw/CSV retrieval,
Batch, save/reload and access boundaries. Missing required evidence, a failed
declared acceptance criterion or an unsupported advertised capability remains
a release issue. Cross-engine numerical equivalence is not a native VACASK
release criterion; its [qualification boundary](vacask-migration.md) applies.
Do not treat this document as evidence that an arbitrary SHA passed.

Use existing qualified fixtures and the declared models, corner, analyses and
tolerances. Broader lifecycle and security checks remain in the
[test contract matrix](../testing/contract-matrix.md) and execution contract.

## Deferred extensions

- Live cross-Project synchronization/version following and broader authorized
  Project management must wrap existing services; imported Cell closures remain
  independent local copies.
- Cloud-persistent result archives are distinct from the implemented browser
  archives and bounded server retention.
- Monte Carlo, optimization, automatic circuit modification, a simulator beyond
  ngspice and VACASK, uploaded Verilog-A compilation and general model
  marketplaces require their own product decisions and qualification. VACASK's hosted Profile qualification is
  tracked in [VACASK migration](vacask-migration.md).
- Arbitrary lossless two-way raw-SPICE/Canvas topology synchronization is not a
  promised capability.

Resolve or explicitly defer these items with evidence in the owning commit/PR.
Retiring implementation history does not close an unresolved capability.
