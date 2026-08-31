# ADR 0038: Document style overrides

Status: `accepted`

Date: `2026-08-21`

Owners: `packages/model`, `packages/derived`, `packages/edit-engine`,
`packages/render-svg`, `apps/editor`

## Context

Reviewed style profiles must remain the visual baseline, while a Document may
need bounded, uniform changes to typography, Wire, symbol, annotation, and
Junction scale. Duplicating resolved token values into every object would make
the base profile cease to be authoritative.

## Decision

`Document.presentation.styleOverrides` stores only bounded scale intent:
`fontScale`, `wireStrokeScale`, `symbolStrokeScale`,
`annotationStrokeScale`, and `junctionRadiusScale`. Each scale is independent
and constrained to `0.5–2`; absence means exactly `1`.

`resolveDocumentStyleProfile` is the single composition point. Renderer,
derived geometry, export, and editor consumers use its result. Profile tokens
remain the sole source of base values, while object-level text or drafting
overrides compose afterward for their documented scope.

The common presentation-style edit replaces or clears the override object
transactionally and is shared by GUI and Agent entry points. Invalid values are
rejected rather than clamped. A Document without overrides must resolve and
render identically to its selected base profile.

## Consequences

- Whole-Document restyling does not rewrite symbols or annotations.
- The reviewed default remains deterministic and pixel-comparable.
- All output paths apply the same bounded scale semantics.

## Related documents

- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`../specs/visual-language.md`](../specs/visual-language.md)
- [`../specs/export.md`](../specs/export.md)
