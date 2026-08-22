---
status: completed
experience: none
---

# Any-angle Route authoring

## Goal

Stop rejecting a Route for its heading. Wire authoring gains a free-angle mode
so a segment may land at whatever angle reaches its endpoint, and the
transaction layer validates only that a segment is non-degenerate.

## Owner decision

The owner asked for arbitrary-angle wires and stated that the octilinear check
should not exist. ADR 0028 anticipated exactly this: it records that the
derived geometry kernel "is generic enough for a future explicitly approved
arbitrary-angle policy" and lists "arbitrary-angle authoring is intentionally
not exposed yet" as its one limiting consequence. This target is that
approval, so it ships with ADR 0039 rather than changing behavior silently.

## Why the blast radius is small

`segment-geometry.ts` states that it "deliberately does not encode an
authoring policy", already exposes `any-angle`, and builds projection,
containment, intersection, collinearity, and unit direction on cross products
and `hypot`. Crossing detection, hit testing, label placement, and rendering
were therefore already angle-agnostic; only the edit engine's authoring gates
assumed octilinear.

## Work

1. `validateRoute` checks `any-angle`, so only zero-length segments fail.
2. Segment drag and endpoint move reject only degenerate geometry. The tidying
   elbow an endpoint move inserts stays limited to legs that were already
   octilinear, so a diagonal is stretched rather than given a corner.
3. `WireRoutingMode` gains `free`, compiling an authored click to the straight
   line that reaches it, and it ends the middle-click corner cycle.
4. Record ADR 0039, mark ADR 0028's authoring clause superseded, and update
   the edit-engine, editor-interaction, and agent-api specs plus the ADR index.

Unchanged by design: `power-rail` stays one straight axis-aligned run, and
`@icm/agent-routing` keeps the stricter octilinear contract ADR 0008 gives that
Agent-side helper.

## Validation

- Full unit suite (1189 passed), full Playwright suite (209 passed)
- New Playwright case draws a leg that is neither axis-aligned nor 45 degrees
- `node scripts/visual-golden.mjs --check` and `check-markdown-links.mjs` clean
- `tsc -p tsconfig.check.json`, Prettier, `git diff --check`

## Gate Review

- Decision: full
- Early gates: typecheck, Prettier, markdown links
- Affected gates: edit-engine routing and wire-path tests, the manual-editor
  Playwright spec
- Final gates: golden check, remote GitHub Actions
- Platform risks: this changes an accepted ADR's contract and the normative
  specs, so the documentation gates matter as much as the behavior tests.

## Test Impact

- Decision: tests-updated
- Contracts: legal persisted Route geometry and the wire authoring modes.
- Primary checks: `packages/edit-engine/src/{routing,wire-path}.test.ts`,
  `apps/editor/e2e/manual-editor.spec.ts`

One routing case asserted that a diagonal Route is rejected. That is the
contract this target changes, so it now asserts acceptance while keeping the
context-required and locked-segment halves intact.

## Commit Intent

```text
feat(edit-engine): allow any-angle Route geometry
```

## Outcome

Write validation rejects only degenerate geometry. `free` joins the wire
routing modes and ends the middle-click corner cycle, so any angle is reachable
without opening the Wire options.
