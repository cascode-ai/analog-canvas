# 0021 - Presentation and Coordinate Domains

Status: `accepted`

Owners: `packages/model`, `packages/derived`, `packages/render-svg`, `apps/editor`

## Decision

Separate grid-valid authored coordinates from precise derived and screen
geometry. [Schematic model](../specs/schematic-model.md#coordinate-domains)
owns persistence; [editor interaction](../specs/editor-interaction.md) owns
camera and gestures; [visual language](../specs/visual-language.md) owns style
composition and formal/overlay separation.

## Context

Text layout, rotated artwork and pointer positions legitimately contain
fractions. Their structural resemblance to a persisted Point or camera rectangle
does not make their numerical contracts interchangeable.

## Rationale

Explicit conversions preserve rendering precision without allowing measured
bounds to corrupt grid-valid state. Outward camera fitting includes the whole
drawing; silent point rounding during load would instead change authored intent.
Exact artwork contact and persistable grid landing serve different purposes,
so a render-only connection lead is preferable to distorting either one.

Store bounded style intent over the reviewed profile, not resolved token copies
on every object. Shared composition keeps canvas and formal output consistent
while allowing deliberate per-object presentation overrides. Overlays remain
outside formal output so interaction affordances do not become circuit content.
