# Formal Export

Status: `accepted`

Version: `1.0`

Primary owners: `packages/render-svg`, `packages/exporters`

Related ADR: [`0014-resolved-route-geometry.md`](../adr/0014-resolved-route-geometry.md).
Formal export consumes the resolved route geometry (centerline + endpoint joins)
and, as today, excludes editor overlays, flightlines, selection, and
diagnostics.

## Contract

Every export starts from one validated `SchematicDocument`, one symbol
resolver, and the formal SVG scene. Editor overlays, hit targets, selections,
flightlines, and diagnostics are never part of a formal artifact.

| Format | v0.1 derivation                             | Media type        |
| ------ | ------------------------------------------- | ----------------- |
| SVG    | canonical formal scene                      | `image/svg+xml`   |
| PNG    | white-background raster of that SVG at 3x   | `image/png`       |
| PDF    | browser: formal SVG converted to vector PDF | `application/pdf` |

The SVG viewBox is the authoritative page bound. Browser PDF export converts
that same curated, renderer-generated SVG through `svg2pdf.js` into PDF paths
and text; it never embeds the page-cover PNG used by the PNG artifact. The
original SVG is unchanged. Export filenames are normalized and all three
formats use the same base name.

Canonical SVG resolves script typography before serialization: subscript and
superscript runs use numeric font sizes and explicit baseline displacement,
and the next visible run restores the parent baseline. Formal SVG must not
delegate script placement to `baseline-shift` or percentage `font-size`, whose
support is inconsistent in Office-class SVG importers. This keeps searchable,
editable SVG text while making its geometry portable beyond browser engines.

The browser PDF converter still operates on a temporary SVG clone. It
materializes text decorations as vector strokes and defensively expands any
legacy relative text constructs before conversion. This compatibility pass
must not rewrite the downloaded canonical SVG or flatten PDF text into a page
image.

Node/headless export retains a high-resolution raster-PDF fallback for release
tooling because the browser vector converter requires a live DOM. It is not the
interactive editor's user-facing PDF path.

If vector conversion fails, browser export fails visibly; it must not silently
downgrade the requested PDF to a bitmap. SVG remains the portable vector
fallback.

## Validation

- parse the SVG viewBox and reject invalid bounds;
- check PNG signature and dimensions against viewBox times scale;
- reopen browser PDF, check one page and page bounds, assert it contains no
  page-cover image XObject, assert representative rich-text runs retain their
  nonzero scaled fonts and displaced baselines, and visually compare a rendered
  PDF page with the SVG fixture;
- assert canonical formal SVG contains no `baseline-shift` or percentage
  `font-size`, and that a visible run following a script restores its parent
  baseline;
- assert formal SVG has no editor-only layers.

## Agent File Resource

An authorized API-2.0 Agent downloads canonical Project JSON or formal
SVG/PNG/PDF only through the separate File Resource advertised by
capabilities. Project download uses `serializeProject()` byte-for-byte; visual
formats derive from the same formal SVG. Selection, diagnostics, flightlines,
and editor overlays never enter a formal artifact. Responses are bounded,
hashed, Project/Document-revision bound, and never persisted by the relay.
