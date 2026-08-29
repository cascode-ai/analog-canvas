# ADR 0010: One RichText annotation and drafting authority

Status: `accepted`

## Decision

All visible editable schematic labels use bounded RichText documents.
`SchematicAnnotation` owns semantic kind, content, one visual anchor, alignment,
rotation, lock, and optional Net/route-marker relation. Visual-only explanatory
objects live in `drafting.objects` and cannot create connectivity.

The renderer consumes only persisted RichText. It never synthesizes an
Instance reference from an ID, parses a second text syntax, or uses an empty
label as a suppressor. Retired plain-string/figure-caption annotation shapes
are not part of the accepted RichText authority.

Object-relative and route-relative anchors keep a fallback position so deletion
of a visual target does not lose text. The fallback is presentation recovery,
not electrical or compatibility inference.

## Consequences

- Browser edit, Agent edit, formal SVG/PNG/PDF, hit testing, clipboard, and
  persistence share one text source.
- Duplicate Vin/Vout-style annotations can be detected structurally.
- Presentation changes do not alter the electrical topology hash.
