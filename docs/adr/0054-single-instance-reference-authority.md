# 0054 - Single Instance Reference Authority

Status: `accepted`

Owners: `packages/model`, `packages/edit-engine`, `packages/netlist`, `apps/editor`

## Decision

Keep one authored electrical Instance Reference, with following or custom
canvas annotations as defined in the
[schematic model](../specs/schematic-model.md#presentation-authority).
The [editor interaction contract](../specs/editor-interaction.md) owns the
editing and reset gestures; [Project compatibility](../specs/project-file-format.md)
owns older-file conversion.

## Context

Object identity, emitted reference, master identity, source provenance and
visible text are different facts. Independent canvas and netlist references
make copy, renumbering, composition, Agent snapshots and export disagree about
the same device.

## Rationale

One electrical reference gives all consumers one collision and rename policy.
Presentation remains independently useful: a formula or custom label should
not rename an electrical device. Following and literal states on the same
Annotation express that distinction without another naming field or hidden
default-label object.

Explicit reset restores following; matching spelling alone does not express
that intent. Object IDs and import provenance likewise cannot become fallback
electrical or visual names.
