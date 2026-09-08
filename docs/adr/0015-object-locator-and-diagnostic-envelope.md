# ADR 0015: Object location and diagnostic evidence

Status: accepted

Date: 2026-08-12

Owners: `packages/model` (locator schema), `packages/derived` (projections and
diagnostics), `apps/editor` (navigation and check lifecycle)

## Context

A Document-local ID cannot identify one occurrence of a reused Cell.
Independent search, ERC, and visual-location types would force adapters to
guess identity. A combined undifferentiated error count would also confuse
electrical findings, visual observations, and historical import reports.

## Decision

One `ObjectLocator` and `HierarchyFrame` contract is declared by `@icm/model`
and re-exported by
[derived/object-locator.ts](../../packages/derived/src/object-locator.ts).
Locators identify a Document, object kind and ID, and an explicit hierarchy
path; direct-Document locations carry an empty path. Each frame identifies the
parent Document, calling Instance, and child Document. Repeated occurrences of
one Cell remain distinct. A missing object/path is unresolved, never replaced
by a guessed instance.

Search, trace, and diagnostic navigation use the shared location boundary.
Navigation may switch Cell, restore occurrence context, reveal, select, zoom,
or highlight. It does not edit a Document or destroy undo history.

The [diagnostic envelope](../../packages/derived/src/diagnostics/diagnostic.ts)
keeps domain, code, severity, confidence, gate eligibility, and located related
objects. ERC, routing, visual, schema, and SPICE evidence remain distinct
producers. Source-only operation reports need not invent a canvas location.
A low-confidence visual observation is not an electrical failure.

## Check lifecycle

A `LiveDiagnosticSnapshot` is transient evidence for specific Project/Document
revisions. “Live” distinguishes schematic evidence from an operation report;
it does not require background checking.

- **Check and Save** explicitly runs ERC and visual producers, presents the
  findings, and saves through the same Cloud Project service. Findings never
  veto saving. File / Save and Ctrl+S remain save-only.
- The last check is stamped with the Project session, revisions, and resolver.
  Edits, undo, and redo make it stale without rerunning producers. Stale rows
  cannot navigate and produce no canvas markers; replacement clears them.
- Before a check, the state is “Not checked”, not “No issues”. Rechecking
  replaces the evidence. Check failure does not withhold Save, and Save
  failure does not hide findings; newer edits remain dirty.
- Import/open/migration and rejected-operation reports describe past events.
  They are labelled separately and do not count as current schematic issues.
- Non-gating routing/visual observations remain available through explicit
  controls. The default view emphasizes ERC and structural findings.
- Netlist Check Report/export, Gallery advice, and Agent checks independently
  consume the common engines. Gallery advice is non-blocking for every role.

## Consequences and validation

The envelope is not persisted in Project files or formal exports. Hiding a row
does not remove the underlying electrical fact. Occurrence-aware navigation,
stale-result invalidation, per-Cell undo preservation, and deleted-target
refusal are protected at their relevant derived/editor test boundaries.

The type declarations stay in code; detailed user behavior is owned by
[editor interaction](../specs/editor-interaction.md), not a copied API signature
or work-package migration checklist here.

## Related documents

- [Connectivity index](0013-project-connectivity-index.md)
- [Agent API](../specs/agent-api.md)
- [Schematic model](../specs/schematic-model.md)
