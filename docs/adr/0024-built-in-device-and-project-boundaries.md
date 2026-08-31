# ADR 0024: Built-in device and Project boundaries

Status: `accepted`

Date: `2026-08-18`

Owners: `packages/model`, `packages/symbols`, `packages/project-protocol`,
`packages/edit-engine`

## Context

Built-in devices need stable electrical meaning while their artwork and editor
presentation continue to evolve. Saved Projects likewise need a durable file
boundary without forcing every runtime package to understand historical shapes.

## Decision

The model owns the current electrical device protocol: device kind, terminals,
parameters, bindings, and validation. The symbol catalog owns visual geometry,
pins, variants, and style presentation. A symbol may hide a terminal visually,
but cannot delete or rewire its electrical terminal.

`CircuitProject` is the one persisted root and the runtime consumes only its
current schema. Historical Project shapes are accepted only at the file
boundary by the explicit upgrade chain defined in ADR 0053. Serialization emits
only the current schema; authoring transactions never mutate a legacy shape.

A Project-schema change therefore requires a strict current schema, a
deterministic compatibility step when the supported floor includes the prior
version, and tests that demonstrate semantic preservation or deliberate
rejection. Visual catalog changes do not require a Project migration unless a
persisted electrical or authoring fact changes.

## Consequences

- Electrical semantics cannot drift when a symbol is refined or replaced.
- Runtime code has one Project shape and no scattered legacy branches.
- File durability is governed by a visible, contiguous compatibility chain.
- New device families extend the shared protocol rather than introducing
  device-specific persistence formats.

## Related documents

- [`0053-chain-carried-project-compatibility.md`](0053-chain-carried-project-compatibility.md)
- [`../specs/project-file-format.md`](../specs/project-file-format.md)
- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`../specs/symbol-dsl.md`](../specs/symbol-dsl.md)
