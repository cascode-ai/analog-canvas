# 0045 - Cell Pin copies own their interface identity

Status: `partially superseded`

The fresh copy identity and independent lifecycle remain accepted. Unique copy
suffixes and explicit name-based terminal merge behavior are superseded by
[ADR 0046](0046-independent-cell-pins-and-formal-port-projection.md).

Date: `2026-08-26`

Owners: `apps/editor`, `packages/edit-engine`, `packages/model`

## Context

One formal Cell terminal may intentionally own several visual markers. The
clipboard previously treated every copied Cell Pin as another such marker,
which made the source and copy share their terminal name, direction, Net, and
caller pin. A copy operation is expected to create a separately editable Pin;
sharing those properties made ordinary duplication behave like an implicit
interface-merge command.

## Decision

Clipboard duplication creates a new formal terminal for each copied terminal
group. The copy receives a fresh terminal ID, its own marker IDs, and the
source direction as an initial value. Its name is preserved when free in the
target Document; otherwise a case-insensitively unique `_copy`, `_copy2`, …
suffix is allocated. A Base Net wholly owned by the copied selection is cloned.

The ordinary clipboard boundary rule remains unchanged: when a copied Pin's
Net also contains unselected objects, the copied Pin remains electrically
attached to that existing Net while retaining independent formal-terminal
identity.

Explicitly placing an already-used Cell Pin name may still add another marker
to that existing terminal. Explicitly renaming one terminal onto another may
still invoke the existing merge behavior. Those deliberate operations remain
the way to request shared terminal identity.

This supersedes only the clipboard-copy clauses of
[ADR 0037](0037-repeated-formal-port-markers.md) and
[ADR 0043](0043-cell-pin-contract-convergence.md).

## Consequences

- Renaming, changing direction, or deleting a copied Pin does not mutate its
  source Pin.
- In-place copies appear as distinct `.subckt` terminals with readable unique
  names.
- The repeated-marker model and Project schema remain unchanged.

## Compatibility and migration

No Project schema or persisted object changes. Existing repeated-marker
Projects retain their current meaning; the decision changes only future
clipboard proposals.

## Validation

- Clipboard unit coverage proves fresh terminal identity, unique naming,
  independent Base Net ownership, annotation rebinding, and independent rename.
- Browser coverage proves copied-Pin properties, deletion, and netlist export.

## Related documents

- [Schematic hierarchy](../user/schematic-hierarchy.md)
- [Schematic model](../specs/schematic-model.md)
- [Editor interaction](../specs/editor-interaction.md)
