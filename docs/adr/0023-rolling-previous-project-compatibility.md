# 0023 - Rolling previous Project compatibility

Status: `accepted`

Date: `2026-08-17`

Owners: `packages/model`, `packages/project-protocol`, editor persistence

## Context

Keeping every historical Project shape readable would retain an unbounded
migration registry and make compatibility a permanent runtime concern. Reading
only the current shape would make each additive schema release strand files
from the immediately preceding release.

## Decision

The Project file boundary supports exactly the current schema and one explicitly
named previous schema. Both produce the sole current `CircuitProject` shape.
`@icm/model` validates only that current shape; canonical serialization and
Cloud storage write only the current schema.

Each release replaces the one direct previous-to-current transform and its
focused tests. Transforms must be deterministic and semantics-preserving;
ambiguous electrical data is rejected rather than inferred. Older and future
versions are unsupported.

The read result reports its source version and whether migration occurred.
Opening a migrated user file marks the working copy as needing save and never
overwrites the source implicitly. Browser recovery and Cloud/Gallery ingestion
use the same bounded protocol boundary rather than maintaining private
migration chains.

## Consequences

- Runtime packages consume one Project shape.
- A user can cross one schema release without carrying all historical adapters.
- Every schema advancement deliberately replaces, rather than appends to, the
  compatibility surface.
- Skipping more than one schema release requires an external conversion.

## Validation

- Protocol tests exercise the named previous version, current serialization,
  migrated-file metadata, and older/future rejection.
- Recovery, Cloud Save, Gallery, and staged file-open tests use the shared
  parser.

## Related documents

- [`../specs/project-file-format.md`](../specs/project-file-format.md)
- [`../specs/persistence-and-recovery.md`](../specs/persistence-and-recovery.md)
