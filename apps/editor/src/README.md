# Editor Source Architecture

The editor source tree is organized by ownership rather than file type. Keep
tests beside the implementation whose contract they protect.

The sibling `../analytics/` directory is the complete cross-runtime first-party
analytics module: dashboard, styles, browser tracking, HTTP routes, map data,
and Durable Object storage. `src/` and the top-level Worker only mount it.

## Directory Responsibilities

- `app/`: top-level editor composition and orchestration.
- `agent/`: the browser Agent session: connection panel, session state,
  recovery and transport liveness, and the host adapters that serve Agent
  operations from the live document.
- `canvas/`: reusable canvas geometry, hit resolution, and drag-session
  infrastructure. It must not own document transactions. Who owns one pointer
  press is decided only in `pointer-down-router.ts`, a pure function over
  facts: the capture-phase dispatcher gathers those facts, asks it, and
  executes the answer. Hit elements carry data attributes and their click,
  double-click and context-menu handlers; a press handler on one of them
  would be a second opinion, and the ordering between the two used to rest on
  `stopPropagation` firing first.
- `components/`: reusable presentational shells that do not own editor model
  state.
- `document/`: document navigation, transaction, and project recovery
  lifecycle boundaries.
- `interaction/`: application-wide interaction state, shortcut intent mapping
  and reference, deferred focus handoff, and orientation commands shared by
  feature adapters.
- `commands/`: the typed editor command requests, enablement state, and
  command router.
- `features/`: user-facing editing domains. Each feature owns its pure
  proposals, local view adapters, and tests.
  - `clipboard/`: copy and paste proposals.
  - `component-insert/`: the insert dialog, placement tray, placement preview
    and snapping, symbol catalog and artwork, and VDD rail placement.
  - `drafting/`: drafting creation and manipulation.
  - `editor-shell/`: file, export, Cloud Project, and Gallery commands;
    toolbars, status bar, library panels, document settings, and symbol
    sibling swaps.
  - `hierarchy/`: Cell management and interface dialogs, Cell symbol review,
    hierarchy navigation, and Project structure commands.
  - `instance-display/`: default Instance labels and live parameter display.
  - `netlist-export/`: netlist authoring, output preferences, preflight and
    code panels, and Spectre import-source conversion.
  - `project-code/`: the complete Project JSON code panel.
  - `properties/`: the Properties editors, their code views, and the property
    edit planner.
  - `search/`: the Project search dialog.
  - `selection/`: visual selection, deletion, geometry, and inspector details.
  - `simulation/`: the analog Simulation workspace, run history and results,
    and the local-development digital timing panel.
  - `text-editing/`: annotation and drafting-text editing.
  - `user-components/`: code and preview authoring, the public component library,
    shared definition contracts, and instance-isolated application.
  - `wiring/`: wire proposals, manual paths, and route interaction geometry.
  - `logical-net-choices.ts`, at the `features/` root: the Logical Net choice
    list read by `app/`, `editor-shell/`, and `simulation/`.
- `demos/`: demo project fixtures used by editor unit and Playwright tests.
- `deployment/`: fail-closed resolution of the public UI build flags.
- `examples/`: browser-bundled Library and Simulation starter Projects.
- `presentation/`: the accepted Razavi presentation policy adapter.
- `snap/`: shared snapping candidates and engine.
- `styles/`: route-level style entries and their owner stylesheets.

`main.tsx`, `styles.css`, and `vite-env.d.ts` remain at the source root because
they are build/runtime entry infrastructure rather than product domains. The
root also holds `gallery-client.ts`, `gallery.css`, and the static service
worker test `service-worker-cache.test.ts`.

## Editor Composition Boundaries

`app/App.tsx` is the editor composition root. It may own application session
state, modal state, top-level React lifecycles, and the wiring that connects
feature controllers to view props. It should not become the implementation
home for derived queries, transaction planning, or pointer policy.

- `app/use-editor-derived-model.ts` owns revision-scoped read models shared by
  the canvas, diagnostics, navigation, and inspectors. Add a derived value
  there when it is a projection of the current Project revision and is consumed
  by more than one composed feature.
- Feature command facades own domain write intent. They normalize UI input,
  call the appropriate Edit Engine planner, choose transaction identity, and
  report the result. `App` composes these commands but does not duplicate their
  rules.
- Controllers receive named capability groups such as model, selection,
  viewport, session, and commands. These groups describe why a dependency is
  available; they are not a generic context object or an alternative state
  store.
- Modal confirmation sessions stay in `App` when the composition root owns the
  lifecycle. The plan being confirmed remains an Edit Engine contract.

Canvas modules follow interaction ownership rather than one-file-per-element:

- `editor-canvas-surface.tsx` owns the global SVG layer order.
- `editor-canvas-hit-layer.tsx` owns the relative hit order of instances,
  Routes, endpoints, and annotations.
- Route handles, drafting handles, wiring UI, placement previews, and transient
  previews remain separate where they have distinct behavior or tests.
- Event routing and gesture policy remain controllers and never move into
  presentational overlay components.

When evolving this structure, split a module because it owns a business rule,
lifecycle, reusable contract, focused test contract, or high-risk invariant.
Co-locate single-parent presentation fragments when they share one ordering or
change boundary. File length alone is neither a reason to split nor a reason to
merge.

## Presentation Style Ownership

Styles load from a route-level entry, never from a lazy component. The editor
route imports `styles/editor-entry.css`; Gallery, My Submissions, and
Moderation import `styles/gallery-entry.css`. A feature may keep its stylesheet
beside its component, but every runtime surface that renders that feature must
load it statically from its presentation entry. This is why Version History is
loaded by both route entries while Publish to Gallery is loaded only by the
editor entry.

The editor entry preserves an explicit cascade order and delegates selectors
to these owners:

- `editor-chrome.css`: application bars, menus, commands, project identity,
  status bar, and the root error surface.
- `editor-workspace.css`: workspace grid, library rail, shapes browser, and
  resizing behavior.
- `editor-inspection.css`: selection shelf, inspector details, and diagnostics.
- `editor-overlays.css`: help and recovery surfaces that float over the
  workspace without resizing it.
- `editor-canvas.css` and `editor-canvas-state.css`: persistent SVG surface and
  transient canvas states.
- `editor-properties.css`: editable properties and their derived context.
- `editor-dialogs.css`: editor-owned modal workflows.
- `editor-agent.css`: agent session presentation.
- `editor-simulation.css`: the Simulation workspace and the local-development
  timing tool window.
- `editor-accessibility.css`: the cross-cutting reduced-motion policy.
- `editor-context-menu.css`: the canvas context menu.

Responsive rules stay with the owner whose layout they change. A selector
should begin with, or be structurally contained by, that owner's root family;
cross-owner selectors and non-local duplicate overrides require an explicit
shared contract. Adjacent base-and-specialization rules may share a selector
when their relationship is visible in one owner. Do not import CSS inside a
lazy dialog or component: opening a feature must not inject rules or change the
computed style of unrelated UI.

## Dependency Direction

Dependencies flow toward stable contracts:

```text
main -> app -> features/components/document/interaction/canvas
                    -> packages/*
```

Feature and infrastructure modules must not import `app/App.tsx`. Pure
proposal, reducer, and geometry modules must not import React components.
Cross-feature imports should be avoided; move a genuinely shared primitive to
`canvas/`, `document/`, `interaction/`, `snap/`, or an appropriate workspace
package instead.

Do not add broad barrel files merely to shorten imports. Explicit module paths
make ownership visible and reduce accidental dependency cycles.
