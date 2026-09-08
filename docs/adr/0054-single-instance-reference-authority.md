# 0054 - Single Instance Reference authority

Status: `accepted`

Date: `2026-08-31`

Canvas authoring decision revised: `2026-09-08`.

Owners: `packages/model`, `packages/project-protocol`, `packages/devices`,
`packages/edit-engine`, `packages/netlist`, `packages/agent-adapter`,
`apps/editor`

## Context

An Instance previously could carry an internal object ID, a canvas
`schematicReference`, RichText `schematicName`, and an emitted
`netlist.reference`. Separate edit commands and clipboard allocation could move
those strings independently. The result was not merely a display choice: copy,
cross-Document composition, renumbering, Gallery insertion, Agent snapshots,
and export could disagree about which name identified the same Instance.

Object identity, Instance Reference, master identity, source evidence, and
visible notes are different facts. The error was giving one fact—the Instance
Reference—multiple persisted authorities.

## Decision

An ordinary referenced Instance has exactly one authored `Instance.reference`.
It is the Netlist Reference shown by a following `instance-reference` annotation and the token
emitted for an Instance that has netlist facts. The Reference is unique within
one Document under case folding and follows the device or hierarchy prefix
policy. `Instance.id` remains stable object identity and never participates in
Reference allocation or visible fallback.

`Instance.netlist` contains only target binding and raw parameters. Master
identity remains typed in that binding: model name, child Document ID,
external-definition ID, or unresolved source name. `Instance.importProvenance`
is read-only source evidence. Neither is an alternative Reference.

The remaining visible text categories are explicit:

- `instance-reference` is a live projection of `Instance.reference` and may
  carry same-text RichText formatting;
- `instance-value`, `net-name`, and `cell-terminal-name` project their own
  typed authorities;
- an attached literal Annotation is ordinary visible text and has no naming or
  export authority.

Cell Pins and power markers have no fabricated Instance Reference. A Cell Pin
projects `CellTerminal.name`; power presentation projects its owned Net name.

Reference creation, explicit Properties Netlist Reference editing, Agent renaming,
renumbering, clipboard cloning, cross-Document composition, and SPICE import
all write the same field. Object-ID allocation is independent. A multi-field
target transition that changes both binding class and required Reference
prefix is one atomic edit plan.

The canvas edits presentation, not electrical identity. An ordinary device has
one visual `instance-label` Annotation, initially bound to its Netlist Reference.
Changing its characters or inserting a formula replaces the binding with literal
RichText `content` on that same object. No hidden default plus optional Label is
created, and no formula/reference-equivalence prompt is needed. Formatting-only
edits may retain the binding through a same-text `formatOverride`. An explicit
**Use netlist name** action restores following and default content styling;
typing the same name into a custom annotation never implicitly rebinds it.
Anchor, visibility, alignment, color, and scale survive these state changes.

This replaces the earlier canvas-rename and optional-Label interaction, not the
single electrical authority. `Instance.reference` remains unchanged as a public
protocol field; no `visualName` field, new edit kind, or schema version is added.
The existing Annotation `binding`/`content` exclusive choice expresses both
states. Existing additional literal annotations are retained as authored text,
not deleted or reconciled by spelling. New authoring never creates such a pair.

Schema 35 removes `schematicReference`, `schematicName`, and
`netlist.reference`. The 34→35 adapter prefers the former emitted Reference for
an emitting Instance, otherwise the former schematic Reference. A distinct
RichText schematic name becomes an object-attached literal Annotation; an
ordinary default label becomes `instance-reference`. Marker references are
removed. Old fields and binding kinds are accepted only by this adapter.

Schema 34 validated emitted and canvas references in separate uniqueness
domains. When that allowed a schematic-only Reference to collide with an
emitted Reference, migration preserves the emitted token and deterministically
suffixes the schematic-only token before strict Schema 35 validation. Imported
master spelling is retained only as `importProvenance.sourceMasterName`: source
evidence with no display, identity, hierarchy, or emission authority.

Placement lifecycle remains orthogonal:

```text
Instance exists + placement: null       = retained in the Placement Tray
Instance exists + placement: Placement  = placed on the canvas
Instance absent                         = deleted
```

Moving between retained and placed states never changes Reference, binding,
parameters, connectivity, or attached annotations.

## Consequences

- A Netlist Reference rename updates export and following annotations; custom
  visual annotations remain unchanged. Copy allocates a new Netlist Reference,
  rewrites following projections, and preserves custom text/formula content.
- Copy and composition need one collision policy, not reconciliation between
  canvas and netlist names.
- Agent Snapshot exposes `id`, `reference`, and `masterName` explicitly; it no
  longer publishes an ambiguous generic Instance `name`.
- RichText and arbitrary attached labels remain available without becoming a
  hidden Instance identity protocol.
- Object IDs may still be human-shaped in existing files, but no consumer may
  infer Reference semantics from them.
- Schema 36 closes the Gallery composition gap: a mapped Reference Annotation
  owns independent RichText presentation, while Reference allocation and
  rename rewrite its same-text projection atomically and preserve styling.

## Validation

- Schema and migration tests prove old authorities cannot survive schema 35.
- allocation and Edit Engine tests cover ID/Reference separation and atomic
  binding-prefix transitions;
- clipboard tests cover cloning and cross-Document composition;
- SPICE, netlist, Agent, renderer, and editor tests consume the single field.

## Related documents

- [`0027-stage-1-netlist-authoring-protocol.md`](0027-stage-1-netlist-authoring-protocol.md)
- [`0025-schematic-hierarchy-and-formal-ports.md`](0025-schematic-hierarchy-and-formal-ports.md)
- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`../specs/editor-interaction.md`](../specs/editor-interaction.md)
- [`../specs/project-file-format.md`](../specs/project-file-format.md)
