# ADR 0053: Chain-carried Project compatibility

Status: accepted

Date: 2026-08-31

Owners: `packages/model`, `packages/project-protocol`, editor persistence,
Worker Gallery/Cloud ingestion

## Context

ADR 0023 bounded the Project file boundary to exactly two schemas: the
current shape and one explicitly named previous shape, each release replacing
the single previous-to-current transform. That kept the runtime surface small,
but it tied a saved file's lifetime to the schema's release cadence. While the
schema advanced one version at a time over weeks, crossing releases one save
apart was easy; when the cadence became eleven versions in nine days, the
window expired real users' files while their authors were away (issue #446: a
Project saved days earlier refused to open, reading as lost work).

The failure was structural, not procedural. Any fixed-width version window
converts schema velocity into user-facing file loss, and schema velocity is a
property of development tempo that the persistence contract must not pass
through to users. A saved `.icproj.json` is the canonical Project (ADR 0001,
`docs/specs/project-file-format.md`); the boundary owes it durability.

## Decision

A Project loads if the upgrade chain can carry it to the current schema.

- `OLDEST_SUPPORTED_PROJECT_SCHEMA_VERSION` (currently 24) is the floor.
  `packages/project-protocol` keeps one deterministic, semantics-preserving
  adapter per step from the floor to the current schema, applied in sequence;
  a file at any version in that range loads through the chain. Versions below
  the floor, above the current schema, or missing a chain step are refused
  with a version diagnostic.
- Each adapter keeps ADR 0023's transform discipline: deterministic,
  semantics-preserving, and rejecting ambiguous electrical data at its exact
  path rather than inferring a meaning (the schema 32→33 ownerless-equivalence
  rejection is the model). A refusal names the offending path and the
  authoring alternatives; it never silently drops or rewrites content.
- Serialization, Cloud storage, and Gallery ingestion still write only the
  current schema. The read result reports its source version and whether
  migration occurred; opening a migrated file marks the working copy as
  needing save and never overwrites the source implicitly. Browser recovery,
  Cloud, and Gallery maintenance use this same boundary — Gallery maintenance
  lifts stored entries step by step through the identical adapters.

## Floor policy

The floor exists to bound the chain's length and maintenance surface — it is
not a mechanism for expiring users' files. Raising it is a contract change
that requires its own ADR, and the ADR must establish, with evidence, that
files at the retired versions can no longer exist in the wild — for example,
the versions never left single-machine development, or every known store
(Gallery, Cloud, recovery corpora) has been verified clear and a conversion
path was published and left available for a substantial period. "The schema
has moved on", release cadence, and chain length by themselves are never
sufficient reasons. When in doubt, the floor stays where it is; adapters are
small and their tests are focused, so the cost of keeping a step is low and
the cost of a refused file is a user believing their work is lost.

## Consequences

- Runtime packages still consume exactly one Project shape; the chain is a
  file-boundary concern only.
- A schema release appends one adapter instead of replacing the only one;
  the chain stays contiguous from the floor.
- Users' files survive any number of schema releases without external
  conversion, at the cost of a growing (bounded, floor-limited) adapter list.
- ADR 0023 is superseded by this decision. Its bounded-window rule produced
  the #446 refusals; its per-step transform discipline is retained above.
