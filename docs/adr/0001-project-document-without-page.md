# 0001 - Persist Project and Document Without a Page Layer

Status: `accepted`

Owners: `packages/model`, `packages/edit-engine`

## Decision

Persist Documents directly inside a Project, as defined by the
[Project format](../specs/project-file-format.md) and
[schematic model](../specs/schematic-model.md).
Viewport and rendered scenes remain derived or session-local.

## Context

Each Cell has one unbounded schematic canvas. A Page identity would add query
scope, storage and Agent nesting without representing an additional user concept.

## Rationale

Keeping the hierarchy shallow lets electrical and presentation edits share one
Document revision. Treating SVG as the model would instead make connectivity
depend on a renderer. The accepted cost is that genuine multi-page authoring
would need an explicit model change; export page bounds alone do not require it.
