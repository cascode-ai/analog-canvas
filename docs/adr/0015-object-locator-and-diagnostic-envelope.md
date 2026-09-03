# ADR 0015: Object Locator and Diagnostic Envelope

Status: `accepted`

Date: `2026-08-12`

Owners: `packages/derived` (locator and diagnostic types), `apps/editor`
(navigation), `packages/spice` + `packages/derived` (diagnostic producers)

## Context

Object identity is not a Project-level locator today. `VisualDiagnostic`
(`packages/derived/src/visual.ts`) carries `objectIds` scoped to the current
Document; `SpiceDiagnostic` carries a source span; neither can locate a
cross-Cell object. The navigation stack records mainly a Document id, so the
same child Cell invoked by two parent instances cannot say which instance path
was used (roadmap §4.3.4, §4.3.5, §5.5). Search, net trace, ERC, and the
diagnostic UI therefore cannot share one "find and navigate to this object"
operation.

The roadmap (§5.5, §5.6) requires a unified `ObjectLocator` + `HierarchyFrame`
pair and a unified `Diagnostic` envelope, while keeping the existing
`VisualDiagnostic` and `SpiceDiagnostic` producers behind adapters rather than
folding every rule into `visual.ts`.

## Decision

Freeze one `ObjectLocator` that names any object across the Project, one
`HierarchyFrame` chain that names the instance path into a child Cell, one
unified `Diagnostic` envelope, and one `navigateTo` operation.

### ObjectLocator (frozen)

```ts
interface ObjectLocator {
  documentId: string;
  hierarchyPath: readonly HierarchyFrame[]; // empty when the object is in documentId directly
  kind:
    | "document"
    | "instance"
    | "net"
    | "route"
    | "junction"
    | "terminal"
    | "port"
    | "annotation"
    | "no-connect"; // see ADR 0013 / schematic-model NoConnect (R7)
  objectId: string;
  endpoint?: EndpointRef; // present for terminal/port/junction targets
  sourceRef?: SourceSpan; // present for SPICE-originated objects
}

interface HierarchyFrame {
  parentDocumentId: string;
  instanceId: string; // the parent subcircuit instance
  childDocumentId: string; // the Document the instance instantiates
}
```

- `documentId` + `objectId` together are the Project-level identity; `objectId`
  alone is insufficient because two Documents may use the same id.
- `hierarchyPath` is the explicit chain of parent instances. The same child Cell
  invoked by two instances has two distinct locators; they are never merged into
  one ambiguous location.
- `NetRef`-style references always carry `documentId`; same-name Nets across
  Documents are never merged by string equality.

### Diagnostic envelope (frozen)

```ts
interface Diagnostic {
  id: string;
  domain: "schema" | "spice" | "erc" | "routing" | "visual";
  code: string; // e.g. ERC_FLOATING_GATE, VISUAL_ROUTE_OVERLAP
  severity: "error" | "warning" | "info";
  confidence: "high" | "medium" | "low";
  gateEligible: boolean;
  message: string;
  primary: ObjectLocator;
  related: readonly ObjectLocator[];
  parameters: Readonly<Record<string, string | number | boolean>>;
}
```

- Existing producers stay: `packages/derived/src/visual.ts` keeps producing
  visual/routing observations; the SPICE compiler keeps producing source
  diagnostics; schema validation keeps rejecting invalid files. Adapters wrap
  each into the unified envelope. ERC (ADR/R8) emits the envelope directly.
- Visual/routing observations and electrical ERC are different domains; a visual
  observation count is never proof of electrical correctness, and a low-
  confidence observation is not a default blocking gate.
- The envelope is a derived diagnostic: never persisted, never exported, never
  mutates the Project. Suppressing a diagnostic from the UI hides its display;
  it never deletes the underlying fact.

### Diagnostic lifecycle amendment (2026-08-18)

The envelope above describes one finding, but not its lifetime. Current
schematic evidence is published only inside a transient `LiveDiagnosticSnapshot`:

```ts
interface LiveDiagnosticSnapshot {
  source: "live";
  projectId: string;
  documentRevisions: readonly {
    documentId: string;
    revision: number;
  }[];
  diagnostics: readonly Diagnostic[];
}
```

- A snapshot is derived from exactly the listed Document revisions. The
  `live` source means schematic evidence rather than an import report; it
  does not require background execution. As of 2026-09-03, the editor runs
  ERC and visual producers only on **Check and Save**. Save itself remains
  ungated and uses the same current Cloud Project service as File / Save.
- The editor retains only the last check. Its runtime identity includes the
  Project session, structure/Document revisions and symbol resolver. Edits,
  undo and redo invalidate the result without executing either producer.
  Stale rows are explicitly labelled, cannot navigate, and have no canvas
  markers. Project replacement clears the result. Rechecking replaces it.
- Before checking, the UI says "Not checked", never "No issues". Checking
  errors do not withhold a save; save failures do not suppress findings.
  The checked and saved candidates must match, while newer edits stay dirty.
- Import, file-open, migration, and rejected-operation messages are operation
  reports. They describe an event and may remain available for review, but are
  not live schematic diagnostics, do not contribute to the current count, and
  must be labelled with their historical source.
- Non-gating routing/visual heuristics are observations. The editor keeps them
  available behind an explicit control; the default current view contains ERC
  and gate-eligible structural findings.
- The editor exposes one Project-wide checked diagnostic surface. A contextual
  import report must not independently re-render the same current visual
  findings.
- Netlist Check Report/export, Gallery quality advice, and Agent requests
  remain independent consumers of the same engines. Gallery advice does not
  veto publication. No second diagnostic protocol or persisted report is added.

### navigateTo (frozen semantics)

```ts
navigateTo(locator: ObjectLocator, options: {
  select?: boolean;
  reveal?: boolean;
  zoom?: "fit-object" | "fit-net" | "keep";
  highlightNet?: boolean;
}): void;
```

`navigateTo` is the single navigation entry for search results, net trace, and
diagnostic clicks. It: switches to `locator.documentId`, restores the
`hierarchyPath` instance stack, reveals and optionally zooms to the target,
sets selection, and optionally highlights the target's Net. It **never** mutates
a Document revision, never clears an undo history, and never moves an object.
The current Document-id-only navigation stack migrates to a frame stack; per-
Cell undo histories are preserved across navigation.

### Ownership and consumer boundary

- Owners: `packages/derived` defines `ObjectLocator`, `HierarchyFrame`, and the
  `Diagnostic` envelope; `apps/editor` implements `navigateTo` and the frame
  stack.
- Consumers (read-only): project search (R5), net highlight and cross-Cell trace
  (R6), ERC (R8), diagnostic UI (R9), and SPICE/visual diagnostic adapters.
- Mutators: none — locators and diagnostics are derived views.

### Failure semantics (frozen)

- A locator whose `documentId` was deleted or whose `hierarchyPath` frame no
  longer exists resolves to an unresolved-navigation diagnostic; it never
  silently picks a substitute instance.
- A SPICE source diagnostic still carries its `sourceRef`; its canvas `primary`
  locator is added by the adapter when binding is available, and omitted
  (source-only) otherwise.

## Amendment — 2026-08-12 recovery ownership

The frozen `ObjectLocator`, `HierarchyFrame`, and `Diagnostic` shapes are the
only public protocol. Before C1, the repository contains provisional
`IndexObjectLocator`, project-search `ObjectLocator`, and `ErcLocator` shapes;
they are implementation debt, not permitted alternative protocols. No new
consumer may introduce another locator or diagnostic-envelope type.

C1 creates `packages/derived/src/object-locator.ts` and
`packages/derived/src/diagnostics/diagnostic.ts` as the canonical declarations.
Index, search and ERC import those declarations directly (or receive a
compatibility re-export); all direct-document locators still carry
`hierarchyPath: []`. `HierarchyFrame` becomes operational with the editor's
`navigateTo()` work in C6, rather than being claimed complete merely because a
backend type exists.

The diagnostic envelope is independent of ERC: ERC, visual/routing and SPICE
adapters share it, but the public diagnostic type must not import an ERC-only
type. This preserves the domain boundary and prevents an adapter cycle.

## Alternatives considered

### Alternative A — Document-scoped ids only

- Benefits: smallest change.
- Costs: cross-Cell trace, hierarchy-aware search, and multi-instance disambiguation
  remain impossible.
- Reason not selected: these capabilities are the point of R5/R6.

### Alternative B — fold every diagnostic rule into visual.ts

- Benefits: one producer file.
- Costs: electrical rules and visual observations become indistinguishable; the
  `category`/`gateEligible` distinction erodes; `visual.ts` becomes the ERC
  engine the roadmap explicitly rejects (§5.6, §8 R8).
- Reason not selected: roadmap §2 non-goal and §5.6 require separate domains.

## Consequences

### Positive

- One locator and one navigation operation for search, trace, and diagnostics.
- Cross-Cell ERC clicks reach the right instance path.
- Visual observations and electrical ERC stay cleanly separated.

### Negative or limiting

- Every diagnostic producer needs an adapter; the diagnostic UI must group by
  domain/severity/Cell.
- The navigation stack gains frame state; per-Cell undo history must be
  preserved across the change.

## Compatibility and migration

Additive only. `VisualDiagnostic` and `SpiceDiagnostic` keep their shapes and
producers. R5 introduces `ObjectLocator`/`HierarchyFrame` + `navigateTo`; R6
consumes them for trace/highlight; R8 emits ERC diagnostics in the envelope; R9
builds the unified UI. No schema, fixture, or Project-file change.

## Validation

- Existing visual/SPICE diagnostic tests keep passing behind their adapters.
- R5: same-name child Cell invoked by two parent instances yields two distinct
  locators and two distinct `hierarchyPath`s; navigating each reaches the right
  instance and preserves the source Cell's undo history.
- R9: a cross-Cell ERC diagnostic navigates to its `primary` in one click;
  returning to the parent restores the frame stack and viewBox; navigation
  produces no revision.
- Negative test: a deleted-Document locator produces an unresolved-navigation
  diagnostic, not a fallback guess.

## Related documents

- [`../../docs/roadmap/connectivity-routing-debugging-plan.md`](../roadmap/connectivity-routing-debugging-plan.md) §5.5, §5.6, §8 R5/R6/R9
- [`../specs/editor-interaction.md`](../specs/editor-interaction.md)
- [`../specs/agent-api.md`](../specs/agent-api.md)
- [`0013-project-connectivity-index.md`](0013-project-connectivity-index.md)
