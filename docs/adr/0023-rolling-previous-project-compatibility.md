# 0023 - Rolling previous Project compatibility

Status: `accepted`

Date: `2026-08-17`

Owners: `packages/model`, editor Project file and recovery boundaries

## Context

ADR 0022 established one schema-11 Project shape and rejected every other
version. That kept legacy shapes out of runtime, but also prevented a schema-10
user file from opening even though schema 11 only adds the RichText `fraction`
run and every valid schema-10 value remains valid after advancing its version.

The retired schema-1-to-8 registry accumulated sequential migration code,
tests, and historic Project assets. Restoring an unbounded chain would recreate
that maintenance and misuse risk. Keeping a Project in an old in-memory mode
would instead make every editor and renderer a multi-version consumer.

## Decision

The Project reader supports a rolling two-version window: the current Project
schema and exactly one explicitly named previous schema. Both produce the sole
current `CircuitProject` shape. Validation and serialization remain current
only; no compatibility-shaped Project enters the editor or is written back.

Schema 10 upgrades directly to schema 11 by changing only `schemaVersion`, then
validating the complete result against `CircuitProjectSchema`. User-authored
RichText is preserved exactly; slash text is not guessed or re-projected into a
fraction. Once loaded, the Project has all schema-11 capabilities, including
authoring and persisting new fraction runs.

The read boundary reports the source schema and whether migration occurred.
Opening a migrated formal file marks it as needing save and never silently
overwrites the user's source. App-owned browser recovery may store canonical
schema-11 text after successful migration, but must compare a stored envelope
against the source version encoded in its text before doing so.

When the current schema advances, the previous-version constant, direct
adapter, and focused tests must be replaced together. They are not appended to
an accumulating registry. Versions older than the rolling window and all future
versions remain unsupported. A future non-additive adapter may perform only
deterministic, semantics-preserving rewrites; ambiguous electrical data is
rejected rather than inferred.

## Alternatives considered

### Restore the sequential migration registry

- Benefits: users could skip arbitrarily many releases.
- Costs: retains every historic transformation and compatibility asset and
  expands the supported-state matrix indefinitely.
- Reason not selected: the product currently promises only previous-version
  compatibility and needs one current runtime contract.

### Continue rejecting schema 10

- Benefits: no reader change.
- Costs: rejects structurally compatible user data at the release boundary.
- Reason not selected: the schema-10-to-11 transformation is deterministic and
  lossless.

### Keep schema 10 live after open

- Benefits: avoids an immediate version rewrite.
- Costs: every edit, render, recovery, and export path must understand multiple
  Project shapes.
- Reason not selected: compatibility belongs at ingestion, not throughout the
  application.

## Consequences

### Positive

- Schema-10 Projects open without retaining a schema-10 model or fixture set.
- Migrated Projects immediately receive all schema-11 authoring capabilities.
- Formal files change only after an explicit save.
- The supported compatibility surface stays bounded and reviewable.

### Negative or limiting

- A user who skips more than one Project schema release cannot upgrade directly.
- Each schema release must deliberately replace and validate the direct adapter.
- General RichText fraction insertion remains a separate editor feature; this
  decision supplies the model capability but does not add that UI.

## Compatibility and migration

Canonical repository fixtures remain schema 11. Focused tests synthesize a
schema-10 input from a minimal current Project, prove content preservation and
the direct upgrade, then add a schema-11 fraction and prove save/reopen
stability. No historic Project asset is retained as a production input.

This decision supersedes only ADR 0022's clauses that reject every older
Project and prohibit a compatibility reader. ADR 0022's sole current
schema-11 in-memory Project shape and all unrelated Port, edit-union, and credential decisions
remain accepted.

## Validation

- focused model parsing, preservation, fraction round-trip, and rejection tests;
- staged file-open migration metadata and diagnostics tests;
- browser recovery envelope and canonical-storage migration tests;
- current documentation drift, type, and branch validation.

## Related documents

- [`0022-current-protocol-baseline.md`](0022-current-protocol-baseline.md)
- [`../specs/project-file-format.md`](../specs/project-file-format.md)
- [`../specs/persistence-and-recovery.md`](../specs/persistence-and-recovery.md)
