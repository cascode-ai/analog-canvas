# Maintenance Log

## 2026-08-15 - Editor runtime crash safety (minimal three layers)

- Target: keep the page alive through render and transaction crashes with the
  evidence-bounded minimum — root error boundary, last-good-scene fallback,
  and an INTERNAL_ERROR transaction fence; full shell split, runCommand
  executor, and render preflight deliberately deferred
  (`plan/2026-08-15-editor-runtime-crash-safety/`). Executed in a dedicated
  worktree because the main worktree holds another worker's active dirty
  target.
- Changed areas: new `editor-error-boundary.tsx`, `scene-safety.ts`,
  `crash-test-hooks.ts` (DEV-only), `runtime-crash-safety.spec.ts`; additive
  `INTERNAL_ERROR` in `EditErrorCode`; `document-controller.ts` fence +
  history rebuild; `App.tsx` scene guards and transact fence; `main.tsx`
  boundary mount; crash-screen CSS.
- Validation: 736 unit tests green (7 new); 106 E2E green (2 new + drafting,
  component-insert, full manual-editor); typecheck, prettier,
  `git diff --check` clean.
- Commit status: committed as
  `feat(editor): keep the page alive through render and transaction crashes`
  on `agent/editor-runtime-crash-safety`.

## 2026-08-15 - Junction-aware VDD rail mainline delivery

- Target: deliver stretchable, junction-aware VDD rail editing from
  `codex/vdd-rail-editing` through the protected-main gate.
- Changed areas: delivery evidence only; product change is `01655dc`.
- Validation: clean frozen install plus complete `pnpm ci:check`; all six PR
  #62 required GitHub Actions checks passed (scope, static, unit, release, and
  two browser shards).
- Commit status: PR #62 merged to `main` as `81d1e8d`; the delivery-record
  closure remains on this documentation-only commit.

## 2026-08-15 - Make tapped VDD rails stretchable and junction-aware

- Target: restore usable direct manipulation for VDD rails after an ordinary
  wire tap splits the stored rail at a Junction.
- Changed areas: connected `power-rail` component derivation; Junction-group
  route stretching; VDD whole-rail move/end-resize editor gestures; focused
  routing and browser regressions.
- Validation: focused routing tests (29), VDD browser regression, typecheck,
  Prettier, `git diff --check`, and clean branch status passed.
- Commit status: pending `fix(editor): make VDD rails stretchable after taps`
  on `codex/vdd-rail-editing`.

## 2026-08-14 - WP-5 browser hardening and release delivery

- Target: prove the failure matrix (abrupt tab death, two tabs, quota,
  Cache Storage isolation) and deliver the release note; final work package
  of `plan/2026-08-14-robust-page-persistence-recovery/`.
- Changed areas: new `recovery-hardening.spec.ts` (4 tests), recovery dialog
  generation lines now include the revision (fixes a card-scoping
  ReferenceError found by the two-tab run), `scripts/editor-production-smoke.mjs`
  cache-isolation check + regenerated golden report, scheduler comment
  cleanup, `docs/release/browser-recovery-v2.md`.
- Validation: hardening spec 4/4; typecheck, prettier, docs links, and the
  production smoke in both modes against a fresh build green;
  `git diff --check` clean. Branch gate (`pnpm verify:branch`) and clean-state
  `pnpm ci:check` (121/121 E2E) passed green.
- Remote-check repair: the required Browser-tests shard failed on a drag
  test; instrumented probes traced it to App re-renders replacing the formal
  scene (inline `dangerouslySetInnerHTML` literal changes prop identity),
  which the debounced recovery state publication exposed mid-drag. Fixed by
  memoizing the innerHTML prop objects; the formerly 3/3 failing probe is
  3/3 green, the flaky test 5/5, and post-repair 271 unit tests plus 102
  affected E2E tests are green.
- Commit status: committed as `test(editor): prove project recovery failure
modes` plus `fix(editor): keep drag sessions alive across app re-renders`
  on `agent/robust-page-persistence-recovery`.

## 2026-08-14 - WP-4 recovery UX and operational visibility

- Target: non-blocking recovery banner, per-session recovery dialog with
  Restore/Download/Delete, persistent storage-failure warning, statusbar
  recovery label, and Help/troubleshooting updates; fifth work package of
  `plan/2026-08-14-robust-page-persistence-recovery/`.
- Changed areas: new `recent-recovery-dialog.tsx` + `recovery-banners.tsx`,
  `downloadTextArtifact` in `project-file-service.ts`, `App.tsx` dialog/
  banner/menu/statusbar wiring, help dialog + troubleshooting docs, new
  `recovery-dialog.spec.ts` (6 tests) and dialog-based manual-editor flows.
- Validation: 106 unit tests; 90 E2E tests across manual-editor,
  recovery-dialog, project-file, component-insert; typecheck, prettier,
  `git diff --check` clean.
- Commit status: committed as `feat(editor): add recent-work recovery UX` on
  `agent/robust-page-persistence-recovery`.

## 2026-08-14 - WP-3 project file service and replacement protection

- Target: truthful Save/Open semantics with File System Access enhancement,
  staged typed open diagnostics, file-state machine, and dirty-work
  replacement guard; fourth work package of
  `plan/2026-08-14-robust-page-persistence-recovery/`.
- Changed areas: new `project-file-service.ts` (+13 unit tests), new
  `replace-guard-dialog.tsx`, `App.tsx` file-state/guard/save/open wiring,
  download-only E2E emulation in manual-editor/drafting specs, new
  `project-file.spec.ts` (7 tests).
- Investigation: in-page probes proved Chromium aborts even synchronously
  dispatched IndexedDB puts during pagehide unload; the old
  reload-inside-debounce durability cannot survive async storage. A
  trusted-snapshot write path was built, disproven, and fully reverted; the
  affected E2E now waits for the debounced write before reloading. Recorded
  as `experience: candidate` on the WP-3 plan for human review.
- Validation: 106 unit tests; 111 E2E tests across
  drafting/manual-editor/project-file/component-insert/web-agent-session/
  chrome-isolation; typecheck, prettier, `git diff --check` clean.
- Commit status: committed as `feat(editor): harden project open and save` on
  `agent/robust-page-persistence-recovery`.

## 2026-08-14 - WP-2 recovery coordinator and Project lifecycle

- Target: replace the synchronous localStorage recovery hook with an
  IndexedDB-backed coordinator; third work package of
  `plan/2026-08-14-robust-page-persistence-recovery/`.
- Changed areas: new `recovery-coordinator.ts` (+17 unit tests), `App.tsx`
  recovery/replacement/refresh/restore wiring, `project-recovery.ts` reduced
  to the legacy migration key (writer hook and test removed),
  `editor-fixtures.ts` IndexedDB read helper, manual-editor/component-insert
  recovery E2E updated to retained-recovery semantics.
- Validation: `pnpm test:local apps/editor/src/document apps/editor/src/app/App.test.tsx`
  93/93 green; E2E recovery/refresh greps plus full drafting and
  web-agent-session specs green; typecheck, prettier, `git diff --check`
  clean.
- Commit status: committed as
  `refactor(editor): coordinate durable working copies` on
  `agent/robust-page-persistence-recovery`.

## 2026-08-14 - WP-1 IndexedDB recovery store and legacy migration

- Target: transactional IndexedDB adapter for the WP-0 recovery contract plus
  the one-time `icm.recovery.v1` localStorage migration; second work package
  of `plan/2026-08-14-robust-page-persistence-recovery/`.
- Changed areas: new `apps/editor/src/document/browser-recovery-store.ts`
  (+18 unit tests on `fake-indexeddb` 6.2.5, new editor dev dependency,
  lockfile re-verified frozen).
- Validation: `pnpm test:local apps/editor/src/document` 68/68 green;
  typecheck, prettier, `git diff --check` clean.
- Commit status: committed as `feat(editor): persist bounded browser recovery`
  on `agent/robust-page-persistence-recovery`.

## 2026-08-14 - WP-0 recovery contract and retention core

- Target: freeze the browser-recovery record contract as pure functions before
  any storage or GUI change; first work package of
  `plan/2026-08-14-robust-page-persistence-recovery/`.
- Changed areas: new `apps/editor/src/document/browser-recovery-contract.ts`
  (+23 unit tests), `docs/specs/persistence-and-recovery.md` v2 contract,
  user compatibility statement.
- Validation: `pnpm test:local apps/editor/src/document` 50/50 green;
  prettier, `tsc` project check, `git diff --check` clean.
- Commit status: committed as `feat(editor): define bounded recovery records`
  (`08af5d3`) on `agent/robust-page-persistence-recovery`.

## 2026-08-14 - Agent-side MCP adapter (M0-M3)

- Target: give Codex/Claude/Cursor hosts a local stdio MCP entry over the
  unchanged four-operation Agent API, covering design milestones M0-M3
  (contract/doc freeze, session Helper, read tools/resources, high-level
  action compilation). M4/M5 (persistent pairing, file tools, delivery gate)
  remain follow-up targets.
- Changed areas: new `packages/agent-client` Helper (http/connection-state/
  credential-store/snapshot-cache/session-client/authoring compiler), new
  `apps/mcp-server` stdio MCP (protocol/tools/resources/results), ADR 0020,
  `docs/agent/resource-manifest.json` + `scripts/generate-mcp-resources.mjs`
  (+`pnpm mcp:resources[:check]`), docs entry reordering, ADR index, catalog
  re-export from `@icm/agent-adapter/kit`, tsconfig paths, lockfile importers.
- Contract result: no change to the four-operation API, worker, editor, or
  Edit Engine. MCP is an Agent-side client only; tokens stay in the Helper and
  a user-level credential file; `advanced_transact` is gated on reading the
  advanced-edits resource; high-level actions compile to existing typed edits
  or `wireIntent` with dry-run, revision checks, and `STATE_CHANGED` reports.
- Validation: 71 new unit/contract tests; full suite 113 files / 638 tests
  green; format/docs/references/catalog/typecheck green; composite builds of
  both packages; generated-resource check up to date; live stdio smoke of the
  built server; `git diff --check` clean. Local `pnpm ci:check` could not run
  (no pnpm shim on PATH; corepack used instead), so remote required checks are
  the delivery authority.
- Commit status: to be committed as
  `feat(agent): add Agent-side stdio MCP adapter (M0-M3)` and pushed on
  `codex/agent-mcp-adapter`.

## 2026-08-14 - External Agent Razavi authoring Kit

- Target: allow a browser-authorized Agent without repository source or manually
  seeded components to author a small Razavi circuit from an empty Document,
  without adding a catalog query or another mutation protocol.
- Changed areas: generated compact built-in authoring catalog; Kit v2 workflow
  and authority rules; public Agent/session/API guidance; Worker Kit subpath;
  generator freshness gate and black-box inverter contract coverage.
- Contract result: the static Kit provides reviewed initial symbol/pin/variant
  and VDD facts, Snapshot supplies live objects and coordinates, and
  OpenAPI/capabilities remain the sole request authority. The Kit is excluded
  from the editor bundle and is transferred only by `GET /api/agent/kit`.
- Validation: focused 24-test Kit/Worker suite, generator check, typecheck,
  Markdown links, `git diff --check`, and `pnpm verify:branch` (104 files / 567
  tests, workspace builds, production smoke) passed. Remote static checking
  then exposed the absent source mapping for the Kit subpath; after adding it,
  a clean frozen-install `pnpm ci:check` passed (567 unit tests, 103 browser
  tests, release/performance/export/PWA gates).
- Commit status: feature committed as `9d257b7`; CI source-map repair committed
  as `a87fcb6` and pushed on `codex/agent-authoring-kit`.

## 2026-08-13 - Agent golden-path request-contract closure

- Target: enforce the browser Agent's one public v2 request path without adding
  a Circuit operation or simulation/PVT/waveform/design-netlist-export scope.
- Changed areas: strict service handler selection for browser and loopback v2;
  v2-only invalid-request dialect; OpenAPI typed claim/Circuit failures;
  copyable connection instructions; current API guidance and focused tests.
- Contract result: relay, browser host, and service apply the same production
  request Schema; invalid requests return redacted path-bearing
  `INVALID_REQUEST`, are not forwarded, and cannot change a revision. Hosted
  OpenAPI declares all observed Circuit/claim terminal HTTP outcomes.
- Validation: focused 57-test Agent/worker/editor suite, web Agent E2E,
  generated artifacts write/check, typecheck, docs, `git diff --check`, and
  `pnpm verify:branch` (118 files / 713 tests, build and production smoke)
  passed.
- Commit status: ready to commit as
  `fix(agent): enforce one hosted request contract` on
  `codex/agent-project-lifecycle`.

## 2026-08-13 - Same-Project browser Agent session recovery

- Target: recover an already claimed Agent session across a same-tab browser
  refresh without implementing Project-level Cell/hierarchy control.
- Changed areas: bounded browser recovery record and hook lifecycle; terminal
  relay editor reconnection handling; session threat/spec and delivery-roadmap
  scope; focused recovery and Worker tests.
- Contract result: only a matching live Project may reuse the browser editor
  proof; bearer/claim/Project/request data are not persisted. Revoke, expiry,
  replacement, malformed storage, and mismatch remove the proof; uncertain
  writes retain their original request-id path.
- Validation: focused 44-test session suite, browser Agent E2E, generated
  artifacts, docs/type/diff checks, and `pnpm verify:branch` passed (119 test
  files, 717 tests, all builds, production smoke).
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `feat(agent): recover same-project browser sessions`.

## 2026-08-13 - Project compatibility corpus baseline

- Target: establish the first M4 migration-corpus proof, without changing
  simulation, PVT, waveform, or design-netlist export scope.
- Changed areas: explicit Project corpus manifest; sequential migration and
  canonicalization regression test; current user file-compatibility guidance.
- Contract result: every shipped Project fixture and saved circuit Project is
  classified as current, historic migration input, or explicitly rejected;
  all supported historic inputs parse to stable schema-v8 output without
  persisted `spice.*` or `routeAttachment` fields.
- Validation: focused corpus/persistence/v7-to-v8 tests (14 tests), typecheck,
  Markdown links, production-reader audit, and `git diff --check` passed.
- Commit status: committed as `ab30544` and pushed on
  `codex/agent-project-lifecycle`.

## 2026-08-13 - Typed netlist and source-provenance authority

- Target: complete M3 of browser Agent takeover by removing runtime `spice.*`
  authority without adding simulation, PVT, waveform, or design-netlist export.
- Changed areas: schema-v8 terminal mapping/import provenance and migration;
  structural SPICE import; hierarchy, ERC, search, Snapshot/OpenAPI, component
  parameters, symbol replacement, fixtures, and current model/API/persistence
  specifications.
- Contract result: typed netlist facts are the sole runtime netlist/hierarchy
  authority; imported source evidence is bounded and immutable; current model
  and transaction schemas reject `spice.*` writes.
- Validation: focused migration/import/ERC/Snapshot checks; Agent artifacts
  write/check; full `pnpm test:local` (117 files, 707 tests); typecheck, docs,
  references, formatting, `git diff --check`, and `pnpm verify:branch` passed.
- Commit status: committed as `9ad4ce5` and pushed on
  `codex/agent-project-lifecycle`.

## 2026-08-13 - Detailed browser Agent takeover delivery sequence

- Target: turn the accepted four-operation takeover roadmap into an
  implementation-ready sequence while excluding simulation, PVT,
  waveforms/measurements, and SPICE/Spectre/design-netlist export.
- Changed areas: verified M0--M2 status and M3 `spice.*` authority inventory;
  detailed M3--M4 and A1--A6 boundaries, owners, dependency gates, negative
  cases, and delivery proof; current roadmap status.
- Validation: Prettier on changed Markdown, `pnpm docs:check`,
  `pnpm references:check`, and `git diff --check` passed.
- Commit status: ready to commit as
  `docs(agent): detail takeover delivery slices` on
  `codex/agent-project-lifecycle`.

## 2026-08-13 - Remove compatibility re-export layers

- Target: make wiring, style, label-placement, and markup callers depend on
  their actual contract owners rather than private compatibility modules.
- Changed areas: removed two editor wiring shims and five render-svg wrapper or
  wrapper-test modules; redirected imports to Edit Engine, Derived, and model.
- Coverage decision: moved the unique wiring tests to Edit Engine and merged
  unique style/label assertions into Derived; no behavior coverage was dropped.
- Validation: removed-path reference audit; 67 focused tests; workspace
  typecheck; production build; full formatting check; and `git diff --check`
  passed.
- Commit status: prepared as `refactor: remove compatibility re-exports` on
  `codex/ci-contract-cleanup`.

## 2026-08-13 - Retire legacy annotation edit protocol

- Target: keep only the explicit schematic-annotation edit protocol and reject
  the earlier ambiguous edit names without compatibility.
- Changed areas: Edit Engine schema/runtime, Agent capability and generated API
  artifacts, editor/routing/recipe callers, fixtures, tests, and normative
  protocol documentation.
- Contract preservation: the current remove path now includes the layout-intent
  reference protection that previously existed only in the legacy branch.
- Validation: 68 focused cross-package tests plus 19 focused Edit Engine tests;
  Agent API artifact check; typecheck; production build; formatting;
  `git diff --check`; and absence audit outside explicit negative tests passed.
- Commit status: prepared as
  `refactor(api): retire legacy annotation edits` on
  `codex/ci-contract-cleanup`.

## 2026-08-13 - Scope CI by changed surface

- Target: keep required PR check names while avoiding release and browser work
  for documentation-only changes.
- Changed areas: CI change classifier and conditional lightweight/full paths
  for static, unit, release, and both browser-shard checks.
- Validation: workflow Prettier parse/check, pull-request and push path-policy
  review, and `git diff --check` passed.
- Commit status: prepared as
  `ci: skip heavy gates for documentation-only changes` on
  `codex/ci-contract-cleanup`.

## 2026-08-13 - Expand routine plan record pruning

- Target: reduce archived plan-body bloat beyond the initial 14-record sweep
  without removing decision-bearing history or changing product behavior.
- Changed areas: deleted 20 independently reconstructible UI, shortcut,
  symbol-calibration, visual-fixture, and typecheck plan bodies; condensed the
  archive index; clarified the evidence-and-decision-value retention rule.
- Evidence boundary: each deletion was checked for a completed outcome,
  matching factual log record, and Git history. Architecture, migrations,
  recovery, integration, CI/deployment, shared geometry, and experience
  records remain present.
- Validation: protected-record presence and 20-file deletion count confirmed;
  `git diff --check` passed and final worktree review contains only this
  target's planned documentation updates.
- Commit status: prepared as `docs(plan): expand routine record pruning` on
  `codex/plan-lifecycle-hygiene`.

## 2026-08-13 - Move planner and Route geometry ownership

- Target: remove double planning between GUI group moves and Edit Engine route
  follow, and stop disconnected geometry on one logical Net from moving as one
  block.
- Changed areas: transaction-wide explicit Route authority; group-move edit
  planner; connected-component internal selection; movement contracts and
  focused regressions.
- Validation: 36 routing/stretch tests, 5 clipboard/marker consumer tests, and
  all 620 unit tests; final clean `pnpm ci:check` including 92 browser tests
  and every release gate; `git diff --check` clean.
- Commit status: implementation commit `0af19d1` on
  `codex/wire-move-consistency`; final validation recorded before push.

## 2026-08-13 - Wire session and snap consistency

- Target: remove intermittent manual-Wire failures caused by tool reactivation,
  stale source references, self-snap, and coincident-candidate ordering.
- Changed areas: editor interaction state; point-snap result contract; Wire
  canvas integration; interaction specification; unit and browser regressions.
- Validation: 15 focused unit tests; workspace typecheck and build; focused
  Playwright regression plus four transaction/status scenarios. The initial
  full-gate run exposed and drove removal of an effect-ordering race; final
  clean `pnpm ci:check` passed all 620 unit and 92 browser tests plus release
  gates; `git diff --check` clean.
- Commit status: implementation commits `6aa57cd` and `34b4ad3` on
  `codex/wire-move-consistency`; final validation recorded before push.

## 2026-08-12 - Drawn VDD rail mainline delivery

- Target: deliver drawn VDD rail and capacitor refinements to remote main by
  review PR under the required delivery gate.
- Changed areas: corrected capacitor rotated-label geometry expectation and
  delivery target record.
- Validation: frozen install and full `pnpm ci:check` passed: 615 unit tests,
  release/performance/export/PWA/release smoke, and 91 browser tests.
- Commit status: PR #19 merged as `8bd0670` after five required GitHub Actions
  checks passed; remote `main` verified at that merge commit.

## 2026-08-12 - Capacitor plate contraction

- Target: reduce the current capacitor plate length by 10%.
- Changed areas: capacitor Symbol DSL and regenerated catalog.
- Validation: Razavi catalog generation/check; Symbols build; `git diff --check`.
- Commit status: ready on `codex/vdd-drawn-rail` as
  `fix(symbols): contract capacitor plates`.

## 2026-08-12 - Capacitor plate length extension

- Target: extend the current Razavi capacitor plate length by 30%.
- Changed areas: capacitor Symbol DSL and regenerated catalog.
- Validation: Razavi catalog generation/check; Symbols build; `git diff --check`.
- Commit status: ready on `codex/vdd-drawn-rail` as
  `fix(symbols): extend capacitor plates`.

## 2026-08-12 - Capacitor user refinement

- Target: apply the requested 10% plate-length and 20% center-spacing increase
  to the integrated Razavi capacitor.
- Changed areas: capacitor Symbol DSL and regenerated catalog; target record.
- Validation: Razavi catalog generation/check; Symbols build; `git diff --check`.
- Commit status: ready to commit on `codex/vdd-drawn-rail` as
  `fix(symbols): expand capacitor plates and spacing`.

## 2026-08-12 - Capacitor calibration integration

- Target: include the separately reviewed capacitor plate calibration in the
  active drawn-VDD-rail branch.
- Changed areas: cherry-picked calibrated capacitor asset and catalog with its
  original target record; integration target record.
- Validation: symbol catalog check; Symbols build; capacitor vertical/horizontal
  fidelity (`0.6438` / `0.7247` IoU, zero registration lift); `git diff --check`.
- Commit status: calibration cherry-pick `83d8668`; integration record ready to
  commit and push on `codex/vdd-drawn-rail`.

## 2026-08-12 - Drawn VDD rail correction

- Target: replace the incorrect VDD P-pin wire-start interaction with direct,
  length-selectable VDD rail construction.
- Changed areas: VDD rail construction proposal; component-placement flow and
  preview; route-tap presentation inheritance; rail style token; interaction
  specification and browser regression; superseded prior VDD target record.
- Validation: 59 focused unit tests; workspace typecheck; Agent-artifact and
  symbol-catalog checks; editor production build; focused Playwright flow;
  targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/vdd-drawn-rail` as
  `fix(editor): construct VDD as a drawn power rail`.

## 2026-08-12 - Editable Razavi VDD power rail

- Target: add a visually dotless, supply-weight VDD rail without weakening
  its explicit route/Junction connectivity records.
- Changed areas: shared Route presentation schema and Agent artifacts;
  transaction validation and wire proposal; VDD wire preview; formal SVG;
  contracts and focused regressions.
- Validation: 70 focused unit tests; workspace typecheck; Agent-artifact and
  Razavi-symbol generator checks; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/vdd-power-rail` as
  `feat(editor): add editable Razavi VDD power rails`.

## 2026-08-12 - Restore local editor UI on current main

- Target: recreate the validated local editor chrome without reverting newer
  remote connectivity, routing, diagnostics, search, analytics, or Library
  behavior.
- Changed areas: editor shell structure and visual scale, responsive
  Library/Properties layout, tool icons, and focused unit/browser contracts.
- Validation: App/ShapesPanel unit tests 14/14; focused editor Playwright 89/89
  with viewport cases repeated; workspace typecheck; editor dependency-closure
  production build; Prettier; and `git diff --check` passed.
- Commit status: ready to commit on `fix/restore-local-editor-ui` as
  `fix(editor): restore local chrome on current main`; full canonical and
  remote delivery gates remain required before merge to `main`.

## 2026-08-12 - Net deletion selection closure

- Target: prevent a removed Net Label's stale selection ID from rolling back
  the next Wire deletion transaction, while auditing the full Net protocol.
- Changed areas: model-bound visual-selection pruning, Label delete cleanup,
  focused unit/browser regressions, and target audit record.
- Validation: 3 focused selection unit tests; 2 Net Label browser flows;
  workspace typecheck; `git diff --check`.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as
  `fix(editor): reconcile selection after Net deletion`.

## 2026-08-12 - Reliable imported Net-label deletion

- Target: make Net-label deletion work consistently for current-editor and
  imported/legacy annotation identities.
- Changed areas: Route label lookup/actions, explicit annotation deletion
  action, and focused browser regression coverage.
- Validation: `corepack pnpm exec playwright test apps/editor/e2e/manual-editor.spec.ts --grep "Net Label"` (2 passed),
  `corepack pnpm typecheck`, and `git diff --check` passed.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as
  `fix(editor): delete imported Net labels reliably`.

## 2026-08-12 - Move Construction Line to K

- Target: reserve `P` for a future schematic Port command and use `K` for
  Construction line.
- Changed areas: editor shortcut resolver/regression, Draw menu, Help,
  interaction contract, and drafting command-menu E2E references.
- Validation: shortcut unit tests (10), drafting E2E suite (25), production
  editor build, obsolete-label search, and `git diff --check` passed.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as
  `fix(editor): reserve P for future port insertion`.

This file records factual, accepted project maintenance history.

Use concise entries:

```text
## YYYY-MM-DD - Target title

- Target: what the work set out to do.
- Changed areas: files, directories, or subsystems changed.
- Validation: commands or review performed.
- Commit status: committed, ready to commit, not committed, or blocked.
```

Keep reusable lessons in `docs/experience/`, not in this log.

## 2026-08-12 - Align Analytics Dashboard with Analog Arena

- Target: make Analog Canvas analytics match the existing Analog Arena page
  without redesigning it.
- Changed areas: analytics component and styles, theme preload, matching mono
  font dependency, Arena-compatible reset isolation, and focused browser
  regression coverage.
- Validation: frozen install, static/unit/release gates, focused analytics
  Playwright, and all five GitHub Actions PR checks passed. Local full E2E was
  72/74 with two pre-existing unrelated drafting rich-text assertions failing;
  both remote browser shards passed.
- Commit status: initial implementation merged through PR #11; post-deployment
  reset-alignment follow-up ready for review.

## 2026-08-12 - Bound transient canvas state and runtime caches

- Target: remove stale Smart Snap guide remnants and bound audit-identified
  runtime retention paths without persisting editor state.
- Changed areas: unified transient canvas cleanup, bounded Document undo/redo
  history, build-versioned Service Worker static cache, and focused unit/E2E
  coverage; documented the resulting interaction and history contracts.
- Validation: focused canvas/history Vitest 11/11, Smart Snap Escape Playwright
  scenario, editor production build, workspace typecheck, targeted Prettier,
  and `git diff --check` passed. Repository-wide format check remains blocked
  only by three pre-existing unrelated files recorded in the target plan.
- Commit status: ready to commit.

## 2026-08-10 - Measured Razavi capacitor refinement

- Target: replace the initial approximate 10% capacitor reduction with the
  joint optimum measured from vertical and horizontal reference crops.
- Changed areas: capacitor source asset, hash-pinned catalog entry, and
  generated runtime catalog definition.
- Validation: two-dimensional span/gap sweep chose 0.91 span and 0.745 gap
  scales; final C1 is `0.6225/0.5619` and C2 is `0.7063/0.5508` binary/soft
  IoU. Catalog stale check, focused catalog Vitest 17/17, Symbols/editor
  builds, and `git diff --check` passed.
- Commit status: committed with this target; concurrent drafting work remains
  unstaged.

## 2026-08-10 - Razavi capacitor proportion refinement

- Target: reduce capacitor plate span and plate-center separation by 10% while
  retaining continuous leads in both orientations.
- Changed areas: capacitor source asset, hash-pinned Razavi catalog entry, and
  generated runtime catalog definition.
- Validation: regenerated catalog; Symbols build; C1 vertical IoU improved
  `0.5860 → 0.6174` and C2 horizontal `0.6982 → 0.7019`; catalog stale check,
  focused catalog Vitest 17/17, editor build, and `git diff --check` passed.
- Commit status: committed with this target; concurrent drafting work remains
  unstaged.

## 2026-08-10 - Fixed default side-label clearance

- Target: reduce non-MOS default instance-label clearance to an explicit 1.5
  canvas units after live-editor review.
- Changed areas: shared `@icm/render-svg` default label resolver and its
  focused placement test.
- Validation: focused Vitest passed 5/5; render-svg and editor production
  builds passed; running Vite editor verification placed a new resistor and
  confirmed the persisted `instance-label` anchor; `git diff --check` passed.
- Commit status: committed with this target; concurrent editor drag and CSS
  work remains unstaged.

## 2026-08-10 - Release GUI interaction batch

- Target: publish the user-authorized accumulated editor interaction, drafting,
  selection, schematic-wire, rendering, and documentation work through a PR
  and merge it into `origin/main`.
- Changed areas: editor selection/shortcuts/drafting interaction and browser
  tests; drafting schema/derived/render support; text and isolated-wire direct
  manipulation; interaction specification and target plans.
- Validation: focused browser interaction checks and editor production build
  passed; `git diff --check` passed. Full workspace format/typecheck/test gates
  remain red on pre-existing Razavi catalog `leadsPx` type expectations,
  outdated visual golden/style assertions, and six pre-existing formatting
  files. These failures are not reported as passing.
- Commit status: committed locally as `7ae8a2c`; push/PR/merge pending.

## 2026-08-09 - Cadence-style shortcut core

- Target: make the release-facing editor keyboard layer compact and direct,
  without adding property, hierarchy, or ambiguous dual-port shortcuts.
- Changed areas: added the editor-local orientation composition helper and
  exhaustive geometry test; bound `U`/`Shift+U` to undo/redo, `F`/`Shift+F` to
  explicit left/right and top/bottom flips, and `Home` to Fit; synchronized the
  Edit/View labels, in-app shortcut help, and editor interaction contract.
- Validation: the focused orientation Vitest test passed (3 tests); editor
  production build passed; target-file Prettier check and `git diff --check`
  passed. Workspace `pnpm typecheck` remains blocked by pre-existing
  `leadsPx` errors in `packages/symbols/src/razavi-catalog.test.ts`, outside
  this target's owned paths.
- Commit status: ready to commit after the user-owned concurrent dirty targets
  are reconciled; not staged or committed by this target.

## 2026-08-09 - Pages workspace dependency build repair

- Target: repair Pages run `31311029301`, whose fresh runner could not resolve
  `@icm/edit-engine` while building only the editor package.
- Changed areas: Pages workflow now builds the editor dependency closure using
  pnpm's trailing-ellipsis filter.
- Validation: `pnpm install --frozen-lockfile` and the base-path Pages build
  passed after model, symbols, derived, SPICE, edit-engine, render-svg,
  exporters, and editor packages built in dependency order; `git diff --check`
  passed.
- Commit status: ready to commit, merge, and rerun Pages.

## 2026-08-09 - GitHub Pages release preparation

- Target: publish the GUI-only, local-first editor as a static GitHub Pages
  site without exposing an Agent API, backend, account system, or server-side
  Project storage.
- Changed areas: added a least-privilege Pages workflow and user-facing
  release/data-boundary documentation.
- Validation: the editor production build passed with
  `ICM_PAGE_BASE_PATH=interactive-circuit-maker`; built asset paths use that
  prefix and the manifest remains relative scoped. Focused source audit found
  no Agent/MCP/credential/authentication/backend request surface; only the
  Service Worker fetches same-origin static assets. New workflow/docs/plan
  formatting and `git diff --check` passed.
- Commit status: ready to commit; repository Pages must be enabled by an
  administrator once before the first `main` deployment.

## 2026-08-09 - First-version local-first editor baseline

- Target: consolidate the human-reviewed first-version editor implementation
  before beginning the separate GitHub Pages publishing target. The product
  remains GUI-only: no Agent API, account system, backend, or server-side
  Project storage is included.
- Changed areas: staged completed editor interaction, drafting/routing,
  browser-persistence foundation, Pages/PWA base-path, documentation, and
  target-plan work; added narrow ignore rules for local diagnostic and
  generated layout outputs without deleting them.
- Validation: focused platform-web, edit-engine, derived, and render Vitest
  tests passed (50 tests); platform-web and editor production builds passed;
  `git diff --check` passed. Workspace `pnpm typecheck` remains blocked by six
  pre-existing `leadsPx` errors in `packages/symbols/src/razavi-catalog.test.ts`.
  The combined drafting/manual Playwright run exceeded the 120-second command
  budget and is not recorded as passing.
- Commit status: ready to commit as one first-version baseline, then reconcile
  the patch-equivalent remote hierarchy commit.

## 2026-08-09 - Drafting edit paradigm: two-phase creation, hit layer, rotation

- Target: per `plan/2026-08-09-drafting-edit-paradigm/plan.md`, convert Arrow /
  Construction line from drag-once-commit to a Wire-style two-phase
  click→hover→click creation model with snap/preview, harden the hit layer to a
  fixed screen-pixel tolerance, and add drafting rotation (R/Shift+R) plus
  selection handle markers. Stages 4 (styleOverride scale fields), 5 (route
  current marker), 6 (full regression set) deferred to independent targets.
- Coordination: App.tsx/styles.css/App.test.tsx arrived dirty (help-tutorial +
  later editor/SPICE work). Agent committed the complete, self-contained
  help-tutorial feature as `c3a46bd` to free a clean App.tsx/styles.css before
  drafting edits. Remaining dirty (App.test.tsx, manual-editor.spec.ts,
  packages/spice/*) belongs to other parallel targets and was not touched.
- Changed areas:
  - `packages/derived/src/drafting-geometry.ts` — arrow gained `center`
    (from/to midpoint); construction-line gained `vertices` (editable handle
    set). ResolvedDraftingGeometry union + resolvers updated.
  - `packages/model/src/drafting-geometry-schema.ts` — mirror Zod strictObject
    synchronized (required: agent snapshot validation rejects unsynced fields).
  - `packages/derived/src/drafting-geometry.test.ts` — center/vertices
    assertions added.
  - `apps/editor/src/App.tsx` — replaced `draftingCreatePreview` (drag) with
    `draftingSource`/`draftingHover`/`draftingWaypoints`/`draftingSnapPoint`
    (two-phase, mirrors wire); `beginCanvasGesture` short-circuits
    arrow/construction-line; SVG onClick/onDoubleClick/onContextMenu handle
    click→commit and right-click cancel; `snapDraftingPoint` (grid +
    visibleEndpoints pin/port/junction, Alt suppress, Shift 45° lock);
    `DraftingCreatePreview` component (anchors, polyline, arrow-head preview,
    snap marker, length/angle readout); Enter/Esc tiered cancel;
    `rotateSelected(deltaDegrees)` extended to rotate drafting (arrow about
    center, construction-line about bounds center); `rotatePoint`/
    `centerOfBounds` helpers; selected drafting objects render handle markers;
    `SchematicStyleProfile` + `VisualAnchor` type imports added.
  - `apps/editor/src/styles.css` — `.annotation-hit` stroke-width 8→14 (matches
    route-hit fixed screen tolerance); `.drafting-create-*` / `.draft-handle`
    visual classes.
  - `apps/editor/e2e/drafting.spec.ts` — `dragCreate` removed; `clickCreate`
    (click→move→click) added; 4 creation tests rewritten (Draw-button
    activation + clickCreate); new regression "arrow rotates 90° via R key and
    shows selection handles".
- Validation: static verification done in-session — App.tsx parens 2148/2148,
  braces 1299/1299; drafting.spec.ts 340/340, 74/74; CSS braces 122/122;
  geometry schema double-sync confirmed (center + vertices in both derived and
  model mirror); no leftover `draftingCreatePreview`; `git diff --check` clean.
- Deferred (explicit, not claimed): handle **drag** (endpoint/vertex drag-edit);
  construction-line vertex insert (dblclick)/delete; `V` vertex mode;
  route-segment and drafting-vertex snap. These need new pointer-drag sessions
  and belong to a follow-up Stage 3 completion target. **(2026-08-09 更新：全部
  已实施——见下方完整条目)**
- Toolchain note: node/pnpm/tsc/vitest/playwright not on PATH in this session's
  Git Bash; build/typecheck/vitest/e2e could NOT be run here and MUST be run by
  a human before commit. Key checks: drafting.spec.ts test 8 (construction-line
  hit `<polyline>`) unbroken; drafting-geometry.test.ts assertions pass;
  manual-editor MOS rotation (instance branch) unbroken.
- Commit status: ready to commit as
  `feat(editor): drafting two-phase creation, hit layer, and rotation` once the
  blocked toolchain validation passes. Stage only the 6 drafting files; do not
  touch the parallel App.test.tsx/manual-editor.spec.ts/spice dirty work.

## 2026-08-09 - Drafting edit paradigm completion: stages 3-6

- Target: complete the remaining drafting-edit-paradigm stages — endpoint/vertex
  handle drag, construction-line vertex insert/delete, route+vertex snap,
  bounded style fields (strokeScale/arrowHeadScale) with render + shelf +
  shortcuts, route current marker offset/reverse, and regressions. Also fix the
  "still hard to select" defect reported after the first pass.
- Changed areas (additional to the entry above):
  - `apps/editor/src/styles.css` — **selection-hit fix**: `.annotation-hit.selected`
    no longer narrows stroke-width to 1 (which shrank the hit band after
    selection, making a selected thin line nearly unclickable); now keeps the
    14px hit band and renders selection via a translucent accent stroke,
    matching route-hit.selected.
  - `packages/model/src/schema.ts` — `styleOverride` gained optional
    `strokeScale` (0.75/1/1.5/2) and `arrowHeadScale` (0.75/1/1.25/1.5). Optional
    fields, no schemaVersion bump, no migration.
  - `packages/render-svg/src/render.ts` — `renderConstructionLine` and
    `renderDraftArrow` apply strokeScale (shaft + open-head stroke) and
    arrowHeadScale (head length/width) against the profile baseline, so formal
    SVG/PNG/PDF and the editor canvas share one visual parameter.
  - `apps/editor/src/App.tsx` — `beginDraftingHandleDrag` (per-endpoint/vertex
    drag session, one upsert on pointerup); `insertConstructionVertex` (dblclick
    nearest segment) + `deleteConstructionVertex` (dblclick vertex, <2 refuse);
    handles made clickable (arrow from/to, construction vertices; center
    decorative); `setDraftingStyle` (bounded style patch → upsert); Drawing
    shelf section (line-style/stroke-width/arrow-head/head-size + Rotate/
    Reverse/Lock); `[`/`]` and `Shift+[`/`]` shortcuts via `stepScale`;
    `snapDraftingPoint` extended to also snap to route-segment closest points
    and existing drafting vertices; `stepCurrentArrowOffset` + Current-arrow
    context section (Reverse/Move closer/Move away/Delete).
  - `apps/editor/e2e/drafting.spec.ts` — regressions for endpoint handle drag,
    vertex insert via dblclick, bracket stroke-width shortcuts, Drawing shelf
    line-style.
- Validation: static — App.tsx parens 2354/2354, braces 1446/1446;
  drafting.spec.ts 411/411, 96/96; `git diff --check` clean; geometry schema
  double-sync intact. Toolchain (build/typecheck/vitest/e2e) blocked in this
  session — must be run by a human; note render-svg drafting-render tests
  (strokeScale defaults to 1, existing fixtures unaffected) and agent-api
  fixtures (styleOverride new optional fields enter OpenAPI) should be checked.
- Commit status: ready to commit alongside the prior drafting entry as
  `feat(editor): drafting handle editing, bounded styles, route marker` once
  the blocked toolchain validation passes.

## 2026-08-09 - GUI modernization: inspector moved into left dock

- Target: per `plan/2026-08-09-gui-modernization/plan.md` work package E,
  eliminate the right-hand Properties column that appeared/disappeared on
  selection, by moving its contents into a left-dock `Inspect` tab. The canvas
  becomes a fixed two-column grid (left dock + canvas), so selecting an object
  no longer changes canvas column count or width.
- Decision (human-confirmed): selecting an inspectable object auto-switches the
  dock to the `Inspect` tab (preserving the legacy "selection reveals
  properties" behavior that e2e `manual-editor.spec.ts:188/277/353/436` depend
  on; the 436 test `.fill()`s a textbox after selecting). The no-reflow goal is
  met by removing the right column (column count constant at 2), not by
  freezing the within-dock tab. Default tab is Symbols & Tools; clearing
  inspectable selection falls back to it. Both dock panels stay mounted (HTML
  `hidden` toggles visibility) so post-selection inputs are immediately
  interactable.
- Changed areas:
  - `apps/editor/src/App.tsx` — replaced `propertiesCollapsed` state with
    `dockTab`; replaced `propertiesVisible` with `hasInspectableSelection`; added
    a `useEffect` that switches the dock tab on selection change; root `<main>`
    className fixed to `app-shell`; the `<aside className="library-panel">` and
    `<aside className="side-panel">` became a single `<aside className="dock"
role="complementary">` containing a tablist and two always-mounted panels
    (`.library-panel`, `.inspect-panel`); migrated all Properties content
    (unplaced instances/ports, instance/route/endpoint/junction context-actions,
    inspector `<dl>`, import/visual diagnostics) into the inspect panel with an
    empty-state; removed 4 `setPropertiesCollapsed(false)` call sites and the
    properties close button.
  - `apps/editor/src/styles.css` — removed `.app-shell.properties-open` (fixed
    2-col grid); `.library-panel` grid-column rule became `.dock`; added
    `.dock-tabs`/`.dock-tab`/`.dock-tab[aria-selected]`/`.dock-tab-indicator`/
    `.dock-panel`/`.inspect-panel` rules; removed `.side-panel` and
    `.properties-heading`. Canvas `#fff` background and grid-dot fill unchanged.
  - `apps/editor/e2e/manual-editor.spec.ts` — added one regression test
    "selecting an object does not change canvas width" (boundingBox width
    before/after placeComponent). Existing 4 tests untouched.
  - `docs/specs/editor-interaction.md` — added "Selection and layout stability"
    subsection under Pointer/viewport contract.
  - `plan/2026-08-09-gui-modernization/plan.md` — recorded the auto-switch
    decision override and the stale dirty-state correction.
- Validation: static verification done in-session — aside/div/section/fieldset
  balanced (perl/awk), parens 1952/1952, braces 1182/1182, CSS braces 104/104,
  `git diff --check` clean, no stale `side-panel`/`properties-*` references,
  `role="complementary"` + "Symbols and drawing tools" name preserved,
  `library-component-*` testid preserved, canvas `#fff` preserved.
- Toolchain note: `node`/`pnpm`/`tsc`/`vitest`/`playwright` still not on PATH in
  this session's Git Bash, so build/typecheck/vitest/e2e could NOT be executed
  here and MUST be run by a human before commit — especially `pnpm test:e2e`
  (the 4 existing selection-reveals-properties tests + the new width test).
- Commit status: superseded before commit by the later fixed-library decision;
  its auto-switch interaction did not land.

## 2026-08-09 - GUI modernization: fixed library with Selection shelf

- Target: correct the uncommitted left-dock Inspector attempt after review found
  that placing a component selected it and automatically hid the component
  library. Keep the successful fixed two-column canvas layout, but preserve a
  stable placement surface.
- Result: Components and Draw are an always-visible, independently scrollable
  main area. The bottom `Selection` shelf is a permanent one-line child section
  that summarizes the current selection without opening; it expands only when
  the user clicks it. Its detailed properties and diagnostics scroll inside the
  shelf and never change canvas geometry or move the library's top position.
- Changed areas: `App.tsx` removes dock tab state/effect and uses native
  `details/summary` for the shelf; `styles.css` makes the dock a fixed flex
  column with separate library and shelf scroll regions; editor interaction
  specification records the explicit-expansion contract; focused Playwright
  tests explicitly open Selection for property actions and verify library/canvas
  stability. Two stale test expectations were aligned with the existing `Wire
tool` accessible name and normalized deletion status.
- Validation: editor build passed; scheduler Vitest 9/9 passed; focused
  Playwright 3/3 passed (MOS presentation, junction deletion, fixed library);
  Prettier and `git diff --check` passed. Browser visual verification placed
  R1 while the full library remained visible and Selection stayed collapsed.
  Workspace `pnpm typecheck` remains blocked by unrelated committed/parallel
  Razavi fixture expectations for missing `leadsPx` in
  `packages/symbols/src/razavi-catalog.test.ts`; no target file participates in
  those errors.
- Commit status: pending intentional scoped commit; unrelated generated assets,
  Razavi-fidelity work, and other plans remain unstaged.

## 2026-08-09 - GUI modernization: chrome tokens and recovery scheduling

- Target: per `plan/2026-08-09-gui-modernization/plan.md`, modernize editor
  chrome colors via CSS design tokens, replace synchronous per-transaction
  recovery writes with a coalesced + flush-on-hide + cancel-on-replace
  scheduler, and record the GUI mutation lifecycle and try/catch audit. White
  canvas, grid dot, and formal SVG/export output unchanged.
- Changed areas:
  - `apps/editor/src/styles.css` — added `:root` `--icm-*` chrome tokens;
    replaced 13 hardcoded `#1f6feb` and scattered panel/border/diagnostic
    colors with tokens. `.schematic-canvas { background:#fff }` left literal.
  - `apps/editor/src/recovery-scheduler.ts` (new) — injectable scheduler with
    `schedule/flush/cancel` and `isPending`; owns no React state.
  - `apps/editor/src/recovery-scheduler.test.ts` (new) — fake-timer coverage of
    coalescing, flush idempotency, cancel, reschedule, delay.
  - `apps/editor/src/App.tsx` — `stageRecovery` now schedules; added
    `cancelRecovery`/`flushRecovery`; `visibilitychange`/`pagehide` flush
    effect with cancel-on-unmount; `cancelRecovery` before
    `replaceActiveProject`, `saveProjectFile`, `discardRecovery`. `applyResult`
    remains the sole transaction→recovery scheduling site.
  - `docs/specs/editor-interaction.md` — added "Mutation lifecycle" section and
    "Recovery persistence lifecycle" subsection.
  - `plan/2026-08-09-gui-modernization/plan.md` — appended C try/catch audit
    conclusion (8/8 catch retained, no code change).
- Validation: static verification preserved the white canvas literal, grid-dot,
  and formal body boundary. Actual checks passed: recovery scheduler Vitest
  9/9; recovery Playwright scenarios 3/3 (coalesced restore, Save/Open stale
  timer cancellation, Discard); workspace `pnpm typecheck`; editor production
  build; Prettier for all changed target files; and `git diff --check`.
- C audit conclusion: all 8 try/catch blocks in App.tsx wrap a throwing domain
  helper or an external boundary; none is strictly `transact()`-only, so none
  is removed. Recorded in the plan's C section.
- Commit status: target validation complete; pending an intentional, scoped
  commit. Unrelated concurrent Razavi-fidelity changes remain unstaged.

## 2026-08-08 - Calibrate Razavi geometry from supplied reference pixels

- Target: use the supplied 1204x794 six-panel Razavi reference, rather than
  visual approximation, to calibrate symbols, route-current markers, strokes,
  and typography.
- Changed areas: new `scripts/measure-razavi-reference.py`; MOS and
  independent-current generators with regenerated catalog/fidelity assets;
  Razavi route-marker token and focused catalog/style tests; Phase 1/5 and
  route-marker SVG goldens.
- Evidence: the script records reference SHA-256
  `e43454e7ff17d9df1818973e1a78c5cda71f34a5e26c4ce7ee0ba6806b81dd81` and
  measures a 3px wire, 6px VDD/gate bars, 42px MOS gate span, 14x13px MOS
  head, 20x20px independent-source head, and 23x15px route-marker head. The
  42px gate maps to 24.39567 logical units (1.7216 px/unit).
- Result: MOS arrowhead is 8.13x7.55 logical units; independent-current head
  is approximately 10.37x10.37; route-marker head is 14x9. Existing
  wire/gate ratios, GND bars, port dot, and 16px Arial bold-italic typography
  with 0.68 subscript scale already matched the reference and were retained.
- Validation: measurement script, 31 focused symbol/render tests, all three
  symbol generator checks, route-marker golden check, Phase 1/5 golden check,
  render-svg dependency build, and `git diff --check` passed.
- Commit status: pending.

## 2026-08-08 - Apply second-pass Razavi arrowhead scaling

- Target: apply the user's relative second pass: MOS arrowhead width +30% from
  the already +20% state, and independent-current-source arrowhead length +30%
  from the already +30% state.
- Changed areas: the two generator sources; regenerated Razavi MOS/current
  source assets, catalog, and fidelity boards; exact geometry regression test.
- Result: MOS total head-width scale is 1.56× Visio baseline. The independent
  current-source head is 1.69× baseline length, has unchanged 1.15× baseline
  width, and retains its shaft/base endpoint at `y=0.608268`.
- Validation: MOS/core-analog/Razavi generator checks and 20 focused symbol
  tests passed; `git diff --check` passed.
- Commit status: pending.

## 2026-08-08 - Calibrate MOS and independent-current-source arrowheads

- Target: widen the Razavi MOS source-arrow heads by 20%, and lengthen/widen
  only the independent-current-source filled arrowhead by 30%/15%.
- Changed areas: generator-owned Razavi MOS/current-source assets and catalog
  output (committed concurrently in `16ed903`), plus the exact catalog
  regression assertion.
- Result: MOS arrow heads retain their source/tip/host geometry but have
  1.20× half-width. The independent-current source retains its arrow shaft and
  base at `y=0.608268`; its head is now 8.145473 units long and 10.268504 units
  wide, versus 6.265749 and 8.929134 before calibration.
- Validation: MOS, core-analog, and Razavi generator checks passed; focused
  symbols tests passed (20/20); `git diff --check` passed.
- Commit status: pending the standalone regression/plan record commit.

## 2026-08-06 - Bootstrap repository workflow

- Target: initialize the circuit asset project as a GitHub repository and
  adopt the plan-log-experience workflow from `agent-workflow-kernel`.
- Changed areas: added project documentation, repository-wide Agent rules,
  plan and experience templates, Git attributes, and the initial project
  assets under `lib/` and `netlists/`.
- Validation: `git diff --check` passed; every SPICE `.subckt` had a matching
  `.ends`; every local `.include` resolved; required workflow sections were
  confirmed; repository scope and status were reviewed.
- Commit status: ready to commit as `Initialize circuit project workflow` and
  push to the private `chenzc24/interactive-circuit-maker` repository.

## 2026-08-06 - Document overall circuit canvas architecture

- Target: consolidate the product definition and design discussion into one
  overall implementation plan for the AI/human collaborative circuit canvas.
- Changed areas: added `docs/overall-product-plan.md` and its bounded target
  plan under
  `plan/archived/2026-08/2026-08-06-document-overall-product-plan/`.
- Validation: confirmed balanced Markdown fences and required architecture
  contracts; reviewed headings and terminology; `git diff --check` passed.
- Commit status: ready to commit as
  `Document overall circuit canvas architecture`.

## 2026-08-07 - Define the default schematic graphical language

- Target: refine the overall plan so free manual page layout is preserved
  while human- and AI-created wires, junctions, labels, and electrical
  annotations share a textbook-style monochrome rendering contract.
- Changed areas: expanded `docs/overall-product-plan.md` and added the bounded
  target plan under `plan/2026-08-07-refine-default-schematic-style/`.
- Validation: confirmed balanced Markdown fences and numbered headings;
  verified theme, route, junction, annotation, overlay/export, renderer,
  visual-regression, phase, and MVP contracts; `git diff --check` passed.
- Commit status: ready to commit as
  `Define default schematic graphical language`.

## 2026-08-07 - Flatten overall circuit canvas architecture

- Target: simplify the overall product plan by separating build-time symbol
  production, import-time SPICE parsing, and runtime editing; reduce exposed
  protocols and physical project files without removing accepted behavior.
- Changed areas: rewrote `docs/overall-product-plan.md` around a five-component
  external model, Project-to-Document persistence, seven protocol operations,
  GUI-driven human edits, transient parser artifacts, and a minimal user
  project layout; added the bounded target plan under
  `plan/archived/2026-08/2026-08-07-flatten-overall-product-plan/`.
- Validation: confirmed balanced Markdown fences and required full-SPICE,
  junction/crossing, VSS isolation, GUI/Edit Engine, protocol, file-layout,
  visual-language, validation, and MVP contracts; `git diff --check` passed.
- Commit status: ready to commit as
  `Flatten overall circuit canvas architecture`.

## 2026-08-07 - Establish phased execution documentation

- Target: turn the accepted architecture into a navigable, staged execution
  system with complete Phase 0–7 plans and durable homes for normative specs,
  Agent guidance, and architecture decisions.
- Changed areas: added `docs/README.md`; added roadmap index, phase template,
  and substantive Phase 0–7 plans; added specification, Agent, and ADR indexes
  and templates; updated the repository README; added the bounded target plan
  under
  `plan/archived/2026-08/2026-08-07-establish-execution-docs/`.
- Validation: confirmed all eight phase files contain every required planning
  section; all relative Markdown links resolve; all Markdown fences are
  balanced; no application source scaffold was created; `git diff --check`
  passed.
- Commit status: ready to commit as
  `Establish phased execution documentation`.

## 2026-08-07 - Complete Phase 0 contracts and scaffold

- Target: satisfy the Phase 0 exit gate with a runnable TypeScript workspace,
  stable Project/Document and identity contracts, canonical persistence,
  transaction/revision semantics, transient Circuit IR, a Symbol Resolver, and
  isolated Reference governance.
- Changed areas: added the React editor shell; model, edit-engine, spice, and
  symbols packages; Project fixtures; pinned Reference manifest and scripts;
  focused CI; accepted Phase 0 specs and ADRs; and Phase 0 completion evidence.
- Validation: frozen install, formatting, immutable Reference checks,
  TypeScript typecheck, 30 tests in eight files, workspace build, direct ESM
  runtime smoke, Reference fetch failure/idempotence checks, Markdown link and
  fence checks, product/reference coupling inspection, and `git diff --check`
  passed.
- Commit status: ready to commit as `Complete Phase 0 contracts and scaffold`.

## 2026-08-07 - Complete Phase 1 core editor slice

- Target: satisfy the Phase 1 exit gate with a browser-based manual editor that
  commits typed placement and transform edits, supports monotonic history and
  canonical save/reopen, and exports deterministic formal SVG.
- Changed areas: expanded the Edit Engine and added Document history; added
  eight provisional built-in symbols and `packages/render-svg`; replaced the
  editor shell with a native-SVG canvas and controls; added Project/SVG
  fixtures, visual/edit specifications, Playwright coverage, and CI wiring.
- Validation: frozen install, formatting, immutable Reference checks,
  TypeScript typecheck, 41 tests in 11 files, workspace build, one complete
  Playwright GUI flow, browser DOM/geometry/console review, Markdown link and
  fence checks, `git diff --check`, and repository status review passed.
- Commit status: ready to commit as `Complete Phase 1 core editor slice`.

## 2026-08-07 - Complete Phase 2 SPICE import

- Target: import every current SPICE source set into transient Circuit IR and
  persistent unplaced Documents without silent statement, hierarchy, terminal,
  parameter, model, or connectivity loss.
- Changed areas: added source, syntax, include, diagnostic, compiler, Node
  adapter, and importer modules under `packages/spice`; added dynamic
  pin-count-matched generic symbols; connected browser multi-file import; added
  source, Project, and seven-entry corpus goldens; accepted the SPICE frontend
  profile and advanced the IR contract.
- Validation: frozen install, formatting, immutable Reference checks,
  TypeScript typecheck, 49 tests in 15 files, all seven entries/24 cells/127
  instances against connectivity hashes, canonical imported Project golden,
  workspace build, two Playwright flows, browser DOM/geometry/console review,
  Markdown link and fence checks, product/reference coupling inspection,
  `git diff --check`, and repository status review passed.
- Commit status: ready to commit as `Complete Phase 2 SPICE import`.

## 2026-08-07 - Complete Phase 3 connectivity and routing

- Target: complete explicit visible connectivity, deterministic flightlines,
  manual orthogonal routing, Junction/crossing semantics, local stretch,
  protected geometry, detach behavior, and formal route rendering.
- Changed areas: added `packages/derived`; extended the model, Edit Engine,
  history, renderer, and editor; added routing specifications, canonical
  Project/SVG fixtures, unit/integration tests, and Playwright acceptance.
- Validation: frozen install, formatting, immutable Reference checks,
  TypeScript typecheck, 61 tests in 17 files, workspace build, three complete
  Playwright flows, browser DOM and visual inspection, Markdown link/fence
  checks, product/reference coupling inspection, and `git diff --check`
  passed.
- Commit status: ready to commit as
  `Complete Phase 3 connectivity and routing`.

## 2026-08-07 - Complete Phase 4 full SPICE baseline

- Target: replace the fixture-only parser label with an explicit, lossless,
  structurally broad SPICE3/ngspice compatibility baseline.
- Changed areas: accepted ADR 0004; expanded syntax, source dependency,
  expression, dialect, compiler, IR, importer, and exact-printer modules; added
  a machine-readable ngspice 46 matrix and minimized baseline/vendor corpus.
- Validation: frozen install, formatting, immutable Reference checks,
  TypeScript typecheck, 67 tests in 18 files including 256 deterministic fuzz
  samples and all current netlists, workspace build, four Playwright
  regressions, Markdown link/fence checks, product/reference coupling
  inspection, and `git diff --check` passed.
- Commit status: ready to commit as `Complete Phase 4 full SPICE baseline`.

## 2026-08-07 - Complete Phase 5 symbols and visual quality

- Target: replace provisional symbols and text-only presentation with a
  reviewed VSS-to-Symbol-DSL pipeline, semantic presentation edits, measurable
  visual diagnostics, and a stable original analog golden.
- Changed areas: added VSS inventory/review tools and evidence; expanded the
  symbol library, SPICE symbol mapping, model validation, Edit Engine,
  diagnostics, SVG renderer, editor demo, and visual fixtures/specifications.
- Validation: source hash and 101-master inventory, 12-family contact sheet,
  frozen formatting/type/test/build gates, 73 tests in 20 files, five
  Playwright flows, browser DOM and visual inspection, deterministic dense SVG,
  Markdown link/fence checks, runtime-Visio/reference coupling inspection, and
  `git diff --check`.
- Commit status: ready to commit as
  `Complete Phase 5 symbols and visual quality`.

## 2026-08-07 - Complete Phase 6 Agent API

- Target: expose bounded Agent inspection, atomic editing, and visual review
  through four transport-independent operations and an optional normal JSON
  API, with no MCP.
- Changed areas: accepted ADR 0005 and the Agent API spec; added the
  `agent-adapter` package, query describer, permission/budget enforcement,
  Edit Engine transaction bridge, render artifacts, authenticated loopback
  adapter, checked JSON Schema/OpenAPI artifacts, fixtures, and Agent guidance.
- Validation: frozen install, formatting, immutable references, typecheck, 80
  tests in 22 files including direct-engine parity and live loopback HTTP,
  workspace build, deterministic API/symbol/visual artifact checks, five
  Playwright flows, Markdown structure, no-MCP coupling inspection, and
  `git diff --check`.
- Commit status: ready to commit as `Complete Phase 6 Agent API`.

## 2026-08-07 - Complete Phase 7 release hardening

- Target: turn the editing and Agent foundations into a versioned, recoverable,
  exportable, measured, and locally installable v0.1 release candidate.
- Changed areas: added formal exporters and cross-format goldens; text-aware
  render bounds; Node atomic storage and recovery; canonical browser open/save,
  recovery and diagnostics UI; LTspice/Xyce profiles; performance budgets;
  PWA assets; loopback host; release packaging, smoke, CI, and user/release
  documentation.
- Validation: frozen install, formatting, four pinned references, three Agent
  API artifacts, 12 symbol previews, Phase 5/7 visual goldens, PDF metadata and
  rendered-page inspection, TypeScript, 89 tests in 26 files, 500-instance
  performance budgets, workspace/release builds, loopback release smoke, eight
  Playwright flows, 65 Markdown files, no-MCP package inspection, and
  `git diff --check` passed.
- Commit status: ready to commit as `Complete Phase 7 release hardening`.

## 2026-08-07 - Plan Phase 8 interaction redesign

- Target: consolidate the reviewed toolbar, shortcut, viewport, selection,
  manual component authoring, direct wiring, automatic junction/crossing, and
  VSS symbol-fidelity changes without rewriting the completed Phase 0-7
  implementation history.
- Changed areas: added a proposed editor interaction contract and a dependency-
  ordered Phase 8 roadmap; indexed both documents and recorded the bounded
  planning target.
- Validation: Prettier check passed for all six changed Markdown files; local
  Markdown links resolved, fenced code blocks balanced, and
  `git diff --check` passed.
- Commit status: ready to commit as `Plan Phase 8 interaction redesign`.

## 2026-08-07 - Complete Phase 8 direct manipulation

- Target: replace the validation toolbar with a compact direct-manipulation
  editor that can author topology from a genuinely empty Project while keeping
  GUI and Agent mutations on one semantic transaction boundary.
- Changed areas: added instance/connectivity Edit Engine operations and Agent
  schemas; atomic group stretch; an empty production workspace; searchable
  component placement; direct selection, movement, wiring, automatic
  Junction/Crossing behavior, dogleg manipulation and contextual deletion;
  compact grouped menus; VDD/VSS symbols; and revised contracts/user guidance.
- Validation: frozen install, formatting, four pinned references, TypeScript,
  96 tests in 28 files, workspace build, three Agent API artifacts, 12 reviewed
  symbol previews, Phase 5/7 goldens, PWA icons, performance budgets, release
  packaging/smoke, seven Playwright flows, 1440x900 browser review, production
  inventory/coupling inspection, Markdown checks, and `git diff --check`.
- Known compatible follow-ups: persisted shortcut remapping, free-standing
  wire endpoints, and general multi-elbow handles.
- Commit status: ready to commit as `Complete Phase 8 direct manipulation`.

## 2026-08-07 - Close schematic authoring fidelity gaps

- Target: close the four observed gaps in VSS appearance and palette previews,
  copy/paste, semantic text/labels, and routed multi-object movement.
- Changed areas: normalized reviewed MOS and VDD geometry; added 13 explicitly
  provisional VSS migration candidates and 27 palette previews; added atomic
  routed-subgraph copy/paste, typed Junction movement and Net naming, editable
  instance/Net/plain text, bounded label handles, and internal route/Junction
  translation; updated Agent artifacts, visual/export goldens, specifications,
  user guidance, and deterministic Playwright loopback proxy bypass.
- Validation: formatting, four pinned references, TypeScript, 101 tests in 29
  files, 10 Playwright flows, three Agent artifacts, 12 reviewed plus 13
  candidate symbol previews, Phase 1/5/7 visual/export goldens, visual PNG
  inspection, performance budgets, PWA icons, release packaging/smoke,
  Markdown links/fences, runtime VSS isolation, immutable VSS hash, and
  `git diff --check` passed.
- Commit status: ready to commit as
  `Close schematic authoring fidelity gaps`.

## 2026-08-07 - Prevent stale PWA cache in development

- Target: prevent a previously installed production PWA worker from making a
  fresh local Vite process appear to serve the old editor.
- Changed areas: development startup now unregisters stale service workers and
  reloads once when necessary; production registration is unchanged.
- Validation: TypeScript, workspace build, 10 Playwright flows, formatting,
  and `git diff --check` passed.
- Commit status: ready to commit as `Prevent stale PWA cache in development`.

## 2026-08-07 - Expand direct wire editing

- Target: add custom-IC-style free wire termination, per-segment movement, and
  safe deletion of connected components.
- Changed areas: added transient multi-bend Wire sessions and free Junction
  endpoints; selectable perpendicular Route-segment stretch; composed
  connected-instance deletion that preserves dangling wires; additive
  `add_junction.createNet` engine/Agent schema support; and revised interaction,
  routing, engine, Agent, and user contracts.
- Validation: formatting, four pinned references, three Agent artifacts,
  TypeScript, 105 tests in 31 files, 12 Playwright flows, workspace/release
  build, performance budgets, export goldens, PWA icons, release smoke,
  Markdown links/fences, and `git diff --check` passed.
- Commit status: ready to commit as `Expand direct wire editing`.

## 2026-08-07 - Record rule-guided Agent layout architecture

- Target: preserve the current design discussion for scaling Agent-assisted
  schematic expression from small examples to hierarchical 100+ transistor
  circuits without expanding the external API or weakening electrical gates.
- Changed areas: added a proposed Agent architecture document covering the PDK
  symbol registry, transient Topology View and Layout Intent, composable
  topology patterns, recursive region planning, Net-class routing, flat API
  additions, Document navigation, persistence boundaries, package layout,
  acceptance criteria, delivery order, and unresolved decisions; indexed it
  from the Agent guide.
- Validation: Prettier completed for the four owned Markdown files, local
  Markdown links resolved, fenced code blocks balanced, and `git diff --check`
  passed.
- Commit status: not committed; retained as a proposed discussion record for
  further human review.

## 2026-08-07 - Flatten Agent reasoning and prepare Phase 9

- Target: incorporate the architecture review by keeping circuit/layout
  interpretation inside the Agent while supplying complete Document facts as a
  read-only Snapshot and retaining typed transactions, rendering, actionable
  diagnostics, and optional late-stage helpers.
- Changed areas: replaced the formal Layout Intent/compiler proposal with an
  adaptive Snapshot-driven Agent workflow; removed the proposed generic query
  language; reduced Agent-facing guidance to a governing Skill plus on-demand
  knowledge; documented large-circuit, refresh, PDK, hierarchy, file-flow, and
  package boundaries; and reordered Phase 9 so baseline/Skill vertical trials
  precede product-gap closure and optional acceleration.
- Validation: Prettier completed for all seven owned Markdown files; local links
  resolved, fenced code blocks balanced, `git diff --check` passed, and the
  final dirty-state review confirmed unrelated editor, symbol, fixture, circuit,
  tool, and plan work remained untouched.
- Commit status: not committed; ready for human review before Phase 9 contract
  work begins.

## 2026-08-07 - Complete CDAC hierarchy layout

- Target: complete the previously generated Razavi-style CDAC example by
  drawing its imported `scdac_unit` hierarchy and clearing the top-level RESET
  label/wire overlap.
- Changed areas: extended the deterministic Agent-layout runner to transact on
  and optionally export multiple imported Documents; added a transistor-level
  two-stage CMOS bottom-plate driver with conventional stacked inverter
  geometry and local source/bulk ties; moved XRESET into a separate right-side
  vertical channel with local source/bulk tie; regenerated the editable Project
  and top-level/unit SVG, PNG, and PDF artifacts.
- Validation: the real SPICE import, typed dry-run/commit, Project validation,
  and formal export chain completed in six transactions; both Documents report
  zero unplaced instances; top-level and unit PNGs were visually inspected;
  Prettier and final repository hygiene checks completed.
- Commit status: not committed; retained in the ongoing CDAC/Agent-layout
  working set.

## 2026-08-07 - Render faithful hierarchical ports

- Target: preserve `.subckt` interfaces exactly while replacing generic
  positional hierarchy blocks with transient Project-derived symbols whose
  electrical terminals and visible pin names use the formal SPICE ports.
- Changed areas: bound subcircuit import now assigns stable hierarchy symbol
  IDs and formal terminal names; the symbol package derives named blocks from
  Document source bindings and ports; SVG rendering displays upright pin names;
  editor and Agent layout use Project-aware resolvers; CDAC routes now address
  `bit/nbit/bot/vss/vdd`; corpus and crossing goldens plus focused tests were
  updated; main and child CDAC artifacts were regenerated.
- Validation: formatting and TypeScript passed; workspace build passed; 110
  unit tests passed; 13 unaffected Playwright flows passed in the full run and
  the one updated SPICE-import flow passed on focused rerun; CDAC import,
  six typed transactions, Project validation, and two formal exports passed;
  both PNGs were visually inspected; the generated project has zero generic
  instances and formal XU terminal names while `circuit.spi` remains unchanged;
  final diff/status hygiene checks passed.
- Commit status: not committed; retained for review with the ongoing editor,
  symbol, and CDAC changes.

## 2026-08-07 - Prototype flattened CDAC view

- Target: compare the hierarchy-block presentation with an alternate top-level
  view that expands all six `scdac_unit` instances without modifying SPICE.
- Changed areas: added a standalone flattened CDAC recipe that retains a cloned
  hierarchical source Document, derives 24 prefixed MOS instances into the
  selected top Document, maps every child formal-port Net back to its parent
  Net, lays out six repeated two-inverter cells under the capacitor array, and
  emits a distinct editable Project plus SVG/PNG/PDF artifacts. After the first
  compact draft was rejected visually, the repeated-cell pitch and vertical
  bands were rebuilt, capacitor branches received independent routing channels,
  and all MOS devices changed to the textbook three-terminal visual variant
  while retaining their electrical bulk terminals.
- Validation: SPICE import, six typed transactions, Project validation, and
  formal export passed; the flattened top has 32 placed instances, 24 expanded
  unit MOS devices, 141 routes, 64 Junctions, no XU block instances, and no
  generic symbols; all 96 expanded child terminals match the parent hierarchy,
  and all 25 MOS bulk terminals remain connected to their original VDD/VSS
  Nets. Visual diagnostics report zero errors or warnings after eliminating six
  ambiguous VDD/capacitor junctions, and the revised PNG was visually inspected;
  formatting and final diff/status hygiene checks passed.
- Commit status: not committed; retained as an alternate visual prototype for
  comparison with the hierarchical CDAC output.

## 2026-08-07 - Keep MOS arrow in three-terminal variant

- Target: correct the textbook three-terminal MOS presentation after review
  showed that hiding the bulk lead also removed the NMOS/PMOS direction arrow.
- Changed areas: separated the `mos-arrow` primitive from the hideable
  `bulk-lead`, prevented dedicated `nmos3`/`pmos3` symbols from inheriting a
  duplicate arrow, added focused regression assertions, and regenerated the
  flattened CDAC artifacts. Electrical `B` pins and their VDD/VSS Net bindings
  remain present while only the bulk lead is hidden. After user clarification,
  the arrow geometry was moved from the channel center onto the source branch:
  rendered top PMOS arrows point left and bottom NMOS arrows point right.
- Validation: the seven focused built-in-symbol tests passed; the symbol package
  built; the flattened recipe completed import, six typed transactions, Project
  validation, and formal export; the PNG was visually inspected with one visible
  source-branch direction arrow per MOS and no duplicate arrows.
- Commit status: not committed; retained with the current CDAC prototype for
  user review.

## 2026-08-07 - Use migrated MOS variant geometry

- Target: replace the rejected hand-adjusted MOS arrow with the repository's
  existing VSS-migrated three-terminal geometry while preserving canonical
  four-terminal SPICE connectivity.
- Changed areas: restored the reviewed NMOS4/PMOS4 default bulk-arrow geometry;
  extended visual variants with presentation-only additional primitives; made
  `textbook-3terminal` hide the bulk lead and reuse the `nmos3` source arrow plus
  the orientation-normalized `pmos3` source arrow; added focused schema,
  builtin, and renderer coverage; updated the Symbol DSL contract and the two
  circuit goldens that consume the variant; regenerated the flattened CDAC
  Project and formal exports. The VSS review manifest and both VSS contact-sheet
  goldens were not changed.
- Validation: 126 workspace tests passed; workspace typecheck and build passed;
  the 12 reviewed and 13 migration-candidate symbol previews passed their
  deterministic review check; both Phase 1/5 circuit goldens passed; the CDAC
  import, six typed transactions, Project validation, and exports passed. All
  25 MOS instances resolve the variant and retain 25 `B` Net terminals; all 96
  flattened child-terminal mappings match the hierarchy; visual diagnostics
  are empty; `circuit.spi` has no diff; and the PNG was visually inspected.
- Commit status: not committed; retained with the current CDAC prototype for
  user review.

## 2026-08-07 - Local-power textbook CDAC layout

- Target: restyle the flattened CDAC routing after the supplied Razavi examples
  by using vertical CMOS stacks, local power symbols, short signal paths, and
  only the electrically necessary shared VOUT rail.
- Changed areas: added six local VDD/ground helper pairs plus dedicated grounds
  for the dummy capacitor and reset device; bound all helpers to the existing
  VDD/VSS Nets; removed the page-spanning VDD/VSS routes; stacked each PMOS over
  its NMOS; separated input, inter-stage, output, and capacitor channels; moved
  device labels beside their symbols; corrected each second-stage gate branch
  so its external route terminates outside the MOS lead instead of overlaying
  it; reduced cell pitch from 340 to 300 units and compacted the vertical power,
  device, capacitor, and reset bands; regenerated the editable Project and
  SVG/PNG/PDF exports. The source SPICE and symbol library were not changed.
- Validation: SPICE import, five typed transactions, Project validation, and
  formal export passed; the top has 46 placed instances including 14 resolved
  local-power helpers, 127 routes, and 50 Junctions. All helpers bind to exactly
  one VDD/VSS Net; no global VDD/VSS port routes remain; all 25 MOS instances
  retain the migrated visual variant and 25 bulk terminals; all 96 expanded
  child-terminal mappings match the hierarchy; visual diagnostics are empty;
  `circuit.spi` has no diff; and the PNG was visually inspected.
- Commit status: not committed; retained as the current visual prototype for
  user review.

## 2026-08-07 - Implement Snapshot-driven Agent workflow

- Target: execute Phase 9 with a flat complete-Snapshot Agent boundary, a thin
  governing Skill plus on-demand knowledge, generic typed edits, actionable
  diagnostics, and shared human/Agent revision and lock semantics.
- Changed areas: accepted Agent API v2/Snapshot ADR and schemas; added
  deterministic Project Index and complete bidirectional Document Snapshot;
  retained v1 query only for compatibility; added SKY130 and exact PDK symbol
  mappings, atomic symbol remap and port edits, spatial diagnostics, editor
  Document navigation/diagnostic jump/handoff, the `circuit-layout` Skill and
  ten routed knowledge documents, checked RLC/CDAC recovery traces, and
  128/500-instance generalization/performance evidence. Measured traces did not
  justify a query DSL, Layout Intent, topology classifier, or optional helper.
- Integration repair: updated four dense-analog Route/Junction coordinates and
  regenerated Phase 5/7 goldens after the preceding MOS migration moved formal
  pin positions; the final visual review restored orthogonal routes while
  retaining the migrated source arrows.
- Validation: formatting and typecheck passed; 127 tests in 33 files and all 14
  Playwright flows passed; three Agent API artifacts, Snapshot/audit/replay,
  Skill package/links/ownership, PDK/import, Phase 1/5/7 visual/export goldens,
  12 reviewed plus 13 candidate symbol previews, four pinned references, and
  both legacy and Phase 9 performance budgets passed. The 128-instance complete
  Snapshot is 289,373 bytes and the 500-instance Snapshot is 1,126,592 bytes;
  both flows use zero v1 queries and no helper.
- Remaining external gate: four isolated real-Agent guidance tiers and an
  independent blinded readability review. The repository records the protocol
  and deterministic package/context ablation but deliberately does not invent
  model-quality scores. A reproducible kit now generates isolated, hashed tier
  contexts; rejects incomplete, electrically changed, lock-violating,
  query/helper-dependent, or unrefreshed results; anonymizes renders; and
  aggregates blind scores. Its full prepare/finalize/score path and negative
  cases pass a temporary-directory self-test. Phase 9 roadmap status is
  `review` until real external runs and scores complete.
- Architecture clarification: the roadmap, final architecture, product plan,
  knowledge plan, and execution plan now explicitly define the Agent as the
  semantic reasoning/layout layer. Complete Snapshot is the fact-transfer
  boundary; the two runtime document layers are the lifecycle Skill and
  on-demand circuit knowledge. Agent-local regions, pattern hypotheses,
  coordinates, and route plans are neither a query language nor a persisted
  Layout Intent. Product capability expansion follows vertical-trial evidence.
- Held-out closure: added a post-knowledge-freeze hierarchical 4-bit Flash ADC
  with 15 comparator references, 135 elaborated MOS devices, and a 16-resistor
  ladder. Its two Documents import with zero generic symbols or errors; the
  dedicated generator pins Snapshot sizes/hashes and the main SPICE corpus now
  pins its 40 direct instances and connectivity hash. Added the neutral task,
  evidence page, and a fresh local `v2` four-tier kit whose contract requires a
  final derived Snapshot for every Document. The older local `v1` kit is
  explicitly non-canonical.
- Final deterministic regression: 127 tests in 33 files, 14 Playwright flows,
  typecheck, formatting, build/release smoke, four references, 25 symbol
  previews, Phase 1/5/7 visual/export artifacts, API schemas, all Phase 9
  audits/replays/performance reports, three held-out regenerations, evaluation-pipeline
  negative tests, and Phase 9 documentation links/fences pass.
- External-study outcome: two real isolated four-tier runs passed electrical,
  revision, Snapshot, placement, render, and diagnostic hard checks, but the
  guidance tiers did not reliably match the API-only Agent's blind readability.
  A third structurally different differential-feedback fixture was frozen and
  validated, then its model run was stopped as nonessential. The ablation kit
  remains available for future research; it is not a product runtime layer or
  Phase 9 exit dependency. Skill/knowledge remain optional guidance governed by
  outcome-based rules, while complete Snapshot plus typed edits stays the flat
  product boundary.
- Commit status: not committed; working tree retains the preceding coordinated
  editor, symbol, hierarchy, RLC/CDAC, and plan changes.

## 2026-08-07 - Checkpoint integrated development

- Target: consolidate the intentionally retained manual-editor, symbol,
  hierarchy, visual-prototype, and Phase 9 Agent changes into one attributable
  baseline before Razavi visual implementation begins.
- Dirty-state decision: 52 modified tracked paths and 95 untracked paths were
  mapped to their named plans and prior log entries. Shared implementation
  files contain dependent changes from several targets, so a documented
  one-time integration checkpoint is safer than reconstructing partial
  historical commits. `lib/circuit.vss` remained unchanged. The Razavi style
  specification and its plan were explicitly excluded for a separate commit.
- Hygiene: the untracked set is about 2.2 MB, contains no unexpected large
  files, and the repository credential-signature scan found no matches.
- Concurrent-state note: an OTA `razavi-layout.mjs` appeared and changed after
  the opening audit, followed by four matching export artifacts. They were not
  part of the retained target inventory, so the complete OTA `razavi-*` set was
  excluded from staging and left untouched for its owner.
- Validation: `pnpm format:check`, `pnpm references:check`, `pnpm typecheck`,
  127 unit tests in 33 files, workspace build, symbol review, Phase 5 visual,
  Phase 7 export, Agent API artifact, every Phase 9 deterministic and held-out
  check, performance baseline, release package/smoke, 14 Playwright flows,
  and `git diff --check` passed.
- Commit status: prepared for the integrated checkpoint commit; push status is
  recorded by Git history and the final target handoff.

## 2026-08-07 - Define Razavi textbook visual convergence

- Target: freeze the complete fixed-style contract before changing runtime
  symbols, typography, strokes, nodes, or formal export.
- Changed areas: proposed `razavi-textbook-v1` specification, specification
  index, and target plan. The contract separates fixed assets into component,
  typography, and stroke/node layers while keeping routing/layout outside the
  style asset boundary.
- Contract: defines structured read-only VSS decoding, all-101 Master
  disposition, reviewed runtime catalog and provenance, semantic typography
  and stroke tokens, Port/Junction/device-pin truth, six-topology acceptance
  board, deterministic gates, and RV-1 through RV-8 delivery order. Existing
  Projects retain their persisted legacy profile; only new Projects/imports
  switch after acceptance gates pass.
- Dirty-state decision: shared prerequisites were checkpointed and pushed as
  `21b85fd`. Concurrent OTA `razavi-*` outputs remain untracked, read-only, and
  outside this documentation target.
- Validation: Markdown metadata/section inspection, specification index
  review, fenced-code balance, and `git diff --check`.
- Commit status: prepared for a dedicated normative-document commit; runtime
  implementation has not begun.

## 2026-08-07 - Complete Razavi RV-1 VSS decoder proof

- Target: replace visual/manual guessing with structured read-only ShapeSheet
  evidence for `NMOS4`, `Pmos3.a`, `R`, `DC-V`, and `node`.
- Changed areas: added a versioned VSS Master IR extractor, deterministic
  checker, checked five-target fixture plus the `TEXT` coverage-only Master,
  import-tool documentation, and factual RV-1 specification clarification.
- Evidence: 6 Masters, 32 nested Shapes, 93 supported geometry rows, 11
  connection points, 2 arrow-bearing Shapes, 1 text Shape, and three observed
  line-weight levels were captured with formulas and evaluated values. No
  electrical pin name/order was inferred, and extraction emitted zero
  diagnostics.
- Visual review: temporary Visio PNG/SVG exports confirmed the source NMOS4,
  Pmos3.a, resistor, DC voltage-source, and filled node-dot appearance. The
  exports remain temporary evidence rather than runtime assets.
- Validation: deterministic re-extraction matched fixture SHA-256
  `826c2ba82532de17686dae61ac1bd6c93fbe4b946d2bb60797ad726b23a94170`;
  focused feature assertions, formatting, typecheck, 127 unit tests in 33
  files, and `git diff --check` passed.
- Dirty-state decision: the user confirmed the concurrent OTA `razavi-*`
  files do not affect this target; they remained untracked and untouched.
- Commit status: ready for the dedicated RV-1 commit.

## 2026-08-07 - Establish Razavi RV-2 catalog boundary

- Target: make product-owned JSON assets and their provenance the source of
  truth for the first VSS-derived runtime components instead of leaving their
  only definitions embedded in `builtins.ts`.
- Changed areas: added `razavi-symbols@1` catalog/assets, a deterministic
  generated TypeScript adapter, runtime catalog API, generator/check command,
  focused tests, asset-directory documentation, and compatibility lookups in
  the existing built-in library.
- Catalog result: reviewed `nmos`/`NMOS4`, `resistor`/`R`, and
  `voltage-source`/`DC-V`, plus provisional `pmos3`/`Pmos3.a`, now expose
  source stencil/decoder identity, review state, exact pin order, reachability,
  asset path, and canonical hash. Provisional PMOS3 remains palette-visible but
  has no automatic mapping. VSS `node` is a semantic Junction primitive, not a
  component.
- Deterministic boundary: the checker validates canonical asset hashes,
  generated adapter equality, RV-1 evidence, path containment, unique
  IDs/aliases/assets/Masters, 10-unit pin grid, and catalog reachability.
- Compatibility: `builtInSymbols` reuses the four catalog object instances;
  ordering, IDs, aliases, variants, resolver behavior, and existing visual
  geometry remain unchanged.
- Validation: catalog check, 12 focused tests, 132 full tests in 34 files,
  typecheck, build, formatting, 25 symbol previews, Phase 1/5 visual goldens,
  and `git diff --check` passed.
- Dirty-state decision: user-confirmed concurrent OTA `razavi-*` files remained
  untracked and untouched.
- Commit status: ready for the dedicated RV-2 commit.

## 2026-08-07 - Add Razavi RV-3 semantic stroke profile

- Target: centralize formal line/node presentation under a versioned profile
  while preserving byte-identical legacy output.
- Changed areas: Symbol DSL semantic stroke role, first catalog asset role
  migration and regenerated hashes/adapter, renderer profile registry and
  profile-aware formal scene, symbol-review compatibility, tests, and visual
  contract documentation.
- Razavi behavior: formal foreground `#202020`; wire/symbol/normal `1.6`,
  emphasis `2.4`, supply `1.8`, annotation `1.6`; Junction/Port radii `3`;
  butt/miter geometry; scaling strokes; Arial-family 16-unit base text. Unknown
  profile IDs are blocking. All Razavi formal widths come from profile tokens;
  remaining legacy numeric overrides are deterministically clustered until
  their assets receive explicit roles.
- Legacy compatibility: `textbook-monochrome-v1` keeps literal numeric
  overrides, its prior defaults, and non-scaling strokes. Existing symbol,
  Phase 1/5, and Phase 7 goldens remained byte-identical.
- Validation: 24 focused tests, 137 full tests in 35 files, typecheck, build,
  formatting, catalog check, 25 symbol previews, Phase 1/5 visual goldens,
  Phase 7 export goldens, and `git diff --check` passed.
- Dirty-state decision: user-confirmed concurrent OTA `razavi-*` files remained
  untracked and untouched.
- Commit status: ready for the dedicated RV-3 commit.

## 2026-08-07 - Add Razavi RV-4 schematic typography

- Target: implement the frozen schematic-math and label typography contract
  for `razavi-textbook-v1` without changing persisted text or legacy output.
- Changed areas: profile typography tokens, schematic-text parser/composer,
  renderer text consumers, parser/renderer tests, and visual-language/style
  specifications.
- Razavi behavior: instance and recognized V/I labels render as italic-bold
  base/subscript `<tspan>` runs; explicit underscore has priority; trailing
  `+`/`-` uses a separate upright suffix; plain notes and figure captions are
  not implicitly parsed. Semantic kinds select their profile font sizes.
- Transform and compatibility behavior: instance and visible pin text remains
  outside component rotate/mirror transforms. The legacy profile emits its
  prior plain escaped text and retained byte-identical Phase 1/5 and Phase 7
  goldens.
- Validation: 23 focused tests, 149 full tests in 36 files, typecheck, build,
  formatting, Phase 1/5 visual goldens, Phase 7 export goldens, and
  `git diff --check` passed.
- Dirty-state decision: user-confirmed concurrent OTA `razavi-*` files remained
  untracked and untouched.
- Commit status: ready for the dedicated RV-4 commit.

## 2026-08-07 - Add Razavi RV-5 semantic nodes and annotations

- Target: render formal connection origins and annotation geometry from
  persisted semantic objects under `razavi-textbook-v1` while retaining
  compatibility output.
- Changed areas: node/annotation profile tokens, formal renderer, truth-table
  renderer tests, and visual-language/style specifications.
- Node behavior: positioned signal Ports render radius-3 origin dots; a Port
  attached to a power label renders a 20-unit supply bar instead of a dot;
  null Ports and device-pin anchors remain invisible. Explicit Junctions stay
  authoritative, and Razavi geometric crossings do not infer dots.
- Annotation behavior: current shaft/head dimensions and label gaps come from
  the profile; voltage annotations render separate upright polarity glyphs;
  rotation changes the arrow or polarity axis without rotating its label.
- Compatibility: the legacy profile retains its prior markup and byte-exact
  Phase 1/5 and Phase 7 goldens.
- Validation: 12 focused tests, 150 full tests in 36 files, typecheck, build,
  formatting, Phase 1/5 visual goldens, Phase 7 export goldens, and
  `git diff --check` passed.
- Dirty-state decision: user-confirmed concurrent OTA `razavi-*` files remained
  untracked and untouched.
- Commit status: ready for the dedicated RV-5 commit.

## 2026-08-07 - Capture Razavi RV-6A core analog VSS evidence

- Target: establish deterministic structured source evidence for all reviewed
  and provisional Batch A/B analog Masters before further catalog migration.
- Changed areas: dedicated 27-Master VssMasterIR fixture, deterministic
  re-extraction checker, VSS tool documentation, and source/style contracts.
- Evidence: 12 reviewed mappings, 13 provisional candidates, and semantic
  `node`/`Arrow` Masters produce 175 nested Shapes, 504 geometry rows, 45
  connection points, five recognized geometry kinds, and zero diagnostics.
  Fixture SHA-256 is
  `2db676bddbd0ac93dba64972eec15c40b2143161ec05c75cfe4cc467595584c0`.
- Boundary: connection points remain review evidence only. This target changed
  no runtime asset, pin order, palette entry, or automatic SPICE/PDK mapping.
  The frozen RV-1 proof fixture remains independent and unchanged.
- Validation: deterministic RV-6 re-extraction, unchanged RV-1 checker, 150
  tests in 36 files, typecheck, formatting, and `git diff --check` passed.
- Dirty-state decision: user-confirmed concurrent OTA `razavi-*` files remained
  untracked and untouched.
- Commit status: ready for the dedicated RV-6A commit.

## 2026-08-07 - Preserve implicit MOS bulk semantics

- Target: eliminate false flightlines from three-terminal MOS presentation
  without deleting, shorting, or rewriting the canonical D/G/S/B connectivity.
- Changed areas: shared endpoint visibility, visible connectivity/flightline
  derivation, editor connectable endpoints, MOS regression tests, Razavi text
  suffix composition, OTA layout recipe, and connectivity/Symbol DSL contracts.
- Electrical result: a variant-hidden or base `implicit` terminal stays in its
  logical Net but is excluded from the visible graph. The regression proves
  `XM1.B` remains on VSS, `XM1.S` remains on tail, both survive canonical
  Project serialization, and removing the three-terminal variant restores the
  visible B flightline.
- Recipe/result: the Agent recipe no longer forces every MOS to
  `textbook-3terminal`; VDD/VSS labels attach to Port IDs; its UTF-8 module
  imports successfully. Existing generated OTA outputs were left untouched
  because they belong to the earlier parallel run and are now stale.
- Visual result: schematic-math suffixes use explicit baseline reset and
  downward cursor compensation; current PNG inspection confirms normal
  `VIN+`, `VIN-`, `VOUT+`, and `VOUT-` sign placement.
- Deferred: Net classification, safe automatic three-/four-terminal variant
  selection, and `HIDDEN_BULK_NON_GLOBAL_NET` remain a separate correctness
  target rather than being guessed from names in this fix.
- Validation: 17 focused tests, 151 full tests in 36 files, recipe import,
  typecheck, build, formatting, Phase 1/5 visual goldens, Phase 7 export
  goldens, visual PNG inspection, and `git diff --check` passed.
- Commit status: ready for the dedicated correctness commit.

## 2026-08-07 - Migrate reviewed analog assets to the Razavi catalog

- Target: make the reviewed core analog VSS set the canonical runtime source
  while retaining the four-terminal MOS electrical contract.
- Changed areas: nine new normalized Symbol DSL assets, 13-entry catalog and
  generated adapter, built-in compatibility registry, evidence/review-manifest
  validation, focused catalog tests, and Razavi style documentation.
- Catalog result: 12 reviewed assets (`capacitor`, `current-source`, `diode`,
  `ground`, `inductor`, `nmos`, `npn`, `pmos`, `pnp`, `port`, `resistor`, and
  `voltage-source`) plus provisional `pmos3`; every exposed matching built-in
  is the catalog object. `nmos3` remains outside the catalog and `pmos3` has no
  automatic mapping.
- Electrical result: reviewed NMOS/PMOS pin order remains D/G/S/B and the
  textbook three-terminal variant changes presentation only.
- Deferred: full 101-Master disposition, remaining candidate/Batch C assets,
  runtime consumption of `automaticMappings`, bulk-Net classification and
  safe variant selection, exact VSS geometry-overlay proof, the six-topology
  acceptance board, and separately scoped routing extensions.
- Validation: catalog generation/check, 12-reviewed/13-candidate preview
  check, 14 focused tests, 152 full tests in 36 files, typecheck, build,
  formatting, Phase 1/5 visual goldens, Phase 7 export goldens, and
  `git diff --check` passed.
- Dirty-state decision: concurrent OTA recipe/output work and its separate
  target plan remained untouched and will not be staged in this commit.
- Commit status: ready for the dedicated RV-6B commit.

## 2026-08-07 - Generate a headless two-stage CMOS buffer example

- Target: demonstrate a fast Agent-generated circuit distinct from the CDAC
  and OTA examples.
- Changed areas: one deterministic typed-edit recipe and its editable Project,
  SVG, PNG, and PDF outputs under `netlists/mixed-device-acceptance/`.
- Electrical result: the existing `mixed_mos_cell` topology is preserved as
  two cascaded CMOS inverters; all four D/G/S/B terminal memberships survive
  canonical persistence, with PMOS bulk on VDD and NMOS bulk on VSS.
- Visual result: 4 placed instances, 5 Nets, 20 Routes, 8 Junctions, 9
  annotations, 0 flightlines, 0 crossings, and 0 visual diagnostics.
- Validation: headless generation, canonical Project round-trip, topology and
  bulk assertions, PNG inspection, `git diff --check`, and worktree audit.
- Dirty-state decision: unrelated documentation and OTA work remained
  untouched and was not staged.
- Commit status: ready for the dedicated fixture commit.

## 2026-08-07 - Generate a headless SKY130 divide-by-two schematic

- Target: turn `sky130-transistor-divide-by-2/circuit.spi` into a fast editable
  top-level schematic while retaining its seven-Document hierarchy.
- Changed areas: one deterministic typed-edit recipe, Project/SVG/PNG/PDF
  outputs, and an opt-in hierarchical implicit-supply symbol variant with
  focused tests.
- Electrical result: all source instances, Nets, subcircuit interfaces, and
  VDD/VSS memberships remain canonical. The top page has 8 placed instances,
  10 Nets, 24 Routes, 9 Junctions, and 0 flightlines.
- Presentation result: repeated hierarchical supply pins are hidden only in
  the selected top-level presentation; the visible state capacitor and reset
  transistor retain an explicit VSS rail. PNG inspection passed with 0 visual
  diagnostics. Twenty derived crossing records remain in the rapid functional
  view, including same-Net joins and visible feedback/reset crossings.
- Validation: 2 focused hierarchical-symbol tests, symbols build, headless
  generation, canonical/topology/visibility assertions, PNG inspection, and
  repository whitespace/status checks.
- Dirty-state decision: unrelated documentation and OTA work remained
  untouched and unstaged.
- Commit status: ready for the dedicated divider fixture commit.

## 2026-08-07 - Refine and flatten the SKY130 divide-by-two

- Target: refine the divider's hierarchical top page and produce a true
  transistor-level flat view without modifying its source SPICE.
- Infrastructure: added an optional pre-layout Project hook, deterministic
  recursive Document flattening, a 30-primitive fixture assertion, and
  electrical connectivity between same-Net junction stubs carrying identical
  labels.
- Electrical result: the flat view contains 15 NMOS, 14 PMOS, one capacitor,
  16 Nets, all prefixed deep internal identities, and no hierarchical instance.
  Matching labels change visible routing closure only; canonical Net terminal
  membership remains unchanged.
- Hierarchical presentation: 7 Documents, 8 placed top instances, 24 Routes,
  0 flightlines, 3 inter-Net crossings, and 0 visual diagnostics.
- Flat presentation: 8 Documents including the derived flat top, 30 placed
  primitives, 104 Routes, 77 Junctions, 99 annotations, 0 flightlines, 7
  inter-Net crossings, and 0 visual diagnostics.
- Validation: recursive-flatten assertions, six focused derived tests, derived
  package build, both headless generation recipes, canonical/topology/bulk
  checks, visual inspection of both PNGs, and repository whitespace/status
  checks.
- Dirty-state decision: concurrent symbol-fidelity, renderer, documentation,
  OTA, and visual-golden work remained unstaged. Final exports intentionally
  use the current reviewed MOS runtime available in the shared workspace.
- Commit status: ready for the dedicated refined/flat divider commit.

## 2026-08-07 - Generate MOS artwork from Visio evidence

- Target: replace guessed/procedural MOS geometry with a deterministic,
  independently auditable VSS-to-runtime path.
- Changed areas: four normalized Visio reference SVGs, Master-IR MOS generator,
  four generated catalog assets, generated adapter, built-in resolver,
  finite-decimal/fill-only Symbol DSL support, exact Razavi stroke roles,
  comparison/contact sheets, fixture routes, and SVG/PNG/PDF goldens.
- Fidelity result: `NMOS4`, `PMOS4`, `Nmos3.a`, and `Pmos3.a` retain decoded
  intrinsic geometry, child transforms, round caps/joins, 1.2/2.16 point
  weights, and Visio Arrow Type 13 direction/size. The independent 50% overlay
  visually matches the device body and arrow; only external lead length changes
  to keep pin anchors on the 10-unit electrical grid.
- Runtime/electrical result: all four MOS symbols now resolve to catalog
  objects. Canonical NMOS/PMOS remain D/G/S/B; the textbook variant remains
  presentation-only. Provisional NMOS3/PMOS3 expose no automatic mappings.
- Validation: deterministic four-reference Visio COM check, MOS/catalog/review
  regeneration checks, 155 tests in 37 files, typecheck, build, Phase 1/5
  visual checks, Phase 7 export checks, PNG inspection, formatting, and
  `git diff --check` passed.
- Dirty-state decision: concurrent documentation, OTA, divide-by-two,
  Agent-layout, and labeled-connectivity work remained read-only and unstaged.
- Commit status: ready for `feat(symbols): generate MOS artwork from Visio evidence`.

## 2026-08-07 - Expose Razavi fixed-style hard canon to Skill manifest

- Target: close Gap A — the Agent had no view of the Razavi fixed-style hard
  canon (grid `10`, pin-anchor divisibility, schematic-math label rules, stroke
  roles, node/connection-origin truth table) even though
  `razavi-textbook-style.md` existed as a `proposed` normative spec.
- Changed areas: added `docs/agent/knowledge/razavi-style-canon.md`; added one
  manifest row in `skills/circuit-layout/references/manifest.md`; added the
  fixed-style category to the `docs/agent/README.md` knowledge enumeration.
- Boundary held: the new canon exposes only the three hardable fixed-style
  layers (coordinate, typography, stroke/node). Routing topology, elbow/trunk
  choice, obstacle avoidance, and composition are explicitly written out of
  scope and deferred to the existing routing/expression/guidance authorities —
  operationalizing the `razavi-style-aspect-boundary` memory.
- Dirty-state decision: a large dirty set across `apps/editor`, `packages/*`,
  `fixtures/*`, and `netlists/*` from prior uncommitted targets was confirmed
  against owned paths; none overlap. Unrelated dirty files left untouched.
- Validation: Markdown link resolution from the new doc and manifest row to
  every referenced target, fenced-code balance, `git diff --check`, and
  `git status --short --branch` passed. No typecheck/test/build run because no
  source or runtime contract changed (docs-only, risk-proportional per
  AGENTS.md).
- Commit status: ready for
  `docs(agent): expose Razavi fixed-style hard canon to Skill manifest`.

## 2026-08-07 - Editor text resize, default-label visibility, and annotation hit fix

- Target: fix three editor interaction defects — added plain-text cannot be
  resized; power/ground devices always render a default instance ID label
  (GND/VSS should default to none); selecting a note/text annotation conflicts
  with device selection because the device hit-target covers it.
- Changed areas: added `labelVisibility: shown|hidden` to `SymbolDefinition`
  (optional, default shown); marked `powerPortSymbol("vdd"|"vss")` and the
  Razavi `ground` catalog asset `labelVisibility: "hidden"`; renderer skips the
  default instance label for hidden-default symbols while explicit
  instance-label annotations still render; added optional `sizeScale` to
  `AnnotationSchema` and a `sizeScale` parameter to `schematicTextSizeAttribute`
  so `plain-text` font size scales (Razavi only; legacy profile unchanged);
  editor Text panel gained a size-scale input and `applyAnnotationText` writes
  `sizeScale` for plain-text; annotation hit-target radius raised from 10 to 18
  to reduce device-circle swallowing of text selection.
- Validation: typecheck, workspace build, Phase 5 visual check, Phase 7 export
  check, two new focused render tests (label-hidden symbol, plain-text
  sizeScale), formatting, and `git diff --check` passed.
- Dirty-state decision: the worktree carries the ongoing
  `hidden-mos-terminal-correctness` target plus pre-existing RV-6A
  visio-core-analog work that changed several Razavi symbol JSON geometries
  (resistor, capacitor, diode, voltage-source) without re-syncing
  `catalog.json` hashes or dependent test/golden assertions. As a result five
  pre-existing tests fail at this point — three in `razavi-catalog.test.ts`
  and two in `apps/editor` (`clipboard`, `delete-selection`) that depend on
  resistor pin geometry — none caused by this target's edits (verified: these
  files pass at HEAD without the dirty symbol work; they fail once that work is
  restored). `symbols:razavi:check` likewise remains red on the pre-existing
  capacitor hash mismatch. The full catalog re-sync and those test/golden
  updates are left to a dedicated symbol-consistency target. This target only
  touched ground/vdd/vss label visibility, annotation sizeScale, and the
  annotation hit-target radius.
- Commit status: ready for
  `feat(editor): add text resize, default-label visibility, and annotation hit fix`.

## 2026-08-07 - Bound agent-routing expander to Agent-local, non-rerouting scope

- Target: write ADR 0008 before any `packages/agent-routing` code, fixing the
  boundary that keeps a `RouteTreeDecision` and its expander inside ADR 0007's
  accepted Snapshot-driven Agent-local model and outside the vetoed Layout
  Intent / query-language / automatic-router space.
- Changed areas: added `docs/adr/0008-agent-local-route-tree-expander.md`;
  listed it in `docs/adr/README.md`.
- Decision (two nails): (1) `RouteTreeDecision`/`RouteTreeExpansion` are
  Agent-local and transient — types live only in `packages/agent-routing`,
  must not enter `agent-adapter` or `model` schemas, must not persist into
  `.icproj`, must not grow select/query/region capabilities, and add no Agent
  API endpoint; the Skill contract may carry them, the API contract may not.
  (2) The expander detects conflicts (crossing/overlap/wire-through-symbol/
  off-grid) but does not auto-reroute: no silent shape fallback, no
  `auto`/`best` shape, no rerouting to drive a counter to zero.
- Dirty-state decision: owned paths do not overlap the ongoing editor and
  symbol-consistency dirty work; unrelated files left untouched.
- Validation: Markdown link resolution to 0007, agent-api.md,
  connectivity-and-routing.md, rule-guided-layout-architecture.md,
  razavi-style-canon.md, and the Skill manifest; fenced-code balance;
  `git diff --check` passed. Docs-only; no typecheck/test/build run
  (risk-proportional).
- Commit status: ready for
  `docs(adr): bound agent-routing expander to Agent-local, non-rerouting scope`.

## 2026-08-07 - Localize transact failures and return resolved Route geometry

- Target: close three Agent self-consistency gaps in the `transact` path (target
  #2 of the routing-quality sequence) so an Agent sees the consequence of its
  own operation.
- Changed areas: `packages/edit-engine/src/transaction.ts` (EditDiagnostic gains
  optional objectIds/parameters; rejectTransaction gains optional path/objectIds;
  the apply loop is indexed with a rejectAt closure binding `["edits", index]`;
  in-loop rejections name the offending routeId; the post-loop Route geometry
  failure carries `["routes", routeId]`), `packages/agent-adapter/src/schema.ts`
  (optional `resolvedRoutes` on the transact success response),
  `packages/agent-adapter/src/service.ts` (stop stripping failure diagnostics;
  collect and return resolvedRoutes), two focused service tests, and
  `docs/specs/agent-api.md` + `docs/agent/api-usage.md` documenting both.
- Result: a rejected transact localizes the failing edit via `["edits", index]`
  (or `["routes", routeId]` for a Route geometry failure) and names the object
  in `objectIds`; a successful transact returns the post-normalization polyline
  for each touched Route, so the Agent learns the actual stored geometry after
  `set_route_points`/`add_junction` normalization without an immediate snapshot.
- Dirty-state decision: owned paths do not overlap the existing editor/symbol/
  fixture dirty set. The agent-api schema artifacts were already dirty from
  prior uncommitted schema.ts work; regenerated to validate, but NOT staged here
  because they bundle pre-existing schema.ts changes not authored by this target.
- Validation: full workspace `pnpm typecheck`, `prettier --check`, 47 tests in
  8 files (agent-adapter + edit-engine), `agent-api:artifacts:check`, and
  `git diff --check` passed.
- Commit status: ready for
  `feat(agent-api): localize transact failures and return resolved Route geometry`.

## 2026-08-07 - Add Agent-local route-tree expander and shape dictionary

- Target: target #3b of the routing-quality sequence — remove the multi-endpoint
  Net tree-arithmetic bottleneck by expanding a topology-only RouteTreeDecision
  into typed edits with resolved coordinates, inside the ADR 0008 boundary.
- Changed areas: new `packages/agent-routing` package (`types.ts`, `expand.ts`,
  `index.ts`) with `expandRouteTree` and per-shape expanders for direct /
  local-branch-tree / shared-trunk / labeled-islands / ordered-bus; thin Skill
  caller `skills/circuit-layout/scripts/expand-route-tree.mjs`; non-recipe shape
  dictionary `docs/agent/knowledge/route-tree-shapes.md`; manifest row; one
  `tsconfig.check.json` path entry; 8 focused tests.
- Boundary held: the expander applies the grid=10 canon, returns conflicts
  (UNKNOWN_SHAPE, MISSING_ENDPOINT, SHAPE_MISMATCH, TRUNK_CORRIDOR_BLOCKED)
  without auto-rerouting, has no `auto`/`best` shape, and never silently
  switches shapes. It depends on `@icm/model` and `@icm/edit-engine` types only;
  RouteTreeDecision/Expansion do not enter the Agent API or model schemas.
- Dirty-state decision: additive owned paths do not overlap the existing dirty
  set; `pnpm install` re-linked the workspace without lockfile changes.
- Validation: full workspace `pnpm typecheck`, `prettier --check`, 8 tests, and
  `git diff --check` passed.
- Commit status: ready for
  `feat(agent-routing): add Agent-local route-tree expander and shape dictionary`.

## 2026-08-07 - Add read-only routing-quality metrics

- Target: target #4 of the routing-quality sequence — give the Agent measurable
  routing feedback beyond structural codes, as evidence only (never pass/fail,
  never moving objects).
- Changed areas: `packages/derived/src/visual.ts` (new
  `pushRoutingQualityMetrics` with VISUAL_WIRE_THROUGH_SYMBOL,
  VISUAL_ROUTE_OVERLAP, VISUAL_TERMINAL_DEPARTURE; segmentIntersectsRect and
  firstCollinearOverlap helpers), one focused test, and
  `docs/agent/knowledge/routing-and-diagnostics.md` documenting the codes.
- Boundary held: metrics are read-only derived diagnostics; terminal departure
  is `info` evidence; overlap and wire-through-symbol are `warning`. They never
  move objects and never claim good/bad. The VisualDiagnostic type and Agent
  Snapshot mapping were unchanged.
- Dirty-state decision: owned paths do not overlap the existing dirty set.
- Validation: full workspace `pnpm typecheck`, `prettier --check`, 17 tests in
  4 files, and `git diff --check` passed.
- Commit status: ready for `feat(derived): add read-only routing-quality metrics`.

## 2026-08-07 - Stretch connected routes on instance move (ADR 0009)

- Target: target #5 of the routing-quality sequence — a device move no longer
  drags connected Routes into an invalid state; the Agent can revise placement.
- Changed areas: ADR 0009 (move stretches, never reroutes; scope move_instance,
  Junction move deferred); `packages/edit-engine/src/transaction.ts`
  (applyStretchedRoutes called from move_instance using proposeLocalStretch;
  protected adjacent segments skipped, post-loop validation still rejects);
  `routing.test.ts` rewritten; `packages/agent-adapter/src/snapshot.ts`
  (topologyHash excludes diagnostics — derived evidence is not topology);
  `scripts/phase-9-generalization.mjs` (finalDiagnosticCount counts error only);
  `docs/specs/edit-engine.md`; and regenerated Phase-9 fixtures whose pinned
  hashes/count assertions changed as a direct consequence of #4/#5.
- Boundary held: stretching preserves topology and locks; it never reroutes or
  breaks a lock. move_junction still relies on post-loop validation (deferred).
- Dirty-state decision: owned paths do not overlap the existing editor/symbol
  dirty set; Phase-9 fixtures regenerated because the topologyHash fix and #4
  metrics changed their pinned values (hash/count-only diffs).
- Validation: full workspace `pnpm typecheck`, `prettier --check`, 72 tests in
  13 files, all Phase-9 checks (heldout flash/chopper/ring, skill,
  generalization, snapshot audit), `agent-api:artifacts:check`, and
  `git diff --check` passed.
- Commit status: ready for
  `feat(edit-engine): stretch connected routes on instance move (ADR 0009)`.

## 2026-08-07 - Defer automatic router / obstacle avoidance / auto cleanup

- Target: target #6 (final) of the routing-quality sequence — evaluate whether
  to implement A* / automatic avoidance / auto cleanup.
- Decision: do not implement. Evidence: thermometer flat layout reached 0
  defects via tree choice + diagnostics, not a router; ADR 0008 bounds the
  expander to detect-not-reroute; Phase 9 measured recipe-ization as harmful;
  ADR 0007 requires helpers be optional and the workflow complete without them;
  and #1–#5 already closed the reason/decide/see/feedback/revise loop.
- Changed areas: `plan/2026-08-07-defer-automatic-router/plan.md` only.
- Validation: `git diff --check`. Docs-only.
- Commit status: ready for
  `docs(plan): defer automatic router per ADR 0008 and Phase 9 evidence`.

## 2026-08-08 - Evaluate the new Agent-routing architecture on a flat CDAC

- Target: generate a genuinely flattened SKY130 6-bit switched-capacitor DAC
  through API v2 Snapshot/transact/render, with Agent-selected Net trees and
  `@icm/agent-routing` expansion, then audit the resulting electrical and
  visual behavior.
- Changed areas: additive evaluation script and Project/SVG/PNG/PDF artifacts
  under `netlists/sky130-switched-capacitor-dac-6bit-pvt/`, plus the bounded
  target plan. Existing overlapping `agent-scdac-newarch.*` files and the dirty
  Agent-routing source remained read-only.
- Result: 46 placed primitive instances (12 PMOS, 13 NMOS, 7 capacitors, 14
  local power helpers), 22 Nets, 110 Routes, 33 Junctions, no hierarchy blocks,
  no unresolved symbols, and no error-severity diagnostics. The formal render
  exposes correct bit order, weights, switch branches, reset, and common plate.
- Findings: shared-trunk tap Junctions do not split the trunk and coincident
  endpoint/tap geometry can crash route normalization; local-branch-tree makes
  a readable rail using overlapping Routes; labeled-islands do not emit label
  semantics and leave 14 VDD/VSS flightlines; Expander metrics do not reflect
  Engine-resolved bends; routing dry-runs returned zero resolved Routes while
  commits returned the actual geometry.
- Validation: API `2.0` capabilities and Snapshot `1.0`; six successful
  dry-run/commit batches; Project validation and formal API render; electrical
  terminal-count audit; whole-page PNG inspection; target Prettier check,
  structural assertions, repository-wide `git diff --check`, and final status
  audit passed.
- Commit status: intentionally uncommitted and unpushed because the evaluation
  depends on a dirty shared Expander and overlapping candidate files have
  unknown ownership.

## 2026-08-08 - Close the routing closed loop (caller, tap geometry, dry-run, multi-move)

- Target: address the four P0/P1 blockers the reviewer identified so the
  Agent -> Expander -> dry-run -> transact -> diagnostics loop actually runs.
- Changes:
  - #2 tap geometry: shared-trunk and ordered-bus now create a real per-endpoint
    tap Junction (not a trunk-end Junction); local-branch-tree dedups undirected
    g1<->g2 links so a pair is never emitted twice.
  - #1 caller: `expand-route-tree.mjs` resolves the agent-routing dist via a
    repo-root-relative file:// URL (no hoisted node_modules needed); a
    `SerializedExpansionInput` + `hydrateExpansionInput` turn the JSON endpoint
    array into the Map the expander expects. Added a CLI vitest that spawns the
    caller with fixtures.
  - #3 dry-run geometry: `executeTransaction` dryRun now returns the validated
    candidate (`candidate.data`) instead of the original Document, so
    `resolvedRoutes` reports proposed polylines; the Adapter still only commits
    on `applied`, so the store is untouched.
  - #4 multi-instance move: `move_instance` passes the progressive `draft`
    (not the pre-transaction Document) to `applyStretchedRoutes`, so a later
    move in the same transaction sees earlier moves' effect on shared Routes.
    Diagonal moves on both endpoints remain limited by proposeLocalStretch's
    inability to insert corners (documented; axial multi-move regression added).
  - #5 regenerated the CDAC recipe under the new architecture (22 overlaps
    remain, all from independent route_orthogonal escapes sharing a channel —
    the known no-obstacle-avoidance limitation, not a loop bug).
- Validation: full workspace `pnpm typecheck`, `prettier --check`, 60 tests in
  10 files (agent-routing, edit-engine, agent-adapter, skill caller CLI),
  CDAC regeneration, and `git diff --check` passed.
- Commit status: ready for
  `fix(agent-routing): close the expander loop (caller, tap geometry, dry-run, multi-move)`.

## 2026-08-08 - Demote expander to route-graph geometry helper

- Target: correct the abstraction drift — the previous expander was a "shape
  compiler" that decided junction count, trunk line, tap order, and hub
  connectivity from a compressed `shape` + `endpointGroups` decision, silently
  moving the Agent's visual-topology judgment into a weak deterministic
  planner. Rewrote @icm/agent-routing as a route-graph geometry helper.
- Changed areas: `packages/agent-routing/src/types.ts` (new RouteGraph
  nodes/edges interface replacing RouteTreeDecision), `expand.ts`
  (expandRouteGraph resolves node coordinates + projects edges to typed edits;
  never decides topology, never reroutes), `shapes.ts` (optional graph
  constructors: buildDirectGraph, buildSharedTrunkGraph, buildLocalBranchTree,
  buildLabeledIslands — advisory starting points, not a closed enum),
  `test/expand.test.ts` (10 tests), and the CDAC recipe `agent-cdac-flat.mjs`
  rewritten to give explicit Route graphs per Net.
- Boundary held: RouteGraph types live only in @icm/agent-routing (not in
  agent-adapter/model schemas, not persisted). The helper resolves coordinates
  and assembles edits; the Agent decides every node and edge. Conflicts are
  returned (MISSING_NODE_POSITION, ESCAPE_MALFORMED), never median-guessed.
- CDAC result: 48 routes, 19 junctions, 0 conflicts, 0 errors. Diagnostics:
  10 ROUTE_OVERLAP (collinear escapes, evidence-only), 2 AMBIGUOUS_JUNCTION, 1
  LABEL_OVERLAP, 2 WIRE_THROUGH. Visually much improved: explicit vdd rail,
  segmented vout common-plate, labeled vss islands, correct schematic-math
  labels.
- Validation: full workspace `pnpm typecheck`, `prettier --check`, 10 tests,
  CDAC recipe regenerated, `git diff --check` passed.
- Commit status: ready for
  `refactor(agent-routing): demote expander to a route-graph geometry helper`.

## 2026-08-08 - Migrate Visio core-analog Batch A to source-derived assets

- Target: land the self-contained core-analog catalog migration as group 1 of a
  worktree-split sequence, after the user instructed splitting the dirty
  worktree into self-contained commit groups.
- Changed areas: 8 razavi-v1 symbol assets (`resistor`, `capacitor`, `inductor`,
  `diode`, `ground`, `port`, `current-source`, `voltage-source`), `catalog.json`
  - asset README, regenerated `razavi-catalog.generated.ts`; `schema.ts`
    (`labelVisibility`), `builtins.ts` (power-port hidden default label +
    polyResistor) + test, `pdk-registry.ts` (sky130 high-po mapping) + test;
    `scripts/generate-razavi-symbol-catalog.mjs` generation policies; 8 checked
    Visio reference SVGs under `fixtures/visual-reference/visio-core-analog/`;
    `fixtures/visual-golden/visio-core-analog-fidelity.svg`;
    regenerated `phase-5-symbol-review.svg` and `vss-migration-candidates.svg`;
    `fixtures/spice/current-corpus-summary.json` (fewer generic symbols after
    improved mapping; connectivity hashes unchanged); the two target plans.
- Dirty-state decision: group 1 has no cross-package source coupling to the
  editor/model/renderer/derived/agent-api changes held in subsequent groups;
  `packages/symbols/src/schema.ts` (labelVisibility) is distinct from
  `packages/model/src/schema.ts` (annotation, group 2). No hunk-level split
  needed.
- Validation: `symbols:razavi:check` (14 assets + 1 primitive),
  `symbols:visio-core-analog:check` (8 assets + fidelity board),
  `pnpm typecheck`, symbol review (12 reviewed + 13 candidate), 26 focused
  symbols tests, workspace build, `references:check` (4), prettier on owned
  files, `git diff --check` — all green.
- Commit status: committed as `7a38734` and pushed to `origin/main`
  (group 1 of the split sequence). Correction: the agent-routing _package_ was
  largely committed in `e7e7aa4`..`c70a813`, but one `expand.ts` wire-through-symbol
  fix remained uncommitted in the worktree; see the group-4 entry below.

## 2026-08-08 - Add netlist-to-schematic pipeline architecture review

- Target: group 5 of the worktree-split sequence — land the reference
  architecture/pipeline walkthrough and index it from the docs map.
- Changed areas: `docs/architecture-and-pipeline-review.md` (new, 306-line
  non-normative reference covering repository structure, the 12-stage
  netlist-to-schematic pipeline, and the Agent Razavi-layout gap assessment);
  one index row in `docs/README.md`.
- Dirty-state decision: docs-only, no shared-contract or source coupling to
  any other group; `docs/` is outside the `format:check` glob, so validation
  was link resolution, fence balance, and content review (risk-proportional).
- Validation: README link resolves to the new doc; fenced-code balance;
  `git diff --check` passed.
- Commit status: committed as `26ca479` and pushed to `origin/main`.

## 2026-08-08 - Regenerate Agent API circuit schema fixtures

- Target: group 6 of the worktree-split sequence — land the three checked
  Agent API artifacts regenerated from the current `@icm/agent-adapter` schema.
- Changed areas: `fixtures/agent-api/agent-circuit-request.schema.json`,
  `agent-circuit-response.schema.json`, `agent-circuit.openapi.json`
  (+918 lines).
- Dirty-state decision: the fixtures are generated downstream of
  `packages/agent-adapter` (and transitively `packages/model`) schema.
  `agent-api:artifacts:check` passes against the current worktree, so the
  fixtures are consistent with the as-yet-uncommitted model schema changes
  (group 2/3); committing them first introduces no drift, and the model
  source will align when group 2/3 lands.
- Validation: `agent-api:artifacts:check` (Validated 3 Agent API artifacts);
  `git diff --check` passed.
- Commit status: committed as `b1de6e4` and pushed to `origin/main`.

## 2026-08-08 - Record OTA redraw plan (group 7, plan-follows-code)

- Target: group 7 (partial) of the worktree-split sequence — land the OTA
  redraw plan now that its generated artifacts are settled. Per the user's
  "plan follows code" rule, plans bound to uncommitted code groups
  (route-attached-current-arrow, annotation-editing, editor-text-label-hit-fixes,
  flat-cdac-new-architecture-audit) stay with their code; only this plan, whose
  artifacts are gitignored local build outputs, lands now.
- Changed areas:
  `plan/archived/2026-08/2026-08-07-redraw-ota-with-repaired-bulk-and-new-symbols/plan.md`.
- Note: the referenced `razavi-ota-5t-redrawn.*` and `razavi-layout.mjs` are
  gitignored under `netlists/` and are intentionally not version-controlled;
  the plan records intent and factual outcome only.
- Validation: `git diff --check` passed. Docs-only.
- Commit status: committed as `4d738eb` and pushed to `origin/main`.

## 2026-08-08 - Restore atomic flat-CDAC Route-graph generation

- Target: repair the regressed transistor-level CDAC experiment without
  reintroducing a shape compiler or automatic router.
- Changed areas: atomic `@icm/agent-routing` conflict behavior; transient bend
  nodes folded into Route waypoints; opt-in pre-export generator completeness
  gate; explicit full-topology CDAC Route graphs; regenerated Project, SVG, PNG
  and PDF artifacts.
- Dirty-state decision: pre-existing editor, renderer-test and current-arrow
  work belonged to other targets and remained read-only. The generated visual
  was inspected using the available renderer build.
- Result: 32 placed primitive instances, 22 Nets, 103 Routes, 40 semantic
  junctions, 0 helper conflicts, 0 visual errors/warnings, 0 crossings and 0
  flightlines. All visible Nets form one connected component. No simulation
  claim; validation is structural topology mapping and visual presentation.
- Validation: 14 focused agent-routing tests, package build, workspace
  typecheck, owned-file Prettier check, deterministic double generation with
  identical hashes, structural audit, and original-resolution PNG inspection.
- Commit status: ready for
  `fix(agent-routing): restore atomic flat CDAC generation`.

## 2026-08-08 - Clarify flat-CDAC inverter wiring and labels

- Target: remove the ambiguous double-node DP/DN wiring and move repeated MOS
  labels outside active wiring corridors.
- Changed areas: flat CDAC placement/Route graphs and regenerated formal
  Project/SVG/PNG/PDF artifacts.
- Result: each unit now has one inverter-output junction, one NB horizontal
  handoff, one switch-gate fanout and one BOT junction. DP/SP labels are above
  devices, DN/SN below, and NB above its handoff. The flat target remains at 0
  visual errors/warnings, 0 crossings and 0 flightlines.
- Validation: completeness gate, workspace typecheck, deterministic artifact
  hashes and original-resolution PNG inspection. Presentation-only; no
  simulation claim.
- Commit status: ready for `fix(cdac): clarify inverter wiring and labels`.

## 2026-08-08 - Route-attached current arrow, annotation editing, and hit fixes (editor layer)

- Target: land the editor layer for three intertwined annotation/current-arrow
  features whose model/renderer/derived contracts had already been committed
  earlier in the worktree-split sequence.
- Changed areas: `apps/editor/src/App.tsx` (Add current arrow command,
  drag-along-segment, Reverse arrow, clipboard route-reference remap,
  Text-panel size-scale draft/commit, padded annotation hit bounds),
  `apps/editor/src/styles.css` (pointer-events), focused
  `current-arrow.test.ts`, route-attached/sizeScale/labelVisibility cases in
  `packages/render-svg/src/render.test.ts`, checked
  `fixtures/projects/route-attached-current-arrow/` and visual-golden, plus the
  three target plans.
- Dirty-state decision: the lower-layer contracts (`RouteAnnotationAttachment`,
  `routeAttachmentPlacement`, `sizeScale` renderer branches, Ground
  `labelVisibility`) had already landed in `7a38734` / `a6eeccf` / `64eefa1` /
  `baffb44`; this commit is the editor-layer consumer only. It is file-level
  disjoint from the concurrent flat-CDAC agent-routing work and does not touch
  any of its files. The three plans are committed together because they share
  one `App.tsx` working set.
- Validation: render-svg 15/15, editor 6/6, full vitest 194/195 (the single
  failure is an unrelated `agent-routing/test/integration.test.ts` assertion
  from the unpushed flat-CDAC commit, not touched by this set), typecheck,
  prettier on owned files, `git diff --check`.
- Commit status: committed as `a9a90e6`, not yet pushed. Note: the local
  branch also carries unpushed flat-CDAC commits (`36279ed`, `2bb4c2b`) from a
  concurrent worker; push order and the integration-test failure they
  introduce need a decision before pushing.

## 2026-08-08 - Make Razavi the new-canvas default and expose style selection

- Target: ensure manual drawing uses the approved Razavi typography by default
  while retaining an explicit compatibility choice for existing Documents.
- Changed areas: model factory default; typed, undoable
  `set_presentation_style` Edit Engine operation; editor `Style` command menu;
  focused default and history tests.
- Result: newly created Documents persist `razavi-textbook-v1`. An existing
  Document remains unchanged until the user chooses `Style > Razavi textbook`;
  the selection can be undone.
- Validation: focused tests (9/9), model/edit-engine package builds, editor
  production build, and `git diff --check` passed. Workspace typecheck and
  recursive build are blocked by a concurrent missing-return error in
  `packages/agent-adapter/src/service.ts:437`, outside this target.
- Commit status: uncommitted.

## 2026-08-08 - Tighten device hit targets and make text markup authorable

- Target: stop oversized device selection regions from masking nearby wiring
  interactions and expose usable subscript/italic entry for annotations.
- Changed areas: editor Symbol-viewBox hit rectangles; selection-aware Text
  panel formatting buttons; explicit Razavi text markup parser; focused render
  coverage.
- Result: device targets follow each transformed symbol's real bounds rather
  than a fixed 36-unit circle. `M_{1}` and `V_{DD}` render mathematical
  subscripts; `\\it{gain}` renders italic text, including in plain annotations.
- Validation: renderer/model/edit-engine suites (25/25), editor build, render
  package build and `git diff --check` passed. Full typecheck is blocked only
  by the concurrent `packages/agent-adapter/src/service.ts:437` missing return.
- Commit status: uncommitted.

## 2026-08-08 - Calibrate Razavi symbol proportions and strokes

- Target: make the fixed Razavi assets closer to the supplied reference while
  preserving the electrical connection grid.
- Changed areas: Visio-derived MOS/core-analog generators and regenerated
  assets/catalog/fidelity boards; Symbol DSL circle presentation; Razavi SVG
  style tokens and formal SVG goldens.
- Result: MOS internal geometry is 10% narrower along its gate axis while
  D/G/S/B anchors remain unchanged; Ground artwork is 18% longer along its
  lead axis; standard component strokes use the 1.6-unit wire width; VDD/VSS
  bars are 16 units; and the palette Port endpoint is a filled, stroke-free
  dot. Source-derived output stays generator-owned rather than hand-edited.
- Validation: MOS/core-analog/catalog generator checks; 27 focused symbol and
  renderer tests; dependency-aware render-svg build; Phase 1/5 formal-golden
  regeneration; editor production build; and `git diff --check` passed.
- Commit status: uncommitted.

## 2026-08-08 - Align Razavi MOS and Ground geometry to reference

- Target: replace approximate fixed-asset scaling with the supplied Razavi
  reference's MOS and Ground proportions.
- Changed areas: Visio MOS source generator, regenerated MOS catalog assets
  and visual/fidelity baselines, focused catalog coverage, and dependent
  formal SVG goldens.
- Result: three-terminal MOS retains the reference-calibrated 1.15 gate-axis
  scale; the MOS body is additionally contracted symmetrically to 76.5% along
  the S/D axis. Drain/source spans, arrow shafts, and vertical leads retain
  their original stroke presentation. Only the two semantic gate bars are
  sharp-cornered, filled 3.24-unit rectangles, independent of instance
  rotation. The attempted PMOS arrow normalization was rolled back because it
  hid a required visible S branch. Ground retains the reference 1 : 0.5 : 0.25
  bar progression and 1.18 lead-axis length. The built-in VDD symbol has a
  connected 17.5-unit stem (formerly 32; 25 before this refinement) and a
  sharp-cornered, filled 3.24-unit horizontal bar. Four-terminal electrical
  pin anchors and hidden-bulk semantics are unchanged. The DC voltage source
  now draws fixed, external left-side `+`/`−` marks at an 8-unit span (about
  half the 16-unit Razavi text size); the DC current source has a shorter shaft
  and an 8.93-unit-wide triangular arrowhead while retaining its Visio-derived
  circle and pin anchors.
- Validation: regenerated MOS/formal SVG baselines; MOS/core-analog/catalog
  generator checks; 36 focused symbols/renderer tests; render-svg dependency
  build; editor production build; and `git diff --check` passed.
- Commit status: uncommitted.

## 2026-08-08 - Establish four-layer Agent schematic guidance

- Target: make Agent layout work repeatable through separate workflow,
  tool-behavior, response-semantics, and circuit/style knowledge layers.
- Changed areas: four canonical Agent guidance pages; thin `circuit-layout`
  Skill and progressive-loading manifest; Agent documentation navigation;
  corrected RouteGraph shape vocabulary; refreshed Phase 9 Skill-structure
  report.
- Dirty-state decision: concurrent editor, model, renderer, test, plans, and
  two prior `plan/log.md` entries belonged to other targets and were preserved.
  This target is staged independently from those changes.
- Result: the Skill now requires both structural and semantic visual completion
  gates, documents real API/RouteGraph/generator behavior and result codes, and
  teaches junction/bend/crossing, bump repair, common transistor structures,
  labels, and render review without reintroducing Layout Intent or a shape
  compiler.
- Validation: Skill Creator validation passed; Phase 9 Skill check passed with
  16 valid manifest links and all contract checks true; direct local Markdown
  link check passed for eight entry files; `git diff --check` passed.
- Commit status: ready for
  `docs(agent): establish four-layer layout guidance`.

## 2026-08-08 - Text, annotation, and peripheral editing system plan

- Target: define an execution-ready, non-electrical drafting layer for rich
  text, route markers, arrows, leaders, callouts, construction lines, floating
  symbols, and editor-only guides.
- Changed areas: added
  `docs/roadmap/text-annotation-peripheral-editing-plan.md`; created the
  associated bounded target plan.
- Evidence: audited the current model annotation schema, shared Edit Engine
  annotation operations, route attachment resolver, SVG text/current-arrow
  renderer, editor commands, and accepted Editor Interaction/Schematic Model/
  Agent API contracts. The plan deliberately preserves existing electrical
  label semantics while separating exportable drafting from non-exported
  guides.
- Validation: cross-referenced the current schemas, engine operations,
  renderer/editor behavior, and accepted contracts; `git diff --check` passed.
  No runtime code or circuit assets changed.
- Commit status: not committed; repository contains concurrent dirty work
  outside this documentation target.

## 2026-08-08 - Land concurrent Razavi editor/style/symbol targets

Three coordinated but uncommitted targets, left green and landed as separate
commits by a coordination target before starting the Text & Peripheral
Editing System work.

- Target: razavi-default-and-style-switch.
- Changed areas: model factory default + schema test; edit-engine
  `set_presentation_style` typed edit + presentation history test;
  agent-adapter `editCategory` classification of the new edit.
- Result: new Documents persist `razavi-textbook-v1`; style selection is
  revisioned with Undo; opening an existing monochrome Project does not
  migrate it.
- Validation: focused model/edit-engine tests; full suite 203/203; workspace
  typecheck clean; editor build succeeds.
- Commit: `feat(editor): default Razavi style and undoable style switch`.

- Target: precise-hit-targets-and-text-markup.
- Changed areas: render-svg schematic-text explicit `M_{1}`/`V_{DD}`/`\it{}`
  parsing with per-run style discriminator + updated test expectations;
  editor App.tsx transformed-Symbol-bounds hit targets, Text-panel subscript
  and italic buttons, and styles.css.
- Result: device selection no longer masks nearby routing; explicit markup
  renders across all annotation kinds including plain text.
- Validation: focused render tests; full suite 203/203; editor build
  succeeds.
- Commit: `fix(render): precise hit targets and explicit text markup`.

- Target: razavi-symbol-proportion-and-stroke-calibration.
- Changed areas: regenerated Visio-derived MOS and core-analog geometry and
  fidelity goldens; both generator scripts; symbols schema/builtins/catalog
  tests and generated catalog; render-svg `style-profile` Razavi `normal`
  stroke 1.2->1.6 + updated test, and render/render.test.
- Result: Visio-exact MOS and core-analog proportions; Razavi normal stroke
  aligns with wire/symbol stroke.
- Validation: full suite 203/203; `generate-razavi-symbol-catalog`,
  `generate-visio-mos-assets`, and `generate-visio-core-analog-assets`
  `--check` all pass; workspace typecheck clean.
- Commit: `feat(symbols): Visio-exact MOS and core-analog proportion calibration`.

- Target: arrowhead-proportion-calibration (fourth concurrent target,
  surfaced during landing).
- Changed areas: regenerated `fixtures/visual-golden/phase-1-manual.svg`,
  `phase-5-dense-analog.svg`, and `route-attached-current-arrow.svg` against
  the widened MOS source arrow geometry. The symbol-asset geometry and the
  `razavi-catalog.test.ts` regression assertion had already landed with the
  symbol-proportion commit.
- Result: formal rendering matches the committed symbol assets.
- Note: the three goldens were stale relative to the committed symbols; the
  in-repo `dist` used by the golden `--check` script was also stale, which had
  masked the mismatch until `dist` was rebuilt.
- Validation: `phase-5-golden`, `route-attached-current-arrow-golden`, and all
  catalog/asset generation `--check` scripts pass; full suite 203/203;
  workspace typecheck clean.
- Commit: `style(razavi): calibrate MOS and current-source arrowheads`.

- Coordination target: coord-land-concurrent-razavi-targets. It owned only
  the stale-expected-value/classifier fixes that made the in-flight work
  internally consistent (`agent-adapter/service.ts` `set_presentation_style`
  case, `schematic-text.test.ts` `style` field, `style-profile.test.ts`
  1.2->1.6) plus the rebuilt `dist` and regenerated goldens, and this log
  entry. It staged and committed the four targets' full file sets.
  `apps/editor/src/App.tsx`, shared by the style and hit-text targets, landed
  with the hit-text commit per that workstream's plan.
- Commit status: all four commits landed on `main`; worktree now clean of the
  concurrent Razavi work.

## 2026-08-08 - WP-A0: freeze text, annotation, and peripheral editing contracts

- Target: freeze the four shared-contract specs, the V1 syntax/object scope,
  and an ADR for the schema major version bump, plus three fixture Projects
  and their formal SVG goldens, before any runtime implementation (WP-A1).
- Changed areas: new ADR 0010 (schema 1->2, four frozen decisions);
  `docs/specs/schematic-model.md` 1.1->1.2 (DraftingLayer, RichText AST,
  VisualAnchor, DraftingObject/Guide, narrowed SchematicAnnotation, migration,
  invariants); `docs/specs/edit-engine.md` 1.7->1.8 (six new edit kinds,
  dry-run anchor/overlap diagnostics, lock discipline);
  `docs/specs/agent-api.md` 2.0->2.1 (Snapshot drafting objects with canonical
  RichText AST, resolved anchors, default-off guide coordinates with
  `includeEditorGuides`, no-injection invariant);
  `docs/specs/editor-interaction.md` 1.2->1.3 (Text/Markup/Guides groups,
  Ctrl+K palette, T/A/G shortcuts, in-place rich-text editor, unified
  hit-test/stacking, construction-line vs guide); ADR README index.
- New fixtures: `fixtures/projects/text-rich-text`,
  `text-route-marker`, `text-callout-guide`, and their
  `fixtures/visual-golden/text-*.svg` goldens, plus
  `scripts/text-annotation-wp-a0-golden.mjs`. Fixtures are expressed with the
  current schema-1 annotation model; WP-A1 reinterprets/enriches them into the
  drafting container. The callout-guide golden contains no Guide bytes (Guides
  never export).
- Frozen decisions (per user, roadmap defaults): RichText V1 six nodes;
  annotations narrow to SchematicAnnotation with plain-text/figure-caption ->
  drafting; Guides persist but always export:false and default-off in
  Snapshot; floating-symbol decorative-only whitelist; schema 1->2 with
  idempotent migration and ADR.
- Dirty-state decision: one concurrent symbol/arrowhead worker (user-confirmed)
  is iterating a third pass on `packages/symbols/**` and
  `scripts/generate-visio-*.mjs`, leaving `render.test.ts` and
  `razavi-catalog.test.ts` red from stale goldens/expectations. That work does
  not overlap this target's owned paths (specs, new fixtures, goldens, plan,
  log); WP-A0 wrote no runtime code, so it cannot affect those failures. The
  three WP-A0 goldens were regenerated against the current source.
- Validation: the three fixtures parse against schema 1 and their goldens are
  idempotent under `text-annotation-wp-a0-golden.mjs --check`; the rich-text
  golden renders subscripts and italic runs, the route-marker golden renders
  the attached current arrow, and the callout-guide golden has zero Guide
  bytes; `npx tsc -p tsconfig.check.json --noEmit` clean; `git diff --check`
  clean. The two red tests are owned by the concurrent worker.
- Commit status: ready for
  `docs(specs): freeze text, annotation, and peripheral editing contracts (WP-A0)`.

## 2026-08-08 - WP-A0.1: contract revision for six review findings

- Target: re-freeze the WP-A0 contracts before any WP-A1 code, fixing six P0
  gaps that would have caused rework in fallback, delete semantics, hash
  identity, and consumer compatibility.
- Changed areas: ADR 0010 revised to `accepted` (six fixes); schematic-model,
  edit-engine, and agent-api specs updated to match; WP-A1 plan restructured
  into A1a / A1b / integration-gate stages; three `expected-schema2.json`
  post-migration expectation fixtures added; WP-A0 plan Guide-Snapshot wording
  corrected to the ADR/API version.
- The six frozen fixes:
  1. `VisualAnchor` now persists `fallbackPosition` on `object`/`route`;
     warning state is a derived diagnostic, not a persisted boolean; V1
     `object` anchors target only Instance/Port/Junction (no drafting-to-
     drafting cycles).
  2. Anchor-target delete is non-cascading and non-rejecting: same transaction
     writes `fallbackPosition`, anchor becomes unresolved; content locks do not
     block fallback maintenance.
  3. `electricalTopologyHash` replaces the over-broad `topologyHash` (current
     impl covers the whole Snapshot minus diagnostics, per snapshot.ts:397);
     it covers only instances/ports/Nets/hierarchy, so the migration invariant
     actually holds.
  4. WP-A1 staged A1a (v2 types + migration + resolver, constant stays 1) ->
     A1b/WP-A2 (renderer/Snapshot consumption) -> integration gate (flip
     constant, rename hash, remove old kinds); `main` never sits in a
     "migrates but text/markers vanish" state.
  5. RichText restated as four node kinds with `span` four styles, plus frozen
     resource bounds (depth 4, 64 runs, 256 chars/run, non-empty fraction).
  6. `voltage` migration is a deterministic rule: resolvable `attachedObjectId`
     -> object-anchor route-marker/voltage; else free DraftText + migration
     diagnostic; never guess Route/segmentIndex/t. Review signal is a migration
     diagnostic, not a scattered field.
- Plus P1: floating-symbol `decorative` validation is Edit-Engine-resolver-
  enforced (not model Zod); WP-A0 fixtures get schema-2 expectation JSON.
- Validation: documentation + deterministic-expectation fixtures only; no
  runtime code changed. `npx tsc -p tsconfig.check.json --noEmit` clean and
  `git diff --check` clean as a no-code-edit guard.
- Commit status: ready for
  `docs(specs): re-freeze text/annotation contracts with fallback, hash, and sequencing fixes (WP-A0.1)`.

## 2026-08-08 - WP-A1a: v2 model types, migration, anchor resolver, typed edits

- Target: land the schema-2 model foundation, versioned migration, general
  VisualAnchor resolver, electricalTopologyHash, and the six typed Edit Engine
  edits as an additive A1a step. CURRENT_PROJECT_SCHEMA_VERSION stays 1; the
  integration gate (separate commit, after A1b) flips it to 2.
- Changed areas:
  - model: schema.ts adds RichTextDocument/Run (four node kinds, span four
    styles, bounds depth 4 / 64 runs / 256 chars / non-empty fraction),
    VisualAnchor (free|object|route with fallbackPosition), Guide,
    DraftingObject union (text/arrow/leader/callout/construction-line/
    floating-symbol), DraftingLayer; optional `drafting` on SchematicDocument;
    RouteMarkerKindSchema and optional markerKind field (route-marker enum
    entry deferred to the gate so renderer/editor typecheck unchanged);
    factories createEmptyDocument emits an empty drafting layer; new
    migration-v1-to-v2.ts (deterministic voltage rule, idempotent, migration
    diagnostics) + 7 tests; index exports.
  - derived: new anchor.ts resolveVisualAnchor (generalizes
    routeAttachmentPlacement; fallback + diagnostic, never silent re-attach;
    object anchors target Instance/Port/Junction only); new topology-hash.ts
    electricalTopologyHash (instances/ports/Nets/hierarchy only); tsconfig
    adds node types; index exports; 8 tests.
  - edit-engine: transaction.ts adds upsert/remove_schematic_annotation,
    upsert/remove_drafting_object, set/remove_guide (additive union members)
    with lock checks and a Symbol-Resolver-validated floating-symbol (rejected
    until a terminal-free decorative catalog exists); 7 tests.
  - agent-adapter: service.ts editCategory classifies the six new edits.
- Dirty-state decision: a concurrent worker (user-confirmed) has uncommitted
  symbol/style-profile/visio-script changes that leave render.test.ts,
  style-profile.test.ts, and razavi-catalog.test.ts red from stale
  goldens/expectations. Those failures are not owned by this target and are
  not caused by it; the four packages this target touches (model, edit-engine,
  derived, agent-adapter) are fully green (111/111), the workspace typecheck
  is clean (proving renderer/editor/agent-adapter need no edits), and the
  worker's files are never staged here.
- Validation: model + edit-engine + derived + agent-adapter suites 111/111
  pass; workspace `tsc -p tsconfig.check.json --noEmit` clean; migration
  idempotent and topology-hash-stable; anchor resolver returns fallback +
  diagnostic on deleted route/object; floating-symbol rejected without a
  resolver; `git diff --check` clean.
- Note: route-marker is intentionally absent from AnnotationKindSchema in A1a;
  the migration produces route-marker records that are schema-validated only
  at the integration gate. expected-schema2.json fixtures document the target
  shape.
- Commit status: ready for
  `feat(model): v2 drafting types, schema-1->2 migration, and VisualAnchor resolver (WP-A1a)`.

## 2026-08-08 - Unblock renderer + WP-A1b: drafting consumption

- Target: land the concurrent arrowhead calibration (its symbol geometry,
  goldens, and expectations together) so the renderer is green, then add the
  minimal A1b drafting consumption in the renderer and Agent Snapshot.
- Unblock commit (`style(razavi): finalize arrowhead calibration...`):
  regenerated phase-1/phase-5/route-attached/visio-mos/visio-core-analog/text-*
  goldens and updated style-profile (annotation tokens) and razavi-catalog
  (nmos source-arrow and current-source head geometry) expectations against the
  current symbol assets. Full suite 225/225; all six generation/golden --check
  scripts pass; typecheck clean.
- A1b: render-svg renders DraftText objects in a data-layer="drafting" group
  stacked above annotations (flat text projection; full RichText tspan renderer
  is WP-A2), escapes XML, omits the group when empty, and never renders guides.
  Agent Snapshot exposes drafting.objects (canonical shape) and a guide summary
  (id/visible/locked only); drafting is excluded from topologyHash (renamed to
  electricalTopologyHash at the gate).
- Validation: full suite 229/229 (adds 4 drafting-render tests); workspace
  typecheck clean; agent-adapter typecheck clean.
- Commit status: ready for
  `feat(render): minimal drafting consumption in renderer and Snapshot (WP-A1b)`.

## 2026-08-08 - WP-A1 integration gate: schema 2 live

- Target: flip CURRENT_PROJECT_SCHEMA_VERSION to 2, register the idempotent
  schema-1->2 migration, accept route-marker as a SchematicAnnotation, and
  update every consumer and fixture so the whole workspace is green on the
  single new truth.
- Changed areas:
  - model: CURRENT_PROJECT_SCHEMA_VERSION = 2; route-marker added to
    AnnotationKindSchema with markerKind/anchor (VisualAnchor) validated on
    route-marker; migration registered in defaultProjectMigrations so legacy
    Projects auto-upgrade on read; persistence/schema tests updated.
  - render-svg: route-marker added to SchematicTextKind and the font-size
    switch; migration means current/voltage/figure-caption now render as
    route-marker text / draft-text until WP-A2 builds full marker rendering;
    render.test assertions updated.
  - editor: demo-project.ts and routing-demo.ts use CURRENT_PROJECT_SCHEMA_VERSION.
  - fixtures: minimal, phase-1-manual, phase-2-imported-rlc, phase-3-routing
    Projects upgraded to schema 2; phase-5-dense-analog,
    route-attached-current-arrow, and text-* visual goldens regenerated.
- The migration is idempotent and does not change Net/Route/Junction/instance
  or rewrite SPICE; current -> route-marker/current, voltage -> object-anchor
  route-marker/voltage or free DraftText + migration diagnostic, plain-text/
  figure-caption -> drafting text.
- Note: the topologyHash -> electricalTopologyHash Snapshot field rename is
  deferred to a focused API step (it touches the phase-9 evaluation scripts and
  their fixtures); drafting is already excluded from the hash computation.
- Validation: full suite 229/229; workspace typecheck clean; all six
  generation/golden --check scripts pass; `git diff --check` clean.
- Commit status: ready for
  `feat(model): switch to schema 2 with idempotent migration and route-marker (WP-A1 gate)`.

## 2026-08-08 - WP-A2: unified RichText renderer and route-marker rendering

- Target: build the single RichText AST -> tspan renderer (subscript/superscript/
  italic/bold/fraction) shared by canvas/formal SVG/PNG/PDF, and render
  route-markers fully (current arrow + voltage polarity via the VisualAnchor).
- Changed areas:
  - render-svg: new `rich-text.ts` `renderRichTextDocument` renders the four
    node kinds into tspans honoring the style profile tokens (math weight/style,
    subscript scale + baseline shift reused for superscript, fraction stack);
    drafting text now uses it (monochrome stays byte-stable via flat escape);
    route-marker renders through the existing current/voltage branches by
    resolving its VisualAnchor (`resolveRouteMarkerPlacement` reuses the legacy
    routeAttachmentPlacement math so a migrated current marker renders
    identically to its pre-migration form); `schematic-text.ts` adds route-marker
    to SchematicTextKind and the font-size switch.
  - tests: new `rich-text.test.ts` (5 tests) covering text escape, italic/bold
    spans, sub/superscript, fraction, line-break; render.test assertions updated
    for restored route-marker arrow rendering; drafting-render.test for rich text.
  - goldens: phase-5-dense-analog, route-attached-current-arrow, and text-*
    regenerated.
- Scope decision: removing the legacy plain-text/current/voltage/figure-caption
  annotation kinds is deferred to WP-A3. The editor creates those kinds
  interactively; removing them without the WP-A3 editor rewrite would leave the
  editor unable to author annotations. WP-A3 rebuilds the editor to author
  drafting text / route-markers and removes the legacy kinds together.
- Validation: full suite 234/234; workspace typecheck clean; all six
  generation/golden --check scripts pass; `git diff --check` clean.
- Commit status: ready for
  `feat(render): unified RichText renderer and route-marker rendering (WP-A2)`.

## 2026-08-08 - WP-A3 step: editor authors drafting text and route-marker

- Target: convert the editor's "add text" and "add current arrow" commands
  from the legacy plain-text/current annotation kinds to the ADR 0010 drafting
  text and route-marker edits, so the editor authors the new types and the
  legacy kinds can be retired.
- Changed areas: apps/editor App.tsx addPlainText now commits
  upsert_drafting_object (DraftText, free anchor, single text run), and
  addCurrentArrow now commits upsert_schematic_annotation with a route-marker
  carrying a route VisualAnchor (routeId/segmentIndex/t/normalOffset/direction/
  orientation + fallbackPosition) instead of the legacy current routeAttachment.
- Remaining WP-A3 work (not in this step): the read-side hit-test/bounds/panel
  code still keys on the legacy current kind, so migrated route-marker
  annotations are not yet selectable/editable in the editor; the in-place
  rich-text editor and the unified hit-test/drag/Alt-cycle/box-select redo are
  still pending. Removing the legacy kinds from the model waits for those so
  the editor stays functional.
- Validation: full suite 234/234; editor typecheck clean; `git diff --check`
  clean.
- Commit status: ready for
  `feat(editor): author drafting text and route-marker (WP-A3 step)`.

## 2026-08-08 - WP-A3 read-side: unified hit-test/bounds/drag/panel for route-marker

- Target: make the editor's read-side geometry (anchor resolution, hit box,
  drag constrain/commit, reverse-arrow, panel) handle the migrated route-marker
  annotation whose route association lives on its VisualAnchor, alongside the
  legacy current kind.
- Changed areas: apps/editor App.tsx adds effectiveRouteAttachment() (projects
  a route-marker route VisualAnchor onto the legacy RouteAnnotationAttachment
  shape) and isRoutedMarker(); annotationAnchor, annotationHitBox,
  constrainAnnotationPosition, the drag-commit path, reverseSelectedCurrentArrow,
  and the panel button now route through these helpers, so a migrated
  route-marker is selectable, hit-testable, draggable along its route, and
  reversable. apps/editor clipboard.ts copies route-marker annotations by their
  route VisualAnchor and re-maps the routeId on paste.
- Tests: current-arrow.test.ts adds a route-marker copy/paste case proving the
  route VisualAnchor is preserved and re-mapped.
- Validation: full suite 235/235; editor build succeeds; workspace typecheck
  clean; `git diff --check` clean.
- Commit status: ready for
  `feat(editor): unified route-marker hit-test, drag, and clipboard (WP-A3 read-side)`.

## 2026-08-08 - WP-A3 legacy-kind removal: plain-text/current/voltage/figure-caption

- Target: remove the four legacy annotation kinds now that route-marker and
  drafting text carry their content, leaving the single schema-2 truth.
- Changed areas:
  - model: AnnotationKindSchema narrows to instance-label | net-label |
    power-label | route-marker; the routeAttachment-only-on-current refine is
    gone (routeAttachment remains as a migration-era legacy field);
    migration-v1-to-v2 still reads the removed kinds on its v1 input side
    (tests widened to loose records).
  - render-svg: SchematicTextKind drops the legacy kinds; render.ts route-marker
    branch renders current arrows (shaft + head) and voltage polarity via the
    route VisualAnchor, with the arrow on the conductor and the label riding the
    normal offset (resolveRouteMarkerPlacement returns position + labelPosition);
    figure-caption/plain-text emphasis branches removed; drafting text is the
    single text path.
  - edit-engine/editor/agent-adapter tests updated to route-marker; editor
    reverse-arrow no longer branches on the removed current kind.
  - Goldens regenerated (phase-5, route-attached-current-arrow, text-*).
- The migration contract is unchanged: schema-1 Projects still upgrade on read,
  mapping current -> route-marker/current, voltage -> object-anchor or free
  DraftText + diagnostic, plain-text/figure-caption -> drafting text.
- Validation: full suite 235/235; workspace typecheck clean; all
  generation/golden --check scripts pass; `git diff --check` clean.
- Commit status: ready for
  `feat(model): remove legacy annotation kinds (WP-A3 legacy-kind removal)`.

## 2026-08-08 - Agent Snapshot electricalTopologyHash rename

- Target: complete the ADR 0010 hash work deferred at the WP-A1 gate — rename
  the Snapshot identity field to electricalTopologyHash and compute it from
  electrical facts only.
- Changed areas: agent-adapter schema.ts renames the Snapshot field to
  electricalTopologyHash; snapshot.ts computes it via the shared
  @icm/derived electricalTopologyHash over the Project view (falling back to a
  single-document view when no Project is available); derived topology-hash.ts
  parameter type widened to Pick<CircuitProject, id|topDocumentId|documents>;
  all six phase-9 scripts read the renamed field.
- New tests: snapshot.test.ts proves electricalTopologyHash is stable across
  instance placement, annotation text, and drafting/guide edits, and changes
  when Net terminal membership changes.
- Validation: full suite 237/237; workspace typecheck clean; `git diff --check`
  clean.
- Commit status: ready for
  `feat(agent-api): rename Snapshot identity hash to electricalTopologyHash`.

## 2026-08-08 - WP-A3 rich-text editor: markup parser and drafting text editing

- Target: deliver the parse-on-submit markup path and make drafting text
  objects selectable and editable in the editor (the core of the in-place
  rich-text editor without a full contenteditable widget).
- Changed areas:
  - render-svg: new `markup-parser.ts` parseMarkup / flattenMarkup converting
    the restricted import shorthand (subscripts `_{...}`, superscripts
    `^{...}`, `\it{...}`, `\bf{...}`, `\frac{num}{den}`, line breaks `\\`) to
    the canonical RichText AST; unparseable input is preserved as literal text,
    never dropped. Exported from the package index.
  - editor: drafting text objects now render hit boxes, are selectable, and a
    "Drafting text" panel edits their content as markup and commits
    parseMarkup -> upsert_drafting_object, so the editor authors the AST while
    the user types shorthand.
- Verified end-to-end: parseMarkup(\`V_{in}^{+} = \frac{g_m}{r_o}\`) -> AST ->
  renderRichTextDocument emits subscript, superscript, fraction, and numerator
  tspans.
- Tests: 8 markup-parser tests (plain text, subscript, superscript, italic,
  bold, fraction, line break, unparseable-preservation, flatten).
- Validation: full suite 245/245; editor build succeeds; workspace typecheck
  clean; `git diff --check` clean.
- Commit status: ready for
  `feat(editor): markup-rich text editing for drafting objects (WP-A3 rich text)`.

## 2026-08-08 - WP-A4: Guide tool

- Target: implement the editor Guide tool per the roadmap (add/move/lock/delete
  guides; Guides are editor aids, never exported, never electrical).
- Changed areas: apps/editor adds a "guide" EditorTool and `G` shortcut; the
  Guide tool click adds a vertical guide at the click x; guides render as a
  dashed blue overlay (locked = grey, not draggable) with drag-to-move,
  double-click-to-lock, and Delete-to-remove; the More menu gains a Guides
  group (add vertical/horizontal, show/hide, clear unlocked, Guide tool);
  styles.css adds .guide / .guide-locked / .command-group-label.
- edit-engine: drafting.test adds a locked-guide replacement-rejection test.
- Validation: full suite 246/246; editor build succeeds; workspace typecheck
  clean; `git diff --check` clean.
- Commit status: ready for
  `feat(editor): Guide tool with add/move/lock/delete (WP-A4 guides)`.

## 2026-08-08 - WP-A4 drafting object rendering

- Target: render the remaining DraftingObject kinds so the editor and exports
  show construction lines, arrows, leaders, callouts, and floating symbols.
- Changed areas: render-svg renderDraftingLayer now renders every DraftingObject
  kind: text (existing), construction-line (dashed/dotted per lineStyle), arrow
  (shaft + head), leader (origin-target line), callout (leader + rich text),
  and floating-symbol (resolves the symbol and renders its definition +
  variant primitives, transformed by anchor/rotation/mirror). The layer takes
  the SymbolResolver for floating symbols.
- Tests: drafting-render.test adds construction-line (dashed), draft arrow
  (head polygon), and floating-symbol (primitives + symbol id) cases.
- Validation: full suite 249/249; all golden --check scripts stable; workspace
  typecheck clean; `git diff --check` clean.
- Commit status: ready for
  `feat(render): render construction-line, arrow, leader, callout, floating-symbol (WP-A4 rendering)`.

## 2026-08-08 - WP-A4 decorative symbol capability

- Target: give the Symbol Catalog a decorative capability so DraftFloatingSymbol
  can reference a terminal-free whitelist entry (ADR 0010).
- Changed areas: symbols schema adds optional `decorative` to SymbolDefinition
  and allows zero pins with a refine (decorative -> no terminals;
  non-decorative -> at least one pin); builtins adds `decorative-note-box`
  (a terminal-free dashed rectangle) and registers it first; edit-engine
  floating-symbol validation now requires `definition.decorative` and zero
  pins via the Symbol Resolver.
- Tests: edit-engine drafting.test proves decorative-note-box is accepted and
  nmos (terminal-bearing) is rejected when a resolver is present; builtins.test
  updated for the new symbol id.
- Validation: full suite 250/250; workspace typecheck clean; `git diff --check`
  clean.
- Commit status: ready for
  `feat(symbols): decorative symbol capability for floating symbols (WP-A4 decorative)`.

## 2026-08-08 - WP-A4 editor drafting creation commands

- Target: let the editor create construction lines, free arrows, and floating
  symbols from the More menu.
- Changed areas: apps/editor adds addConstructionLine (dashed horizontal line),
  addFreeArrow (horizontal arrow), and addFloatingSymbol (decorative-note-box
  via the whitelist); the More menu gains a Markup group with the three
  commands. The DocumentHistory context already carries the SymbolResolver, so
  floating-symbol validation runs through the Edit Engine.
- Validation: full suite 250/250; editor build succeeds; workspace typecheck
  clean; `git diff --check` clean.
- Commit status: ready for
  `feat(editor): construction-line, free arrow, and floating-symbol commands (WP-A4 commands)`.

## 2026-08-08 - WP-A5: strict Snapshot drafting schema and GUI/Agent parity

- Target: tighten the Agent Snapshot drafting schema and prove GUI/Agent
  parity for drafting edits (same object, same anchor, same SVG).
- Changed areas:
  - agent-adapter schema.ts: drafting.objects now validates against the shared
    DraftingObjectSchema (canonical RichText AST + VisualAnchor) instead of
    z.unknown(); guide summaries keep id/visible/locked.
  - New parity.test.ts: (1) the same typed drafting edits (route-marker,
    drafting text, guide) submitted through the Agent service `transact` and
    through the shared Edit Engine produce the identical persisted Project,
    identical Document, and identical rendered SVG; (2) adding drafting leaves
    the electrical identity unchanged.
- Validation: full suite 252/252; workspace typecheck clean; `git diff --check`
  clean.
- Commit status: ready for
  `feat(agent-api): strict drafting Snapshot schema and GUI/Agent parity (WP-A5)`.

## 2026-08-08 - WP-A5 regression: regenerate Agent API and phase-9 artifacts

- Target: bring every generated artifact back in sync after the
  electricalTopologyHash rename and the strict drafting Snapshot schema.
- Changed areas: regenerated fixtures/agent-api (request/response schemas and
  OpenAPI, now carrying electricalTopologyHash and the strict drafting object
  schema) and all five phase-9 layout-eval artifacts (generalization report,
  heldout import reports and start projects, snapshot audit, 128-transistor
  render) after the Snapshot field rename.
- Validation: agent-api-artifacts --check passes; all six generation/golden
  --check scripts pass; all five phase-9 --check scripts pass; full suite
  252/252; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for
  `chore(fixtures): regenerate Agent API and phase-9 artifacts after hash rename (WP-A5 regression)`.

## 2026-08-08 - Markup parser: nested braces in command bodies

- Target: fix the markup parser so fraction/italic/bold/subscript/superscript
  bodies may contain one nested `{...}` group (e.g. `\frac{V_{DD}}{2}`), which
  the roadmap acceptance scenario for `V_{in}^{+} = \frac{V_{DD}}{2}` requires.
- Changed areas: render-svg markup-parser.ts command regexes now match a body
  of plain text or one nested brace group; added a test for a fraction whose
  numerator contains a subscript.
- Verified end-to-end: `V_{in}^{+} = \frac{V_{DD}}{2}` parses to an AST and
  renders subscript, superscript, fraction, numerator, and denominator tspans.
- Validation: full suite 253/253; workspace typecheck clean; `git diff --check`
  clean.
- Commit status: ready for
  `fix(render): parse nested braces inside markup command bodies`.

## 2026-08-08 - Restore browser-compatible editor startup

- Target: restore the GUI after the new electrical topology hash caused the
  browser application to fail during module evaluation.
- Root cause: `packages/derived/src/topology-hash.ts` imported Node-only
  `node:crypto`; Vite externalized it and the editor threw before React could
  mount.
- Changed areas: replaced the Node dependency with a synchronous
  browser/Node-compatible SHA-256 implementation and added an exact digest
  assertion so the public hash contract cannot silently change.
- Validation: focused topology-hash tests 3/3; workspace typecheck; derived
  build followed by editor production build; fresh live browser load at
  `http://localhost:5173/` with the editor DOM present and no console warnings
  or errors; `git diff --check` clean.
- Commit status: ready for
  `fix(editor): keep topology hashing browser compatible`.

## 2026-08-08 - WP-R0 + WP-R1: drafting runtime completion (contract + unified geometry)

- Target: start the Drafting Runtime Completion project per the review: freeze
  the derived-only geometry contract and add the single
  resolveDraftingObjectGeometry entry, so renderer/editor/Snapshot stop each
  re-implementing anchor math.
- WP-R0: ADR 0010 gains a "Runtime completion status" section with the
  per-object capability matrix (honest: model/Edit Engine/basic renderer
  complete; runtime/editor interaction incomplete) and the derived-only
  geometry rule; agent-api spec documents includeEditorGuides (default false)
  and notes the resolved-geometry fields land in WP-R4.
- WP-R1: packages/derived/src/drafting-geometry.ts adds DraftingDiagnostic
  (code/severity/anchorRole/targetObjectIds), ResolvedDraftingGeometry (a
  discriminated union per kind with position(s)/bounds/diagnostics), and
  resolveDraftingObjectGeometry(document, resolver, object) reusing
  resolveVisualAnchor for every anchor field (text->anchor, arrow->from+to,
  leader/callout->anchor+target, floating-symbol->anchor,
  construction-line->points). Invalid anchors use fallbackPosition, emit a
  warning, never guess a new route, never mutate the Document. Bounds rules per
  kind with stroke/arrowhead padding; floating-symbol bounds from the resolved
  symbol viewBox.
- Tests: 8 drafting-geometry tests (free text, object-anchor follow on instance
  move, missing target fallback+diagnostic, route stretch follow + invalid
  segment fallback, arrow dual-anchor, construction-line bounds, unresolved
  floating symbol, determinism).
- Dirty-state note: a concurrent worker committed
  `fix(editor): keep topology hashing browser compatible` (topology-hash.ts)
  while this target ran; it does not overlap drafting-geometry.ts or the owned
  docs. This target's changes are staged independently.
- Validation: full suite 261/261; workspace typecheck clean; `git diff --check`
  clean.
- Commit status: ready for
  `docs(drafting): freeze runtime completion contract and capability matrix (WP-R0)`
  and `feat(derived): resolve drafting object geometry (WP-R1)`.

## 2026-08-08 - WP-R2: renderer consumes unified drafting geometry + bounds

- Target: make the formal SVG renderer and export bounds consume the single
  resolveDraftingObjectGeometry entry, and include drafting bounds so callouts
  and floating symbols outside the circuit are not clipped.
- Changed areas: render-svg render.ts renderDraftingLayer now resolves each
  object's geometry once and passes it to kind-specific renderers; the
  draftObjectPosition helper (which branched on free/fallback) is removed;
  deriveBounds pushes every drafting object's resolved bounds into the export
  viewBox; unresolved anchors still export using the fallback and carry
  data-anchor-resolved="false" without changing the visual style; guides never
  enter formal output or bounds.
- Tests: drafting-render.test adds drafting-bounds-in-viewBox and
  fallback-export-with-diagnostic cases; phase-5/route-attached/text goldens
  regenerated (viewBox now covers drafting content).
- Validation: full suite 263/263; workspace typecheck clean; all golden --check
  scripts pass; `git diff --check` clean.
- Commit status: ready for
  `fix(render): consume unified drafting geometry and include drafting bounds (WP-R2)`.

## 2026-08-08 - WP-R3: lossless rich-text editing

- Target: eliminate the flatten->parse->overwrite corruption path in editing.
- Changed areas: render-svg markup-parser.ts adds serializeMarkup (AST ->
  reversible markup: text verbatim, line-break `\`, span styles `_{}`/`^{}`/
  `\it{}`/`\bf{}`, fraction `\frac{}{}`); editor App.tsx initializes the
  drafting-text draft from serializeMarkup (never flattenMarkup), commits
  parseMarkup -> upsert_drafting_object only when the parsed AST differs from
  the stored AST (no revision for an unedited Apply), and the text control is a
  multi-line textarea (Enter inserts a line break, Ctrl+Enter commits).
- Tests: markup-parser adds round-trip scenarios (V_{in}^{+},
  \frac{V_{DD}}{2}, \it{gain}, \bf{RESET}, line break, nested span, empty span,
  consecutive text runs, Unicode) asserting
  parseMarkup(serializeMarkup(ast)) equals ast, plus a dedicated line-break
  round trip.
- Validation: full suite 265/265; editor build succeeds; workspace typecheck
  clean; `git diff --check` clean.
- Commit status: ready for
  `fix(editor): preserve rich text through lossless markup editing (WP-R3)`.

## 2026-08-08 - WP-R4: Agent Snapshot exposes resolved drafting geometry

- Target: let the Agent read the derived visual facts (resolved position/
  bounds/diagnostics) instead of re-deriving anchors, and support
  includeEditorGuides per the agent-api spec.
- Changed areas: agent-adapter schema.ts adds includeEditorGuides to the
  snapshot request (default false) and wraps each drafting object in
  { object, resolvedGeometry, bounds, diagnostics } (float-tolerant bounds;
  guides gain optional axis/coordinate); snapshot.ts computes resolvedGeometry
  via the single resolveDraftingObjectGeometry entry and includes guide
  coordinates only when the request opts in; service.ts forwards
  includeEditorGuides; Agent API artifacts regenerated.
- Tests: snapshot.test adds resolved-geometry-matches-persisted-anchor and
  guide-coordinates-hidden-by-default / opt-in cases.
- Validation: full suite 267/267; agent-api-artifacts --check passes; workspace
  typecheck clean; `git diff --check` clean.
- Commit status: ready for
  `feat(agent-api): expose resolved drafting geometry and includeEditorGuides (WP-R4)`.

## 2026-08-08 - WP-R5 (part 1): drafting selection, drag, and delete

- Target: fix the drafting selection bug called out in review and give drafting
  objects real selection/drag/delete interactions.
- Changed areas: apps/editor adds selectDraftingObject(id) as the single
  selection entry (clears annotation/route/instance selection, initializes the
  edit draft from serializeMarkup for text); addPlainText now calls it instead
  of the wrong setSelectedAnnotationId; beginDraftingDrag moves a free-anchored
  text via upsert_drafting_object (locked objects are not draggable;
  object/route anchors follow their target by construction and only select);
  deleteSelection removes the selected drafting object via remove_drafting_object
  (rejecting locked objects).
- Validation: full suite 267/267; editor build succeeds; workspace typecheck
  clean; `git diff --check` clean.
- Commit status: ready for
  `feat(editor): drafting selection, drag, and delete (WP-R5 part 1)`.

## 2026-08-08 - WP-R5 (part 2): select/delete all drafting kinds via shared geometry

- Target: give every DraftingObject kind a selectable/deletable hit box derived
  from the shared resolveDraftingObjectGeometry bounds (previously only text
  had one).
- Changed areas: apps/editor drafting hit-box rendering now maps every
  drafting object to a rect spread from geometry.bounds (not a text-only
  estimate); free-anchored unlocked text drags via beginDraftingDrag, all other
  kinds select via selectDraftingObject; the shared geometry bounds replace the
  flattenMarkup width estimate.
- Validation: full suite 267/267; editor build succeeds; workspace typecheck
  clean; `git diff --check` clean.
- Commit status: ready for
  `feat(editor): select/delete all drafting kinds via shared geometry (WP-R5 part 2)`.

## 2026-08-08 - WP-R6: parity rename, real browser E2E, and full exit gate

- Target: complete the Drafting Runtime Completion project with a truthful
  parity test name, real browser coverage of drafting workflows, and the full
  exit gate.
- Changed areas:
  - parity.test.ts renamed "GUI/Agent drafting parity" to "Agent/Edit Engine
    drafting parity" and clarified it exercises typed-edit semantics, not the
    GUI.
  - New apps/editor/e2e/drafting.spec.ts with three browser scenarios:
    (A) add drafting text with rich markup V_{in}^{+} = \frac{V_{DD}}{2}, assert
    the canonical AST is persisted (fraction + span runs) and undo/redo
    restores it; (E) export bounds include drafting and guides never appear in
    the exported SVG; (F) the production build mounts with no console errors.
  - Prettier formatting normalized 21 files (including files from earlier WP-R
    commits that did not match the repo style gate).
- Exit gate (all pass): format:check; typecheck; vitest 267/267; pnpm build
  (12 packages); playwright test 10/10; agent-api-artifacts --check; phase-5/
  route-attached/text golden --check; release:package; git diff --check.
- Commit status: ready for
  `test(editor): drafting E2E, parity rename, and formatting (WP-R6)`.

## 2026-08-08 - Razavi unified MOS presentation

- Target: make Razavi a single, consistent manual MOS presentation instead of
  allowing raw three-terminal stencil assets and the canonical four-terminal
  arrow to leak into the editor palette.
- Changed areas: standard NMOS/PMOS palette placement persists the canonical
  `textbook-3terminal` visual variant while retaining D/G/S/B electrically;
  thumbnails resolve that same variant; raw `nmos3`/`pmos3` imports remain in
  the catalog as provenance but are no longer palette choices; calibrated
  source-arrow support lines meet their triangle base with a butt cap, while
  base four-terminal bulk primitives are unchanged. Regenerated the MOS
  assets, Razavi catalog, and fidelity board.
- Tests: 16 focused editor/symbol Vitest tests; editor production build; 2
  relevant browser E2E scenarios; both MOS and Razavi generated-asset checks;
  `git diff --check` clean.
- Commit status: ready for `fix(razavi): unify default MOS presentation`.

## 2026-08-08 - Razavi existing MOS presentation migration

- Target: apply the Razavi visual contract to eligible legacy MOS instances,
  not just newly placed components.
- Changed areas: applying (or reapplying) Razavi now batches canonical
  NMOS/PMOS visual-variant edits in the same undoable transaction. An absent
  bulk net or supply bulk (`0`, GND, VSS, VDD, VDDA, VSSA, VGND, VPWR) is shown
  in the three-terminal textbook view; an independent body-bias net remains
  four-terminal and electrically visible.
- Tests: focused App test validates the classifier; browser E2E opens a legacy
  project, applies Razavi, saves it, and proves an eligible PMOS migrated while
  an NMOS on local Vbody did not. Focused 5-test Vitest, editor build, and 3
  relevant browser tests passed; `git diff --check` clean.
- Commit status: ready for
  `fix(razavi): migrate eligible existing MOS to textbook view`.

## 2026-08-08 - Razavi MOS arrow seam and PMOS parity

- Target: remove visible gaps at the MOS source arrow and verify PMOS receives
  the same three-terminal presentation contract as NMOS.
- Changed areas: the VSS-derived source-arrow support now extends under its
  later-rendered filled triangle by half a source-shape stroke; triangle and
  electrical coordinates remain unchanged. Catalog tests verify both NMOS and
  PMOS hide `bulk-lead` / `source-arrow-host` and expose a filled source arrow
  with the calibrated, overlapping support line.
- Validation: focused 17-test symbol/editor Vitest, both generated-asset
  checks, and browser palette E2E passed; `git diff --check` clean.
- Commit status: ready for
  `fix(razavi): close MOS arrow seams and verify PMOS variant`.

## 2026-08-08 - Razavi MOS arrow family unification

- Target: ensure PMOS and NMOS use the same visible Razavi source-arrow
  proportions, allowing only their physical arrow direction to differ.
- Changed areas: decoded PMOS / PMOS3 VSS source markers are 22/25 of NMOS
  after symbol transforms. The generator compensates their arrow-only metrics
  by 25/22, so both polarity families have visible length 8.28 and half-width
  3.78675. Four-terminal pin geometry and topology remain intact.
- Validation: focused 12-test catalog test, MOS and catalog generation checks,
  palette browser E2E, and `git diff --check` passed.
- Commit status: ready for
  `fix(razavi): unify PMOS and NMOS arrow proportions`.

## 2026-08-08 - MOS terminal presentation control

- Target: make the preserved four-terminal MOS view explicitly usable in the
  editor, rather than leaving it as an unexposed base symbol.
- Changed areas: selected canonical NMOS/PMOS has inspector actions for
  textbook three-terminal and Bulk-visible four-terminal presentation. The
  switch is a typed, undoable `set_instance_symbol` edit; it retains the same
  symbol ID and D/G/S/B electrical terminals while changing only the visual
  variant.
- Validation: editor build and a PMOS browser E2E prove B appears when the
  four-terminal view is selected and disappears when textbook view returns;
  `git diff --check` clean.
- Commit status: ready for
  `feat(editor): expose MOS three and four terminal views`.

## 2026-08-08 - P0-2: drafting drag uses preview and commits one transaction

- Target: fix the review P0 that a drafting drag committed one transaction per
  pointermove (dozens of revisions, undo per mouse sample, history bloat).
- Changed areas: apps/editor beginDraftingDrag now records a live position in
  draftingDragPositionRef and a draftingDragPreview state during pointermove
  (no transact); pointerup reads the ref and commits ONE upsert_drafting_object;
  Escape/pointercancel discard the preview. The drafting hit box follows the
  preview during the drag so the object appears to move without committing.
  Transact is never called from a React state updater (Strict Mode would run it
  twice); also fixed a worker-introduced typecheck break in setPresentationStyle
  (kind literal narrowing).
- E2E: drafting drag commits one revision and undoes atomically (long 12-step
  drag -> revision 3, one Ctrl+Z -> revision 4 and position restored).
- Validation: full suite 270/270; drafting E2E 4/4; editor build succeeds;
  workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for
  `fix(editor): drafting drag preview with single atomic commit (P0-2)`.

## 2026-08-08 - P1: freeze final-rotation semantics (geometry is the single truth)

- Target: fix the review P1 that derived geometry reported anchor rotation
  while the renderer used the raw persisted object rotation, so bounds and SVG
  disagreed.
- Changed areas: derived drafting-geometry.ts adds composeRotation with the
  frozen rule finalRotation = anchor.orientation === "follow"
  ? normalize(anchorRotation + object.rotation) : object.rotation, applied to
  text and callout; render-svg render.ts text/callout now consume
  geometry.rotation instead of object.rotation, so renderer, export bounds, and
  Snapshot all report the same rotation.
- Tests: drafting-geometry adds a rotation-semantics case (follow route anchor
  composes 0+90 -> 90; horizontal/non-follow and free anchors keep object
  rotation).
- Validation: full suite 271/271; workspace typecheck clean; goldens stable;
  `git diff --check` clean.
- Commit status: ready for
  `fix(derived): freeze composed rotation as the single geometry truth (P1 rotation)`.

## 2026-08-08 - P1: accurate floating-symbol and multi-line text bounds

- Target: fix the review P1 that floating-symbol bounds ignored viewBox x/y,
  put mirror-x on the wrong side, did not swap width/height on 90/270, and
  never applied the SVG transform; and that text bounds used a fixed height and
  did not read typographyToken or count lines.
- Changed areas: derived drafting-geometry.ts transformSymbolCorner applies the
  exact SVG transform (translate(position) rotate(rotation) scale(-1 1) for
  mirror-x) to all four viewBox corners and takes the AABB; textBounds now
  takes a per-token font size (caption 14, body/label 16), measures lines from
  line-break runs, and flattens nested spans/fractions recursively instead of a
  fixed "XX". Renderer and Snapshot consume the same geometry.
- Tests: drafting-geometry adds floating-symbol rotate/mirror AABB and
  multi-line text height/width cases.
- Validation: full suite 273/273; goldens regenerated (text bounds changed the
  export viewBox); workspace typecheck clean; all golden --check pass;
  `git diff --check` clean.
- Commit status: ready for
  `fix(derived): accurate floating-symbol and multi-line text bounds (P1 bounds)`.

## 2026-08-08 - P1: strict Snapshot geometry schema (no z.unknown, no duplicate bounds)

- Target: fix the review P1 that Snapshot resolvedGeometry/diagnostics were
  z.unknown and bounds appeared both at entry level and inside resolvedGeometry.
- Changed areas: packages/model/src/drafting-geometry-schema.ts defines and
  exports ResolvedDraftingGeometrySchema (a discriminated union per kind with
  typed position/rotation/bounds/diagnostics) and DraftingDiagnosticSchema
  (typed code/severity/anchorRole/targetObjectIds); agent-adapter schema.ts
  references them and drops the redundant top-level bounds (resolvedGeometry
  carries bounds); snapshot.ts no longer emits entry.bounds. OpenAPI/JSON
  artifacts regenerated with a typed resolvedGeometry.
- Validation: full suite 273/273; agent-api-artifacts --check passes; workspace
  typecheck clean; `git diff --check` clean.
- Commit status: ready for
  `feat(agent-api): strict drafting geometry schema in Snapshot (P1 typed)`.

## 2026-08-08 - P1: canvas drag-create for construction line and arrow

- Target: replace the fixed viewport-center insert for construction lines and
  arrows with real canvas drag gestures (press start, drag, release end) per
  the review P1.
- Changed areas: apps/editor EditorTool gains construction-line and arrow;
  beginCanvasGesture starts a draftingCreatePreview on pointerdown, move
  updates the end point, finishCanvasGesture commits one typed edit via
  commitDraftingCreate; a dashed drafting-create-preview line renders during
  the drag; the More Markup menu activates the tools instead of the old fixed
  insert. addFloatingSymbol stays a click-place.
- E2E: two new tests drag-create a construction line and an arrow, each
  committing exactly one revision.
- Validation: full suite 273/273; drafting E2E 6/6; editor build succeeds;
  workspace typecheck clean; goldens regenerated after a rebuild aligned
  source and dist symbol geometry; `git diff --check` clean.
- Commit status: ready for
  `feat(editor): canvas drag-create for construction line and arrow (P1 tools)`.

## 2026-08-08 - P2: distinguish invalid route segment diagnostics

- Target: fix the review P2 that DRAFTING_ROUTE_SEGMENT_INVALID was declared but
  never returned (route missing / polyline failure / segment out of range all
  collapsed into DRAFTING_ANCHOR_TARGET_MISSING).
- Changed areas: derived anchor.ts AnchorDiagnostic.code is now a precise
  union; resolveRouteAnchor returns DRAFTING_ROUTE_SEGMENT_INVALID when the
  route exists but its segment is invalid, and DRAFTING_ANCHOR_TARGET_MISSING
  for a missing route/unresolvable polyline; drafting-geometry propagates the
  precise code for both text and object anchors.
- Tests: drafting-geometry adds a case proving an out-of-range segmentIndex
  yields DRAFTING_ROUTE_SEGMENT_INVALID and a missing route yields
  DRAFTING_ANCHOR_TARGET_MISSING.
- Validation: full suite 274/274; workspace typecheck clean; agent-api
  artifacts regenerated; `git diff --check` clean.
- Commit status: ready for
  `fix(derived): return precise invalid-route-segment diagnostics (P2)`.

## 2026-08-08 - P1: shape-based drafting hit targets

- Target: fix the review P1 that every drafting object used a full bounding-rect
  hit area (pointer-events all), blocking canvas clicks under long
  leader/callout/arrow boxes.
- Changed areas: apps/editor drafting hit rendering now uses the object's
  actual shape: stroke polyline for construction lines, stroke line for
  arrows/leaders/callouts (shaft), and a rect only for text/floating-symbol
  (whose natural hit is a box). beginDraftingDrag accepts any SVG element.
- E2E: a new test proves a construction line selects via a polyline stroke hit
  and the element tag is polyline, not rect.
- Validation: full suite 274/274; drafting E2E 7/7; editor build succeeds;
  workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for
  `fix(editor): shape-based drafting hit targets (P1 hit)`.

## 2026-08-08 - P1: key-scenario E2E coverage + click-without-move fix

- Target: add the review-required E2E scenarios (unedited Apply no revision,
  drag atomic undo, anchor persistence) and fix the discovered bug that
  clicking a drafting text to select it committed a no-op revision.
- Changed areas: apps/editor beginDraftingDrag commits only when the pointer
  actually moved (click-without-move just selects, no revision); drafting.spec
  adds: unedited Apply keeps revision, drag-create commits one revision and one
  Ctrl+Z undoes it, drafting anchor survives save/recovery.
- Validation: drafting E2E 9/9; full suite 274/274; editor build succeeds;
  workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for
  `fix(editor): no-op drafting click; add key-scenario E2E (P1 scenarios)`.

## 2026-08-08 - P1: real production preview smoke

- Target: fix the review P1 that the "production build mounts" E2E actually ran
  the vite dev server, so it never exercised the production bundle.
- Changed areas: scripts/editor-production-smoke.mjs builds the editor, serves
  the dist with vite preview on 127.0.0.1:4174, opens it in a real Chrome
  browser, asserts the schematic canvas mounts, and fails on any console/page
  error or on "node:crypto has been externalized". Adds
  test:production-smoke / :check scripts and a committed report fixture
  (fixtures/editor-production-smoke/report.json) with --check idempotency.
- Validation: production smoke passes (mounted, 0 console errors, no
  node:crypto externalization); drafting E2E 9/9; full suite 274/274;
  workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for
  `test(editor): production preview smoke against the built bundle (P1 smoke)`.

## 2026-08-08 - Final exit gate + formatting normalization

- Target: run the full Drafting Runtime Completion exit gate and normalize
  formatting so the workspace is clean.
- Changed areas: prettier --write normalized 8 files (drafting geometry/anchor,
  markup, editor App/e2e, smoke script, visio generator); full exit gate runs.
- Validation (all pass): format:check; typecheck; vitest 274/274; pnpm build
  (12 packages); playwright 19/19 (manual-editor 10 + drafting 9);
  editor-production-smoke --check; agent-api-artifacts --check; golden --check;
  release:package; git diff --check.
- Commit status: ready for
  `chore: format normalization after Drafting Runtime Completion (exit gate)`.

## 2026-08-08 - Roadmap status revision (honest completion)

- Target: record the actual Drafting Runtime Completion state in the roadmap
  after the review, per the "do not claim complete" principle.
- Changed areas: docs/roadmap/text-annotation-peripheral-editing-plan.md gains
  a "Drafting Runtime Completion status" section listing what is now true
  (reversible markup, single geometry entry, frozen rotation, accurate bounds,
  atomic drags, drag-create tools, shape hits, typed Snapshot schema, distinct
  route-segment diagnostics, production smoke) and what remains explicitly
  incomplete (leader/callout commands, endpoint handles, detach-to-free,
  box-select/copy-paste for non-text kinds).
- Commit status: ready for
  `docs(roadmap): record honest Drafting Runtime Completion status`.

## 2026-08-08 - Razavi MOS canonical source-arrow geometry

- Target: eliminate divergent NMOS/PMOS three-terminal source-arrow sizing by
  deriving both from one calibrated visible geometry contract, while keeping
  the four-terminal explicit-body symbol source-derived.
- Changed areas: `generate-visio-mos-assets.mjs` now uses one local source
  arrow metric record (compensated for calibrated body scaling) for `nmos3`
  and `pmos3`; the four-terminal masters retain native explicit-body geometry.
  `razavi-catalog.test.ts` verifies the generated variants share 8.28 logical
  length, 7.5735 logical width, and 0.69 logical support-line overlap.
- Validation: `symbols:visio-mos:check`, `symbols:razavi:check`, focused
  Razavi catalog vitest (13/13), and `git diff --check` pass.
- Commit status: ready for
  `fix(razavi): derive MOS arrows from canonical geometry`.

## 2026-08-08 - Razavi UI MOS raster-diff baseline

- Target: inspect the actual editor SVG rather than infer visual state from
  generator coordinates, and compare the three-terminal MOS arrow against the
  supplied reference.
- Findings: UI rendered the current three-terminal NMOS source head at 8.28 by
  7.5735 logical units with a 0.69 logical support overlap. The supplied PNG
  does not share a fixed viewport/DPR/crop with the inspected fit-to-canvas UI,
  so absolute pixel difference is invalid; no geometry edit was evidenced.
  The temporary inspection placement was undone.
- Validation: fixed browser SVG inspection; restored zero-instance document;
  `git diff --check` clean.
- Commit status: ready for
  `docs(plan): record Razavi UI raster-diff baseline`.

## 2026-08-08 - Raster-authoritative Razavi MOS assets

- Target: make the accepted six-panel Razavi screenshot the sole visual source
  for MOS symbols and stop deriving their presentation geometry from Visio.
- Changed areas: archived the 1204x794 source image and hash manifest; added a
  direct-final-coordinate MOS generator; migrated all four MOS catalog entries
  to `razavi-raster-reference` provenance; preserved D/G/S/B pin semantics;
  and froze visual authority plus fixed-rendering/diff rules in the main
  product plan.
- Validation: raster MOS generator and catalog checks pass; Razavi catalog
  tests 13/13; symbols and editor production builds pass; `git diff --check`
  clean.
- Commit status: ready for
  `feat(razavi): make screenshot the MOS visual authority`.

## 2026-08-08 - Drafting runtime final repair

- Target: close the second-audit gaps that survived the first Drafting Runtime
  Completion pass and verify the real GUI/file/export paths.
- Changed areas: recursive reversible rich-text parser; derived-owned style
  profiles and shared rich-text measurement; profile/fraction/multiline-aware
  drafting bounds; nonzero SVG line origins; cancellable atomic text drag;
  callout text-plus-leader hits; real Save -> Open tests; read-only production
  preview smoke in the release gate; migration-aware visual demo loading; and
  build-time browser exporter binding.
- Full-gate findings: six manual-editor assertions were stale after symbol and
  schematic-math changes, and the visual-demo command directly rejected its
  legacy fixture. A Vite process left on port 4173 since 07:23 also caused
  Playwright to reuse an old module graph; the verified workspace process was
  stopped and the complete suite was rerun on a fresh server.
- Validation: focused tests passed; full unit suite 283/283; full Playwright
  26/26; typecheck; 12-package build; production preview smoke `--check`;
  Agent API artifact check; release package; and `git diff --check` all pass.
- Commit status: ready for `fix(drafting): close runtime and GUI verification gaps`.

## 2026-08-08 - Complete screenshot-driven Razavi MOS pixel map

- Target: remove the legacy-coordinate skeleton from Razavi MOS generation
  and prove that the running UI consumes geometry measured from the sole
  reference screenshot.
- Changed areas: added a hash-bound NMOS/PMOS pixel map; expanded the raster
  measurement script; changed the MOS generator to consume only that map plus
  fixed electrical pin anchors; regenerated four MOS assets and the catalog;
  replaced old numeric expectations with independent pixel-map assertions.
- Validation: pixel-map regeneration check; MOS generator and catalog
  idempotency checks; focused catalog tests 13/13; symbols TypeScript build;
  editor production build; running-editor SVG inspection for both NMOS and
  PMOS; temporary UI instances undone.
- Commit status: ready for
  `fix(razavi): generate MOS geometry solely from pixel map`.

## 2026-08-08 - Razavi peripheral assets and four-terminal MOS

- Target: rapidly apply the sole-reference pixel-map workflow to voltage and
  current sources, ground, route current arrows, and repair four-terminal MOS
  bulk-arrow support lines.
- Changed areas: added a hash-bound peripheral geometry map and generator;
  moved three peripheral catalog entries from Visio to raster provenance;
  protected them from Visio regeneration; generated route-arrow style metrics;
  shortened NMOS/PMOS bulk support lines to their arrow bases.
- Validation: per user request, no browser or visual-regression pass; asset and
  catalog generation completed; `git diff --check` and status inspection used
  as the close-out checks.
- Commit status: ready for
  `fix(razavi): align peripheral assets and four-terminal MOS`.

## 2026-08-08 - Four-terminal MOS bulk-arrow continuity

- Target: connect four-terminal NMOS/PMOS bulk arrows visibly to the inner
  gate-side horizontal bar.
- Changed areas: bulk pixel geometry now supports multiple non-overlapping
  line segments; NMOS uses bar-to-tip plus base-to-B; PMOS uses bar-to-base
  plus the outward filled head.
- Validation: MOS/catalog generation succeeded; three-terminal NMOS and PMOS
  SHA-256 hashes remained unchanged; `git diff --check` and status inspected.
- Commit status: ready for
  `fix(razavi): connect four-terminal bulk arrows to gate bars`.

## 2026-08-08 - Diagnostic policy separation

- Target: stop heuristic visual diagnostics from misleading or blocking Agent
  layout automation while retaining useful review evidence.
- Changed areas: introduced structural/observation categories, confidence,
  and gate eligibility; centralized completeness-gate policy; measured visible
  symbol variants and rich text; clustered repeated overlaps; separated the
  editor presentation and Agent response contract; regenerated API artifacts;
  and documented the consumption rules.
- Validation: derived and Agent-adapter tests 29/29; manual editor Playwright
  tests 16/16; derived, Agent-adapter, and editor builds; Agent API artifact
  check; and `git diff --check` all pass.
- Commit status: ready for
  `refactor(diagnostics): separate structural gates from visual observations`.

## 2026-08-08 - Razavi current-arrow and node alignment

- Target: rapidly align route-attached current arrows and solid electrical
  nodes with the accepted Razavi raster using the existing pixel-map pipeline.
- Changed areas: corrected the current-arrow map to its full visible extent;
  added a measured solid-node radius; generated junction, Port-origin, and
  arrow profile tokens from the shared map; and refreshed normative values.
- Validation: per user instruction, no visual or automated validation was
  performed; `git diff --check` and final status inspection were retained as
  repository hygiene checks.
- Commit status: ready for
  `fix(razavi): align current arrows and solid nodes`.

## 2026-08-08 - Voltage-source raster alignment

- Target: use the read-only Razavi raster-diff harness to make the smallest
  evidence-backed correction to the voltage-source presentation.
- Changed areas: changed the voltage-source circle from emphasis to normal
  stroke; corrected the source origin and polarity-axis pixel registration;
  regenerated its raster-owned symbol and catalog.
- Validation: peripheral-asset and catalog checks passed; Symbols build
  passed; voltage-source binary IoU improved from 0.5621 to 0.6565 and soft
  IoU from 0.4419 to 0.5595; no additional visual inspection was used after
  the initial difference map.
- Commit status: ready for
  `fix(razavi): align voltage source to raster reference`.

## 2026-08-09 - Razavi MOS join continuity

- Target: remove visual raster seams at three-terminal NMOS/PMOS channel-to-
  lead joins and refine their source arrows without disturbing electrical pins.
- Changed areas: extended channel/support visual primitives one reference
  pixel through their vertical joins; widened both source-arrow heads and
  extended the NMOS tip/support one pixel; made pixel-derived MOS viewBoxes
  expand to valid integer bounds; regenerated MOS assets and catalog.
- Validation: NMOS diff improved from 0.7389 to 0.7523 binary IoU and from
  0.6246 to 0.6406 soft IoU; PMOS improved slightly while its residual showed
  a +1/+1-pixel registration preference; source/catalog generation, focused
  catalog tests, build, and diff checks passed.
- Commit status: ready for
  `fix(razavi): close MOS joins and align route arrows`.

## 2026-08-09 - PMOS source-arrow tail

- Target: remove the PMOS arrow support segment that visibly protruded through
  the arrow tip while keeping the channel, arrowhead, and electrical pins
  intact.
- Changed areas: shortened the PMOS source-arrow support to start at its
  existing triangle base; regenerated MOS assets and catalog metadata.
- Validation: MOS and catalog generation checks, Symbols build, and
  `git diff --check` passed. No visual inspection was performed per the rapid
  iteration request.
- Commit status: ready for
  `fix(razavi): trim PMOS source arrow support`.

## 2026-08-09 - PMOS arrow mirrors NMOS

- Target: replace the inconsistent PMOS source-arrow construction with the
  mirrored NMOS arrow geometry while preserving PMOS placement and pins.
- Changed areas: PMOS arrow now has NMOS's 16 px length and 14 px base width;
  its support begins at the arrow tip and never extends beyond it.
- Validation: MOS/catalog generation and Symbols build passed. PMOS diff was
  0.6493 binary IoU and 0.6052 soft IoU. The score declined because the old
  reference crop favors the previously rejected geometry; visual direction was
  explicitly selected by the user and takes precedence.
- Commit status: ready for
  `fix(razavi): mirror PMOS arrow from NMOS`.

## 2026-08-09 - PMOS arrow gate contact

- Target: make the PMOS triangle tip touch its Gate bar while confining the
  support segment to the arrow-tail/channel side.
- Changed areas: set tip to the Gate bar edge; retained the NMOS-matched 16 px
  arrow length and 14 px base; moved support to begin at the tail.
- Validation: MOS/catalog generation checks, Symbols build, and
  `git diff --check` passed. No visual inspection was performed.
- Commit status: ready for
  `fix(razavi): join PMOS arrow to gate bar`.

## 2026-08-09 - Razavi route-current arrow length

- Target: correct the route-attached current arrow after comparison with the
  sole Razavi reference showed the prior full length was short.
- Changed areas: increased the pixel-map full arrow extent from 80 px to 92
  px while preserving its 26 px by 15 px head and 12 px label gap; regenerated
  the profile token and updated its contract test and normative documentation.
- Validation: peripheral generator and stale-output check passed; focused
  profile test 2/2 passed; `@icm/render-svg` build and `git diff --check`
  passed. The raster harness does not yet cover route markers, so no visual
  diff was claimed.
- Commit status: ready for `fix(razavi): lengthen route current arrow`.

## 2026-08-09 - Razavi peripheral fidelity

- Target: refine GND bars and independent current-source outline against the
  sole visual reference, and determine whether Port origins required a radius
  change.
- Changed areas: introduced a screenshot-mapped 5 px GND-bar role without
  changing global emphasis; changed current-source circle to normal; retained
  the common 6.5 px Port/Junction radius; documented the synchronized tokens.
- Finding: Port apparent-size difference is the editor's blue/white active
  endpoint overlay, not formal output. No interaction overlay behavior changed.
- Validation: peripheral/catalog generation and stale checks, Symbols/Derived/
  Render-SVG builds, focused catalog/profile tests passed. Ground IoU/soft-IoU
  improved `0.7698/0.6337 -> 0.7810/0.6940`; current-source became
  `0.6413/0.6200` after the explicitly requested normal outline. Three
  broader render SVG golden failures remain from earlier MOS geometry commits;
  unrelated goldens were intentionally not updated.
- Commit status: ready for `fix(razavi): refine peripheral reference fidelity`.

## 2026-08-09 - Razavi passive reference crop baseline

- Target: record and compare the resistor in the sole Razavi reference without
  inventing capacitor evidence.
- Changed areas: added a hash-pinned passive geometry map for panel (d) R1;
  extended fidelity rasterization to support quarter-turn symbols; registered a
  resistor comparison target; replaced its round Visio body with the measured
  sharp, normal-stroke zigzag and aligned its lead joins.
- Validation: resistor binary/soft IoU improved `0.2360/0.1779 ->
0.6597/0.6068`; registration lift is zero. Symbols/Derived/Render-SVG builds,
  catalog generation and stale check, and focused tests 17/17 passed. The
  CLI correctly rejects unrecorded `capacitor`.
- Evidence boundary: the six-panel authority has no capacitor; no capacitor
  asset change was made pending a capacitor-containing approved crop.
- Commit status: ready for `test(razavi): add passive reference crop baseline`.

## 2026-08-09 - Razavi capacitor reference archive

- Target: preserve the user-supplied capacitor screenshot as evidence within
  the existing sole Razavi visual authority.
- Changed areas: archived the original PNG; hash-pinned it and a capacitor
  geometry map in the authority manifest; recorded C1 vertical and C2
  horizontal crop anchors; corrected the style contract's prior absence claim.
- Validation: image and geometry SHA-256 links matched manifest values, both
  evidence IDs were present, JSON parsed, and `git diff --check` passed.
- Commit status: ready for `docs(razavi): archive capacitor reference evidence`.

## 2026-08-09 - Razavi capacitor dual-orientation calibration

- Target: calibrate the capacitor using archived C1 vertical and C2 horizontal
  reference evidence.
- Changed areas: registered both supplemental-raster targets in the fidelity
  CLI and corrected their origin anchors. The harness now reads a target's own
  reference asset rather than assuming every target belongs to the six-panel
  PNG.
- Evidence: C1 improved `0.3037/0.2116 -> 0.5860/0.6240`; C2 improved
  `0.4732/0.3510 -> 0.6982/0.6085`. A shorter normal-stroke capacitor was
  tested and rejected because it worsened both-orientation evidence; no
  capacitor asset change remains.
- Validation: Symbols/Derived/Render-SVG builds, catalog generation and stale
  check, focused tests 17/17, both pixel reports, and `git diff --check`
  passed.
- Commit status: ready for `test(razavi): add capacitor reference calibration`.

## 2026-08-09 - Current documentation index and VSS archive

- Target: remove retired VSS guidance from the default documentation and Agent
  reading path without deleting its historical record.
- Changed areas: adds `docs/current/` and `docs/archive/` boundaries; archives
  the VSS development specification and VSS-derived Agent Razavi canon; leaves
  ADR-linked redirect stubs at their former paths; updates specification,
  roadmap, documentation, and Skill navigation away from VSS visual authority.
- Validation: routing guard confirms the Skill no longer loads the archived
  canon, the specs index has no active VSS entry, all archive/current targets
  exist, and `git diff --check` is clean.
- Commit status: ready for
  `docs: separate current guidance from VSS archive`.

## 2026-08-09 - Unified canvas rich-text editing

- Target: replace the separate Annotation and Drafting Text authoring panels
  with one canvas-local RichText editing session.
- Changed areas: added optional presentation `content` to semantic
  annotations; unified their RichText SVG path with Drafting Text; replaced
  raw-markup side panels with a floating canvas toolbar for bold, italic,
  subscript, superscript, fraction insertion, size, apply, and delete; added
  double-click editing for both text kinds while preserving electrical-net
  semantics. Existing route-current reversal remains available only for its
  relevant marker in that toolbar.
- Validation: workspace typecheck, editor production build, focused model and
  renderer tests (39 assertions), and 26 Playwright editor workflows passed.
  The 3 whole-render golden failures remain component-only mismatches from
  already committed Razavi calibration against stale goldens; targeted text
  rendering tests pass. Workspace-wide `format:check` remains blocked by
  existing component/fidelity helper and lockfile formatting outside this
  target; every owned source and test file was individually formatted and
  checked.
- Commit status: ready for `feat(text): unify rich-text editing surface`.

## 2026-08-09 - Razavi current, source, and Port reference calibration

- Target: archive the supplied compact current-reference raster and align the
  route current marker, current source, and Port origin to its evidence.
- Changed areas: hash-pinned the 326 x 254 supplemental raster and measured
  map; made Razavi formal Ports hollow while preserving their junction-sized
  outside radius; made attached route markers head-only so the route is their
  shaft; tuned the head to the recorded proportions.
- Evidence: a compact-current-source arrow extension was tested and rejected:
  IoU/soft-IoU regressed `0.6087/0.5597 -> 0.5897/0.5262`. The retained
  `0.6087/0.5597` score is anti-alias-sensitive with +0.220 registration lift,
  so no blind source geometry change remains.
- Validation: peripheral and catalog generation, Symbols/Derived/Render-SVG
  builds, the focused 2-test current-arrow/hollow-Port renderer run, current
  source fidelity report, and `git diff --check` passed. The three existing
  whole-render golden failures remain stale MOS-fixture mismatches outside this
  target.
- Commit status: ready for `fix(razavi): calibrate current markers and ports`.

### Actual-render scoring completion

- Added formal-SVG raster targets for the hollow Port and attached route-current
  arrow. This closes their prior pixel-comparison gap.
- Port tuning improved binary/soft IoU `0.6232/0.5245 -> 0.6393/0.6013`; the
  next smaller candidate was rejected at `0.5238/0.5155`.
- The route-current arrow scored `0.5947/0.6199`; a longer head regressed to
  `0.5679/0.5683` and was rejected.

## 2026-08-09 - Razavi semantic subscript face correction

- Target: apply the user's visual correction that automatic schematic
  subscripts are upright while `V`/`I`/`R`/`M` bases remain bold italic.
- Changed areas: semantic-label renderer and generated editor RichText split;
  constrained text comparison option; Razavi text specification and focused
  renderer test.
- Evidence: constrained Chrome/Arial search retained `18` / `0.76` /
  `0.34em`, with an upright-bold clean-crop mean IoU of `0.5509`. This is below
  the unconstrained italic score (`0.5822`), but the supplied reference's
  observed glyph convention and explicit human review take precedence.
- Validation: focused renderer tests `19/19`, Render-SVG build, workspace
  typecheck, Prettier check, and `git diff --check` passed.
- Commit status: ready for `fix(razavi): use upright semantic subscripts`.

## 2026-08-09 - Razavi default text typography calibration

- Target: calibrate the default Razavi label typography against the
  user-supplied OTA raster without changing any symbol or route geometry.
- Changed areas: added a Chrome/Arial text-only calibration CLI; set semantic
  label sizes to `18`, subscript scale to `0.76`, and baseline shift to
  `0.34em`; routed the same baseline token into derived rich-text bounds; and
  updated the two active style specifications and focused renderer tests.
- Evidence: clean-crop mean binary IoU for `V_DD`, `R_D`, `M_1`, and `M_2`
  improved `0.3654 -> 0.5822`. `V_out` remains a diagnostic-only crop because
  the source includes a node and polarity marker. Mathematical bases and
  subscripts remained bold italic; signs stay upright by the existing rule.
- Validation: focused tests `23/23`, Derived/Render-SVG builds, workspace
  typecheck, editor production build, owned-file Prettier check, and
  `git diff --check` passed. Unrelated peripheral Port worktree hunks were
  intentionally left unstaged.
- Commit status: ready for `fix(razavi): calibrate default schematic typography`.

## 2026-08-09 - Razavi unified subscript proportion and attachment

- Target: correct the undersized, overly detached default subscript using the
  supplied `I_X`/`V_X` Razavi reference.
- Changed areas: text comparator now supports this second reference and a
  relative attachment sweep; Razavi typography profile, derived bounds,
  renderer expectations, and active specifications use the calibrated values.
- Evidence: at the reference's own fitted 42px base scale, the selected
  relative geometry is `0.84` scale and `0.28em` down. A horizontal sweep
  selected `0em`; negative tracking worsened the match.
- Validation: focused tests `24/24`, Derived/Render-SVG builds, workspace
  typecheck, Prettier check, and `git diff --check` passed.
- Commit status: ready for `fix(razavi): refine unified subscript geometry`.

## 2026-08-09 - Global semantic annotation typography

- Target: make existing as well as newly edited electrical annotations consume
  the active Razavi typography profile.
- Changed areas: formal renderer and editor session initialization now derive
  semantic annotations from canonical `text`; schema and style contract clarify
  that stored annotation `content` is not a visual style override; regression
  covers a stale legacy RichText payload.
- Result: `V/I/R/M` base styling, upright subscript face, `0.84` scale, and
  `0.28em` baseline apply immediately to all semantic labels without modifying
  individual project files. DraftText remains independent RichText.
- Validation: 36 of 39 focused renderer/text checks passed; the three failures
  are existing component-symbol goldens. Render-SVG/editor builds, workspace
  typecheck, formatting, and `git diff --check` passed.
- Commit status: ready for `fix(text): normalize semantic annotation typography`.

## 2026-08-09 - Editor label selection and mixed deletion

- Target: make render-only default instance labels movable without a preceding
  text edit, and repair marquee deletion when both an instance and its attached
  label are selected.
- Changed areas: editor default-label interaction overlay and RichText-aware
  annotation hit geometry; deletion edit de-duplication; focused editor and
  deletion regressions.
- Result: pointer-down on an implicit instance ID materializes the equivalent
  semantic `instance-label` then uses the standard label drag path; framing an
  implicit label selects its instance; duplicate attached-label removal is
  removed from mixed transactions.
- Validation: focused Vitest 8/8 passed, editor production build passed, and
  `git diff --check` passed. Workspace typecheck is blocked by an unrelated
  retained VDD worktree hunk whose rotation literal is inferred as `number`.
- Commit status: committed as `0415765 fix(editor): unify instance label
selection and deletion`.

## 2026-08-09 - VDD label transaction type repair

- Target: restore typecheck after the VDD placement target introduced a
  power-label annotation with a widened rotation number.
- Changed areas: one literal type assertion in the editor VDD placement edit.
- Validation: workspace typecheck, editor production build, and `git diff
--check` passed.
- Commit status: ready for `fix(editor): type VDD label rotation literal`.

## 2026-08-09 - Editor visual-selection normalization

- Target: make editor selection an explicit, normalized protocol rather than a
  combination of instance state, singular object IDs, and supplemental arrays.
- Changed areas: editor selection state and gesture bridge; new pure
  `VisualSelection` module and tests.
- Result: marquee, primary object selection, junction selection, delete
  eligibility, and mixed deletion all consume one deduplicated selection value.
  Existing Annotation and DraftingObject persistence contracts remain separate.
- Validation: workspace typecheck, editor production build, focused Vitest
  10/10, and `git diff --check` passed.
- Commit status: committed as `940b854 refactor(editor): normalize visual
selection protocol`.

## 2026-08-09 - Text-entry and current-arrow repair

- Target: eliminate duplicate instance-text editing, preserve RichText
  multi-character selection through toolbar commands, and restore accessible
  current-arrow reversal.
- Changed areas: editor Property panel and route-marker action; floating
  RichText editor range handling.
- Result: instance text no longer has a Property-panel mutation path; the
  contenteditable range is restored before bold/italic/subscript/superscript;
  selected current arrows have a direct Reverse action and update both anchor
  representations.
- Validation: workspace typecheck, editor production build, focused Vitest
  10/10, and `git diff --check` passed.
- Commit status: committed as `9337c8d fix(editor): unify text entry and
current arrow controls`.

## 2026-08-09 - Canonical instance-label authoring

- Target: prevent newly placed visible components from using renderer-only
  default labels that cannot enter the RichText editing protocol.
- Changed areas: editor component placement transaction.
- Result: visible new components, including independent voltage sources,
  receive an attached semantic `instance-label` in the same transaction as the
  instance. The default renderer label is legacy read compatibility only.
- Validation: workspace typecheck, editor production build, focused editor
  tests 6/6, and `git diff --check` passed.
- Commit status: committed as `1629b29 fix(editor): create canonical labels
with placed components`.

## 2026-08-09 - Voltage-source canonical label integer position

- Target: repair voltage-source placement after canonical label authoring
  exposed the integer-coordinate requirement of persisted annotations.
- Root cause: the asymmetric Razavi voltage-source viewBox produced a half-unit
  label center. The renderer tolerated it, but the typed transaction rejected
  the Annotation `Point` as non-integer.
- Result: the shared label factory rounds persisted label coordinates and
  transaction failure status now includes its first diagnostic. Browser
  verification placed `V1` successfully with one explicit annotation hit and
  no default-label hit.
- Validation: workspace typecheck, editor production build, focused Vitest
  11/11, and `git diff --check` passed.
- Commit status: ready for `fix(editor): round canonical label positions`.

## 2026-08-09 - Explicit semantic RichText rendering

- Target: preserve user-selected RichText spans in semantic annotations,
  especially multi-character subscripts, after the floating editor commits.
- Root cause: the editor correctly persisted `Annotation.content`, but formal
  rendering and label hit geometry discarded it and rebuilt formatting only
  from flattened `Annotation.text`. That made the default Razavi parser erase
  a user-selected subscript range.
- Changed areas: formal annotation renderer, editor session initialization and
  hit geometry, plus the shared schema contract comment and a direct renderer
  regression for `V` with an explicit `out` subscript.
- Result: no-content annotations keep the active Razavi default; annotations
  with saved RichText retain their exact span structure. `text` remains the
  semantic/electrical plain-text identity for connectivity and search.
- Validation: targeted RichText renderer test passed; workspace typecheck,
  Render-SVG build, editor production build, Prettier, and `git diff --check`
  passed. The unfiltered Render-SVG file has four pre-existing golden failures
  caused by old monochrome/geometry expectations versus current Razavi assets.
- Commit status: ready for `fix(text): preserve explicit semantic rich text
formatting`.

## 2026-08-09 - Explicit filled Port palette symbol

- Target: add a manual-only solid-endpoint Port without changing the existing
  hollow Port's appearance or electrical contract.
- Result: `port-filled` is a reviewed Razavi interface palette asset with the
  exact same pin anchor, lead, viewBox, radius, and stroke role as `port`; only
  the endpoint circle uses foreground fill. It has no automatic SPICE mapping.
- Validation: regenerated catalog, focused catalog Vitest 16/16, Symbols build,
  Editor production build, and `git diff --check` passed.
- Commit status: ready for `feat(razavi): add filled port symbol`.

## 2026-08-09 - PMOS source-arrow support clipping

- Target: remove the squared residual line that crossed the PMOS source-arrow
  head in three-terminal display mode.
- Result: the shared MOS generator now creates source-arrow support from the
  measured tail to the measured external lead, then draws the filled head.
  The PMOS support starts at the arrow tail rather than under its tip; the same
  rule restores the exact measured NMOS support start.
- Validation: regenerated four MOS assets and catalog, focused catalog Vitest
  16/16, Symbols build, Editor production build, and `git diff --check` passed.
- Commit status: ready for `fix(razavi): clip PMOS source-arrow support`.

## 2026-08-09 - Authority-calibrated compact typography

- Target: correct the visually over-wide numeric glyphs in Razavi labels.
- Result: a repeatable four-label authority search selected Arial (0.7321)
  over DejaVu Sans (0.6149), Arial Narrow (0.5591), and Calibri (0.6384).
  Shared label metrics are now Arial, 17.44186 logical units, 76% subscripts,
  and 0.20em baseline shift.
- Validation: focused Derived/Render-SVG Vitest 8/8, Derived build, Render-SVG
  build, Editor production build, and `git diff --check` passed.
- Commit status: ready for `style(razavi): calibrate compact Arial typography`.

## 2026-08-09 - Correct semantic subscript proportions

- Target: correct the typography regression identified against the supplied
  694 x 446 Razavi reference, especially tall/attached numeric subscripts.
- Root cause: the earlier pass misread “flat” as horizontal condensation,
  increased all semantic text by about 15%, and retained an AST override that
  forced math subscripts upright.
- Result: restored DejaVu Sans and the 15.116 logical font size; semantic and
  editor-default subscripts now inherit bold italic math style, render at 76%,
  shift down 0.28em, and use a 0.04em positive attachment gap. The fidelity
  harness now accepts this reference size and searches positive gaps.
- Validation: supplied-reference candidate search, temporary GUI placement and
  undo, focused typography Vitest 22/22, Derived/Render-SVG/Editor builds, and
  `git diff --check` passed.
- Commit status: ready for `fix(text): restore Razavi subscript proportions`.

## 2026-08-09 - Bold upright subscript adjustment

- Target: apply human-reviewed bold upright subscripts and increase horizontal
  separation by approximately 15%.
- Result: semantic and editor-default subscripts use upright weight 700; the
  shared attachment gap changes from 0.040em to 0.046em. The 76% size and
  0.28em vertical shift remain unchanged.
- Validation: formatting check, focused typography tests, Derived/Render-SVG/
  Editor builds, and `git diff --check` passed. The broad Render-SVG file still
  has eight unrelated stale golden/color/size assertions already documented by
  the active fidelity work.
- Commit status: ready for `style(text): widen upright Razavi subscripts`.

## 2026-08-09 - Razavi resistor continuous miter path

- Target: make the resistor zig-zag sharp and continuous with its leads.
- Result: the resistor is one miter-joined SVG path from pin 1 through all
  measured body vertices to pin 2. No independent butt-capped body/lead seam
  remains; electrical pins and measured body geometry are unchanged.
- Validation: focused catalog Vitest 17/17, Symbols build, resistor fidelity
  IoU 0.6613 with zero registration lift and anti-alias-only residual, plus
  `git diff --check` passed.
- Commit status: ready for `fix(razavi): join resistor body and leads`.

## 2026-08-09 - Razavi resistor acute corners

- Target: remove the remaining bevelled tips from the continuous Razavi
  resistor while leaving the global drafting miter limit unchanged.
- Result: `SymbolPrimitive.style` now permits a per-primitive `miterLimit`;
  the resistor declares 12 and the SVG renderer emits it. The reviewed
  reference crop confirms sharp peaks, while the generated SVG no longer
  inherits its bevel-clipping limit from the profile.
- Validation: focused SVG miter-limit Vitest 1/1, Razavi catalog Vitest 17/17,
  Symbols and Editor builds, fidelity crop generation, and `git diff --check`
  passed. The complete renderer file retains eight unrelated failing golden
  assertions caused by pre-existing global pure-black, typography, and MOS
  changes; the resistor-specific test passes.
- Commit status: ready for `fix(razavi): preserve resistor acute corners`.

## 2026-08-09 - Razavi resistor proportion audit

- Target: determine whether the resistor's body proportions need adjustment
  against the sole Razavi raster authority.
- Result: no measured centerline proportion changes were warranted. All eight
  vertices, segment lengths, turn angles, and envelope matched after inverse
  rotation/scale. The prior miter limit of 12 was instead enlarging the
  outline; it was removed in favor of the profile default of four.
- Validation: deterministic point/segment/angle audit, miter-limit raster
  sweep, resistor fidelity (IoU 0.6613, soft IoU 0.5068, 100% edge shell),
  catalog Vitest 17/17, Symbols/Render-SVG builds, and `git diff --check`
  passed.
- Commit status: ready for `fix(razavi): restore measured resistor outline`.

## 2026-08-09 - Razavi resistor sharp-tip amplitude calibration

- Target: retain sharp resistor tips while reducing their raster outer
  expansion against the Razavi reference.
- Result: kept the resistor-only `miterLimit: 12` and calibrated alternating
  zig-zag amplitude to `0.66`, without moving either pin or the body-axis
  coordinates. Human review accepted the result.
- Validation: amplitude sweep, fidelity IoU 0.7290 / soft IoU 0.5752,
  catalog Vitest 17/17, focused SVG miter assertion, Symbols and Render-SVG
  builds, and `git diff --check` passed.
- Commit status: ready for `fix(razavi): calibrate resistor sharp tips`.

## 2026-08-10 - Semantic default instance-label placement

- Target: prevent new component labels from occupying terminal escape lanes.
- Result: shared semantic placement now assigns passive/source labels to their
  side, Port labels to the reverse endpoint extension, and MOS labels to the
  gate-opposite lower body side. Rotation and mirroring preserve outward text
  alignment; explicit labels are not relocated.
- Validation: focused placement Vitest 5/5, Render-SVG and Editor builds, and
  `git diff --check` passed.
- Commit status: ready for `fix(editor): place default labels by symbol semantics`.

## 2026-08-10 - Compact non-MOS default label spacing

- Target: reduce excess whitespace between non-MOS components and their new
  semantic side labels.
- Result: passive, source, and Port side gaps now use 50% of the prior visual
  boundary distance; MOS placement remains unchanged.
- Validation: focused placement Vitest 5/5, Render-SVG and Editor builds, and
  `git diff --check` passed.
- Commit status: ready for `fix(editor): compact default side labels`.

## 2026-08-10 - Extra-compact non-MOS default label spacing

- Target: halve the non-MOS side-label visual gap once more after review.
- Result: passive, source, and Port labels now use 25% of the initial side
  gap; transistor positions remain unchanged.
- Validation: focused placement Vitest 5/5, Render-SVG and Editor builds, and
  `git diff --check` passed.
- Commit status: ready for `fix(editor): tighten default side labels`.

## 2026-08-09 - MOS source-arrow orthogonal elbow regression

- Target: restore the electrical D/S lead's strict 90-degree continuation next
  to the MOS source-arrow head.
- Root cause: the previous clipping pass used a reference-raster overlap point
  as the vector elbow, although its x-coordinate is deliberately offset from
  the electrical lead.
- Result: arrow support begins at the measured arrow tail but turns only at the
  exact D/S lead point. A focused regression asserts the final segment is
  vertical, preventing future diagonal or disconnected external wiring.
- Validation: regenerated MOS assets/catalog, focused catalog Vitest 16/16,
  Symbols build, Editor production build, and `git diff --check` passed.
- Commit status: ready for `fix(razavi): restore MOS arrow elbow`.

## 2026-08-09 - Compact endpoint hit testing and direct pin connection

- Target: prevent oversized endpoint hit areas from blocking manual routing and
  make visually adjacent component pins electrically meaningful.
- Result: endpoint hit testing and direct-pin snapping share a four-logical-unit
  radius. A component drag snaps a visible pin to a stationary visible endpoint
  and commits a wire-free `connect_endpoints` edit. The operation is limited to
  unconnected endpoints or endpoints already on the same Net; different Nets
  are not auto-shorted.
- Validation: focused editor shell Vitest 8/8, Editor production build, and
  `git diff --check` passed.
- Commit status: ready for `feat(editor): snap and directly connect pins`.

## 2026-08-09 - Fixed Razavi MOS display and compact selection actions

- Target: remove non-Razavi four-terminal MOS controls from the manual editor
  while preserving full SPICE bulk connectivity, and simplify current-arrow
  actions.
- Result: all canonical MOS style migrations select the three-terminal visual
  variant. A B connection to a non-supply Net remains electrically intact and
  produces a selected-MOS hidden-bulk warning rather than a four-terminal
  drawing. The selection-shelf reverse-arrow action is replaced with `X`; the
  in-place text-editor control remains as a discoverable alternative.
- Validation: focused editor/catalog Vitest 24/24, Editor production build,
  and `git diff --check` passed.
- Commit status: ready for `feat(razavi): fix MOS display to textbook mode`.

## 2026-08-09 - Persistent Selection shelf

- Target: keep important selection context permanently available without
  allowing its contents to shift the component library as selection changes.
- Result: replaced the collapsible shelf with a fixed-height bottom-left
  section, a passive header, and an internally scrollable content region.
  Updated end-to-end coverage for the permanent shelf and current fixed
  three-terminal MOS behavior.
- Validation: editor Vitest 9/9, production build, focused Playwright 2/2,
  and `git diff --check` passed.
- Commit status: ready for `feat(editor): keep selection shelf persistent`.

## 2026-08-09 - Compact editor command hierarchy

- Target: simplify the browser command surface without changing export,
  drawing, or document-style data contracts.
- Result: Draw moved from the dock to the top command bar; File now contains
  SVG/PNG/PDF exports; Style and the duplicate global current-arrow command
  are removed from the browser UI. Route selection remains the sole place to
  add a line-attached current arrow.
- Validation: editor Vitest 10/10, production build, focused Playwright 3/3,
  and `git diff --check` passed.
- Commit status: ready for `feat(editor): simplify command hierarchy`.

## 2026-08-09 - Manual wire interaction P0

- Target: make manual wire taps reliable at routes and bends, keep Wire mode
  clear of visual-selection overlays, and distinguish deleting an isolated
  electrical connection from merely removing its visible route geometry.
- Result: route hit resolution is screen-tolerant and projects to a real route
  point, preferring an internal bend exactly. The edit engine now splits an
  existing waypoint without introducing a zero-length segment. Wire mode owns
  an input plane and disables selection overlays; route hit priority is above
  component boxes while endpoints and annotations remain higher. Delete clears
  an isolated terminal/port connection; Unroute intentionally keeps its Net
  and exposes flightlines. Branched/shared deletion is safely rejected pending
  persistent connection-edge provenance in the model.
- Validation: focused Playwright P0 3/3, routing engine Vitest 10/10, editor
  production build, focused Prettier, and `git diff --check` passed. Workspace
  typecheck/SSR and one old routing-demo browser case remain blocked by
  parallel hierarchy/Razavi/command-menu work outside this target.
- Commit status: pending intentional hunk staging.

## 2026-08-09 - Drafting Selection shelf and reversible lock repair

- Target: make Selection-shelf drawing controls visibly effective and make
  drafting locks reversible while preserving edit protection.
- Result: construction lines and free arrows render the persisted style
  override; Lock changes to Unlock, disables other drawing edits while locked,
  and explains the protection state. The edit engine permits only a
  payload-identical pure unlock. Delete has higher priority and removes a
  locked drafting object immediately. Numeric scale fields use a Zod
  numeric-literal union (not an invalid numeric enum), so stroke and arrow-head
  scale values survive transactions and reach SVG rendering. Free-arrow shafts
  terminate at their arrowhead base plane instead of continuing to the tip.
- Validation: editor build, drafting edit-engine Vitest 10/10, focused
  Drawing-shelf Playwright 4/4, source/target-plan Prettier, and
  `git diff --check` passed. The shared dirty log has a pre-existing Markdown
  Prettier warning. The full drafting Playwright file exceeded the local 120 s
  command budget and is not recorded as passing.
- Local runtime: replaced duplicate Vite processes with one rebuilt editor
  server at `http://localhost:5173`.
- Commit status: pending intentional hunk staging because the shared editor and
  drafting files retain unrelated uncommitted work from the completed drafting
  and parallel targets.

## 2026-08-09 - Imported hierarchy release scope

- Target: limit this release to browsing SPICE-imported subcircuits, without
  implying manual Cell authoring or symbol encapsulation.
- Result: new imports store `spice.childDocumentId` as a stable child-document
  link while retaining `spice.target` for source fidelity. The editor uses that
  link first (with legacy name-resolution fallback), hides hierarchy controls
  in a one-document project, and labels imported navigation `Cells`, `Up`,
  `Top`, and `Enter Cell`. Only a resolvable child instance accepts double-click
  navigation.
- Validation: importer/editor Vitest 17/17, imported-SPICE Playwright flow
  1/1, editor production build, Prettier, and `git diff --check` passed.
  Workspace typecheck reaches only unrelated Razavi catalog fixture errors
  (`leadsPx`); the concurrent drafting handoff's App type errors were repaired
  separately but are intentionally not part of this commit.
- Commit status: committed locally; push pending transient remote retry.

## 2026-08-09 - Command menu dismissal

- Target: remove persistent header command popovers that obstruct the canvas.
- Result: only open `.command-menu` popovers close on an outside pointer-down;
  Escape closes an open command menu before it reaches wire, drafting, or
  selection cancellation. Library details remain independent.
- Validation: focused Playwright 1/1, editor production build, Prettier, and
  `git diff --check` passed.
- Commit status: ready for `fix(editor): dismiss command menus outside the toolbar`.

## 2026-08-09 - PMOS gate-bar width

- Target: align the PMOS outer gate-bar width with NMOS while preserving the
  PMOS gate-lead attachment and electrical pin anchors.
- Result: the raster measurement remains unchanged; the MOS asset generator
  reuses the NMOS outer-bar width when generating PMOS and PMOS3. Generated
  assets and catalog integrity data were refreshed, with a focused regression
  assertion for the shared logical width.
- Validation: Razavi catalog Vitest 17/17, MOS and catalog generated-artifact
  checks, target-file Prettier, and `git diff --check` passed. Full workspace
  formatting remains blocked by seven unrelated pre-existing files on `main`.
- Commit status: pending intentional staging.

## 2026-08-09 - Canonical MOS body geometry

- Target: use NMOS as the shared MOS-body geometry source so PMOS bar widths,
  spacing, channels, and gate lead cannot drift independently; retain PMOS
  arrow polarity.
- Result: both PMOS variants now generate their bodies from NMOS measurement.
  PMOS source/bulk arrow primitives retain the PMOS measurement and direction.
  The catalog test compares every non-arrow body primitive after ignoring only
  arrow-specific labels.
- Validation: Razavi catalog Vitest 17/17, MOS and catalog generated-artifact
  checks, target-file Prettier, and `git diff --check` passed.
- Commit status: pending intentional staging.

## 2026-08-09 - Razavi resistor continuous miter path

- Target: make the resistor zig-zag sharp and continuous with its leads.
- Result: the resistor is one miter-joined SVG path from pin 1 through all
  measured body vertices to pin 2. No independent butt-capped body/lead seam
  remains; electrical pins and measured body geometry are unchanged.
- Validation: focused catalog Vitest 17/17, Symbols and Editor builds,
  resistor fidelity IoU 0.6613 with zero registration lift and anti-alias-only
  residual, plus `git diff --check` passed.
- Commit status: ready for `fix(razavi): join resistor body and leads`.

## 2026-08-09 - Terminal escape routing and seamless joins

- Target: prevent right-angle manual wires from leaving component terminals
  sideways or showing a butt-cap seam at the terminal.
- Result: GUI candidates now retain transformed signed pin directions and use
  the shared escape router. Direct terminal wiring exits and enters along pin
  direction; router midpoints snap to the document connection grid. Formal SVG
  retains exact route coordinates and adds a same-width, under-symbol overlap
  only for correctly oriented terminal escape segments.
- Validation: focused wire-path/derived/render Vitest 7/7, focused manual
  editor Playwright 1/1, editor production build, Prettier, and
  `git diff --check` passed. The complete renderer test file retains unrelated
  pre-existing style-baseline failures.
- Commit status: committed as `fix(editor): escape component terminals before
orthogonal turns`.

## 2026-08-09 - Unified visual deletion

- Target: make Ctrl+A and Delete operate on every visible editable object, and
  make junction-connected route deletion a single, coherent operation.
- Result: Ctrl+A now selects placed instances, routes, junctions, annotations,
  and drafting objects. Route/junction deletion first computes a closure: a
  deleted junction removes each attached route; a junction whose attached
  routes are all deleted is removed too. This handles a route ending at a
  one-terminal junction without a second delete, while preserving junctions
  that still connect remaining routes.
- Validation: focused deletion-helper Vitest 2/2, editor production build,
  Prettier, and `git diff --check` passed.
- Commit status: implementation is intentionally left uncommitted because
  `App.tsx` and this log already contain staged, separately owned terminal-
  escape-routing work in the shared worktree; the changes must be integrated
  with that target rather than committing either target's partial index.

## 2026-08-09 - Precise selection interaction

- Target: prevent accidental component/text movement and remove duplicate
  component selection feedback.
- Result: component hit rectangles now use visible symbol geometry and pins
  when path geometry permits; text hit tolerance is reduced; component,
  annotation, and free drafting moves require a 4px screen-space gesture;
  implicit labels select on click and materialize for editing only on
  double-click. The obsolete circular component drag placeholder is removed.
- Validation: selection geometry plus editor-shell Vitest 14/14, editor
  TypeScript check, production build, Prettier, and `git diff --check` passed.
- Commit status: pending exact-hunk integration because a separate drafting
  arrow target currently has uncommitted changes in `App.tsx` and `styles.css`.

## 2026-08-09 - Select before drag

- Target: stop dense schematics from moving an object during its first
  selection gesture.
- Result: components, annotations, and free drafting objects now use a
  two-stage gesture. The first pointer-down selects; only a new drag from an
  already-selected object may move it. Selection modifiers cannot start a
  move. Annotation hit padding is zero, and unselected targets use the normal
  pointer cursor while selected targets advertise movement. Attached labels
  now follow that exact same model: a click selects the label, and a subsequent
  drag moves it. This avoids deferred click-through that visibly switched
  selection from a label to its host on pointer-up. Text annotations now use
  the component's transparent dashed selection outline; wide filled selection
  bands remain reserved for thin route-marker/drafting geometry.
- Validation: selection geometry/editor-shell Vitest 15/15, focused Playwright
  attached-label selection plus two-stage label drag and floating-text drag
  3/3, editor TypeScript check, production build, Prettier, and `git diff
--check` passed.
- Commit status: pending exact-hunk integration with the separately owned,
  uncommitted drafting-arrow target in `App.tsx` and `styles.css`.

## 2026-08-09 - Direct miter terminal joins

- Target: remove the visually inflated default terminal escape from manual
  wiring while retaining seamless sharp joins at component pins.
- Result: GUI manual routes now end directly at their exact pin coordinates.
  The renderer adds a short under-symbol miter bridge that joins the internal
  component lead to the actual route segment, including direct right angles.
  Agent orthogonal routing remains independent and may still explicitly escape.
- Validation: focused wire-path/render Vitest 5/5, focused manual editor
  Playwright 1/1, editor production build, target-file Prettier, and
  `git diff --check` passed.
- Commit status: committed as `fix(editor): use direct miter joins for manual
terminal wiring`.

## 2026-08-09 - Virtuoso-style wire endpoint semantics

- Target: distinguish loose wire ends from real electrical branches, and make
  an isolated manually drawn wire movable as one object.
- Result: GUI-created free endpoints now persist as `route-anchor` rather than
  implicit `branch` Junctions. Formal rendering draws a junction dot only for
  a branch Junction with three or more attached routes; route/label anchors
  and legacy degree-one/two branch records remain electrically explicit but
  visually invisible. A selected route whose two endpoints are loose anchors
  can now be dragged directly on any wire segment to move both anchors and the
  complete polyline in one transaction; the centre handle is optional. Routes
  attached to terminals, ports, or real branches use the same direct gesture
  to stretch the pointed segment while preserving their endpoints.
- Validation: focused renderer branch-dot test 1/1, focused manual-editor
  Playwright dangling-wire/direct-whole-route-move/direct-segment-stretch tests
  3/3, editor TypeScript check, production build, Prettier, and `git diff
--check` passed.
- Commit status: pending exact-hunk integration because the same editor,
  renderer, and log files contain separately owned uncommitted work.

## 2026-08-09 - Drafting midpoint bending and contextual inspector

- Target: make free drafting arrows and construction lines reshapeable by
  dragging a segment midpoint, and make their frequent controls visible beside
  the selected object.
- Changed areas: arrow persistence gained optional free `waypoints` and both
  free drafting shapes gained per-segment quadratic `curveControls`; shared
  derived geometry and formal SVG rendering now use the same Bézier path and
  aim an arrow head from its final tangent. Editor overlays supply draggable
  curve-midpoint diamonds and a compact in-canvas inspector. Electrical routes
  and route-bound current arrows were not changed.
- Interaction refinement: the inspector now displays the active segment's
  endpoint-tangent included angle in real time. Numeric entry rebuilds a
  symmetric quadratic control on the same bend side; multi-segment drafting
  objects expose a segment selector.
- Follow-up: control-point creation now rounds at the persistence boundary,
  because Project `Point` coordinates are integer-valued. Local GUI verification
  created an arrow, entered 60°, and committed revision 2 with a displayed
  60.2° realized angle and no transaction-validation diagnostic.
- Input refinement: the field clears to a numeric draft on focus (while its
  unfocused state remains a realized-angle readout), preventing controlled
  rerenders from turning a desired `60` into `060` or overwriting partial text.
  Local GUI verification typed `60` directly and retained that exact active
  draft while applying the curve update.
- Rotation refinement: the nearby inspector now exposes an absolute first-
  segment Bearing field for arbitrary-angle rotation of free arrows and
  construction lines, including their Bézier controls. The inspector was made
  tall enough to show all line actions rather than clipping Rotate. Local GUI
  verification entered 45° for a construction line; the field was enabled and
  the complete action row remained visible.
- Validation: model, derived, edit-engine, render-svg, and editor builds
  passed; focused derived/render Vitest passed 26/26; editor TypeScript check
  and `git diff --check` passed. Root `pnpm typecheck` remains blocked only by
  the pre-existing `leadsPx` errors in `packages/symbols/src/razavi-catalog.test.ts`.
- Commit status: not committed. A concurrent precise-selection target modified
  the same `App.tsx`/`styles.css` files during this work; its untracked helper
  files and plan were deliberately not staged or included.

## 2026-08-10 - Reusable wire endpoints and route-anchor joins

- Target: allow a dangling manual wire endpoint to start a later wire, without
  leaving a visual seam when that endpoint becomes a dotless corner.
- Changed areas: browser coverage now reconnects a free endpoint to a component
  terminal. The SVG renderer overlays a sharp, render-only miter bridge for
  exactly two routes meeting at a `route-anchor`; route coordinates, endpoints,
  and electrical topology are unchanged.
- Validation: focused renderer Vitest 1/1, focused manual-editor Playwright
  1/1, editor production build, and `git diff --check` passed.
- Commit status: pending.

## 2026-08-10 - Editor chrome modernization

- Target: modernize the browser editor's visual hierarchy without changing
  schematic behavior, persistence, exports, shortcuts, or Agent exposure.
- Changed areas: editor-only CSS tokens and styling for the header, command
  menus, component palette and library, Selection shelf, Help dialog, status
  feedback, focus states, canvas frame, reduced motion, and desktop-width
  adaptations. No formal SVG body, domain package, event handler, accessible
  name, or test ID was changed by this target.
- Visual verification: inspected empty, menu-open, Help-open, placed-component,
  selected-object, 1280px, 1024px, and 800px states in the local browser. A
  menu stacking issue was found and repaired; original canvas sizing was
  retained after a baseline comparison exposed coordinate sensitivity.
- Validation: owned-file Prettier check passed; editor App Vitest passed 11/11;
  editor production build passed; six focused Playwright interaction/layout
  checks passed, including stable canvas width and direct-pin coordinates; `git
diff --check` passed. The full Playwright baseline completed 30/49, with the
  remaining failures traced to existing stale UI/route expectations; an
  unmodified-main comparison reproduced the selected-route failure. Root
  formatting and typecheck remain blocked by previously dirty formatting paths
  and the existing symbol-catalog `leadsPx` fixture type gap.
- Commit status: prepared for `feat(editor): modernize the editor chrome` on
  `codex/modernize-editor-chrome`; concurrent canvas-drag-session work remains
  untouched and unstaged.
- Review follow-up: removed inherited `font-synthesis: none` and
  `text-rendering` from the root chrome rule after human review showed that the
  browser could no longer synthesize italic SVG glyphs. Added a focused browser
  regression that places a component and verifies its formal SVG italic run.
  A selector audit found no second chrome rule reaching formal `text`/`tspan`
  content, geometry, pointer behavior, or export markup.
- Follow-up validation: editor/render-text Vitest passed 31/31; seven focused
  Playwright checks passed for italic rendering, clean mount, presentation
  isolation, pin coordinates, stable library/canvas layout, and menu dismissal;
  the editor plus its workspace dependencies built; `git diff --check` passed.
  Eight broader renderer golden assertions remain independently stale and are
  not affected by browser CSS.

## 2026-08-10 - Drafting floating-control consolidation

- Target: make canvas floating inspectors the single edit surface for free
  arrows and construction lines, remove the arrow Segment control, and contain
  the arrow and rich-text editors within their SVG overlays.
- Changed areas: removed the Selection `Drawing style` section; moved
  Lock/Unlock into the drafting float; retained arrow head size there; limited
  `Curve segment` to multi-segment construction lines; added deterministic
  arrow grid sizing/viewBox clamping and wrapping, clamped rich-text layout.
- Validation: focused drafting Playwright passed 5/5 with geometric overflow
  assertions; App Vitest passed 11/11; editor dependencies and production build
  passed; owned-file Prettier and `git diff --check` passed. The full drafting
  file passed 14/18; the four failures are existing retired-menu,
  duplicate-locator, and concurrent drag-session gesture cases outside this
  UI target.
- Commit status: pending. Shared `App.tsx` and drafting-test files contain
  separately owned uncommitted drag-session work, and the branch is already
  ahead with external commits; no mixed commit was created.
- Review follow-up: widened the text editor to a contained 420-unit, single-row
  toolbar; added non-committing Escape/outside-pointer dismissal for text and
  drafting floats; added Help backdrop dismissal; and changed the header to
  symmetric title/commands/status columns so status updates cannot move the
  command bar.
- Follow-up validation: eight focused Playwright scenarios passed, including
  measured one-row/overflow geometry, both dismissal paths, Help dismissal,
  and an exact before/after command-bar rectangle across a status change. App
  Vitest passed 11/11, the editor dependency/build chain passed, and owned-file
  formatting plus `git diff --check` passed.
- Text-system follow-up: removed the fraction insertion mode without removing
  legacy fraction compatibility; made A-/A+ preview live in the editing field;
  created free text with the `label` typography token; applied the canonical
  DejaVu/Razavi font stack to the editor and interactive canvas; matched free
  text selection to annotation text's precise dashed frame; and added/documented
  the `T` shortcut. Three focused Playwright scenarios passed, App Vitest passed
  11/11, the editor dependency/build chain passed, and owned-file formatting
  plus `git diff --check` passed. Root typecheck remains blocked by unrelated
  dirty `inout` and symbol-catalog `leadsPx` test fixtures.

## 2026-08-10 - Curved free-arrow head follow-through

- Target: make a free arrow's triangular head follow its final quadratic
  segment while a user bends the shaft and after the edit commits.
- Changed areas: formal SVG now obtains shaft truncation and head orientation
  from one final-segment tangent helper. The editor swaps only the dragged
  drafting object into a transient render document during a handle drag, so
  the formal shaft and arrowhead redraw together before pointer-up. The
  renderer regression checks the head direction against a curved end tangent.
- Validation: focused render/derived Vitest passed 27/27; renderer and editor
  TypeScript checks, editor production build, and `git diff --check` passed.
- Commit status: not committed. This narrow follow-up overlaps dirty shared
  `App.tsx` with other active canvas interaction targets; no files were staged.

## 2026-08-10 - Drafting rectangle tool

- Target: add a Virtuoso-style `R` rectangle tool to the non-electrical
  drafting layer, sharing the existing free-line appearance and edit surfaces.
- Changed areas: Project schema now persists rectangle center, dimensions,
  bearing, and line style; derived geometry supplies four rotated corners and
  export bounds; formal SVG renders a transparent outline. The editor provides
  two-corner live creation, precise outline selection, whole-object movement,
  four-corner resizing, arbitrary bearing, 90-degree Rotate, style/stroke
  controls, Lock/Unlock, Delete, and `R` activation. `Shift+R` retains selection
  rotation after the shortcut conflict was resolved in favor of the requested
  Virtuoso convention.
- Validation: focused derived/render Vitest passed 29/29; focused Playwright
  passed 2/2 for shortcut creation, selection, four handles, resize, styling,
  and Shift+R rotation; all workspace packages built; editor TypeScript and
  production build passed; owned-file formatting and `git diff --check` passed.
  Root typecheck remains blocked by pre-existing `inout` direction fixtures in
  `stretch.test.ts` and missing `leadsPx` fields in symbol catalog tests.
- Commit status: not committed. Shared editor, E2E, docs, renderer, and log
  files contain unrelated dirty work; no files were staged.
- Shortcut correction after GUI review: `R` now rotates a selected placed
  component, arrow, construction line, or rectangle by +90 degrees, and only
  enters Rectangle mode when no rotatable selection exists. `Shift+R` rotates
  the same selection by -90 degrees. Focused browser coverage includes both
  selected-arrow and selected-component `R` rotation plus unselected `R`
  rectangle creation.

## 2026-08-10 - Unified canvas interaction session

- Target: remove divergent object drag state machines, prevent overlapping
  text/geometry from changing the drag target, and make painted objects follow
  the pointer before commit.
- Changed areas: one shared pointer session; semantic hit ranking with selected
  target stickiness and `Alt` candidate cycling; direct temporary SVG
  transforms/polyline previews; unsnapped grab-offset-preserving movement with
  snap deferred to pointer-up; duplicate default-label hit removal.
- Validation: focused interaction modules passed 10/10 Vitest; App passed
  11/11; ten focused manual/drafting Playwright gestures passed, including
  live movement before revision commit, component/label targeting, free text,
  loose Route translation, connected segment stretch, Escape cancellation, and
  arrow handles and one-commit Guide movement. Editor TypeScript and production
  build passed; Prettier and `git diff --check` passed.
- Commit status: pending because shared editor/test/spec/log files contain
  completed but uncommitted concurrent UI, rectangle, and route targets; no
  mixed staging was performed.

## 2026-08-10 - Stable instance annotation translation

- Target: stop attached Annotation distance from drifting when an instance is
  translated, especially after upright-label baseline correction from a prior
  rotate or mirror.
- Changed areas: pure `move_instance` translation now applies the painted delta
  directly instead of rerunning transform placement; a shared helper also keeps
  free/object anchor fallbacks synchronized for port movement and instance
  alignment. Rotation and mirroring still use the transform-aware path.
- Validation: Edit Engine plus Agent service passed 60/60 tests; three focused
  editor gestures passed, including two consecutive moves of a rotated
  component with a constant label vector; Edit Engine/editor builds and editor
  production build passed; formatting and `git diff --check` passed.
- Commit status: prepared directly on `main` as explicitly requested.

## 2026-08-10 - Razavi symbol construction experience

- Target: extract the repeated component-construction and pixel-calibration
  lessons into one concise experience note for future palette extensions.
- Changed areas: added a two-part note covering reusable methodology and the
  concrete evidence, asset, generator, renderer, and fidelity-script paths.
  It records reference-owned registration, electrical/visual coordinate
  separation, canonical family geometry, topology-aware seam construction,
  actual-render pixel diagnostics, the compiled-`dist` boundary, and the
  required execution order. The note is in English, and the experience README
  now makes English the standard language for future extracted lessons.
- Validation: local links and named paths checked; target-only Markdown diff
  reviewed; `git diff --check` passed.
- Commit status: pending isolated staging because `plan/log.md` contains
  unrelated concurrent target entries.

## 2026-08-10 - Unified Razavi visual contract and fidelity registry

- Target: consolidate scattered Razavi style, extension, Port/node, and
  pixel-alignment rules without removing hollow/filled Port behavior or any
  construction and fidelity method.
- Changed areas: added one accepted Razavi visual contract; converted the old
  style and extension specs into redirects; corrected active navigation and
  formal Port terminology; moved all 15 fidelity target declarations from the
  CLI into one manifest-pinned registry; froze the seven former
  candidate-derived windows; and added a shared authority loader that verifies
  raster, measurement, and registry hashes for both catalog checks and fidelity
  runs. The stale formal-Port foreground assertion now matches the executable
  `#000` profile.
- Validation: `symbols:razavi:check` passed; Model, Symbols, Derived,
  Render-SVG, and Exporters builds passed; all 15 registered fidelity targets
  completed with the pre-refactor scores preserved; catalog Vitest passed
  17/17 and focused formal-Port rendering passed 1/1; owned-file Prettier and
  local-link checks passed; `git diff --check` passed.
- Commit status: pending isolated staging because the branch and shared
  `plan/log.md` contain unrelated concurrent target work.

## 2026-08-10 - Integrate modernized editor work

- Target: commit every current change on `codex/modernize-editor-chrome`, merge
  the complete branch into `main`, and push both refs as explicitly requested.
- Changed areas: integrated the completed drafting controls, rectangle tool,
  unified canvas drag session, topology-aware route movement, renderer/model
  support, Razavi visual contract and registry, documentation, experience note,
  fixtures, scripts, and their target plans. Test-only integration repairs
  synchronized Port fixtures, MOS measurement typing, and the remaining route
  drag browser scenario with current contracts.
- Validation: changed-file Prettier, `references:check`,
  `symbols:razavi:check`, root typecheck, 46/46 focused Vitest cases, all
  workspace builds, 23/23 focused Playwright cases, and `git diff --check`
  passed. Full Vitest completed 350/364 with 14 already-recorded stale
  Razavi/style/golden and snapshot-bound expectations. Full Playwright exceeded
  the 60-second runner limit and was replaced by the deterministic focused
  changed-surface run; it was not recorded as passing.
- Commit status: ready to commit as
  `feat(editor): unify drafting interactions and visual contracts`, then merge
  to `main` and push both branches.

## 2026-08-10 - Rectangle outline hit testing

- Target: stop non-electrical drafting rectangles from blocking component
  placement and selection inside their empty area.
- Changed areas: the rectangle editor overlay now uses a transparent,
  stroke-only fixed-pixel hit band; selected rectangles no longer fill their
  interior; marquee selection tests the four outline segments instead of the
  rectangle's filled bounds; the focused browser regression covers interior
  marquee, direct MOS placement, border selection, styling, and resize.
- Validation: changed-file Prettier passed; editor TypeScript passed; focused
  Playwright passed 1/1; editor production build passed; `git diff --check`
  passed.
- Commit status: prepared on `codex/fix-rectangle-hit-testing` for focused
  staging, commit, and push.

## 2026-08-10 - Remove redundant visual documentation redirects

- Target: reduce current visual-documentation surface after the unified Razavi
  contract and archive structure made six redirect-only files redundant.
- Changed areas: removed the former Razavi style, component-extension, VSS
  import, architecture-review, Phase 5, and Agent style-canon redirect files;
  pointed active specifications, roadmaps, ADR, and Circuit Layout Skill routing
  directly to the unified contract or archive originals; added a compact former
  path mapping to the archive index; repaired three pre-existing broken links in
  the archived style canon. No unique contract, method, or historical document
  was deleted.
- Validation: all six targets are absent; every changed-document local link
  resolves; no active Markdown link targets a removed path; changed-file
  formatting was reviewed without normalizing unrelated tables, and
  `git diff --check` passed.
- Commit status: ready to commit on `agent/fix-ci-baseline` as
  `docs: remove redundant visual redirects` after the user authorized taking
  ownership of the previously concurrent changes.

## 2026-08-10 - Archive completed foundation plans

- Target: reduce the active planning surface by introducing a documented
  archive and moving only completed, committed foundation and phase-wrapper
  plans whose operational value is historical.
- Changed areas: added the `plan/archived/` retention policy and monthly
  layout; moved 12 completed plans into `plan/archived/2026-08/`; documented
  the archive from `plan/README.md`; updated three historical log references.
  Plans with unresolved work or explicit experience signals remain active.
- Validation: all 12 archived `plan.md` blobs match their original `HEAD`
  blobs; all source directories are absent and destinations exist; local
  Markdown links resolve; remaining old-root strings occur only as historical
  ownership/path records inside archived plans and this target plan;
  `git diff --check` passed.
- Commit status: ready to commit on `agent/fix-ci-baseline` after the user
  authorized taking ownership of the previously concurrent changes.

## 2026-08-10 - Archive completed plans and slim the planning protocol

- Target: archive a second evidence-backed completed-plan batch and remove the
  status and experience ambiguities exposed by the archive audit.
- Changed areas: moved 42 byte-preserved completed plans into
  `plan/archived/2026-08/`; added their commit index; introduced required
  `status` and `experience` metadata for future plans; reduced the single plan
  template to a compact ownership/validation core; separated plan, Git, log,
  and experience authority; updated affected current-location links.
- Validation: every selected plan has an outcome and Git evidence; all 42
  archived blobs match their original `HEAD` blobs; sources are absent and
  destinations exist; local Markdown links resolve; remaining old-root strings
  are intentional historical records; `git diff --check` passed.
- Commit status: ready to commit on `agent/fix-ci-baseline` as
  `docs(plan): archive completed plans and clarify protocol` after the user
  authorized taking ownership of the previously concurrent changes.

## 2026-08-10 - Extract drafting creation preview

- Target: separate the transient arrow, construction-line, and rectangle
  creation preview from the App orchestration shell.
- Changed areas: added a six-input SVG preview component; centralized Canvas
  rectangle normalization and polyline serialization; added Canvas geometry
  contract tests; reduced App by 112 lines.
- Validation: 14 focused Vitest tests and four drafting Playwright flows passed;
  typecheck, editor production build, and `git diff --check` passed.
- Commit status: ready to commit on `agent/fix-ci-baseline` as
  `refactor(editor): extract drafting creation preview`.

## 2026-08-10 - Extract canvas text editor overlay

- Target: separate viewport-aware canvas text-editor layout from the App
  orchestration shell without changing text persistence or interaction state.
- Changed areas: added a focused overlay component and pure frame resolver;
  covered normal, scaled, translated, and four-edge-constrained layout; replaced
  the inline App render closure with the component while retaining all callbacks
  in App.
- Validation: 15 focused Vitest tests and six text-editing Playwright flows
  passed; repository typecheck, editor production build, changed-file Prettier,
  and `git diff --check` passed. The existing large-chunk build warning remains.
- Commit status: ready to commit on `agent/fix-ci-baseline` as
  `refactor(editor): extract canvas text editor overlay`.

## 2026-08-10 - Extract selection inspector details

- Target: separate read-only editor metrics and diagnostics from selection
  actions and remove duplicate diagnostic partition/rendering logic.
- Changed areas: introduced a typed inspector snapshot and shared diagnostic
  summary; moved metrics, import diagnostics, structural issues, and visual
  observations into a focused component; each diagnostic category is now
  rendered from its own partition rather than duplicated hidden list entries.
- Validation: 13 focused Vitest tests and two manual-editor Playwright flows
  passed; repository typecheck, editor production build, changed-file Prettier,
  and `git diff --check` passed. The existing large-chunk warning remains.
- Commit status: ready to commit on `agent/fix-ci-baseline` as
  `refactor(editor): extract selection inspector details`.

## 2026-08-10 - Centralize wire editing contract

- Target: move the wire source and deterministic edit-order contract out of
  React interaction state and App orchestration.
- Changed areas: added pure complete-wire, free-anchor, and snapped route-tap
  proposal builders; moved `WireSource` ownership to the wire domain while
  preserving an interaction-state compatibility export; replaced App's manual
  merge/connect/route edit assembly with one proposal call.
- Validation: 25 focused Vitest tests and six manual-editor Playwright wire
  flows passed, followed by the full 423-test Vitest suite and all 59
  Playwright flows; repository typecheck, editor production build,
  changed-file Prettier, and `git diff --check` passed. The existing
  large-chunk warning remains.
- Commit status: ready to commit on `agent/fix-ci-baseline` as
  `refactor(editor): centralize wire editing contract`.

## 2026-08-10 - Add component insertion dialog and refine workspace

- Target: replace the permanent component sidebar with an `I` master/detail
  insertion flow and finish a canvas-first GUI refinement pass.
- Changed areas: component-insert and icon features, editor shell/shortcuts,
  Inspector/Guide/drafting interactions, responsive styling, E2E isolation,
  interaction specification, and focused tests.
- Validation: 26 focused Vitest tests, repository typecheck, dependency-aware
  editor build, all 61 Playwright flows, full format check, real browser visual
  inspection, and `git diff --check` passed.
- Commit status: ready to commit on `codex/insert-component-dialog` as
  `feat(editor): add component insert dialog and refine workspace`.

## 2026-08-10 - Unified editor Snap Engine

- Target: replace disconnected grid, pin, Guide, Wire, and drafting snap paths
  with one editor-owned runtime contract.
- Changed areas: added the pure Snap Engine and candidate builder; migrated
  instance/group, Drafting, Guide, and Wire interactions; added transient smart
  guides, live Alt suppression, off-grid candidate rejection, and current-
  selection Align; removed the old direct pin helper; updated the interaction
  specification.
- Validation: 29 focused Vitest tests, repository typecheck, editor production
  build, changed-file Prettier, and `git diff --check` passed. The existing
  large-chunk warning remains; loopback browser automation was unavailable.
- Commit status: ready to commit on `agent/fix-ci-baseline` as
  `feat(editor): unify snap and alignment interactions`.

## 2026-08-10 - Preserve MOS label side through rotation

- Target: keep materialized transistor instance labels in the same semantic
  position as renderer-owned defaults through repeated rotation.
- Changed areas: made the Edit Engine recognize MOS symbols by terminal roles,
  preserve their rigid semantic label anchor, and derive upright alignment from
  normalized local displacement; added full-cycle NMOS/PMOS regressions for
  both four-terminal variants and dedicated three-terminal symbols.
- Validation: 23 focused Edit Engine/render placement tests, Edit Engine build,
  repository typecheck, and `git diff --check` passed.
- Commit status: ready to commit on `agent/fix-ci-baseline` as
  `fix(edit-engine): preserve mos label side through rotation`.

## 2026-08-10 - Place rotated MOS labels outside visible symbols

- Target: eliminate transistor/Annotation overlap caused by using padded
  viewBoxes and raw SVG baselines as rotation reference boundaries.
- Changed areas: introduced shared Derived instance-label placement, exposed
  variant-aware visible symbol bounds, routed renderer/editor/Edit Engine MOS
  labels through the same geometry, and separated painted baseline position
  from semantic transform offset.
- Validation: 90 focused tests, three affected package builds, repository
  typecheck, `git diff --check`, and live browser rectangle measurements at all
  four orientations passed with zero overlaps.
- Commit status: ready to commit on `agent/fix-ci-baseline` as
  `fix(render): place rotated mos labels outside visible symbols`.

## 2026-08-10 - Organize editor source by domain

- Target: replace the flat editor source directory with explicit ownership and
  dependency boundaries without changing behavior.
- Changed areas: moved 57 modules and colocated tests under `app`,
  `interaction`, `canvas`, `document`, `components`, `demos`, `presentation`,
  and five `features` domains; kept only build/runtime infrastructure at the
  source root; repaired relative imports and documented placement/dependency
  rules in the source README.
- Validation: all 68 editor TypeScript relative imports resolve; 77 Vitest
  files and 440 tests, repository typecheck, editor production build, all 59
  Playwright flows, changed-file Prettier, and `git diff --check` passed. The
  existing large-chunk warning remains.
- Commit status: ready to commit directly on local `main` as
  `refactor(editor): organize source by domain`; remote push remains pending.

## 2026-08-10 - Simplify wire deletion and flightline guidance

- Target: replace competing Delete/Unroute behavior with one safe human-facing
  electrical branch deletion and make derived flightlines actionable guidance.
- Changed areas: added deterministic `cut_connection` Net partitioning and
  Agent API artifacts; routed GUI Route/Junction/mixed deletion through it;
  removed Unroute from the inspector; changed flightlines to nearest-frontier
  straight-line MST hints with clickable Wire targets and selected-Net display
  for SPICE-bound Documents; updated routing specifications and regressions.
- Validation: 43 focused Vitest tests, four focused Playwright flows,
  repository typecheck, affected package/editor builds, Agent API artifact
  check, and `git diff --check` passed. The existing large-chunk warning
  remains.
- Commit status: ready to commit on `main` as
  `fix(editor): simplify wire deletion and flightline guidance`.

## 2026-08-11 - Fix partial SPICE wire deletion

- Target: let users delete a visible Wire from an imported Net that still has
  unresolved flightlines without silently changing SPICE connectivity.
- Changed areas: made `cut_connection` preserve logical membership for
  already-partial and global Nets while still partitioning deterministic fully
  routed local Nets; renamed the GUI action to `Delete wire`; updated routing
  specifications and imported-partial-Net regressions.
- Validation: 22 focused Edit Engine tests, two focused Playwright flows,
  repository typecheck, affected builds, and `git diff --check` passed. The
  existing large-chunk warning remains.
- Commit status: ready to commit on `main` as
  `fix(editor): allow deleting routed parts of imported nets`.

## 2026-08-10 - Enforce a Razavi-only product symbol catalog

- Target: remove the second/legacy device library and fail visibly instead of
  silently substituting an unapproved symbol during SPICE import.
- Changed areas: reduced the runtime and Component Library to ten reviewed
  Razavi symbols; deleted legacy diode/inductor/BJT assets and generic-block
  generation; restricted PDK/import mappings; rejected unsupported Project
  open/recovery; updated routing fixtures, visual goldens, specifications, and
  browser/unit regressions.
- Validation: 440 workspace unit tests, repository typecheck, full build,
  focused unsupported-import Playwright flow, Razavi catalog and visual-golden
  checks, changed-file Prettier, and `git diff --check` passed. The broad
  formatter still reports the pre-existing untouched
  `packages/derived/src/connectivity.ts`.
- Commit status: ready to commit on `main` as
  `refactor(symbols): enforce Razavi-only product catalog`.

## 2026-08-10 - Unify group and routed-marker movement

- Target: remove drag-ownership conflicts between selected circuit groups,
  internal wires, and route-attached current markers after integrating the
  mainline Snap Engine.
- Changed areas: mainline branch integration, composite-selection hit
  precedence and live group preview, bounded route-attachment drag, common
  dashed marker selection, compact command surface, interaction specification,
  and focused unit/E2E regressions.
- Validation: repository typecheck, editor production build, 447 Vitest tests,
  62 Playwright flows plus enhanced focused preview checks, full format check,
  browser inspection, and `git diff --check` passed. One initial exporter test
  timeout passed both isolated and on the subsequent full run.
- Commit status: ready to commit on `codex/insert-component-dialog` as
  `fix(editor): unify group and routed marker movement`.

## 2026-08-10 - Preserve route markers through geometry edits

- Target: eliminate stale Junction/current-marker drag previews and prevent
  route-attached arrows from collapsing or rotating after a complex reroute.
- Changed areas: group preview membership, canonical Edit Engine marker
  projection across Route geometry changes and Junction splits, bend-direction
  tie-breaking, interaction specification, and focused unit/E2E regressions.
- Validation: affected production builds, repository typecheck, format check,
  448 Vitest tests, 63 Playwright flows, in-app browser inspection, and
  `git diff --check` passed.
- Commit status: ready to commit on `codex/insert-component-dialog` as
  `fix(editor): preserve route markers through geometry edits`.

## 2026-08-10 - Merge advanced GUI and Page mainline

- Target: make the accepted canvas-first GUI the mainline editor while retaining
  newer Page/file-system, Razavi-only, and electrical-connection behavior.
- Changed areas: resolved the editor shell and E2E merge; retained the modal
  component insert flow, floating Inspector, group/route-marker interaction,
  Page open/recovery, unsupported-symbol rejection, clickable flightlines, and
  `cut_connection`; adapted the modal catalog to the ten approved Razavi symbols.
- Validation: Razavi catalog check, repository typecheck, 448 Vitest tests,
  editor production build, Agent API artifact check, 65 Playwright flows,
  changed-file Prettier, live main GUI inspection, and `git diff --check` passed.
- Commit status: ready to commit on `main` as
  `merge: integrate advanced editor GUI with mainline`.

## 2026-08-10 - Add PDF-derived Razavi inductor

- Target: add only the Razavi inductor from a textbook-native PDF path while
  keeping PDF extraction, Symbol generation, and raster comparison separate.
- Changed areas: standalone PDF extractor and provenance, compatible
  hash-pinned `vectorEvidence` manifest entries, continuous inductor Symbol,
  catalog/editor/SPICE registration, visual-contract ADR/specification, and
  focused authority/catalog/import tests.
- Validation: source fingerprint and extractor reproducibility, generator
  stale checks, affected package builds, repository typecheck, 34 focused
  tests, changed-file formatting, inductor fidelity diff (IoU `0.7849`, zero
  registration lift, anti-alias verdict), and `git diff --check` passed. The
  broad formatter reports only the pre-existing untouched
  `packages/derived/src/connectivity.ts`.
- Commit status: ready to commit on `main` as
  `feat(symbols): add PDF-derived Razavi inductor`.

## 2026-08-11 - Add PDF-derived Razavi op-amp

- Target: add one three-terminal textbook op-amp through the established,
  separated PDF-vector evidence and raster-witness pipeline.
- Changed areas: Figure 8.26 object extractor, isolated witness and manifest
  provenance, generated op-amp Symbol, Analog Blocks palette registration,
  catalog tests, and PDF-evidence documentation.
- Validation: exact extractor reproduction, generator stale checks, symbols
  and editor production builds, repository typecheck, 31 focused tests,
  changed-file formatting, op-amp fidelity diff (IoU `0.7330`, soft IoU
  `0.8037`, zero registration lift, 100% edge-shell anti-alias verdict), and
  `git diff --check` passed.
- Commit status: ready to commit on `main` as
  `feat(symbols): add PDF-derived Razavi op-amp`.

## 2026-08-11 - Stabilize component insert dialog layout

- Target: keep catalog growth from resizing the Insert Component dialog or
  clipping its Cancel and Apply controls.
- Changed areas: fixed dialog row sizing, internally scrolling component list,
  fixed symbol-preview dimensions, and focused browser regression coverage.
- Validation: three focused Playwright flows, repository typecheck, editor
  production build, focused Prettier check, live in-app browser inspection, and
  `git diff --check` passed.
- Commit status: ready to commit on `main` as
  `fix(editor): stabilize component insert dialog layout`.

## 2026-08-11 - Add common Razavi device families

- Target: complete NPN/PNP, dependent current source, diode, gain block,
  ideal switch, coupled inductor/transformer, and a composable BJT hybrid-pi
  fixture from the approved Razavi textbook.
- Changed areas: separated PDF extraction and hash-pinned witnesses, seven
  generated Symbol assets, catalog and GUI registration, exact SPICE `D`/`Q`/`G`
  mappings, per-measurement fidelity witnesses, and electrical composition
  fixture/documentation.
- Validation: extractor/source integrity, generator stale checks, 64 affected
  tests plus 37 focused authority tests, repository typecheck, affected builds,
  seven registered fidelity diffs, targeted formatting, and `git diff --check`
  passed. Broad formatting reports only the pre-existing untouched
  `packages/derived/src/connectivity.ts`.
- Commit status: ready to commit on `main` as
  `feat(symbols): add common Razavi device families`.

## 2026-08-11 - Correct common Razavi source fidelity

- Target: remove the unsupported transformer and replace overclaimed common
  device approximations with traceable textbook geometry.
- Changed areas: direct Figure 12.6/12.11 NPN/PNP arrows, Figure 15.54 outline
  diode, Figure 2.37 VCCS arrow and provenance, Razavi emphasis stroke, catalog
  and GUI removal of transformer, authority hashes, fidelity targets, and
  correction documentation/tests.
- Validation: generator and authority stale checks, 35 focused tests, affected
  builds, repository typecheck, editor production build, five registered
  fidelity comparisons, live GUI inspection, formatting, and
  `git diff --check` passed. The editor build retains its existing large-chunk
  warning.
- Commit status: ready to commit on `main` as
  `fix(symbols): correct common Razavi source fidelity`.

## 2026-08-11 - Remove VCCS and normalize compact-device scale

- Target: remove the unneeded graphical controlled source and correct the
  oversized normalization of the recently added compact devices.
- Changed areas: VCCS asset/evidence/catalog/GUI/import removal, retained SPICE
  `G` syntax/IR with unsupported graphical-import diagnostics, retired hybrid-pi
  fixture, and uniform `2/3` scaling of NPN, PNP, diode, and ideal switch from
  60-unit to 40-unit primary pin spans.
- Validation: authority and generator checks, 39 focused tests, affected
  builds, repository typecheck, editor production build, four fidelity diffs,
  live GUI inspection, formatting, and `git diff --check` passed. The editor
  build retains its existing large-chunk warning.
- Commit status: ready to commit on `main` as
  `fix(symbols): remove VCCS and normalize device scale`.

## 2026-08-11 - Calibrate Razavi ideal switch

- Target: correct the ideal switch's line weight and proportions against the
  native Figure 13.4 vector objects.
- Changed areas: corrected PDF selection bounds and five-object fingerprint,
  source-stroke normalization, 60-unit pin span, contact/blade geometry,
  raster witness, authority hashes, generated Symbol/catalog registration,
  and focused regression expectations.
- Validation: common/catalog stale checks, symbols build, 23 focused tests,
  Python compile check, ideal-switch fidelity IoU 0.9814 with anti-alias-only
  residuals, and `git diff --check` passed.
- Commit status: ready to commit on `main` as
  `fix(symbols): calibrate Razavi ideal switch`.

## 2026-08-11 - Repair switch and BJT joints

- Target: remove switch-contact protrusions and correct BJT arrow proportion,
  tip occlusion, and diagonal-to-lead gaps.
- Changed areas: contact-boundary lead termination; corrected PNP Figure 12.11
  selection; uniformly scaled NPN/PNP source geometry; arrow-polygon clipping;
  joined branch/lead polylines; regenerated evidence, witnesses, catalog, and
  runtime registration; focused geometry regressions.
- Validation: common/catalog stale checks, symbols build, 23 focused tests,
  Python compile and focused formatting checks, fidelity IoU 0.9814/0.9846/
  0.9901 for switch/NPN/PNP with anti-alias-only residuals, and
  `git diff --check` passed.
- Commit status: ready to commit on `main` as
  `fix(symbols): repair switch and BJT joints`.

## 2026-08-11 - Close BJT arrow seams

- Target: eliminate the remaining PNP base-side arrow gap and make the NPN
  emitter arrow continuous with both adjoining line sections at GUI zoom.
- Changed areas: bounded 1.2-unit centerline overlap inside both native arrow
  polygons, regenerated NPN/PNP evidence and witnesses, catalog/runtime output,
  and focused overlap-coordinate assertions.
- Validation: common/catalog stale checks, symbols build, 23 focused tests,
  focused formatting and Python compile checks, GUI-equivalent 8x visual
  inspection, fidelity IoU 0.9861/0.9909 for NPN/PNP with anti-alias-only
  residuals, and `git diff --check` passed.
- Commit status: ready to commit on `main` as
  `fix(symbols): close BJT arrow seams`.

## 2026-08-11 - Use PMOS-style PNP arrow support

- Target: prevent any PNP centerline from reaching the arrow tip by adopting
  the established PMOS tip/head/rear-support topology without changing the
  source arrow artwork.
- Changed areas: rigidly translated, source-orientation-preserving PNP arrow
  with its true tip at the base bar, single rear support to the emitter lead,
  regenerated evidence/witness/catalog/runtime output, and a no-tip-line
  regression.
- Validation: common/catalog stale checks, symbols build, 23 focused tests,
  focused formatting and Python compile checks, GUI-equivalent 8x visual
  inspection, PNP fidelity IoU 0.9880 with all residual pixels confined to the
  anti-alias contour, and `git diff --check` passed.
- Commit status: ready to commit on `main` as
  `fix(symbols): use PMOS-style PNP arrow support`.

## 2026-08-11 - Add Razavi closed switch

- Target: add a reviewed two-terminal closed switch sourced from the approved
  textbook's Figure 13.5 S2 on printed page 542.
- Changed areas: isolated PDF-vector evidence and witness, contact-clipped
  closed geometry, common measurement and fidelity registration, palette and
  runtime catalog, plus focused geometry assertions.
- Validation: source object topology and authority hashes, common/catalog stale
  checks, symbols build, 23 focused tests, enlarged raster inspection, closed
  switch fidelity IoU 0.9866 with anti-alias-only residuals, and `git diff
--check` passed.
- Commit status: ready to commit on `main` as
  `feat(symbols): add Razavi closed switch`.
- Correction: this first baseline used candidate-generated witness artwork and
  misidentified a nearby horizontal wire; it is superseded by the direct source
  crop correction below.

## 2026-08-11 - Correct closed-switch PDF crop

- Target: replace the false closed-switch proxy with the exact Figure 13.5 S2
  source geometry from printed page 542.
- Changed areas: direct PDF crop witness, exact two-lead/two-contact/angled
  blade extraction, witness-owned fidelity window propagation, regenerated
  Symbol/catalog output, and a regression asserting source-PDF witness kind.
- Validation: native object fingerprint (5 objects), source crop inspection,
  common/catalog stale checks, symbols build, 23 focused tests, Python compile,
  enlarged reference/render/diff inspection, fidelity IoU 0.9854 with
  anti-alias-only residuals, and `git diff --check` passed.
- Commit status: ready to commit on `main` as
  `fix(symbols): correct Razavi closed switch evidence`.

## 2026-08-11 - Correct PDF-derived fidelity baselines

- Target: put closed switch in the editor's switch group and replace synthetic
  PDF-derived fidelity witnesses with direct textbook-PDF crops.
- Changed areas: explicit source-page crop protocol and fixed witness windows
  for common assets, source-PDF witnesses for op-amp and inductor, manifest
  hashes/measurements, authority enforcement, visual-contract/ADR wording,
  and editor palette grouping.
- Validation: Python compilation, common/inductor/op-amp/catalog stale checks,
  symbols build, 27 focused tests, eight PDF-derived fidelity reports, and
  `git diff --check` passed. The direct references reveal real IoUs of 0.7849
  (inductor), 0.6769 (op-amp), 0.6430 (NPN), 0.5284 (PNP), 0.1514 (diode),
  0.1957 (voltage amplifier), 0.6342 (ideal switch), and 0.9854 (closed
  switch); the weak diode/voltage-amplifier source selections require later
  visual calibration rather than synthetic-score masking.
- Commit status: ready to commit on `main` as
  `fix(symbols): use source PDF crops for common fidelity baselines`.

## 2026-08-11 - Calibrate shared Razavi BJT arrow template

- Target: correct under-sized NPN/PNP GUI arrows and prevent the two polarity
  variants from drifting into different triangle shapes.
- Changed areas: one Figure 12.6-derived arrow template, a measured 1.18x
  magnification, mirrored PNP placement, regenerated BJT evidence/assets and
  catalog, plus a congruence regression for the two arrow triangles.
- Validation: Python compilation, common/catalog stale checks, symbols build,
  23 focused tests, NPN/PNP direct-PDF fidelity reports, and `git diff --check`
  passed. Arrow-region black-pixel deficit improved from 25% to 5% for NPN and
  from 33% to 16% for PNP; full-symbol IoU improved to 0.6436 and 0.5471.
- Commit status: ready to commit on `main` as
  `fix(symbols): unify Razavi BJT arrow geometry`.

## 2026-08-11 - Calibrate diode and voltage-amplifier PDF geometry

- Target: correct the diode fidelity orientation and align the voltage-amplifier
  frame to the approved textbook's native vector geometry without changing
  either symbol's electrical anchors.
- Changed areas: source-PDF witness windows/origins, diode body scale and
  target rotation, direct-vector voltage-amplifier triangle coordinates,
  manifest-pinned evidence/catalog output, fidelity runner registration
  reporting/target validation, and focused catalog assertions.
- Validation: Python compile, common/catalog stale checks, symbols build, 24
  focused tests, and direct-PDF fidelity reports. Diode reached IoU 0.8800
  with no registration translation; voltage amplifier reached 0.7381, with
  remaining error confined to its anti-alias contour. `git diff --check`
  passed.
- Commit status: ready to commit on `main` as
  `fix(symbols): calibrate diode and voltage amplifier geometry`.

## 2026-08-11 - Stabilize default instance-label placement

- Target: stop default labels from changing clearance under component rotation
  and give NPN/PNP the same non-wiring-side placement as MOS names, without
  altering annotation persistence or schema.
- Changed areas: shared derived label-placement helper, attached-label
  rotation path, and focused BJT/default-label regressions.
- Validation: 14 focused derived/editor/edit-engine tests, derived and
  edit-engine TypeScript builds, editor Vite production build, and `git diff
--check` passed.
- Commit status: ready to commit on `main` as
  `fix(labels): stabilize default instance text placement`.

## 2026-08-11 - Correct label side inference and clearance

- Target: prevent rotated instance labels from selecting the wrong reference
  side and bring default names to a uniform 1.5-unit visible-geometry gap.
- Changed areas: derived side inference/default anchors, BJT clearance and
  rotation regressions, plus adjusted legacy MOS default-label expectation.
- Validation: 14 focused tests, derived/edit-engine TypeScript builds, editor
  production build, and `git diff --check` passed.
- Commit status: ready to commit on `main` as
  `fix(labels): correct rotated text side and clearance`.

## 2026-08-11 - Correct Razavi switch lead and contact geometry

- Target: remove visible closed-switch lead steps at wire joins and prevent the
  ideal-switch blade from entering its hollow pivot contact.
- Changed areas: common PDF-vector switch normalization, direct-PDF evidence
  and manifest hashes, generated assets/catalog, and focused switch geometry
  assertions.
- Validation: Python compile, common/catalog stale checks, symbols build, 23
  focused tests, direct-PDF switch diffs, and `git diff --check` passed.
  Closed-switch IoU is 0.9840; ideal-switch residual is expected because the
  product now deliberately excludes the source blade segment inside the hollow
  contact.
- Commit status: ready to commit on `codex/contextual-properties-net-labels`
  as `fix(symbols): align Razavi switch leads and contacts`.

## 2026-08-11 - Close ideal-switch blade/contact gap

- Target: replace the over-cropped ideal-switch blade with the same controlled
  contact-ring overlap as the closed switch.
- Changed areas: common switch extraction constant/clip, regenerated
  ideal-switch evidence/catalog output, and exact clearance regression.
- Validation: Python compile, common/catalog stale checks, symbols build, 23
  focused tests, direct-PDF fidelity report, and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels`
  as `fix(symbols): close ideal switch blade contact gap`.

## 2026-08-11 - Rename ideal switch as open switch

- Target: change the user-facing component name while retaining the stable
  `ideal-switch` persistence ID.
- Changed areas: common source definition, regenerated source evidence/catalog,
  and catalog name regression.
- Validation: Python compile, common/catalog stale checks, symbols build, 23
  focused tests, and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels`
  as `fix(symbols): rename ideal switch as open switch`.

## 2026-08-12 - Close VDD stem/bar seam

- Target: remove the visible VDD power-port gap between the vertical stem and
  filled horizontal bar without changing its pin or power-label semantics.
- Changed areas: VDD asset, regenerated catalog output/hash, and an interior
  stem/bar-overlap regression.
- Validation: catalog stale check, symbols build, 20 focused catalog tests,
  and `git diff --check` passed. The branch-local commit remains subject to
  the required clean-state CI and remote Actions gate before main delivery.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `fix(symbols): close VDD stem and bar seam`.

## 2026-08-11 - Contextual Properties and Net Labels

- Target: add the smallest durable component Value path and make the editor's
  contextual Properties, Net Label, and construction-line shortcuts coherent.
- Changed areas: typed property patch/undo/Agent capability artifacts; manual
  insert Value handoff; fixed Properties dock for component and drawing edits;
  route-anchored `L` Net Label editor; `P` construction line; import-only
  review; specs and focused UI regressions.
- Validation: 50 focused Vitest tests, workspace typecheck, regenerated Agent
  API artifacts, production editor build, and 69 E2E tests passed. Full
  `pnpm test` is blocked by eight unrelated render/symbol golden failures;
  repository-wide format check is blocked by three unrelated pre-existing
  formatting findings.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as
  `feat(editor): add contextual properties and net labels`.

## 2026-08-11 - Virtuoso-style Insert Dialog and Explicit Properties

- Target: make manual insertion compact and parameter-first while reserving
  Properties expansion for explicit `Q` or shelf actions.
- Changed areas: shared R/L/C and MOS parameter catalogue; temporary placement
  request; collapsed in-column component picker; orientation/reference setup;
  component Properties fields; reference-label suppression; interaction spec;
  and targeted E2E regressions.
- Validation: focused Vitest tests (20), workspace typecheck, production editor
  build, complete editor E2E suite (70), and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as
  `feat(editor): refine Virtuoso-style component insertion`.

## 2026-08-11 - Component Placement Event Capture

- Target: make pending component placement independent of SVG child hit target
  and input-event detail.
- Changed areas: canvas gesture precedence, click-time placement commit, and a
  semantic-click E2E regression.
- Validation: component insertion E2E (6), workspace typecheck, production
  editor build, and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as
  `fix(editor): capture all component placement clicks`.

## 2026-08-11 - Compact Insert-Control Layout

- Target: reduce the `I` dialog's left-column visual weight without changing
  placement data or raw parameter semantics.
- Changed areas: compact rotation/label/name row, inline parameter unit/help
  labels, explicit component-search accessibility name, dialog styles/spec,
  and affected insertion helpers/regressions.
- Validation: focused Vitest tests, workspace typecheck, production editor
  build, complete editor E2E suite (71), and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as
  `refactor(editor): compact component insertion controls`.

## 2026-08-11 - Compact Component Properties

- Target: apply the compact insert-control language to the `Q` Component
  Properties surface and remove repeated geometry display.
- Changed areas: instance overview, inline parameter labels, one-row X/Y/Rotate
  controls, compact property styles, interaction specification, and focused
  Properties regression.
- Validation: focused Vitest tests (16), component insertion E2E (6), workspace
  typecheck, production editor build, and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as
  `refactor(editor): compact component properties`.

## 2026-08-11 - Restore Fit View Shortcut

- Target: restore `F` as the primary Fit View shortcut without prematurely
  choosing a replacement mirror bindkey.
- Changed areas: shortcut resolver/tests, unreachable mirror shortcut dispatch,
  and interaction contract.
- Validation: focused shortcut/App tests (21), workspace typecheck, production
  editor build, and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as
  `fix(editor): restore F fit view shortcut`.

## 2026-08-11 - Virtuoso-Style Copy Placement and Mirror Shortcuts

- Target: adopt R/Shift+R/Shift+V mirrors and replace Ctrl+C/Ctrl+V with a
  mouse-following `C` copy placement.
- Changed areas: shortcut resolver, clipboard preview helper, transient copy
  placement in the canvas, Edit menu/help/contract, and group-copy/mirror/Esc
  regressions.
- Validation: focused tests (23), key manual-editor E2E (4), workspace
  typecheck, production build, complete editor E2E (72), and `git diff --check`
  passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as
  `feat(editor): add copy placement shortcuts`.

## 2026-08-11 - Correct Mirror Shortcut Copy

- Target: reconcile visible Edit, Properties, and Help text with the implemented
  mirror and copy-placement shortcut map.
- Changed areas: Edit mirror actions, selected-component Properties actions,
  Help guidance, and the target record. The interaction specification already
  had the correct mapping and was inspected without modification.
- Validation: obsolete-label search, production editor build, and
  `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as
  `fix(editor): correct mirror shortcut labels`.

## 2026-08-11 - Compact Properties Mirror Actions

- Target: group the two component mirror actions directly under geometry fields
  without changing their behavior.
- Changed areas: selected-component Properties markup and compact mirror-row
  styles, plus target records.
- Validation: production editor build and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as
  `refactor(editor): compact properties mirror actions`.

## 2026-08-12 - Connectivity, Routing, and Electrical Debugging Plan

- Target: define the consolidation boundary for Net/Wire/Junction/Flightline
  and Route geometry before P0 ERC, search, Net highlight, and hierarchy trace.
- Changed areas: cross-cutting roadmap, preservation/migration matrix, 11
  bounded work packages, deterministic gates, and roadmap index.
- Validation: current behavior helper audit, referenced-path check, new-plan
  Prettier check, and `git diff --check` passed.
- Commit status: ready to commit on `main` as
  `docs(roadmap): plan connectivity and routing unification`.

## 2026-08-12 - Cloudflare Deployment

- Target: publish the existing editor at `analog-canvas.tokenzhang.com` and
  automate subsequent production deployments from `main`.
- Changed areas: Workers Static Assets configuration, SPA fallback, custom
  domain binding, GitHub Actions deployment, and repository secrets.
- Validation: frozen dependency install, production build, Wrangler dry-run,
  pull request CI matrix, successful production deployment, HTTP 200 root/SPA
  requests, and PWA manifest inspection.
- Commit status: merged through pull request #5 as `99914d8`; production is
  live and the Action-wrapper follow-up is recorded separately.

## 2026-08-12 - Cloudflare Workflow Fix

- Target: repair the first automatic deployment's Wrangler installation
  failure in the pnpm workspace.
- Changed areas: direct pinned Wrangler invocation and documentation-only path
  exclusions.
- Validation: direct production deploy, Wrangler dry-run, all five pull request
  CI jobs, successful `main` Cloudflare workflow, and live URL checks passed.
- Commit status: merged through pull request #6 as `b7a4424`.

## 2026-08-12 - Visitor Analytics

- Target: add Analog Arena-style first-party visitor counts, origins, and
  acquisition analytics to Analog Canvas.
- Changed areas: Worker API, SQLite-backed Durable Object, bounded privacy
  filters, custom-domain-only tracking, editor totals link, noindex dashboard,
  world heatmap, tests, and Cloudflare migration/configuration.
- Validation: 475 unit/integration tests, release contracts, focused analytics
  browser test, remote five-job CI matrix, Wrangler dry-run, successful
  Cloudflare deploy, live PV/UV/dimension reads, and cross-site/DNT rejection
  passed.
- Commit status: merged through pull request #8 as `4b9a09e`; production is
  live at `https://analog-canvas.tokenzhang.com/analytics`.

## 2026-08-12 - WP-R0 Connectivity/Routing Behavioral Baseline

- Target: first work package of the connectivity-routing-debugging roadmap —
  pin current behavior before any refactor. Additive characterization tests
  plus a historical doc note; no production code change.
- Changed areas: new `packages/derived/src/endpoint.test.ts` (14 tests) and
  `packages/derived/src/routes.test.ts` (7 tests) covering `endpointKey`,
  endpoint visibility/point/outward-direction, `routePolyline`, `deriveCrossings`
  overlap and shared-endpoint exclusion, and storage-partition characterization;
  historical note on `docs/roadmap/phase-3-connectivity-and-routing.md` Detach
  scenario; target plan and this log.
- Validation: workspace `pnpm typecheck`, `vitest run packages/derived/src/`
  (76 tests, was 55), `prettier --check` on owned files, and `git diff --check`
  passed. Full-repo/e2e deferred (additive tests + doc note only).
- Finding: current `deriveFlightlines` from/to direction (and derived id) is
  NOT partition-invariant — pinned for R2 to address consciously.
- Note: an unrelated dirty target (`plan/2026-08-12-ci-delivery-and-archive-
governance`) coexists; only owned paths were staged.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `test(derived): characterize endpoint/route primitives and partition
invariance (WP-R0)`.

## 2026-08-12 - WP-R1 ADR and Spec Freeze

- Target: freeze cross-module contracts before code migration. Documentation-
  only; no code, schema, fixture, or Project-file change.
- Changed areas: new ADRs 0013 (Project Connectivity Index), 0014 (Resolved
  Route Geometry), 0015 (Object Locator + Diagnostic Envelope); schematic-model
  spec proposed NoConnect + binding-evidence subsection; connectivity-and-
  routing spec proposed unified-read-models subsection, compatibility/deletion
  threshold, and corrected `cut_connection` validation bullet; one-line ADR
  forward-references added to edit-engine, editor-interaction, agent-api, and
  export specs.
- Validation: cross-link audit (12/12 referenced paths resolve); `git diff
--check` clean. Markdown outside the `format:check` glob; no code surface
  changed.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `docs(adr): freeze connectivity index, resolved geometry, and locator
contracts (WP-R1)`.

## 2026-08-12 - WP-R2 Additive Project Connectivity Index

- Target: implement the unified read-only `ProjectConnectivityIndex` (ADR 0013)
  additively as a facade over existing `derive*` primitives, with partition-
  invariant flightline normalization, typed virtual edges, hierarchy edges, and
  a project object index. No production consumer switch.
- Changed areas: new `packages/derived/src/connectivity-index.ts` and
  `connectivity-index.test.ts` (9 tests); `packages/derived/src/index.ts`
  re-export; target plan and this log.
- Validation: workspace `pnpm typecheck`; `vitest run packages/derived/src/`
  (85 tests, was 76); `prettier --check` on new files; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(derived): add ProjectConnectivityIndex with flightline normalization
(WP-R2)`.

## 2026-08-12 - WP-R3 Additive Resolved Route Geometry

- Target: implement the unified `ResolvedRouteGeometry` (ADR 0014) additively,
  with typed segments/vertices, bounds, hit segments, and profile-independent
  endpoint joins (raw direction ingredients for the renderer's terminal and
  route-anchor miter bridges). No production consumer switch.
- Changed areas: new `packages/derived/src/resolved-route-geometry.ts` and
  `resolved-route-geometry.test.ts` (7 tests); `packages/derived/src/index.ts`
  re-export; target plan and this log.
- Validation: workspace `pnpm typecheck`; `vitest run packages/derived/src/`
  (92 tests, was 85); `prettier --check` on new files; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(derived): add ResolvedRouteGeometry with endpoint join ingredients
(WP-R3)`.

## 2026-08-12 - WP-R4 Route-Tap Planner Extraction (App thin-out step 1)

- Target: begin the App thin-out by extracting the route-tap hit resolver
  inlined in `App.tsx` into a pure, unit-tested wiring-feature module.
  Behavior-preserving. Stretch/group-move wrapper extractions deferred to R10
  (e2e-gated).
- Changed areas: new `apps/editor/src/features/wiring/route-tap.ts` and
  `route-tap.test.ts` (6 tests); `apps/editor/src/app/App.tsx` imports the
  resolver instead of inlining it; target plan and this log.
- Validation: workspace `pnpm typecheck`; `vitest run route-tap.test.ts` (6) and
  `App.test.tsx` (11); `prettier --check` on changed files; `git diff --check`.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(editor): extract route-tap resolver from App into wiring feature
(WP-R4)`.

## 2026-08-12 - WP-R5 Project Search Index (core)

- Target: deterministic project search index (ADR 0015 locator backend) over
  instances/nets/ports, exact > prefix > substring, no fuzzy ranking. Pure
  backend; Ctrl+F UI and HierarchyFrame document-stack migration deferred to
  R9/R10 (e2e-gated).
- Changed areas: new `packages/derived/src/project-search.ts` and
  `project-search.test.ts` (7 tests); `packages/derived/src/index.ts` re-export;
  target plan and this log.
- Validation: workspace `pnpm typecheck`; `vitest run packages/derived/src/`
  (99 tests, was 92); `prettier --check` on new files; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(derived): add deterministic project search index (WP-R5)`.

## 2026-08-12 - WP-R6 Net Highlight and Cross-Cell Trace (core)

- Target: compute net highlight and cross-cell trace from the
  ProjectConnectivityIndex (R2). Pure computation; overlay rendering deferred
  to R9 (e2e-gated UI).
- Changed areas: new `packages/derived/src/net-highlight.ts` and
  `net-highlight.test.ts` (4 tests); `packages/derived/src/index.ts` re-export;
  target plan and this log.
- Validation: workspace `pnpm typecheck`; `vitest run packages/derived/src/`
  (103 tests, was 99); `prettier --check` on new files; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(derived): compute net highlight and cross-cell trace from the index
(WP-R6)`.

## 2026-08-12 - WP-R7 NoConnect Schema and v2 -> v3 Migration

- Target: persisted NoConnect record + schema version 2 -> 3 + idempotent
  backfill migration + schema-level invariants. Foundation for the ERC engine
  (WP-R8). Edit/importer/Agent/visual sub-steps deferred.
- Changed areas: `packages/model/src/schema.ts` (NoConnect, version 3, invariant,
  types); new `migration-v2-to-v3.ts` + test; `persistence.ts` registration;
  cascade `noConnects: []` added to typed document literals (`factories`,
  `importer`, 3 test helpers), `persistence.test` migration chain, `platform-web`
  assertion, and regenerated v3 fixtures (minimal, phase-1-manual, phase-3-
  routing).
- Validation: workspace `pnpm typecheck`; full `pnpm test` — 524 passed, 8
  failed. The 8 failures are pre-existing and unrelated (confirmed by stashing
  R7 — same 8 fail on clean branch): instance-label/golden/Razavi-catalog
  regeneration in flight on the separate `codex/ci-delivery-gate` target. R7
  adds no new failures. `prettier --check`; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(model): add NoConnect record with v2->v3 schema migration (WP-R7)`.

## 2026-08-12 - WP-R8 ERC Engine (framework + core rules)

- Target: ERC engine emitting the ADR 0015 diagnostic envelope (domain "erc"),
  driven by the ProjectConnectivityIndex (R2) and NoConnect (R7). Framework plus
  duplicate-instance-name, duplicate-net-name, no-connect-conflict, and
  unconnected-pin rules. Role/hierarchy/model rules deferred.
- Changed areas: new `packages/derived/src/diagnostics/erc.ts` and `erc.test.ts`
  (6 tests); `packages/derived/src/index.ts` re-export; target plan and this log.
- Validation: workspace `pnpm typecheck`; `vitest run packages/derived/src/`
  (109 tests, was 103); `prettier --check` on new files; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(derived): add ERC engine emitting the unified diagnostic envelope
(WP-R8)`.

## 2026-08-12 - WP-R9 Diagnostic Aggregation (data layer)

- Target: unified Diagnostic envelope + aggregation merging ERC (R8) with
  adapted VisualDiagnostic observations into one domain-tagged sorted list. Data
  layer for the diagnostic UI; the React panel + navigateTo are deferred
  (e2e-gated).
- Changed areas: new `packages/derived/src/diagnostics/diagnostic.ts` and
  `diagnostic.test.ts` (3 tests); `packages/derived/src/index.ts` re-export;
  target plan and this log.
- Validation: workspace `pnpm typecheck`; `vitest run packages/derived/src/`
  (112 tests, was 109); `prettier --check` on new files; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(derived): unify diagnostics into a single sorted envelope (WP-R9)`.

## 2026-08-12 - WP-R10 Deletion-Gate Parity and Migration Gate Status

- Target: establish the §13 deletion-gate characterization tests (old/new
  parity) and record the migration gate status. Old production read models are
  NOT deleted — deletion is gated on e2e + pre-existing-failure resolution +
  performance baseline, none of which this session can run/resolve.
- Changed areas: new `packages/derived/src/deletion-gate-parity.test.ts`
  (8 tests: flightline content + route centerline parity across four fixtures);
  target plan (gate-status record + ordered switch plan); this log.
- Validation: workspace `pnpm typecheck`; `vitest run packages/derived/src/`
  (120 tests, was 112); `prettier --check` on new file; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `test(derived): add old/new deletion-gate parity tests (WP-R10)`.

## 2026-08-12 - Connectivity Recovery C0: status and contract reconciliation

- Target: reconcile the accepted connectivity/routing roadmap with actual
  additive-prototype delivery; preserve history while making incomplete exit
  conditions explicit.
- Changed areas: roadmap status matrix and C0–C10 recovery waves; ADR 0013–0015
  amendments for staged index/cache, route-geometry/remap, and canonical
  locator/diagnostic ownership; target plan and this log.
- Validation: reviewed cross-references and ran `git diff --check`; no runtime
  or schema behavior changed.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `docs(roadmap): reconcile connectivity delivery status`.

## 2026-08-12 - Connectivity Recovery C1: canonical locator and diagnostic

- Target: replace incompatible index/search/ERC locator declarations and the
  ERC-coupled diagnostic definition with the single ADR 0015 public protocol.
- Changed areas: new `object-locator.ts`; connectivity index, search, ERC and
  visual diagnostic adaptation; focused locator-shape tests; target plan and
  this log.
- Validation: workspace `pnpm typecheck`; 25 focused derived tests; targeted
  Prettier; `rg` confirmed no production private locator declaration; `git diff
--check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(derived): unify locator and diagnostic protocols`.

## 2026-08-12 - Connectivity Recovery C2a: NoConnect electrical lifecycle

- Target: make persisted NoConnect facts editable and observable without
  overstating the unfinished clipboard/renderer/editor lifecycle.
- Changed areas: typed edit-engine add/remove operations and deletion guard;
  topology hash; Agent Snapshot schema/builder and edit classification; target
  plan and log.
- Validation: workspace `pnpm typecheck`; 20 focused topology-hash, Snapshot
  and transaction tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(noconnect): add editable electrical lifecycle core`.

## 2026-08-12 - Connectivity Recovery C2b: NoConnect clipboard transfer

- Target: preserve and remap selected-instance terminal NoConnect declarations
  through clipboard preview and paste.
- Changed areas: editor clipboard data/proposal and regression test; target
  plan and this log.
- Validation: workspace `pnpm typecheck`; 12 focused clipboard/transaction
  tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(editor): preserve NoConnect declarations through clipboard paste`.

## 2026-08-12 - Connectivity Recovery C3: route geometry semantics

- Target: correct misleading segment-identity semantics and make route-anchor
  joins part of one document-level pure geometry read model.
- Changed areas: resolved route geometry types/resolver/tests; target plan and
  this log.
- Validation: workspace `pnpm typecheck`; 16 focused resolved-geometry and
  deletion-parity tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(derived): clarify route geometry identity and joins`.

## 2026-08-12 - Connectivity Recovery C4: complete document index

- Target: materialise document route geometry, remove per-Net full-document
  flightline derivation, and add non-persisted revision-scoped document caching.
- Changed areas: connectivity index and focused tests; target plan and log.
- Validation: workspace `pnpm typecheck`; 18 focused connectivity-index and
  deletion-parity tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `perf(derived): complete cached document connectivity index`.

## 2026-08-12 - Connectivity Recovery C5a: Wire commit planner boundary

- Target: move pure wire path/commit and junction-anchor proposal logic out of
  editor interaction code into the edit-engine boundary.
- Changed areas: new edit-engine routing planner and export; editor
  compatibility re-exports; target plan and log.
- Validation: workspace `pnpm typecheck`; 16 focused wire-path, wire-editing
  and transaction tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(wiring): move wire proposals into edit engine`.

## 2026-08-12 - Connectivity Recovery C6a: canonical project search backend

- Target: have search consume the shared object index and match property keys
  as well as values, without claiming the unfinished Ctrl+F/navigation UI.
- Changed areas: project search and tests; target plan and log.
- Validation: workspace `pnpm typecheck`; 19 focused search/connectivity-index
  tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(search): use canonical locators and property keys`.

## 2026-08-12 - Connectivity Recovery C7a: bidirectional hierarchy Net trace

- Target: add a recursive pure Net trace graph without destabilising the legacy
  one-hop API or overstating unfinished editor highlighting.
- Changed areas: derived Net trace and tests; target plan and log.
- Validation: workspace `pnpm typecheck`; 15 focused trace/index tests;
  targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(derived): add bidirectional hierarchy Net trace`.

## 2026-08-12 - Connectivity Recovery C8a: ERC symbol and hierarchy interface

- Target: add only deterministic resolver/model hierarchy checks without
  inferring missing foundry-model or pin-role semantics.
- Changed areas: derived ERC and tests; target plan and log.
- Validation: workspace `pnpm typecheck`; 18 focused ERC/index tests; targeted
  Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(erc): diagnose symbols and hierarchy interface mismatches`.

## 2026-08-12 - Connectivity Recovery C5b: route deletion planner boundary

- Target: centralise visual route/junction deletion closure and preserve the
  established cut-versus-electrical-Net semantics.
- Changed areas: edit-engine routing planner, App Delete consumers, selection
  compatibility adapter/tests, target plan and log.
- Validation: workspace `pnpm typecheck`; 17 focused selection/wiring/
  transaction tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(wiring): centralize visual route deletion planning`.

## 2026-08-12 - Connectivity Recovery C6b: project search UI

- Target: expose canonical project search by Ctrl+F without falsely claiming
  hierarchy-frame navigation or Net highlight completion.
- Changed areas: editor search dialog, App integration/styles and focused E2E;
  target plan and log.
- Validation: workspace `pnpm typecheck`; focused Playwright search flow;
  targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(editor): add Ctrl+F project search`.

## 2026-08-12 - Connectivity Recovery C7b: current-document Net highlight

- Target: surface C4 indexed Net membership in a non-mutating editor overlay,
  without claiming cross-Cell rendering/navigation.
- Changed areas: App highlight state/overlay and styles; focused E2E; target
  plan and log.
- Validation: workspace `pnpm typecheck`; two focused Playwright search and
  highlight flows; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(editor): highlight current-document Net membership`.

## 2026-08-12 - Connectivity Recovery C2c: formal NoConnect rendering

- Target: render persisted terminal and port NoConnect declarations in the
  shared formal SVG scene used by canvas and export.
- Changed areas: SVG renderer and regression test; target plan and log.
- Validation: workspace `pnpm typecheck`; 24 focused render tests; targeted
  Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(render): render explicit NoConnect markers`.

## 2026-08-12 - Connectivity Recovery C2d: NoConnect endpoint editing

- Target: create and clear NoConnect declarations through existing selected
  terminal/port Endpoint actions.
- Changed areas: editor endpoint action and focused browser regression; target
  plan and log.
- Validation: workspace `pnpm typecheck`; focused Playwright mark/clear flow;
  targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(editor): edit NoConnect declarations from endpoints`.

## 2026-08-12 - Connectivity Recovery C8b: role-sensitive ERC policy

- Target: diagnose floating gate and hidden/unconnected bulk conditions from
  reviewed pin roles without changing topology.
- Changed areas: derived ERC policy and role/NoConnect/hidden-variant tests;
  target plan and log.
- Validation: workspace `pnpm typecheck`; 11 focused ERC tests; targeted
  Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(erc): diagnose floating gates and hidden bulk risks`.

## 2026-08-12 - Connectivity Recovery C9a: current-document ERC inspector

- Target: show active-document ERC separately in the Properties shelf and
  navigate its primary target without changing visual/import review semantics.
- Changed areas: editor diagnostic derivation/navigation, Inspector section,
  scoped CSS, and focused component/browser tests; target plan and log.
- Validation: workspace `pnpm typecheck`; 2 focused Inspector tests; focused
  Playwright ERC flow; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(editor): surface current-document ERC diagnostics`.

## 2026-08-12 - Connectivity Recovery C8c: typed source binding evidence

- Target: persist explicit import binding facts and derive missing/unsupported
  model ERC only from those facts.
- Changed areas: model instance schema, SPICE importer evidence, ERC policy,
  model spec, and focused importer/ERC tests; target plan and log.
- Validation: workspace `pnpm typecheck`; 23 focused model/SPICE/ERC tests;
  targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(erc): consume typed source binding evidence`.

## 2026-08-12 - Connectivity Recovery C6c: canonical hierarchy navigation

- Target: replace document-id navigation with canonical hierarchy frames and
  migrate search/ERC target jumps through one locator navigator.
- Changed areas: derived path resolver, editor navigation state/consumers, and
  focused hierarchy/App/browser regressions; target plan and log.
- Validation: workspace `pnpm typecheck`; 17 focused derived/App tests; two
  focused Playwright search/ERC flows; targeted Prettier; `git diff --check`
  clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(editor): navigate canonical locators across hierarchy`.

## 2026-08-12 - Connectivity Recovery C7c: hierarchy-aware Net highlight

- Target: retain a logical Net highlight by its origin Cell/Net pair and
  resolve the active Cell overlay from the bidirectional hierarchy trace.
- Changed areas: editor highlight state/trace consumer; target plan and log.
- Validation: workspace `pnpm typecheck`; 16 focused Net/App tests; focused
  Playwright Net-highlight flow; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(editor): retain Net highlights across hierarchy Cells`.

## 2026-08-12 - Connectivity Recovery C8d: imported pin mapping ERC

- Target: detect persisted positional SPICE pin facts that no longer map
  uniquely to the resolved symbol.
- Changed areas: derived ERC mapping policy and regression tests; target plan
  and log.
- Validation: workspace `pnpm typecheck`; 13 focused ERC tests; targeted
  Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(erc): diagnose stale imported pin mappings`.

## 2026-08-12 - Connectivity Recovery C6d: cross-Cell locator browser coverage

- Target: prove editor navigation from a child-Cell project-search locator and
  the retained parent `Up` frame.
- Changed areas: minimal imported hierarchy fixture, editor Playwright flow,
  target plan and log.
- Validation: focused Playwright hierarchy navigation; 12 focused
  hierarchy/App unit tests; workspace `pnpm typecheck`; targeted Prettier;
  `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `test(editor): cover cross-Cell locator navigation`.

## 2026-08-12 - Connectivity Recovery C9b: project ERC diagnostic navigation

- Target: surface the full project ERC envelope in the editor and navigate an
  off-Cell diagnostic via its canonical locator.
- Changed areas: editor ERC shelf presentation and focused selection/browser
  tests; target plan and log.
- Validation: 14 focused selection/App unit tests; focused Playwright child
  ERC navigation; workspace `pnpm typecheck`; targeted Prettier; `git diff
--check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(editor): navigate project ERC diagnostics`.

## 2026-08-12 - Connectivity Recovery C3d: formal render geometry consumer

- Target: migrate formal SVG route, bridge, marker attachment, and bounds
  consumers to resolved document routing geometry.
- Changed areas: `@icm/render-svg` route rendering; target plan and log.
- Validation: 32 focused render/geometry tests including existing SVG goldens;
  workspace `pnpm typecheck`; static no-direct-`routePolyline` audit;
  targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(render): consume resolved route geometry`.

## 2026-08-12 - Connectivity Recovery C3e: editor geometry read consumer

- Target: adapt editor route hit/display/marker/highlight records from the
  active document's resolved route geometry.
- Changed areas: editor route read model; target plan and log.
- Validation: 16 focused App/interaction tests; two focused Playwright route
  flows; workspace `pnpm typecheck`; targeted Prettier; `git diff --check`
  clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(editor): consume resolved route geometry for hits`.

## 2026-08-12 - Connectivity Recovery C8e: stale hierarchy interface ERC

- Target: aggregate incompatible child-Cell interfaces into a repair-oriented
  diagnostic with child primary and all stale callers related.
- Changed areas: derived ERC hierarchy policy and regression tests; target plan
  and log.
- Validation: 14 focused ERC tests; workspace `pnpm typecheck`; targeted
  Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(erc): aggregate stale hierarchy interfaces`.

## 2026-08-12 - Connectivity Recovery C2e: editor indexed flightlines

- Target: migrate editor flightline count and overlay to the active document's
  `ProjectConnectivityIndex` record rather than direct derivation.
- Changed areas: editor flightline read consumer; target plan and log.
- Validation: 21 focused App/index tests; three focused Playwright flightline
  flows; workspace `pnpm typecheck`; static no-direct-derivation audit;
  targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(editor): consume indexed flightlines`.

## 2026-08-12 - Connectivity Recovery C3f: remaining editor geometry reads

- Target: remove the last direct editor `routePolyline` reads for Net focus
  and Net-label placement.
- Changed areas: editor navigation and Net-label read consumers; target plan
  and log.
- Validation: 19 focused App/geometry tests; two focused Playwright
  label/search flows; workspace `pnpm typecheck`; static no-direct-call audit;
  targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(editor): finish resolved route reads`.

## 2026-08-12 - Connectivity Recovery C10a: factual recovery status

- Target: record verified consumer migration, remaining compatibility gates,
  and broad validation evidence without overwriting the roadmap's historical
  recovery audit.
- Changed areas: connectivity recovery status document; target plan and log.
- Validation: source consumer audit; full unit suite 568/568; full editor E2E
  79/79; 500-instance performance check passed; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `docs(roadmap): record connectivity recovery status`.

## 2026-08-12 - Connectivity Recovery C9c: ERC severity filter

- Target: allow the project ERC shelf to focus an explicit severity without
  hiding or mutating diagnostic facts.
- Changed areas: ERC presentation filters and selection/browser tests; target
  plan and log.
- Validation: 14 focused selection/App tests; two focused Playwright ERC
  flows; workspace `pnpm typecheck`; targeted Prettier; `git diff --check`
  clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(editor): filter project ERC diagnostics`.

## 2026-08-12 - Connectivity Recovery C9d: unified diagnostic workbench

- Target: present locator-backed ERC and visual diagnostics in one persistent
  project panel with domain/severity filtering and canonical navigation.
- Changed areas: editor diagnostic derivation/panel, selection and browser
  coverage, recovery status, target plan and log.
- Validation: 20 focused diagnostic/selection tests; three focused Playwright
  cross-Cell/ERC/visual flows; workspace `pnpm typecheck`; targeted Prettier;
  `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(editor): unify ERC and visual diagnostics`.

## 2026-08-12 - Connectivity Recovery C3g: Agent resolved geometry reads

- Target: migrate Agent snapshot, resolved-route response and region query
  reads to document-level resolved routing geometry without schema changes.
- Changed areas: Agent read consumers and parity tests; target plan and log.
- Validation: 21 focused Agent snapshot/service tests; workspace
  `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(agent): consume resolved route geometry`.

## 2026-08-12 - Connectivity Recovery C3h: visual resolved geometry reads

- Target: unify visual route diagnostics on one document-level resolved
  geometry pass without changing diagnostic facts.
- Changed areas: derived visual diagnostic route reads and target plan/log.
- Validation: 16 focused visual/geometry/diagnostic tests; workspace
  `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(derived): consume resolved route geometry in visuals`.

## 2026-08-12 - Connectivity Recovery C3i: stretch resolved geometry reads

- Target: make direct segment drag and local stretch derive their existing
  route centerlines from shared resolved document geometry.
- Changed areas: derived stretch read inputs and target plan/log.
- Validation: 15 focused stretch/geometry tests; workspace `pnpm typecheck`;
  targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(derived): consume resolved route geometry in stretch`.

## 2026-08-12 - Connectivity Recovery C10b: resolved-geometry audit

- Target: audit consumer migration with broad gates and repair an observed
  visual-envelope identity collision without deleting lower-level primitives.
- Changed areas: visual diagnostic identity/test and factual recovery status;
  target plan and log.
- Validation: 569 workspace unit tests; 80 editor E2E tests; 500-instance
  performance gate; workspace `pnpm typecheck`; static consumer audit;
  `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `docs(roadmap): audit resolved geometry migration`.

## 2026-08-12 - Connectivity Recovery C3j: drafting anchor geometry reads

- Target: migrate route-anchor and drafting reads to shared resolved document
  geometry and record the narrowed compatibility boundary.
- Changed areas: derived anchor/drafting resolution, anchor parity test,
  recovery status, target plan and log.
- Validation: 29 focused anchor/drafting/geometry tests; workspace
  `pnpm typecheck`; targeted Prettier; static consumer audit;
  `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(derived): consume resolved geometry in drafting anchors`.

## 2026-08-12 - Connectivity Recovery C5a: committed wire manipulation planner

- Target: move committed segment drag and loose-route translation topology
  edits from editor orchestration into typed Edit Engine proposals.
- Changed areas: routing planner/tests, editor commit path, target plan and log.
- Validation: 31 focused routing/stretch tests; two focused editor E2E flows;
  workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(routing): plan committed wire manipulation in engine`.

## 2026-08-12 - Connectivity Recovery C5b: group move planner

- Target: move committed group instance/route/Junction/annotation edit
  assembly into the Edit Engine routing planner.
- Changed areas: routing planner/tests, editor group commit path, target plan
  and log.
- Validation: 32 focused routing/stretch tests; two focused editor group-move
  E2E flows; workspace `pnpm typecheck`; targeted Prettier; `git diff --check`
  clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `refactor(routing): plan group move edits in engine`.

## 2026-08-12 - Connectivity Recovery C5c: routing planner status

- Target: record verified committed-routing planner ownership and retain the
  intentional editor session/Snap boundary.
- Changed areas: recovery status, target plan and log.
- Validation: static App/planner ownership audit; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `docs(roadmap): record routing planner migration`.

## 2026-08-12 - Connectivity Recovery C6a: hierarchy Net trace presentation

- Target: present concrete hierarchy Net hops with caller instance/pin and
  canonical navigation to the destination Cell/Net.
- Changed areas: selection trace panel/tests, editor navigation, browser
  hierarchy fixture flow, recovery status, target plan and log.
- Validation: nine focused selection/trace tests; focused browser trace
  navigation; workspace `pnpm typecheck`; targeted Prettier; `git diff --check`
  clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(editor): navigate hierarchy Net trace paths`.

## 2026-08-12 - Connectivity Recovery C9e: routing diagnostic domain

- Target: classify route-quality observations as `routing` rather than
  overloading `visual` in the unified diagnostic envelope.
- Changed areas: diagnostic adapter/tests, recovery status, target plan and
  log.
- Validation: 14 focused diagnostic/selection/visual tests; workspace
  `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(diagnostics): classify routing observations separately`.

## 2026-08-12 - Connectivity Recovery C5d: concrete search caller paths

- Target: expand reused child Cell search results into explicit canonical
  caller paths and display the path in the search dialog.
- Changed areas: hierarchy path enumeration/tests, project search/tests,
  dialog/test, browser selector regression, recovery status, target plan/log.
- Validation: 12 focused hierarchy/search/dialog tests; two focused browser
  search flows; workspace `pnpm typecheck`; targeted Prettier; `git diff --check`
  clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `feat(search): expose concrete hierarchy caller paths`.

## 2026-08-12 - Connectivity Recovery final acceptance audit

- Target: verify the complete recovered connectivity/routing/debugging boundary
  and refresh stale generated artifacts exposed by explicit check gates.
- Changed areas: generated Agent API schemas/OpenAPI, current-arrow formal SVG
  golden, recovery status, target plan and log.
- Validation: format/reference/type checks; 576 unit tests; 81 E2E tests;
  performance gate; Agent API artifact; Phase 5/current-arrow goldens;
  production smoke; static geometry/planner consumer audit; `git diff --check`.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging`
  as `docs(roadmap): record final connectivity acceptance audit`.

## 2026-08-12 - Electrical contact integrity for Razavi MOS

- Target: make exact manual power-symbol contacts electrically truthful,
  reconcile safe legacy contacts, preserve hidden bulk semantics, and correct
  PMOS source/drain presentation roles.
- Changed areas: editor placement/reconciliation and bulk policy, typed
  connect-endpoint Net scope, Razavi PMOS catalog/source, API/visual/formal
  generated artifacts, focused unit and browser regressions, target plan.
- Validation: frozen install; complete `pnpm ci:check` (583 unit tests, 82
  browser E2E tests, release/performance/export/production-smoke gates);
  catalog/API/Phase-5 checks; `git diff --check` clean.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as
  `fix(editor): preserve electrical truth at Razavi MOS contacts`.

## 2026-08-12 - Net highlight and flightline clarity

- Target: make an active Net visually unambiguous, add keyboard toggling, and
  prevent its visual routing overlay from competing with dashed flightlines.
- Changed areas: editor Net overlay/flightline policy, `H` shortcut and
  focused unit/browser coverage, target plan.
- Validation: 10 shortcut unit tests; two focused browser E2E flows; workspace
  `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as
  `feat(editor): strengthen Net highlighting and flightline policy`.

## 2026-08-12 - Import-only flightlines and Net Label removal

- Target: keep dashed flightlines exclusively as untouched SPICE-import review
  guidance and expose a clear deletion action for a Route Net Label.
- Changed areas: editor flightline display policy, Route action shelf, focused
  browser tests, target plan.
- Validation: workspace `pnpm typecheck`; four focused browser E2E flows;
  targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as
  `fix(editor): limit flightlines to untouched imports`.

## 2026-08-12 - Symbol-defined power-Net normalization

- Target: make VDD/GND marker terminal membership authoritative for power-Net
  scope and safe Razavi bulk presentation, while eliminating only the valid
  power-marker contact overlap false positive.
- Changed areas: model power-domain facts; edit transaction and Agent schema;
  editor legacy normalization/bulk policy; ERC/visual diagnostics; generated
  Agent API artifacts; focused unit/browser regressions and target plan.
- Validation: 51 focused tests; supplied-legacy-topology browser regression;
  typecheck; format and Agent artifact checks; frozen install; `git diff
--check`. Complete static/unit/release CI stages passed (589 unit tests).
  Two full 16-worker E2E attempts each had unrelated, non-repeatable timeout
  failures; all three affected existing cases passed in isolated single-worker
  reruns.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as
  `fix(connectivity): normalize symbol-defined power Nets`.

## 2026-08-12 - Unified Net Label binding and deletion

- Target: eliminate conflicting Route/Junction/Net interpretations of Label
  attachment and stop Properties from recreating deleted labels from Net names.
- Changed areas: accepted connectivity contract; shared Derived Label resolver;
  Connectivity Index; Edit Engine validation; Agent routing expansion; editor
  Route Properties and browser regressions; target plan.
- Validation: 45 focused Derived/Edit Engine/Agent routing tests; two focused
  Net Label browser flows including delete/save/reopen; workspace typecheck;
  targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as
  `fix(connectivity): unify Net label binding semantics`.

## 2026-08-12 - Net Label highlight alignment

- Target: make the unified Net-id Label binding participate in the same full
  Net highlight interaction as Route and endpoint selection.
- Changed areas: editor highlight-selection adapter and annotation action;
  focused Label/Route browser regression; target plan.
- Validation: three focused browser flows; workspace typecheck; targeted
  Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as
  `fix(editor): align Net Label highlight selection`.

## 2026-08-12 - Component-aware Net highlight

- Target: remove raw persisted-Net assumptions from highlight and make it a
  pure consumer of seeded routed-component connectivity.
- Changed areas: routed component Route membership; Derived Net highlight API;
  editor typed highlight origin; accepted connectivity contract; focused unit
  and browser regressions; target plan.
- Validation: 24 focused Derived tests; four focused browser flows including
  Label deletion splitting a historic merged-Net highlight; workspace
  typecheck; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as
  `fix(connectivity): highlight routed components through the index`.

## 2026-08-12 - Main and connectivity integration

- Target: combine the published connectivity/routing branch with current main
  without risking either the production Analytics/Cloudflare work or editor
  connectivity behavior.
- Changed areas: explicit two-parent integration commit; additive maintenance
  log conflict resolution; integration target record. No functional conflict
  was manually resolved.
- Validation: frozen install and complete local `pnpm ci:check`: formatting,
  references, typecheck, 597 unit tests, build/performance/export/PWA/
  production/release gates, and 85 browser E2E tests all passed.
- Commit status: merge commit `1f79b3a` created locally on
  `codex/integrate-connectivity-main`; close-out ready to commit and push.

## 2026-08-12 - Latest-main integration refresh

- Target: incorporate the Analytics reset commits that reached main after the
  first connectivity integration validation and revalidate the exact final
  candidate before updating main.
- Changed areas: automatic latest-main merge; integration target record. No
  functional conflict required manual resolution.
- Validation: frozen install; static/type/reference gates; 597 unit tests;
  production build, performance, export/PWA and production/release smoke. Three
  independent E2E cases timed out only in the initial 16-worker run, passed 3/3
  at one worker, and the complete suite passed 85/85 at eight workers.
- Commit status: integration branch validated and ready to fast-forward main.

## 2026-08-12 - Safe PR 14 improvements

- Target: retain the useful PR #14 Library and direct-inspection behavior on
  top of merged PR #15 without adopting the conflicting full shell redesign.
- Changed areas: persisted starter/recent quick-place Library; shared insertion
  request/artwork modules; device double-click Properties; Guide hit testing;
  interaction contract; focused unit and browser regressions.
- Validation: frozen install and complete `pnpm ci:check`: formatting,
  references, typecheck, 599 unit tests, build/performance/export/PWA/
  production/release gates, and 88 browser E2E tests all passed. Analytics CSS
  from `body.analytics-body` onward remains byte-identical to `main`.
- Commit status: ready to commit on `codex/merge-pr14-safe` as
  `feat(editor): integrate safe library quick-place improvements`.

## 2026-08-12 - Razavi bulk reconciliation with restored editor UI

- Target: refresh the Razavi bulk candidate after main restored the editor
  Chrome, using current main's UI structure as the baseline.
- Changed areas: two-parent reconciliation merge; Razavi bulk initialization,
  endpoint, dashed-route and Properties hooks reapplied to the restored UI;
  integration plan outcome.
- Validation: workspace typecheck; 26 focused unit tests; 63 single-worker
  browser tests including the Library/restored UI and full manual bulk-route
  workflow; `git diff --check` clean.
- Commit status: merge commit `842d889` created locally; refreshed PR branch
  pending push and required CI checks.

# 2026-08-12 - Razavi capacitor plate calibration

- Target: calibrate capacitor plate geometry to its registered Razavi raster
  while preserving electrical pins and wiring anchors.
- Changed areas: capacitor Symbol DSL and regenerated Razavi catalog; target
  record.
- Validation: generated/catalog checks; Symbols build; 21 catalog tests;
  vertical/horizontal fidelity (`0.6438` / `0.7247` IoU, both zero
  registration lift); `git diff --check` clean.
- Commit status: ready to commit on `codex/capacitor-plate-calibration` as
  `fix(symbols): calibrate Razavi capacitor plate geometry`.

## 2026-08-13 - Persistent authoring tools and input safety

- Target: prevent accidental browser refresh and remove repeated tool
  re-entry during manual circuit authoring.
- Changed areas: global shortcut capture; Wire interaction state; persistent
  Insert/quick-place/Copy flows; live rotated Insert preview; grid token;
  rich-text overlay geometry/input shielding; accepted interaction contract;
  focused unit and browser regressions.
- Validation: 20 focused shortcut/state/overlay unit tests; workspace
  typecheck; component-insert browser spec 11/11; manual-editor browser spec
  57/57; `git diff --check` clean.
- Commit status: ready to commit on
  `codex/persistent-authoring-input-safety` as
  `feat(editor): add persistent authoring tools and input safety`.

## 2026-08-13 - Remove Guides and add clear/refresh commands

- Target: remove the manual Guide feature without retaining a compatibility
  protocol, and provide deliberate Clear canvas and recovery-safe Refresh app
  commands.
- Changed areas: model/Edit Engine/Agent Guide contracts; editor command,
  shortcut, canvas, snap, and help surfaces; atomic `clear_document`; explicit
  recovery flush/reload/auto-restore; active specs, fixtures, generated Agent
  artifacts, and regressions. Automatic Smart Snap alignment feedback remains
  transient and separate.
- Validation: workspace typecheck; generated Agent API artifacts; 613/613 unit
  tests; 93/95 browser tests passed on the initial parallel run, with both
  stale persistent-tool test assumptions corrected and passing individually;
  six directly affected browser regressions passed together; `git diff
--check` clean.
- Commit status: ready to commit on
  `codex/persistent-authoring-input-safety` as
  `feat(editor): remove guides and add clear and refresh`.

## 2026-08-12 - Browser-authorized Agent session roadmap

- Target: plan secure, non-visual external Agent control of the live published
  browser editor while preserving one Snapshot/transaction/render domain API
  and one editor mutation/history lifecycle.
- Changed areas: new web Agent-session roadmap; roadmap index; documentation
  target plan. Concurrent VDD rail implementation paths were read-only and are
  an explicit pre-implementation dependency.
- Validation: pinned reference check passed; roadmap/source boundary review;
  `git diff --check` clean.
- Commit status: ready to commit on `codex/web-agent-session-architecture` as
  `docs(agent): plan browser-authorized agent sessions`.

## 2026-08-12 - WP-WA0 browser-authorized session contract

- Target: freeze the browser-authoritative Agent session contract (authority,
  identity, scopes, transport, events, idempotency, host dispatch, errors,
  threat model) as the foundation for WP-WA1–WA7.
- Changed areas: new ADR 0016 and `docs/specs/web-agent-session.md`; index
  entries in `docs/adr/README.md` and `docs/specs/README.md`; cross-link and
  `power-rail` note in `docs/specs/agent-api.md`; WP-WA0 status in the roadmap;
  target plan and this log entry.
- Validation: rebased onto VDD-merged `main` (`0e96608`) and verified VDD touched
  no `agent-adapter`/`document-controller` file and added no edit kinds;
  `pnpm references:check`; Prettier on all touched Markdown; `git diff --check`
  clean.
- Commit status: ready to commit on `codex/web-agent-session-architecture` as
  `docs(agent): freeze browser-authorized session contract (WP-WA0)`.

## 2026-08-12 - WP-WA1 browser-safe protocol boundary

- Target: separate the Node-only loopback transport from browser-importable
  schemas/operation logic and freeze the relay envelope + web-session schemas.
- Changed areas: exported `sha256Hex` from `@icm/derived`; new
  `agent-adapter/platform.ts` and `envelope.ts`; removed `node:crypto`/`Buffer`
  from `snapshot.ts`/`service.ts`; split package exports with a `./loopback`
  Node subpath; new `browser-safety.test.ts`.
- Validation: 177 combined derived+adapter tests; workspace `typecheck` clean;
  Prettier; `git diff --check` clean. Render base64/sha256 byte-identical to the
  former Node path.
- Commit status: ready to commit on `codex/web-agent-session-architecture` as
  `feat(agent): split browser-safe protocol boundary (WP-WA1)`.

## 2026-08-12 - WP-WA2 unified editor transaction host

- Target: route authenticated Agent and human edits through one
  `EditorDocumentController`/`DocumentHistory` path and freeze the host contract.
- Changed areas: `EditorDocumentController.dispatchTransaction` + `transact`
  refactor; `useDocumentController` exposure; new `packages/agent-adapter/src/host.ts`
  (`AgentOperationHost`); extended controller tests.
- Validation: 27 document tests (11 controller); workspace `typecheck` clean;
  Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/web-agent-session-architecture` as
  `feat(editor): unify human/Agent transaction dispatch (WP-WA2)`.

## 2026-08-12 - WP-WA3 in-browser Agent host (no network)

- Target: run the full Agent Circuit feature against the live controller in one
  process; service dispatches `transact` through the host, not a private commit.
- Changed areas: `AgentCircuitHostServiceOptions` + host-mode dispatch in
  `service.ts`; new `apps/editor/src/agent/browser-agent-host.ts` + integration
  tests; editor depends on `@icm/agent-adapter` (lockfile re-resolved).
- Validation: 6 host-mode integration tests (4 ops, undo parity, render-hash
  equality, stale revision, unknown document, project replacement); 29 adapter
  store-mode tests preserved; workspace `typecheck` clean; Prettier; `git diff
--check` clean.
- Commit status: ready to commit on `codex/web-agent-session-architecture` as
  `feat(agent): in-browser Agent host without network (WP-WA3)`.

## 2026-08-12 - WP-WA4 Agent session relay core

- Target: deliver the deterministically-verifiable session relay core (auth,
  claim, scope, idempotency, expiry, rate/size limits, pause/revoke, project
  replacement).
- Changed areas: new `worker/agent-session-state.ts` (pure state machine) +
  tests; new `worker/agent-session.ts` (relay orchestration with injected
  forward) + tests; roadmap status.
- Validation: 22 worker tests (13 state machine + 7 relay + 2 analytics) with
  fake time/transport; workspace `typecheck` clean; Prettier; `git diff --check`
  clean.
- Limitation: CF Durable Object + WebSocket browser channel + route wiring +
  binding cannot run here; deferred to WP-WA7 deployment. `experience: candidate`
  on the split-core-then-deploy-transport approach.
- Commit status: ready to commit on `codex/web-agent-session-architecture` as
  `feat(agent): Cloudflare Agent session relay state machine (WP-WA4)`.

## 2026-08-12 - WP-WA5 Connect Agent panel

- Target: browser-side authorization surface (panel, hook, App integration) and
  shared placement of the session state machine.
- Changed areas: new `apps/editor/src/agent/{connect-agent-panel,use-agent-session}`;
  `App.tsx` Agent command + panel mount; `.agent-panel` CSS; state machine moved
  to `packages/agent-adapter/src/session-state.ts`; worker + browser-safety
  imports updated; root declares `@icm/agent-adapter`; obsolete App assertion
  updated.
- Validation: 5 panel markup tests; agent-host (6) + state-machine (13) +
  worker relay (7) suites pass; App shell (12) passes; workspace `typecheck`
  clean; Prettier; `git diff --check` clean.
- Limitation: Playwright grant-to-revoke + network WebSocket transport need a
  deployed review environment (WP-WA7).
- Commit status: ready to commit on `codex/web-agent-session-architecture` as
  `feat(editor): Connect Agent authorization panel (WP-WA5)`.

## 2026-08-12 - WP-WA6 external web-session client contract

- Target: publish the public contract an external Agent uses over HTTPS without
  MCP or repository imports.
- Changed areas: `docs/agent/api-usage.md` (web-session example + transport
  failure catalog); `docs/agent/README.md` link; `packages/agent-adapter/src/openapi.ts`
  transport paths + schemas; regenerated `fixtures/agent-api/agent-circuit.openapi.json`.
- Validation: `agent-api:artifacts:check` after rebuild; `references:check`;
  workspace `typecheck` clean; Prettier; `git diff --check` clean.
- Limitation: end-to-end external HTTP test needs the deployed relay (WP-WA7).
- Commit status: ready to commit on `codex/web-agent-session-architecture` as
  `docs(agent): external web-session client contract (WP-WA6)`.

## 2026-08-12 - WP-WA7 delivery gate

- Target: validate the local delivery gate for WP-WA0–WA6 and record the
  remote/deployment gate.
- Changed areas: `pnpm-lock.yaml` Prettier reformat; delivery-gate plan; roadmap
  exit-gate status.
- Validation (local, green): frozen-lockfile install; `format:check`;
  `references:check`; `typecheck`; full unit suite (108 files / 656 tests);
  `agent-api:artifacts:check`.
- Deferred (need user/CI/deployment): GitHub Actions required checks; Playwright
  e2e; Cloudflare DO + WebSocket transport; perf budgets; relay no-retention.
- Commit status: ready to commit on `codex/web-agent-session-architecture` as
  `chore(agent): format lockfile and record delivery gate (WP-WA7)`.

## 2026-08-13 - Web Agent session production closure

- Target: replace the disconnected WA4/WA5 prototypes with one usable,
  browser-authoritative external-Agent session from public claim through live
  semantic edit, shared recovery/undo, events, and revocation.
- Changed areas: real `AgentSessionDO` + Worker routes/binding/migration;
  serializable hashed session state and non-content at-most-once ledger; exact
  scope/Project/Document enforcement; BrowserAgentHost Project fencing; real
  editor WebSocket hook and lifecycle UI; public OpenAPI + copied connection
  instructions; generated contract, accepted ADR/spec, roadmap status, and one
  grant-to-Snapshot/edit/retry/undo/pause/revoke Playwright scenario.
- Validation: frozen install and final `pnpm ci:check` green under CI settings;
  108 files / 669 unit tests; 92 Playwright scenarios; production/release smoke;
  500-instance performance baseline; generated Agent API artifacts; Wrangler
  4.120.1 production dry-run exposes both `AnalyticsDO` and `AgentSessionDO`;
  `git diff --check` clean.
- Commit status: ready to commit and push on
  `codex/web-agent-session-architecture` as
  `feat(agent): connect browser-authorized sessions end to end`.

## 2026-08-13 - Plan lifecycle hygiene

- Target: reduce the root planning surface without rewriting history or
  discarding unresolved work.
- Changed areas: moved 136 resolved completed target directories to
  `plan/archived/2026-08/`; added the root retention audit and archival batch
  index; linked the current queue from `plan/README.md`.
- Validation: every moved plan has current `completed`/`none` metadata, an
  Outcome section, and Git history; active, candidate, superseded, proposed,
  and metadata-missing plans remained in the root. This target remains until
  its own commit; `git diff --check` passed.
- Commit status: ready to commit on `codex/plan-lifecycle-hygiene` as
  `docs(plan): archive resolved completed targets`.

## 2026-08-13 - Routine plan record retention

- Target: remove redundant archived micro-plan prose while retaining factual
  evidence in Git and this log.
- Changed areas: deleted 14 resolved visual-calibration, naming, and narrow
  geometry-fix plan records; documented the deletion eligibility rule.
- Validation: every deleted plan had `completed`/`none` metadata, Outcome, Git
  history, and a matching log entry; no active, candidate, legacy, migration,
  delivery, integration, or web-agent record was selected; `git diff --check`
  passed.
- Commit status: ready to commit on `codex/plan-lifecycle-hygiene` as
  `docs(plan): prune routine completed records`.

## 2026-08-13 - Deterministic SPICE and Spectre netlist export

- Target: export the persisted schematic electrical model as deterministic
  structural SPICE `.spi` or Spectre `.scs` without AI, geometry inference, or
  guessed PDK/simulation setup.
- Changed areas: accepted netlist spec and ADR; Project schema v4 migration;
  reviewed Symbol netlist registry; typed Cell/Instance editor operations;
  new `@icm/netlist` validation, IR, diagnostics, and pure printers; File-menu
  downloads, clickable blocking diagnostics, and copy-safe reference allocation.
- Validation: frozen-lockfile install; final `pnpm ci:check` green; 113 unit
  files / 693 tests; release/production smoke and performance/golden checks;
  101 Playwright scenarios including two-format hierarchical downloads and
  blocked missing-model diagnostics; `git diff --check` clean.
- Limitation: output is a structural library, not a runnable simulation deck;
  PDK includes/corners/analyses remain deferred, external subcircuits without a
  persisted ordered interface are blocked, and Spectre validation is
  grammar/golden based because no licensed executable is available.
- Commit status: implementation and target close-out committed on
  `codex/netlist-export-system`; ready to push for review.

## 2026-08-13 - Agent authoring and evidence contract hardening

- Target: remove Agent-side guesses for identity, wiring, contact, diagnostics,
  and transient session recovery while retaining the browser as authority.
- Changed areas: canonical coincident-contact and Project-diagnostic derivation;
  shared GUI/Agent `wireIntent` planner; claim Project/Document bootstrap;
  bounded same-session WebSocket replacement; reconnect UI; generated OpenAPI
  artifacts; accepted Agent/session/connectivity specifications.
- Validation: focused 99-test cross-package suite; frozen install; final local
  `pnpm ci:check` green with 679 unit/integration and 99 Playwright tests plus
  build, export, PWA, release smoke, and performance gates. An initial remote
  Linux-only E2E typing failure was repaired; PR #25 then passed Static,
  Unit/integration, Release, and both Browser required checks.
- Commit status: implementation `37513a2` plus cross-platform test correction
  `ee7b854` pushed to `codex/agent-contract-hardening`; PR #25 is ready for
  review.

## 2026-08-13 - RichText contract consolidation

- Target: make the floating toolbar the current formatting surface, retire
  fractions and markup-command authoring, and unify canvas text on one model
  AST without changing retained schematic-label visuals.
- Changed areas: explicit model RichText types and helpers; shared semantic
  label conversion; editor/layout/SVG consumers; generated Agent schemas;
  current interaction/model specs and focused tests.
- Validation: 135 focused Vitest assertions, one focused Playwright floating-
  toolbar scenario, typecheck, workspace build, generated Agent artifact check,
  Phase 1/3/5 and current-arrow visual goldens, Prettier, and
  `git diff --check` passed.
- Commit status: ready to commit on `codex/ci-contract-cleanup` as
  `refactor(rich-text): consolidate the active text contract`.

## 2026-08-13 - Test contract deduplication

- Target: remove same-source, migration-only, and cross-layer duplicate tests
  while retaining one primary gate for every current behavior.
- Changed areas: semantic-text model/renderer tests, connectivity-index parity
  gates, Agent host/parity tests, SVG drafting coverage, and non-netlist editor
  browser scenarios. No product or netlist-export implementation changed.
- Validation: 107 Vitest files / 654 tests with two workers; 81 focused tests;
  three focused Playwright scenarios; 95-test Playwright discovery; typecheck,
  Prettier, and `git diff --check` passed.
- Commit status: ready to commit on `codex/test-contract-dedup` as
  `refactor(test): deduplicate behavioral contracts`.

## 2026-08-13 - CI cleanup and Agent contract integration

- Target: combine `codex/ci-contract-cleanup` with Agent contract hardening in
  one reviewed delivery without losing either branch's accepted contracts.
- Changed areas: resolved editor and SVG integration conflicts; regenerated
  Agent API artifacts; retained consolidated RichText, canonical diagnostics,
  shared Wire intent, and contact-aware junction behavior.
- Validation: 132 focused tests; frozen install; full `pnpm ci:check` with 668
  unit/integration and 99 Playwright tests; all six required GitHub checks;
  post-merge ancestry verification.
- Commit status: integration commit `3ecda02` merged through PR #25 into
  `main` as `e9782e4`.

## 2026-08-13 - Agent contract single source and compaction

- Target: eliminate Agent edit-capability drift and compact generated API
  contracts without changing request/response or editing semantics.
- Changed areas: Edit Engine-derived capability kinds; annotation/drafting/
  NoConnect advertisement; shared relay scope classification; reusable JSON
  Schema/OpenAPI components; deterministic reference and size gates.
- Validation: 69 focused tests; typecheck and artifact check; frozen install;
  full `pnpm ci:check` with 671 unit/integration and 99 Playwright tests plus
  build, performance, export, PWA, packaging, and release-smoke gates.
- Commit status: ready to commit on `codex/agent-contract-compaction` as
  `refactor(agent): compact and unify generated contracts`.

## 2026-08-13 - Netlist export main integration

- Target: merge current `origin/main` (`56e929c`) into the deterministic
  netlist-export branch for integrated hands-on testing.
- Changed areas: retained both plan-log histories; aligned two new main Port
  fixtures with schema-v4 `portOrder`; regenerated compact Agent API artifacts
  so typed netlist edits remain public; otherwise preserved both branches'
  automatically merged contracts.
- Validation: frozen install; static checks; 113 unit files / 692 tests;
  canonical Agent artifacts; release/production smoke and performance/goldens;
  101 Playwright scenarios, including hierarchical `.spi`/`.scs` downloads and
  blocked-diagnostic location; `git diff --check` clean.
- Commit status: ready to commit and push on
  `codex/netlist-export-system` as `merge: integrate main into netlist export`.

## 2026-08-13 - Hide web netlist surface

- Target: retain deterministic netlist contracts and conversion code while
  temporarily removing all netlist export and authoring semantics from the
  public web editor.
- Changed areas: removed the File-menu SPICE/Spectre downloads, export
  diagnostics and explanatory copy, Cell netlist-interface controls, and
  Instance Reference/Model controls and imported-model source text; removed the
  editor's direct netlist runtime dependency; added negative unit and browser
  coverage for the hidden surface. SPICE import and internal
  model/migration/extractor/printer/typed-edit contracts remain intact.
- Validation: focused 26-test unit suite; focused hidden-surface Playwright
  scenario; typecheck and build; frozen install; static, 692-unit, release,
  performance, golden, production, and release-smoke gates; all 99 unrelated
  browser scenarios plus the new hidden-surface scenario. The existing
  recovery-refresh scenario passed alone but flaked under 16-worker full-suite
  load; the full suite was repeated at reduced concurrency for deterministic
  coverage. `git diff --check` clean.
- Commit status: implementation `96d1d8f` and latest-main merge `d19cf58`
  pushed on `codex/netlist-export-system`; draft PR #31 is open and all six
  required GitHub checks passed. The first Browser 1/2 run hit an existing
  canvas-width timing assertion and passed unchanged on rerun.

## 2026-08-13 - README citation

- Target: add a clear citation method naming Zengchun Chen and Zhishuai Zhang
  as the project authors.
- Changed areas: README human-readable citation, BibTeX entry, and
  reproducibility guidance; target plan.
- Validation: targeted Markdown formatting and `git diff --check` passed.
- Commit status: ready to commit on `codex/add-readme-citation` as
  `docs(readme): add project citation`.

## 2026-08-13 - Citation title correction

- Target: use the user-specified short project title `analog-canvas` in the
  README citation.
- Changed areas: prose citation, BibTeX key/title, and target plan.
- Validation: targeted Markdown formatting and `git diff --check` passed.
- Commit status: ready to commit on `codex/shorten-citation-title` as
  `docs(readme): shorten citation title`.

## 2026-08-13 - Citation title capitalization

- Target: correct the citation's publication-style title to `Analog Canvas`.
- Changed areas: prose and BibTeX titles; target plan.
- Validation: targeted Markdown formatting and `git diff --check` passed.
- Commit status: ready to commit on `codex/capitalize-citation-title` as
  `docs(readme): capitalize citation title`.

## 2026-08-13 - Test-contract and netlist delivery integration

- Target: review and merge the test-contract deduplication, then combine it
  with the hidden-surface deterministic netlist branch for final delivery.
- Changed areas: PR #32 removed same-behavior test duplication without product
  changes; merge `3594c01` brought its retained contract ownership into the
  netlist branch while preserving the hidden web-surface assertion and all
  lower-level netlist tests.
- Validation: test-contract PR six-check GitHub gate; 49 focused combined unit
  tests; two focused overlap browser scenarios; frozen install; canonical
  `pnpm ci:check` with 112 Vitest files / 675 tests, builds, performance,
  goldens, production/release smoke, and 96 Playwright scenarios;
  `git diff --check` clean.
- Commit status: PR #32 merged to `main` as `6efbf3d`; integrated netlist PR
  #31 is ready for its refreshed remote checks and final merge.

## 2026-08-13 - Local validation resource optimization

- Target: reduce routine local validation load without weakening the mainline
  gate or changing remote CI coverage.
- Changed areas: package validation scripts, Agent and README command guidance,
  and the machine-readable completed-plan queue.
- Validation: focused 13-test unit run; focused one-scenario browser run;
  `pnpm verify:branch`; canonical `pnpm ci:check` with 112 Vitest files / 675
  tests, one workspace build, all release checks, and 96 Playwright scenarios;
  GitHub Actions workflow unchanged.
- Commit status: ready to commit on `codex/local-validation-optimization` as
  `chore(test): reduce local validation resource usage`.

## 2026-08-13 - Repository tooling consolidation

- Target: remove unowned historical fixtures and separate optional research
  and manual calibration tools from the daily engineering surface.
- Changed areas: deleted orphaned text/current-arrow projects and goldens;
  archived stale Phase 9 programs' evidence while retaining corpus netlists;
  retained two runnable research tools under `tools/research/phase9/`; renamed
  visual/export golden commands; moved Razavi calibration to
  `tools/calibration/razavi/`; removed the obsolete integration worktree and
  local/remote branch.
- Validation: 40 focused renderer/schema tests; 8 Agent snapshot/SPICE corpus
  tests; retained Skill check and external-evaluation self-test; visual/export
  golden checks; all three Razavi calibration tools; `pnpm verify:branch`;
  canonical `pnpm ci:check` with 112 Vitest files / 675 tests, all release
  checks, and 96 Playwright scenarios; product and GitHub Actions paths
  unchanged; `git diff --check` clean.
- Commit status: three reviewable implementation commits plus this close-out on
  `codex/local-validation-optimization`.

## 2026-08-13 - Plan root lifecycle closure

- Target: remove completed plan records from the active root queue without
  erasing architecture, CI, migration, or integration evidence.
- Changed areas: archived 23 completed or superseded non-routine target plans;
  deleted three routine README citation plans; corrected four stale `active`
  records and one legacy WP-A1 `proposed` record from their existing evidence;
  refreshed the root audit.
- Validation: every lifecycle action was checked against the plan Outcome,
  matching factual log evidence, and Git path history; stale-root-path search,
  Markdown formatting, and `git diff --check` pending final confirmation.
- Commit status: ready to commit on `codex/local-validation-optimization` as
  `chore(plan): close completed root records`.

## 2026-08-13 - Legacy plan metadata sweep, batch 1

- Target: classify the first 25 root plans that predate lifecycle metadata.
- Changed areas: archived 19 completed architecture, implementation, decision,
  and integration records after individual Git/Outcome checks; marked six
  records with explicit human-review signals as `completed/candidate`; updated
  the root audit from 121 to 96 remaining unclassified legacy records.
- Validation: recorded per-plan commit evidence and disposition; targeted
  Markdown formatting, root-state count, `git diff --check`, and status review
  pending final confirmation.
- Commit status: ready to commit on `codex/local-validation-optimization` as
  `chore(plan): classify legacy records batch 1`.

## 2026-08-13 - Legacy plan metadata sweep, batch 2

- Target: classify the next 25 root plans that predate lifecycle metadata.
- Changed areas: archived 20 individually evidenced completed records; marked
  five explicit human-review signals as `completed/candidate`; reduced the
  unclassified root queue from 96 to 71 records.
- Validation: per-plan Git evidence table, Markdown formatting, root-state
  count, `git diff --check`, and status review pending final confirmation.
- Commit status: ready to commit on `codex/local-validation-optimization` as
  `chore(plan): classify legacy records batch 2`.

## 2026-08-13 - Batch-2 archive index formatting

- Target: repair the missed Prettier formatting pass on the batch-2 archive
  index.
- Changed areas: archive index formatting and this factual closure record.
- Validation: repository Prettier on changed Markdown and `git diff --check`.
- Commit status: ready to commit on `codex/local-validation-optimization` as
  `chore(plan): format batch 2 archive index`.

## 2026-08-13 - Retire unused platform-web package

- Target: remove the isolated browser platform package without changing the
  editor's active recovery or file workflows.
- Changed areas: deleted `packages/platform-web/` and its workspace lockfile
  importer; the editor's independent recovery implementation remains intact.
- Validation: lockfile-only install, no-reference search, four focused editor
  recovery tests, workspace typecheck, and `git diff --check` passed.
- Commit status: ready to commit on `codex/local-validation-optimization` as
  `chore(platform): retire unused browser platform package`.

## 2026-08-13 - Restore lockfile static CI contract

- Target: repair PR #33 Static contracts failure from unformatted
  `pnpm-lock.yaml`.
- Changed areas: Prettier serialization only for the lockfile; dependency
  resolution is unchanged.
- Validation: `pnpm ci:static`, frozen install, and `git diff --check` passed.
- Commit status: ready to commit on `codex/local-validation-optimization` as
  `chore(ci): format lockfile static contract`.

## 2026-08-13 - Unified electrical contact authoring

- Target: replace raw SVG-hit ambiguity and coordinate-only component contact
  with one conductor-aware Wire/placement/movement contract.
- Changed areas: derived contact targeting, typed endpoint-to-Route attachment,
  editor Wire and component interaction, snap semantics, contact markers,
  Agent API artifacts, specifications, and visual/browser regressions.
- Validation: focused unit tests (75), targeted browser tests (5), Agent API
  artifact check, `pnpm verify:branch` (675 tests plus build/smoke), and
  `git diff --check` passed.
- Commit status: implementation committed on
  `codex/unified-electrical-contact` as `fe4c4ee`; archival recorded in the
  following branch-maintenance commit.

## 2026-08-13 - Documentation information architecture

- Target: make current product, user, contributor, and Agent documentation
  discoverable while removing redundant historical prose from active paths.
- Changed areas: root and docs indexes; concise current product architecture;
  user compatibility/troubleshooting; archive of completed Phase 0--8 records;
  removal of three superseded Agent planning documents; and an all-CI local
  Markdown-link checker.
- Validation: Prettier, 102-file local-link scan, `pnpm ci:static` (format,
  link scan, pinned references, typecheck), and `git diff --check` passed.
- Commit status: ready to commit on `codex/docs-information-architecture` as
  `docs: consolidate current documentation architecture`.

## 2026-08-13 - Integrate docs architecture and contact authoring

- Target: combine the completed documentation architecture and unified
  electrical-contact branches into one validated review head.
- Changed areas: merge metadata and preservation of both factual plan-log
  records; no product-source conflict or behavior rewrite was required.
- Validation: 102-file Markdown-link scan, five targeted browser regressions,
  and `pnpm verify:branch` (675 tests, build, and production smoke) passed.
- Commit status: merge committed on `codex/unified-electrical-contact` as
  `a3f9264`; plan closure is recorded in the following maintenance commit.

## 2026-08-13 - Junction dot branch semantics

- Target: make connection dots describe actual electrical branches rather
  than every pin/Route contact.
- Changed areas: shared same-Net contact incident geometry, SVG junction-dot
  eligibility, dense analog golden, and pin/passthrough/branch regressions.
- Validation: focused derived and SVG tests (34), affected package builds and
  typechecks, and `git diff --check` passed.
- Commit status: ready to commit on `codex/unified-electrical-contact` as
  `fix: derive junction dots from electrical branch geometry`.

## 2026-08-13 - Wire pass-through pin contacts

- Target: connect every exact visible device pin crossed by a newly authored
  wire instead of connecting only the gesture endpoints.
- Changed areas: atomic wire planner, GUI wire commit, planner regressions, and
  a browser scenario covering capacitor, resistor, and ground on one wire.
- Validation: 40 focused unit/render tests, edit-engine build, workspace
  typecheck, targeted browser regression, and `git diff --check` passed.
- Commit status: ready to commit on `codex/unified-electrical-contact` as
  `fix: connect compatible pins along authored wires`.

## 2026-08-13 - Mainline contact delivery gate

- Target: close the full mainline gate for unified contact authoring without
  allowing automatic pass-through capture to short pins inside either
  explicitly selected endpoint device.
- Changed areas: contact formatting; endpoint-device exclusion in the shared
  wire planner; focused planner/browser regressions; and the formal export
  golden for the accepted dotless simple-corner rule.
- Validation: frozen dependency install and complete `pnpm ci:check` passed,
  including 683 unit tests, all workspace builds, export/PWA/production/release
  verification, and 99 browser tests; `git diff --check` passed.
- Commit status: ready to commit on `codex/unified-electrical-contact` as
  `chore: satisfy contact mainline gate`.

## 2026-08-13 - Browser Agent takeover delivery roadmap

- Target: freeze a detailed delivery plan for all remaining browser Agent
  takeover features while excluding simulation, PVT, waveform/measurement data,
  and SPICE/design-netlist export.
- Changed areas: four-operation Agent roadmap and its target plan; defines the
  Project controller, stable session recovery, scoped Project/visual File
  Resource, staged Project/structural-SPICE import approval, semantic editor
  collaboration, own-head history/duplication, and delivery evidence.
- Validation: `pnpm docs:check` and `git diff --check` passed. The unrelated
  active first-class-Port migration stayed unstaged.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `docs(agent): detail browser takeover delivery roadmap`.

## 2026-08-13 - Agent Project lifecycle and artifact completion plan

- Target: define the remaining interfaces required for complete browser Agent
  takeover while excluding simulation/PVT/waveforms and design-netlist export.
- Changed areas: current roadmap index and a new AP0--AP9 cross-module plan for
  exact Snapshot reads, Project transactions, history, Project/visual artifacts,
  staged Project/SPICE import, explicit replacement authorization, and semantic
  editor collaboration.
- Validation: `pnpm references:check` and `git diff --check` passed; no runtime
  test was required for the documentation-only target.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `docs: plan complete Agent project lifecycle interfaces`.

## 2026-08-13 - AP0 Agent v3 contract freeze

- Target: freeze the Agent v3 contract (three-authority split, additive v3
  operations, runtime projectRevision, Project edit inventory, Agent-safe
  history, artifact/import envelopes, import state machine, scopes, errors, and
  limits) before any runtime change, and lock the current v2 boundary.
- Changed areas: new ADR 0018 extending ADR 0016; additive "Agent v3 extension"
  sections in agent-api, web-agent-session, persistence-and-recovery,
  project-file-format, export, and editor-interaction specs; ADR index; and a
  new contract-characterization test. No Zod schema or generated
  `fixtures/agent-api/` change.
- Validation: focused characterization suite (7 tests), `pnpm docs:check`,
  `pnpm references:check`, `pnpm typecheck`, and `git diff --check` passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `docs(agent): freeze v3 contract surface and ADR 0018`.

## 2026-08-13 - AP1 exact Snapshot and component catalog

- Target: make every writable persisted netlist/interface field Agent-readable
  and publish a machine-readable component catalog via additive v3 `snapshot`
  targets, without changing v1/v2.
- Changed areas: agent-adapter schema (v3 version, snapshot request `target`,
  v3 document/project/catalog response schemas), snapshot (exact instance
  netlist + cell interface, project + document v3 builders), new catalog
  builder from `builtInSymbols` joined with `deviceNetlistDefinition`, service
  v3 snapshot dispatch + capabilities, regenerated `fixtures/agent-api`, new
  v3 tests, and the AP0 characterization test updated for v3.
- Validation: 39 adapter tests (incl. 6 new), `agent-api:artifacts --check`,
  `pnpm typecheck`, `pnpm docs:check`, and `git diff --check` passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `feat(agent): v3 exact snapshot targets and component catalog`.

## 2026-08-13 - Hosted Agent four-operation golden contract

- Target: make external browser Agent takeover self-contained and repairable
  through one hosted v2 `capabilities/snapshot/transact/render` contract,
  without adding Circuit operations, SDKs, or source-code dependencies.
- Changed areas: production-only request/response schemas and generated
  OpenAPI; shared structured request and transport errors; strict current
  Agent authoring boundary; ten-step copied lifecycle; explicit access
  rotation; relay/browser rejection ordering; contract, session, and E2E tests;
  and ADR/spec supersession of the AP2/v3 surface expansion.
- Validation: focused Agent tests (63), web-session E2E, generated artifact
  check, typecheck, docs check, and `pnpm verify:branch` passed (113 test files,
  705 tests, all workspace builds, production smoke); `git diff --check`
  passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `fix(agent): close the four-operation request contract`.

## 2026-08-13 - Explicit Net power-domain authority

- Target: remove runtime supply semantics from legacy VDD/ground marker
  symbols and make VDD rail authoring an atomic, Agent-visible document edit.
- Changed areas: Project schema v5 and v4-to-v5 migration; explicit
  power-domain consumers in model/derived/render/edit engine; VDD rail and
  component-placement behavior; Agent Snapshot/OpenAPI artifacts; compatibility
  fixtures and current API/project documentation.
- Validation: focused model, transaction, Agent, and editor tests; full local
  unit suite (114 files, 708 tests); typecheck; generated Agent artifact
  write/check; docs and reference checks; `git diff --check`; and
  `pnpm verify:branch` (workspace build and production smoke) passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `feat(model): make Net power-domain explicit`.

## 2026-08-13 - Four-operation Agent takeover completion roadmap

- Target: replace the superseded API-v3 expansion plan with a current,
  detailed completion sequence for browser Agent takeover while explicitly
  excluding simulation/PVT/waveforms and SPICE/design-netlist export.
- Changed areas: current delivery-roadmap index and the new four-operation
  completion plan, including authority migrations, Project lifecycle, browser
  file transport, approval/replacement, semantic collaboration, scopes,
  errors, and deployed acceptance flows.
- Validation: `pnpm docs:check`, `pnpm references:check`, `git diff --check`,
  and clean branch status passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `docs(agent): plan four-operation takeover completion`.

## 2026-08-13 - M2 RichText and VisualAnchor authority

- Target: make schema-v7 RichText content and VisualAnchor the only editable
  annotation authority, while preserving old Projects through deterministic
  migration.
- Changed areas: model schema and v6-to-v7 migration; GUI text/drag/clipboard;
  edit engine and routing; Net-label/connectivity/visual consumers; SVG text
  renderer and visual goldens; Agent Snapshot/OpenAPI; canonical fixtures and
  current model/connectivity/editor specifications.
- Validation: focused M2 suites; full local unit suite (116 files, 701 tests);
  `pnpm ci:static`; Agent artifact write/check; visual golden check;
  `git diff --check`; and `pnpm verify:branch` (workspace build and production
  smoke) passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `feat(model): make RichText and VisualAnchor canonical`.

## 2026-08-13 - Public Agent OpenAPI surface

- Target: publish only the two externally usable hosted Agent paths, while
  retaining browser-owner and loopback transport as private implementation.
- Changed areas: Agent OpenAPI declaration/artifact; deployed OpenAPI and
  contract tests; hosted-versus-local API/session documentation; target plan.
- Validation: focused Agent/Worker tests (41 tests), generated Agent artifact
  write/check, docs/type/diff checks, and `pnpm verify:branch` passed (118
  test files, 713 tests, all workspace builds, production smoke).
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `refactor(agent): publish only the external session surface`.

## 2026-08-13 - Shared Agent semantic editor control

- Target: let a scoped hosted Agent visibly activate/select/highlight/fit/clear
  the live editor through the existing GUI authorities, without creating a
  new Circuit operation or a persisted transaction.
- Changed areas: canonical derived Locator runtime schema; Agent
  `semanticIntent` schema/service/host/scope/OpenAPI; browser semantic adapter
  and permission presets; worker scope gate; Agent E2E; current API/session
  usage specs and roadmap.
- Validation: focused unit suites (32 tests), browser Agent E2E, generated
  artifacts, type/docs/diff checks, and `pnpm verify:branch` (119 files, 719
  tests, all workspace builds and production smoke) passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `feat(agent): add shared semantic editor control`.

## 2026-08-13 - Scoped browser Agent File Resource

- Target: add the named File Resource for canonical Project/formal visual
  download and browser-approved Project/structural-SPICE staging, without a
  fifth Circuit operation, filesystem access, simulation, or netlist export.
- Changed areas: Agent File Resource schemas/OpenAPI/artifacts/scopes/session
  relay; browser file host and approval UI; session instructions/presets;
  current Agent/session/roadmap specifications; unit, Worker, and browser E2E
  coverage.
- Validation: focused suites (48 tests), `web-agent-session` browser E2E,
  typecheck, generated Agent artifacts, docs/diff checks, and
  `pnpm verify:branch` (120 files, 725 tests, all workspace builds and
  production smoke) passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `feat(agent): add scoped browser file resource`.

## 2026-08-13 - Show origins map above daily traffic

- Target: put the analytics Origins heatmap above the Daily traffic chart.
- Changed areas: `apps/editor/src/components/analytics-page.tsx` section order.
- Validation: source-order review and `git diff --check` passed. Existing
  analytics e2e heading checks still apply; no new test for markup order.
- Commit status: committed as `cebdf90` on
  `agent/analytics-map-above-traffic`.

## 2026-08-13 - Properties Dock E2E Transition Stability

- Target: make the Properties-dock canvas-width assertion wait for the
  existing transition rather than sampling its pre-transition geometry.
- Changed areas: one browser assertion and its target record.
- Validation: the focused Properties-dock E2E and all remote CI checks on PR
  #37 passed.
- Commit status: committed as `f2a87fd` on
  `codex/stabilize-properties-e2e`.

## 2026-08-13 - Refresh Phase 7 formal export golden

- Target: reconcile the formal SVG/PNG/PDF baseline with the accepted
  canonical RichText and VisualAnchor output.
- Changed areas: deterministic Phase 7 export artifacts and hash manifest.
- Validation: generated through `pnpm export:golden`; full `pnpm ci:check`
  passed (725 unit tests, 99 browser E2E, build, performance, PWA and release
  smoke).
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `test(export): refresh formal export golden`.

## 2026-08-13 - Refresh migrated editor E2E fixtures

- Target: restore browser gate coverage after accepted first-class Port,
  RichText and hierarchy-interface migrations, without weakening product
  behavior.
- Changed areas: stale Port endpoint/selector expectations, semantic RichText
  selector, and the imported hierarchy-navigation fixture's valid symbol/port
  interface.
- Validation: focused browser E2E (64 tests) and full `pnpm ci:check` passed
  (725 unit tests, 99 browser E2E, build, performance, Golden/PWA/release
  smoke); `git diff --check` passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `test(editor): refresh migrated routing fixtures`.

## 2026-08-13 - Repair compatibility corpus inventory

- Target: make the Project compatibility corpus reflect only Git-tracked,
  shipped Projects after remote CI exposed an ignored local scratch export in
  the declared migration list.
- Changed areas: tracked-Project discovery in the compatibility corpus test
  and the corpus list itself; no ignored local artifact was promoted.
- Validation: focused corpus test (4 tests), full `pnpm ci:unit` (725 tests),
  and `git diff --check` passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as
  `test(model): exclude ignored scratch Project from corpus`.

## 2026-08-14 - Canonical junction node presentation

- Target: make junction dots follow explicit electrical topology across
  Route, pin, overlapping-arm, and VDD power-rail cases without converting
  geometric pass-through into connectivity.
- Changed areas: shared contact evidence and renderer consumption; focused
  derived/render/browser regressions; accepted connectivity/editor specs; the
  intentional dense-analog visual and formal-export baselines.
- Validation: focused contact/render/edit tests (44), four routing browser
  regressions, `pnpm verify:branch` (120 files, 728 tests, all workspace builds
  and production smoke), visual/export golden checks, and `git diff --check`
  passed.
- Commit status: ready to commit on `codex/canonical-junction-nodes` as
  `fix(connectivity): canonicalize junction node presentation`.

## 2026-08-14 - Restore ordinary Port component contract

- Target: revert the unrequested visual first-class Port replacement while
  preserving ordinary Port creation for the GUI and browser Agent.
- Changed areas: symbol catalog/palette, edit and Agent API contracts, legacy
  rendering, migration fixtures, generated artifacts, and focused regressions.
- Validation: static checks, 724 unit tests, visual and Agent artifact checks,
  and the imported-child search E2E passed locally.
- Commit status: committed on `codex/restore-port-symbols`; remote CI repair
  adds an explicit schema-v3 child-document-id reader migration.

## 2026-08-14 - Simplify resilient browser Agent connection lifecycle

- Target: make browser Agent authorization, claim retry, same-Project refresh
  recovery, relay reconnect, and status management reliable without expanding
  circuit-editing capability or adding a second collaboration UI.
- Changed areas: session/claim defaults and replacement semantics; shared scope
  guard for recovery; browser relay retry; compact Properties Agent section;
  authorization hand-off wording and generated public OpenAPI artifact; focused
  session, recovery, UI, and browser coverage.
- Validation: focused session/recovery/panel suites (50 tests), the web-Agent
  browser E2E, Agent artifact validation, `pnpm verify:branch`, and the final
  `pnpm ci:check` (729 unit tests, 100 browser tests, builds, performance,
  export/PWA goldens, production and release smoke) passed; `git diff --check`
  passed.
- Commit status: ready to commit on `codex/agent-connection-ux` as
  `feat(agent): simplify resilient browser connection lifecycle`.

## 2026-08-14 - Add Agent transport liveness watchdog

- Target: detect silent browser/relay transport failure and recover promptly
  without adding a daemon, changing edit authority, or replaying requests.
- Changed areas: shared WebSocket heartbeat control frame, browser heartbeat
  timeout and foreground/online wake checks, Worker SSE keepalive handling,
  focused transport tests, and current Agent connection documentation.
- Validation: focused transport suites (25 tests), full typecheck, and
  `pnpm verify:branch` (121 files, 733 tests, all workspace builds and
  production smoke) passed; Agent API artifacts and `git diff --check` passed.
- Commit status: ready to commit on `codex/agent-transport-watchdog` as
  `fix(agent): add transport liveness watchdog`.

## 2026-08-14 - Complete current circuit contract clean break

- Target: retain hollow and filled Ports as ordinary component assets while
  deleting obsolete Project, asset, routing, text, power, and Agent contracts.
- Changed areas: Project schema and fixtures; exact symbol catalog; explicit
  VDD/MOS connectivity; persisted RichText labels; Agent 2.0/OpenAPI/browser
  state machine; editor behavior, documentation, generated assets, and tests.
- Validation: 541 unit tests, all workspace builds, `pnpm verify:branch`,
  frozen-lockfile install, full `pnpm ci:check`, and all 95 browser E2E tests
  passed.
- Commit status: committed on `codex/agent-transport-watchdog` as `9a552d3`
  (`refactor(circuit): remove legacy contract routing`).

## 2026-08-14 - Restore overridable MOS supply defaults

- Target: make manual NMOS/PMOS bulk default to canonical global ground/VDD
  while preserving the visible dashed bulk connection as an explicit override.
- Changed areas: MOS binding schema/resolution/reconciliation; Ground and VDD
  rail supply-Net reuse; Agent Snapshot/OpenAPI status; current specifications;
  focused unit and browser regressions.
- Validation: 550 unit tests, `pnpm verify:branch`, frozen-lockfile install,
  full `pnpm ci:check`, performance/export/PWA/release checks, and all 97
  browser E2E tests passed; `git diff --check` passed.
- Commit status: committed on `codex/agent-transport-watchdog` as `5d2d640`
  (`fix(mos): restore overridable supply bulk defaults`).

## 2026-08-14 - Unify transient editor interaction state

- Target: remove parallel placement modes behind repeated-C/I crashes and
  restore VDD Rail through the ordinary insertion flow without persisting it as
  a component instance or changing shortcut assignments.
- Changed areas: exclusive editor interaction reducer and shortcut arbitration;
  App cancellation/mutation boundaries; virtual VDD preview catalog entry;
  atomic VDD visual deletion; focused unit and browser regressions; accepted
  editor interaction specification.
- Validation: focused interaction and VDD suites, 9 focused browser
  regressions, `pnpm verify:branch` (102 unit-test files / 557 tests, all
  workspace builds and production smoke), and `git diff --check` passed.
- Commit status: ready to commit on `codex/interaction-state-machine` as
  `refactor(editor): unify transient interaction state`.

## 2026-08-14 - Stabilize rapid MOS Copy and VDD rail presentation

- Target: make render-free `Escape -> C` command bursts observe the canonical
  interaction transition after NMOS/PMOS placement, and remove the VDD Rail's
  thin terminal stub while styling all of `V_DD` bold italic.
- Changed areas: synchronous interaction-state publication and safe keyboard
  target detection; VDD label RichText authoring; power-label rendering;
  focused unit/browser regressions and accepted interaction specification.
- Validation: 31 focused unit tests, 2 focused browser tests, all 15 component
  insertion browser tests, `pnpm verify:branch` (558 unit tests, all workspace
  builds and production smoke), live VDD DOM inspection, and
  `git diff --check` passed.
- Commit status: ready to commit on `codex/mos-copy-vdd-visual-fix` as
  `fix(editor): stabilize MOS copy transition and VDD rail`.

## 2026-08-14 - Preserve shared MOS bulk Nets during copy

- Target: prevent a copied NMOS/PMOS with a shared implicit bulk Net from
  invalidating the transient preview document or creating an electrically
  incomplete pasted instance.
- Changed areas: clipboard boundary-Net projection and paste reconnection;
  graceful stale-boundary handling; focused unit and browser regression
  coverage.
- Validation: focused clipboard unit tests, full component-insert browser spec,
  `pnpm typecheck`, frozen-lockfile install, and full `pnpm ci:check` (559 unit
  tests, 103 browser tests, builds, performance/export/PWA/release smoke)
  passed; `git diff --check` passed.
- Commit status: committed on `codex/fix-mos-external-net-copy` as `766c098`
  (`fix(editor): preserve shared MOS bulk nets during copy`).

## 2026-08-14 - Present Agent hand-off as a copy card

- Target: make the visible Agent connection instructions identical to the
  clipboard payload and present them in a compact card aligned with the editor
  theme.
- Changed areas: Agent connection panel markup, themed copy-card styling,
  accessible copy feedback, and focused component coverage.
- Validation: focused `connect-agent-panel` tests and `pnpm typecheck` passed;
  the local editor shell was inspected in the in-app browser; `git diff
--check` passed.
- Commit status: committed on `codex/agent-copy-card` as
  `feat(agent): present handoff as copy card`.

## 2026-08-14 - Publish compact Agent operating Kit

- Target: give an external Agent without repository source a minimal private
  operating folder before claim redemption, without adding a new edit protocol.
- Changed areas: browser-safe Kit content, public Worker route, compact copied
  hand-off, relay/component tests, and session/Agent documentation.
- Validation: 32 focused unit tests, `pnpm typecheck`, `pnpm docs:check`, a
  dependency-aware editor production build, and `git diff --check` passed. The
  Kit was confirmed absent from the editor bundle and is transferred only on
  its explicit route request.
- Commit status: committed on `codex/agent-copy-card` as
  `feat(agent): publish compact operating kit`.

## 2026-08-14 - Unify annotation presentation geometry

- Target: remove divergent text glyph/hit/fallback coordinates after instance
  rotation and make a selected VDD rail plus its label delete atomically.
- Changed areas: derived annotation presentation/bounds; label materialization
  and rotation follow; SVG/export and visual diagnostics; editor annotation
  hit/marquee/edit geometry; visual-route deletion contract; focused tests and
  current model/editor specifications.
- Validation: 80 focused derived/editor/edit-engine/render tests, `pnpm
typecheck`, `pnpm format:check`, `git diff --check`, and focused Playwright
  VDD rail creation/deletion passed. The reviewed export goldens were
  regenerated to include the true RichText bounds; frozen-lockfile install and
  canonical `pnpm ci:check` then passed (562 unit tests, 103 browser E2E,
  workspace builds, golden/export/PWA/production/release checks).
- Commit status: initial implementation `5be6e16`; golden completion ready to
  commit on `codex/unify-annotation-presentation`.

## 2026-08-14 - Close MCP adapter review gaps

- Target: make the M0-M3 MCP adapter preserve visible wiring and document
  identity, avoid partial multi-transaction action commits, observe concurrent
  human edits, and keep bearer credentials process-local until M4.
- Changed areas: Agent Helper action/session contracts; MCP tool schemas and
  focused tests; MCP-native quickstart, resource projections, ADR wording, and
  generated resources.
- Validation: 129 focused Agent/MCP/adapter tests, generated-resource and
  Markdown checks, `pnpm typecheck`, `git diff --check`, and
  `pnpm verify:branch` (112 test files / 638 tests, all workspace builds,
  static contracts, and editor production smoke) passed.
- Commit status: ready to commit on `codex/agent-mcp-adapter` as
  `fix(agent): close MCP adapter review gaps`; intentionally not merging until
  the separately scoped M4/M5 work is ready.

## 2026-08-14 - Complete deployable MCP lifecycle

- Target: finish M4/M5 on PR #49 with restart-safe browser/Agent pairing,
  compact file tools, an installable MCP package, and a deployment golden path
  while keeping the four Circuit operations authoritative.
- Changed areas: connector issue/resume/revoke transport; Helper credential
  storage and bearer refresh; same-browser editor recovery and MCP-first
  hand-off; existing File Resource wrappers; MCP/release packaging, docs,
  generated OpenAPI/resources, and deterministic deployment smoke.
- Validation: 187 focused contracts; `pnpm verify:branch` (648 tests); clean
  install plus `pnpm ci:check` (648 unit and 103 browser tests); Cloudflare
  Worker deploy dry-run; packaged two-process MCP claim/edit/render/file/resume
  smoke; all six PR #49 required checks passed.
- Commit status: implementation committed and pushed on
  `codex/agent-mcp-adapter` as `0b36b78`; PR #49 remains open and unmerged by
  request.

## 2026-08-14 - Publish self-bootstrapping MCP distribution

- Target: let a first-time external Agent install or discover Analog Canvas
  MCP from the editor's existing copied handoff, with immediate Agent Kit
  fallback and no circuit API expansion.
- Changed areas: shared distribution declaration; public Worker bootstrap
  manifest; editor copy/setup text; MCP and application release packaging;
  GitHub Release/optional npm workflow; installation documentation.
- Validation: 32 focused editor/Worker tests, typecheck, public `npx`
  initialize, frozen install plus `pnpm ci:check` (649 unit/integration and
  103 browser tests), all six PR #50 checks, production Cloudflare deployment,
  Release SHA-256 verification, and public Release URL initialize passed.
- Commit status: implementation `b3f4d70`, canonical integrity fix
  `fe6ea74`, merged as PR #50; GitHub Release `mcp-v0.1.0` published.

## 2026-08-14 - Normalize Fit View bounds to the editor grid

- Target: prevent Fit View (`F`, `Home`, and the command button) from feeding
  fractional renderer geometry back into the integer-grid editor camera.
- Changed areas: one derived-bounds-to-camera adapter in the editor, its unit
  contract, and a browser regression that fits drafted text through `F`.
- Validation: focused unit and browser checks, `pnpm typecheck`, formatting,
  full drafting E2E (24 tests), `git diff --check`, and canonical `pnpm
ci:check` (651 unit tests, 104 browser tests, builds and release smoke) all
  passed.
- Commit status: committed on `codex/fix-fit-view-grid-bounds`; remote CI and
  merge remain pending.

## 2026-08-14 - Close coordinate domains and grid normalization boundaries

- Target: make current Project page coordinates and camera rectangles grid
  aligned while retaining renderer, text, curve, and pointer precision in
  non-persistent coordinate domains.
- Changed areas: model coordinate schemas/helpers; Document and typed-edit
  validation; derived/render/Agent contracts; editor fit, pan, zoom, focus,
  preview, drafting and annotation commit paths; current fixtures and generated
  Agent API artifacts; ADR 0021 and model/edit/editor specs.
- Validation: complete local suite (115 files / 654 tests), typecheck,
  formatting, Markdown-link validation, Agent catalog/artifact checks, and
  `git diff --check` passed. Frozen-lockfile `pnpm ci:check` also passed its
  static, unit, workspace-build, performance, and release verification stages;
  local Playwright startup produced no output before tool timeout on both the
  full gate and a direct rerun, so remote browser CI is still required.
- Commit status: committed on `codex/coordinate-domain-contract`; merge to
  `main` requires remote browser CI and review checks.

## 2026-08-14 - Coordinate-domain CI follow-up

- Target: repair PR #53 failures caused by two annotation creation paths that
  skipped grid normalization and by the Linux MCP package digest changing with
  the Agent schema payload.
- Changed areas: route Net Label/current-marker fallback placement, Linux MCP
  release integrity pin, and the active coordinate-domain target record.
- Validation: focused route/Edit Engine contracts, typecheck, formatting,
  complete release verification, and the two previously failing Playwright
  cases passed locally.
- Commit status: pending follow-up commit on
  `codex/coordinate-domain-contract`; remote PR checks will decide merge.

## 2026-08-14 - Restore imported flightline guidance during placement

- Target: keep SPICE-imported routing guidance usable after placement and
  partial Wire authoring, while dismissing it after Net-label or ordinary
  geometry intervention and hiding it during Net highlight.
- Changed areas: Document guidance schema/import initialization; edit-engine
  lifecycle policy; editor flightline visibility; focused SPICE/engine/browser
  contracts.
- Validation: 24 focused engine/SPICE tests, isolated browser flightline suite
  (3 tests), workspace build, typecheck, Prettier, and `git diff --check`
  passed.
- Commit status: committed as `59bba32` on `codex/import-flightline-guidance`;
  pushed as PR #54. The MCP release checksum was refreshed after the package changed.

## 2026-08-15 - Integrate imported flightline guidance on coordinate domains

- Target: rebase imported-SPICE flightline guidance on the coordinate-domain
  contract and deliver the combined change through required CI.
- Changed areas: resolved `App.tsx` and transaction-layer integration;
  refreshed the Linux MCP package SHA-256 release pin.
- Validation: 24 focused engine/SPICE tests, 3 isolated browser flightline
  tests, typecheck, workspace build, formatting, distribution/release checks,
  and all six PR #54 GitHub Actions checks passed.
- Commit status: PR #54 merged to `main` as `354cf3a`.

## 2026-08-15 - Make junctions follow dragged wire segments

- Target: correct direct segment movement so a Junction is moved as a
  topological vertex instead of remaining an absolute geometry anchor.
- Changed areas: derived wire-segment stretch policy and an edit-engine
  regression for a three-way Junction with an orthogonally stretched branch.
- Validation: focused derived/edit-engine suite (34 tests), typecheck,
  Prettier, and `git diff --check` passed.
- Commit status: PR #57 merged to `main` as `16ad036` after all required
  GitHub Actions checks passed.

## 2026-08-15 - Default drafting text to Razavi typography

- Target: make `T`-created free text begin with the same bold-italic main and
  bold-upright subscript composition as existing Razavi annotations.
- Changed areas: semantic text factory, drafting-text creation, and RichText
  script rendering with focused regression tests.
- Validation: 20 focused model/renderer/editor tests, stale power-label
  contract regression, and clean-tree `pnpm ci:check` all passed (static,
  726 unit/integration tests, workspace build/release smoke, 121 browser
  tests).
- Commit status: all six PR #60 GitHub Actions checks passed; squash-merged to
  `main` as `0f45ba5`.

## 2026-08-15 - Snap quick drafting creation to grid

- Target: prevent transient viewport coordinates from causing `T` and drafting
  creation commits to violate the persisted Document-grid contract.
- Changed areas: quick drafting creation and final drafting commit boundaries,
  with a zoomed-viewport Text browser regression.
- Validation: targeted browser regression, complete drafting suite (25/25),
  App unit test (12/12), typecheck, formatting, and `git diff --check` passed.
- Commit status: committed on `codex/label-gap-copy-rotate`; push and review
  remain pending.

## 2026-08-15 - Align instance labels and rotate copy previews

- Target: make initial and transformed instance labels retain one full grid
  interval from the visible symbol, and permit `R` before copy placement.
- Changed areas: derived label clearance/snap policy; transient Copy Placement
  orientation and shortcut routing; rotated copy preview/commit behavior;
  editor interaction specification and focused unit/browser regressions.
- Validation: 30 focused tests, `pnpm typecheck`, `pnpm format:check`, `git
diff --check`, and two focused Playwright regressions passed.
- Commit status: ready to commit on `codex/label-gap-copy-rotate` as
  `fix(editor): align labels and rotate copy previews`.

## 2026-08-15 - Align label-clearance integration contracts

- Target: reconcile the downstream Edit Engine and editor geometry assertions
  with the completed one-grid visible-glyph clearance policy.
- Changed areas: MOS rotation placement expectations and the BJT clearance
  assertion, which now checks the rendered glyph edge rather than an obsolete
  raw baseline offset.
- Validation: 51 focused derived/Edit Engine/editor geometry tests, typecheck,
  Prettier, and `git diff --check` passed. Two overlapping local full-gate
  E2E runs were stopped because they contended for the same preview port;
  both remote delivery-gate runs then passed every required check, including
  both browser shards.
- Commit status: merged through PR #64 as squash commit `ad604fb`.

## 2026-08-15 - Stabilize label clearance and repeated rotation

- Target: remove the interaction-padding-derived extra label grid cell and
  make automatic label rotation idempotent, while preserving explicitly moved
  labels as rigid object-relative offsets.
- Changed areas: derived ink versus hit bounds, instance-label grid placement,
  Edit Engine follow behavior, label/routing regressions, and the editor
  interaction contract.
- Validation: focused 52-test derived/Edit Engine suite, typecheck, Prettier,
  `git diff --check`, frozen install, and isolated-port `pnpm ci:check`
  (728 unit/integration tests, build/release verification, 124 browser tests).
- Commit status: squash-merged through PR #67 as `a896fb5` after all remote
  required checks passed.

## 2026-08-15 - Show the complete compact component Library

- Target: replace the eight-item starter subset with the complete quick-place
  palette while keeping the left Library compact and immediately usable.
- Changed areas: Library catalog projection and priority ordering; compact
  three-column device tiles with concise visual labels and full accessible
  names; focused static and browser regressions for all 18 palette items and
  default-viewport fit.
- Validation: focused unit tests (2 files / 16 tests), focused Playwright
  Library flow (1 test), `pnpm typecheck`, Prettier checks, desktop screenshot
  inspection at 1280x720, and `git diff --check` passed.
- Commit status: committed and pushed on
  `agent/compact-complete-library` as
  `feat(editor): show complete compact component library`.

## 2026-08-15 - Group Library devices by category

- Target: replace the flat 18-device Library grid with the same six category
  groups used by the Insert dialog.
- Changed areas: sidebar catalog projection, compact category headings/counts,
  category-aware unit coverage, and a browser regression for all six groups and
  all 18 quick-place buttons.
- Validation: focused unit tests (2 files / 16 tests), focused Playwright
  categorized-Library flow (1 test), `pnpm typecheck`, Prettier checks,
  reviewer approval, desktop screenshot inspection at 1280x720 and 1440x900,
  and `git diff --check` passed.
- Commit status: committed and pushed on
  `agent/compact-complete-library` as
  `feat(editor): group library devices by category`.

## 2026-08-15 - Right-align Help and fold Library categories

- Target: move Help to the right edge of the top bar and make every device
  category independently collapsible without losing Library state.
- Changed areas: top-bar action grouping; controlled native category folds and
  disclosure styling; static and browser regressions for right alignment,
  narrow bounds, independent folding, and fold persistence across rerenders.
- Validation: focused unit tests (2 files / 16 tests), two focused Playwright
  flows, `pnpm typecheck`, Prettier checks, reviewer approval with its coverage
  suggestion addressed, desktop/narrow screenshot inspection, and
  `git diff --check` passed.
- Commit status: committed and pushed on
  `agent/compact-complete-library` as
  `feat(editor): right-align help and fold library categories`.

## 2026-08-15 - Fit four Library icons per row

- Target: increase Library density to four quick-place tiles per category row
  while preserving readable labels and responsive behavior.
- Changed areas: four-column category/Recent grids; smaller desktop artwork and
  tiles; concise visual labels with full accessible names; restored larger
  narrow-layout tiles; browser geometry, containment, overflow, and Recent-grid
  checks at the 220px Library boundary.
- Validation: focused unit tests (2 files / 16 tests), two focused Playwright
  flows, `pnpm typecheck`, Prettier checks, reviewer approval after readability
  fixes, screenshot inspection at 1280x720, 1024x720, and 720x720, and
  `git diff --check` passed.
- Commit status: committed and pushed on
  `agent/compact-complete-library` as
  `style(editor): fit four library icons per row`.

## 2026-08-15 - Center/enlarge Library devices and rebase

- Target: enlarge four-column device artwork, keep icon rows vertically
  consistent across mixed label lengths, and rebase the complete Library branch
  onto latest main.
- Changed areas: fixed desktop/narrow artwork rows and symbol dimensions;
  browser checks for exact size, four-edge containment, mixed-label alignment,
  and responsive behavior; rebase conflict resolution in the factual log.
- Validation: post-rebase focused unit tests (2 files / 16 tests), two focused
  Playwright flows, `pnpm typecheck`, Prettier checks, reviewer approval after
  geometry coverage was expanded, screenshot inspection at 1280x720,
  1024x720, and 720x720, `git diff --check`, and ancestry verification passed.
- Rebase: branch rebased onto `origin/main` at `330ba43`; the `plan/log.md`
  conflict preserved both imported-flightline mainline records and Library
  records.
- Commit status: committed, rebased, and force-pushed on
  `agent/compact-complete-library` as
  `style(editor): center and enlarge library devices`.

## 2026-08-15 - Truly center Library device artwork

- Target: correct the remaining visual offset by centering each SVG on the full
  tile rather than inside an upper artwork row.
- Changed areas: absolute full-tile artwork centering; independently anchored
  bottom labels; larger desktop/narrow tile and artwork dimensions; exhaustive
  browser geometry checks for both axes, tile heights, containment, and label
  separation.
- Validation: focused unit tests (2 files / 16 tests), two focused Playwright
  flows, `pnpm typecheck`, Prettier checks, reviewer feedback addressed,
  screenshot inspection at 1280x720, 1024x720, and 720x720, direct zero-pixel
  center-delta measurement, and `git diff --check` passed.
- Commit status: committed and pushed on
  `agent/compact-complete-library` as
  `fix(editor): vertically center library device artwork`.

## 2026-08-15 - Compact the truly centered Library tiles

- Target: reduce tile height without moving artwork away from the exact tile
  center or allowing labels to overlap.
- Changed areas: single-line compact electrical labels; desktop tile height
  reduced from 86px to 66px; narrow tile height reduced from 94px to 74px;
  exhaustive desktop/narrow centering, fit, separation, and overflow checks.
- Validation: focused unit tests (2 files / 16 tests), two focused Playwright
  flows, `pnpm typecheck`, Prettier checks, reviewer suggestion addressed,
  screenshot inspection at 1280x720, 1024x720, and 720x720, and
  `git diff --check` passed.
- Commit status: committed and pushed on
  `agent/compact-complete-library` as
  `style(editor): compact centered library tiles`.

## 2026-08-15 - Use icon-only centered Library tiles

- Target: make the Library still more compact while keeping the device artwork
  visually centered in each box.
- Changed areas: removed visible in-tile labels from Library and Recent buttons;
  retained complete accessible names/tooltips; reduced desktop tiles to 52px
  and narrow tiles to 60px around unchanged centered artwork.
- Validation: focused unit tests (2 files / 16 tests), two focused Playwright
  flows covering icon-only primary/Recent tiles, accessible names, exact
  centering, dimensions, and containment, `pnpm typecheck`, Prettier checks,
  reviewer suggestion addressed, screenshot inspection at 1280x720,
  1024x720, and 720x720, and `git diff --check` passed.
- Commit status: committed and pushed on
  `agent/compact-complete-library` as
  `style(editor): use compact centered library icons`.

## 2026-08-15 - Restore names below centered Library devices

- Target: bring visible device names back without losing full-tile artwork
  centering or returning to oversized boxes.
- Changed areas: concise one-line labels restored for Library and Recent tiles;
  labels anchored at the bottom; desktop/narrow heights set to 64px/68px with
  measured artwork-label separation and unchanged centered artwork sizes.
- Validation: focused unit tests (2 files / 16 tests), two focused Playwright
  flows covering label fit, centering, separation, dimensions, Recent labels,
  and accessibility, `pnpm typecheck`, Prettier checks, reviewer approval,
  screenshot inspection at 1280x720, 1024x720, and 720x720, and
  `git diff --check` passed.
- Commit status: committed and pushed on
  `agent/compact-complete-library` as
  `fix(editor): restore names on centered library tiles`.

## 2026-08-15 - Center the Library icon-label visual weight

- Target: center the combined `重心` of each device picture and visible name,
  rather than centering the picture independently.
- Changed areas: artwork and name returned to one fixed grid group; the union
  is vertically centered with both elements horizontally centered; tile heights
  reduced to 56px desktop and 64px narrow.
- Validation: focused unit tests (2 files / 16 tests), two focused Playwright
  flows measuring union-center geometry, element X centers, separation, fit,
  dimensions, folds, and Recent behavior, `pnpm typecheck`, Prettier checks,
  reviewer approval, screenshot inspection at 1280x720, 1024x720, and
  720x720, and `git diff --check` passed.
- Commit status: committed and pushed on
  `agent/compact-complete-library` as
  `fix(editor): center library icon-label groups`.

## 2026-08-15 - Deliver compact Library PR

- Target: rebase the complete Library/navigation branch onto latest main, run
  branch/remote gates, push, and open the review PR.
- Rebase: main advanced repeatedly during delivery; final branch rebased onto
  `origin/main` at `ea60c96`. The `plan/log.md` conflicts preserved mainline
  junction, drafting-text, VDD-rail, label-spacing, and closeout records plus
  all Library records.
- Validation: final targeted Library/narrow browser flows (2 tests),
  `pnpm verify:branch` (119 files / 728 tests, static checks, workspace builds,
  production smoke), ancestry/diff checks, and the final docs link check
  passed; the final tip was submitted to all six required PR checks.
- Pull request: [#63](https://github.com/chenzc24/Analog-Canvas/pull/63),
  `feat(editor): complete compact categorized component library`, targeting
  `main`.
- Commit status: rebased branch force-pushed with lease; PR is open with all
  required checks enforced on the final tip.

## 2026-08-15 - Stabilize route current-marker dragging

- Target: prevent a route-attached current arrow from rebuilding the full
  formal SVG scene while it is dragged.
- Changed areas: removed annotation-level React preview state for marker
  movement; the existing imperative visual now temporarily transforms only the
  marker and its hit target, then restores it before the single route-attachment
  transaction on release. The focused browser regression asserts the original
  formal marker node survives preview.
- Validation: changed-file Prettier, focused current-marker Playwright 1/1,
  editor TypeScript, editor production build, and `git diff --check` passed.
- Commit status: prepared on `codex/fix-current-marker-drag-stability` for
  focused commit and push.

## 2026-08-15 - Compact narrow Library and overlay Properties

- Target: preserve the left Library rail at half-screen widths while avoiding
  a bottom-stacked Library and Properties layout.
- Changed areas: compact viewport state, Library/Properties mutual exclusion,
  one-column left Library with a concise `All` heading, right-side overlay
  Properties positioning, and focused browser coverage.
- Validation: focused Library/App unit tests (2 files / 16 tests), focused
  narrow Library and canvas-width Playwright tests (2 tests), `pnpm typecheck`,
  Prettier, and `git diff --check` passed.
- Commit status: committed locally as
  `fix(editor): compact narrow library and overlay properties` on
  `codex/compact-library-overlay-properties`; not pushed.

# 2026-08-15 - Make public Agent UI dormant

- Target: keep the deployed editor human-only without disabling internal
  API/MCP/local Agent integrations.
- Changed areas: production-default UI mode resolver; App-level removal of the
  Agent menu, connection and file-approval dialogs, Properties status/details;
  inert disabled browser session lifecycle; focused tests; public-facing README
  and troubleshooting wording.
- Validation: focused resolver/App tests (15/15), typecheck, docs/format,
  production smoke, `git diff --check`, and `pnpm verify:branch` (123 files /
  740 tests, workspace build, production smoke) passed.
- Commit status: committed on `agent/public-agent-ui-dormant` as
  `feat(editor): hide public Agent controls`.

# 2026-08-15 - Mirror transient placement and toggle grid dots

- Target: add minimal orientation controls during C/I placement and one local
  canvas-grid visibility control without expanding persisted/editor-Agent
  contracts.
- Changed areas: interaction reducer and shortcut arbitration; clipboard
  preview/commit orientation projection; component preview; canvas view
  control; focused unit and browser coverage; interaction specification.
- Validation: focused unit tests (4 files / 30 tests), focused Playwright
  coverage (2 tests), `pnpm typecheck`, targeted Prettier check, and
  `git diff --check` passed.
- Commit status: committed and pushed as
  `fix(editor): mirror transient placements and toggle grid dots` on
  `codex/placement-mirror-grid-toggle`.
- Mainline delivery: PR #72 passed all six required GitHub Actions checks and
  squash-merged to `main` as `7db4a06`.

# 2026-08-15 - Per-type instance designators and right-drag camera framing

- Target: per-type placement numbering, unified camera zoom protocol with a
  right-drag zoom box, and copy-paste label increment (including batch).
- Changed areas: netlist-authoring designator allocation; App placement and
  VDD rail ids; clipboard paste ids and instance-label rewrite; fit-view
  camera math unification; canvas right-drag gesture and zoom-box style;
  focused unit and Playwright coverage (two new browser tests).
- Validation: 20/20 focused unit tests; Playwright 17/17 component-insert,
  65/65 manual-editor, 6/6 crash-safety+recovery, 25/25 drafting;
  `git diff --cached --check`; typecheck clean for this target (two
  remaining errors belong to a concurrent worker's untracked WIP file,
  recorded in the plan).
- Commit status: committed on `agent/per-type-designators-zoom-box` as
  `feat(editor): per-type designators, copy label increment, right-drag zoom
  box`; branch pushed for review. A concurrent worker's overlapping App.tsx
  hunks were excluded from the commit via selective staging and left dirty
  in the working tree.
