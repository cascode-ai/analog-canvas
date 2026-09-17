# Routing Geometry and Operations

Status: `accepted`

Owners: `packages/derived`, `packages/edit-engine`, `packages/render-svg`, `apps/editor`

## Decision

Resolve authored Route identities into shared read-only geometry and evaluate
one typed edit plan for preview and commit. The rules belong to
[connectivity and routing](../specs/connectivity-and-routing.md) and
[Edit Engine](../specs/edit-engine.md); [visual language](../specs/visual-language.md)
owns rendering and diagnostic presentation.

## Context

Independent polylines in rendering, hit testing and dragging can disagree.
Positional segment indices lose identity when a bend is inserted. A separately
constructed preview can show a different electrical result from its commit.

## Rationale

Stable leg identity gives attachments an address that survives unrelated edits.
Shared resolved geometry closes visual seams without changing electrical
contacts or moving persisted endpoints.

Evaluating the actual typed transaction makes its resulting Document the
preview. Independently comparing electrical effects catches a planner's
unintended merge or owner change; trusting its changed-ID list would not.
Plans remain transient because persisting them duplicates Project facts.

Moving connected objects preserves connection and adjusts only local incident
geometry; explicit cut communicates disconnection. Expanding separated direct
contacts into ordinary Routes keeps this rule consistent without introducing a
persisted Contact object or a global autorouter.

Authoring modes constrain new gestures, not the meaning of existing conductors.
Arbitrary headings are valid; normalization removes redundant coverage while
preserving authored geometry and owned attachments, not enforcing a style.
