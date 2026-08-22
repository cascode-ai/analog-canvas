# Maintenance Log

## 2026-08-21 - Razavi default Port label text

- Changed areas: made non-voltage/current semantic Net and Formal Port names
  use the default Razavi bold-italic RichText base; added model and rendered
  `NET1` Port regression coverage.
- Validation: focused model unit contract, focused Port browser workflow,
  typecheck, format, test-impact, and diff checks passed.
- Commit status: committed on `codex/insert-unification` at the current branch
  HEAD; push pending after one transient GitHub TLS handshake failure.

## 2026-08-21 - Separate compact Port Setup from generic Insert

- Changed areas: moved Port role/name/direction out of the generic Insert
  control grid into a dedicated compact dialog; routed P, Library, and full
  Insert Port choices through one editor-local setup intent while retaining the
  existing placement planners.
- Validation: focused dialog/launch/Library unit contracts (4 files / 12
  tests), focused Port shortcut browser workflow, typecheck, format,
  test-impact, and diff checks passed.
- Commit status: committed on `codex/insert-unification` at the current branch
  HEAD; push pending after one transient GitHub TLS handshake failure.

## 2026-08-21 - Complete unnamed Free Net Port placement

- Changed areas: made isolated Free Net Port placement allocate the first
  unused `NET<n>` name instead of rejecting the click; preserved explicit and
  named-contact precedence; added a `P` shortcut browser regression.
- Validation: focused Port browser regression, typecheck, format,
  test-impact, and diff checks passed.
- Commit status: committed on `codex/insert-unification` at the current branch
  HEAD.

## 2026-08-21 - Unified Insert and Library orchestration

- Changed areas: introduced an editor-local `InsertLaunch` contract with
  explicit all-candidate and Cell-only scopes; unified Library, Insert,
  keyboard, Port, Cell, and dialog-confirmation entry points; and made the
  Cell picker visibly scoped without changing persisted or Engine protocols.
- Validation: focused unit contracts (3 files / 9 tests), focused Library
  browser flows (3 tests), Cell scope-reset browser regression, typecheck,
  format, test-impact, and diff checks passed.
- Commit status: committed on `codex/insert-unification` at the current branch
  HEAD.

## 2026-08-20 - External subcircuit definition authoring

- Changed areas: schema-15 project external interfaces and migration; stable
  external block symbols; caller-safe terminal rename/reorder and `X` placement;
  SPICE preservation of unknown external calls including SKY130 generic
  fallbacks; current fixtures, persistence contracts and ADR/spec updates.
- Validation: focused unit/UI contracts (12 files / 91 tests); focused
  Playwright project-file workflow (8 tests); `pnpm typecheck`; `pnpm build`;
  `pnpm format:check`; `pnpm docs:check`;
  `pnpm test:impact -- --base origin/main`; `git diff --check`.
- Commit status: committed locally on `codex/external-subcircuit-definition`.

## 2026-08-20 - S2 Component Properties workbench

- Changed areas: typed Identity/target/source-evidence projections, editable
  model target, atomic Additional Parameters Apply/Cancel table, and the
  case-folded parameter patch contract.
- Validation: `pnpm typecheck`; focused unit/UI contracts; focused Component
  Properties Playwright workflow; `pnpm docs:check`;
  `pnpm test:impact -- --base origin/main`; `git diff --check`.
- Commit status: committed locally on
  `codex/phase1-schematic-foundation-plan`.

## 2026-08-19 - S1 descriptor-backed property protocol

- Changed areas: descriptor-owned ordered parameter metadata; editor Insert,
  Properties, and Value projection adapters; typed instance reference/binding
  writers; export required-parameter derivation; shared Agent schema artifacts.
- Validation: `pnpm typecheck`; focused unit contracts (10 files / 105 tests);
  `pnpm agent-api:artifacts:check`; `pnpm docs:check`;
  `pnpm test:impact -- --base origin/main`; `git diff --check`.
- Commit status: committed locally as `c6fbe6f` on
  `codex/phase1-schematic-foundation-plan`.

## 2026-08-18 - Deliver schematic hierarchy protocol v12

- Changed areas: schema-12 Cell hierarchy authoring, editor navigation,
  Agent/export parity, MCP packaged-smoke schema fixture, Linux MCP integrity
  pin, and the outdated empty-canvas navigation assertion.
- Validation: focused empty-canvas Playwright test; `pnpm ci:release`;
  `pnpm mcp:distribution:check`; and all six required PR #119 CI checks.
- Commit status: merged to `main` as PR #119 (`e0f0b9e`).

## 2026-08-18 - Compact planning and roadmap retention

- Changed areas: removed routine UI/delivery plan records; archived resolved
  plans and completed roadmaps; reconciled stale completion markers; refreshed
  the root queue and current/archive links.
- Validation: current-document Markdown links, root-plan metadata inventory,
  pre-2026-08-13 log-field inventory, and `git diff --check` passed.
- Commit status: committed on `codex/plan-docs-retention`.

## 2026-08-17 - Move Examples to the left tool rail

- Changed areas: Examples rail button and icon, left-panel mode switching, independent examples panel, Library cleanup, and focused unit/browser coverage.
- Validation: focused panel/App tests (3 files / 18 tests), focused browser workflow, `pnpm test:impact -- --base origin/main`, `pnpm ci:check` (819 unit and 145 browser tests), desktop visual review, and all six…
- Commit status: merged to `main` as PR #111 (`f7d961c`).

## 2026-08-17 - Merge Library Project examples

- Changed areas: rebased the example feature onto current routing work, resolved the shared maintenance-log append, normalized bundled JSON format, and completed the review/merge lifecycle.
- Validation: `pnpm install --frozen-lockfile`; `pnpm ci:check` (818 unit and 145 browser tests); `pnpm test:impact -- --base origin/main`; and all six required GitHub Actions checks on PR #109 passed.
- Commit status: merged to `main` as PR #109 (`cd1cddd`).

## 2026-08-16 - Grid-dots toggle icon clarity

- Changed areas: `tool-icon.tsx` grid glyph dots calibrated to `r=1.4` (~2.2px), a clear dot field that still matches the thin-stroke icon family; `aria-label` untouched so the e2e contract holds.
- Validation: pixel measurement (new icon = 9 solid ~2px dot clusters; old = none visible), editor unit tests 305/305, grid e2e 1/1, typecheck + Prettier, CI six checks green.
- Commit status: PR #103 (`zcode/grid-icon-clarity`), commit `e3bd2ae`; all six required remote checks passed and the human merged it to `main` as `eac9c40`.

## 2026-08-16 - Fraction parts three A+ levels larger

- Changed areas: `fractionGeometry` offsets converted to em of the part font with `partScaleMultiplier: 1.3`; one `fractionPartScale` helper drives the layout measure, the inline tspan render, the structured annotation render, and the presentation-bounds a…
- Validation: 790 unit tests, `pnpm ci:static`, `pnpm verify:branch` (build + production smoke), focused value e2e 3/3, and a pixel-level check of the rendered fraction (parts ≈ 99% of the label height, clean gaps…
- Commit status: PR #101 (`zcode/fraction-part-scale`), commits `cec8cbc` (feat) and `db12782` (plan record); all six required remote checks passed and the human merged PR #101 to `main` as `d414bdd`.

## 2026-08-16 - Razavi fraction values, engineering units, live Value toggle

- Changed areas: model restores the `fraction` RichText run retired in `32e256c` at schema v11 (corpus, seven project fixtures re-versioned, the `instance-value-display` fixture value annotations re-projected, agent-api artifacts + MCP resources regenerate…
- Validation: 789 unit tests, full e2e 143/143, `pnpm ci:static`, `pnpm verify:branch` (build + production smoke), `agent-api:artifacts:check`, `mcp:resources:check`, `git diff --check` clean. Four-orientation GUI…
- Commit status: PR #99 (`zcode/instance-value-razavi-fraction`), commits `a13a6ba` (model + regenerated artifacts), `b51cb5b` (presentation), `a075da5` (render), `ca8d49d` (editor + e2e), `60abe11` (plan records), `…

## 2026-08-16 - Instance value display and property annotations

- Changed areas: model `instance-value` kind + schema v10 (corpus, five project fixtures, agent-api artifacts, MCP resources regenerated; compatibility doc updated); derived `displayableInstanceValue` formatter + reference/value placement slots; edit-engin…
- Validation: 784 unit tests, full e2e 143/143 (four new value-display tests), `pnpm ci:static`, `pnpm verify:branch`, four-orientation GUI inspection of the fixture, `git diff --check` clean. Code audit corrected…
- Commit status: PR #97 (`zcode/instance-value-display`), commits `252d4a8` (model + regenerated artifacts), `5df0c4e` (presentation), `ecb30c5` (editor), `c4f67d7` (e2e), `0399660` (plan records), `28e11b3` (MCP tar…

## 2026-08-16 - Restore the VDD power-port device beside the rail

- Changed areas: new `vdd-port.symbol.json` + restored reference fixtures (`vdd-reference.png`, `vdd-geometry.json`, manifest/fidelity pins); catalog + generated adapters (`razavi-catalog.generated.ts`, `agent-authoring-catalog.generated.ts`); `netlist.ts`…
- Validation: 344 editor+symbols unit tests, 138 agent tests, render-svg, typecheck, `symbols:razavi:check`, `agent-kit:catalog:check`, `agent-api:artifacts:check`, full `component-insert.spec.ts` (18/18) plus the…
- Commit status: PR #89 (`codex/vdd-power-port-device`), commits `681477c` (device), `00cb181` (regenerated MCP resources after the agent catalog grew), `d76bd24` (refreshed MCP tarball sha256 pin from the CI-reporte…

## 2026-08-15 - Editor runtime crash safety (minimal three layers)

- Changed areas: new `editor-error-boundary.tsx`, `scene-safety.ts`, `crash-test-hooks.ts` (DEV-only), `runtime-crash-safety.spec.ts`; additive `INTERNAL_ERROR` in `EditErrorCode`; `document-controller.ts` fence + history rebuild; `App.tsx` scene guards an…
- Validation: 736 unit tests green (7 new); 106 E2E green (2 new + drafting, component-insert, full manual-editor); typecheck, prettier, `git diff --check` clean.
- Commit status: committed as `feat(editor): keep the page alive through render and transaction crashes` on `agent/editor-runtime-crash-safety`.

## 2026-08-15 - Junction-aware VDD rail mainline delivery

- Changed areas: delivery evidence only; product change is `01655dc`.
- Validation: clean frozen install plus complete `pnpm ci:check`; all six PR #62 required GitHub Actions checks passed (scope, static, unit, release, and two browser shards).
- Commit status: PR #62 merged to `main` as `81d1e8d`; the delivery-record closure remains on this documentation-only commit.

## 2026-08-15 - Make tapped VDD rails stretchable and junction-aware

- Changed areas: connected `power-rail` component derivation; Junction-group route stretching; VDD whole-rail move/end-resize editor gestures; focused routing and browser regressions.
- Validation: focused routing tests (29), VDD browser regression, typecheck, Prettier, `git diff --check`, and clean branch status passed.
- Commit status: pending `fix(editor): make VDD rails stretchable after taps` on `codex/vdd-rail-editing`.

## 2026-08-14 - WP-5 browser hardening and release delivery

- Changed areas: new `recovery-hardening.spec.ts` (4 tests), recovery dialog generation lines now include the revision (fixes a card-scoping ReferenceError found by the two-tab run), `scripts/editor-production-smoke.mjs` cache-isolation check + regenerated…
- Validation: hardening spec 4/4; typecheck, prettier, docs links, and the production smoke in both modes against a fresh build green; `git diff --check` clean. Branch gate (`pnpm verify:branch`) and clean-state `…
- Commit status: committed as `test(editor): prove project recovery failure modes` plus `fix(editor): keep drag sessions alive across app re-renders` on `agent/robust-page-persistence-recovery`.

## 2026-08-14 - WP-4 recovery UX and operational visibility

- Changed areas: new `recent-recovery-dialog.tsx` + `recovery-banners.tsx`, `downloadTextArtifact` in `project-file-service.ts`, `App.tsx` dialog/ banner/menu/statusbar wiring, help dialog + troubleshooting docs, new `recovery-dialog.spec.ts` (6 tests) and…
- Validation: 106 unit tests; 90 E2E tests across manual-editor, recovery-dialog, project-file, component-insert; typecheck, prettier, `git diff --check` clean.
- Commit status: committed as `feat(editor): add recent-work recovery UX` on `agent/robust-page-persistence-recovery`.

## 2026-08-14 - WP-3 project file service and replacement protection

- Changed areas: new `project-file-service.ts` (+13 unit tests), new `replace-guard-dialog.tsx`, `App.tsx` file-state/guard/save/open wiring, download-only E2E emulation in manual-editor/drafting specs, new `project-file.spec.ts` (7 tests).
- Validation: 106 unit tests; 111 E2E tests across drafting/manual-editor/project-file/component-insert/web-agent-session/ chrome-isolation; typecheck, prettier, `git diff --check` clean.
- Commit status: committed as `feat(editor): harden project open and save` on `agent/robust-page-persistence-recovery`.

## 2026-08-14 - WP-2 recovery coordinator and Project lifecycle

- Changed areas: new `recovery-coordinator.ts` (+17 unit tests), `App.tsx` recovery/replacement/refresh/restore wiring, `project-recovery.ts` reduced to the legacy migration key (writer hook and test removed), `editor-fixtures.ts` IndexedDB read helper, ma…
- Validation: `pnpm test:local apps/editor/src/document apps/editor/src/app/App.test.tsx` 93/93 green; E2E recovery/refresh greps plus full drafting and web-agent-session specs green; typecheck, prettier, `git dif…
- Commit status: committed as `refactor(editor): coordinate durable working copies` on `agent/robust-page-persistence-recovery`.

## 2026-08-14 - WP-1 IndexedDB recovery store and legacy migration

- Changed areas: new `apps/editor/src/document/browser-recovery-store.ts` (+18 unit tests on `fake-indexeddb` 6.2.5, new editor dev dependency, lockfile re-verified frozen).
- Validation: `pnpm test:local apps/editor/src/document` 68/68 green; typecheck, prettier, `git diff --check` clean.
- Commit status: committed as `feat(editor): persist bounded browser recovery` on `agent/robust-page-persistence-recovery`.

## 2026-08-14 - WP-0 recovery contract and retention core

- Changed areas: new `apps/editor/src/document/browser-recovery-contract.ts` (+23 unit tests), `docs/specs/persistence-and-recovery.md` v2 contract, user compatibility statement.
- Validation: `pnpm test:local apps/editor/src/document` 50/50 green; prettier, `tsc` project check, `git diff --check` clean.
- Commit status: committed as `feat(editor): define bounded recovery records` (`08af5d3`) on `agent/robust-page-persistence-recovery`.

## 2026-08-14 - Agent-side MCP adapter (M0-M3)

- Changed areas: new `packages/agent-client` Helper (http/connection-state/ credential-store/snapshot-cache/session-client/authoring compiler), new `apps/mcp-server` stdio MCP (protocol/tools/resources/results), ADR 0020, `docs/agent/resource-manifest.json…
- Validation: 71 new unit/contract tests; full suite 113 files / 638 tests green; format/docs/references/catalog/typecheck green; composite builds of both packages; generated-resource check up to date; live stdio…
- Commit status: to be committed as `feat(agent): add Agent-side stdio MCP adapter (M0-M3)` and pushed on `codex/agent-mcp-adapter`.

## 2026-08-14 - External Agent Razavi authoring Kit

- Changed areas: generated compact built-in authoring catalog; Kit v2 workflow and authority rules; public Agent/session/API guidance; Worker Kit subpath; generator freshness gate and black-box inverter contract coverage.
- Validation: focused 24-test Kit/Worker suite, generator check, typecheck, Markdown links, `git diff --check`, and `pnpm verify:branch` (104 files / 567 tests, workspace builds, production smoke) passed. Remote s…
- Commit status: feature committed as `9d257b7`; CI source-map repair committed as `a87fcb6` and pushed on `codex/agent-authoring-kit`.

## 2026-08-13 - Agent golden-path request-contract closure

- Changed areas: strict service handler selection for browser and loopback v2; v2-only invalid-request dialect; OpenAPI typed claim/Circuit failures; copyable connection instructions; current API guidance and focused tests.
- Validation: focused 57-test Agent/worker/editor suite, web Agent E2E, generated artifacts write/check, typecheck, docs, `git diff --check`, and `pnpm verify:branch` (118 files / 713 tests, build and production s…
- Commit status: ready to commit as `fix(agent): enforce one hosted request contract` on `codex/agent-project-lifecycle`.

## 2026-08-13 - Same-Project browser Agent session recovery

- Changed areas: bounded browser recovery record and hook lifecycle; terminal relay editor reconnection handling; session threat/spec and delivery-roadmap scope; focused recovery and Worker tests.
- Validation: focused 44-test session suite, browser Agent E2E, generated artifacts, docs/type/diff checks, and `pnpm verify:branch` passed (119 test files, 717 tests, all builds, production smoke).
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `feat(agent): recover same-project browser sessions`.

## 2026-08-13 - Project compatibility corpus baseline

- Changed areas: explicit Project corpus manifest; sequential migration and canonicalization regression test; current user file-compatibility guidance.
- Validation: focused corpus/persistence/v7-to-v8 tests (14 tests), typecheck, Markdown links, production-reader audit, and `git diff --check` passed.
- Commit status: committed as `ab30544` and pushed on `codex/agent-project-lifecycle`.

## 2026-08-13 - Typed netlist and source-provenance authority

- Changed areas: schema-v8 terminal mapping/import provenance and migration; structural SPICE import; hierarchy, ERC, search, Snapshot/OpenAPI, component parameters, symbol replacement, fixtures, and current model/API/persistence specifications.
- Validation: focused migration/import/ERC/Snapshot checks; Agent artifacts write/check; full `pnpm test:local` (117 files, 707 tests); typecheck, docs, references, formatting, `git diff --check`, and `pnpm verify…
- Commit status: committed as `9ad4ce5` and pushed on `codex/agent-project-lifecycle`.

## 2026-08-13 - Detailed browser Agent takeover delivery sequence

- Changed areas: verified M0--M2 status and M3 `spice.*` authority inventory; detailed M3--M4 and A1--A6 boundaries, owners, dependency gates, negative cases, and delivery proof; current roadmap status.
- Validation: Prettier on changed Markdown, `pnpm docs:check`, `pnpm references:check`, and `git diff --check` passed.
- Commit status: ready to commit as `docs(agent): detail takeover delivery slices` on `codex/agent-project-lifecycle`.

## 2026-08-13 - Remove compatibility re-export layers

- Changed areas: removed two editor wiring shims and five render-svg wrapper or wrapper-test modules; redirected imports to Edit Engine, Derived, and model.
- Validation: removed-path reference audit; 67 focused tests; workspace typecheck; production build; full formatting check; and `git diff --check` passed.
- Commit status: prepared as `refactor: remove compatibility re-exports` on `codex/ci-contract-cleanup`.

## 2026-08-13 - Retire legacy annotation edit protocol

- Changed areas: Edit Engine schema/runtime, Agent capability and generated API artifacts, editor/routing/recipe callers, fixtures, tests, and normative protocol documentation.
- Validation: 68 focused cross-package tests plus 19 focused Edit Engine tests; Agent API artifact check; typecheck; production build; formatting; `git diff --check`; and absence audit outside explicit negative te…
- Commit status: prepared as `refactor(api): retire legacy annotation edits` on `codex/ci-contract-cleanup`.

## 2026-08-13 - Scope CI by changed surface

- Changed areas: CI change classifier and conditional lightweight/full paths for static, unit, release, and both browser-shard checks.
- Validation: workflow Prettier parse/check, pull-request and push path-policy review, and `git diff --check` passed.
- Commit status: prepared as `ci: skip heavy gates for documentation-only changes` on `codex/ci-contract-cleanup`.

## 2026-08-13 - Expand routine plan record pruning

- Changed areas: deleted 20 independently reconstructible UI, shortcut, symbol-calibration, visual-fixture, and typecheck plan bodies; condensed the archive index; clarified the evidence-and-decision-value retention rule.
- Validation: protected-record presence and 20-file deletion count confirmed; `git diff --check` passed and final worktree review contains only this target's planned documentation updates.
- Commit status: prepared as `docs(plan): expand routine record pruning` on `codex/plan-lifecycle-hygiene`.

## 2026-08-13 - Move planner and Route geometry ownership

- Changed areas: transaction-wide explicit Route authority; group-move edit planner; connected-component internal selection; movement contracts and focused regressions.
- Validation: 36 routing/stretch tests, 5 clipboard/marker consumer tests, and all 620 unit tests; final clean `pnpm ci:check` including 92 browser tests and every release gate; `git diff --check` clean.
- Commit status: implementation commit `0af19d1` on `codex/wire-move-consistency`; final validation recorded before push.

## 2026-08-13 - Wire session and snap consistency

- Changed areas: editor interaction state; point-snap result contract; Wire canvas integration; interaction specification; unit and browser regressions.
- Validation: 15 focused unit tests; workspace typecheck and build; focused Playwright regression plus four transaction/status scenarios. The initial full-gate run exposed and drove removal of an effect-ordering r…
- Commit status: implementation commits `6aa57cd` and `34b4ad3` on `codex/wire-move-consistency`; final validation recorded before push.

## 2026-08-12 - Drawn VDD rail mainline delivery

- Changed areas: corrected capacitor rotated-label geometry expectation and delivery target record.
- Validation: frozen install and full `pnpm ci:check` passed: 615 unit tests, release/performance/export/PWA/release smoke, and 91 browser tests.
- Commit status: PR #19 merged as `8bd0670` after five required GitHub Actions checks passed; remote `main` verified at that merge commit.

## 2026-08-12 - Capacitor plate contraction

- Changed areas: capacitor Symbol DSL and regenerated catalog.
- Validation: Razavi catalog generation/check; Symbols build; `git diff --check`.
- Commit status: ready on `codex/vdd-drawn-rail` as `fix(symbols): contract capacitor plates`.

## 2026-08-12 - Capacitor plate length extension

- Changed areas: capacitor Symbol DSL and regenerated catalog.
- Validation: Razavi catalog generation/check; Symbols build; `git diff --check`.
- Commit status: ready on `codex/vdd-drawn-rail` as `fix(symbols): extend capacitor plates`.

## 2026-08-12 - Capacitor user refinement

- Changed areas: capacitor Symbol DSL and regenerated catalog; target record.
- Validation: Razavi catalog generation/check; Symbols build; `git diff --check`.
- Commit status: ready to commit on `codex/vdd-drawn-rail` as `fix(symbols): expand capacitor plates and spacing`.

## 2026-08-12 - Capacitor calibration integration

- Changed areas: cherry-picked calibrated capacitor asset and catalog with its original target record; integration target record.
- Validation: symbol catalog check; Symbols build; capacitor vertical/horizontal fidelity (`0.6438` / `0.7247` IoU, zero registration lift); `git diff --check`.
- Commit status: calibration cherry-pick `83d8668`; integration record ready to commit and push on `codex/vdd-drawn-rail`.

## 2026-08-12 - Drawn VDD rail correction

- Changed areas: VDD rail construction proposal; component-placement flow and preview; route-tap presentation inheritance; rail style token; interaction specification and browser regression; superseded prior VDD target record.
- Validation: 59 focused unit tests; workspace typecheck; Agent-artifact and symbol-catalog checks; editor production build; focused Playwright flow; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/vdd-drawn-rail` as `fix(editor): construct VDD as a drawn power rail`.

## 2026-08-12 - Editable Razavi VDD power rail

- Changed areas: shared Route presentation schema and Agent artifacts; transaction validation and wire proposal; VDD wire preview; formal SVG; contracts and focused regressions.
- Validation: 70 focused unit tests; workspace typecheck; Agent-artifact and Razavi-symbol generator checks; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/vdd-power-rail` as `feat(editor): add editable Razavi VDD power rails`.

## 2026-08-12 - Restore local editor UI on current main

- Changed areas: editor shell structure and visual scale, responsive Library/Properties layout, tool icons, and focused unit/browser contracts.
- Validation: App/ShapesPanel unit tests 14/14; focused editor Playwright 89/89 with viewport cases repeated; workspace typecheck; editor dependency-closure production build; Prettier; and `git diff --check` passe…
- Commit status: ready to commit on `fix/restore-local-editor-ui` as `fix(editor): restore local chrome on current main`; full canonical and remote delivery gates remain required before merge to `main`.

## 2026-08-12 - Net deletion selection closure

- Changed areas: model-bound visual-selection pruning, Label delete cleanup, focused unit/browser regressions, and target audit record.
- Validation: 3 focused selection unit tests; 2 Net Label browser flows; workspace typecheck; `git diff --check`.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as `fix(editor): reconcile selection after Net deletion`.

## 2026-08-12 - Reliable imported Net-label deletion

- Changed areas: Route label lookup/actions, explicit annotation deletion action, and focused browser regression coverage.
- Validation: `corepack pnpm exec playwright test apps/editor/e2e/manual-editor.spec.ts --grep "Net Label"` (2 passed), `corepack pnpm typecheck`, and `git diff --check` passed.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as `fix(editor): delete imported Net labels reliably`.

## 2026-08-12 - Move Construction Line to K

- Changed areas: editor shortcut resolver/regression, Draw menu, Help, interaction contract, and drafting command-menu E2E references.
- Validation: shortcut unit tests (10), drafting E2E suite (25), production editor build, obsolete-label search, and `git diff --check` passed.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as `fix(editor): reserve P for future port insertion`. This file records factual, accepted project maintenance history. Use concise entries: ``…

## YYYY-MM-DD - Target title

- Target: what the work set out to do.
- Changed areas: files, directories, or subsystems changed.
- Validation: commands or review performed.
- Commit status: committed, ready to commit, not committed, or blocked.

```

Keep reusable lessons in `docs/experience/`, not in this log.

## 2026-08-12 - Align Analytics Dashboard with Analog Arena

- Changed areas: analytics component and styles, theme preload, matching mono font dependency, Arena-compatible reset isolation, and focused browser regression coverage.
- Validation: frozen install, static/unit/release gates, focused analytics Playwright, and all five GitHub Actions PR checks passed. Local full E2E was 72/74 with two pre-existing unrelated drafting rich-text asse…
- Commit status: initial implementation merged through PR #11; post-deployment reset-alignment follow-up ready for review.

## 2026-08-12 - Bound transient canvas state and runtime caches

- Changed areas: unified transient canvas cleanup, bounded Document undo/redo history, build-versioned Service Worker static cache, and focused unit/E2E coverage; documented the resulting interaction and history contracts.
- Validation: focused canvas/history Vitest 11/11, Smart Snap Escape Playwright scenario, editor production build, workspace typecheck, targeted Prettier, and `git diff --check` passed. Repository-wide format chec…
- Commit status: committed on `codex/cell-symbol-layout` as
  `refine(hierarchy): prioritize Cell pin editing`.

## 2026-08-10 - Measured Razavi capacitor refinement

- Changed areas: capacitor source asset, hash-pinned catalog entry, and generated runtime catalog definition.
- Validation: two-dimensional span/gap sweep chose 0.91 span and 0.745 gap scales; final C1 is `0.6225/0.5619` and C2 is `0.7063/0.5508` binary/soft IoU. Catalog stale check, focused catalog Vitest 17/17, Symbols/…
- Commit status: committed with this target; concurrent drafting work remains unstaged.

## 2026-08-10 - Razavi capacitor proportion refinement

- Changed areas: capacitor source asset, hash-pinned Razavi catalog entry, and generated runtime catalog definition.
- Validation: regenerated catalog; Symbols build; C1 vertical IoU improved `0.5860 → 0.6174` and C2 horizontal `0.6982 → 0.7019`; catalog stale check, focused catalog Vitest 17/17, editor build, and `git diff --ch…
- Commit status: committed with this target; concurrent drafting work remains unstaged.

## 2026-08-10 - Fixed default side-label clearance

- Changed areas: shared `@icm/render-svg` default label resolver and its focused placement test.
- Validation: focused Vitest passed 5/5; render-svg and editor production builds passed; running Vite editor verification placed a new resistor and confirmed the persisted `instance-label` anchor; `git diff --chec…
- Commit status: committed with this target; concurrent editor drag and CSS work remains unstaged.

## 2026-08-10 - Release GUI interaction batch

- Changed areas: editor selection/shortcuts/drafting interaction and browser tests; drafting schema/derived/render support; text and isolated-wire direct manipulation; interaction specification and target plans.
- Validation: focused browser interaction checks and editor production build passed; `git diff --check` passed. Full workspace format/typecheck/test gates remain red on pre-existing Razavi catalog `leadsPx` type e…
- Commit status: committed locally as `7ae8a2c`; push/PR/merge pending.

## 2026-08-09 - Cadence-style shortcut core

- Changed areas: added the editor-local orientation composition helper and exhaustive geometry test; bound `U`/`Shift+U` to undo/redo, `F`/`Shift+F` to explicit left/right and top/bottom flips, and `Home` to Fit; synchronized the Edit/View labels, in-app s…
- Validation: the focused orientation Vitest test passed (3 tests); editor production build passed; target-file Prettier check and `git diff --check` passed. Workspace `pnpm typecheck` remains blocked by pre-exist…
- Commit status: ready to commit after the user-owned concurrent dirty targets are reconciled; not staged or committed by this target.

## 2026-08-09 - Pages workspace dependency build repair

- Changed areas: Pages workflow now builds the editor dependency closure using pnpm's trailing-ellipsis filter.
- Validation: `pnpm install --frozen-lockfile` and the base-path Pages build passed after model, symbols, derived, SPICE, edit-engine, render-svg, exporters, and editor packages built in dependency order; `git dif…
- Commit status: ready to commit, merge, and rerun Pages.

## 2026-08-09 - GitHub Pages release preparation

- Changed areas: added a least-privilege Pages workflow and user-facing release/data-boundary documentation.
- Validation: the editor production build passed with `ICM_PAGE_BASE_PATH=interactive-circuit-maker`; built asset paths use that prefix and the manifest remains relative scoped. Focused source audit found no Agent…
- Commit status: ready to commit; repository Pages must be enabled by an administrator once before the first `main` deployment.

## 2026-08-09 - First-version local-first editor baseline

- Changed areas: staged completed editor interaction, drafting/routing, browser-persistence foundation, Pages/PWA base-path, documentation, and target-plan work; added narrow ignore rules for local diagnostic and generated layout outputs without deleting t…
- Validation: focused platform-web, edit-engine, derived, and render Vitest tests passed (50 tests); platform-web and editor production builds passed; `git diff --check` passed. Workspace `pnpm typecheck` remains…
- Commit status: ready to commit as one first-version baseline, then reconcile the patch-equivalent remote hierarchy commit.

## 2026-08-09 - Drafting edit paradigm: two-phase creation, hit layer, rotation

- Changed areas: - `packages/derived/src/drafting-geometry.ts` — arrow gained `center` (from/to midpoint); construction-line gained `vertices` (editable handle set). ResolvedDraftingGeometry union + resolvers updated. - `packages/model/src/drafting-geometr…
- Validation: static verification done in-session — App.tsx parens 2148/2148, braces 1299/1299; drafting.spec.ts 340/340, 74/74; CSS braces 122/122; geometry schema double-sync confirmed (center + vertices in both…
- Commit status: ready to commit as `feat(editor): drafting two-phase creation, hit layer, and rotation` once the blocked toolchain validation passes. Stage only the 6 drafting files; do not touch the parallel App.te…

## 2026-08-09 - Drafting edit paradigm completion: stages 3-6

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: static — App.tsx parens 2354/2354, braces 1446/1446; drafting.spec.ts 411/411, 96/96; `git diff --check` clean; geometry schema double-sync intact. Toolchain (build/typecheck/vitest/e2e) blocked in t…
- Commit status: ready to commit alongside the prior drafting entry as `feat(editor): drafting handle editing, bounded styles, route marker` once the blocked toolchain validation passes.

## 2026-08-09 - GUI modernization: inspector moved into left dock

- Changed areas: - `apps/editor/src/App.tsx` — replaced `propertiesCollapsed` state with `dockTab`; replaced `propertiesVisible` with `hasInspectableSelection`; added a `useEffect` that switches the dock tab on selection change; root `<main>` className fix…
- Validation: static verification done in-session — aside/div/section/fieldset balanced (perl/awk), parens 1952/1952, braces 1182/1182, CSS braces 104/104, `git diff --check` clean, no stale `side-panel`/`properti…
- Commit status: superseded before commit by the later fixed-library decision; its auto-switch interaction did not land.

## 2026-08-09 - GUI modernization: fixed library with Selection shelf

- Changed areas: `App.tsx` removes dock tab state/effect and uses native `details/summary` for the shelf; `styles.css` makes the dock a fixed flex column with separate library and shelf scroll regions; editor interaction specification records the explicit-…
- Validation: editor build passed; scheduler Vitest 9/9 passed; focused Playwright 3/3 passed (MOS presentation, junction deletion, fixed library); Prettier and `git diff --check` passed. Browser visual verificati…
- Commit status: pending intentional scoped commit; unrelated generated assets, Razavi-fidelity work, and other plans remain unstaged.

## 2026-08-09 - GUI modernization: chrome tokens and recovery scheduling

- Changed areas: - `apps/editor/src/styles.css` — added `:root` `--icm-*` chrome tokens; replaced 13 hardcoded `#1f6feb` and scattered panel/border/diagnostic colors with tokens. `.schematic-canvas { background:#fff }` left literal. - `apps/editor/src/reco…
- Validation: static verification preserved the white canvas literal, grid-dot, and formal body boundary. Actual checks passed: recovery scheduler Vitest 9/9; recovery Playwright scenarios 3/3 (coalesced restore,…
- Commit status: target validation complete; pending an intentional, scoped commit. Unrelated concurrent Razavi-fidelity changes remain unstaged.

## 2026-08-08 - Calibrate Razavi geometry from supplied reference pixels

- Changed areas: new `scripts/measure-razavi-reference.py`; MOS and independent-current generators with regenerated catalog/fidelity assets; Razavi route-marker token and focused catalog/style tests; Phase 1/5 and route-marker SVG goldens.
- Validation: measurement script, 31 focused symbol/render tests, all three symbol generator checks, route-marker golden check, Phase 1/5 golden check, render-svg dependency build, and `git diff --check` passed.
- Commit status: pending.

## 2026-08-08 - Apply second-pass Razavi arrowhead scaling

- Changed areas: the two generator sources; regenerated Razavi MOS/current source assets, catalog, and fidelity boards; exact geometry regression test.
- Validation: MOS/core-analog/Razavi generator checks and 20 focused symbol tests passed; `git diff --check` passed.
- Commit status: pending.

## 2026-08-08 - Calibrate MOS and independent-current-source arrowheads

- Changed areas: generator-owned Razavi MOS/current-source assets and catalog output (committed concurrently in `16ed903`), plus the exact catalog regression assertion.
- Validation: MOS, core-analog, and Razavi generator checks passed; focused symbols tests passed (20/20); `git diff --check` passed.
- Commit status: pending the standalone regression/plan record commit.

## 2026-08-06 - Bootstrap repository workflow

- Changed areas: added project documentation, repository-wide Agent rules, plan and experience templates, Git attributes, and the initial project assets under `lib/` and `netlists/`.
- Validation: `git diff --check` passed; every SPICE `.subckt` had a matching `.ends`; every local `.include` resolved; required workflow sections were confirmed; repository scope and status were reviewed.
- Commit status: ready to commit as `Initialize circuit project workflow` and push to the private `chenzc24/interactive-circuit-maker` repository.

## 2026-08-06 - Document overall circuit canvas architecture

- Changed areas: added `docs/overall-product-plan.md` and its bounded target plan under `plan/archived/2026-08/2026-08-06-document-overall-product-plan/`.
- Validation: confirmed balanced Markdown fences and required architecture contracts; reviewed headings and terminology; `git diff --check` passed.
- Commit status: ready to commit as `Document overall circuit canvas architecture`.

## 2026-08-07 - Define the default schematic graphical language

- Changed areas: expanded `docs/overall-product-plan.md` and added the bounded target plan under `plan/2026-08-07-refine-default-schematic-style/`.
- Validation: confirmed balanced Markdown fences and numbered headings; verified theme, route, junction, annotation, overlay/export, renderer, visual-regression, phase, and MVP contracts; `git diff --check` passed.
- Commit status: ready to commit as `Define default schematic graphical language`.

## 2026-08-07 - Flatten overall circuit canvas architecture

- Changed areas: rewrote `docs/overall-product-plan.md` around a five-component external model, Project-to-Document persistence, seven protocol operations, GUI-driven human edits, transient parser artifacts, and a minimal user project layout; added the bou…
- Validation: confirmed balanced Markdown fences and required full-SPICE, junction/crossing, VSS isolation, GUI/Edit Engine, protocol, file-layout, visual-language, validation, and MVP contracts; `git diff --check…
- Commit status: ready to commit as `Flatten overall circuit canvas architecture`.

## 2026-08-07 - Establish phased execution documentation

- Changed areas: added `docs/README.md`; added roadmap index, phase template, and substantive Phase 0–7 plans; added specification, Agent, and ADR indexes and templates; updated the repository README; added the bounded target plan under `plan/archived/2026…
- Validation: confirmed all eight phase files contain every required planning section; all relative Markdown links resolve; all Markdown fences are balanced; no application source scaffold was created; `git diff -…
- Commit status: ready to commit as `Establish phased execution documentation`.

## 2026-08-07 - Complete Phase 0 contracts and scaffold

- Changed areas: added the React editor shell; model, edit-engine, spice, and symbols packages; Project fixtures; pinned Reference manifest and scripts; focused CI; accepted Phase 0 specs and ADRs; and Phase 0 completion evidence.
- Validation: frozen install, formatting, immutable Reference checks, TypeScript typecheck, 30 tests in eight files, workspace build, direct ESM runtime smoke, Reference fetch failure/idempotence checks, Markdown…
- Commit status: ready to commit as `Complete Phase 0 contracts and scaffold`.

## 2026-08-07 - Complete Phase 1 core editor slice

- Changed areas: expanded the Edit Engine and added Document history; added eight provisional built-in symbols and `packages/render-svg`; replaced the editor shell with a native-SVG canvas and controls; added Project/SVG fixtures, visual/edit specification…
- Validation: frozen install, formatting, immutable Reference checks, TypeScript typecheck, 41 tests in 11 files, workspace build, one complete Playwright GUI flow, browser DOM/geometry/console review, Markdown li…
- Commit status: ready to commit as `Complete Phase 1 core editor slice`.

## 2026-08-07 - Complete Phase 2 SPICE import

- Changed areas: added source, syntax, include, diagnostic, compiler, Node adapter, and importer modules under `packages/spice`; added dynamic pin-count-matched generic symbols; connected browser multi-file import; added source, Project, and seven-entry co…
- Validation: frozen install, formatting, immutable Reference checks, TypeScript typecheck, 49 tests in 15 files, all seven entries/24 cells/127 instances against connectivity hashes, canonical imported Project go…
- Commit status: ready to commit as `Complete Phase 2 SPICE import`.

## 2026-08-07 - Complete Phase 3 connectivity and routing

- Changed areas: added `packages/derived`; extended the model, Edit Engine, history, renderer, and editor; added routing specifications, canonical Project/SVG fixtures, unit/integration tests, and Playwright acceptance.
- Validation: frozen install, formatting, immutable Reference checks, TypeScript typecheck, 61 tests in 17 files, workspace build, three complete Playwright flows, browser DOM and visual inspection, Markdown link/…
- Commit status: ready to commit as `Complete Phase 3 connectivity and routing`.

## 2026-08-07 - Complete Phase 4 full SPICE baseline

- Changed areas: accepted ADR 0004; expanded syntax, source dependency, expression, dialect, compiler, IR, importer, and exact-printer modules; added a machine-readable ngspice 46 matrix and minimized baseline/vendor corpus.
- Validation: frozen install, formatting, immutable Reference checks, TypeScript typecheck, 67 tests in 18 files including 256 deterministic fuzz samples and all current netlists, workspace build, four Playwright…
- Commit status: ready to commit as `Complete Phase 4 full SPICE baseline`.

## 2026-08-07 - Complete Phase 5 symbols and visual quality

- Changed areas: added VSS inventory/review tools and evidence; expanded the symbol library, SPICE symbol mapping, model validation, Edit Engine, diagnostics, SVG renderer, editor demo, and visual fixtures/specifications.
- Validation: source hash and 101-master inventory, 12-family contact sheet, frozen formatting/type/test/build gates, 73 tests in 20 files, five Playwright flows, browser DOM and visual inspection, deterministic d…
- Commit status: ready to commit as `Complete Phase 5 symbols and visual quality`.

## 2026-08-07 - Complete Phase 6 Agent API

- Changed areas: accepted ADR 0005 and the Agent API spec; added the `agent-adapter` package, query describer, permission/budget enforcement, Edit Engine transaction bridge, render artifacts, authenticated loopback adapter, checked JSON Schema/OpenAPI arti…
- Validation: frozen install, formatting, immutable references, typecheck, 80 tests in 22 files including direct-engine parity and live loopback HTTP, workspace build, deterministic API/symbol/visual artifact chec…
- Commit status: ready to commit as `Complete Phase 6 Agent API`.

## 2026-08-07 - Complete Phase 7 release hardening

- Changed areas: added formal exporters and cross-format goldens; text-aware render bounds; Node atomic storage and recovery; canonical browser open/save, recovery and diagnostics UI; LTspice/Xyce profiles; performance budgets; PWA assets; loopback host; r…
- Validation: frozen install, formatting, four pinned references, three Agent API artifacts, 12 symbol previews, Phase 5/7 visual goldens, PDF metadata and rendered-page inspection, TypeScript, 89 tests in 26 file…
- Commit status: ready to commit as `Complete Phase 7 release hardening`.

## 2026-08-07 - Plan Phase 8 interaction redesign

- Changed areas: added a proposed editor interaction contract and a dependency- ordered Phase 8 roadmap; indexed both documents and recorded the bounded planning target.
- Validation: Prettier check passed for all six changed Markdown files; local Markdown links resolved, fenced code blocks balanced, and `git diff --check` passed.
- Commit status: ready to commit as `Plan Phase 8 interaction redesign`.

## 2026-08-07 - Complete Phase 8 direct manipulation

- Changed areas: added instance/connectivity Edit Engine operations and Agent schemas; atomic group stretch; an empty production workspace; searchable component placement; direct selection, movement, wiring, automatic Junction/Crossing behavior, dogleg man…
- Validation: frozen install, formatting, four pinned references, TypeScript, 96 tests in 28 files, workspace build, three Agent API artifacts, 12 reviewed symbol previews, Phase 5/7 goldens, PWA icons, performanc…
- Commit status: ready to commit as `Complete Phase 8 direct manipulation`.

## 2026-08-07 - Close schematic authoring fidelity gaps

- Changed areas: normalized reviewed MOS and VDD geometry; added 13 explicitly provisional VSS migration candidates and 27 palette previews; added atomic routed-subgraph copy/paste, typed Junction movement and Net naming, editable instance/Net/plain text,…
- Validation: formatting, four pinned references, TypeScript, 101 tests in 29 files, 10 Playwright flows, three Agent artifacts, 12 reviewed plus 13 candidate symbol previews, Phase 1/5/7 visual/export goldens, vi…
- Commit status: ready to commit as `Close schematic authoring fidelity gaps`.

## 2026-08-07 - Prevent stale PWA cache in development

- Changed areas: development startup now unregisters stale service workers and reloads once when necessary; production registration is unchanged.
- Validation: TypeScript, workspace build, 10 Playwright flows, formatting, and `git diff --check` passed.
- Commit status: ready to commit as `Prevent stale PWA cache in development`.

## 2026-08-07 - Expand direct wire editing

- Changed areas: added transient multi-bend Wire sessions and free Junction endpoints; selectable perpendicular Route-segment stretch; composed connected-instance deletion that preserves dangling wires; additive `add_junction.createNet` engine/Agent schema…
- Validation: formatting, four pinned references, three Agent artifacts, TypeScript, 105 tests in 31 files, 12 Playwright flows, workspace/release build, performance budgets, export goldens, PWA icons, release smo…
- Commit status: ready to commit as `Expand direct wire editing`.

## 2026-08-07 - Record rule-guided Agent layout architecture

- Changed areas: added a proposed Agent architecture document covering the PDK symbol registry, transient Topology View and Layout Intent, composable topology patterns, recursive region planning, Net-class routing, flat API additions, Document navigation,…
- Validation: Prettier completed for the four owned Markdown files, local Markdown links resolved, fenced code blocks balanced, and `git diff --check` passed.
- Commit status: not committed; retained as a proposed discussion record for further human review.

## 2026-08-07 - Flatten Agent reasoning and prepare Phase 9

- Changed areas: replaced the formal Layout Intent/compiler proposal with an adaptive Snapshot-driven Agent workflow; removed the proposed generic query language; reduced Agent-facing guidance to a governing Skill plus on-demand knowledge; documented large…
- Validation: Prettier completed for all seven owned Markdown files; local links resolved, fenced code blocks balanced, `git diff --check` passed, and the final dirty-state review confirmed unrelated editor, symbo…
- Commit status: not committed; ready for human review before Phase 9 contract work begins.

## 2026-08-07 - Complete CDAC hierarchy layout

- Changed areas: extended the deterministic Agent-layout runner to transact on and optionally export multiple imported Documents; added a transistor-level two-stage CMOS bottom-plate driver with conventional stacked inverter geometry and local source/bulk…
- Validation: the real SPICE import, typed dry-run/commit, Project validation, and formal export chain completed in six transactions; both Documents report zero unplaced instances; top-level and unit PNGs were vis…
- Commit status: not committed; retained in the ongoing CDAC/Agent-layout working set.

## 2026-08-07 - Render faithful hierarchical ports

- Changed areas: bound subcircuit import now assigns stable hierarchy symbol IDs and formal terminal names; the symbol package derives named blocks from Document source bindings and ports; SVG rendering displays upright pin names; editor and Agent layout u…
- Validation: formatting and TypeScript passed; workspace build passed; 110 unit tests passed; 13 unaffected Playwright flows passed in the full run and the one updated SPICE-import flow passed on focused rerun; C…
- Commit status: not committed; retained for review with the ongoing editor, symbol, and CDAC changes.

## 2026-08-07 - Prototype flattened CDAC view

- Changed areas: added a standalone flattened CDAC recipe that retains a cloned hierarchical source Document, derives 24 prefixed MOS instances into the selected top Document, maps every child formal-port Net back to its parent Net, lays out six repeated t…
- Validation: SPICE import, six typed transactions, Project validation, and formal export passed; the flattened top has 32 placed instances, 24 expanded unit MOS devices, 141 routes, 64 Junctions, no XU block inst…
- Commit status: not committed; retained as an alternate visual prototype for comparison with the hierarchical CDAC output.

## 2026-08-07 - Keep MOS arrow in three-terminal variant

- Changed areas: separated the `mos-arrow` primitive from the hideable `bulk-lead`, prevented dedicated `nmos3`/`pmos3` symbols from inheriting a duplicate arrow, added focused regression assertions, and regenerated the flattened CDAC artifacts. Electrical…
- Validation: the seven focused built-in-symbol tests passed; the symbol package built; the flattened recipe completed import, six typed transactions, Project validation, and formal export; the PNG was visually in…
- Commit status: not committed; retained with the current CDAC prototype for user review.

## 2026-08-07 - Use migrated MOS variant geometry

- Changed areas: restored the reviewed NMOS4/PMOS4 default bulk-arrow geometry; extended visual variants with presentation-only additional primitives; made `textbook-3terminal` hide the bulk lead and reuse the `nmos3` source arrow plus the orientation-norm…
- Validation: 126 workspace tests passed; workspace typecheck and build passed; the 12 reviewed and 13 migration-candidate symbol previews passed their deterministic review check; both Phase 1/5 circuit goldens pa…
- Commit status: not committed; retained with the current CDAC prototype for user review.

## 2026-08-07 - Local-power textbook CDAC layout

- Changed areas: added six local VDD/ground helper pairs plus dedicated grounds for the dummy capacitor and reset device; bound all helpers to the existing VDD/VSS Nets; removed the page-spanning VDD/VSS routes; stacked each PMOS over its NMOS; separated i…
- Validation: SPICE import, five typed transactions, Project validation, and formal export passed; the top has 46 placed instances including 14 resolved local-power helpers, 127 routes, and 50 Junctions. All helpe…
- Commit status: not committed; retained as the current visual prototype for user review.

## 2026-08-07 - Implement Snapshot-driven Agent workflow

- Changed areas: accepted Agent API v2/Snapshot ADR and schemas; added deterministic Project Index and complete bidirectional Document Snapshot; retained v1 query only for compatibility; added SKY130 and exact PDK symbol mappings, atomic symbol remap and p…
- Validation: formatting and typecheck passed; 127 tests in 33 files and all 14 Playwright flows passed; three Agent API artifacts, Snapshot/audit/replay, Skill package/links/ownership, PDK/import, Phase 1/5/7 vis…
- Commit status: not committed; working tree retains the preceding coordinated editor, symbol, hierarchy, RLC/CDAC, and plan changes.

## 2026-08-07 - Checkpoint integrated development

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: `pnpm format:check`, `pnpm references:check`, `pnpm typecheck`, 127 unit tests in 33 files, workspace build, symbol review, Phase 5 visual, Phase 7 export, Agent API artifact, every Phase 9 determini…
- Commit status: prepared for the integrated checkpoint commit; push status is recorded by Git history and the final target handoff.

## 2026-08-07 - Define Razavi textbook visual convergence

- Changed areas: proposed `razavi-textbook-v1` specification, specification index, and target plan. The contract separates fixed assets into component, typography, and stroke/node layers while keeping routing/layout outside the style asset boundary.
- Validation: Markdown metadata/section inspection, specification index review, fenced-code balance, and `git diff --check`.
- Commit status: prepared for a dedicated normative-document commit; runtime implementation has not begun.

## 2026-08-07 - Complete Razavi RV-1 VSS decoder proof

- Changed areas: added a versioned VSS Master IR extractor, deterministic checker, checked five-target fixture plus the `TEXT` coverage-only Master, import-tool documentation, and factual RV-1 specification clarification.
- Validation: deterministic re-extraction matched fixture SHA-256 `826c2ba82532de17686dae61ac1bd6c93fbe4b946d2bb60797ad726b23a94170`; focused feature assertions, formatting, typecheck, 127 unit tests in 33 files,…
- Commit status: ready for the dedicated RV-1 commit.

## 2026-08-07 - Establish Razavi RV-2 catalog boundary

- Changed areas: added `razavi-symbols@1` catalog/assets, a deterministic generated TypeScript adapter, runtime catalog API, generator/check command, focused tests, asset-directory documentation, and compatibility lookups in the existing built-in library.
- Validation: catalog check, 12 focused tests, 132 full tests in 34 files, typecheck, build, formatting, 25 symbol previews, Phase 1/5 visual goldens, and `git diff --check` passed.
- Commit status: ready for the dedicated RV-2 commit.

## 2026-08-07 - Add Razavi RV-3 semantic stroke profile

- Changed areas: Symbol DSL semantic stroke role, first catalog asset role migration and regenerated hashes/adapter, renderer profile registry and profile-aware formal scene, symbol-review compatibility, tests, and visual contract documentation.
- Validation: 24 focused tests, 137 full tests in 35 files, typecheck, build, formatting, catalog check, 25 symbol previews, Phase 1/5 visual goldens, Phase 7 export goldens, and `git diff --check` passed.
- Commit status: ready for the dedicated RV-3 commit.

## 2026-08-07 - Add Razavi RV-4 schematic typography

- Changed areas: profile typography tokens, schematic-text parser/composer, renderer text consumers, parser/renderer tests, and visual-language/style specifications.
- Validation: 23 focused tests, 149 full tests in 36 files, typecheck, build, formatting, Phase 1/5 visual goldens, Phase 7 export goldens, and `git diff --check` passed.
- Commit status: ready for the dedicated RV-4 commit.

## 2026-08-07 - Add Razavi RV-5 semantic nodes and annotations

- Changed areas: node/annotation profile tokens, formal renderer, truth-table renderer tests, and visual-language/style specifications.
- Validation: 12 focused tests, 150 full tests in 36 files, typecheck, build, formatting, Phase 1/5 visual goldens, Phase 7 export goldens, and `git diff --check` passed.
- Commit status: ready for the dedicated RV-5 commit.

## 2026-08-07 - Capture Razavi RV-6A core analog VSS evidence

- Changed areas: dedicated 27-Master VssMasterIR fixture, deterministic re-extraction checker, VSS tool documentation, and source/style contracts.
- Validation: deterministic RV-6 re-extraction, unchanged RV-1 checker, 150 tests in 36 files, typecheck, formatting, and `git diff --check` passed.
- Commit status: ready for the dedicated RV-6A commit.

## 2026-08-07 - Preserve implicit MOS bulk semantics

- Changed areas: shared endpoint visibility, visible connectivity/flightline derivation, editor connectable endpoints, MOS regression tests, Razavi text suffix composition, OTA layout recipe, and connectivity/Symbol DSL contracts.
- Validation: 17 focused tests, 151 full tests in 36 files, recipe import, typecheck, build, formatting, Phase 1/5 visual goldens, Phase 7 export goldens, visual PNG inspection, and `git diff --check` passed.
- Commit status: ready for the dedicated correctness commit.

## 2026-08-07 - Migrate reviewed analog assets to the Razavi catalog

- Changed areas: nine new normalized Symbol DSL assets, 13-entry catalog and generated adapter, built-in compatibility registry, evidence/review-manifest validation, focused catalog tests, and Razavi style documentation.
- Validation: catalog generation/check, 12-reviewed/13-candidate preview check, 14 focused tests, 152 full tests in 36 files, typecheck, build, formatting, Phase 1/5 visual goldens, Phase 7 export goldens, and `gi…
- Commit status: ready for the dedicated RV-6B commit.

## 2026-08-07 - Generate a headless two-stage CMOS buffer example

- Changed areas: one deterministic typed-edit recipe and its editable Project, SVG, PNG, and PDF outputs under `netlists/mixed-device-acceptance/`.
- Validation: headless generation, canonical Project round-trip, topology and bulk assertions, PNG inspection, `git diff --check`, and worktree audit.
- Commit status: ready for the dedicated fixture commit.

## 2026-08-07 - Generate a headless SKY130 divide-by-two schematic

- Changed areas: one deterministic typed-edit recipe, Project/SVG/PNG/PDF outputs, and an opt-in hierarchical implicit-supply symbol variant with focused tests.
- Validation: 2 focused hierarchical-symbol tests, symbols build, headless generation, canonical/topology/visibility assertions, PNG inspection, and repository whitespace/status checks.
- Commit status: ready for the dedicated divider fixture commit.

## 2026-08-07 - Refine and flatten the SKY130 divide-by-two

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: recursive-flatten assertions, six focused derived tests, derived package build, both headless generation recipes, canonical/topology/bulk checks, visual inspection of both PNGs, and repository whites…
- Commit status: ready for the dedicated refined/flat divider commit.

## 2026-08-07 - Generate MOS artwork from Visio evidence

- Changed areas: four normalized Visio reference SVGs, Master-IR MOS generator, four generated catalog assets, generated adapter, built-in resolver, finite-decimal/fill-only Symbol DSL support, exact Razavi stroke roles, comparison/contact sheets, fixture…
- Validation: deterministic four-reference Visio COM check, MOS/catalog/review regeneration checks, 155 tests in 37 files, typecheck, build, Phase 1/5 visual checks, Phase 7 export checks, PNG inspection, formatti…
- Commit status: ready for `feat(symbols): generate MOS artwork from Visio evidence`.

## 2026-08-07 - Expose Razavi fixed-style hard canon to Skill manifest

- Changed areas: added `docs/agent/knowledge/razavi-style-canon.md`; added one manifest row in `skills/circuit-layout/references/manifest.md`; added the fixed-style category to the `docs/agent/README.md` knowledge enumeration.
- Validation: Markdown link resolution from the new doc and manifest row to every referenced target, fenced-code balance, `git diff --check`, and `git status --short --branch` passed. No typecheck/test/build run b…
- Commit status: ready for `docs(agent): expose Razavi fixed-style hard canon to Skill manifest`.

## 2026-08-07 - Editor text resize, default-label visibility, and annotation hit fix

- Changed areas: added `labelVisibility: shown|hidden` to `SymbolDefinition` (optional, default shown); marked `powerPortSymbol("vdd"|"vss")` and the Razavi `ground` catalog asset `labelVisibility: "hidden"`; renderer skips the default instance label for h…
- Validation: typecheck, workspace build, Phase 5 visual check, Phase 7 export check, two new focused render tests (label-hidden symbol, plain-text sizeScale), formatting, and `git diff --check` passed.
- Commit status: ready for `feat(editor): add text resize, default-label visibility, and annotation hit fix`.

## 2026-08-07 - Bound agent-routing expander to Agent-local, non-rerouting scope

- Changed areas: added `docs/adr/0008-agent-local-route-tree-expander.md`; listed it in `docs/adr/README.md`.
- Validation: Markdown link resolution to 0007, agent-api.md, connectivity-and-routing.md, rule-guided-layout-architecture.md, razavi-style-canon.md, and the Skill manifest; fenced-code balance; `git diff --check`…
- Commit status: ready for `docs(adr): bound agent-routing expander to Agent-local, non-rerouting scope`.

## 2026-08-07 - Localize transact failures and return resolved Route geometry

- Changed areas: `packages/edit-engine/src/transaction.ts` (EditDiagnostic gains optional objectIds/parameters; rejectTransaction gains optional path/objectIds; the apply loop is indexed with a rejectAt closure binding `["edits", index]`; in-loop rejection…
- Validation: full workspace `pnpm typecheck`, `prettier --check`, 47 tests in 8 files (agent-adapter + edit-engine), `agent-api:artifacts:check`, and `git diff --check` passed.
- Commit status: ready for `feat(agent-api): localize transact failures and return resolved Route geometry`.

## 2026-08-07 - Add Agent-local route-tree expander and shape dictionary

- Changed areas: new `packages/agent-routing` package (`types.ts`, `expand.ts`, `index.ts`) with `expandRouteTree` and per-shape expanders for direct / local-branch-tree / shared-trunk / labeled-islands / ordered-bus; thin Skill caller `skills/circuit-layo…
- Validation: full workspace `pnpm typecheck`, `prettier --check`, 8 tests, and `git diff --check` passed.
- Commit status: ready for `feat(agent-routing): add Agent-local route-tree expander and shape dictionary`.

## 2026-08-07 - Add read-only routing-quality metrics

- Changed areas: `packages/derived/src/visual.ts` (new `pushRoutingQualityMetrics` with VISUAL_WIRE_THROUGH_SYMBOL, VISUAL_ROUTE_OVERLAP, VISUAL_TERMINAL_DEPARTURE; segmentIntersectsRect and firstCollinearOverlap helpers), one focused test, and `docs/agent…
- Validation: full workspace `pnpm typecheck`, `prettier --check`, 17 tests in 4 files, and `git diff --check` passed.
- Commit status: ready for `feat(derived): add read-only routing-quality metrics`.

## 2026-08-07 - Stretch connected routes on instance move (ADR 0009)

- Changed areas: ADR 0009 (move stretches, never reroutes; scope move_instance, Junction move deferred); `packages/edit-engine/src/transaction.ts` (applyStretchedRoutes called from move_instance using proposeLocalStretch; protected adjacent segments skippe…
- Validation: full workspace `pnpm typecheck`, `prettier --check`, 72 tests in 13 files, all Phase-9 checks (heldout flash/chopper/ring, skill, generalization, snapshot audit), `agent-api:artifacts:check`, and `gi…
- Commit status: ready for `feat(edit-engine): stretch connected routes on instance move (ADR 0009)`.

## 2026-08-07 - Defer automatic router / obstacle avoidance / auto cleanup

- Changed areas: `plan/2026-08-07-defer-automatic-router/plan.md` only.
- Validation: `git diff --check`. Docs-only.
- Commit status: ready for `docs(plan): defer automatic router per ADR 0008 and Phase 9 evidence`.

## 2026-08-08 - Evaluate the new Agent-routing architecture on a flat CDAC

- Changed areas: additive evaluation script and Project/SVG/PNG/PDF artifacts under `netlists/sky130-switched-capacitor-dac-6bit-pvt/`, plus the bounded target plan. Existing overlapping `agent-scdac-newarch.*` files and the dirty Agent-routing source rema…
- Validation: API `2.0` capabilities and Snapshot `1.0`; six successful dry-run/commit batches; Project validation and formal API render; electrical terminal-count audit; whole-page PNG inspection; target Prettier…
- Commit status: intentionally uncommitted and unpushed because the evaluation depends on a dirty shared Expander and overlapping candidate files have unknown ownership.

## 2026-08-08 - Close the routing closed loop (caller, tap geometry, dry-run, multi-move)

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: full workspace `pnpm typecheck`, `prettier --check`, 60 tests in 10 files (agent-routing, edit-engine, agent-adapter, skill caller CLI), CDAC regeneration, and `git diff --check` passed.
- Commit status: ready for `fix(agent-routing): close the expander loop (caller, tap geometry, dry-run, multi-move)`.

## 2026-08-08 - Demote expander to route-graph geometry helper

- Changed areas: `packages/agent-routing/src/types.ts` (new RouteGraph nodes/edges interface replacing RouteTreeDecision), `expand.ts` (expandRouteGraph resolves node coordinates + projects edges to typed edits; never decides topology, never reroutes), `sh…
- Validation: full workspace `pnpm typecheck`, `prettier --check`, 10 tests, CDAC recipe regenerated, `git diff --check` passed.
- Commit status: ready for `refactor(agent-routing): demote expander to a route-graph geometry helper`.

## 2026-08-08 - Migrate Visio core-analog Batch A to source-derived assets

- Changed areas: 8 razavi-v1 symbol assets (`resistor`, `capacitor`, `inductor`, `diode`, `ground`, `port`, `current-source`, `voltage-source`), `catalog.json` - asset README, regenerated `razavi-catalog.generated.ts`; `schema.ts` (`labelVisibility`), `bui…
- Validation: `symbols:razavi:check` (14 assets + 1 primitive), `symbols:visio-core-analog:check` (8 assets + fidelity board), `pnpm typecheck`, symbol review (12 reviewed + 13 candidate), 26 focused symbols tests…
- Commit status: committed as `7a38734` and pushed to `origin/main` (group 1 of the split sequence). Correction: the agent-routing _package_ was largely committed in `e7e7aa4`..`c70a813`, but one `expand.ts` wire-thr…

## 2026-08-08 - Add netlist-to-schematic pipeline architecture review

- Changed areas: `docs/architecture-and-pipeline-review.md` (new, 306-line non-normative reference covering repository structure, the 12-stage netlist-to-schematic pipeline, and the Agent Razavi-layout gap assessment); one index row in `docs/README.md`.
- Validation: README link resolves to the new doc; fenced-code balance; `git diff --check` passed.
- Commit status: committed as `26ca479` and pushed to `origin/main`.

## 2026-08-08 - Regenerate Agent API circuit schema fixtures

- Changed areas: `fixtures/agent-api/agent-circuit-request.schema.json`, `agent-circuit-response.schema.json`, `agent-circuit.openapi.json` (+918 lines).
- Validation: `agent-api:artifacts:check` (Validated 3 Agent API artifacts); `git diff --check` passed.
- Commit status: committed as `b1de6e4` and pushed to `origin/main`.

## 2026-08-08 - Record OTA redraw plan (group 7, plan-follows-code)

- Changed areas: `plan/archived/2026-08/2026-08-07-redraw-ota-with-repaired-bulk-and-new-symbols/plan.md`.
- Validation: `git diff --check` passed. Docs-only.
- Commit status: committed as `4d738eb` and pushed to `origin/main`.

## 2026-08-08 - Restore atomic flat-CDAC Route-graph generation

- Changed areas: atomic `@icm/agent-routing` conflict behavior; transient bend nodes folded into Route waypoints; opt-in pre-export generator completeness gate; explicit full-topology CDAC Route graphs; regenerated Project, SVG, PNG and PDF artifacts.
- Validation: 14 focused agent-routing tests, package build, workspace typecheck, owned-file Prettier check, deterministic double generation with identical hashes, structural audit, and original-resolution PNG ins…
- Commit status: ready for `fix(agent-routing): restore atomic flat CDAC generation`.

## 2026-08-08 - Clarify flat-CDAC inverter wiring and labels

- Changed areas: flat CDAC placement/Route graphs and regenerated formal Project/SVG/PNG/PDF artifacts.
- Validation: completeness gate, workspace typecheck, deterministic artifact hashes and original-resolution PNG inspection. Presentation-only; no simulation claim.
- Commit status: ready for `fix(cdac): clarify inverter wiring and labels`.

## 2026-08-08 - Route-attached current arrow, annotation editing, and hit fixes (editor layer)

- Changed areas: `apps/editor/src/App.tsx` (Add current arrow command, drag-along-segment, Reverse arrow, clipboard route-reference remap, Text-panel size-scale draft/commit, padded annotation hit bounds), `apps/editor/src/styles.css` (pointer-events), foc…
- Validation: render-svg 15/15, editor 6/6, full vitest 194/195 (the single failure is an unrelated `agent-routing/test/integration.test.ts` assertion from the unpushed flat-CDAC commit, not touched by this set),…
- Commit status: committed as `a9a90e6`, not yet pushed. Note: the local branch also carries unpushed flat-CDAC commits (`36279ed`, `2bb4c2b`) from a concurrent worker; push order and the integration-test failure the…

## 2026-08-08 - Make Razavi the new-canvas default and expose style selection

- Changed areas: model factory default; typed, undoable `set_presentation_style` Edit Engine operation; editor `Style` command menu; focused default and history tests.
- Validation: focused tests (9/9), model/edit-engine package builds, editor production build, and `git diff --check` passed. Workspace typecheck and recursive build are blocked by a concurrent missing-return error…
- Commit status: uncommitted.

## 2026-08-08 - Tighten device hit targets and make text markup authorable

- Changed areas: editor Symbol-viewBox hit rectangles; selection-aware Text panel formatting buttons; explicit Razavi text markup parser; focused render coverage.
- Validation: renderer/model/edit-engine suites (25/25), editor build, render package build and `git diff --check` passed. Full typecheck is blocked only by the concurrent `packages/agent-adapter/src/service.ts:43…
- Commit status: uncommitted.

## 2026-08-08 - Calibrate Razavi symbol proportions and strokes

- Changed areas: Visio-derived MOS/core-analog generators and regenerated assets/catalog/fidelity boards; Symbol DSL circle presentation; Razavi SVG style tokens and formal SVG goldens.
- Validation: MOS/core-analog/catalog generator checks; 27 focused symbol and renderer tests; dependency-aware render-svg build; Phase 1/5 formal-golden regeneration; editor production build; and `git diff --check…
- Commit status: uncommitted.

## 2026-08-08 - Align Razavi MOS and Ground geometry to reference

- Changed areas: Visio MOS source generator, regenerated MOS catalog assets and visual/fidelity baselines, focused catalog coverage, and dependent formal SVG goldens.
- Validation: regenerated MOS/formal SVG baselines; MOS/core-analog/catalog generator checks; 36 focused symbols/renderer tests; render-svg dependency build; editor production build; and `git diff --check` passed.
- Commit status: uncommitted.

## 2026-08-08 - Establish four-layer Agent schematic guidance

- Changed areas: four canonical Agent guidance pages; thin `circuit-layout` Skill and progressive-loading manifest; Agent documentation navigation; corrected RouteGraph shape vocabulary; refreshed Phase 9 Skill-structure report.
- Validation: Skill Creator validation passed; Phase 9 Skill check passed with 16 valid manifest links and all contract checks true; direct local Markdown link check passed for eight entry files; `git diff --check…
- Commit status: ready for `docs(agent): establish four-layer layout guidance`.

## 2026-08-08 - Text, annotation, and peripheral editing system plan

- Changed areas: added `docs/roadmap/text-annotation-peripheral-editing-plan.md`; created the associated bounded target plan.
- Validation: cross-referenced the current schemas, engine operations, renderer/editor behavior, and accepted contracts; `git diff --check` passed. No runtime code or circuit assets changed.
- Commit status: not committed; repository contains concurrent dirty work outside this documentation target.

## 2026-08-08 - Land concurrent Razavi editor/style/symbol targets

- Changed areas: model factory default + schema test; edit-engine `set_presentation_style` typed edit + presentation history test; agent-adapter `editCategory` classification of the new edit.
- Validation: focused model/edit-engine tests; full suite 203/203; workspace typecheck clean; editor build succeeds.
- Commit status: all four commits landed on `main`; worktree now clean of the concurrent Razavi work.

## 2026-08-08 - WP-A0: freeze text, annotation, and peripheral editing contracts

- Changed areas: new ADR 0010 (schema 1->2, four frozen decisions); `docs/specs/schematic-model.md` 1.1->1.2 (DraftingLayer, RichText AST, VisualAnchor, DraftingObject/Guide, narrowed SchematicAnnotation, migration, invariants); `docs/specs/edit-engine.md`…
- Validation: the three fixtures parse against schema 1 and their goldens are idempotent under `text-annotation-wp-a0-golden.mjs --check`; the rich-text golden renders subscripts and italic runs, the route-marker…
- Commit status: ready for `docs(specs): freeze text, annotation, and peripheral editing contracts (WP-A0)`.

## 2026-08-08 - WP-A0.1: contract revision for six review findings

- Changed areas: ADR 0010 revised to `accepted` (six fixes); schematic-model, edit-engine, and agent-api specs updated to match; WP-A1 plan restructured into A1a / A1b / integration-gate stages; three `expected-schema2.json` post-migration expectation fixt…
- Validation: documentation + deterministic-expectation fixtures only; no runtime code changed. `npx tsc -p tsconfig.check.json --noEmit` clean and `git diff --check` clean as a no-code-edit guard.
- Commit status: ready for `docs(specs): re-freeze text/annotation contracts with fallback, hash, and sequencing fixes (WP-A0.1)`.

## 2026-08-08 - WP-A1a: v2 model types, migration, anchor resolver, typed edits

- Changed areas: - model: schema.ts adds RichTextDocument/Run (four node kinds, span four styles, bounds depth 4 / 64 runs / 256 chars / non-empty fraction), VisualAnchor (free|object|route with fallbackPosition), Guide, DraftingObject union (text/arrow/le…
- Validation: model + edit-engine + derived + agent-adapter suites 111/111 pass; workspace `tsc -p tsconfig.check.json --noEmit` clean; migration idempotent and topology-hash-stable; anchor resolver returns fallba…
- Commit status: ready for `feat(model): v2 drafting types, schema-1->2 migration, and VisualAnchor resolver (WP-A1a)`.

## 2026-08-08 - Unblock renderer + WP-A1b: drafting consumption

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: full suite 229/229 (adds 4 drafting-render tests); workspace typecheck clean; agent-adapter typecheck clean.
- Commit status: ready for `feat(render): minimal drafting consumption in renderer and Snapshot (WP-A1b)`.

## 2026-08-08 - WP-A1 integration gate: schema 2 live

- Changed areas: - model: CURRENT_PROJECT_SCHEMA_VERSION = 2; route-marker added to AnnotationKindSchema with markerKind/anchor (VisualAnchor) validated on route-marker; migration registered in defaultProjectMigrations so legacy Projects auto-upgrade on re…
- Validation: full suite 229/229; workspace typecheck clean; all six generation/golden --check scripts pass; `git diff --check` clean.
- Commit status: ready for `feat(model): switch to schema 2 with idempotent migration and route-marker (WP-A1 gate)`.

## 2026-08-08 - WP-A2: unified RichText renderer and route-marker rendering

- Changed areas: - render-svg: new `rich-text.ts` `renderRichTextDocument` renders the four node kinds into tspans honoring the style profile tokens (math weight/style, subscript scale + baseline shift reused for superscript, fraction stack); drafting text…
- Validation: full suite 234/234; workspace typecheck clean; all six generation/golden --check scripts pass; `git diff --check` clean.
- Commit status: ready for `feat(render): unified RichText renderer and route-marker rendering (WP-A2)`.

## 2026-08-08 - WP-A3 step: editor authors drafting text and route-marker

- Changed areas: apps/editor App.tsx addPlainText now commits upsert_drafting_object (DraftText, free anchor, single text run), and addCurrentArrow now commits upsert_schematic_annotation with a route-marker carrying a route VisualAnchor (routeId/segmentIn…
- Validation: full suite 234/234; editor typecheck clean; `git diff --check` clean.
- Commit status: ready for `feat(editor): author drafting text and route-marker (WP-A3 step)`.

## 2026-08-08 - WP-A3 read-side: unified hit-test/bounds/drag/panel for route-marker

- Changed areas: apps/editor App.tsx adds effectiveRouteAttachment() (projects a route-marker route VisualAnchor onto the legacy RouteAnnotationAttachment shape) and isRoutedMarker(); annotationAnchor, annotationHitBox, constrainAnnotationPosition, the dra…
- Validation: full suite 235/235; editor build succeeds; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `feat(editor): unified route-marker hit-test, drag, and clipboard (WP-A3 read-side)`.

## 2026-08-08 - WP-A3 legacy-kind removal: plain-text/current/voltage/figure-caption

- Changed areas: - model: AnnotationKindSchema narrows to instance-label | net-label | power-label | route-marker; the routeAttachment-only-on-current refine is gone (routeAttachment remains as a migration-era legacy field); migration-v1-to-v2 still reads…
- Validation: full suite 235/235; workspace typecheck clean; all generation/golden --check scripts pass; `git diff --check` clean.
- Commit status: ready for `feat(model): remove legacy annotation kinds (WP-A3 legacy-kind removal)`.

## 2026-08-08 - Agent Snapshot electricalTopologyHash rename

- Changed areas: agent-adapter schema.ts renames the Snapshot field to electricalTopologyHash; snapshot.ts computes it via the shared @icm/derived electricalTopologyHash over the Project view (falling back to a single-document view when no Project is avail…
- Validation: full suite 237/237; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `feat(agent-api): rename Snapshot identity hash to electricalTopologyHash`.

## 2026-08-08 - WP-A3 rich-text editor: markup parser and drafting text editing

- Changed areas: - render-svg: new `markup-parser.ts` parseMarkup / flattenMarkup converting the restricted import shorthand (subscripts `_{...}`, superscripts `^{...}`, `\it{...}`, `\bf{...}`, `\frac{num}{den}`, line breaks `\\`) to the canonical RichText…
- Validation: full suite 245/245; editor build succeeds; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `feat(editor): markup-rich text editing for drafting objects (WP-A3 rich text)`.

## 2026-08-08 - WP-A4: Guide tool

- Changed areas: apps/editor adds a "guide" EditorTool and `G` shortcut; the Guide tool click adds a vertical guide at the click x; guides render as a dashed blue overlay (locked = grey, not draggable) with drag-to-move, double-click-to-lock, and Delete-to…
- Validation: full suite 246/246; editor build succeeds; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `feat(editor): Guide tool with add/move/lock/delete (WP-A4 guides)`.

## 2026-08-08 - WP-A4 drafting object rendering

- Changed areas: render-svg renderDraftingLayer now renders every DraftingObject kind: text (existing), construction-line (dashed/dotted per lineStyle), arrow (shaft + head), leader (origin-target line), callout (leader + rich text), and floating-symbol (r…
- Validation: full suite 249/249; all golden --check scripts stable; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `feat(render): render construction-line, arrow, leader, callout, floating-symbol (WP-A4 rendering)`.

## 2026-08-08 - WP-A4 decorative symbol capability

- Changed areas: symbols schema adds optional `decorative` to SymbolDefinition and allows zero pins with a refine (decorative -> no terminals; non-decorative -> at least one pin); builtins adds `decorative-note-box` (a terminal-free dashed rectangle) and r…
- Validation: full suite 250/250; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `feat(symbols): decorative symbol capability for floating symbols (WP-A4 decorative)`.

## 2026-08-08 - WP-A4 editor drafting creation commands

- Changed areas: apps/editor adds addConstructionLine (dashed horizontal line), addFreeArrow (horizontal arrow), and addFloatingSymbol (decorative-note-box via the whitelist); the More menu gains a Markup group with the three commands. The DocumentHistory…
- Validation: full suite 250/250; editor build succeeds; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `feat(editor): construction-line, free arrow, and floating-symbol commands (WP-A4 commands)`.

## 2026-08-08 - WP-A5: strict Snapshot drafting schema and GUI/Agent parity

- Changed areas: - agent-adapter schema.ts: drafting.objects now validates against the shared DraftingObjectSchema (canonical RichText AST + VisualAnchor) instead of z.unknown(); guide summaries keep id/visible/locked. - New parity.test.ts: (1) the same ty…
- Validation: full suite 252/252; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `feat(agent-api): strict drafting Snapshot schema and GUI/Agent parity (WP-A5)`.

## 2026-08-08 - WP-A5 regression: regenerate Agent API and phase-9 artifacts

- Changed areas: regenerated fixtures/agent-api (request/response schemas and OpenAPI, now carrying electricalTopologyHash and the strict drafting object schema) and all five phase-9 layout-eval artifacts (generalization report, heldout import reports and…
- Validation: agent-api-artifacts --check passes; all six generation/golden --check scripts pass; all five phase-9 --check scripts pass; full suite 252/252; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `chore(fixtures): regenerate Agent API and phase-9 artifacts after hash rename (WP-A5 regression)`.

## 2026-08-08 - Markup parser: nested braces in command bodies

- Changed areas: render-svg markup-parser.ts command regexes now match a body of plain text or one nested brace group; added a test for a fraction whose numerator contains a subscript.
- Validation: full suite 253/253; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `fix(render): parse nested braces inside markup command bodies`.

## 2026-08-08 - Restore browser-compatible editor startup

- Changed areas: replaced the Node dependency with a synchronous browser/Node-compatible SHA-256 implementation and added an exact digest assertion so the public hash contract cannot silently change.
- Validation: focused topology-hash tests 3/3; workspace typecheck; derived build followed by editor production build; fresh live browser load at `http://localhost:5173/` with the editor DOM present and no console…
- Commit status: ready for `fix(editor): keep topology hashing browser compatible`.

## 2026-08-08 - WP-R0 + WP-R1: drafting runtime completion (contract + unified geometry)

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: full suite 261/261; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `docs(drafting): freeze runtime completion contract and capability matrix (WP-R0)` and `feat(derived): resolve drafting object geometry (WP-R1)`.

## 2026-08-08 - WP-R2: renderer consumes unified drafting geometry + bounds

- Changed areas: render-svg render.ts renderDraftingLayer now resolves each object's geometry once and passes it to kind-specific renderers; the draftObjectPosition helper (which branched on free/fallback) is removed; deriveBounds pushes every drafting obj…
- Validation: full suite 263/263; workspace typecheck clean; all golden --check scripts pass; `git diff --check` clean.
- Commit status: ready for `fix(render): consume unified drafting geometry and include drafting bounds (WP-R2)`.

## 2026-08-08 - WP-R3: lossless rich-text editing

- Changed areas: render-svg markup-parser.ts adds serializeMarkup (AST -> reversible markup: text verbatim, line-break `\`, span styles `_{}`/`^{}`/ `\it{}`/`\bf{}`, fraction `\frac{}{}`); editor App.tsx initializes the drafting-text draft from serializeMa…
- Validation: full suite 265/265; editor build succeeds; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `fix(editor): preserve rich text through lossless markup editing (WP-R3)`.

## 2026-08-08 - WP-R4: Agent Snapshot exposes resolved drafting geometry

- Changed areas: agent-adapter schema.ts adds includeEditorGuides to the snapshot request (default false) and wraps each drafting object in { object, resolvedGeometry, bounds, diagnostics } (float-tolerant bounds; guides gain optional axis/coordinate); sna…
- Validation: full suite 267/267; agent-api-artifacts --check passes; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `feat(agent-api): expose resolved drafting geometry and includeEditorGuides (WP-R4)`.

## 2026-08-08 - WP-R5 (part 1): drafting selection, drag, and delete

- Changed areas: apps/editor adds selectDraftingObject(id) as the single selection entry (clears annotation/route/instance selection, initializes the edit draft from serializeMarkup for text); addPlainText now calls it instead of the wrong setSelectedAnnot…
- Validation: full suite 267/267; editor build succeeds; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `feat(editor): drafting selection, drag, and delete (WP-R5 part 1)`.

## 2026-08-08 - WP-R5 (part 2): select/delete all drafting kinds via shared geometry

- Changed areas: apps/editor drafting hit-box rendering now maps every drafting object to a rect spread from geometry.bounds (not a text-only estimate); free-anchored unlocked text drags via beginDraftingDrag, all other kinds select via selectDraftingObjec…
- Validation: full suite 267/267; editor build succeeds; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `feat(editor): select/delete all drafting kinds via shared geometry (WP-R5 part 2)`.

## 2026-08-08 - WP-R6: parity rename, real browser E2E, and full exit gate

- Changed areas: - parity.test.ts renamed "GUI/Agent drafting parity" to "Agent/Edit Engine drafting parity" and clarified it exercises typed-edit semantics, not the GUI. - New apps/editor/e2e/drafting.spec.ts with three browser scenarios: (A) add drafting…
- Validation: Historical validation completed; detailed command evidence remains in Git history.
- Commit status: ready for `test(editor): drafting E2E, parity rename, and formatting (WP-R6)`.

## 2026-08-08 - Razavi unified MOS presentation

- Changed areas: standard NMOS/PMOS palette placement persists the canonical `textbook-3terminal` visual variant while retaining D/G/S/B electrically; thumbnails resolve that same variant; raw `nmos3`/`pmos3` imports remain in the catalog as provenance but…
- Validation: Historical validation completed; detailed command evidence remains in Git history.
- Commit status: ready for `fix(razavi): unify default MOS presentation`.

## 2026-08-08 - Razavi existing MOS presentation migration

- Changed areas: applying (or reapplying) Razavi now batches canonical NMOS/PMOS visual-variant edits in the same undoable transaction. An absent bulk net or supply bulk (`0`, GND, VSS, VDD, VDDA, VSSA, VGND, VPWR) is shown in the three-terminal textbook v…
- Validation: Historical validation completed; detailed command evidence remains in Git history.
- Commit status: ready for `fix(razavi): migrate eligible existing MOS to textbook view`.

## 2026-08-08 - Razavi MOS arrow seam and PMOS parity

- Changed areas: the VSS-derived source-arrow support now extends under its later-rendered filled triangle by half a source-shape stroke; triangle and electrical coordinates remain unchanged. Catalog tests verify both NMOS and PMOS hide `bulk-lead` / `sour…
- Validation: focused 17-test symbol/editor Vitest, both generated-asset checks, and browser palette E2E passed; `git diff --check` clean.
- Commit status: ready for `fix(razavi): close MOS arrow seams and verify PMOS variant`.

## 2026-08-08 - Razavi MOS arrow family unification

- Changed areas: decoded PMOS / PMOS3 VSS source markers are 22/25 of NMOS after symbol transforms. The generator compensates their arrow-only metrics by 25/22, so both polarity families have visible length 8.28 and half-width 3.78675. Four-terminal pin ge…
- Validation: focused 12-test catalog test, MOS and catalog generation checks, palette browser E2E, and `git diff --check` passed.
- Commit status: ready for `fix(razavi): unify PMOS and NMOS arrow proportions`.

## 2026-08-08 - MOS terminal presentation control

- Changed areas: selected canonical NMOS/PMOS has inspector actions for textbook three-terminal and Bulk-visible four-terminal presentation. The switch is a typed, undoable `set_instance_symbol` edit; it retains the same symbol ID and D/G/S/B electrical te…
- Validation: editor build and a PMOS browser E2E prove B appears when the four-terminal view is selected and disappears when textbook view returns; `git diff --check` clean.
- Commit status: ready for `feat(editor): expose MOS three and four terminal views`.

## 2026-08-08 - P0-2: drafting drag uses preview and commits one transaction

- Changed areas: apps/editor beginDraftingDrag now records a live position in draftingDragPositionRef and a draftingDragPreview state during pointermove (no transact); pointerup reads the ref and commits ONE upsert_drafting_object; Escape/pointercancel dis…
- Validation: full suite 270/270; drafting E2E 4/4; editor build succeeds; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `fix(editor): drafting drag preview with single atomic commit (P0-2)`.

## 2026-08-08 - P1: freeze final-rotation semantics (geometry is the single truth)

- Changed areas: derived drafting-geometry.ts adds composeRotation with the frozen rule finalRotation = anchor.orientation === "follow" ? normalize(anchorRotation + object.rotation) : object.rotation, applied to text and callout; render-svg render.ts text/…
- Validation: full suite 271/271; workspace typecheck clean; goldens stable; `git diff --check` clean.
- Commit status: ready for `fix(derived): freeze composed rotation as the single geometry truth (P1 rotation)`.

## 2026-08-08 - P1: accurate floating-symbol and multi-line text bounds

- Changed areas: derived drafting-geometry.ts transformSymbolCorner applies the exact SVG transform (translate(position) rotate(rotation) scale(-1 1) for mirror-x) to all four viewBox corners and takes the AABB; textBounds now takes a per-token font size (…
- Validation: full suite 273/273; goldens regenerated (text bounds changed the export viewBox); workspace typecheck clean; all golden --check pass; `git diff --check` clean.
- Commit status: ready for `fix(derived): accurate floating-symbol and multi-line text bounds (P1 bounds)`.

## 2026-08-08 - P1: strict Snapshot geometry schema (no z.unknown, no duplicate bounds)

- Changed areas: packages/model/src/drafting-geometry-schema.ts defines and exports ResolvedDraftingGeometrySchema (a discriminated union per kind with typed position/rotation/bounds/diagnostics) and DraftingDiagnosticSchema (typed code/severity/anchorRole…
- Validation: full suite 273/273; agent-api-artifacts --check passes; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `feat(agent-api): strict drafting geometry schema in Snapshot (P1 typed)`.

## 2026-08-08 - P1: canvas drag-create for construction line and arrow

- Changed areas: apps/editor EditorTool gains construction-line and arrow; beginCanvasGesture starts a draftingCreatePreview on pointerdown, move updates the end point, finishCanvasGesture commits one typed edit via commitDraftingCreate; a dashed drafting-…
- Validation: full suite 273/273; drafting E2E 6/6; editor build succeeds; workspace typecheck clean; goldens regenerated after a rebuild aligned source and dist symbol geometry; `git diff --check` clean.
- Commit status: ready for `feat(editor): canvas drag-create for construction line and arrow (P1 tools)`.

## 2026-08-08 - P2: distinguish invalid route segment diagnostics

- Changed areas: derived anchor.ts AnchorDiagnostic.code is now a precise union; resolveRouteAnchor returns DRAFTING_ROUTE_SEGMENT_INVALID when the route exists but its segment is invalid, and DRAFTING_ANCHOR_TARGET_MISSING for a missing route/unresolvable…
- Validation: full suite 274/274; workspace typecheck clean; agent-api artifacts regenerated; `git diff --check` clean.
- Commit status: ready for `fix(derived): return precise invalid-route-segment diagnostics (P2)`.

## 2026-08-08 - P1: shape-based drafting hit targets

- Changed areas: apps/editor drafting hit rendering now uses the object's actual shape: stroke polyline for construction lines, stroke line for arrows/leaders/callouts (shaft), and a rect only for text/floating-symbol (whose natural hit is a box). beginDra…
- Validation: full suite 274/274; drafting E2E 7/7; editor build succeeds; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `fix(editor): shape-based drafting hit targets (P1 hit)`.

## 2026-08-08 - P1: key-scenario E2E coverage + click-without-move fix

- Changed areas: apps/editor beginDraftingDrag commits only when the pointer actually moved (click-without-move just selects, no revision); drafting.spec adds: unedited Apply keeps revision, drag-create commits one revision and one Ctrl+Z undoes it, drafti…
- Validation: drafting E2E 9/9; full suite 274/274; editor build succeeds; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `fix(editor): no-op drafting click; add key-scenario E2E (P1 scenarios)`.

## 2026-08-08 - P1: real production preview smoke

- Changed areas: scripts/editor-production-smoke.mjs builds the editor, serves the dist with vite preview on 127.0.0.1:4174, opens it in a real Chrome browser, asserts the schematic canvas mounts, and fails on any console/page error or on "node:crypto has…
- Validation: production smoke passes (mounted, 0 console errors, no node:crypto externalization); drafting E2E 9/9; full suite 274/274; workspace typecheck clean; `git diff --check` clean.
- Commit status: ready for `test(editor): production preview smoke against the built bundle (P1 smoke)`.

## 2026-08-08 - Final exit gate + formatting normalization

- Changed areas: prettier --write normalized 8 files (drafting geometry/anchor, markup, editor App/e2e, smoke script, visio generator); full exit gate runs.
- Validation: Historical validation completed; detailed command evidence remains in Git history.
- Commit status: ready for `chore: format normalization after Drafting Runtime Completion (exit gate)`.

## 2026-08-08 - Roadmap status revision (honest completion)

- Changed areas: docs/roadmap/text-annotation-peripheral-editing-plan.md gains a "Drafting Runtime Completion status" section listing what is now true (reversible markup, single geometry entry, frozen rotation, accurate bounds, atomic drags, drag-create to…
- Validation: Historical validation completed; detailed command evidence remains in Git history.
- Commit status: ready for `docs(roadmap): record honest Drafting Runtime Completion status`.

## 2026-08-08 - Razavi MOS canonical source-arrow geometry

- Changed areas: `generate-visio-mos-assets.mjs` now uses one local source arrow metric record (compensated for calibrated body scaling) for `nmos3` and `pmos3`; the four-terminal masters retain native explicit-body geometry. `razavi-catalog.test.ts` verif…
- Validation: `symbols:visio-mos:check`, `symbols:razavi:check`, focused Razavi catalog vitest (13/13), and `git diff --check` pass.
- Commit status: ready for `fix(razavi): derive MOS arrows from canonical geometry`.

## 2026-08-08 - Razavi UI MOS raster-diff baseline

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: fixed browser SVG inspection; restored zero-instance document; `git diff --check` clean.
- Commit status: ready for `docs(plan): record Razavi UI raster-diff baseline`.

## 2026-08-08 - Raster-authoritative Razavi MOS assets

- Changed areas: archived the 1204x794 source image and hash manifest; added a direct-final-coordinate MOS generator; migrated all four MOS catalog entries to `razavi-raster-reference` provenance; preserved D/G/S/B pin semantics; and froze visual authority…
- Validation: raster MOS generator and catalog checks pass; Razavi catalog tests 13/13; symbols and editor production builds pass; `git diff --check` clean.
- Commit status: ready for `feat(razavi): make screenshot the MOS visual authority`.

## 2026-08-08 - Drafting runtime final repair

- Changed areas: recursive reversible rich-text parser; derived-owned style profiles and shared rich-text measurement; profile/fraction/multiline-aware drafting bounds; nonzero SVG line origins; cancellable atomic text drag; callout text-plus-leader hits;…
- Validation: focused tests passed; full unit suite 283/283; full Playwright 26/26; typecheck; 12-package build; production preview smoke `--check`; Agent API artifact check; release package; and `git diff --check…
- Commit status: ready for `fix(drafting): close runtime and GUI verification gaps`.

## 2026-08-08 - Complete screenshot-driven Razavi MOS pixel map

- Changed areas: added a hash-bound NMOS/PMOS pixel map; expanded the raster measurement script; changed the MOS generator to consume only that map plus fixed electrical pin anchors; regenerated four MOS assets and the catalog; replaced old numeric expecta…
- Validation: pixel-map regeneration check; MOS generator and catalog idempotency checks; focused catalog tests 13/13; symbols TypeScript build; editor production build; running-editor SVG inspection for both NMOS…
- Commit status: ready for `fix(razavi): generate MOS geometry solely from pixel map`.

## 2026-08-08 - Razavi peripheral assets and four-terminal MOS

- Changed areas: added a hash-bound peripheral geometry map and generator; moved three peripheral catalog entries from Visio to raster provenance; protected them from Visio regeneration; generated route-arrow style metrics; shortened NMOS/PMOS bulk support…
- Validation: per user request, no browser or visual-regression pass; asset and catalog generation completed; `git diff --check` and status inspection used as the close-out checks.
- Commit status: ready for `fix(razavi): align peripheral assets and four-terminal MOS`.

## 2026-08-08 - Four-terminal MOS bulk-arrow continuity

- Changed areas: bulk pixel geometry now supports multiple non-overlapping line segments; NMOS uses bar-to-tip plus base-to-B; PMOS uses bar-to-base plus the outward filled head.
- Validation: MOS/catalog generation succeeded; three-terminal NMOS and PMOS SHA-256 hashes remained unchanged; `git diff --check` and status inspected.
- Commit status: ready for `fix(razavi): connect four-terminal bulk arrows to gate bars`.

## 2026-08-08 - Diagnostic policy separation

- Changed areas: introduced structural/observation categories, confidence, and gate eligibility; centralized completeness-gate policy; measured visible symbol variants and rich text; clustered repeated overlaps; separated the editor presentation and Agent…
- Validation: derived and Agent-adapter tests 29/29; manual editor Playwright tests 16/16; derived, Agent-adapter, and editor builds; Agent API artifact check; and `git diff --check` all pass.
- Commit status: ready for `refactor(diagnostics): separate structural gates from visual observations`.

## 2026-08-08 - Razavi current-arrow and node alignment

- Changed areas: corrected the current-arrow map to its full visible extent; added a measured solid-node radius; generated junction, Port-origin, and arrow profile tokens from the shared map; and refreshed normative values.
- Validation: per user instruction, no visual or automated validation was performed; `git diff --check` and final status inspection were retained as repository hygiene checks.
- Commit status: ready for `fix(razavi): align current arrows and solid nodes`.

## 2026-08-08 - Voltage-source raster alignment

- Changed areas: changed the voltage-source circle from emphasis to normal stroke; corrected the source origin and polarity-axis pixel registration; regenerated its raster-owned symbol and catalog.
- Validation: peripheral-asset and catalog checks passed; Symbols build passed; voltage-source binary IoU improved from 0.5621 to 0.6565 and soft IoU from 0.4419 to 0.5595; no additional visual inspection was used…
- Commit status: ready for `fix(razavi): align voltage source to raster reference`.

## 2026-08-09 - Razavi MOS join continuity

- Changed areas: extended channel/support visual primitives one reference pixel through their vertical joins; widened both source-arrow heads and extended the NMOS tip/support one pixel; made pixel-derived MOS viewBoxes expand to valid integer bounds; rege…
- Validation: NMOS diff improved from 0.7389 to 0.7523 binary IoU and from 0.6246 to 0.6406 soft IoU; PMOS improved slightly while its residual showed a +1/+1-pixel registration preference; source/catalog generati…
- Commit status: ready for `fix(razavi): close MOS joins and align route arrows`.

## 2026-08-09 - PMOS source-arrow tail

- Changed areas: shortened the PMOS source-arrow support to start at its existing triangle base; regenerated MOS assets and catalog metadata.
- Validation: MOS and catalog generation checks, Symbols build, and `git diff --check` passed. No visual inspection was performed per the rapid iteration request.
- Commit status: ready for `fix(razavi): trim PMOS source arrow support`.

## 2026-08-09 - PMOS arrow mirrors NMOS

- Changed areas: PMOS arrow now has NMOS's 16 px length and 14 px base width; its support begins at the arrow tip and never extends beyond it.
- Validation: MOS/catalog generation and Symbols build passed. PMOS diff was 0.6493 binary IoU and 0.6052 soft IoU. The score declined because the old reference crop favors the previously rejected geometry; visual…
- Commit status: ready for `fix(razavi): mirror PMOS arrow from NMOS`.

## 2026-08-09 - PMOS arrow gate contact

- Changed areas: set tip to the Gate bar edge; retained the NMOS-matched 16 px arrow length and 14 px base; moved support to begin at the tail.
- Validation: MOS/catalog generation checks, Symbols build, and `git diff --check` passed. No visual inspection was performed.
- Commit status: ready for `fix(razavi): join PMOS arrow to gate bar`.

## 2026-08-09 - Razavi route-current arrow length

- Changed areas: increased the pixel-map full arrow extent from 80 px to 92 px while preserving its 26 px by 15 px head and 12 px label gap; regenerated the profile token and updated its contract test and normative documentation.
- Validation: peripheral generator and stale-output check passed; focused profile test 2/2 passed; `@icm/render-svg` build and `git diff --check` passed. The raster harness does not yet cover route markers, so no…
- Commit status: ready for `fix(razavi): lengthen route current arrow`.

## 2026-08-09 - Razavi peripheral fidelity

- Changed areas: introduced a screenshot-mapped 5 px GND-bar role without changing global emphasis; changed current-source circle to normal; retained the common 6.5 px Port/Junction radius; documented the synchronized tokens.
- Validation: peripheral/catalog generation and stale checks, Symbols/Derived/ Render-SVG builds, focused catalog/profile tests passed. Ground IoU/soft-IoU improved `0.7698/0.6337 -> 0.7810/0.6940`; current-source…
- Commit status: ready for `fix(razavi): refine peripheral reference fidelity`.

## 2026-08-09 - Razavi passive reference crop baseline

- Changed areas: added a hash-pinned passive geometry map for panel (d) R1; extended fidelity rasterization to support quarter-turn symbols; registered a resistor comparison target; replaced its round Visio body with the measured sharp, normal-stroke zigza…
- Validation: resistor binary/soft IoU improved `0.2360/0.1779 -> 0.6597/0.6068`; registration lift is zero. Symbols/Derived/Render-SVG builds, catalog generation and stale check, and focused tests 17/17 passed. T…
- Commit status: ready for `test(razavi): add passive reference crop baseline`.

## 2026-08-09 - Razavi capacitor reference archive

- Changed areas: archived the original PNG; hash-pinned it and a capacitor geometry map in the authority manifest; recorded C1 vertical and C2 horizontal crop anchors; corrected the style contract's prior absence claim.
- Validation: image and geometry SHA-256 links matched manifest values, both evidence IDs were present, JSON parsed, and `git diff --check` passed.
- Commit status: ready for `docs(razavi): archive capacitor reference evidence`.

## 2026-08-09 - Razavi capacitor dual-orientation calibration

- Changed areas: registered both supplemental-raster targets in the fidelity CLI and corrected their origin anchors. The harness now reads a target's own reference asset rather than assuming every target belongs to the six-panel PNG.
- Validation: Symbols/Derived/Render-SVG builds, catalog generation and stale check, focused tests 17/17, both pixel reports, and `git diff --check` passed.
- Commit status: ready for `test(razavi): add capacitor reference calibration`.

## 2026-08-09 - Current documentation index and VSS archive

- Changed areas: adds `docs/current/` and `docs/archive/` boundaries; archives the VSS development specification and VSS-derived Agent Razavi canon; leaves ADR-linked redirect stubs at their former paths; updates specification, roadmap, documentation, and…
- Validation: routing guard confirms the Skill no longer loads the archived canon, the specs index has no active VSS entry, all archive/current targets exist, and `git diff --check` is clean.
- Commit status: ready for `docs: separate current guidance from VSS archive`.

## 2026-08-09 - Unified canvas rich-text editing

- Changed areas: added optional presentation `content` to semantic annotations; unified their RichText SVG path with Drafting Text; replaced raw-markup side panels with a floating canvas toolbar for bold, italic, subscript, superscript, fraction insertion,…
- Validation: workspace typecheck, editor production build, focused model and renderer tests (39 assertions), and 26 Playwright editor workflows passed. The 3 whole-render golden failures remain component-only mis…
- Commit status: ready for `feat(text): unify rich-text editing surface`.

## 2026-08-09 - Razavi current, source, and Port reference calibration

- Changed areas: hash-pinned the 326 x 254 supplemental raster and measured map; made Razavi formal Ports hollow while preserving their junction-sized outside radius; made attached route markers head-only so the route is their shaft; tuned the head to the…
- Validation: peripheral and catalog generation, Symbols/Derived/Render-SVG builds, the focused 2-test current-arrow/hollow-Port renderer run, current source fidelity report, and `git diff --check` passed. The thr…
- Commit status: ready for `fix(razavi): calibrate current markers and ports`. ### Actual-render scoring completion

## 2026-08-09 - Razavi semantic subscript face correction

- Changed areas: semantic-label renderer and generated editor RichText split; constrained text comparison option; Razavi text specification and focused renderer test.
- Validation: focused renderer tests `19/19`, Render-SVG build, workspace typecheck, Prettier check, and `git diff --check` passed.
- Commit status: ready for `fix(razavi): use upright semantic subscripts`.

## 2026-08-09 - Razavi default text typography calibration

- Changed areas: added a Chrome/Arial text-only calibration CLI; set semantic label sizes to `18`, subscript scale to `0.76`, and baseline shift to `0.34em`; routed the same baseline token into derived rich-text bounds; and updated the two active style spe…
- Validation: focused tests `23/23`, Derived/Render-SVG builds, workspace typecheck, editor production build, owned-file Prettier check, and `git diff --check` passed. Unrelated peripheral Port worktree hunks were…
- Commit status: ready for `fix(razavi): calibrate default schematic typography`.

## 2026-08-09 - Razavi unified subscript proportion and attachment

- Changed areas: text comparator now supports this second reference and a relative attachment sweep; Razavi typography profile, derived bounds, renderer expectations, and active specifications use the calibrated values.
- Validation: focused tests `24/24`, Derived/Render-SVG builds, workspace typecheck, Prettier check, and `git diff --check` passed.
- Commit status: ready for `fix(razavi): refine unified subscript geometry`.

## 2026-08-09 - Global semantic annotation typography

- Changed areas: formal renderer and editor session initialization now derive semantic annotations from canonical `text`; schema and style contract clarify that stored annotation `content` is not a visual style override; regression covers a stale legacy Ri…
- Validation: 36 of 39 focused renderer/text checks passed; the three failures are existing component-symbol goldens. Render-SVG/editor builds, workspace typecheck, formatting, and `git diff --check` passed.
- Commit status: ready for `fix(text): normalize semantic annotation typography`.

## 2026-08-09 - Editor label selection and mixed deletion

- Changed areas: editor default-label interaction overlay and RichText-aware annotation hit geometry; deletion edit de-duplication; focused editor and deletion regressions.
- Validation: focused Vitest 8/8 passed, editor production build passed, and `git diff --check` passed. Workspace typecheck is blocked by an unrelated retained VDD worktree hunk whose rotation literal is inferred…
- Commit status: committed as `0415765 fix(editor): unify instance label selection and deletion`.

## 2026-08-09 - VDD label transaction type repair

- Changed areas: one literal type assertion in the editor VDD placement edit.
- Validation: workspace typecheck, editor production build, and `git diff --check` passed.
- Commit status: ready for `fix(editor): type VDD label rotation literal`.

## 2026-08-09 - Editor visual-selection normalization

- Changed areas: editor selection state and gesture bridge; new pure `VisualSelection` module and tests.
- Validation: workspace typecheck, editor production build, focused Vitest 10/10, and `git diff --check` passed.
- Commit status: committed as `940b854 refactor(editor): normalize visual selection protocol`.

## 2026-08-09 - Text-entry and current-arrow repair

- Changed areas: editor Property panel and route-marker action; floating RichText editor range handling.
- Validation: workspace typecheck, editor production build, focused Vitest 10/10, and `git diff --check` passed.
- Commit status: committed as `9337c8d fix(editor): unify text entry and current arrow controls`.

## 2026-08-09 - Canonical instance-label authoring

- Changed areas: editor component placement transaction.
- Validation: workspace typecheck, editor production build, focused editor tests 6/6, and `git diff --check` passed.
- Commit status: committed as `1629b29 fix(editor): create canonical labels with placed components`.

## 2026-08-09 - Voltage-source canonical label integer position

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: workspace typecheck, editor production build, focused Vitest 11/11, and `git diff --check` passed.
- Commit status: ready for `fix(editor): round canonical label positions`.

## 2026-08-09 - Explicit semantic RichText rendering

- Changed areas: formal annotation renderer, editor session initialization and hit geometry, plus the shared schema contract comment and a direct renderer regression for `V` with an explicit `out` subscript.
- Validation: targeted RichText renderer test passed; workspace typecheck, Render-SVG build, editor production build, Prettier, and `git diff --check` passed. The unfiltered Render-SVG file has four pre-existing g…
- Commit status: ready for `fix(text): preserve explicit semantic rich text formatting`.

## 2026-08-09 - Explicit filled Port palette symbol

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: regenerated catalog, focused catalog Vitest 16/16, Symbols build, Editor production build, and `git diff --check` passed.
- Commit status: ready for `feat(razavi): add filled port symbol`.

## 2026-08-09 - PMOS source-arrow support clipping

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: regenerated four MOS assets and catalog, focused catalog Vitest 16/16, Symbols build, Editor production build, and `git diff --check` passed.
- Commit status: ready for `fix(razavi): clip PMOS source-arrow support`.

## 2026-08-09 - Authority-calibrated compact typography

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused Derived/Render-SVG Vitest 8/8, Derived build, Render-SVG build, Editor production build, and `git diff --check` passed.
- Commit status: ready for `style(razavi): calibrate compact Arial typography`.

## 2026-08-09 - Correct semantic subscript proportions

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: supplied-reference candidate search, temporary GUI placement and undo, focused typography Vitest 22/22, Derived/Render-SVG/Editor builds, and `git diff --check` passed.
- Commit status: ready for `fix(text): restore Razavi subscript proportions`.

## 2026-08-09 - Bold upright subscript adjustment

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: formatting check, focused typography tests, Derived/Render-SVG/ Editor builds, and `git diff --check` passed. The broad Render-SVG file still has eight unrelated stale golden/color/size assertions al…
- Commit status: ready for `style(text): widen upright Razavi subscripts`.

## 2026-08-09 - Razavi resistor continuous miter path

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused catalog Vitest 17/17, Symbols build, resistor fidelity IoU 0.6613 with zero registration lift and anti-alias-only residual, plus `git diff --check` passed.
- Commit status: ready for `fix(razavi): join resistor body and leads`.

## 2026-08-09 - Razavi resistor acute corners

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused SVG miter-limit Vitest 1/1, Razavi catalog Vitest 17/17, Symbols and Editor builds, fidelity crop generation, and `git diff --check` passed. The complete renderer file retains eight unrelated…
- Commit status: ready for `fix(razavi): preserve resistor acute corners`.

## 2026-08-09 - Razavi resistor proportion audit

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: deterministic point/segment/angle audit, miter-limit raster sweep, resistor fidelity (IoU 0.6613, soft IoU 0.5068, 100% edge shell), catalog Vitest 17/17, Symbols/Render-SVG builds, and `git diff --c…
- Commit status: ready for `fix(razavi): restore measured resistor outline`.

## 2026-08-09 - Razavi resistor sharp-tip amplitude calibration

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: amplitude sweep, fidelity IoU 0.7290 / soft IoU 0.5752, catalog Vitest 17/17, focused SVG miter assertion, Symbols and Render-SVG builds, and `git diff --check` passed.
- Commit status: ready for `fix(razavi): calibrate resistor sharp tips`.

## 2026-08-10 - Semantic default instance-label placement

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused placement Vitest 5/5, Render-SVG and Editor builds, and `git diff --check` passed.
- Commit status: ready for `fix(editor): place default labels by symbol semantics`.

## 2026-08-10 - Compact non-MOS default label spacing

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused placement Vitest 5/5, Render-SVG and Editor builds, and `git diff --check` passed.
- Commit status: ready for `fix(editor): compact default side labels`.

## 2026-08-10 - Extra-compact non-MOS default label spacing

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused placement Vitest 5/5, Render-SVG and Editor builds, and `git diff --check` passed.
- Commit status: ready for `fix(editor): tighten default side labels`.

## 2026-08-09 - MOS source-arrow orthogonal elbow regression

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: regenerated MOS assets/catalog, focused catalog Vitest 16/16, Symbols build, Editor production build, and `git diff --check` passed.
- Commit status: ready for `fix(razavi): restore MOS arrow elbow`.

## 2026-08-09 - Compact endpoint hit testing and direct pin connection

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused editor shell Vitest 8/8, Editor production build, and `git diff --check` passed.
- Commit status: ready for `feat(editor): snap and directly connect pins`.

## 2026-08-09 - Fixed Razavi MOS display and compact selection actions

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused editor/catalog Vitest 24/24, Editor production build, and `git diff --check` passed.
- Commit status: ready for `feat(razavi): fix MOS display to textbook mode`.

## 2026-08-09 - Persistent Selection shelf

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: editor Vitest 9/9, production build, focused Playwright 2/2, and `git diff --check` passed.
- Commit status: ready for `feat(editor): keep selection shelf persistent`.

## 2026-08-09 - Compact editor command hierarchy

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: editor Vitest 10/10, production build, focused Playwright 3/3, and `git diff --check` passed.
- Commit status: ready for `feat(editor): simplify command hierarchy`.

## 2026-08-09 - Manual wire interaction P0

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused Playwright P0 3/3, routing engine Vitest 10/10, editor production build, focused Prettier, and `git diff --check` passed. Workspace typecheck/SSR and one old routing-demo browser case remain…
- Commit status: pending intentional hunk staging.

## 2026-08-09 - Drafting Selection shelf and reversible lock repair

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: editor build, drafting edit-engine Vitest 10/10, focused Drawing-shelf Playwright 4/4, source/target-plan Prettier, and `git diff --check` passed. The shared dirty log has a pre-existing Markdown Pre…
- Commit status: pending intentional hunk staging because the shared editor and drafting files retain unrelated uncommitted work from the completed drafting and parallel targets.

## 2026-08-09 - Imported hierarchy release scope

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: importer/editor Vitest 17/17, imported-SPICE Playwright flow 1/1, editor production build, Prettier, and `git diff --check` passed. Workspace typecheck reaches only unrelated Razavi catalog fixture e…
- Commit status: committed locally; push pending transient remote retry.

## 2026-08-09 - Command menu dismissal

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused Playwright 1/1, editor production build, Prettier, and `git diff --check` passed.
- Commit status: ready for `fix(editor): dismiss command menus outside the toolbar`.

## 2026-08-09 - PMOS gate-bar width

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: Razavi catalog Vitest 17/17, MOS and catalog generated-artifact checks, target-file Prettier, and `git diff --check` passed. Full workspace formatting remains blocked by seven unrelated pre-existing…
- Commit status: pending intentional staging.

## 2026-08-09 - Canonical MOS body geometry

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: Razavi catalog Vitest 17/17, MOS and catalog generated-artifact checks, target-file Prettier, and `git diff --check` passed.
- Commit status: pending intentional staging.

## 2026-08-09 - Razavi resistor continuous miter path

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused catalog Vitest 17/17, Symbols and Editor builds, resistor fidelity IoU 0.6613 with zero registration lift and anti-alias-only residual, plus `git diff --check` passed.
- Commit status: ready for `fix(razavi): join resistor body and leads`.

## 2026-08-09 - Terminal escape routing and seamless joins

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused wire-path/derived/render Vitest 7/7, focused manual editor Playwright 1/1, editor production build, Prettier, and `git diff --check` passed. The complete renderer test file retains unrelated…
- Commit status: committed as `fix(editor): escape component terminals before orthogonal turns`.

## 2026-08-09 - Unified visual deletion

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused deletion-helper Vitest 2/2, editor production build, Prettier, and `git diff --check` passed.
- Commit status: implementation is intentionally left uncommitted because `App.tsx` and this log already contain staged, separately owned terminal- escape-routing work in the shared worktree; the changes must be inte…

## 2026-08-09 - Precise selection interaction

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: selection geometry plus editor-shell Vitest 14/14, editor TypeScript check, production build, Prettier, and `git diff --check` passed.
- Commit status: pending exact-hunk integration because a separate drafting arrow target currently has uncommitted changes in `App.tsx` and `styles.css`.

## 2026-08-09 - Select before drag

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: selection geometry/editor-shell Vitest 15/15, focused Playwright attached-label selection plus two-stage label drag and floating-text drag 3/3, editor TypeScript check, production build, Prettier, an…
- Commit status: pending exact-hunk integration with the separately owned, uncommitted drafting-arrow target in `App.tsx` and `styles.css`.

## 2026-08-09 - Direct miter terminal joins

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused wire-path/render Vitest 5/5, focused manual editor Playwright 1/1, editor production build, target-file Prettier, and `git diff --check` passed.
- Commit status: committed as `fix(editor): use direct miter joins for manual terminal wiring`.

## 2026-08-09 - Virtuoso-style wire endpoint semantics

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: focused renderer branch-dot test 1/1, focused manual-editor Playwright dangling-wire/direct-whole-route-move/direct-segment-stretch tests 3/3, editor TypeScript check, production build, Prettier, and…
- Commit status: pending exact-hunk integration because the same editor, renderer, and log files contain separately owned uncommitted work.

## 2026-08-09 - Drafting midpoint bending and contextual inspector

- Changed areas: arrow persistence gained optional free `waypoints` and both free drafting shapes gained per-segment quadratic `curveControls`; shared derived geometry and formal SVG rendering now use the same Bézier path and aim an arrow head from its fin…
- Validation: model, derived, edit-engine, render-svg, and editor builds passed; focused derived/render Vitest passed 26/26; editor TypeScript check and `git diff --check` passed. Root `pnpm typecheck` remains blo…
- Commit status: not committed. A concurrent precise-selection target modified the same `App.tsx`/`styles.css` files during this work; its untracked helper files and plan were deliberately not staged or included.

## 2026-08-10 - Reusable wire endpoints and route-anchor joins

- Changed areas: browser coverage now reconnects a free endpoint to a component terminal. The SVG renderer overlays a sharp, render-only miter bridge for exactly two routes meeting at a `route-anchor`; route coordinates, endpoints, and electrical topology…
- Validation: focused renderer Vitest 1/1, focused manual-editor Playwright 1/1, editor production build, and `git diff --check` passed.
- Commit status: pending.

## 2026-08-10 - Editor chrome modernization

- Changed areas: editor-only CSS tokens and styling for the header, command menus, component palette and library, Selection shelf, Help dialog, status feedback, focus states, canvas frame, reduced motion, and desktop-width adaptations. No formal SVG body,…
- Validation: owned-file Prettier check passed; editor App Vitest passed 11/11; editor production build passed; six focused Playwright interaction/layout checks passed, including stable canvas width and direct-pin…
- Commit status: prepared for `feat(editor): modernize the editor chrome` on `codex/modernize-editor-chrome`; concurrent canvas-drag-session work remains untouched and unstaged.

## 2026-08-10 - Drafting floating-control consolidation

- Changed areas: removed the Selection `Drawing style` section; moved Lock/Unlock into the drafting float; retained arrow head size there; limited `Curve segment` to multi-segment construction lines; added deterministic arrow grid sizing/viewBox clamping a…
- Validation: focused drafting Playwright passed 5/5 with geometric overflow assertions; App Vitest passed 11/11; editor dependencies and production build passed; owned-file Prettier and `git diff --check` passed.…
- Commit status: pending. Shared `App.tsx` and drafting-test files contain separately owned uncommitted drag-session work, and the branch is already ahead with external commits; no mixed commit was created.

## 2026-08-10 - Curved free-arrow head follow-through

- Changed areas: formal SVG now obtains shaft truncation and head orientation from one final-segment tangent helper. The editor swaps only the dragged drafting object into a transient render document during a handle drag, so the formal shaft and arrowhead…
- Validation: focused render/derived Vitest passed 27/27; renderer and editor TypeScript checks, editor production build, and `git diff --check` passed.
- Commit status: not committed. This narrow follow-up overlaps dirty shared `App.tsx` with other active canvas interaction targets; no files were staged.

## 2026-08-10 - Drafting rectangle tool

- Changed areas: Project schema now persists rectangle center, dimensions, bearing, and line style; derived geometry supplies four rotated corners and export bounds; formal SVG renders a transparent outline. The editor provides two-corner live creation, pr…
- Validation: focused derived/render Vitest passed 29/29; focused Playwright passed 2/2 for shortcut creation, selection, four handles, resize, styling, and Shift+R rotation; all workspace packages built; editor T…
- Commit status: not committed. Shared editor, E2E, docs, renderer, and log files contain unrelated dirty work; no files were staged.

## 2026-08-10 - Unified canvas interaction session

- Changed areas: one shared pointer session; semantic hit ranking with selected target stickiness and `Alt` candidate cycling; direct temporary SVG transforms/polyline previews; unsnapped grab-offset-preserving movement with snap deferred to pointer-up; du…
- Validation: focused interaction modules passed 10/10 Vitest; App passed 11/11; ten focused manual/drafting Playwright gestures passed, including live movement before revision commit, component/label targeting, f…
- Commit status: pending because shared editor/test/spec/log files contain completed but uncommitted concurrent UI, rectangle, and route targets; no mixed staging was performed.

## 2026-08-10 - Stable instance annotation translation

- Changed areas: pure `move_instance` translation now applies the painted delta directly instead of rerunning transform placement; a shared helper also keeps free/object anchor fallbacks synchronized for port movement and instance alignment. Rotation and m…
- Validation: Edit Engine plus Agent service passed 60/60 tests; three focused editor gestures passed, including two consecutive moves of a rotated component with a constant label vector; Edit Engine/editor builds…
- Commit status: prepared directly on `main` as explicitly requested.

## 2026-08-10 - Razavi symbol construction experience

- Changed areas: added a two-part note covering reusable methodology and the concrete evidence, asset, generator, renderer, and fidelity-script paths. It records reference-owned registration, electrical/visual coordinate separation, canonical family geomet…
- Validation: local links and named paths checked; target-only Markdown diff reviewed; `git diff --check` passed.
- Commit status: pending isolated staging because `plan/log.md` contains unrelated concurrent target entries.

## 2026-08-10 - Unified Razavi visual contract and fidelity registry

- Changed areas: added one accepted Razavi visual contract; converted the old style and extension specs into redirects; corrected active navigation and formal Port terminology; moved all 15 fidelity target declarations from the CLI into one manifest-pinned…
- Validation: `symbols:razavi:check` passed; Model, Symbols, Derived, Render-SVG, and Exporters builds passed; all 15 registered fidelity targets completed with the pre-refactor scores preserved; catalog Vitest pa…
- Commit status: pending isolated staging because the branch and shared `plan/log.md` contain unrelated concurrent target work.

## 2026-08-10 - Integrate modernized editor work

- Changed areas: integrated the completed drafting controls, rectangle tool, unified canvas drag session, topology-aware route movement, renderer/model support, Razavi visual contract and registry, documentation, experience note, fixtures, scripts, and the…
- Validation: changed-file Prettier, `references:check`, `symbols:razavi:check`, root typecheck, 46/46 focused Vitest cases, all workspace builds, 23/23 focused Playwright cases, and `git diff --check` passed. Ful…
- Commit status: ready to commit as `feat(editor): unify drafting interactions and visual contracts`, then merge to `main` and push both branches.

## 2026-08-10 - Rectangle outline hit testing

- Changed areas: the rectangle editor overlay now uses a transparent, stroke-only fixed-pixel hit band; selected rectangles no longer fill their interior; marquee selection tests the four outline segments instead of the rectangle's filled bounds; the focus…
- Validation: changed-file Prettier passed; editor TypeScript passed; focused Playwright passed 1/1; editor production build passed; `git diff --check` passed.
- Commit status: prepared on `codex/fix-rectangle-hit-testing` for focused staging, commit, and push.

## 2026-08-10 - Remove redundant visual documentation redirects

- Changed areas: removed the former Razavi style, component-extension, VSS import, architecture-review, Phase 5, and Agent style-canon redirect files; pointed active specifications, roadmaps, ADR, and Circuit Layout Skill routing directly to the unified co…
- Validation: all six targets are absent; every changed-document local link resolves; no active Markdown link targets a removed path; changed-file formatting was reviewed without normalizing unrelated tables, and…
- Commit status: ready to commit on `agent/fix-ci-baseline` as `docs: remove redundant visual redirects` after the user authorized taking ownership of the previously concurrent changes.

## 2026-08-10 - Archive completed foundation plans

- Changed areas: added the `plan/archived/` retention policy and monthly layout; moved 12 completed plans into `plan/archived/2026-08/`; documented the archive from `plan/README.md`; updated three historical log references. Plans with unresolved work or ex…
- Validation: all 12 archived `plan.md` blobs match their original `HEAD` blobs; all source directories are absent and destinations exist; local Markdown links resolve; remaining old-root strings occur only as his…
- Commit status: ready to commit on `agent/fix-ci-baseline` after the user authorized taking ownership of the previously concurrent changes.

## 2026-08-10 - Archive completed plans and slim the planning protocol

- Changed areas: moved 42 byte-preserved completed plans into `plan/archived/2026-08/`; added their commit index; introduced required `status` and `experience` metadata for future plans; reduced the single plan template to a compact ownership/validation co…
- Validation: every selected plan has an outcome and Git evidence; all 42 archived blobs match their original `HEAD` blobs; sources are absent and destinations exist; local Markdown links resolve; remaining old-ro…
- Commit status: ready to commit on `agent/fix-ci-baseline` as `docs(plan): archive completed plans and clarify protocol` after the user authorized taking ownership of the previously concurrent changes.

## 2026-08-10 - Extract drafting creation preview

- Changed areas: added a six-input SVG preview component; centralized Canvas rectangle normalization and polyline serialization; added Canvas geometry contract tests; reduced App by 112 lines.
- Validation: 14 focused Vitest tests and four drafting Playwright flows passed; typecheck, editor production build, and `git diff --check` passed.
- Commit status: ready to commit on `agent/fix-ci-baseline` as `refactor(editor): extract drafting creation preview`.

## 2026-08-10 - Extract canvas text editor overlay

- Changed areas: added a focused overlay component and pure frame resolver; covered normal, scaled, translated, and four-edge-constrained layout; replaced the inline App render closure with the component while retaining all callbacks in App.
- Validation: 15 focused Vitest tests and six text-editing Playwright flows passed; repository typecheck, editor production build, changed-file Prettier, and `git diff --check` passed. The existing large-chunk bui…
- Commit status: ready to commit on `agent/fix-ci-baseline` as `refactor(editor): extract canvas text editor overlay`.

## 2026-08-10 - Extract selection inspector details

- Changed areas: introduced a typed inspector snapshot and shared diagnostic summary; moved metrics, import diagnostics, structural issues, and visual observations into a focused component; each diagnostic category is now rendered from its own partition ra…
- Validation: 13 focused Vitest tests and two manual-editor Playwright flows passed; repository typecheck, editor production build, changed-file Prettier, and `git diff --check` passed. The existing large-chunk wa…
- Commit status: ready to commit on `agent/fix-ci-baseline` as `refactor(editor): extract selection inspector details`.

## 2026-08-10 - Centralize wire editing contract

- Changed areas: added pure complete-wire, free-anchor, and snapped route-tap proposal builders; moved `WireSource` ownership to the wire domain while preserving an interaction-state compatibility export; replaced App's manual merge/connect/route edit asse…
- Validation: 25 focused Vitest tests and six manual-editor Playwright wire flows passed, followed by the full 423-test Vitest suite and all 59 Playwright flows; repository typecheck, editor production build, chan…
- Commit status: ready to commit on `agent/fix-ci-baseline` as `refactor(editor): centralize wire editing contract`.

## 2026-08-10 - Add component insertion dialog and refine workspace

- Changed areas: component-insert and icon features, editor shell/shortcuts, Inspector/Guide/drafting interactions, responsive styling, E2E isolation, interaction specification, and focused tests.
- Validation: 26 focused Vitest tests, repository typecheck, dependency-aware editor build, all 61 Playwright flows, full format check, real browser visual inspection, and `git diff --check` passed.
- Commit status: ready to commit on `codex/insert-component-dialog` as `feat(editor): add component insert dialog and refine workspace`.

## 2026-08-10 - Unified editor Snap Engine

- Changed areas: added the pure Snap Engine and candidate builder; migrated instance/group, Drafting, Guide, and Wire interactions; added transient smart guides, live Alt suppression, off-grid candidate rejection, and current- selection Align; removed the…
- Validation: 29 focused Vitest tests, repository typecheck, editor production build, changed-file Prettier, and `git diff --check` passed. The existing large-chunk warning remains; loopback browser automation was…
- Commit status: ready to commit on `agent/fix-ci-baseline` as `feat(editor): unify snap and alignment interactions`.

## 2026-08-10 - Preserve MOS label side through rotation

- Changed areas: made the Edit Engine recognize MOS symbols by terminal roles, preserve their rigid semantic label anchor, and derive upright alignment from normalized local displacement; added full-cycle NMOS/PMOS regressions for both four-terminal varian…
- Validation: 23 focused Edit Engine/render placement tests, Edit Engine build, repository typecheck, and `git diff --check` passed.
- Commit status: ready to commit on `agent/fix-ci-baseline` as `fix(edit-engine): preserve mos label side through rotation`.

## 2026-08-10 - Place rotated MOS labels outside visible symbols

- Changed areas: introduced shared Derived instance-label placement, exposed variant-aware visible symbol bounds, routed renderer/editor/Edit Engine MOS labels through the same geometry, and separated painted baseline position from semantic transform offse…
- Validation: 90 focused tests, three affected package builds, repository typecheck, `git diff --check`, and live browser rectangle measurements at all four orientations passed with zero overlaps.
- Commit status: ready to commit on `agent/fix-ci-baseline` as `fix(render): place rotated mos labels outside visible symbols`.

## 2026-08-10 - Organize editor source by domain

- Changed areas: moved 57 modules and colocated tests under `app`, `interaction`, `canvas`, `document`, `components`, `demos`, `presentation`, and five `features` domains; kept only build/runtime infrastructure at the source root; repaired relative imports…
- Validation: all 68 editor TypeScript relative imports resolve; 77 Vitest files and 440 tests, repository typecheck, editor production build, all 59 Playwright flows, changed-file Prettier, and `git diff --check`…
- Commit status: ready to commit directly on local `main` as `refactor(editor): organize source by domain`; remote push remains pending.

## 2026-08-10 - Simplify wire deletion and flightline guidance

- Changed areas: added deterministic `cut_connection` Net partitioning and Agent API artifacts; routed GUI Route/Junction/mixed deletion through it; removed Unroute from the inspector; changed flightlines to nearest-frontier straight-line MST hints with cl…
- Validation: 43 focused Vitest tests, four focused Playwright flows, repository typecheck, affected package/editor builds, Agent API artifact check, and `git diff --check` passed. The existing large-chunk warning…
- Commit status: ready to commit on `main` as `fix(editor): simplify wire deletion and flightline guidance`.

## 2026-08-11 - Fix partial SPICE wire deletion

- Changed areas: made `cut_connection` preserve logical membership for already-partial and global Nets while still partitioning deterministic fully routed local Nets; renamed the GUI action to `Delete wire`; updated routing specifications and imported-part…
- Validation: 22 focused Edit Engine tests, two focused Playwright flows, repository typecheck, affected builds, and `git diff --check` passed. The existing large-chunk warning remains.
- Commit status: ready to commit on `main` as `fix(editor): allow deleting routed parts of imported nets`.

## 2026-08-10 - Enforce a Razavi-only product symbol catalog

- Changed areas: reduced the runtime and Component Library to ten reviewed Razavi symbols; deleted legacy diode/inductor/BJT assets and generic-block generation; restricted PDK/import mappings; rejected unsupported Project open/recovery; updated routing fi…
- Validation: 440 workspace unit tests, repository typecheck, full build, focused unsupported-import Playwright flow, Razavi catalog and visual-golden checks, changed-file Prettier, and `git diff --check` passed.…
- Commit status: ready to commit on `main` as `refactor(symbols): enforce Razavi-only product catalog`.

## 2026-08-10 - Unify group and routed-marker movement

- Changed areas: mainline branch integration, composite-selection hit precedence and live group preview, bounded route-attachment drag, common dashed marker selection, compact command surface, interaction specification, and focused unit/E2E regressions.
- Validation: repository typecheck, editor production build, 447 Vitest tests, 62 Playwright flows plus enhanced focused preview checks, full format check, browser inspection, and `git diff --check` passed. One in…
- Commit status: ready to commit on `codex/insert-component-dialog` as `fix(editor): unify group and routed marker movement`.

## 2026-08-10 - Preserve route markers through geometry edits

- Changed areas: group preview membership, canonical Edit Engine marker projection across Route geometry changes and Junction splits, bend-direction tie-breaking, interaction specification, and focused unit/E2E regressions.
- Validation: affected production builds, repository typecheck, format check, 448 Vitest tests, 63 Playwright flows, in-app browser inspection, and `git diff --check` passed.
- Commit status: ready to commit on `codex/insert-component-dialog` as `fix(editor): preserve route markers through geometry edits`.

## 2026-08-10 - Merge advanced GUI and Page mainline

- Changed areas: resolved the editor shell and E2E merge; retained the modal component insert flow, floating Inspector, group/route-marker interaction, Page open/recovery, unsupported-symbol rejection, clickable flightlines, and `cut_connection`; adapted t…
- Validation: Razavi catalog check, repository typecheck, 448 Vitest tests, editor production build, Agent API artifact check, 65 Playwright flows, changed-file Prettier, live main GUI inspection, and `git diff --…
- Commit status: ready to commit on `main` as `merge: integrate advanced editor GUI with mainline`.

## 2026-08-10 - Add PDF-derived Razavi inductor

- Changed areas: standalone PDF extractor and provenance, compatible hash-pinned `vectorEvidence` manifest entries, continuous inductor Symbol, catalog/editor/SPICE registration, visual-contract ADR/specification, and focused authority/catalog/import tests.
- Validation: source fingerprint and extractor reproducibility, generator stale checks, affected package builds, repository typecheck, 34 focused tests, changed-file formatting, inductor fidelity diff (IoU `0.7849…
- Commit status: ready to commit on `main` as `feat(symbols): add PDF-derived Razavi inductor`.

## 2026-08-11 - Add PDF-derived Razavi op-amp

- Changed areas: Figure 8.26 object extractor, isolated witness and manifest provenance, generated op-amp Symbol, Analog Blocks palette registration, catalog tests, and PDF-evidence documentation.
- Validation: exact extractor reproduction, generator stale checks, symbols and editor production builds, repository typecheck, 31 focused tests, changed-file formatting, op-amp fidelity diff (IoU `0.7330`, soft I…
- Commit status: ready to commit on `main` as `feat(symbols): add PDF-derived Razavi op-amp`.

## 2026-08-11 - Stabilize component insert dialog layout

- Changed areas: fixed dialog row sizing, internally scrolling component list, fixed symbol-preview dimensions, and focused browser regression coverage.
- Validation: three focused Playwright flows, repository typecheck, editor production build, focused Prettier check, live in-app browser inspection, and `git diff --check` passed.
- Commit status: ready to commit on `main` as `fix(editor): stabilize component insert dialog layout`.

## 2026-08-11 - Add common Razavi device families

- Changed areas: separated PDF extraction and hash-pinned witnesses, seven generated Symbol assets, catalog and GUI registration, exact SPICE `D`/`Q`/`G` mappings, per-measurement fidelity witnesses, and electrical composition fixture/documentation.
- Validation: extractor/source integrity, generator stale checks, 64 affected tests plus 37 focused authority tests, repository typecheck, affected builds, seven registered fidelity diffs, targeted formatting, and…
- Commit status: ready to commit on `main` as `feat(symbols): add common Razavi device families`.

## 2026-08-11 - Correct common Razavi source fidelity

- Changed areas: direct Figure 12.6/12.11 NPN/PNP arrows, Figure 15.54 outline diode, Figure 2.37 VCCS arrow and provenance, Razavi emphasis stroke, catalog and GUI removal of transformer, authority hashes, fidelity targets, and correction documentation/te…
- Validation: generator and authority stale checks, 35 focused tests, affected builds, repository typecheck, editor production build, five registered fidelity comparisons, live GUI inspection, formatting, and `git…
- Commit status: ready to commit on `main` as `fix(symbols): correct common Razavi source fidelity`.

## 2026-08-11 - Remove VCCS and normalize compact-device scale

- Changed areas: VCCS asset/evidence/catalog/GUI/import removal, retained SPICE `G` syntax/IR with unsupported graphical-import diagnostics, retired hybrid-pi fixture, and uniform `2/3` scaling of NPN, PNP, diode, and ideal switch from 60-unit to 40-unit p…
- Validation: authority and generator checks, 39 focused tests, affected builds, repository typecheck, editor production build, four fidelity diffs, live GUI inspection, formatting, and `git diff --check` passed.…
- Commit status: ready to commit on `main` as `fix(symbols): remove VCCS and normalize device scale`.

## 2026-08-11 - Calibrate Razavi ideal switch

- Changed areas: corrected PDF selection bounds and five-object fingerprint, source-stroke normalization, 60-unit pin span, contact/blade geometry, raster witness, authority hashes, generated Symbol/catalog registration, and focused regression expectations.
- Validation: common/catalog stale checks, symbols build, 23 focused tests, Python compile check, ideal-switch fidelity IoU 0.9814 with anti-alias-only residuals, and `git diff --check` passed.
- Commit status: ready to commit on `main` as `fix(symbols): calibrate Razavi ideal switch`.

## 2026-08-11 - Repair switch and BJT joints

- Changed areas: contact-boundary lead termination; corrected PNP Figure 12.11 selection; uniformly scaled NPN/PNP source geometry; arrow-polygon clipping; joined branch/lead polylines; regenerated evidence, witnesses, catalog, and runtime registration; fo…
- Validation: common/catalog stale checks, symbols build, 23 focused tests, Python compile and focused formatting checks, fidelity IoU 0.9814/0.9846/ 0.9901 for switch/NPN/PNP with anti-alias-only residuals, and `…
- Commit status: ready to commit on `main` as `fix(symbols): repair switch and BJT joints`.

## 2026-08-11 - Close BJT arrow seams

- Changed areas: bounded 1.2-unit centerline overlap inside both native arrow polygons, regenerated NPN/PNP evidence and witnesses, catalog/runtime output, and focused overlap-coordinate assertions.
- Validation: common/catalog stale checks, symbols build, 23 focused tests, focused formatting and Python compile checks, GUI-equivalent 8x visual inspection, fidelity IoU 0.9861/0.9909 for NPN/PNP with anti-alias…
- Commit status: ready to commit on `main` as `fix(symbols): close BJT arrow seams`.

## 2026-08-11 - Use PMOS-style PNP arrow support

- Changed areas: rigidly translated, source-orientation-preserving PNP arrow with its true tip at the base bar, single rear support to the emitter lead, regenerated evidence/witness/catalog/runtime output, and a no-tip-line regression.
- Validation: common/catalog stale checks, symbols build, 23 focused tests, focused formatting and Python compile checks, GUI-equivalent 8x visual inspection, PNP fidelity IoU 0.9880 with all residual pixels confi…
- Commit status: ready to commit on `main` as `fix(symbols): use PMOS-style PNP arrow support`.

## 2026-08-11 - Add Razavi closed switch

- Changed areas: isolated PDF-vector evidence and witness, contact-clipped closed geometry, common measurement and fidelity registration, palette and runtime catalog, plus focused geometry assertions.
- Validation: source object topology and authority hashes, common/catalog stale checks, symbols build, 23 focused tests, enlarged raster inspection, closed switch fidelity IoU 0.9866 with anti-alias-only residuals…
- Commit status: ready to commit on `main` as `feat(symbols): add Razavi closed switch`.

## 2026-08-11 - Correct closed-switch PDF crop

- Changed areas: direct PDF crop witness, exact two-lead/two-contact/angled blade extraction, witness-owned fidelity window propagation, regenerated Symbol/catalog output, and a regression asserting source-PDF witness kind.
- Validation: native object fingerprint (5 objects), source crop inspection, common/catalog stale checks, symbols build, 23 focused tests, Python compile, enlarged reference/render/diff inspection, fidelity IoU 0.…
- Commit status: ready to commit on `main` as `fix(symbols): correct Razavi closed switch evidence`.

## 2026-08-11 - Correct PDF-derived fidelity baselines

- Changed areas: explicit source-page crop protocol and fixed witness windows for common assets, source-PDF witnesses for op-amp and inductor, manifest hashes/measurements, authority enforcement, visual-contract/ADR wording, and editor palette grouping.
- Validation: Python compilation, common/inductor/op-amp/catalog stale checks, symbols build, 27 focused tests, eight PDF-derived fidelity reports, and `git diff --check` passed. The direct references reveal real…
- Commit status: ready to commit on `main` as `fix(symbols): use source PDF crops for common fidelity baselines`.

## 2026-08-11 - Calibrate shared Razavi BJT arrow template

- Changed areas: one Figure 12.6-derived arrow template, a measured 1.18x magnification, mirrored PNP placement, regenerated BJT evidence/assets and catalog, plus a congruence regression for the two arrow triangles.
- Validation: Python compilation, common/catalog stale checks, symbols build, 23 focused tests, NPN/PNP direct-PDF fidelity reports, and `git diff --check` passed. Arrow-region black-pixel deficit improved from 25…
- Commit status: ready to commit on `main` as `fix(symbols): unify Razavi BJT arrow geometry`.

## 2026-08-11 - Calibrate diode and voltage-amplifier PDF geometry

- Changed areas: source-PDF witness windows/origins, diode body scale and target rotation, direct-vector voltage-amplifier triangle coordinates, manifest-pinned evidence/catalog output, fidelity runner registration reporting/target validation, and focused…
- Validation: Python compile, common/catalog stale checks, symbols build, 24 focused tests, and direct-PDF fidelity reports. Diode reached IoU 0.8800 with no registration translation; voltage amplifier reached 0.7…
- Commit status: ready to commit on `main` as `fix(symbols): calibrate diode and voltage amplifier geometry`.

## 2026-08-11 - Stabilize default instance-label placement

- Changed areas: shared derived label-placement helper, attached-label rotation path, and focused BJT/default-label regressions.
- Validation: 14 focused derived/editor/edit-engine tests, derived and edit-engine TypeScript builds, editor Vite production build, and `git diff --check` passed.
- Commit status: ready to commit on `main` as `fix(labels): stabilize default instance text placement`.

## 2026-08-11 - Correct label side inference and clearance

- Changed areas: derived side inference/default anchors, BJT clearance and rotation regressions, plus adjusted legacy MOS default-label expectation.
- Validation: 14 focused tests, derived/edit-engine TypeScript builds, editor production build, and `git diff --check` passed.
- Commit status: ready to commit on `main` as `fix(labels): correct rotated text side and clearance`.

## 2026-08-11 - Correct Razavi switch lead and contact geometry

- Changed areas: common PDF-vector switch normalization, direct-PDF evidence and manifest hashes, generated assets/catalog, and focused switch geometry assertions.
- Validation: Python compile, common/catalog stale checks, symbols build, 23 focused tests, direct-PDF switch diffs, and `git diff --check` passed. Closed-switch IoU is 0.9840; ideal-switch residual is expected be…
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as `fix(symbols): align Razavi switch leads and contacts`.

## 2026-08-11 - Close ideal-switch blade/contact gap

- Changed areas: common switch extraction constant/clip, regenerated ideal-switch evidence/catalog output, and exact clearance regression.
- Validation: Python compile, common/catalog stale checks, symbols build, 23 focused tests, direct-PDF fidelity report, and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as `fix(symbols): close ideal switch blade contact gap`.

## 2026-08-11 - Rename ideal switch as open switch

- Changed areas: common source definition, regenerated source evidence/catalog, and catalog name regression.
- Validation: Python compile, common/catalog stale checks, symbols build, 23 focused tests, and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as `fix(symbols): rename ideal switch as open switch`.

## 2026-08-12 - Close VDD stem/bar seam

- Changed areas: VDD asset, regenerated catalog output/hash, and an interior stem/bar-overlap regression.
- Validation: catalog stale check, symbols build, 20 focused catalog tests, and `git diff --check` passed. The branch-local commit remains subject to the required clean-state CI and remote Actions gate before main…
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `fix(symbols): close VDD stem and bar seam`.

## 2026-08-11 - Contextual Properties and Net Labels

- Changed areas: typed property patch/undo/Agent capability artifacts; manual insert Value handoff; fixed Properties dock for component and drawing edits; route-anchored `L` Net Label editor; `P` construction line; import-only review; specs and focused UI…
- Validation: 50 focused Vitest tests, workspace typecheck, regenerated Agent API artifacts, production editor build, and 69 E2E tests passed. Full `pnpm test` is blocked by eight unrelated render/symbol golden fa…
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as `feat(editor): add contextual properties and net labels`.

## 2026-08-11 - Virtuoso-style Insert Dialog and Explicit Properties

- Changed areas: shared R/L/C and MOS parameter catalogue; temporary placement request; collapsed in-column component picker; orientation/reference setup; component Properties fields; reference-label suppression; interaction spec; and targeted E2E regressi…
- Validation: focused Vitest tests (20), workspace typecheck, production editor build, complete editor E2E suite (70), and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as `feat(editor): refine Virtuoso-style component insertion`.

## 2026-08-11 - Component Placement Event Capture

- Changed areas: canvas gesture precedence, click-time placement commit, and a semantic-click E2E regression.
- Validation: component insertion E2E (6), workspace typecheck, production editor build, and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as `fix(editor): capture all component placement clicks`.

## 2026-08-11 - Compact Insert-Control Layout

- Changed areas: compact rotation/label/name row, inline parameter unit/help labels, explicit component-search accessibility name, dialog styles/spec, and affected insertion helpers/regressions.
- Validation: focused Vitest tests, workspace typecheck, production editor build, complete editor E2E suite (71), and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as `refactor(editor): compact component insertion controls`.

## 2026-08-11 - Compact Component Properties

- Changed areas: instance overview, inline parameter labels, one-row X/Y/Rotate controls, compact property styles, interaction specification, and focused Properties regression.
- Validation: focused Vitest tests (16), component insertion E2E (6), workspace typecheck, production editor build, and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as `refactor(editor): compact component properties`.

## 2026-08-11 - Restore Fit View Shortcut

- Changed areas: shortcut resolver/tests, unreachable mirror shortcut dispatch, and interaction contract.
- Validation: focused shortcut/App tests (21), workspace typecheck, production editor build, and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as `fix(editor): restore F fit view shortcut`.

## 2026-08-11 - Virtuoso-Style Copy Placement and Mirror Shortcuts

- Changed areas: shortcut resolver, clipboard preview helper, transient copy placement in the canvas, Edit menu/help/contract, and group-copy/mirror/Esc regressions.
- Validation: focused tests (23), key manual-editor E2E (4), workspace typecheck, production build, complete editor E2E (72), and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as `feat(editor): add copy placement shortcuts`.

## 2026-08-11 - Correct Mirror Shortcut Copy

- Changed areas: Edit mirror actions, selected-component Properties actions, Help guidance, and the target record. The interaction specification already had the correct mapping and was inspected without modification.
- Validation: obsolete-label search, production editor build, and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as `fix(editor): correct mirror shortcut labels`.

## 2026-08-11 - Compact Properties Mirror Actions

- Changed areas: selected-component Properties markup and compact mirror-row styles, plus target records.
- Validation: production editor build and `git diff --check` passed.
- Commit status: ready to commit on `codex/contextual-properties-net-labels` as `refactor(editor): compact properties mirror actions`.

## 2026-08-12 - Connectivity, Routing, and Electrical Debugging Plan

- Changed areas: cross-cutting roadmap, preservation/migration matrix, 11 bounded work packages, deterministic gates, and roadmap index.
- Validation: current behavior helper audit, referenced-path check, new-plan Prettier check, and `git diff --check` passed.
- Commit status: ready to commit on `main` as `docs(roadmap): plan connectivity and routing unification`.

## 2026-08-12 - Cloudflare Deployment

- Changed areas: Workers Static Assets configuration, SPA fallback, custom domain binding, GitHub Actions deployment, and repository secrets.
- Validation: frozen dependency install, production build, Wrangler dry-run, pull request CI matrix, successful production deployment, HTTP 200 root/SPA requests, and PWA manifest inspection.
- Commit status: merged through pull request #5 as `99914d8`; production is live and the Action-wrapper follow-up is recorded separately.

## 2026-08-12 - Cloudflare Workflow Fix

- Changed areas: direct pinned Wrangler invocation and documentation-only path exclusions.
- Validation: direct production deploy, Wrangler dry-run, all five pull request CI jobs, successful `main` Cloudflare workflow, and live URL checks passed.
- Commit status: merged through pull request #6 as `b7a4424`.

## 2026-08-12 - Visitor Analytics

- Changed areas: Worker API, SQLite-backed Durable Object, bounded privacy filters, custom-domain-only tracking, editor totals link, noindex dashboard, world heatmap, tests, and Cloudflare migration/configuration.
- Validation: 475 unit/integration tests, release contracts, focused analytics browser test, remote five-job CI matrix, Wrangler dry-run, successful Cloudflare deploy, live PV/UV/dimension reads, and cross-site/DN…
- Commit status: merged through pull request #8 as `4b9a09e`; production is live at `https://analog-canvas.tokenzhang.com/analytics`.

## 2026-08-12 - WP-R0 Connectivity/Routing Behavioral Baseline

- Changed areas: new `packages/derived/src/endpoint.test.ts` (14 tests) and `packages/derived/src/routes.test.ts` (7 tests) covering `endpointKey`, endpoint visibility/point/outward-direction, `routePolyline`, `deriveCrossings` overlap and shared-endpoint…
- Validation: workspace `pnpm typecheck`, `vitest run packages/derived/src/` (76 tests, was 55), `prettier --check` on owned files, and `git diff --check` passed. Full-repo/e2e deferred (additive tests + doc note…
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `test(derived): characterize endpoint/route primitives and partition invariance (WP-R0)`.

## 2026-08-12 - WP-R1 ADR and Spec Freeze

- Changed areas: new ADRs 0013 (Project Connectivity Index), 0014 (Resolved Route Geometry), 0015 (Object Locator + Diagnostic Envelope); schematic-model spec proposed NoConnect + binding-evidence subsection; connectivity-and- routing spec proposed unified…
- Validation: cross-link audit (12/12 referenced paths resolve); `git diff --check` clean. Markdown outside the `format:check` glob; no code surface changed.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `docs(adr): freeze connectivity index, resolved geometry, and locator contracts (WP-R1)`.

## 2026-08-12 - WP-R2 Additive Project Connectivity Index

- Changed areas: new `packages/derived/src/connectivity-index.ts` and `connectivity-index.test.ts` (9 tests); `packages/derived/src/index.ts` re-export; target plan and this log.
- Validation: workspace `pnpm typecheck`; `vitest run packages/derived/src/` (85 tests, was 76); `prettier --check` on new files; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(derived): add ProjectConnectivityIndex with flightline normalization (WP-R2)`.

## 2026-08-12 - WP-R3 Additive Resolved Route Geometry

- Changed areas: new `packages/derived/src/resolved-route-geometry.ts` and `resolved-route-geometry.test.ts` (7 tests); `packages/derived/src/index.ts` re-export; target plan and this log.
- Validation: workspace `pnpm typecheck`; `vitest run packages/derived/src/` (92 tests, was 85); `prettier --check` on new files; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(derived): add ResolvedRouteGeometry with endpoint join ingredients (WP-R3)`.

## 2026-08-12 - WP-R4 Route-Tap Planner Extraction (App thin-out step 1)

- Changed areas: new `apps/editor/src/features/wiring/route-tap.ts` and `route-tap.test.ts` (6 tests); `apps/editor/src/app/App.tsx` imports the resolver instead of inlining it; target plan and this log.
- Validation: workspace `pnpm typecheck`; `vitest run route-tap.test.ts` (6) and `App.test.tsx` (11); `prettier --check` on changed files; `git diff --check`.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(editor): extract route-tap resolver from App into wiring feature (WP-R4)`.

## 2026-08-12 - WP-R5 Project Search Index (core)

- Changed areas: new `packages/derived/src/project-search.ts` and `project-search.test.ts` (7 tests); `packages/derived/src/index.ts` re-export; target plan and this log.
- Validation: workspace `pnpm typecheck`; `vitest run packages/derived/src/` (99 tests, was 92); `prettier --check` on new files; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(derived): add deterministic project search index (WP-R5)`.

## 2026-08-12 - WP-R6 Net Highlight and Cross-Cell Trace (core)

- Changed areas: new `packages/derived/src/net-highlight.ts` and `net-highlight.test.ts` (4 tests); `packages/derived/src/index.ts` re-export; target plan and this log.
- Validation: workspace `pnpm typecheck`; `vitest run packages/derived/src/` (103 tests, was 99); `prettier --check` on new files; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(derived): compute net highlight and cross-cell trace from the index (WP-R6)`.

## 2026-08-12 - WP-R7 NoConnect Schema and v2 -> v3 Migration

- Changed areas: `packages/model/src/schema.ts` (NoConnect, version 3, invariant, types); new `migration-v2-to-v3.ts` + test; `persistence.ts` registration; cascade `noConnects: []` added to typed document literals (`factories`, `importer`, 3 test helpers)…
- Validation: workspace `pnpm typecheck`; full `pnpm test` — 524 passed, 8 failed. The 8 failures are pre-existing and unrelated (confirmed by stashing R7 — same 8 fail on clean branch): instance-label/golden/Raza…
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(model): add NoConnect record with v2->v3 schema migration (WP-R7)`.

## 2026-08-12 - WP-R8 ERC Engine (framework + core rules)

- Changed areas: new `packages/derived/src/diagnostics/erc.ts` and `erc.test.ts` (6 tests); `packages/derived/src/index.ts` re-export; target plan and this log.
- Validation: workspace `pnpm typecheck`; `vitest run packages/derived/src/` (109 tests, was 103); `prettier --check` on new files; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(derived): add ERC engine emitting the unified diagnostic envelope (WP-R8)`.

## 2026-08-12 - WP-R9 Diagnostic Aggregation (data layer)

- Changed areas: new `packages/derived/src/diagnostics/diagnostic.ts` and `diagnostic.test.ts` (3 tests); `packages/derived/src/index.ts` re-export; target plan and this log.
- Validation: workspace `pnpm typecheck`; `vitest run packages/derived/src/` (112 tests, was 109); `prettier --check` on new files; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(derived): unify diagnostics into a single sorted envelope (WP-R9)`.

## 2026-08-12 - WP-R10 Deletion-Gate Parity and Migration Gate Status

- Changed areas: new `packages/derived/src/deletion-gate-parity.test.ts` (8 tests: flightline content + route centerline parity across four fixtures); target plan (gate-status record + ordered switch plan); this log.
- Validation: workspace `pnpm typecheck`; `vitest run packages/derived/src/` (120 tests, was 112); `prettier --check` on new file; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `test(derived): add old/new deletion-gate parity tests (WP-R10)`.

## 2026-08-12 - Connectivity Recovery C0: status and contract reconciliation

- Changed areas: roadmap status matrix and C0–C10 recovery waves; ADR 0013–0015 amendments for staged index/cache, route-geometry/remap, and canonical locator/diagnostic ownership; target plan and this log.
- Validation: reviewed cross-references and ran `git diff --check`; no runtime or schema behavior changed.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `docs(roadmap): reconcile connectivity delivery status`.

## 2026-08-12 - Connectivity Recovery C1: canonical locator and diagnostic

- Changed areas: new `object-locator.ts`; connectivity index, search, ERC and visual diagnostic adaptation; focused locator-shape tests; target plan and this log.
- Validation: workspace `pnpm typecheck`; 25 focused derived tests; targeted Prettier; `rg` confirmed no production private locator declaration; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(derived): unify locator and diagnostic protocols`.

## 2026-08-12 - Connectivity Recovery C2a: NoConnect electrical lifecycle

- Changed areas: typed edit-engine add/remove operations and deletion guard; topology hash; Agent Snapshot schema/builder and edit classification; target plan and log.
- Validation: workspace `pnpm typecheck`; 20 focused topology-hash, Snapshot and transaction tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(noconnect): add editable electrical lifecycle core`.

## 2026-08-12 - Connectivity Recovery C2b: NoConnect clipboard transfer

- Changed areas: editor clipboard data/proposal and regression test; target plan and this log.
- Validation: workspace `pnpm typecheck`; 12 focused clipboard/transaction tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(editor): preserve NoConnect declarations through clipboard paste`.

## 2026-08-12 - Connectivity Recovery C3: route geometry semantics

- Changed areas: resolved route geometry types/resolver/tests; target plan and this log.
- Validation: workspace `pnpm typecheck`; 16 focused resolved-geometry and deletion-parity tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(derived): clarify route geometry identity and joins`.

## 2026-08-12 - Connectivity Recovery C4: complete document index

- Changed areas: connectivity index and focused tests; target plan and log.
- Validation: workspace `pnpm typecheck`; 18 focused connectivity-index and deletion-parity tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `perf(derived): complete cached document connectivity index`.

## 2026-08-12 - Connectivity Recovery C5a: Wire commit planner boundary

- Changed areas: new edit-engine routing planner and export; editor compatibility re-exports; target plan and log.
- Validation: workspace `pnpm typecheck`; 16 focused wire-path, wire-editing and transaction tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(wiring): move wire proposals into edit engine`.

## 2026-08-12 - Connectivity Recovery C6a: canonical project search backend

- Changed areas: project search and tests; target plan and log.
- Validation: workspace `pnpm typecheck`; 19 focused search/connectivity-index tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(search): use canonical locators and property keys`.

## 2026-08-12 - Connectivity Recovery C7a: bidirectional hierarchy Net trace

- Changed areas: derived Net trace and tests; target plan and log.
- Validation: workspace `pnpm typecheck`; 15 focused trace/index tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(derived): add bidirectional hierarchy Net trace`.

## 2026-08-12 - Connectivity Recovery C8a: ERC symbol and hierarchy interface

- Changed areas: derived ERC and tests; target plan and log.
- Validation: workspace `pnpm typecheck`; 18 focused ERC/index tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(erc): diagnose symbols and hierarchy interface mismatches`.

## 2026-08-12 - Connectivity Recovery C5b: route deletion planner boundary

- Changed areas: edit-engine routing planner, App Delete consumers, selection compatibility adapter/tests, target plan and log.
- Validation: workspace `pnpm typecheck`; 17 focused selection/wiring/ transaction tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(wiring): centralize visual route deletion planning`.

## 2026-08-12 - Connectivity Recovery C6b: project search UI

- Changed areas: editor search dialog, App integration/styles and focused E2E; target plan and log.
- Validation: workspace `pnpm typecheck`; focused Playwright search flow; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(editor): add Ctrl+F project search`.

## 2026-08-12 - Connectivity Recovery C7b: current-document Net highlight

- Changed areas: App highlight state/overlay and styles; focused E2E; target plan and log.
- Validation: workspace `pnpm typecheck`; two focused Playwright search and highlight flows; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(editor): highlight current-document Net membership`.

## 2026-08-12 - Connectivity Recovery C2c: formal NoConnect rendering

- Changed areas: SVG renderer and regression test; target plan and log.
- Validation: workspace `pnpm typecheck`; 24 focused render tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(render): render explicit NoConnect markers`.

## 2026-08-12 - Connectivity Recovery C2d: NoConnect endpoint editing

- Changed areas: editor endpoint action and focused browser regression; target plan and log.
- Validation: workspace `pnpm typecheck`; focused Playwright mark/clear flow; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(editor): edit NoConnect declarations from endpoints`.

## 2026-08-12 - Connectivity Recovery C8b: role-sensitive ERC policy

- Changed areas: derived ERC policy and role/NoConnect/hidden-variant tests; target plan and log.
- Validation: workspace `pnpm typecheck`; 11 focused ERC tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(erc): diagnose floating gates and hidden bulk risks`.

## 2026-08-12 - Connectivity Recovery C9a: current-document ERC inspector

- Changed areas: editor diagnostic derivation/navigation, Inspector section, scoped CSS, and focused component/browser tests; target plan and log.
- Validation: workspace `pnpm typecheck`; 2 focused Inspector tests; focused Playwright ERC flow; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(editor): surface current-document ERC diagnostics`.

## 2026-08-12 - Connectivity Recovery C8c: typed source binding evidence

- Changed areas: model instance schema, SPICE importer evidence, ERC policy, model spec, and focused importer/ERC tests; target plan and log.
- Validation: workspace `pnpm typecheck`; 23 focused model/SPICE/ERC tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(erc): consume typed source binding evidence`.

## 2026-08-12 - Connectivity Recovery C6c: canonical hierarchy navigation

- Changed areas: derived path resolver, editor navigation state/consumers, and focused hierarchy/App/browser regressions; target plan and log.
- Validation: workspace `pnpm typecheck`; 17 focused derived/App tests; two focused Playwright search/ERC flows; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(editor): navigate canonical locators across hierarchy`.

## 2026-08-12 - Connectivity Recovery C7c: hierarchy-aware Net highlight

- Changed areas: editor highlight state/trace consumer; target plan and log.
- Validation: workspace `pnpm typecheck`; 16 focused Net/App tests; focused Playwright Net-highlight flow; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(editor): retain Net highlights across hierarchy Cells`.

## 2026-08-12 - Connectivity Recovery C8d: imported pin mapping ERC

- Changed areas: derived ERC mapping policy and regression tests; target plan and log.
- Validation: workspace `pnpm typecheck`; 13 focused ERC tests; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(erc): diagnose stale imported pin mappings`.

## 2026-08-12 - Connectivity Recovery C6d: cross-Cell locator browser coverage

- Changed areas: minimal imported hierarchy fixture, editor Playwright flow, target plan and log.
- Validation: focused Playwright hierarchy navigation; 12 focused hierarchy/App unit tests; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `test(editor): cover cross-Cell locator navigation`.

## 2026-08-12 - Connectivity Recovery C9b: project ERC diagnostic navigation

- Changed areas: editor ERC shelf presentation and focused selection/browser tests; target plan and log.
- Validation: 14 focused selection/App unit tests; focused Playwright child ERC navigation; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(editor): navigate project ERC diagnostics`.

## 2026-08-12 - Connectivity Recovery C3d: formal render geometry consumer

- Changed areas: `@icm/render-svg` route rendering; target plan and log.
- Validation: 32 focused render/geometry tests including existing SVG goldens; workspace `pnpm typecheck`; static no-direct-`routePolyline` audit; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(render): consume resolved route geometry`.

## 2026-08-12 - Connectivity Recovery C3e: editor geometry read consumer

- Changed areas: editor route read model; target plan and log.
- Validation: 16 focused App/interaction tests; two focused Playwright route flows; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(editor): consume resolved route geometry for hits`.

## 2026-08-12 - Connectivity Recovery C8e: stale hierarchy interface ERC

- Changed areas: derived ERC hierarchy policy and regression tests; target plan and log.
- Validation: 14 focused ERC tests; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(erc): aggregate stale hierarchy interfaces`.

## 2026-08-12 - Connectivity Recovery C2e: editor indexed flightlines

- Changed areas: editor flightline read consumer; target plan and log.
- Validation: 21 focused App/index tests; three focused Playwright flightline flows; workspace `pnpm typecheck`; static no-direct-derivation audit; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(editor): consume indexed flightlines`.

## 2026-08-12 - Connectivity Recovery C3f: remaining editor geometry reads

- Changed areas: editor navigation and Net-label read consumers; target plan and log.
- Validation: 19 focused App/geometry tests; two focused Playwright label/search flows; workspace `pnpm typecheck`; static no-direct-call audit; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(editor): finish resolved route reads`.

## 2026-08-12 - Connectivity Recovery C10a: factual recovery status

- Changed areas: connectivity recovery status document; target plan and log.
- Validation: source consumer audit; full unit suite 568/568; full editor E2E 79/79; 500-instance performance check passed; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `docs(roadmap): record connectivity recovery status`.

## 2026-08-12 - Connectivity Recovery C9c: ERC severity filter

- Changed areas: ERC presentation filters and selection/browser tests; target plan and log.
- Validation: 14 focused selection/App tests; two focused Playwright ERC flows; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(editor): filter project ERC diagnostics`.

## 2026-08-12 - Connectivity Recovery C9d: unified diagnostic workbench

- Changed areas: editor diagnostic derivation/panel, selection and browser coverage, recovery status, target plan and log.
- Validation: 20 focused diagnostic/selection tests; three focused Playwright cross-Cell/ERC/visual flows; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(editor): unify ERC and visual diagnostics`.

## 2026-08-12 - Connectivity Recovery C3g: Agent resolved geometry reads

- Changed areas: Agent read consumers and parity tests; target plan and log.
- Validation: 21 focused Agent snapshot/service tests; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(agent): consume resolved route geometry`.

## 2026-08-12 - Connectivity Recovery C3h: visual resolved geometry reads

- Changed areas: derived visual diagnostic route reads and target plan/log.
- Validation: 16 focused visual/geometry/diagnostic tests; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(derived): consume resolved route geometry in visuals`.

## 2026-08-12 - Connectivity Recovery C3i: stretch resolved geometry reads

- Changed areas: derived stretch read inputs and target plan/log.
- Validation: 15 focused stretch/geometry tests; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(derived): consume resolved route geometry in stretch`.

## 2026-08-12 - Connectivity Recovery C10b: resolved-geometry audit

- Changed areas: visual diagnostic identity/test and factual recovery status; target plan and log.
- Validation: 569 workspace unit tests; 80 editor E2E tests; 500-instance performance gate; workspace `pnpm typecheck`; static consumer audit; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `docs(roadmap): audit resolved geometry migration`.

## 2026-08-12 - Connectivity Recovery C3j: drafting anchor geometry reads

- Changed areas: derived anchor/drafting resolution, anchor parity test, recovery status, target plan and log.
- Validation: 29 focused anchor/drafting/geometry tests; workspace `pnpm typecheck`; targeted Prettier; static consumer audit; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(derived): consume resolved geometry in drafting anchors`.

## 2026-08-12 - Connectivity Recovery C5a: committed wire manipulation planner

- Changed areas: routing planner/tests, editor commit path, target plan and log.
- Validation: 31 focused routing/stretch tests; two focused editor E2E flows; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(routing): plan committed wire manipulation in engine`.

## 2026-08-12 - Connectivity Recovery C5b: group move planner

- Changed areas: routing planner/tests, editor group commit path, target plan and log.
- Validation: 32 focused routing/stretch tests; two focused editor group-move E2E flows; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `refactor(routing): plan group move edits in engine`.

## 2026-08-12 - Connectivity Recovery C5c: routing planner status

- Changed areas: recovery status, target plan and log.
- Validation: static App/planner ownership audit; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `docs(roadmap): record routing planner migration`.

## 2026-08-12 - Connectivity Recovery C6a: hierarchy Net trace presentation

- Changed areas: selection trace panel/tests, editor navigation, browser hierarchy fixture flow, recovery status, target plan and log.
- Validation: nine focused selection/trace tests; focused browser trace navigation; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(editor): navigate hierarchy Net trace paths`.

## 2026-08-12 - Connectivity Recovery C9e: routing diagnostic domain

- Changed areas: diagnostic adapter/tests, recovery status, target plan and log.
- Validation: 14 focused diagnostic/selection/visual tests; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(diagnostics): classify routing observations separately`.

## 2026-08-12 - Connectivity Recovery C5d: concrete search caller paths

- Changed areas: hierarchy path enumeration/tests, project search/tests, dialog/test, browser selector regression, recovery status, target plan/log.
- Validation: 12 focused hierarchy/search/dialog tests; two focused browser search flows; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `feat(search): expose concrete hierarchy caller paths`.

## 2026-08-12 - Connectivity Recovery final acceptance audit

- Changed areas: generated Agent API schemas/OpenAPI, current-arrow formal SVG golden, recovery status, target plan and log.
- Validation: format/reference/type checks; 576 unit tests; 81 E2E tests; performance gate; Agent API artifact; Phase 5/current-arrow goldens; production smoke; static geometry/planner consumer audit; `git diff --…
- Commit status: ready to commit on `roadmap/connectivity-routing-debugging` as `docs(roadmap): record final connectivity acceptance audit`.

## 2026-08-12 - Electrical contact integrity for Razavi MOS

- Changed areas: editor placement/reconciliation and bulk policy, typed connect-endpoint Net scope, Razavi PMOS catalog/source, API/visual/formal generated artifacts, focused unit and browser regressions, target plan.
- Validation: frozen install; complete `pnpm ci:check` (583 unit tests, 82 browser E2E tests, release/performance/export/production-smoke gates); catalog/API/Phase-5 checks; `git diff --check` clean.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as `fix(editor): preserve electrical truth at Razavi MOS contacts`.

## 2026-08-12 - Net highlight and flightline clarity

- Changed areas: editor Net overlay/flightline policy, `H` shortcut and focused unit/browser coverage, target plan.
- Validation: 10 shortcut unit tests; two focused browser E2E flows; workspace `pnpm typecheck`; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as `feat(editor): strengthen Net highlighting and flightline policy`.

## 2026-08-12 - Import-only flightlines and Net Label removal

- Changed areas: editor flightline display policy, Route action shelf, focused browser tests, target plan.
- Validation: workspace `pnpm typecheck`; four focused browser E2E flows; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as `fix(editor): limit flightlines to untouched imports`.

## 2026-08-12 - Symbol-defined power-Net normalization

- Changed areas: model power-domain facts; edit transaction and Agent schema; editor legacy normalization/bulk policy; ERC/visual diagnostics; generated Agent API artifacts; focused unit/browser regressions and target plan.
- Validation: 51 focused tests; supplied-legacy-topology browser regression; typecheck; format and Agent artifact checks; frozen install; `git diff --check`. Complete static/unit/release CI stages passed (589 unit…
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as `fix(connectivity): normalize symbol-defined power Nets`.

## 2026-08-12 - Unified Net Label binding and deletion

- Changed areas: accepted connectivity contract; shared Derived Label resolver; Connectivity Index; Edit Engine validation; Agent routing expansion; editor Route Properties and browser regressions; target plan.
- Validation: 45 focused Derived/Edit Engine/Agent routing tests; two focused Net Label browser flows including delete/save/reopen; workspace typecheck; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as `fix(connectivity): unify Net label binding semantics`.

## 2026-08-12 - Net Label highlight alignment

- Changed areas: editor highlight-selection adapter and annotation action; focused Label/Route browser regression; target plan.
- Validation: three focused browser flows; workspace typecheck; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as `fix(editor): align Net Label highlight selection`.

## 2026-08-12 - Component-aware Net highlight

- Changed areas: routed component Route membership; Derived Net highlight API; editor typed highlight origin; accepted connectivity contract; focused unit and browser regressions; target plan.
- Validation: 24 focused Derived tests; four focused browser flows including Label deletion splitting a historic merged-Net highlight; workspace typecheck; targeted Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/construction-line-k-shortcut` as `fix(connectivity): highlight routed components through the index`.

## 2026-08-12 - Main and connectivity integration

- Changed areas: explicit two-parent integration commit; additive maintenance log conflict resolution; integration target record. No functional conflict was manually resolved.
- Validation: frozen install and complete local `pnpm ci:check`: formatting, references, typecheck, 597 unit tests, build/performance/export/PWA/ production/release gates, and 85 browser E2E tests all passed.
- Commit status: merge commit `1f79b3a` created locally on `codex/integrate-connectivity-main`; close-out ready to commit and push.

## 2026-08-12 - Latest-main integration refresh

- Changed areas: automatic latest-main merge; integration target record. No functional conflict required manual resolution.
- Validation: frozen install; static/type/reference gates; 597 unit tests; production build, performance, export/PWA and production/release smoke. Three independent E2E cases timed out only in the initial 16-worke…
- Commit status: integration branch validated and ready to fast-forward main.

## 2026-08-12 - Safe PR 14 improvements

- Changed areas: persisted starter/recent quick-place Library; shared insertion request/artwork modules; device double-click Properties; Guide hit testing; interaction contract; focused unit and browser regressions.
- Validation: frozen install and complete `pnpm ci:check`: formatting, references, typecheck, 599 unit tests, build/performance/export/PWA/ production/release gates, and 88 browser E2E tests all passed. Analytics…
- Commit status: ready to commit on `codex/merge-pr14-safe` as `feat(editor): integrate safe library quick-place improvements`.

## 2026-08-12 - Razavi bulk reconciliation with restored editor UI

- Changed areas: two-parent reconciliation merge; Razavi bulk initialization, endpoint, dashed-route and Properties hooks reapplied to the restored UI; integration plan outcome.
- Validation: workspace typecheck; 26 focused unit tests; 63 single-worker browser tests including the Library/restored UI and full manual bulk-route workflow; `git diff --check` clean.
- Commit status: merge commit `842d889` created locally; refreshed PR branch pending push and required CI checks. # 2026-08-12 - Razavi capacitor plate calibration

## 2026-08-13 - Persistent authoring tools and input safety

- Changed areas: global shortcut capture; Wire interaction state; persistent Insert/quick-place/Copy flows; live rotated Insert preview; grid token; rich-text overlay geometry/input shielding; accepted interaction contract; focused unit and browser regress…
- Validation: 20 focused shortcut/state/overlay unit tests; workspace typecheck; component-insert browser spec 11/11; manual-editor browser spec 57/57; `git diff --check` clean.
- Commit status: ready to commit on `codex/persistent-authoring-input-safety` as `feat(editor): add persistent authoring tools and input safety`.

## 2026-08-13 - Remove Guides and add clear/refresh commands

- Changed areas: model/Edit Engine/Agent Guide contracts; editor command, shortcut, canvas, snap, and help surfaces; atomic `clear_document`; explicit recovery flush/reload/auto-restore; active specs, fixtures, generated Agent artifacts, and regressions. A…
- Validation: workspace typecheck; generated Agent API artifacts; 613/613 unit tests; 93/95 browser tests passed on the initial parallel run, with both stale persistent-tool test assumptions corrected and passing…
- Commit status: ready to commit on `codex/persistent-authoring-input-safety` as `feat(editor): remove guides and add clear and refresh`.

## 2026-08-12 - Browser-authorized Agent session roadmap

- Changed areas: new web Agent-session roadmap; roadmap index; documentation target plan. Concurrent VDD rail implementation paths were read-only and are an explicit pre-implementation dependency.
- Validation: pinned reference check passed; roadmap/source boundary review; `git diff --check` clean.
- Commit status: ready to commit on `codex/web-agent-session-architecture` as `docs(agent): plan browser-authorized agent sessions`.

## 2026-08-12 - WP-WA0 browser-authorized session contract

- Changed areas: new ADR 0016 and `docs/specs/web-agent-session.md`; index entries in `docs/adr/README.md` and `docs/specs/README.md`; cross-link and `power-rail` note in `docs/specs/agent-api.md`; WP-WA0 status in the roadmap; target plan and this log ent…
- Validation: rebased onto VDD-merged `main` (`0e96608`) and verified VDD touched no `agent-adapter`/`document-controller` file and added no edit kinds; `pnpm references:check`; Prettier on all touched Markdown; `…
- Commit status: ready to commit on `codex/web-agent-session-architecture` as `docs(agent): freeze browser-authorized session contract (WP-WA0)`.

## 2026-08-12 - WP-WA1 browser-safe protocol boundary

- Changed areas: exported `sha256Hex` from `@icm/derived`; new `agent-adapter/platform.ts` and `envelope.ts`; removed `node:crypto`/`Buffer` from `snapshot.ts`/`service.ts`; split package exports with a `./loopback` Node subpath; new `browser-safety.test.t…
- Validation: 177 combined derived+adapter tests; workspace `typecheck` clean; Prettier; `git diff --check` clean. Render base64/sha256 byte-identical to the former Node path.
- Commit status: ready to commit on `codex/web-agent-session-architecture` as `feat(agent): split browser-safe protocol boundary (WP-WA1)`.

## 2026-08-12 - WP-WA2 unified editor transaction host

- Changed areas: `EditorDocumentController.dispatchTransaction` + `transact` refactor; `useDocumentController` exposure; new `packages/agent-adapter/src/host.ts` (`AgentOperationHost`); extended controller tests.
- Validation: 27 document tests (11 controller); workspace `typecheck` clean; Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/web-agent-session-architecture` as `feat(editor): unify human/Agent transaction dispatch (WP-WA2)`.

## 2026-08-12 - WP-WA3 in-browser Agent host (no network)

- Changed areas: `AgentCircuitHostServiceOptions` + host-mode dispatch in `service.ts`; new `apps/editor/src/agent/browser-agent-host.ts` + integration tests; editor depends on `@icm/agent-adapter` (lockfile re-resolved).
- Validation: 6 host-mode integration tests (4 ops, undo parity, render-hash equality, stale revision, unknown document, project replacement); 29 adapter store-mode tests preserved; workspace `typecheck` clean; Pr…
- Commit status: ready to commit on `codex/web-agent-session-architecture` as `feat(agent): in-browser Agent host without network (WP-WA3)`.

## 2026-08-12 - WP-WA4 Agent session relay core

- Changed areas: new `worker/agent-session-state.ts` (pure state machine) + tests; new `worker/agent-session.ts` (relay orchestration with injected forward) + tests; roadmap status.
- Validation: 22 worker tests (13 state machine + 7 relay + 2 analytics) with fake time/transport; workspace `typecheck` clean; Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/web-agent-session-architecture` as `feat(agent): Cloudflare Agent session relay state machine (WP-WA4)`.

## 2026-08-12 - WP-WA5 Connect Agent panel

- Changed areas: new `apps/editor/src/agent/{connect-agent-panel,use-agent-session}`; `App.tsx` Agent command + panel mount; `.agent-panel` CSS; state machine moved to `packages/agent-adapter/src/session-state.ts`; worker + browser-safety imports updated;…
- Validation: 5 panel markup tests; agent-host (6) + state-machine (13) + worker relay (7) suites pass; App shell (12) passes; workspace `typecheck` clean; Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/web-agent-session-architecture` as `feat(editor): Connect Agent authorization panel (WP-WA5)`.

## 2026-08-12 - WP-WA6 external web-session client contract

- Changed areas: `docs/agent/api-usage.md` (web-session example + transport failure catalog); `docs/agent/README.md` link; `packages/agent-adapter/src/openapi.ts` transport paths + schemas; regenerated `fixtures/agent-api/agent-circuit.openapi.json`.
- Validation: `agent-api:artifacts:check` after rebuild; `references:check`; workspace `typecheck` clean; Prettier; `git diff --check` clean.
- Commit status: ready to commit on `codex/web-agent-session-architecture` as `docs(agent): external web-session client contract (WP-WA6)`.

## 2026-08-12 - WP-WA7 delivery gate

- Changed areas: `pnpm-lock.yaml` Prettier reformat; delivery-gate plan; roadmap exit-gate status.
- Validation: Historical validation completed; detailed command evidence remains in Git history.
- Commit status: ready to commit on `codex/web-agent-session-architecture` as `chore(agent): format lockfile and record delivery gate (WP-WA7)`.

## 2026-08-13 - Web Agent session production closure

- Changed areas: real `AgentSessionDO` + Worker routes/binding/migration; serializable hashed session state and non-content at-most-once ledger; exact scope/Project/Document enforcement; BrowserAgentHost Project fencing; real editor WebSocket hook and life…
- Validation: frozen install and final `pnpm ci:check` green under CI settings; 108 files / 669 unit tests; 92 Playwright scenarios; production/release smoke; 500-instance performance baseline; generated Agent API…
- Commit status: ready to commit and push on `codex/web-agent-session-architecture` as `feat(agent): connect browser-authorized sessions end to end`.

## 2026-08-13 - Plan lifecycle hygiene

- Changed areas: moved 136 resolved completed target directories to `plan/archived/2026-08/`; added the root retention audit and archival batch index; linked the current queue from `plan/README.md`.
- Validation: every moved plan has current `completed`/`none` metadata, an Outcome section, and Git history; active, candidate, superseded, proposed, and metadata-missing plans remained in the root. This target re…
- Commit status: ready to commit on `codex/plan-lifecycle-hygiene` as `docs(plan): archive resolved completed targets`.

## 2026-08-13 - Routine plan record retention

- Changed areas: deleted 14 resolved visual-calibration, naming, and narrow geometry-fix plan records; documented the deletion eligibility rule.
- Validation: every deleted plan had `completed`/`none` metadata, Outcome, Git history, and a matching log entry; no active, candidate, legacy, migration, delivery, integration, or web-agent record was selected; `…
- Commit status: ready to commit on `codex/plan-lifecycle-hygiene` as `docs(plan): prune routine completed records`.

## 2026-08-13 - Deterministic SPICE and Spectre netlist export

- Changed areas: accepted netlist spec and ADR; Project schema v4 migration; reviewed Symbol netlist registry; typed Cell/Instance editor operations; new `@icm/netlist` validation, IR, diagnostics, and pure printers; File-menu downloads, clickable blocking…
- Validation: frozen-lockfile install; final `pnpm ci:check` green; 113 unit files / 693 tests; release/production smoke and performance/golden checks; 101 Playwright scenarios including two-format hierarchical do…
- Commit status: implementation and target close-out committed on `codex/netlist-export-system`; ready to push for review.

## 2026-08-13 - Agent authoring and evidence contract hardening

- Changed areas: canonical coincident-contact and Project-diagnostic derivation; shared GUI/Agent `wireIntent` planner; claim Project/Document bootstrap; bounded same-session WebSocket replacement; reconnect UI; generated OpenAPI artifacts; accepted Agent/…
- Validation: focused 99-test cross-package suite; frozen install; final local `pnpm ci:check` green with 679 unit/integration and 99 Playwright tests plus build, export, PWA, release smoke, and performance gates.…
- Commit status: implementation `37513a2` plus cross-platform test correction `ee7b854` pushed to `codex/agent-contract-hardening`; PR #25 is ready for review.

## 2026-08-13 - RichText contract consolidation

- Changed areas: explicit model RichText types and helpers; shared semantic label conversion; editor/layout/SVG consumers; generated Agent schemas; current interaction/model specs and focused tests.
- Validation: 135 focused Vitest assertions, one focused Playwright floating- toolbar scenario, typecheck, workspace build, generated Agent artifact check, Phase 1/3/5 and current-arrow visual goldens, Prettier, a…
- Commit status: ready to commit on `codex/ci-contract-cleanup` as `refactor(rich-text): consolidate the active text contract`.

## 2026-08-13 - Test contract deduplication

- Changed areas: semantic-text model/renderer tests, connectivity-index parity gates, Agent host/parity tests, SVG drafting coverage, and non-netlist editor browser scenarios. No product or netlist-export implementation changed.
- Validation: 107 Vitest files / 654 tests with two workers; 81 focused tests; three focused Playwright scenarios; 95-test Playwright discovery; typecheck, Prettier, and `git diff --check` passed.
- Commit status: ready to commit on `codex/test-contract-dedup` as `refactor(test): deduplicate behavioral contracts`.

## 2026-08-13 - CI cleanup and Agent contract integration

- Changed areas: resolved editor and SVG integration conflicts; regenerated Agent API artifacts; retained consolidated RichText, canonical diagnostics, shared Wire intent, and contact-aware junction behavior.
- Validation: 132 focused tests; frozen install; full `pnpm ci:check` with 668 unit/integration and 99 Playwright tests; all six required GitHub checks; post-merge ancestry verification.
- Commit status: integration commit `3ecda02` merged through PR #25 into `main` as `e9782e4`.

## 2026-08-13 - Agent contract single source and compaction

- Changed areas: Edit Engine-derived capability kinds; annotation/drafting/ NoConnect advertisement; shared relay scope classification; reusable JSON Schema/OpenAPI components; deterministic reference and size gates.
- Validation: 69 focused tests; typecheck and artifact check; frozen install; full `pnpm ci:check` with 671 unit/integration and 99 Playwright tests plus build, performance, export, PWA, packaging, and release-smo…
- Commit status: ready to commit on `codex/agent-contract-compaction` as `refactor(agent): compact and unify generated contracts`.

## 2026-08-13 - Netlist export main integration

- Changed areas: retained both plan-log histories; aligned two new main Port fixtures with schema-v4 `portOrder`; regenerated compact Agent API artifacts so typed netlist edits remain public; otherwise preserved both branches' automatically merged contract…
- Validation: frozen install; static checks; 113 unit files / 692 tests; canonical Agent artifacts; release/production smoke and performance/goldens; 101 Playwright scenarios, including hierarchical `.spi`/`.scs`…
- Commit status: ready to commit and push on `codex/netlist-export-system` as `merge: integrate main into netlist export`.

## 2026-08-13 - Hide web netlist surface

- Changed areas: removed the File-menu SPICE/Spectre downloads, export diagnostics and explanatory copy, Cell netlist-interface controls, and Instance Reference/Model controls and imported-model source text; removed the editor's direct netlist runtime depe…
- Validation: focused 26-test unit suite; focused hidden-surface Playwright scenario; typecheck and build; frozen install; static, 692-unit, release, performance, golden, production, and release-smoke gates; all 9…
- Commit status: implementation `96d1d8f` and latest-main merge `d19cf58` pushed on `codex/netlist-export-system`; draft PR #31 is open and all six required GitHub checks passed. The first Browser 1/2 run hit an exis…

## 2026-08-13 - README citation

- Changed areas: README human-readable citation, BibTeX entry, and reproducibility guidance; target plan.
- Validation: targeted Markdown formatting and `git diff --check` passed.
- Commit status: ready to commit on `codex/add-readme-citation` as `docs(readme): add project citation`.

## 2026-08-13 - Citation title correction

- Changed areas: prose citation, BibTeX key/title, and target plan.
- Validation: targeted Markdown formatting and `git diff --check` passed.
- Commit status: ready to commit on `codex/shorten-citation-title` as `docs(readme): shorten citation title`.

## 2026-08-13 - Citation title capitalization

- Changed areas: prose and BibTeX titles; target plan.
- Validation: targeted Markdown formatting and `git diff --check` passed.
- Commit status: ready to commit on `codex/capitalize-citation-title` as `docs(readme): capitalize citation title`.

## 2026-08-13 - Test-contract and netlist delivery integration

- Changed areas: PR #32 removed same-behavior test duplication without product changes; merge `3594c01` brought its retained contract ownership into the netlist branch while preserving the hidden web-surface assertion and all lower-level netlist tests.
- Validation: test-contract PR six-check GitHub gate; 49 focused combined unit tests; two focused overlap browser scenarios; frozen install; canonical `pnpm ci:check` with 112 Vitest files / 675 tests, builds, per…
- Commit status: PR #32 merged to `main` as `6efbf3d`; integrated netlist PR #31 is ready for its refreshed remote checks and final merge.

## 2026-08-13 - Local validation resource optimization

- Changed areas: package validation scripts, Agent and README command guidance, and the machine-readable completed-plan queue.
- Validation: focused 13-test unit run; focused one-scenario browser run; `pnpm verify:branch`; canonical `pnpm ci:check` with 112 Vitest files / 675 tests, one workspace build, all release checks, and 96 Playwrig…
- Commit status: ready to commit on `codex/local-validation-optimization` as `chore(test): reduce local validation resource usage`.

## 2026-08-13 - Repository tooling consolidation

- Changed areas: deleted orphaned text/current-arrow projects and goldens; archived stale Phase 9 programs' evidence while retaining corpus netlists; retained two runnable research tools under `tools/research/phase9/`; renamed visual/export golden commands…
- Validation: 40 focused renderer/schema tests; 8 Agent snapshot/SPICE corpus tests; retained Skill check and external-evaluation self-test; visual/export golden checks; all three Razavi calibration tools; `pnpm v…
- Commit status: three reviewable implementation commits plus this close-out on `codex/local-validation-optimization`.

## 2026-08-13 - Plan root lifecycle closure

- Changed areas: archived 23 completed or superseded non-routine target plans; deleted three routine README citation plans; corrected four stale `active` records and one legacy WP-A1 `proposed` record from their existing evidence; refreshed the root audit.
- Validation: every lifecycle action was checked against the plan Outcome, matching factual log evidence, and Git path history; stale-root-path search, Markdown formatting, and `git diff --check` pending final con…
- Commit status: ready to commit on `codex/local-validation-optimization` as `chore(plan): close completed root records`.

## 2026-08-13 - Legacy plan metadata sweep, batch 1

- Changed areas: archived 19 completed architecture, implementation, decision, and integration records after individual Git/Outcome checks; marked six records with explicit human-review signals as `completed/candidate`; updated the root audit from 121 to 9…
- Validation: recorded per-plan commit evidence and disposition; targeted Markdown formatting, root-state count, `git diff --check`, and status review pending final confirmation.
- Commit status: ready to commit on `codex/local-validation-optimization` as `chore(plan): classify legacy records batch 1`.

## 2026-08-13 - Legacy plan metadata sweep, batch 2

- Changed areas: archived 20 individually evidenced completed records; marked five explicit human-review signals as `completed/candidate`; reduced the unclassified root queue from 96 to 71 records.
- Validation: per-plan Git evidence table, Markdown formatting, root-state count, `git diff --check`, and status review pending final confirmation.
- Commit status: ready to commit on `codex/local-validation-optimization` as `chore(plan): classify legacy records batch 2`.

## 2026-08-13 - Batch-2 archive index formatting

- Changed areas: archive index formatting and this factual closure record.
- Validation: repository Prettier on changed Markdown and `git diff --check`.
- Commit status: ready to commit on `codex/local-validation-optimization` as `chore(plan): format batch 2 archive index`.

## 2026-08-13 - Retire unused platform-web package

- Changed areas: deleted `packages/platform-web/` and its workspace lockfile importer; the editor's independent recovery implementation remains intact.
- Validation: lockfile-only install, no-reference search, four focused editor recovery tests, workspace typecheck, and `git diff --check` passed.
- Commit status: ready to commit on `codex/local-validation-optimization` as `chore(platform): retire unused browser platform package`.

## 2026-08-13 - Restore lockfile static CI contract

- Changed areas: Prettier serialization only for the lockfile; dependency resolution is unchanged.
- Validation: `pnpm ci:static`, frozen install, and `git diff --check` passed.
- Commit status: ready to commit on `codex/local-validation-optimization` as `chore(ci): format lockfile static contract`.

## 2026-08-13 - Unified electrical contact authoring

- Changed areas: derived contact targeting, typed endpoint-to-Route attachment, editor Wire and component interaction, snap semantics, contact markers, Agent API artifacts, specifications, and visual/browser regressions.
- Validation: focused unit tests (75), targeted browser tests (5), Agent API artifact check, `pnpm verify:branch` (675 tests plus build/smoke), and `git diff --check` passed.
- Commit status: implementation committed on `codex/unified-electrical-contact` as `fe4c4ee`; archival recorded in the following branch-maintenance commit.

## 2026-08-13 - Documentation information architecture

- Changed areas: root and docs indexes; concise current product architecture; user compatibility/troubleshooting; archive of completed Phase 0--8 records; removal of three superseded Agent planning documents; and an all-CI local Markdown-link checker.
- Validation: Prettier, 102-file local-link scan, `pnpm ci:static` (format, link scan, pinned references, typecheck), and `git diff --check` passed.
- Commit status: ready to commit on `codex/docs-information-architecture` as `docs: consolidate current documentation architecture`.

## 2026-08-13 - Integrate docs architecture and contact authoring

- Changed areas: merge metadata and preservation of both factual plan-log records; no product-source conflict or behavior rewrite was required.
- Validation: 102-file Markdown-link scan, five targeted browser regressions, and `pnpm verify:branch` (675 tests, build, and production smoke) passed.
- Commit status: merge committed on `codex/unified-electrical-contact` as `a3f9264`; plan closure is recorded in the following maintenance commit.

## 2026-08-13 - Junction dot branch semantics

- Changed areas: shared same-Net contact incident geometry, SVG junction-dot eligibility, dense analog golden, and pin/passthrough/branch regressions.
- Validation: focused derived and SVG tests (34), affected package builds and typechecks, and `git diff --check` passed.
- Commit status: ready to commit on `codex/unified-electrical-contact` as `fix: derive junction dots from electrical branch geometry`.

## 2026-08-13 - Wire pass-through pin contacts

- Changed areas: atomic wire planner, GUI wire commit, planner regressions, and a browser scenario covering capacitor, resistor, and ground on one wire.
- Validation: 40 focused unit/render tests, edit-engine build, workspace typecheck, targeted browser regression, and `git diff --check` passed.
- Commit status: ready to commit on `codex/unified-electrical-contact` as `fix: connect compatible pins along authored wires`.

## 2026-08-13 - Mainline contact delivery gate

- Changed areas: contact formatting; endpoint-device exclusion in the shared wire planner; focused planner/browser regressions; and the formal export golden for the accepted dotless simple-corner rule.
- Validation: frozen dependency install and complete `pnpm ci:check` passed, including 683 unit tests, all workspace builds, export/PWA/production/release verification, and 99 browser tests; `git diff --check` pas…
- Commit status: ready to commit on `codex/unified-electrical-contact` as `chore: satisfy contact mainline gate`.

## 2026-08-13 - Browser Agent takeover delivery roadmap

- Changed areas: four-operation Agent roadmap and its target plan; defines the Project controller, stable session recovery, scoped Project/visual File Resource, staged Project/structural-SPICE import approval, semantic editor collaboration, own-head histor…
- Validation: `pnpm docs:check` and `git diff --check` passed. The unrelated active first-class-Port migration stayed unstaged.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `docs(agent): detail browser takeover delivery roadmap`.

## 2026-08-13 - Agent Project lifecycle and artifact completion plan

- Changed areas: current roadmap index and a new AP0--AP9 cross-module plan for exact Snapshot reads, Project transactions, history, Project/visual artifacts, staged Project/SPICE import, explicit replacement authorization, and semantic editor collaboratio…
- Validation: `pnpm references:check` and `git diff --check` passed; no runtime test was required for the documentation-only target.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `docs: plan complete Agent project lifecycle interfaces`.

## 2026-08-13 - AP0 Agent v3 contract freeze

- Changed areas: new ADR 0018 extending ADR 0016; additive "Agent v3 extension" sections in agent-api, web-agent-session, persistence-and-recovery, project-file-format, export, and editor-interaction specs; ADR index; and a new contract-characterization te…
- Validation: focused characterization suite (7 tests), `pnpm docs:check`, `pnpm references:check`, `pnpm typecheck`, and `git diff --check` passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `docs(agent): freeze v3 contract surface and ADR 0018`.

## 2026-08-13 - AP1 exact Snapshot and component catalog

- Changed areas: agent-adapter schema (v3 version, snapshot request `target`, v3 document/project/catalog response schemas), snapshot (exact instance netlist + cell interface, project + document v3 builders), new catalog builder from `builtInSymbols` joine…
- Validation: 39 adapter tests (incl. 6 new), `agent-api:artifacts --check`, `pnpm typecheck`, `pnpm docs:check`, and `git diff --check` passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `feat(agent): v3 exact snapshot targets and component catalog`.

## 2026-08-13 - Hosted Agent four-operation golden contract

- Changed areas: production-only request/response schemas and generated OpenAPI; shared structured request and transport errors; strict current Agent authoring boundary; ten-step copied lifecycle; explicit access rotation; relay/browser rejection ordering;…
- Validation: focused Agent tests (63), web-session E2E, generated artifact check, typecheck, docs check, and `pnpm verify:branch` passed (113 test files, 705 tests, all workspace builds, production smoke); `git d…
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `fix(agent): close the four-operation request contract`.

## 2026-08-13 - Explicit Net power-domain authority

- Changed areas: Project schema v5 and v4-to-v5 migration; explicit power-domain consumers in model/derived/render/edit engine; VDD rail and component-placement behavior; Agent Snapshot/OpenAPI artifacts; compatibility fixtures and current API/project docu…
- Validation: focused model, transaction, Agent, and editor tests; full local unit suite (114 files, 708 tests); typecheck; generated Agent artifact write/check; docs and reference checks; `git diff --check`; and…
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `feat(model): make Net power-domain explicit`.

## 2026-08-13 - Four-operation Agent takeover completion roadmap

- Changed areas: current delivery-roadmap index and the new four-operation completion plan, including authority migrations, Project lifecycle, browser file transport, approval/replacement, semantic collaboration, scopes, errors, and deployed acceptance flo…
- Validation: `pnpm docs:check`, `pnpm references:check`, `git diff --check`, and clean branch status passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `docs(agent): plan four-operation takeover completion`.

## 2026-08-13 - M2 RichText and VisualAnchor authority

- Changed areas: model schema and v6-to-v7 migration; GUI text/drag/clipboard; edit engine and routing; Net-label/connectivity/visual consumers; SVG text renderer and visual goldens; Agent Snapshot/OpenAPI; canonical fixtures and current model/connectivity…
- Validation: focused M2 suites; full local unit suite (116 files, 701 tests); `pnpm ci:static`; Agent artifact write/check; visual golden check; `git diff --check`; and `pnpm verify:branch` (workspace build and p…
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `feat(model): make RichText and VisualAnchor canonical`.

## 2026-08-13 - Public Agent OpenAPI surface

- Changed areas: Agent OpenAPI declaration/artifact; deployed OpenAPI and contract tests; hosted-versus-local API/session documentation; target plan.
- Validation: focused Agent/Worker tests (41 tests), generated Agent artifact write/check, docs/type/diff checks, and `pnpm verify:branch` passed (118 test files, 713 tests, all workspace builds, production smoke).
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `refactor(agent): publish only the external session surface`.

## 2026-08-13 - Shared Agent semantic editor control

- Changed areas: canonical derived Locator runtime schema; Agent `semanticIntent` schema/service/host/scope/OpenAPI; browser semantic adapter and permission presets; worker scope gate; Agent E2E; current API/session usage specs and roadmap.
- Validation: focused unit suites (32 tests), browser Agent E2E, generated artifacts, type/docs/diff checks, and `pnpm verify:branch` (119 files, 719 tests, all workspace builds and production smoke) passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `feat(agent): add shared semantic editor control`.

## 2026-08-13 - Scoped browser Agent File Resource

- Changed areas: Agent File Resource schemas/OpenAPI/artifacts/scopes/session relay; browser file host and approval UI; session instructions/presets; current Agent/session/roadmap specifications; unit, Worker, and browser E2E coverage.
- Validation: focused suites (48 tests), `web-agent-session` browser E2E, typecheck, generated Agent artifacts, docs/diff checks, and `pnpm verify:branch` (120 files, 725 tests, all workspace builds and production…
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `feat(agent): add scoped browser file resource`.

## 2026-08-13 - Show origins map above daily traffic

- Changed areas: `apps/editor/src/components/analytics-page.tsx` section order.
- Validation: source-order review and `git diff --check` passed. Existing analytics e2e heading checks still apply; no new test for markup order.
- Commit status: committed as `cebdf90` on `agent/analytics-map-above-traffic`.

## 2026-08-13 - Properties Dock E2E Transition Stability

- Changed areas: one browser assertion and its target record.
- Validation: the focused Properties-dock E2E and all remote CI checks on PR #37 passed.
- Commit status: committed as `f2a87fd` on `codex/stabilize-properties-e2e`.

## 2026-08-13 - Refresh Phase 7 formal export golden

- Changed areas: deterministic Phase 7 export artifacts and hash manifest.
- Validation: generated through `pnpm export:golden`; full `pnpm ci:check` passed (725 unit tests, 99 browser E2E, build, performance, PWA and release smoke).
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `test(export): refresh formal export golden`.

## 2026-08-13 - Refresh migrated editor E2E fixtures

- Changed areas: stale Port endpoint/selector expectations, semantic RichText selector, and the imported hierarchy-navigation fixture's valid symbol/port interface.
- Validation: focused browser E2E (64 tests) and full `pnpm ci:check` passed (725 unit tests, 99 browser E2E, build, performance, Golden/PWA/release smoke); `git diff --check` passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `test(editor): refresh migrated routing fixtures`.

## 2026-08-13 - Repair compatibility corpus inventory

- Changed areas: tracked-Project discovery in the compatibility corpus test and the corpus list itself; no ignored local artifact was promoted.
- Validation: focused corpus test (4 tests), full `pnpm ci:unit` (725 tests), and `git diff --check` passed.
- Commit status: ready to commit on `codex/agent-project-lifecycle` as `test(model): exclude ignored scratch Project from corpus`.

## 2026-08-14 - Canonical junction node presentation

- Changed areas: shared contact evidence and renderer consumption; focused derived/render/browser regressions; accepted connectivity/editor specs; the intentional dense-analog visual and formal-export baselines.
- Validation: focused contact/render/edit tests (44), four routing browser regressions, `pnpm verify:branch` (120 files, 728 tests, all workspace builds and production smoke), visual/export golden checks, and `git…
- Commit status: ready to commit on `codex/canonical-junction-nodes` as `fix(connectivity): canonicalize junction node presentation`.

## 2026-08-14 - Restore ordinary Port component contract

- Changed areas: symbol catalog/palette, edit and Agent API contracts, legacy rendering, migration fixtures, generated artifacts, and focused regressions.
- Validation: static checks, 724 unit tests, visual and Agent artifact checks, and the imported-child search E2E passed locally.
- Commit status: committed on `codex/restore-port-symbols`; remote CI repair adds an explicit schema-v3 child-document-id reader migration.

## 2026-08-14 - Simplify resilient browser Agent connection lifecycle

- Changed areas: session/claim defaults and replacement semantics; shared scope guard for recovery; browser relay retry; compact Properties Agent section; authorization hand-off wording and generated public OpenAPI artifact; focused session, recovery, UI,…
- Validation: focused session/recovery/panel suites (50 tests), the web-Agent browser E2E, Agent artifact validation, `pnpm verify:branch`, and the final `pnpm ci:check` (729 unit tests, 100 browser tests, builds,…
- Commit status: ready to commit on `codex/agent-connection-ux` as `feat(agent): simplify resilient browser connection lifecycle`.

## 2026-08-14 - Add Agent transport liveness watchdog

- Changed areas: shared WebSocket heartbeat control frame, browser heartbeat timeout and foreground/online wake checks, Worker SSE keepalive handling, focused transport tests, and current Agent connection documentation.
- Validation: focused transport suites (25 tests), full typecheck, and `pnpm verify:branch` (121 files, 733 tests, all workspace builds and production smoke) passed; Agent API artifacts and `git diff --check` pass…
- Commit status: ready to commit on `codex/agent-transport-watchdog` as `fix(agent): add transport liveness watchdog`.

## 2026-08-14 - Complete current circuit contract clean break

- Changed areas: Project schema and fixtures; exact symbol catalog; explicit VDD/MOS connectivity; persisted RichText labels; Agent 2.0/OpenAPI/browser state machine; editor behavior, documentation, generated assets, and tests.
- Validation: 541 unit tests, all workspace builds, `pnpm verify:branch`, frozen-lockfile install, full `pnpm ci:check`, and all 95 browser E2E tests passed.
- Commit status: committed on `codex/agent-transport-watchdog` as `9a552d3` (`refactor(circuit): remove legacy contract routing`).

## 2026-08-14 - Restore overridable MOS supply defaults

- Changed areas: MOS binding schema/resolution/reconciliation; Ground and VDD rail supply-Net reuse; Agent Snapshot/OpenAPI status; current specifications; focused unit and browser regressions.
- Validation: 550 unit tests, `pnpm verify:branch`, frozen-lockfile install, full `pnpm ci:check`, performance/export/PWA/release checks, and all 97 browser E2E tests passed; `git diff --check` passed.
- Commit status: committed on `codex/agent-transport-watchdog` as `5d2d640` (`fix(mos): restore overridable supply bulk defaults`).

## 2026-08-14 - Unify transient editor interaction state

- Changed areas: exclusive editor interaction reducer and shortcut arbitration; App cancellation/mutation boundaries; virtual VDD preview catalog entry; atomic VDD visual deletion; focused unit and browser regressions; accepted editor interaction specifica…
- Validation: focused interaction and VDD suites, 9 focused browser regressions, `pnpm verify:branch` (102 unit-test files / 557 tests, all workspace builds and production smoke), and `git diff --check` passed.
- Commit status: ready to commit on `codex/interaction-state-machine` as `refactor(editor): unify transient interaction state`.

## 2026-08-14 - Stabilize rapid MOS Copy and VDD rail presentation

- Changed areas: synchronous interaction-state publication and safe keyboard target detection; VDD label RichText authoring; power-label rendering; focused unit/browser regressions and accepted interaction specification.
- Validation: 31 focused unit tests, 2 focused browser tests, all 15 component insertion browser tests, `pnpm verify:branch` (558 unit tests, all workspace builds and production smoke), live VDD DOM inspection, an…
- Commit status: ready to commit on `codex/mos-copy-vdd-visual-fix` as `fix(editor): stabilize MOS copy transition and VDD rail`.

## 2026-08-14 - Preserve shared MOS bulk Nets during copy

- Changed areas: clipboard boundary-Net projection and paste reconnection; graceful stale-boundary handling; focused unit and browser regression coverage.
- Validation: focused clipboard unit tests, full component-insert browser spec, `pnpm typecheck`, frozen-lockfile install, and full `pnpm ci:check` (559 unit tests, 103 browser tests, builds, performance/export/PW…
- Commit status: committed on `codex/fix-mos-external-net-copy` as `766c098` (`fix(editor): preserve shared MOS bulk nets during copy`).

## 2026-08-14 - Present Agent hand-off as a copy card

- Changed areas: Agent connection panel markup, themed copy-card styling, accessible copy feedback, and focused component coverage.
- Validation: focused `connect-agent-panel` tests and `pnpm typecheck` passed; the local editor shell was inspected in the in-app browser; `git diff --check` passed.
- Commit status: committed on `codex/agent-copy-card` as `feat(agent): present handoff as copy card`.

## 2026-08-14 - Publish compact Agent operating Kit

- Changed areas: browser-safe Kit content, public Worker route, compact copied hand-off, relay/component tests, and session/Agent documentation.
- Validation: 32 focused unit tests, `pnpm typecheck`, `pnpm docs:check`, a dependency-aware editor production build, and `git diff --check` passed. The Kit was confirmed absent from the editor bundle and is trans…
- Commit status: committed on `codex/agent-copy-card` as `feat(agent): publish compact operating kit`.

## 2026-08-14 - Unify annotation presentation geometry

- Changed areas: derived annotation presentation/bounds; label materialization and rotation follow; SVG/export and visual diagnostics; editor annotation hit/marquee/edit geometry; visual-route deletion contract; focused tests and current model/editor speci…
- Validation: 80 focused derived/editor/edit-engine/render tests, `pnpm typecheck`, `pnpm format:check`, `git diff --check`, and focused Playwright VDD rail creation/deletion passed. The reviewed export goldens we…
- Commit status: initial implementation `5be6e16`; golden completion ready to commit on `codex/unify-annotation-presentation`.

## 2026-08-14 - Close MCP adapter review gaps

- Changed areas: Agent Helper action/session contracts; MCP tool schemas and focused tests; MCP-native quickstart, resource projections, ADR wording, and generated resources.
- Validation: 129 focused Agent/MCP/adapter tests, generated-resource and Markdown checks, `pnpm typecheck`, `git diff --check`, and `pnpm verify:branch` (112 test files / 638 tests, all workspace builds, static c…
- Commit status: ready to commit on `codex/agent-mcp-adapter` as `fix(agent): close MCP adapter review gaps`; intentionally not merging until the separately scoped M4/M5 work is ready.

## 2026-08-14 - Complete deployable MCP lifecycle

- Changed areas: connector issue/resume/revoke transport; Helper credential storage and bearer refresh; same-browser editor recovery and MCP-first hand-off; existing File Resource wrappers; MCP/release packaging, docs, generated OpenAPI/resources, and dete…
- Validation: 187 focused contracts; `pnpm verify:branch` (648 tests); clean install plus `pnpm ci:check` (648 unit and 103 browser tests); Cloudflare Worker deploy dry-run; packaged two-process MCP claim/edit/ren…
- Commit status: implementation committed and pushed on `codex/agent-mcp-adapter` as `0b36b78`; PR #49 remains open and unmerged by request.

## 2026-08-14 - Publish self-bootstrapping MCP distribution

- Changed areas: shared distribution declaration; public Worker bootstrap manifest; editor copy/setup text; MCP and application release packaging; GitHub Release/optional npm workflow; installation documentation.
- Validation: 32 focused editor/Worker tests, typecheck, public `npx` initialize, frozen install plus `pnpm ci:check` (649 unit/integration and 103 browser tests), all six PR #50 checks, production Cloudflare depl…
- Commit status: implementation `b3f4d70`, canonical integrity fix `fe6ea74`, merged as PR #50; GitHub Release `mcp-v0.1.0` published.

## 2026-08-14 - Normalize Fit View bounds to the editor grid

- Changed areas: one derived-bounds-to-camera adapter in the editor, its unit contract, and a browser regression that fits drafted text through `F`.
- Validation: focused unit and browser checks, `pnpm typecheck`, formatting, full drafting E2E (24 tests), `git diff --check`, and canonical `pnpm ci:check` (651 unit tests, 104 browser tests, builds and release s…
- Commit status: committed on `codex/fix-fit-view-grid-bounds`; remote CI and merge remain pending.

## 2026-08-14 - Close coordinate domains and grid normalization boundaries

- Changed areas: model coordinate schemas/helpers; Document and typed-edit validation; derived/render/Agent contracts; editor fit, pan, zoom, focus, preview, drafting and annotation commit paths; current fixtures and generated Agent API artifacts; ADR 0021…
- Validation: complete local suite (115 files / 654 tests), typecheck, formatting, Markdown-link validation, Agent catalog/artifact checks, and `git diff --check` passed. Frozen-lockfile `pnpm ci:check` also passe…
- Commit status: committed on `codex/coordinate-domain-contract`; merge to `main` requires remote browser CI and review checks.

## 2026-08-14 - Coordinate-domain CI follow-up

- Changed areas: route Net Label/current-marker fallback placement, Linux MCP release integrity pin, and the active coordinate-domain target record.
- Validation: focused route/Edit Engine contracts, typecheck, formatting, complete release verification, and the two previously failing Playwright cases passed locally.
- Commit status: pending follow-up commit on `codex/coordinate-domain-contract`; remote PR checks will decide merge.

## 2026-08-14 - Restore imported flightline guidance during placement

- Changed areas: Document guidance schema/import initialization; edit-engine lifecycle policy; editor flightline visibility; focused SPICE/engine/browser contracts.
- Validation: 24 focused engine/SPICE tests, isolated browser flightline suite (3 tests), workspace build, typecheck, Prettier, and `git diff --check` passed.
- Commit status: committed as `59bba32` on `codex/import-flightline-guidance`; pushed as PR #54. The MCP release checksum was refreshed after the package changed.

## 2026-08-15 - Integrate imported flightline guidance on coordinate domains

- Changed areas: resolved `App.tsx` and transaction-layer integration; refreshed the Linux MCP package SHA-256 release pin.
- Validation: 24 focused engine/SPICE tests, 3 isolated browser flightline tests, typecheck, workspace build, formatting, distribution/release checks, and all six PR #54 GitHub Actions checks passed.
- Commit status: PR #54 merged to `main` as `354cf3a`.

## 2026-08-15 - Make junctions follow dragged wire segments

- Changed areas: derived wire-segment stretch policy and an edit-engine regression for a three-way Junction with an orthogonally stretched branch.
- Validation: focused derived/edit-engine suite (34 tests), typecheck, Prettier, and `git diff --check` passed.
- Commit status: PR #57 merged to `main` as `16ad036` after all required GitHub Actions checks passed.

## 2026-08-15 - Default drafting text to Razavi typography

- Changed areas: semantic text factory, drafting-text creation, and RichText script rendering with focused regression tests.
- Validation: 20 focused model/renderer/editor tests, stale power-label contract regression, and clean-tree `pnpm ci:check` all passed (static, 726 unit/integration tests, workspace build/release smoke, 121 browse…
- Commit status: all six PR #60 GitHub Actions checks passed; squash-merged to `main` as `0f45ba5`.

## 2026-08-15 - Snap quick drafting creation to grid

- Changed areas: quick drafting creation and final drafting commit boundaries, with a zoomed-viewport Text browser regression.
- Validation: targeted browser regression, complete drafting suite (25/25), App unit test (12/12), typecheck, formatting, and `git diff --check` passed.
- Commit status: committed on `codex/label-gap-copy-rotate`; push and review remain pending.

## 2026-08-15 - Align instance labels and rotate copy previews

- Changed areas: derived label clearance/snap policy; transient Copy Placement orientation and shortcut routing; rotated copy preview/commit behavior; editor interaction specification and focused unit/browser regressions.
- Validation: 30 focused tests, `pnpm typecheck`, `pnpm format:check`, `git diff --check`, and two focused Playwright regressions passed.
- Commit status: ready to commit on `codex/label-gap-copy-rotate` as `fix(editor): align labels and rotate copy previews`.

## 2026-08-15 - Align label-clearance integration contracts

- Changed areas: MOS rotation placement expectations and the BJT clearance assertion, which now checks the rendered glyph edge rather than an obsolete raw baseline offset.
- Validation: 51 focused derived/Edit Engine/editor geometry tests, typecheck, Prettier, and `git diff --check` passed. Two overlapping local full-gate E2E runs were stopped because they contended for the same pre…
- Commit status: merged through PR #64 as squash commit `ad604fb`.

## 2026-08-15 - Stabilize label clearance and repeated rotation

- Changed areas: derived ink versus hit bounds, instance-label grid placement, Edit Engine follow behavior, label/routing regressions, and the editor interaction contract.
- Validation: focused 52-test derived/Edit Engine suite, typecheck, Prettier, `git diff --check`, frozen install, and isolated-port `pnpm ci:check` (728 unit/integration tests, build/release verification, 124 brow…
- Commit status: squash-merged through PR #67 as `a896fb5` after all remote required checks passed.

## 2026-08-15 - Show the complete compact component Library

- Changed areas: Library catalog projection and priority ordering; compact three-column device tiles with concise visual labels and full accessible names; focused static and browser regressions for all 18 palette items and default-viewport fit.
- Validation: focused unit tests (2 files / 16 tests), focused Playwright Library flow (1 test), `pnpm typecheck`, Prettier checks, desktop screenshot inspection at 1280x720, and `git diff --check` passed.
- Commit status: committed and pushed on `agent/compact-complete-library` as `feat(editor): show complete compact component library`.

## 2026-08-15 - Group Library devices by category

- Changed areas: sidebar catalog projection, compact category headings/counts, category-aware unit coverage, and a browser regression for all six groups and all 18 quick-place buttons.
- Validation: focused unit tests (2 files / 16 tests), focused Playwright categorized-Library flow (1 test), `pnpm typecheck`, Prettier checks, reviewer approval, desktop screenshot inspection at 1280x720 and 1440…
- Commit status: committed and pushed on `agent/compact-complete-library` as `feat(editor): group library devices by category`.

## 2026-08-15 - Right-align Help and fold Library categories

- Changed areas: top-bar action grouping; controlled native category folds and disclosure styling; static and browser regressions for right alignment, narrow bounds, independent folding, and fold persistence across rerenders.
- Validation: focused unit tests (2 files / 16 tests), two focused Playwright flows, `pnpm typecheck`, Prettier checks, reviewer approval with its coverage suggestion addressed, desktop/narrow screenshot inspectio…
- Commit status: committed and pushed on `agent/compact-complete-library` as `feat(editor): right-align help and fold library categories`.

## 2026-08-15 - Fit four Library icons per row

- Changed areas: four-column category/Recent grids; smaller desktop artwork and tiles; concise visual labels with full accessible names; restored larger narrow-layout tiles; browser geometry, containment, overflow, and Recent-grid checks at the 220px Libra…
- Validation: focused unit tests (2 files / 16 tests), two focused Playwright flows, `pnpm typecheck`, Prettier checks, reviewer approval after readability fixes, screenshot inspection at 1280x720, 1024x720, and 7…
- Commit status: committed and pushed on `agent/compact-complete-library` as `style(editor): fit four library icons per row`.

## 2026-08-15 - Center/enlarge Library devices and rebase

- Changed areas: fixed desktop/narrow artwork rows and symbol dimensions; browser checks for exact size, four-edge containment, mixed-label alignment, and responsive behavior; rebase conflict resolution in the factual log.
- Validation: post-rebase focused unit tests (2 files / 16 tests), two focused Playwright flows, `pnpm typecheck`, Prettier checks, reviewer approval after geometry coverage was expanded, screenshot inspection at…
- Commit status: committed, rebased, and force-pushed on `agent/compact-complete-library` as `style(editor): center and enlarge library devices`.

## 2026-08-15 - Truly center Library device artwork

- Changed areas: absolute full-tile artwork centering; independently anchored bottom labels; larger desktop/narrow tile and artwork dimensions; exhaustive browser geometry checks for both axes, tile heights, containment, and label separation.
- Validation: focused unit tests (2 files / 16 tests), two focused Playwright flows, `pnpm typecheck`, Prettier checks, reviewer feedback addressed, screenshot inspection at 1280x720, 1024x720, and 720x720, direct…
- Commit status: committed and pushed on `agent/compact-complete-library` as `fix(editor): vertically center library device artwork`.

## 2026-08-15 - Compact the truly centered Library tiles

- Changed areas: single-line compact electrical labels; desktop tile height reduced from 86px to 66px; narrow tile height reduced from 94px to 74px; exhaustive desktop/narrow centering, fit, separation, and overflow checks.
- Validation: focused unit tests (2 files / 16 tests), two focused Playwright flows, `pnpm typecheck`, Prettier checks, reviewer suggestion addressed, screenshot inspection at 1280x720, 1024x720, and 720x720, and…
- Commit status: committed and pushed on `agent/compact-complete-library` as `style(editor): compact centered library tiles`.

## 2026-08-15 - Use icon-only centered Library tiles

- Changed areas: removed visible in-tile labels from Library and Recent buttons; retained complete accessible names/tooltips; reduced desktop tiles to 52px and narrow tiles to 60px around unchanged centered artwork.
- Validation: focused unit tests (2 files / 16 tests), two focused Playwright flows covering icon-only primary/Recent tiles, accessible names, exact centering, dimensions, and containment, `pnpm typecheck`, Pretti…
- Commit status: committed and pushed on `agent/compact-complete-library` as `style(editor): use compact centered library icons`.

## 2026-08-15 - Restore names below centered Library devices

- Changed areas: concise one-line labels restored for Library and Recent tiles; labels anchored at the bottom; desktop/narrow heights set to 64px/68px with measured artwork-label separation and unchanged centered artwork sizes.
- Validation: focused unit tests (2 files / 16 tests), two focused Playwright flows covering label fit, centering, separation, dimensions, Recent labels, and accessibility, `pnpm typecheck`, Prettier checks, revie…
- Commit status: committed and pushed on `agent/compact-complete-library` as `fix(editor): restore names on centered library tiles`.

## 2026-08-15 - Center the Library icon-label visual weight

- Changed areas: artwork and name returned to one fixed grid group; the union is vertically centered with both elements horizontally centered; tile heights reduced to 56px desktop and 64px narrow.
- Validation: focused unit tests (2 files / 16 tests), two focused Playwright flows measuring union-center geometry, element X centers, separation, fit, dimensions, folds, and Recent behavior, `pnpm typecheck`, Pr…
- Commit status: committed and pushed on `agent/compact-complete-library` as `fix(editor): center library icon-label groups`.

## 2026-08-15 - Deliver compact Library PR

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: final targeted Library/narrow browser flows (2 tests), `pnpm verify:branch` (119 files / 728 tests, static checks, workspace builds, production smoke), ancestry/diff checks, and the final docs link c…
- Commit status: rebased branch force-pushed with lease; PR is open with all required checks enforced on the final tip.

## 2026-08-15 - Stabilize route current-marker dragging

- Changed areas: removed annotation-level React preview state for marker movement; the existing imperative visual now temporarily transforms only the marker and its hit target, then restores it before the single route-attachment transaction on release. The…
- Validation: changed-file Prettier, focused current-marker Playwright 1/1, editor TypeScript, editor production build, and `git diff --check` passed.
- Commit status: prepared on `codex/fix-current-marker-drag-stability` for focused commit and push.

## 2026-08-15 - Compact narrow Library and overlay Properties

- Changed areas: compact viewport state, Library/Properties mutual exclusion, one-column left Library with a concise `All` heading, right-side overlay Properties positioning, and focused browser coverage.
- Validation: focused Library/App unit tests (2 files / 16 tests), focused narrow Library and canvas-width Playwright tests (2 tests), `pnpm typecheck`, Prettier, and `git diff --check` passed.
- Commit status: committed locally as `fix(editor): compact narrow library and overlay properties` on `codex/compact-library-overlay-properties`; not pushed. # 2026-08-15 - Make public Agent UI dormant

## 2026-08-15 - Calibrate Razavi BJT proportions

- Changed areas: BJT vector normalization and regenerated assets/catalog; BJT/MOS ratio regression contract; authority manifest hashes, including two pre-existing stale pins for untouched inductor/op-amp evidence that blocked all Razavi generation.
- Validation: common/full Razavi generation and stale checks, 24 focused authority/catalog tests, Symbols TypeScript build, editor production build, coordinate assertions, and `git diff --check` passed.
- Commit status: rebased as `91ca914`; PR #78 passed all five required remote checks and squash-merged to `main` as `89dd461`.

## 2026-08-15 - Deliver Razavi BJT proportion calibration

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: clean `pnpm install --frozen-lockfile` plus `pnpm ci:check` passed (754 unit and 129 browser tests, workspace build, release contracts, and production smoke). PR #78 passed Static contracts, Unit and…
- Commit status: PR #78 squash-merged to `main` as `89dd461` after all five required remote checks passed.

## 2026-08-15 - Keep BJT base wires solid

- Changed areas: shared MOS-bulk semantic predicates; editor wire/flightline sources; route rendering, tap propagation, deletion, and bulk-default handling; derived, renderer, Edit Engine, and browser regression coverage.
- Validation: 44 focused unit tests, focused Playwright BJT base-wire test, workspace typecheck, and `git diff --check` passed.
- Commit status: pending commit on `codex/bjt-base-solid-wire`. # 2026-08-15 - Alt+drag frame-zoom alias

## 2026-08-15 - Add About panel and compact-layout Help

- Changed areas: top-bar About entry and dialog, package-derived version, repository link, Help placement guidance, and focused unit/browser coverage.
- Validation: focused About/App unit tests (2 files / 14 tests), full chrome-isolation Playwright spec (3 tests), `pnpm typecheck`, Prettier, and `git diff --check` passed.
- Commit status: committed locally as `feat(editor): add about panel and compact-layout help` on `codex/add-about-help-panel`; not pushed.

## 2026-08-15 - Refine About repository link

- Changed areas: visible About URL, new-tab/noreferrer link behavior, shortened description, and focused unit/browser coverage.
- Validation: focused About unit and Playwright tests, `pnpm typecheck`, Prettier, and `git diff --check` passed.
- Commit status: committed locally as `fix(editor): refine about repository link` on `codex/refine-about-repository-link`; not pushed.

## 2026-08-16 - Unify keyboard and pointer selection move

- Changed areas: editor interaction state and shortcut arbitration; shared visual-move edit helper; root-SVG-safe move entry; Help and focused browser regression coverage.
- Validation: 38 focused unit tests, focused `M` Playwright test, complete manual-editor Playwright suite (67 tests), workspace typecheck, Prettier, and `git diff --check` passed.
- Commit status: committed as `f07c65c` (`feat(editor): unify keyboard and pointer selection move`) and pushed to `codex/unified-selection-move-20260816`.

## 2026-08-16 - Complete command move shortcuts

- Changed areas: shortcut arbitration, canvas command-move preview/commit, direct Port placement, Help, and focused browser contracts.
- Validation: 24 focused shortcut/state tests, 37 focused unit tests including App, four dedicated Playwright contracts, workspace typecheck, Prettier, and `git diff --check` passed.
- Commit status: `3af1a7b` pushed on `codex/command-move-shortcuts`. The first remote browser run exposed two stale `Shift+V` assertions; the branch now updates them to `Ctrl+R` and awaits repeated remote checks.

## 2026-08-16 - Insert dialog component list default expanded

- Changed areas: insert dialog picker default state plus its unit and e2e contracts.
- Validation: insert-dialog unit test (2/2), full `component-insert.spec.ts` Playwright run (17/17), and `git diff --check` passed.
- Commit status: committed on `codex/insert-dialog-list-default-expanded` and merged to `main` after the mainline gate.

## 2026-08-16 - Q toggles the Properties dock closed

- Changed areas: shortcut arbitration (`close-properties` intent with `propertiesOpen` / `typingInProperties` context), App dispatch and dock testid, Help wording, shortcut unit contracts, and two Q-touching Playwright specs (one rewritten for toggle seman…
- Validation: 28 focused unit tests, workspace typecheck, Prettier, extended Q property-editing contract, full drafting spec (25), two remaining component-insert Q tests, and `git diff --check` passed.
- Commit status: merged to `main` via #91 after the mainline gate (clean-state local `pnpm ci:check` and green GitHub Actions checks).

## 2026-08-16 - Q opens Properties without input auto-focus

- Changed areas: `openProperties` focus target, shortcut typing-suppression revert (`typingInProperties` removed), shortcut unit contracts, and the Q property-editing Playwright focus contract.
- Validation: 28 focused unit tests, workspace typecheck, Prettier, Q property-editing + drafting dock + double-click inspect Playwright contracts, and `git diff --check` passed.
- Commit status: merged to `main` via #93 after the mainline gate (clean-state local `pnpm ci:check` and green GitHub Actions checks).

## 2026-08-16 - Text system: label visibility, edit auto-commit, movable net labels

- Changed areas: model annotation `visible` flag, render/hit/marquee skip, Properties panel toggles, instance/net-label draft commit effects and Escape handlers, canvas text editor commit semantics (plus a latent phantom-revision fix in `proposeTextEditing…
- Validation: 511 unit tests across editor/model/render-svg/edit-engine/ derived, workspace typecheck, Prettier, full manual-editor (74), drafting (25), and component-insert (18) Playwright specs, `git diff --chec…
- Commit status: merged to `main` via #95 after the mainline gate (clean-state local `pnpm ci:check`, green GitHub Actions checks after refreshing the Linux MCP tarball checksum recorded in `config/agent-mcp-distribu…

## 2026-08-17 - Ratify the current protocol baseline

- Changed areas: accepted ADR 0022 and current reading set; model/persistence, interaction, visual, Agent, and session specs; stale derived/Agent-routing Port terms; MCP generated resources; schema/edit/TTL documentation drift tests.
- Validation: 82 focused tests; Agent API, authoring-catalog, MCP-resource, and Markdown-link checks; `pnpm verify:branch` with static/type checks, 793 unit tests, workspace build, and production smoke; `git diff…
- Commit status: committed locally as `docs(protocol): ratify current schema and agent contracts` on `chore/unify-current-protocol-baseline`; not pushed.

## 2026-08-17 - Add rolling schema-10 Project compatibility

- Changed areas: model parsing metadata and v10 adapter; formal-file staging, dirty/save UX, recovery envelope/storage consistency; accepted ADR 0023 and current compatibility documentation; focused unit and browser contracts.
- Validation: 101 affected unit tests and the dedicated v10 upload/recovery/v11-save Playwright flow; after synchronizing current `main`, frozen install plus full `pnpm ci:check` passed static contracts, 132 test…
- Commit status: implementation `e037a08` plus the reviewed `main` integration are carried by PR #106 on `chore/unify-current-protocol-baseline`; required GitHub Actions checks and merge are the remaining delivery ga…

## 2026-08-17 - Test-system rationalization

- Changed areas: test-system guide and contract matrix; target-plan and Agent rules; CI test-impact check and its unit contract; coordinate-domain, topology-hash, and Netlist extraction contracts; unused style-profile token.
- Validation: focused contracts; `pnpm test:impact -- --base main`; `pnpm ci:static`; full `pnpm test:local` (129 files / 801 tests); and `pnpm verify:branch` including workspace build and production smoke.
- Commit status: committed and pushed on `chore/test-system-rationalization`.

## 2026-08-17 - Merge protocol baseline and test system

- Changed areas: merge-only integration; retained both `plan/log.md` entries after resolving their concurrent append.
- Validation: `pnpm test:impact -- --base main`; `pnpm verify:branch` with static checks, 132 test files / 804 tests, workspace build, and production smoke.
- Commit status: committed and pushed on `agent/merge-protocol-test-system`.

## 2026-08-17 - Refresh MCP release checksum for combined branch

- Changed areas: `config/agent-mcp-distribution.json` checksum plus this target plan and delivery record.
- Validation: from a frozen dependency install, `pnpm ci:check` passed static contracts, 804 unit tests, build and release/package smoke, and 143 browser tests; `git diff --check` passed.
- Commit status: pending push and remote GitHub Actions verification on PR 105.

## 2026-08-17 - Plan device protocol and compatibility architecture

- Changed areas: target architecture/implementation sequence, behavior-lock invariants, model/devices/symbols/project-protocol ownership boundaries, rolling N-1 direct-adapter policy, test ownership, and explicit non-goals.
- Validation: reviewed against ADR 0022, ADR 0023, current model, connectivity, and Edit Engine contracts; `pnpm docs:check`, `pnpm test:impact -- --base main`, and `git diff --check` passed.
- Commit status: committed on `codex/device-protocol-compatibility-plan` as a planning-only record; no executable protocol or device behavior changed.

## 2026-08-17 - Establish device protocol and compatibility foundation

- Changed areas: `@icm/devices` descriptor authority and Symbol/netlist consumers; `@icm/project-protocol` parse/direct-v10-upgrade/serialize API; current-only modular model schema; editor file/recovery, node storage, tests, package boundaries, and current…
- Validation: focused model/device/protocol/editor tests; schema-10 open-and-save Playwright workflow; `pnpm test:impact -- --base main`; and `pnpm verify:branch` (134 files / 815 tests, workspace build, productio…
- Commit status: committed locally as `feat(protocol): isolate device and project compatibility` on `codex/device-protocol-compatibility-plan` and pushed; remote required checks remain the mainline delivery gate.

## 2026-08-17 - Close device and Project protocol architecture gaps

- Changed areas: per-device descriptor files and self-validating registry; removal of Symbols electrical-definition facade with retained parity test; fine-grained model schema and Project-protocol source boundaries; explicit no-historic-fixture audit; curr…
- Validation: focused device/Symbol/model/protocol contracts; schema-10 Project-file browser flow; `pnpm test:impact -- --base main`; and `pnpm verify:branch` (134 files / 816 tests, workspace build, production sm…
- Commit status: committed locally as `refactor(protocol): complete device and compatibility boundaries` on `codex/device-protocol-compatibility-plan` and pushed; remote required checks remain the mainline delivery g…

## 2026-08-17 - Repair Project protocol release imports

- Changed areas: performance-baseline, export-golden, and visual-golden script imports; target plan and root queue record.
- Validation: `pnpm build && pnpm release:verify:built` passed, covering the performance baseline, golden checks, editor production smoke, package creation, and both release smoke checks; `git diff --check` passed.
- Commit status: committed and pushed on `codex/device-protocol-compatibility-plan`; remote required checks remain the mainline delivery gate.

## 2026-08-17 - Refresh Project protocol MCP checksum

- Changed areas: canonical MCP distribution SHA-256 and target-plan records.
- Validation: the CI Release contracts Linux build reported `83f59d02f32c9bf4e9e5bcda91f9e8c74f731bc7778787303f8649d24ad4944b` for the current merge candidate; `pnpm mcp:distribution:check` and `pnpm build && pnpm…
- Commit status: committed and pushed on `codex/device-protocol-compatibility-plan`; remote required checks remain the mainline delivery gate.

## 2026-08-17 - Characterize current routing behavior

- Changed areas: direct derived resolved-route geometry tests and target plan.
- Validation: focused routing suite (9 files / 73 tests), `pnpm test:impact -- --base origin/main`, and `git diff --check` passed.
- Commit status: committed as `66c44cd` on `codex/routing-protocol-unification`.

## 2026-08-17 - Establish canonical routing read protocol

- Changed areas: derived resolved geometry/query/attachment surfaces; renderer, editor route hit/placement, Net Label binding, crossings, and connectivity index consumers.
- Validation: focused routing suite (11 files / 82 tests), `pnpm typecheck`, `pnpm test:impact -- --base origin/main`, and `git diff --check` passed.
- Commit status: committed as `0b425c8` on `codex/routing-protocol-unification`.

## 2026-08-17 - Unify route edit planning and remove compatibility paths

- Changed areas: moved route mutation/authoring helpers and their tests to Edit Engine; deleted the `RoutePolyline` bridge; added `RouteEditPlan` preview/commit parity; migrated editor and Agent names; updated current ADR, spec, and recovery-status records.
- Validation: focused route suite (8 files / 71 tests); targeted editor browser route interaction (3 tests); `pnpm build`, `pnpm docs:check`, `pnpm typecheck`, `pnpm test:impact -- --base origin/main`, and `git di…
- Commit status: committed as `2f210c3` and pushed to `origin/codex/routing-protocol-unification`; remote review checks remain the mainline delivery gate.

## 2026-08-17 - Add Library Project examples

- Changed areas: bundled Common-Source Amplifier and Two-Stage Op Amp Project assets; Examples Library fold/cards; guarded Project replacement; focused panel, App, asset, and browser-flow coverage.
- Validation: focused Editor/example tests (3 files / 19 tests), one Playwright Library-open flow, `pnpm test:impact -- --base origin/codex/device-protocol-compatibility-plan`, a desktop visual review, and `git di…
- Commit status: committed and pushed as `feat(editor): add Library project examples` on `codex/library-examples`.

## 2026-08-17 - Separate Edit Engine transaction protocol layers

- Changed areas: added dedicated edit-schema and transaction-result modules; reduced `transaction.ts` to execution/domain validation with compatibility re-exports.
- Validation: focused transaction/protocol suite (3 files / 30 tests), Edit Engine build, `pnpm typecheck`, `pnpm test:impact -- --base origin/main`, and `git diff --check` passed.
- Commit status: included in `refactor(edit-engine): separate transaction protocol layers` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Extract Editor App pure geometry layers

- Changed areas: expanded the canvas geometry module; added a drafting path module; switched App call sites to imports; added direct unit coverage for the extracted contracts.
- Validation: focused canvas/drafting/App suite (3 files / 22 tests), Editor production build, `pnpm typecheck`, `pnpm test:impact -- --base origin/main`, and `git diff --check` passed.
- Commit status: included in `refactor(editor): extract App canvas geometry helpers` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Layer Edit Engine execution helpers

- Changed areas: added focused internal helper modules and reduced `transaction.ts` to transaction orchestration and edit dispatch.
- Validation: focused transaction/protocol suite (3 files / 30 tests), Edit Engine build, `pnpm typecheck`, `pnpm test:impact -- --base origin/main`, and `git diff --check` passed.
- Commit status: included in `refactor(edit-engine): layer transaction execution helpers` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Layer Editor App document and runtime helpers

- Changed areas: added document and runtime helper modules, switched App imports, and added direct document-helper contracts.
- Validation: focused App/helper suite (2 files / 16 tests), Editor production build, `pnpm typecheck`, `pnpm test:impact -- --base origin/main`, and `git diff --check` passed.
- Commit status: included in `refactor(editor): layer App document runtime helpers` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Define flat Editor interaction migration

- Changed areas: active implementation plan and root-plan audit; no product code changed.
- Validation: `pnpm docs:check`, `git diff --check`, and worktree scope review.
- Commit status: included in `plan(editor): define flat interaction hook migration` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Extract Editor Wire session hook checkpoint

- Changed areas: endpoint/flightline/free-point Wire initiation, MOS bulk Wire initiation, commit, and stale-revision cancellation now live in `useWireInteraction`; route click/stretch remains the pending second part of Step 1.
- Validation: focused wiring contracts (4 files / 51 tests), 17 focused browser Wire/route tests, Editor build, and `pnpm typecheck` passed.
- Commit status: included in `refactor(editor): extract wire session hook` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Complete Editor Wiring interaction Hook

- Changed areas: moved route tap ambiguity checks, route Wire activation, pointer drag sessions, visual previews, cancellation, and transactional stretch commits from `App.tsx` into the flat wiring Hook.
- Validation: focused wiring contracts (4 files / 51 tests), focused Playwright Wire/route scenarios, Editor build, `pnpm typecheck`, `pnpm test:impact -- --base origin/main`, and `git diff --check` passed.
- Commit status: staged for `refactor(editor): extract wire interaction hook` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Extract Editor selection command and pointer sessions checkpoint

- Changed areas: added `useSelectionInteraction` for deletion, No Connect, copy placement, selection mutation, visual selection movement, and instance pointer-drag lifecycle; App retains pure movement calculations and the keyboard Move session for the next…
- Validation: focused selection/clipboard contracts (5 files / 33 tests), representative Playwright copy, deletion, junction, visual selection, and instance-drag scenarios, Editor build, `pnpm typecheck`, and `git…
- Commit status: staged for `refactor(editor): extract selection interaction checkpoint` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Extract Editor placement dialog checkpoint

- Changed areas: added `useComponentPlacement`; it owns Insert visibility, local-storage recency, insertion requests, VDD-mode start, and placement orientation actions. Selection commands now read the synchronous interaction getter, preserving rapid Escape…
- Validation: focused selection/placement contracts (9 files / 49 tests), fast Escape-to-Copy Playwright regression, Editor build, and `pnpm typecheck` passed.
- Commit status: staged for `refactor(editor): extract placement interaction checkpoint` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Extract placement commit and properties draft checkpoints

- Changed areas: placement Hook now routes component/VDD canvas commits; the properties Hook owns instance and Net Label draft state.
- Validation: focused properties contracts (3 files / 22 tests), focused insertion/VDD and property Playwright scenarios, Editor build, and `pnpm typecheck` passed.
- Commit status: staged for `refactor(editor): continue placement and properties migration` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Extract editor shell panel state checkpoint

- Changed areas: added and connected `useEditorPanels` for Library, responsive shell, selection shelf, Help, About, and project-search state.
- Validation: focused shell/search contracts (4 files / 19 tests), 3 focused Playwright command-menu/search/layout scenarios, `pnpm typecheck`, and `git diff --check` passed.
- Commit status: staged for `refactor(editor): extract editor shell panel state` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Complete selection and placement interaction Hooks

- Changed areas: removed the last duplicate App move/placement handlers; `useComponentPlacement` now builds and commits component connectivity, labels, bulk reconciliation, and VDD rails directly.
- Validation: focused component contracts (6 files / 31 tests), 3 focused Playwright component/VDD/cancellation scenarios, Editor build, `pnpm typecheck`, `pnpm test:impact -- --base origin/main`, and `git diff --…
- Commit status: staged for `refactor(editor): complete selection and component placement hooks` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Continue properties interaction Hook

- Changed areas: `usePropertiesEditor` now owns selection-transition commits, Net Label open/apply/delete, instance apply/cancel, and text editing sessions; the remaining label visibility actions stay explicitly pending.
- Validation: focused properties/text contracts (3 files / 22 tests), 5 focused Playwright property/Net Label/text scenarios, and `pnpm typecheck` passed.
- Commit status: staged for `refactor(editor): continue properties editor hook` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Complete properties interaction Hook

- Changed areas: reference visibility, value visibility, and live-draft value projection now commit through the properties Hook; App retains only pure edit construction and JSX wiring.
- Validation: focused Playwright reference/value projection passed, together with `pnpm typecheck` and formatting.
- Commit status: staged for `refactor(editor): complete properties editor hook` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Continue editor shell Hook

- Changed areas: `useEditorPanels` now owns compact media-query updates, compact Library/Selection arbitration, persisted Library state, and Library/Examples panel commands.
- Validation: focused narrow-breakpoint Playwright scenario and `pnpm typecheck` passed.
- Commit status: staged for `refactor(editor): continue editor panel state hook` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Complete editor shell Hook

- Changed areas: the Hook now owns storage initialization, Help/About focus restoration, Search close/reset, and Agent panel/detail/dismissal state; App remains the JSX and external Agent-session composition root.
- Validation: focused shell/search unit contracts (4 files / 19 tests), 4 Library/catalog Playwright scenarios, 3 command/search/layout scenarios, Editor build, and `pnpm typecheck` passed.
- Commit status: staged for `refactor(editor): complete editor panel state hook` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Complete editor interaction controller migration

- Changed areas: final shell state/focus ownership and the branch-owned transaction entry point's five-line Prettier repair; no protocol behavior changed in the latter.
- Validation: static branch checks, 139 unit files / 828 tests, focused Playwright coverage for wire, selection, placement, properties, and shell, Editor build, production smoke, test-impact, duplicate-owner searc…
- Commit status: staged for final plan/log/formatting commit on `codex/app-transaction-module-layers`.

## 2026-08-17 - Mainline merge records preserved

- Changed areas: Historical implementation record; exact changed paths remain in Git history.
- Validation: Historical validation completed; detailed command evidence remains in Git history.
- Commit status: Historical delivery; refer to the linked target plan and Git history.

## 2026-08-17 - Integrate manual hierarchy with interaction Hooks

- Changed areas: manually resolved `App.tsx` by retaining the five Hook composition boundaries and adding rectangle-to-Cell conversion, navigation, shortcut, and toolbar integration; mainline conflict records were retained.
- Validation: 4 focused unit files / 44 tests, hierarchy Playwright workflow, Editor build, typecheck, diff checks, and `pnpm verify:branch` (140 unit files / 840 tests, full build, production smoke) passed.
- Commit status: included in `merge: integrate manual hierarchy with interaction hooks` on `codex/app-transaction-module-layers`.

## 2026-08-17 - Repair PR 117 CI contracts

- Changed areas: `useSelectionInteraction` now projects planned moved route endpoints and waypoints during an instance-led drag; the MCP distribution SHA-256 matches the CI-produced Linux artifact.
- Validation: the 2 targeted connected-route Playwright tests, release verification, test-impact, frozen dependency install, full `pnpm ci:check` (including final Playwright status `passed`), and diff checks passe…
- Commit status: staged for `fix(editor): restore connected wire drag previews` on `codex/app-transaction-module-layers`; GitHub required checks pending.

## 2026-08-17 - Plan unified Net contract

- Changed areas: added the Net contract unification roadmap, its staged acceptance matrix and non-goals, and linked it from the roadmap index.
- Validation: documentation review, `pnpm test:impact -- --base main`, and `git diff --check` passed.
- Commit status: staged for `docs(net): plan unified connectivity contract` on `codex/net-contract-unification-plan`.

## 2026-08-17 - Net contract N1 primitives

- Changed areas: model Net contract helper, transaction name validation, formal-interface retargeting, and focused model/edit-engine regressions.
- Validation: focused 2-file Vitest run (13 tests), model and edit-engine builds, test-impact, and diff checks passed.
- Commit status: staged for `feat(net): add canonical name and merge primitives` on `codex/net-contract-unification-plan`.

## 2026-08-17 - Net contract N2 power producers

- Changed areas: Edit Engine power planner and role guard; power normalization, MOS fallback, component placement, VDD rail construction, current contracts, and focused regressions.
- Validation: focused 5-file Vitest run (49 tests), Edit Engine/Derived/Editor builds, test-impact, Prettier, documentation-link, and diff checks passed.
- Commit status: staged for `feat(net): unify power net authoring` on `codex/net-contract-unification-plan`.

## 2026-08-17 - Net contract N3 derived and export convergence

- Changed areas: model validation, Project Connectivity Index global groups, global trace hops, ERC, netlist extraction, and focused regressions.
- Validation: focused 4-file Vitest run (21 tests), Model/Derived/Netlist builds, and diff checks passed.
- Commit status: staged for `feat(net): converge derived and export semantics` on `codex/net-contract-unification-plan`.

## 2026-08-17 - Net contract N4 legacy repair and delivery

- Changed areas: deterministic Edit Engine repair plan and entry installation, save-needed status, global Net flightline semantics and trace presentation, power-normalization no-op guard, current contract/user docs, and Vite's post-write service-worker ver…
- Validation: focused 6-file Vitest run (62 tests), test-impact, typecheck, `git diff --check`, and `pnpm verify:branch` (143 unit files / 859 tests, full workspace build, production smoke) passed.
- Commit status: pending `feat(net): repair legacy power net duplicates` on `codex/net-contract-unification-plan`.

## 2026-08-17 - Net contract N5 named Net authoring

- Changed areas: pure Edit Engine named-Net planner, GUI Net-label integration, planner regressions, and corresponding model/edit-engine/roadmap guidance.
- Validation: focused 3-file Vitest run (19 tests), package/editor builds, typecheck, docs check, test-impact, `git diff --check`, and `pnpm verify:branch` (144 unit files / 862 tests, full workspace build, produc…
- Commit status: pending `feat(net): unify named net authoring` on `codex/net-contract-unification-plan`.

## 2026-08-17 - Net contract N6 retire editor power normalizer

- Changed areas: App startup effect removal and current Net authoring/repair contract documentation.
- Validation: focused 3-file Vitest run (32 tests), production-call-site search, editor build, typecheck, docs check, test-impact, `git diff --check`, and `pnpm verify:branch` (144 unit files / 862 tests, full wor…
- Commit status: pending `refactor(net): retire editor power normalization` on `codex/net-contract-unification-plan`.

## 2026-08-17 - Net contract N7 repair reference closure

- Changed areas: valid legacy Ground repair fixture/regression and acceptance matrix evidence.
- Validation: focused 2-file Vitest run (18 tests), docs check, test-impact, `git diff --check`, and `pnpm verify:branch` (144 unit files / 863 tests, full workspace build, production smoke) passed.
- Commit status: pending `test(net): cover repair reference closure` on `codex/net-contract-unification-plan`.

## 2026-08-17 - Net contract N8 Agent named-Net parity

- Changed areas: browser-safe adapter planner re-export, Agent client semantic rename compilation, parity regression, and Agent/roadmap guidance.
- Validation: focused 3-file Vitest run (39 tests), package builds, typecheck, docs check, test-impact, `git diff --check`, and `pnpm verify:branch` (144 unit files / 864 tests, full workspace build, production sm…
- Commit status: pending `feat(agent): share named net authoring planner` on `codex/net-contract-unification-plan`.

## 2026-08-17 - Net contract N9 acceptance matrix

- Changed areas: placement connectivity integration regressions.
- Validation: focused placement Vitest run (8 tests), test-impact, and diff checks passed.
- Commit status: pending `test(net): cover repeated canonical power placement` on `codex/net-contract-unification-plan`.

## 2026-08-17 - Net contract N10 roadmap closure

- Changed areas: Net-contract roadmap and factual planning records only.
- Validation: Markdown-link and diff checks passed; preceding branch gate passed 144 test files / 866 tests, workspace builds, and production smoke.
- Commit status: pending `docs(net): close contract unification roadmap` on `codex/net-contract-unification-plan`.

## 2026-08-17 - Net contract N11 legacy compatibility retirement

- Changed areas: model/Edit Engine normalizer path, Agent schema and generated artifacts, editor entry presentation, current contract docs, and focused regressions.
- Validation: focused 4-file Vitest (46 tests), generated Agent/MCP checks, typecheck, test-impact, diff check, and `pnpm verify:branch` (143 test files / 860 tests, workspace build, production smoke) passed.
- Commit status: pending `refactor(net): retire legacy normalization compatibility` on `codex/net-contract-unification-plan`.

## 2026-08-18 - Diagnostic lifecycle and report separation

- Changed areas: Derived live diagnostic snapshot/presentation policy, editor diagnostic workbench and import report lifecycle, accepted diagnostic ADR, and unit/controller/browser lifecycle regressions.
- Validation: focused 3-file Vitest (25 tests), diagnostic-focused Playwright (4 tests), test-impact, typecheck, diff checks, and `pnpm verify:branch` (143 test files / 863 tests, workspace build, production smoke…
- Commit status: committed and pushed as `refactor(diagnostics): separate live findings from import reports` on `codex/diagnostic-lifecycle`.

## 2026-08-18 - Net-contract Ground route-placement E2E

- Changed areas: one test-local canonical Ground Net fixture and the target plan/log record.
- Validation: focused Playwright, test-impact, diff checks, frozen install, and `pnpm ci:check` passed (143 unit files / 863 tests; 148 Playwright scenarios).
- Commit status: pending `test(net): align ground route placement with contract` on `codex/diagnostic-lifecycle`.

## 2026-08-18 - Net and diagnostics MCP checksum refresh

- Changed areas: MCP distribution checksum plus the target plan/log record.
- Validation: `pnpm mcp:distribution:check`, workspace build, release verification, and diff checks passed locally; a new remote Linux Release contracts check remains required for delivery.
- Commit status: pending `fix(release): refresh MCP checksum` on `codex/diagnostic-lifecycle`.

## 2026-08-18 - Schematic hierarchy and formal Cell ports v12

- Target: complete schematic-only hierarchy authoring while preserving the
  existing Document, Instance, Port symbol, Edit Engine, resolver, index,
  netlist, and four-operation Agent contracts.
- Changed areas: schema-12 Project/formal-port model and direct v11 migration;
  Project structural transactions/history; Cell create/place/delete and
  path-aware navigation; formal Port expose/rename/delete; Agent Snapshot and
  structural transact parity; SPICE/netlist handling; fixtures, ADR, current
  specs, user guide, and generated MCP resources.
- Validation: focused cross-package Vitest and Playwright workflows,
  `pnpm test:impact -- --base origin/main`, generated-resource checks,
  `git diff --check`, and `pnpm verify:branch` passed (144 test files / 874
  tests, workspace build, production smoke).
- Commit status: included in the `codex/schematic-hierarchy-v12` review branch
  delivery.

## 2026-08-18 - Hierarchy authoring and adaptive symbol plan

- Changed areas: proposed hierarchy interaction/visual roadmap, roadmap index,
  and target planning record only.
- Validation: `pnpm docs:check`, `pnpm test:impact -- --base origin/main`, and
  `git diff --check` passed.
- Commit status: included in the `codex/hierarchy-authoring-visual-plan`
  branch delivery.

## 2026-08-18 - Hierarchy authoring and adaptive Symbol H1

- Changed areas: schema-13 direct compatibility adapter and canonical fixtures;
  definition-level Cell symbol intent and strict closure; adaptive derived
  hierarchy Symbol geometry; Project route-follow planner; Agent/MCP artifacts;
  current protocol/user documentation and ADR 0026.
- Validation: focused model/project-protocol/symbols/edit-engine/Agent/editor
  tests, Project-file Playwright (8 scenarios), generated-artifact checks,
  `pnpm test:impact -- --base origin/main`, `git diff --check`, and
  `pnpm verify:branch` passed (144 test files / 879 tests, workspace build and
  production smoke).
- Commit status: included in the `codex/hierarchy-authoring-visual-plan`
  branch delivery.

## 2026-08-18 - Hierarchy authoring and visual H2

- Changed areas: shared editor insert dialog/pending placement, typed
  hierarchy-instance factory, rectangle conversion reuse, interaction/browser
  regressions, and current user/spec/roadmap documentation.
- Validation: focused 3-file Vitest (16 tests), hierarchy Playwright (2
  scenarios), typecheck, docs check, test-impact, diff check, and
  `pnpm verify:branch` passed (144 unit files / 880 tests, workspace build,
  production smoke).
- Commit status: included in `c38b807` on
  `codex/hierarchy-authoring-visual-plan`.

## 2026-08-18 - Hierarchy authoring and visual H3

- Changed areas: declared Cell Port dialog, shared pending-placement commit
  factory, exact-contact Net identity, Cell Interface direction/order/visual
  controls, hierarchy browser coverage, and current documentation.
- Validation: focused App/placement/interaction Vitest (31 tests), hierarchy
  Playwright (3 scenarios), typecheck, docs check, test-impact, diff check,
  and `pnpm verify:branch` passed (144 unit files / 880 tests, workspace
  build, production smoke).
- Commit status: included in `fd9469e` on
  `codex/hierarchy-authoring-visual-plan`.

## 2026-08-18 - Hierarchy authoring and visual H4

- Changed areas: Project-level Cell rename/reconciliation, caller-aware Cell
  Manager dialog, caller-jump browser workflow, hierarchy lifecycle tests, and
  current user/roadmap documentation.
- Validation: focused Project-transaction Vitest (10 tests), hierarchy
  Playwright (4 scenarios), typecheck, docs check, test-impact, diff check,
  and `pnpm verify:branch` passed (144 unit files / 881 tests, workspace
  build, production smoke).
- Commit status: included in `b5ae3db` on
  `codex/hierarchy-authoring-visual-plan`.

## 2026-08-18 - Hierarchy authoring and visual H5

- Changed areas: dense adaptive Symbol acceptance, Cell placement mirror
  browser coverage, hierarchy/drafting save-reopen coverage, and compatibility
  guidance.
- Validation: hierarchical Symbol Vitest (4 tests), hierarchy/drafting
  Playwright (30 scenarios), typecheck, docs check, test-impact, diff check,
  and `pnpm verify:branch` passed (144 unit files / 882 tests, workspace
  build, production smoke).
- Commit status: included in `3760374` on
  `codex/hierarchy-authoring-visual-plan`.

## 2026-08-18 - Hierarchy domain orchestration refactor

- Changed areas: shared Edit Engine hierarchy Instance/planner APIs, Derived
  Cell/caller summaries, thin Editor hierarchy call sites, planner/query tests,
  and accepted architecture guidance.
- Validation: focused Vitest (5 files / 28 tests), hierarchy Playwright (4
  scenarios), typecheck, docs check, test-impact, diff check, and
  `pnpm verify:branch` passed (146 unit files / 887 tests, workspace build and
  production smoke).
- Commit status: included in the hierarchy refactor commit on
  `codex/hierarchy-authoring-visual-plan`.

## 2026-08-18 - Merge hierarchy branch to main

- Changed areas: mainline integration metadata and Git refs only; the promoted
  product changes are the verified hierarchy authoring and domain-orchestration
  commits.
- Validation: `pnpm install --frozen-lockfile` and `pnpm ci:check` passed:
  146 unit files / 887 tests, workspace build, release verification, and 152
  E2E scenarios.
- Remote CI initially rejected the stale Linux MCP tarball checksum. Updated
  `config/agent-mcp-distribution.json` to the observed canonical Linux hash;
  the replacement PR run passed all six required checks.
- Commit status: merged through [PR #121](https://github.com/chenzc24/Analog-Canvas/pull/121)
  at `0319a73` on `origin/main`.

## 2026-08-18 - Hierarchy UI and visual polish

- Changed areas: root/child Cell command semantics, grouped hierarchy menu,
  bounded Cell Interface dialog, Cell instance annotation placement, Razavi pin
  RichText, closed hierarchical body geometry, focused tests, and current
  hierarchy documentation.
- Validation: focused Vitest (4 files / 24 tests), hierarchy Playwright (4
  scenarios), docs check, typecheck, test-impact, diff check, and
  `pnpm verify:branch` passed (146 unit files / 888 tests, workspace build and
  production smoke).
- Commit status: included in the `codex/hierarchy-ui-polish` branch delivery.

## 2026-08-18 - Hierarchy UI behavior-preservation correction

- Changed areas: top-Cell interface command reachability, hierarchy-only pin
  RichText selection, ordinary visible-pin regression coverage, hierarchy
  browser coverage, and current hierarchy documentation.
- Validation: focused Vitest (2 files / 18 tests), hierarchy Playwright (4
  scenarios), test-impact, diff check, and `pnpm verify:branch` passed (146
  unit files / 889 tests, workspace build and production smoke).
- Commit status: included in the `codex/hierarchy-ui-polish` branch delivery.

## 2026-08-18 - Adaptive Cell menu overlay

- Changed areas: hierarchy toolbar overflow behavior, adaptive Cell selector
  and command-popover sizing, narrow-viewport browser layout coverage, and
  target records.
- Validation: hierarchy Playwright (5 scenarios), direct 420px browser layout
  inspection, test-impact, diff check, and `pnpm verify:branch` passed (146
  unit files / 889 tests, workspace build and production smoke).
- Commit status: included in the `codex/hierarchy-ui-polish` branch delivery.

## 2026-08-18 - Direct Cell Port authoring

- Changed areas: ordinary Port placement orchestration, selected-Port
  Properties and safe deletion, hierarchy command/dialog cleanup, focused
  browser coverage, and current hierarchy documentation.
- Validation: focused Vitest (4 files / 24 tests), hierarchy Playwright (5
  scenarios), docs check, test-impact, diff check, and `pnpm verify:branch`
  passed (146 unit files / 889 tests, workspace build and production smoke).
- Commit status: included in the `codex/hierarchy-ui-polish` branch delivery.

## 2026-08-18 - Preserve top-level Port behavior

- Changed areas: Port placement boundary and current hierarchy interaction
  documentation. Automatic formal-terminal authoring now applies only to child
  Cells; top-level Ports retain their ordinary electrical behavior.
- Validation: child-Cell and top-level Port Playwright scenarios (2/2),
  typecheck, docs check, and diff check passed. The regression was found by
  canonical CI; that complete gate will be rerun from the correction commit
  before mainline delivery.
- Commit status: included in the `codex/hierarchy-ui-polish` branch delivery.

## 2026-08-18 - Simplify Properties panel

- Changed areas: immediate component and Net-label editing, dirty-only
  component Discard, compact selected-object identity, paired canvas-label
  controls, persistent position/rotation, labelled component More actions,
  and severity-only Issues filters.
- Validation: focused Vitest (2 files / 18 tests), focused Playwright (10
  scenarios), TypeScript typecheck, test-impact against `origin/main`, diff
  check, and desktop visual inspection passed.
- Commit status: committed locally on `codex/properties-panel-simplify`.

## 2026-08-19 - Hierarchy authoring polish

- Changed areas: in-app Cell dialogs, direct hierarchy row commands, child
  Port annotation/name projection, shared Port deletion planning, browser
  regressions, and hierarchy interaction documentation.
- Validation: hierarchy and top-level Port Playwright (7 scenarios), docs
  check, test-impact, diff check, and `pnpm verify:branch` passed (146 unit
  files / 889 tests, workspace build and production smoke).
- Commit status: committed on `codex/properties-panel-simplify` as `30eab90`.

## 2026-08-19 - Cell symbol layout and hierarchy deletion

- Changed areas: formal-Port mixed-selection deletion, schema-14 Cell symbol
  pin-label presentation, parent pin RichText rendering, selected hierarchy
  instance Properties controls, fixtures, documentation, and focused browser
  coverage.
- Validation: typecheck; focused model/protocol/edit-engine/symbol/render
  tests (40); hierarchy Playwright (6); hierarchy/project-file Playwright (14);
  workspace build; static checks; production smoke; test-impact; and diff
  check.
- Commit status: included in the local `codex/cell-symbol-layout` target commit.

## 2026-08-19 - Cell symbol layout interaction refinement

- Changed areas: pin-label baseline geometry, schema-14 pin-label intent
  simplification, compact per-pin Properties row, and opt-in canvas body/pin/
  label grips.
- Validation: typecheck; focused model/symbol/render/edit-engine Vitest (39);
  hierarchy Playwright (6); and diff check.
- Commit status: included in the follow-up local target commit on
  `codex/cell-symbol-layout`.

## 2026-08-19 - Cell symbol layout pin-priority refinement

- Changed areas: canvas layout-grip hit priority, compact Cell pin Side/Offset
  controls, automatic pin-name layout, and the unmerged schema-14 rollback.
- Validation: typecheck; focused model/protocol/symbol/render/document Vitest
  (94); hierarchy/project-file Playwright (14); hierarchy Playwright with
  direct body/pin grip coverage (6); workspace build; test-impact; and diff
  check.
- Commit status: committed with `refine(hierarchy): prioritize Cell pin editing`.

## 2026-08-19 - Hierarchy vertical pin-name clearance

- Changed areas: automatic north/south hierarchy pin-name baseline geometry
  and its render contract coverage.
- Validation: typecheck; render/symbol Vitest (10); hierarchy Playwright (6);
  workspace build; test-impact; and diff check.
- Commit status: committed with `refine(hierarchy): clear vertical pin names`.

## 2026-08-19 - Formal Port formatting and RichText editor shielding

- Changed areas: formal Port display-name derivation and formatting-only
  transaction planning, hierarchy pin rendering, canvas RichText hit handling,
  compact editor frame styling, and focused browser coverage.
- Validation: typecheck; focused model/edit-engine/render/editor Vitest (23);
  direct hierarchy/editor-shield Playwright (2); hierarchy Playwright (6);
  workspace build; test-impact; and diff check.
- Commit status: committed with `refine(hierarchy): shield RichText editing`.

## 2026-08-19 - Cell hierarchy mainline delivery gate

- Changed areas: Prettier-only normalization of hierarchy block geometry and
  target delivery records.
- Validation: `pnpm install --frozen-lockfile`; isolated `pnpm ci:check`
  passed (891 unit tests, 154 browser tests, workspace build, release
  packaging, and production smoke); diff check.
- Commit status: committed with `style(symbols): format hierarchy geometry`.

## 2026-08-19 - Properties panel mainline regression

- Changed areas: formal-Cell-Port annotation routing, compact Properties
  browser assertions, and target records.
- Validation: focused six-scenario Playwright coverage and `pnpm ci:check`
  passed (146 unit files / 889 tests, build, release smoke, and 154 browser
  scenarios).
- Remote CI: all other required checks passed; Release contracts was cancelled
  at its configured 15-minute timeout while running the unchanged full gate.
  The target remains active while a 25-minute timeout-budget correction reruns
  the same gate.

## 2026-08-19 - Predictable Cell symbol layout exit

- Changed areas: scoped Cell symbol layout ownership, automatic exit on
  Properties/context/tool/canvas changes, and hierarchy browser regression
  coverage for restored normal Cell movement.
- Validation: hierarchy Playwright (6 scenarios), TypeScript typecheck,
  test-impact against `origin/main`, diff check, and the canonical local gate
  passed (891 unit tests and 154 browser tests, static/build/release/packaging
  and production-smoke contracts). PR #126 required checks passed.
- Commit status: committed on `codex/cell-pin-edit-exit`; merge to `main` is
  requested.

## 2026-08-19 - Prebuilt Playwright CI environment

- Changed areas: release and browser GitHub Actions jobs now select a
  digest-pinned, package-version-matched Playwright image for executable
  changes, preserve the documentation-only fast path, remove runtime browser
  installation, and correctly forward the browser shard argument.
- Validation: Prettier; static contracts; test-impact; release verification;
  single-worker browser suite (154/154); and Playwright shard-list verification
  (77 tests for `1/2`). The Windows-host default 16-worker shard had resource
  timeouts; all GitHub Actions jobs passed in the prebuilt Linux environment
  (static 30s, unit 49s, release 1m 03s, browser shards 3m 16s and 3m 45s).
- Commit status: PR #127 merged to `main` as `92e63ea`.
- Commit status: merged to `main` through PR #126 as `0948d83`.

## 2026-08-19 - Stage 1 schematic foundation roadmap

- Changed areas: proposed Stage 1 authority boundary, instance netlist
  properties, reference planning, bulk editing, Wire/Net closure, Cell and
  external-subcircuit authoring, Preflight/DesignNetlistIR exit gate, roadmap
  index, and target records.
- Validation: documentation links, test-impact against `main`, diff check,
  and final branch-status review passed.
- Commit status: committed and pushed on
  `codex/phase1-schematic-foundation-plan` as `04b0d80`.

## 2026-08-19 - Stage 1 S1/S2 roadmap refinement

- Changed areas: refined the Stage 1 authority/property protocol, removal path
  for the electrical `Instance.properties` branch, Descriptor parameter
  definitions, user-visible References, strict display projections, typed
  field edits, and the descriptor-driven Component Properties work package.
- Validation: documentation links, test-impact against `main`, diff check,
  and final branch-status review passed.
- Commit status: committed and pushed on
  `codex/phase1-schematic-foundation-plan` as `931dda2`.

## 2026-08-19 - Stage 1 S3-S5 protocol refinement

- Changed areas: refined the Reference Policy/Index/Planner, definition-level
  Project Instance Index and Batch Property Planner, and Connectivity Intent /
  Proposal protocols, with existing GUI gestures and results recorded as the
  migration compatibility boundary.
- Validation: documentation links, test-impact against `main`, diff check,
  and final branch-status review passed.
- Commit status: committed and pushed on
  `codex/phase1-schematic-foundation-plan` as `f173e5d`.

## 2026-08-19 - Stage 1 S6 hierarchy netlist refinement

- Changed areas: reframed S6 around hierarchy netlist completeness; separated
  formal terminal order from visual Cell Symbol Layout; defined shared
  internal/external interface and formal-parameter semantics, explicit
  unresolved targets, caller-impact proposals, Property/Connectivity protocol
  composition, and the IR/Preflight closure.
- Validation: documentation links, test-impact against `main`, diff check, and
  final branch-status review passed.
- Commit status: committed and pushed on
  `codex/phase1-schematic-foundation-plan` as `911577f`.

## 2026-08-19 - Stage 1 architecture review corrections

- Changed areas: added the GUI default-freeze gate; reconciled managed and
  hand-edited instance annotations; corrected atomic transaction, revision,
  bulk-limit, parameter-limit, analyzer, model, provenance, search, external
  Symbol, hierarchy interface, IR, performance, and acceptance assumptions;
  and reduced S5/S6 to focused planners and Stage 1-essential behavior.
- Validation: documentation links, test-impact against `main`, and diff check
  passed.
- Commit status: committed and pushed on
  `codex/phase1-schematic-foundation-plan` as `e344933`.

## 2026-08-19 - Stage 1 accepted data and GUI contracts

- Changed areas: separated removal of persisted electrical properties from
  current Properties GUI compatibility; made canvas instance text
  presentation-only with a derived canonical classifier; selected the minimal
  non-emitting shape, bounded bulk edit, hierarchy binding/external-definition
  shapes, and existing-extraction analyzer path; and added the S0 implementation
  preparation gate.
- Validation: documentation links, test-impact against `main`, and diff check
  passed.
- Commit status: committed on
  `codex/phase1-schematic-foundation-plan`.

## 2026-08-19 - S0 schema-14 netlist protocol decision

- Changed areas: accepted ADR 0027, ADR/current-document indexes, and the
  implementation decision record for one schema-14 netlist-authoring contract.
- Validation: `pnpm docs:check`, `pnpm test:impact -- --base origin/main`, and
  `git diff --check` passed.
- Commit status: committed and pushed with force-with-lease on
  `codex/phase1-schematic-foundation-plan`.

## 2026-08-19 - Schema-14 model and protocol foundation

- Changed areas: current-only typed Instance netlist/provenance model,
  direct schema-13 migration, external subcircuit definitions, Cell formal
  parameters, hierarchy consumer contracts, GUI transient parameter naming,
  fixtures, generated Agent/MCP contracts, and current-version documentation.
- Validation: full unit suite (146 files / 894 tests), typecheck, workspace
  build, generated-contract refresh, docs links, test-impact against
  `origin/main`, diff check, and schema-13 property audit passed.
- Commit status: committed locally on
  `codex/phase1-schematic-foundation-plan`; push/PR not requested.
## 2026-08-20 - S3 shared Reference Policy and Index

- Changed areas: centralized per-Cell reference allocation, validation, hierarchy X policy, clipboard/insertion authoring, typed rename planning, Properties Reference editing, canonical label refresh, and netlist extraction diagnostics/marker behavior.
- Validation: typecheck; focused unit contracts (58 tests); focused Properties/hierarchy browser contracts (8 tests); test-impact against `origin/main`; docs links; and diff check passed.
- Commit status: committed locally on `codex/phase1-schematic-foundation-plan`.

## 2026-08-20 - S4 Project Instance Index and batch authoring

- Changed areas: definition-level project instance index and caller context,
  bounded atomic typed bulk netlist edit, batch property and Reference
  renumber planners, explicit Instance Table UI, and editor regression tests.
- Validation: TypeScript typecheck; 50 focused unit/component tests; Instance
  Table and existing Properties Playwright paths; test-impact against
  `origin/main`; docs links; and diff check passed.
- Commit status: committed locally on `codex/phase1-schematic-foundation-plan`.

## 2026-08-20 - S5 Connectivity Proposal and Wire/Net closure

- Changed areas: added the revision-bound connectivity proposal contract and
  migrated human Wire, named-Net, selection/move/delete, NoConnect,
  component-contact, VDD rail, endpoint-disconnect, and copy producers while
  retaining the typed low-level edit protocol; added reversible route jog
  editing with browser coverage.
- Validation: TypeScript typecheck; 66 focused unit/component tests; five
  focused Playwright gesture contracts; test-impact against `origin/main`;
  docs links; and diff check passed.
- Commit status: committed as `50b6c28` on
  `codex/phase1-schematic-foundation-plan`, then rebased onto `origin/main`.

## 2026-08-20 - S6 Cell and Subcircuit Interface Authoring

- Changed areas: one internal/external formal interface protocol, typed
  formal-parameter/external-definition transactions and planners, generic
  external symbols, deterministic external-master IR, and the separate Cell
  Interface editor with terminal order controls.
- Validation: formatting; typecheck; focused model/edit-engine/netlist/symbol
  and editor tests; focused Cell Interface browser workflow; workspace build;
  docs links; test-impact; and diff check passed.
- Commit status: committed as `50b6c28` on
  `codex/phase1-schematic-foundation-plan`, then rebased onto `origin/main`.

## 2026-08-20 - S7 Design-netlist analysis and Preflight

- Changed areas: the single public `analyzeDesignNetlist` API, locator-backed
  diagnostics, lossless formal default IR, editor preflight UI/navigation, and
  workspace dependency declarations.
- Validation: formatting; typecheck; focused 109-test unit/component set;
  focused preflight browser workflow; workspace build; docs links;
  test-impact; and diff check passed.
- Commit status: committed as `50b6c28` on
  `codex/phase1-schematic-foundation-plan`, then rebased onto `origin/main`.

## 2026-08-20 - Editor information architecture polish

- Changed areas: merged Cell Interface into a master-detail Cell Manager,
  moved Instance Table and Preflight into a first-level Netlist menu, regrouped
  component Properties, and subordinated non-blocking live Issues.
- Validation: typecheck; 37 focused unit/component tests; 14 focused browser
  contracts; test-impact against `origin/main`; fresh-browser visual and
  console inspection; and diff check passed.
- Commit status: prepared on
  `codex/phase1-schematic-foundation-plan` as one editor presentation target.

## 2026-08-20 - Schema-14 performance baseline mainline gate

- Changed areas: migrated the synthetic 500-resistor release fixture to the
  current Instance netlist contract and aligned browser contracts with
  schema-13-to-14 persistence, canonical internal-Cell bindings, and the
  compact Properties authoring layout.
- Validation: direct performance baseline; focused repaired browser test; and
  full CI gate (155 unit files / 928 tests, production build, release
  verification, and 158 E2E tests) passed.
- Commit status: committed on
  `codex/phase1-schematic-foundation-plan`.
```

## 2026-08-20 - Linux MCP release checksum refresh

- Changed areas: updated the canonical Linux MCP tarball SHA-256 pin from the
  required PR Release contracts job after the schema-14 bundle changed.
- Validation: distribution metadata check and local complete release
  verification passed; the protected remote replacement gate is pending.
- Commit status: prepared for commit on
  `codex/phase1-schematic-foundation-plan`.

## 2026-08-20 - Octilinear Route protocol

- Changed areas: shared generic segment geometry; octilinear Route validation,
  planning, route taps/crossings, stretch and 45-degree segment movement;
  Wire draft-step interaction with MMB/F3 controls; Agent wire/RouteGraph
  constraints; generated API/MCP resources; and current routing/Agent docs.
- Validation: focused unit/component set (19 files / 166 tests); focused
  Playwright Wire flow (2 tests); direct type checks; workspace build;
  production smoke; generated API/MCP, Markdown-link, test-impact, and diff
  checks passed.
- Commit status: committed locally on `codex/octilinear-route-protocol`;
  push/PR was not requested.

## 2026-08-20 - Octilinear Route release-golden reconciliation

- Changed areas: refreshed the Phase 7 SVG, PNG, PDF, and manifest goldens for
  terminal miter bridges on existing diagonal routes; the new bridges use the
  shared unit-direction geometry rather than an axis-biased approximation.
- Validation: `export-golden --check`, complete `pnpm release:verify`, diff
  check, and the preceding focused protocol tests passed.
- Commit status: pending push of this release-gate correction on
  `codex/octilinear-route-protocol`.

## 2026-08-20 - Octilinear Linux MCP checksum refresh

- Changed areas: replaced the canonical Linux MCP package checksum with the
  digest emitted by PR #130's Release contracts job.
- Validation: `pnpm mcp:distribution:check`, complete `pnpm release:verify`,
  and diff check passed locally.
- Commit status: pending push and replacement remote checks on
  `codex/octilinear-route-protocol`.

## 2026-08-20 - Scope MCP SHA verification to publishing

- Changed areas: MCP package checksum verification is now an explicit
  release-only command; ordinary release contracts retain package generation,
  smoke, and production checks without binding development output to the last
  published asset.
- Validation: focused integrity contract (5 tests); MCP package; static
  contracts; test-impact; and full `pnpm ci:check` (including browser and
  release verification) passed locally. GitHub Actions also passed static
  (26s), unit (41s), release (55s), and browser shards (3m 18s / 3m 54s).
- Commit status: PR #131 merged to `main` as `701465ef`.

## 2026-08-20 - Unified bound text system

- Changed areas: single-source bindings for instance, Net/power, and Cell Port
  displays; shared annotation text resolution in render, bounds, hit testing,
  diagnostics, connectivity, copy/paste, hierarchy, and editing; compact
  RichText toolbar additions; and semantic Net-label rename preservation.
- Validation: focused unit contracts (12 files / 87 tests); focused browser
  contracts for semantic edits, movable Net labels, and Cell Ports;
  test-impact; and `pnpm verify:branch` (158 files / 945 tests, build, and
  production smoke) passed.
- Commit status: committed as `d4a22fbc` on `codex/unified-text-binding`.

## 2026-08-20 - Bound text editor repair

- Changed areas: semantic labels now use a direct single-line source editor;
  literal RichText uses deterministic line-break insertion and renders overbars
  inside its editing surface.
- Validation: focused browser regression (2 tests), workspace typecheck,
  test-impact, and diff checks passed.
- Commit status: prepared on `codex/unified-text-binding`.

## 2026-08-20 - Schematic reference text

- Changed areas: added the user-owned RichText `Instance.schematicName` and
  typed edit; instance labels and Properties now edit that source rather than
  the SPICE reference; restored label formatting; and made multi-character
  overbar application reversible.
- Validation: 49 focused unit/protocol tests, 3 focused browser tests,
  workspace typecheck, test-impact, and diff checks passed.
- Commit status: prepared on `codex/unified-text-binding`.

## 2026-08-20 - Phase 2 structural netlist closure

- Changed areas: completed editor delivery of the existing structural SPICE
  import/export loop with File-menu downloads and preflight preview for SPICE
  and Spectre; retained external master terminal identity/direction and open
  raw library parameters; added Project -> SPICE -> Project hierarchy/external
  call semantic round-trip coverage; clarified the no-PDK/no-simulation-deck
  boundary in user and export-contract documentation.
- Validation: focused unit contracts (4 files / 28 tests), workspace
  typecheck/build, focused Playwright preflight/preview/download flow (3
  tests), format, Markdown-link (117 docs), test-impact, and diff checks
  passed.
- Commit status: prepared on `codex/phase2-netlist-closure`.

## 2026-08-21 - Phase 2 structural netlist hardening

- Changed areas: preserved defaulted Cell formal parameters across SPICE
  import and SPICE/Spectre export; made formal terminal names authoritative in
  emitted Cell headers; represented explicit NoConnects with stable floating
  nodes and warning acknowledgement; normalized DC sources; upgraded the
  round-trip proof to a real Project semantic comparison; and added successful
  browser import-to-export coverage.
- Validation: focused changed contracts (6 files / 40 tests), complete SPICE
  and netlist package suites (10 files / 42 tests), workspace typecheck/build,
  focused browser flows (5 tests), format, docs, test-impact, and diff checks
  passed. Branch verification also reproduced two unrelated schema-15 baseline
  failures on the parent branch.
- Commit status: prepared on `codex/phase2-netlist-hardening`.

## 2026-08-21 - Schema 15 baseline reconciliation

- Changed areas: aligned ADR 0026 and the user compatibility guide with the
  accepted schema-15/schema-14 window, and moved the browser recovery
  compatibility regression from retired schema 13 to active schema 14.
- Validation: focused documentation/recovery tests (2 files / 25 tests), docs,
  test-impact and diff checks; complete branch verification passed (159 files /
  956 tests, workspace build, and production preview smoke).
- Commit status: prepared on `codex/phase2-netlist-hardening` as a separate
  baseline-reconciliation commit.

## 2026-08-21 - Phase 2 netlist mainline integration

- Changed areas: fast-forwarded local `main` from `14fe2d54` through the
  Phase 2 structural closure (`88a997df`), netlist hardening (`8d62fe21`), and
  schema-15 baseline reconciliation (`e11de334`); recorded the local
  integration boundary.
- Validation: `pnpm install --frozen-lockfile` and complete `pnpm ci:check`
  passed: static contracts, 159 unit-test files / 956 tests, workspace build,
  release and production smoke checks, and 162 browser E2E tests.
- Commit status: merged to `origin/main` through PR #134 as `51075420` after
  all GitHub Actions checks passed; local `main` is synchronized.

## 2026-08-21 - Schema 16 instance identity protocol

- Changed areas: advanced canonical Projects to schema 16; split ambiguous
  instance labels into designator, schematic-name and master-name bindings;
  replaced the rolling reader with a direct schema-15 migration; synchronized
  recovery, fixtures, bundled examples, documentation, and ADR 0030.
- Validation: focused model/project-protocol/derived/editor contracts (12 files
  / 102 tests), typecheck, format, docs, test-impact, and diff checks passed.
- Commit status: committed on `codex/schematic-instance-lifecycle-ux` as
  `d70c84bc`.

## 2026-08-21 - Unified instance display authoring

- Changed areas: introduced a shared editor display factory; made manual
  device, Cell, external-call and formal-Port labels category-correct; persisted
  insertion references; separated Reference and Alias in Properties; and added
  explicit ID/Reference/Alias/Master columns to Instance Table.
- Validation: focused unit contracts (7 files / 25 tests), focused Playwright
  flows (4 tests), typecheck, format, docs, test-impact, and diff checks passed.
- Commit status: committed on `codex/schematic-instance-lifecycle-ux` as
  `0da8da3c`.

## 2026-08-21 - Instance placement lifecycle engine

- Changed areas: added explicit retained-unplaced transaction semantics and a
  shared lifecycle planner; selection deletion now clears route endpoints,
  memberships, NoConnects, labels, and unlocked layout references safely
  before strict instance removal.
- Validation: focused lifecycle/transaction/protocol/selection/Agent contracts
  (5 files / 56 tests), typecheck, format, docs, MCP-resource freshness,
  test-impact, and diff checks passed.
- Commit status: committed on `codex/schematic-instance-lifecycle-ux` as
  `c2295d6e`.

## 2026-08-21 - Placement Tray controls

- Changed areas: replaced the bare unplaced list with a semantic Placement
  Tray; added single cursor placement, deterministic Place all, Return to tray,
  Return all, and a clear permanent-delete distinction.
- Validation: focused tray/interaction/connectivity/lifecycle contracts (4
  files / 24 tests), focused browser tray flow, typecheck, format, docs,
  test-impact, diff checks, and complete `pnpm verify:branch` passed.
- Commit status: committed on `codex/schematic-instance-lifecycle-ux` as
  `13ba3a26`.

## 2026-08-21 - Schematic reference and unified Port lifecycle

- Changed areas: advanced canonical Projects to schema 17; separated the
  visible `Instance.schematicReference` from emitted netlist references;
  migrated schema 16 deterministically; made References visible by default;
  and made formal Cell Ports returnable and re-placeable without changing
  their interface semantics.
- Validation: focused unit contracts (17 files / 172 tests), targeted
  regression tests (2 files / 14 tests), formal-Port browser lifecycle (1
  test), format, docs, test-impact, diff checks, complete workspace unit-test
  execution, workspace build, and production preview smoke passed.
- Commit status: committed on `codex/schematic-instance-lifecycle-ux` as
  the current branch HEAD.

## 2026-08-21 - Imported Reference default display

- Changed areas: made Tray placement, canvas drag/drop, and Place all
  materialize only missing default Reference projections; retained imported
  netlist references are now visibly rendered when first placed.
- Validation: focused editor contracts (3 files / 18 tests), SPICE
  import-and-place browser regression (1 test), typecheck, format,
  test-impact, and diff checks passed.
- Commit status: committed on `codex/schematic-instance-lifecycle-ux` as
  the current branch HEAD.

## 2026-08-21 - Rich schematic label authority and formal Port presentation

- Changed areas: corrected schema-18 default instance labels to bind RichText
  `schematicName` rather than the emitted designator; retained a
  schematic/netlist-only fallback with no internal-ID display; made the
  designator optional/read-only; reduced Properties to one Schematic label
  entry; and tightened formal Cell Ports to their terminal-name-only
  projection. The v17 reader migration preserves ordinary label placement while
  rebinding it and removes redundant formal-Port projections.
- Validation: focused unit contracts (9 files / 78 tests), focused Playwright
  lifecycle/import/property flows (5 tests), workspace typecheck, Prettier,
  Markdown-link validation, test-impact, and diff checks passed.
- Commit status: ready to commit on `codex/schematic-instance-lifecycle-ux`.

## 2026-08-21 - Unified Port naming and RichText presentation

- Changed areas: added explicit Free Net Port versus Formal Cell Pin insertion;
  bound their visible text to `Net.name` or `CellTerminal.name`; introduced a
  same-text-only RichText annotation override; routed character edits through
  Net/hierarchy rename transactions; exposed role-correct Properties; and
  documented the protocol in ADR 0033. Also restored canonical formatting of
  one fixture exposed by branch verification.
- Validation: focused unit contracts (6 files / 72 tests), complete hierarchy
  browser specification (9 tests), repaired gate regressions (2 files / 18
  tests), typecheck, docs, test-impact and diff checks, plus complete
  `pnpm verify:branch` (162 unit files / 975 tests, workspace build, production
  preview smoke) passed.
- Commit status: ready to commit on `codex/schematic-instance-lifecycle-ux`.

## 2026-08-21 - Schematic lifecycle mainline gate closure

- Changed areas: fixed Clipboard paste to allocate a unique
  `schematicReference` alongside each fresh netlist designator; aligned Port,
  Net RichText, connected-deletion, and Project persistence browser contracts
  with the accepted schema-18 behavior.
- Validation: Clipboard unit tests (1 file / 8 tests), all 14 originally
  failing browser cases, typecheck, test-impact and diff checks, and canonical
  `pnpm ci:check` passed with 162 unit files / 975 tests, all workspace builds,
  release/MCP smoke checks, and 167 browser tests.
- Commit status: ready to commit on `codex/schematic-instance-lifecycle-ux`.

## 2026-08-21 - Free Net Port lifecycle

- Changed areas: reused the deterministic named-Net planner for Free Port
  insertion; pruned an unreachable local Net only after its final endpoint,
  display label, and all durable references have gone; and repaired the
  browser insertion helper for the separate Port setup dialog.
- Validation: focused lifecycle/named-Net tests (9 tests), three targeted
  browser Port flows, workspace typecheck, Prettier, test-impact, and diff
  checks passed.
- Commit status: committed and pushed on `codex/insert-unification` as
  `65580820`.

## 2026-08-21 - Top-Cell Port and Net semantics

- Changed areas: enabled Formal Cell Pin authoring in the top Document; made
  Free Net Ports validated, non-emitting Net markers; assigned formal terminal
  names before anonymous Net generation; and accepted ADR 0034 with current
  interaction, export, and hierarchy guidance.
- Validation: netlist package (3 files / 19 tests), complete hierarchy browser
  spec (10 tests), focused manual Port browser flows (2 tests), typecheck,
  format/docs/test-impact, workspace build, and `pnpm verify:branch` (162 test
  files / 977 tests plus production preview smoke) passed.
- Commit status: committed on `codex/top-cell-port-net-semantics` as
  `60d52ebb`; stacked integration is tracked separately.

## 2026-08-21 - Unified Port semantics stack

- Changed areas: stacked top-Cell formal-interface and Free Port export
  semantics onto the unified Insert/Port Setup and Free Port Net lifecycle;
  retained the top-level Free Port default while exposing both explicit roles
  in every Document.
- Validation: focused unit tests (5 files / 29 tests), combined Port browser
  flows (5 tests), typecheck, format/docs/test-impact/diff checks, and complete
  `pnpm verify:branch` (164 files / 986 tests, workspace builds, production
  preview smoke) passed.
- Commit status: integrated as `dff2568c` and closed by `b891998e` on
  `codex/insert-unification`.

## 2026-08-21 - Imported Net routing guidance

- Changed areas: advanced Project persistence to schema 19; replaced
  document-wide flightline dismissal with per-Net `authored`/`spice-import`
  provenance; extracted a pure routing-guidance MST; renamed the geometry-only
  route mutation to `remove_route_geometry`; and added focused/all/hidden
  imported-guidance display with per-Net highlight suppression.
- Validation: focused schema/protocol/SPICE/derived/edit-engine tests,
  imported guidance browser tests (5), complete workspace unit-test execution
  after schema-baseline updates, typecheck, static/doc/reference checks,
  generated Agent/MCP artifact checks, workspace build, production preview
  smoke, test-impact, and diff checks passed.
- Commit status: committed on `codex/spice-import-routing-guidance` as
  `60ff3692`; stacked coordination is tracked separately.

## 2026-08-21 - Port and imported-routing-guidance stack

- Changed areas: stacked schema-19 imported-only routing guidance above the
  unified Port/export lifecycle; resolved the ADR 0034 collision as ADR 0035;
  preserved imported provenance through Port Net merge/delete; and hid
  guidance controls when an authored canvas has no derived guides.
- Validation: focused cross-layer unit tests, 8 combined Port/guidance browser
  flows, typecheck, format/docs/test-impact, Agent API and MCP generated checks,
  and complete `pnpm verify:branch` (165 files / 991 tests, workspace builds,
  production preview smoke) passed.
- Commit status: routing source stacked as `85cf56ec`; coordinated repair is
  committed as the current `codex/insert-unification` branch HEAD.

## 2026-08-21 - Named power and MOS bulk hotfix

- Changed areas: made VDD/AVDD/DVDD Rails ordinary named Net projections;
  unified VDD Port/Rail reuse and Razavi net-name text; and removed MOS-polarity
  fallback creation of global VDD/0 while retaining explicit and configured
  cell-default bulk connections.
- Validation: focused unit/browser tests, generated Agent/MCP artifact checks,
  test-impact and diff checks, plus canonical `pnpm ci:check` passed with
  165 unit files / 990 tests, all builds/release checks, and 169 browser tests.
- Commit status: ready to commit on `codex/vdd-named-power-hotfix`.

## 2026-08-21 - Advisory validation gate planning

- Changed areas: added a versioned validation-gate catalog, explainable diff
  planner, executable preflight/affected commands, target-plan Gate Review,
  shared changed-path collection, and an advisory GitHub Actions summary;
  existing required jobs and the canonical full delivery gate remain intact.
- Validation: planner/governance tests (2 files / 16 tests), representative
  path plans, `pnpm gate:preflight`, `pnpm gate:affected` (166 files / 1001
  tests, builds and production smoke), frozen install, and final canonical
  `pnpm ci:check` (166 files / 1002 tests, all build/release checks, 169 browser
  tests) passed, plus diff/status checks.
- Commit status: committed on `codex/gate-planning-preflight`; mainline
  integration is tracked by the branch PR.

## 2026-08-22 - Repeated Formal Port markers

- Changed areas: advanced Project persistence to schema 20; let one formal
  Cell terminal own multiple ordinary Port markers on one Net; routed Formal
  marker copy through the existing Project structural transaction; and made
  subset deletion retain the interface while final deletion keeps caller
  protection.
- Validation: 149 focused cross-layer tests, 63 Agent-adapter tests, the full
  hierarchy browser suite, generated Agent/MCP checks, test-impact,
  `pnpm verify:branch` (165 files / 992 tests plus builds and production
  smoke), and canonical `pnpm ci:check` with 170 browser tests passed.
- Latest-Main integration: preserved the variable-resistor child Cell from
  PR 138 and updated its two formal marker fields to schema 20.
- Commit status: ready to commit on `codex/named-power-bulk-semantics`.

## 2026-08-21 - Two-terminal variable resistor component

- Changed areas: added a reviewed variable-resistor Symbol that composes the
  existing vertical resistor body with one diagonal adjustment arrow; exposed
  it as a two-port Passive whose first placement creates one reusable
  parameterized child Cell; and bound instances as `X` calls so export emits a
  real `.subckt` body rather than a parent-level resistor primitive. Runtime
  and Agent catalogs were regenerated; Library coverage was brought in sync,
  and the gate's rich-text selection was made cross-platform.
- Validation: focused tests (8 files / 58 tests), hierarchy/export rerun (2
  tests), repaired overbar E2E, symbol/Agent/MCP generated checks, typecheck,
  test-impact, docs and diff checks, plus canonical `pnpm ci:check` (166 unit
  files / 995 tests, all builds and release checks, 169 browser tests) passed.
- Commit status: completed on `codex/variable-resistor` across the feature,
  subcircuit, and final gate-closure commits.

## 2026-08-21 - Centered click-to-edit rectangle labels

- Changed areas: object-anchor resolution now targets drafting rectangles
  (`@icm/derived` anchor lookup); render-svg paints object-anchored drafting
  text vertically centered on the resolved anchor; new editor
  `features/drafting/rectangle-label` module plus canvas double-click flow
  create/reopen one centered label per rectangle on empty interior space; the
  inline rich-text editor mirrors the committed alignment.
- Validation: focused unit tests (derived, render-svg, editor drafting and
  text-editing: 31 files / 155 tests), full drafting Playwright suite (27
  passed including the new scenario), repository typecheck, test-impact,
  and diff checks passed.
- Commit status: completed on `claude/block-diagram-authoring` at the
  user's direction; mainline merge gated on the remote required checks.

## 2026-08-21 - Logic-gate and comparator symbol family

- Changed areas: added six reviewed behavioral block Symbols on the op-amp
  mechanism (inverter, AND, OR, NAND, NOR in a new Logic Gates palette
  category; comparator in Analog Blocks) with hand-composed Razavi-style
  assets, catalog entries with manual-only netlist reasons, regenerated
  runtime/Agent/MCP catalogs, shapes-panel labels, and updated
  count/coverage contracts including the browser Library suite.
- Validation: symbol/Agent/MCP/agent-api generator checks, focused unit
  tests (20 files / 103 tests incl. a new family contract test), full
  component-insert Playwright suite (21 passed), repository typecheck,
  test-impact, and diff checks passed; all six symbols placed and visually
  inspected in the running editor.
- Commit status: completed on `claude/block-diagram-authoring` at the
  user's direction; mainline merge gated on the remote required checks.

## 2026-08-21 - Directional marquee and native text-selection fix

- Changed areas: canvas suppresses native browser text selection (the cause
  of "distant labels" highlighting during drags) with an overlay restore;
  box-selection extracted to a pure marquee-selection module implementing
  left-to-right window (full containment) vs right-to-left crossing (overlap)
  with distinct live-preview styling; editor-interaction spec updated; one
  browser test's marquee gesture widened for window semantics.
- Validation: 19 new unit tests (64 across selection/canvas/wiring), full
  manual-editor/drafting/hierarchy Playwright suites, typecheck, prettier,
  markdown links, test-impact, and diff checks passed.
- Commit status: completed on `claude/marquee-window-crossing`; mainline
  merge gated on the remote required checks.

## 2026-08-21 - Junction dots ignore collinear overlapping arms

- Changed areas: `contactRequiresJunctionDot` counts distinct route-arm
  directions (terminals keep per-pin counting), removing the phantom dot a
  duplicate overlapping route painted at a wired pin; connectivity spec dot
  clause sharpened; first direct contact-evidence test suite added.
- Validation: new contact.test.ts (6 tests), derived + render-svg suites,
  typecheck, prettier, markdown links, test-impact, and diff checks passed;
  behavior confirmed live in the editor.
- Commit status: completed on `claude/junction-dot-collinear-arms`; mainline
  merge gated on the remote required checks.

## 2026-08-21 - Visual golden refresh and release-gate wiring

- Changed areas: regenerated the stale `fixtures/visual-golden/
{phase-3-crossing,phase-5-dense-analog}.svg` from current `main`
  (d8a813a8) after tracing every delta to accepted merged changes —
  9a552d32 removed the legacy ports layer and in-symbol instance labels and
  replaced the phase-5 input project; later bound-display/rich-text,
  canonical route geometry/contact, and collinear-arm dot (PR #144) work
  finished the drift; wired `node scripts/visual-golden.mjs --check` into
  `release:verify:built` (so `ci:check`, `ci:release`, and the CI Release
  contracts job now fail on golden drift) and classified the script in the
  gate catalog's release group.
- Validation: fresh renders diffed element-by-element against both stale
  goldens with per-delta commit attribution; `node scripts/visual-golden.mjs
--check` passes post-regeneration; prettier, markdown-link, test-impact,
  and diff checks passed. pnpm is unavailable on this machine, so the
  canonical mainline gate is delegated to the remote required checks.
- Commit status: completed on `claude/peaceful-poitras-f8ccde`; mainline

## 2026-08-21 - Document style overrides (schema 21)

- Changed areas: schema-21 `presentation.styleOverrides` (five bounded scale
  factors) with ADR 0038 and the rolling 20->21 upgrade; single
  overrides-aware profile resolution in @icm/derived consumed by derived
  geometry, render-svg, and the editor; `set_presentation_style` extended
  (set/keep/clear, undoable); Draw-menu Document style dialog; fixtures,
  bundled examples, agent-api/MCP artifacts, and version documentation
  updated.
- Validation: full unit suite (172 files / 1057 tests), new Playwright
  document-style scenario, typecheck, prettier, markdown links,
  export-golden, agent-api/MCP generator checks, test-impact, diff checks.
- Commit status: completed on `claude/document-style-overrides`; mainline
  merge gated on the remote required checks.

## 2026-08-21 - User-saved Library examples

- Changed areas: new origin-local `user-examples-store` (own IndexedDB
  database, canonical Project text, protocol re-parse on read), Examples
  panel "My examples" section with open/export/delete, File-menu
  "Save as Example", persistence-spec classification plus two corrected
  schema-version sentences.
- Validation: store and panel unit contracts, one Playwright scenario, full
  unit suite (173 files / 1064 tests), typecheck, prettier, markdown links,
  test-impact, diff checks.
- Commit status: completed on `claude/user-examples`; mainline merge gated
  on the remote required checks.

## 2026-08-21 - Always-open insert picker list

- Changed areas: removed the Insert dialog's collapse toggle and picker
  open/close state so the catalog list is permanently visible and survives
  selection; taller list cap; double-clicking an option applies it
  immediately; layout-stability e2e rewritten for the always-open contract
  plus a new double-click scenario.
- Validation: component-insert unit suite (10 files / 40 tests), full
  component-insert Playwright suite (22 passed), typecheck, prettier,
  test-impact, diff checks; verified live.
- Commit status: completed on `claude/insert-picker-always-open`; mainline
  merge gated on the remote required checks.

## 2026-08-21 - Bundled-example promotion path

- Changed areas: new `scripts/promote-example.mjs` plus testable
  registration codemod in `scripts/lib/example-promotion.mjs` (exported
  Project -> validated canonical asset + registry entry in one command);
  bundled-example test refactored to per-example contracts so promotions
  cannot break a frozen count or single-document assumption.
- Validation: codemod tests, refactored examples suite, end-to-end smoke
  promotion (then reverted), typecheck, prettier, markdown links,
  test-impact, diff checks.
- Commit status: completed on `claude/example-promotion`; mainline merge
  gated on the remote required checks.

## 2026-08-21 - Community gallery phase G1 (public feed foundation)

- Changed areas: new `GalleryDO` + `/api/gallery*` Worker surface
  (publish-first storage with admin recycle bin, bin-only hard delete,
  hashed-IP quotas, rolling-window re-serialization, server-rendered
  previews); site lands on a full-screen gallery feed at `/` with the
  editor at `/editor` and entry deep links at `/g/<id>`; bundled examples
  double as starter tiles; new community-gallery spec and platform roadmap
  (G1-G4); root workspace deps for the Worker with hand-maintained
  lockfile links.
- Validation: worker suite on in-memory SQLite (8 contracts), feed
  component tests, new gallery Playwright spec, complete Playwright suite
  (179 passed) after the `/editor` landing sweep, typecheck, prettier,
  markdown links, test-impact, diff checks.
- Commit status: completed on `claude/community-gallery`; mainline merge
  gated on the remote required checks.

## 2026-08-22 - Bundled tiles only while the gallery is empty

- Changed areas: gallery feed gates its bundled starter tiles on the
  community list being empty, removing the duplicated wall after the first
  real entries; populated-feed e2e expectation flipped.
- Validation: gallery Playwright spec (4 passed), feed unit tests,
  typecheck, prettier, test-impact, diff checks.
- Commit status: completed on `claude/gallery-bundled-fallback`; mainline

## 2026-08-22 - Editor UI declutter and adjustable-passive fixes

- Changed areas: Library drops the Recent fold and renames the virtual VDD
  Rail entry to Power Rail; the Insert dialog stops echoing the selected
  name; the floating startup recovery notice is gone (File menu keeps the
  recovery entry); the Draw dropdown becomes an always-visible horizontal
  toolbar and the left rail keeps only panel toggles; Inverter/NOR vertices
  pull back by their miter overshoot so gate bodies stop spiking into the
  negation bubbles; variable-resistor becomes an ordinary R primitive
  (removing the generated child-Cell path that made it unplaceable inside
  its own Cell) and gains variable-capacitor/variable-inductor siblings;
  Port placement loses its setup modal, with the role carried by the Library
  entry (new Cell Pin item) and names generated then edited on canvas;
  Net Port rename now runs planEnsureNamedNet so same-name Ports join one
  Net.
- Validation: typecheck, full unit suite (172 files / 1063 tests), full
  Playwright suite (175 passed), prettier, markdown links, references,
  agent-kit/MCP/visual-golden drift checks; every changed interaction was
  exercised in a running editor. pnpm is unavailable locally, so the
  canonical ci:check is delegated to the remote required checks.
- Commit status: four commits on `claude/editor-ui-declutter`; mainline
  merge gated on the remote required checks.

## 2026-08-22 - Gallery return button and one product name

- Changed areas: explicit "<- Gallery" control at the far left of the
  document toolbar (one-click return to the landing feed); every
  user-visible "(Interactive) Circuit Maker" string — editor header,
  help/about dialogs, page title, PWA manifest — renamed to Analog Canvas.
- Validation: gallery Playwright spec (4 passed incl. click-through),
  App/component unit suites (18), typecheck, prettier, test-impact, diff
  checks.
- Commit status: completed on `claude/gallery-back-button`; mainline merge
  gated on the remote required checks.

## 2026-08-22 — In-editor Publish to Gallery (admin-gated bridge)

- Target: `plan/2026-08-22-gallery-publish-dialog/plan.md` (completed).
- Change: File > "Publish to Gallery…" dialog publishes the live Project
  through the documented submissions endpoint with the owner passphrase
  (session-remembered, forgotten on 401); outcome-specific messages for
  201/401/413/429/400/network. Roadmap G1 notes the in-app surface.
- Files: `features/editor-shell/gallery-publish.ts(.test.ts)`,
  `publish-gallery-dialog.tsx(.test.tsx)`, `App.tsx`, `styles.css`,
  `e2e/gallery.spec.ts`, roadmap.
- Validation: 5 unit tests, gallery Playwright spec 5/5, typecheck,
  prettier, test-impact, diff checks.
- Commit status: completed on `claude/gallery-publish`; mainline merge
  gated on the remote required checks.

## 2026-08-22 — Hotfix: publish dialog endpoint path

- Target: `plan/2026-08-22-gallery-submissions-hotfix/plan.md` (completed).
- Change: the publish client now posts to `/api/gallery/submissions`
  (was `/api/gallery`, a 404 surfacing as "rejected (not-found)" on a
  correct form — user-reported in production); the e2e mock is pinned to
  the real path so drift fails the test.
- Validation: gallery-publish unit tests, publish e2e scenario, prettier,
  test-impact, diff checks; production re-publish verified after deploy.
- Commit status: completed on `claude/gallery-submissions-path`.

## 2026-08-22 - Inductor scale reconciled with the other passives

- Changed areas: the inductor generator now emits `inductor-compact` beside
  the calibrated `inductor`, scaling the same manifest-pinned PDF vector
  evidence by a derived 2/3 `pinSpanScale` so L matches R and C at a 40-unit
  pin span; `inductor` keeps its evidence-exact geometry, fidelity target,
  and existing Instances but is renamed "Large Inductor" and made
  manual-only; the `spice:L` mapping and the SPICE importer's symbol choice
  move to the compact Symbol; `variable-inductor` was rebuilt on the compact
  base; new `inductorCompactDevice`, palette, label-side, and catalog
  wiring. No reference evidence, measurement, or manifest hash was touched.
- Validation: typecheck, full unit suite (174 files / 1074 tests), full
  Playwright suite (179 passed), generator/catalog/agent-kit/MCP/
  visual-golden/references/markdown drift checks; rendered bounds measured
  in the running editor (R, C, compact L, variable L all 40 tall; large L
  60).
- Commit status: completed on `claude/inductor-scale-normalization`;
  mainline merge gated on the remote required checks.

## 2026-08-22 — Publish dialog facelift and author memory

- Target: `plan/2026-08-22-publish-dialog-facelift/plan.md` (completed).
- Change: publish dialog rebuilt as a single-column modern card (stacked
  full-width fields, inline optional hints, primary action) after user
  feedback on the borrowed insert-picker shell; author byline now
  persists in localStorage and prefills the next publish.
- Validation: 6 unit tests, gallery Playwright spec 5/5 unchanged,
  visual check, prettier, test-impact, diff checks.
- Commit status: completed on `claude/publish-dialog-facelift`.

## 2026-08-22 — Gallery phase G2: accounts and sign-in (dark-shipped)

- Target: `plan/2026-08-22-gallery-auth-g2/plan.md` (completed).
- Change: `AuthDO` (migration v4) behind `/api/auth/*` — GitHub/Google
  OAuth, Resend magic links, hashed HttpOnly sessions, `ADMIN_EMAILS`
  per-request super-admin, rename, logout; gallery accepts an admin
  session wherever the bearer worked; feed header account UI (dark until
  a provider secret exists); publish dialog goes passphrase-free on an
  admin session and prefills the author byline from the account name;
  deploy workflow syncs the new secrets when present.
- Files: `worker/auth.ts(.test.ts)`, `worker/gallery.ts(.test.ts)`,
  `worker/index.ts`, `wrangler.jsonc`, `cloudflare.yml`,
  `components/account.tsx(.test.tsx)`, `gallery-feed.tsx`,
  `gallery-publish.ts(.test.ts)`, `publish-gallery-dialog.tsx(.test.tsx)`,
  `App.tsx`, `styles.css`, `e2e/gallery.spec.ts`, spec + roadmap.
- Validation: worker suites 18, editor unit sweep 92, gallery Playwright
  8/8, typecheck, prettier, test-impact, diff checks.
- Commit status: completed on `claude/gallery-auth-g2`; mainline merge
  gated on the remote required checks.

## 2026-08-22 — Fixed and variable capacitor plate semantics

- Target: `plan/2026-08-22-capacitor-plate-semantics/plan.md` (completed).
- Change: device descriptors now assign stable top/bottom plate roles to
  fixed capacitor pins `1/2` and variable-capacitor pins `P1/P2`; Project JSON,
  Symbol artwork, and SPICE syntax/order remain unchanged.
- Validation: focused device/SPICE/netlist tests (18), static contracts and
  typecheck, affected gate (178 unit files / 1105 tests and 124 browser tests),
  test-impact, formatting, documentation, MCP projection, and diff checks.
- Commit status: completed locally; remote mainline delivery remains gated.

## 2026-08-22 — Axis-aware Power Rail and VDD Port labels

- Target: `plan/2026-08-22-vdd-rail-port-presentation/plan.md` (completed).
- Change: retained generic `Power Rail`/`Rail` naming and named-Net behavior;
  GUI and Agent author horizontal or vertical rails, endpoint resize follows
  the active axis with live preview, tapped movement stays connected, and
  automatic VDD Port labels remain upright/clear through orientation changes
  without overriding user-moved labels.
- Validation: focused unit and browser tests, static contracts and typecheck,
  affected gate (178 unit files / 1105 tests and 124 browser tests),
  test-impact, formatting, documentation, MCP projection, and diff checks.
- Commit status: completed locally; remote mainline delivery remains gated.

## 2026-08-22 — Capacitor plate facts in Properties

- Target: `plan/2026-08-22-capacitor-plate-properties/plan.md` (completed).
- Change: selected fixed and variable capacitors now show read-only Top/Bottom
  plate rows with stable Pin names and current named Net, unnamed Net ID, or
  unconnected state; no instance override or Project protocol field was added.
- Validation: focused unit/browser checks, static contracts and typecheck,
  affected unit gate (179 files / 1108 tests), editor browser gate (91 tests),
  test-impact, formatting, and diff checks.
- Commit status: completed locally; remote mainline delivery remains gated.

## 2026-08-22 — Razavi logic-gate family alignment

- Target: `plan/2026-08-22-razavi-logic-gate-alignment/plan.md` (completed).
- Change: extracted hash-pinned native textbook vectors for inverter, AND,
  NAND, NOR, and XOR; generated reviewed OR/XNOR compositions; registered all
  seven gates in the runtime, GUI, Agent catalog, and MCP resources; added a
  symbol-only fidelity runner without restoring the retired scene pipeline.
- Validation: deterministic 11/11 evidence regeneration and wrong-source
  rejection; direct hard IoU inverter 0.7172, AND 0.9326, NAND 0.8301, NOR
  0.9064, XOR 0.9101; generator/catalog drift checks; focused and affected
  gates; canonical CI passed 1097 unit and 183 browser tests on an isolated
  local port, with release verification and production smoke.
- Commit status: completed on `codex/razavi-logic-gate-alignment`; remote
  required checks pending.

## 2026-08-22 — Logic-gate continuity and scale follow-up

- Target: `plan/2026-08-22-razavi-logic-gate-continuity-scale/plan.md`
  (completed).
- Change: corrected vertical PDF lead endpoint selection for NAND/inverter and
  restored source-weight negation bubbles, closing visible lead/body and
  body/bubble gaps; retained the measured family scale after a common-canvas
  NAND/inverter/MOS/resistor/capacitor comparison.
- Validation: deterministic 11/11 extraction; direct hard IoU inverter 0.8018,
  NAND 0.9180, NOR 0.9417; generator drift and focused geometry tests; affected
  gates; canonical CI passed 1099 unit and 183 browser tests.
- Commit status: completed on `codex/razavi-logic-gate-alignment`; remote
  required checks pending.

## 2026-08-22 - SKY130 external MOS presentation

- Changed areas: reused explicit four-terminal Razavi NMOS/PMOS artwork for
  reviewed SKY130 external definitions; added an atomic Model-field transition
  between ordinary `M` model binding and external `X` binding; exposed `nf`
  without converting retained `m`; and preserved generic-block fallback.
- Validation: focused symbol/planner/import/editor tests, `gate:preflight`,
  `gate:affected` (167 files / 1018 unit tests plus all selected browser
  suites), frozen install, and canonical `pnpm ci:check` with builds, release
  checks, production smoke, and 171 browser tests passed.
- Commit status: ready to commit on
  `codex/sky130-external-mos-presentation`.

## 2026-08-22 - SKY130, logic-gate, VDD, and capacitor integration

- Target: `plan/2026-08-22-sky130-logic-vdd-cap-stack/plan.md` (completed).
- Changed areas: stacked the completed VDD/capacitor, Razavi logic-gate, and
  SKY130 external-MOS work on latest `main`; retained the existing device,
  external-subcircuit, named-Net, routing, and symbol/catalog boundaries; and
  updated the SKY130 browser scenario to the current `/editor` route.
- Validation: Razavi drift checks; 177 focused tests; affected browser gates;
  branch verification with 1120 tests/build/smoke; frozen install and canonical
  `pnpm ci:check` with 185 browser tests; all six GitHub checks passed on PR
  #159 before close-out.
- Commit status: delivered to `codex/sky130-logic-vdd-cap-stack`; PR #159 open
  for review, superseding closed draft PR #141.

## 2026-08-22 — Examples toggle and bundled circuit additions

- Target: `plan/2026-08-22-examples-toggle-and-circuits/plan.md` (completed).
- Change: Examples now collapses when its active rail button is clicked again;
  added bundled Current-Mirror-Loaded Differential Pair and Fully Differential
  Two-Stage Op Amp Project cards.
- Validation: focused unit/browser checks, preflight, and affected gate
  (1108 unit tests; 22 component-insert and 91 manual-editor browser tests).
- Commit status: committed locally on `codex/examples-toggle-and-circuits`.

## 2026-08-22 — Examples mainline delivery

- Target: `plan/2026-08-22-merge-examples-main/plan.md` (completed).
- Change: rebased the completed Examples feature on current `origin/main`,
  retaining concurrent plan-log entries without changing product behavior.
- Validation: preflight against `origin/main`, frozen dependency install, and
  canonical `pnpm ci:check`; the full Playwright run recorded `passed` with no
  failed tests.
- Commit status: rebased review branch is ready for required GitHub checks and
  merge to remote `main`.

## 2026-08-22 — Hotfix: auth fetch seam Illegal invocation

- Target: `plan/2026-08-22-auth-fetch-binding/plan.md` (completed).
- Change: `AuthDO.fetchLike` was the raw global fetch; `this.fetchLike()`
  rebinds `this` in the Workers runtime ("Illegal invocation"), so every
  OAuth exchange failed as the generic sign-in error while Node tests
  passed. Arrow-wrapped the seam, switched the GitHub token exchange to
  form-encoding, added an identity regression test.
- Validation: worker suites, typecheck, prettier, test-impact; production
  GitHub sign-in verified after deploy.
- Commit status: completed on `claude/auth-fetch-binding`.

## 2026-08-22 - Editor chrome pass from a live review

- Changed areas: both left panels lose the "QUICK PLACE" title banner (and
  its dead CSS); Publish to Gallery moves out of the File menu to a menubar
  button beside Search; the brand mark plus wordmark becomes a two-way
  editor/gallery switch (the gallery's brand now links to the editor); the
  Library panel gains a dragged, clamped, persisted width through
  `useEditorPanels` and a keyboard-operable `col-resize` separator; the
  Document style dialog is rebuilt on the publish dialog's card with one
  settings row per knob and a Reset/Done footer.
- Validation: typecheck, full unit suite (179 files / 1121 tests), full
  Playwright suite (185; one unrelated current-marker drag flake passed on
  re-run), prettier, markdown links, diff checks; every surface verified in
  a running editor including a real 248→368px handle drag.
- Commit status: completed on `claude/drop-panel-title-banner`; mainline
  merge gated on the remote required checks.

## 2026-08-22 — Gallery phase G3: review queue with quality gates

- Target: `plan/2026-08-22-gallery-review-g3/plan.md` (completed).
- Change: shared `evaluateSubmissionGates` (@icm/derived) — zero ERC
  errors, zero floating endpoints (wire / named net / NoConnect), no
  near-empty projects — enforced in the worker (422) and previewed
  blocking in the publish dialog; ordinary signed-in submissions enter
  `pending` until a reviewer approves or rejects with a stored optional
  reason; in-app moderator appointment by email; `/review` and `/mine`
  pages; feed account links; root workspace gained `@icm/derived`.
- Validation: gates 5, worker 47, editor units 31, full unit sweep 1132,
  gallery Playwright 10/10, typecheck, prettier, test-impact, diff
  checks.
- Commit status: completed on `claude/gallery-review-g3`; mainline merge

## 2026-08-22 - Example import, square palette tiles, paste marker references

- Changed areas: clicking a Library example now attaches its content to the
  placement cursor as an ordinary clipboard payload instead of replacing the
  Project (hierarchical examples still open as their own Project behind the
  dirty guard); palette tiles became fixed squares in an auto-fill grid so a
  wider panel fits more per row; the Publish button dropped its ellipsis; and
  paste now allocates a free reference for schematic-only markers, fixing the
  `Duplicate netlist instance reference: PWR1` rejection that a second example
  import (or an ordinary copy of a ground/power port) triggered.
- Validation: typecheck, full unit suite (179 files / 1121 tests), full
  Playwright suite (185 passed), prettier, diff checks; example import, tile
  squareness, and panel resizing all exercised in a running editor.
- Commit status: completed on `claude/publish-label-clarity`; mainline merge
  gated on the remote required checks.

## 2026-08-22 - Named differential input swap and one shared brand

- Changed areas: new role-driven `hasDifferentialInputs` projection in
  `@icm/derived`; instance properties offer "Swap + / − inputs" for op amps
  and comparators, issuing the existing top/bottom reflection so marks and
  terminals move together; the gallery brand adopts the editor's markup,
  classes, and typography, links to the editor, and the editor's brand
  truncation is scoped to the editor chrome so the gallery shows the full
  wordmark.
- Validation: typecheck, full unit suite (180 files / 1133 tests), full
  Playwright suite (187 passed), prettier, diff checks; the swap and both
  brands verified in the running app.
- Commit status: completed on `claude/differential-input-swap`; mainline
  merge gated on the remote required checks.

## 2026-08-22 - Differential-output op amp and independent output swap

- Changed areas: the op-amp generator now derives `opamp-differential` and
  `opamp-differential-crossed` from the same pinned PDF vector evidence (body
  truncated where the reviewed triangle edges reach the ±10 output height,
  output marks reflected about the body centerline); both are reviewed palette
  entries; instance properties gained "Swap + / − outputs", which exchanges
  the two Symbols through the existing `set_instance_symbol` edit so terminal
  names and attached Nets survive.
- Validation: typecheck, full unit suite (181 files / 1135 tests), full
  Playwright suite (187 passed), generator/catalog/agent-kit/MCP/visual-golden/
  references drift checks, prettier, diff checks; both Symbols and the swap
  verified in the running editor.
- Commit status: completed on `claude/differential-output-opamp`; mainline
  merge gated on the remote required checks.

## 2026-08-22 - Unified copy placement transforms

- Target: `plan/2026-08-22-unified-copy-transform/plan.md` (completed).
- Changed areas: made copy ghost rendering inspect the same dry-run edit
  transaction used by commit; replayed secondary rotate/reflect commands in
  input order; corrected already-oriented object-label projection; and adapted
  the browser assertion to the ghost's reserved copy ID.
- Validation: focused clipboard/orientation unit tests, focused copy-preview
  browser workflow, `pnpm ci:static`, preflight, and diff checks passed.
- Commit status: committed locally on `codex/unified-transform-power-bulk`;
  remote mainline delivery remains gated.

## 2026-08-22 - Canonical Port label transform follow-up

- Target: `plan/2026-08-22-unified-copy-transform/plan.md` (completed).
- Change: canonical free-Port Net labels now recover their single upright
  reference placement after rotation or mirroring, including copy secondary
  operations; partial formal-Port ghosts omit Cell-interface metadata outside
  the fragment.
- Validation: focused clipboard/Edit Engine tests, static contracts, preflight,
  test-impact, and affected unit/component/hierarchy/editor browser gates.
- Commit status: committed locally as `06772ef5`; remote mainline delivery
  remains gated.

## 2026-08-22 - Explicit Ground placement policy

- Target: `plan/2026-08-22-ground-placement-policy/plan.md` (completed).
- Change: a user-placed Ground explicitly grounds an ordinary contacted Net by
  merging into `0` or canonicalizing it; conflicting supply domains remain
  rejected.
- Validation: focused planner/placement tests, static contracts, preflight,
  test-impact, and affected unit/component/hierarchy/editor browser gates.
- Commit status: committed locally as `eccaef21`; remote mainline delivery
  remains gated.

## 2026-08-22 - Stable MOS bulk defaults

- Target: `plan/2026-08-22-mos-bulk-defaults/plan.md` (completed).
- Change: the first explicit Ground, VDD Port, or named Power Rail persists an
  unset stable-ID NMOS/PMOS default; Properties exposes those choices without
  overriding explicit or no-connect B decisions.
- Validation: focused planner/derived/browser tests, static contracts,
  preflight, test-impact, and affected unit/component/hierarchy/editor browser
  gates.
- Commit status: committed locally as `4fc49714`; remote mainline delivery
  remains gated.

## 2026-08-22 - Bundled Example MOS bulk semantics

- Target: `plan/2026-08-22-example-mos-bulk-semantics/plan.md` (completed).
- Change: repaired only the missing MOS body facts in the two bundled
  differential Examples by recording their existing VDD/0 defaults, B
  terminals, and `cell-default` bindings; added a per-Example unresolved-bulk
  ERC regression.
- Validation: live editor `Issues (0)` for both fixtures; focused Example and
  bulk tests; focused Example browser workflow; static contracts, preflight,
  test-impact, and affected unit/component/hierarchy/editor gates.
- Commit status: committed locally as `bd5bc67e`; mainline delivery proceeds
  through the canonical local and remote gates.

## 2026-08-22 - Publish button spells out its destination

- Changed areas: the menubar publish control reads "Publish to Gallery"
  instead of "Publish"; the redundant aria-label is dropped now that the
  visible text carries the full action. CI caught that the longer label
  pushed the right-hand chrome past a 720px viewport, so the menubar now
  shrinks and scrolls its own row under 900px; with it able to yield, the
  editor's truncation moved off the brand link onto the project/document
  line, leaving both views with a pixel-identical 22px mark and an untruncated
  wordmark.
- Validation: typecheck, full unit suite (181 files / 1135 tests), full
  Playwright suite (187 passed), prettier, markdown links, diff checks; brand
  geometry measured in both views.
- Commit status: completed on `claude/publish-full-label`; mainline merge
  gated on the remote required checks.

## 2026-08-22 - One chrome band across both views

- Changed areas: the gallery header adopts the editor's menubar height and
  padding; every gallery header control (owner badge, account links and
  buttons, sign-in summary, primary action) sits on the shared control
  height; the brand block in both views spans that same band, so each
  header's two sides are equal and the two headers match each other.
- Validation: typecheck, full unit suite (182 files / 1148 tests), full
  Playwright suite (186 passed; the recurring component-insert:376 timing
  flake passed on its isolated re-run), prettier, diff checks; header, brand,
  and button geometry measured in both views.
- Commit status: completed on `claude/gallery-header-band`; mainline merge
  gated on the remote required checks.

## 2026-08-22 - Insert dialog dismissal gap behind a recurring "flake"

- Changed areas: Escape now dismisses an open Insert dialog from the window
  handler. The dialog focuses its search field a frame after opening and its
  own Escape handler sits on the dialog form, so an Escape pressed in that gap
  left the dialog open with its backdrop swallowing later pointer actions —
  the cause of the `component-insert.spec.ts:376` failures that had looked
  like a timing flake all session. The spec's incidental coverage is replaced
  by a deterministic test that moves focus out of the dialog before pressing
  Escape.
- Validation: typecheck, the spec file three times end to end, the new test
  re-run with the fix stashed to prove it fails without it, editor unit tests
  (419), full Playwright suite (188 passed), prettier, diff checks.
- Commit status: completed on `claude/fix-copy-mode-flake`; mainline merge
  gated on the remote required checks.

## 2026-08-22 - Placement ghosts seeded from the last pointer position

- Changed areas: the canvas remembers its last pointer position, and both the
  copy and component placement paths seed their preview from it, so a
  placement started from the keyboard shows its ghost at the cursor instead of
  waiting for the next pointer move.
- Validation: typecheck, editor unit tests (419), full Playwright suite (189
  passed), the new test re-run with the fix stashed to prove it fails without
  it, prettier, diff checks; reproduced and re-verified in a running editor.
- Commit status: completed on `claude/seed-placement-preview`; mainline merge
  gated on the remote required checks.

## 2026-08-22 — Gallery masonry feed (G4 first slice)

- Target: `plan/2026-08-22-gallery-masonry/plan.md` (completed).
- Change: replaced the CSS multi-column wall with a true masonry
  component (equal-width columns, natural tile heights, greedy
  shortest-column placement with left-to-right reading order, one
  ResizeObserver relayout on resize/image load); owner picked it from
  side-by-side renderings of the live entries.
- Validation: component suite 13, gallery Playwright 11/11 (new
  placement scenario), typecheck, prettier, test-impact, diff checks.
- Commit status: completed on `claude/gallery-masonry`.

## 2026-08-22 - One annotation text house style

- Changed areas: `semanticTextDocument` and `defaultDraftTextDocument` now
  share one rule — capitalized italic leading symbol, remainder as its
  subscript — replacing the `V*`/`I*` shorthand and the role-specific
  instance-label regex. Subscripts stay upright except supply designators
  (DD/SS/CC/EE/BB), carried as a nested italic span because the renderer
  already honors that as a deliberate override. A trailing polarity sign stays
  outside the subscript, and a value containing whitespace stays prose so a
  drafting note is not swallowed into one long subscript.
- Historical documents need no migration: bound annotations are pure
  projections re-derived on read by `resolveAnnotationText`.
- Validation: full unit suite (1155), full Playwright suite (189 passed),
  visual and export golden `--check` both clean (goldens carry `Vin+`/`Vout`,
  which the superseded rule split identically), typecheck, prettier, diff
  checks; rendered output inspected per glyph for VDD/VSS/VCC/Vin/Vout/Iout/
  CLK/A and both drafting cases.
- Commit status: completed on `claude/semantic-text-subscripts`; mainline
  merge gated on the remote required checks.

## 2026-08-22 — Gallery chrome everywhere and owner editing

- Target: `plan/2026-08-22-gallery-owner-editing/plan.md` (completed).
- Change: shared `GalleryChrome` on every state of the feed, `/mine`,
  and `/review` (no more bare edge-touching paragraphs); `PUT
/api/gallery/<id>` — reviewers update any entry in place, ordinary
  owners update through the gates and re-enter review with the previous
  decision cleared; publish dialog gains an update-vs-new mode; `/mine`
  cards show previews, open-in-editor links, and resubmission guidance.
- Validation: worker gallery 13, unit sweep 472, gallery Playwright
  13/13, typecheck, prettier, test-impact, diff checks.
- Commit status: completed on `claude/gallery-owner-editing`.

## 2026-08-22 — Gallery feed G4 remainder

- Target: `plan/2026-08-22-gallery-feed-g4/plan.md` (completed).
- Change: list gains an `author` filter before keyset paging; the feed
  pages via an IntersectionObserver sentinel and filters by clickable
  bylines (URL-carried, clearable); `/review` gains the admin recycle
  bin (restore, confirm-guarded delete-forever).
- Validation: worker gallery 14, component units 28, gallery Playwright
  16/16, typecheck, prettier, test-impact, diff checks.
- Commit status: completed on `claude/gallery-feed-g4` (stacked on
  `claude/gallery-owner-editing`).

## 2026-08-22 — Gallery circuit tags

- Target: `plan/2026-08-22-gallery-tags/plan.md` (completed).
- Change: one tag normalization through submit/update/list/aggregate;
  `?tags=a,b` OR-union filter; `GET /api/gallery/tags` counts; publish
  dialog chip editor with presets and update-mode prefill (tags editable
  any time via the owner-update path); feed multi-select tag menu with
  clickable tile chips.
- Validation: worker gallery 15, editor units 54, gallery Playwright
  17/17, typecheck, prettier, test-impact, diff checks.
- Commit status: completed on `claude/gallery-tags` (stacked on
  `claude/gallery-feed-g4`).

## 2026-08-22 - Library category order and Bulk action reach

- Changed areas: `CATEGORY_ORDER` now runs Transistors, Passives, Power and
  Ports, Sources, Switches, Analog Blocks, Logic Gates — display order only,
  no category membership change. The MOS bulk section moved to the head of the
  selection panel and now leads with an accented "Draw bulk connection" button
  instead of trailing its two default-Net selects.
- Validation: component-insert unit tests (47), Playwright component-insert +
  manual-editor specs (117 passed), typecheck, prettier, diff checks; both
  changes confirmed in a running editor.
- Commit status: completed on `claude/library-order-and-bulk`; mainline merge

## 2026-08-22 - Repeating a Cell Pin name places another marker

- Changed areas: new `planAttachCellPortMarker` appends a Port Instance to an
  existing terminal's `interfaceInstanceIds` and merges the marker's Net into
  the terminal's Net; placement routes through it instead of aborting with
  `Cell port X already exists`. The model already typed `interfaceInstanceIds`
  as a plural array, so no schema change was needed.
- Kept one terminal per name deliberately: `connectivity-index.ts` and
  `schema/project.ts` resolve a parent Instance's pin to a child terminal by
  name, so two same-named terminals would resolve ambiguously to the first
  match. Rename-onto-an-existing-name still rejects (ambiguous between "one
  pin" and a typo) but now names the working alternative.
- Validation: full unit suite (1162), edit-engine + component-insert (221),
  Playwright hierarchy spec (12 passed) including the new placement case,
  typecheck, prettier, diff checks.
- Commit status: completed on `claude/duplicate-pin-names`; mainline merge
  gated on the remote required checks.

## 2026-08-22 - Steering the wire corner from the drafting gesture

- Changed areas: `WireCornerOrder` gained `horizontal-first`/`vertical-first`,
  `appendOrthogonal` honors them over the inherited incoming direction, and
  `compileWireDraft` now threads a step's corner order through its orthogonal
  branch (it was previously dropped). Middle-click while drafting cycles the
  corner shape — horizontal-first, vertical-first, 45° diagonal — replacing a
  binding that only reached the diagonal.
- Already worked, now covered: double-click finishes a wire while single click
  continues it (`onDoubleClick` → `applyWireCanvasPoint(finish=true)`;
  pointer-down ignores `detail !== 1`). Confirmed in a running editor.
- Deliberately not done: free-angle segments. `validateRoute` rejects any
  non-octilinear Route, so arbitrary angles change an enforced geometry
  invariant rather than a drafting option and need a spec/ADR decision.
- Validation: full unit suite (1169), full Playwright suite (199 passed)
  including a new corner-geometry spec, typecheck, prettier, diff checks.
- Commit status: completed on `claude/wire-drafting-iteration`; mainline merge
  gated on the remote required checks.

## 2026-08-22 — Examples panel reads the community gallery

- Target: `plan/2026-08-22-examples-from-gallery/plan.md` (completed).
- Change: the Examples panel lists the same gallery as the landing feed
  and opens entries through the shared `/g/<id>` path (arming publish
  update mode); bundled starters remain the offline/empty fallback.
  Production data: the two missing bundled examples seeded with tags and
  the two original seeds retagged — all four starters now in the gallery.
- Validation: editor-shell units 26, gallery Playwright 18/18, existing
  examples e2e 2/2, typecheck, prettier, test-impact, diff checks.
- Commit status: completed on `claude/examples-from-gallery`.

## 2026-08-22 — Hotfix: gallery pages scroll inside their shell

- Target: `plan/2026-08-22-gallery-scroll-fix/plan.md` (completed).
- Change: the editor locks #root/body with overflow hidden, so the
  gallery pages had no scroll container — .gallery-shell/.review-shell
  now scroll themselves (height 100%, overflow-y auto), which also
  revives below-the-fold lazy previews; new e2e pins the shell as the
  scroller.
- Validation: gallery Playwright 18/18, prettier, test-impact, diff
  checks; production verification after deploy.
- Commit status: completed on `claude/gallery-scroll-fix`.

## 2026-08-22 - A Power Rail stays straight and resizes from its ends

- Fixed the reported "rail length cannot be changed": the rail's end handle is
  drawn under the Junction's `endpoint-hit` circle, and the capture-phase
  `handleCanvasHitPointerDown` skipped handles by testing only `event.target`
  — the topmost element — so it claimed the press and translated the rail.
  It now ranks the whole element stack at the point. Reproduced first (both
  ends moved +100, status "Moved Power Rail"), fixed, re-verified.
- The existing rail-resize e2e passed throughout because it connects a wire
  first, which removes the covering endpoint circle; real usage never starts
  from that state.
- Added the missing invariant: `validateRoute` now requires a whole connected
  rail run to be collinear, not just each stored Route. A wire drawn from a
  rail endpoint inherits `presentation: "power-rail"`, so a perpendicular
  branch previously produced a bent rail from two straight halves. Collinear
  extension still succeeds.
- Historical data is not silently straightened: the transaction layer
  grandfathers pre-existing route errors on unchanged geometry, so a bent
  Project still opens but any edit touching that rail must leave it straight.
- Validation: full unit suite (1170) with the new case re-run against a
  stashed invariant to prove it fails without it, full Playwright suite (200
  passed), typecheck, prettier, diff checks.
- Commit status: completed on `claude/power-rail-straight`; mainline merge
  gated on the remote required checks.

## 2026-08-22 - The canvas text editor stops clipping long labels

- Reproduced the reported "text box cannot show everything" on a Port's
  right-aligned label: typing a longer name gave `scrollHeight 40` against
  `clientHeight 36` with `overflow: visible`. The overlay is a
  `foreignObject`, which clips silently, so the wrapped line was neither
  visible nor scrollable.
- Cause: `resolveCanvasTextEditorFrame` sizes the frame from the committed
  bounds — before the longer name exists — and its height floor budgeted one
  line. It now budgets three, and `.rich-text-editable` gained
  `max-height: 100%` with `overflow-y: auto` so anything past the frame
  scrolls instead of vanishing.
- Validation: measured `scrollHeight === clientHeight` afterwards for 3-, 26-
  and 33-character names, with a 400-character extreme scrolling; full unit
  suite (1172), full Playwright suite (203 passed), the new e2e case re-run
  against a stashed fix to prove it fails without it; typecheck, prettier,
  diff checks.
- Commit status: completed on `claude/text-editor-clipping`; mainline merge
  gated on the remote required checks.

## 2026-08-22 - Dragging a marquee selection that holds no Instance

- Reproduced the reported intermittent "marquee then drag does nothing": two
  standalone wires, marquee across both (status "Selected 6 objects", both
  Routes marked `selected`), drag one — only the grabbed Route moved (dy 70
  against dy 0) and the status read "Moved loose route", a single-object move.
- Cause: `compositeSelectionOwnsHit` required `selectedIds.length > 0`, and
  `selectedIds` holds only Instances, so a marquee with no Instance never
  counted as composite and the press fell through to the single-object
  branches. A Junction hit only re-selected itself, which reads as the drag
  doing nothing. That is what made it intermittent — it worked whenever the
  selection happened to include an Instance.
- Fix: count a composite selection across every kind, and when it owns the hit
  without an Instance to anchor the move, fall back to
  `beginVisualSelectionMoveFromSelection` guarded by `planSelectionMove`, the
  same pattern the existing route-tap path uses.
- Validation: full unit suite (1172), full Playwright suite (204 passed), the
  new e2e case re-run against a stashed fix to prove it fails without it
  (Expected 70, Received 0); typecheck, prettier, diff checks.
- Commit status: completed on `claude/marquee-drag`; mainline merge gated on
  the remote required checks.

## 2026-08-22 - Canonical MOS presentation for SKY130 calls

- Target: `plan/2026-08-22-sky130-canonical-mos-mapping/plan.md` (completed).
- Changed areas: reviewed SKY130 external calls now reuse canonical
  `nmos`/`pmos` symbols through import, Model-field switching, definition
  synchronization, and Insert, while preserving external X binding and ordered
  D/G/S/B export; incompatible external definitions keep the generic block.
- Validation: focused contracts (64), preflight, affected units (1171),
  hierarchy Playwright (12), manual-editor Playwright (93), branch verification,
  workspace build, production smoke, test-impact, and diff checks.
- Commit status: completed on `codex/sky130-canonical-mos-mapping`.

## 2026-08-22 - Local named VDD Port netlist export

- Target: `plan/2026-08-22-vdd-port-local-net-export/plan.md` (completed).
- Changed areas: net-marker extraction now applies the global-Net requirement
  only to Ground; a VDD Port accepts an explicitly named local or global
  `powerDomain: vdd` Net, emits no marker record, and rejects named non-VDD
  Nets. The deterministic export specification now records the same policy.
- Validation: focused netlist contract (17), preflight static/type/docs and
  test-impact checks, affected workspace units (1173), and diff checks.
- Commit status: completed on `codex/sky130-canonical-mos-mapping` as a stacked
  fix after the canonical SKY130 MOS commit.

## 2026-08-22 - Junction dots follow visible conductor directions

- Changed areas: contact evidence now classifies a visible Junction dot from
  distinct Route-arm and terminal-stem directions instead of adding terminal
  objects to Route direction counts; three-or-more coincident terminals remain
  an explicit dot rule. Removed the unused raw Route-arm count and aligned the
  connectivity specification and Junction-role comment.
- Protected cases: three collinear MOS Gates stay electrically connected but
  dotless at the middle Gate; true perpendicular taps, three-way and 45-degree
  branches remain dotted; right-angle terminal exits, rotation, and mirroring
  use the same direction protocol.
- Validation: focused derived tests (12), focused Playwright regression (1),
  preflight/static/typecheck, full affected unit suite (1177), hierarchy
  Playwright (12), project-file Playwright (8), and workspace build passed.
- Commit status: completed on `codex/junction-visible-directions`; mainline
  delivery remains gated on the canonical local and remote checks.

## 2026-08-22 - Stacked SKY130, VDD export, and Junction mainline delivery

- Target: `plan/2026-08-22-stack-sky130-vdd-junction-mainline/plan.md`
  (completed).
- Changed areas: rebased the canonical SKY130 MOS and local named VDD export
  commits onto `origin/main@dff17f82`, then stacked the Junction
  visible-direction commit. Only additive plan-log conflicts required manual
  resolution; no new model, binding, routing, or persistence protocol was
  introduced during integration.
- Validation: focused union units (78) and Junction browser case (1), preflight,
  affected units (1185), hierarchy (12), project-file (8), manual-editor (98),
  frozen dependency install, and canonical `ci:check` including build, release
  smoke, and all 205 browser tests.
- Commit status: stacked review branch prepared for required remote checks and
  one PR merge to `main`.

## 2026-08-22 — Hotfix: retire the stale gallery update offer

- Target: `plan/2026-08-22-update-mode-guard/plan.md` (completed).
- Change: the opened-entry context records its Project id and clears
  the moment any other Project becomes active, so publishing can no
  longer silently overwrite a stale entry (user-reported data loss);
  the update option now names exactly what it replaces.
- Validation: gallery Playwright 20/20, dialog units 26, typecheck,
  prettier, test-impact, diff checks.
- Commit status: completed on `claude/update-mode-guard`.

## 2026-08-22 — Gallery entry version history with restore

- Target: `plan/2026-08-22-gallery-version-history/plan.md` (completed).
- Change: every entry update (and restore) first snapshots the previous
  state (newest-20 cap); reviewer routes list/preview/restore versions;
  the publish dialog's update mode links a Version history dialog with
  per-version Restore that reloads the entry.
- Validation: worker gallery 17, units 78, gallery Playwright 21/21,
  typecheck, prettier, test-impact, diff checks.
- Commit status: completed on `claude/gallery-version-history`.

## 2026-08-22 — Exempt privileged submitters from the daily gallery quota

- Plan: `plan/2026-08-22-exempt-admin-quota/plan.md` (complete)
- The owner's session hit the 10-per-day hashed-IP submission quota.
  `GalleryDO.submit` now takes `enforceLimit`; `handleSubmission` sends
  `enforceLimit: !privileged`, so bearer/admin/moderator submissions and
  updates are never rate-limited while ordinary and anonymous paths keep
  the quota. Spec updated; rate-limit test reworked to cover both sides
  (`worker/gallery.test.ts`, 17 passed). Typecheck clean.

## 2026-08-22 - Double-click finishes a wire anywhere; Net Port defaults to Vin

- Reported: finishing a wire onto another wire kept drafting. Two causes:
  the canvas `onDoubleClick` only handled background targets, so a press
  landing on a Junction or Route never reached the finishing path; and landing
  on an endpoint or Route commits on the first press, after which the second
  press opened a fresh wire at that spot. Diagnosed by logging the handler's
  actual target and state rather than reasoning from the source.
- Fix: handle the wire tool before the background-only guard, and end the
  session when the wire source has no authored step — the discriminator
  between a stray re-start and a real wire being finished there.
- A new Net Port is now named `Vin` (then `Vin2`, ...), which the house text
  style renders as a capital V with a lowercase `in` subscript.
- One hierarchy case renamed a Port to `VIN`, a case variant of the new
  default; Net names fold case-insensitively, so it kept `Vin`. The case moved
  to `VBIAS` to test the same behavior without colliding with the default.
- Validation: full unit suite (1185), full Playwright suite (207 → 2 intended
  failures updated, then green), typecheck, prettier, diff checks.
- Commit status: completed on `claude/port-defaults`; mainline merge gated on
  the remote required checks.

## 2026-08-22 — Owner withdrawal and owner-visible version history

- Plan: `plan/2026-08-22-owner-withdraw-history/plan.md` (complete)
- The owning session can now withdraw its entry (`POST /:id/recycle`),
  bring it back through review (`/restore` → `pending` for ordinary
  owners, `public` for admins), and read/restore its version history
  (restore re-enters review via the new `pending` flag on the
  `restore-version` op). `/mine` gained two-step Withdraw, Restore, and
  a Version history dialog (moved to `components/` for reuse); the
  publish dialog's history link now shows for owners too. Spec updated.
  Worker vitest 19 passed; e2e mine/history specs 3 passed; typecheck
  clean.

## 2026-08-22 - A usable editor on a half-screen window

- Three defects, each reproduced at 760px before fixing: File/Edit would not
  open because `.app-command-surface` scrolls below 900px and clipped its own
  414px dropdown; the Library could not be opened because a compact-layout
  effect closed it whenever Properties was open; and it could not be widened
  because the compact grid pinned the column to `min(8rem, 34vw)`, overriding
  the dragged width.
- Fixes: stop clipping while a menu is open (the pattern a toolbar row already
  uses), let whichever panel the user just opened win, and keep
  `--icm-shapes-width` authoritative under a `60vw` ceiling. Drag verified
  248px → 328px with a real pointer.
- Structure: Examples and Library moved from the vertical rail into the head of
  the horizontal toolbar and the rail was deleted, returning its column to the
  canvas. About folded into Help as a section. The toolbar's "← Gallery" link
  removed, since the brand mark already goes there.
- Two manual-editor cases needed re-aiming, not relaxing: widening the canvas
  shifts pixel-to-logical mapping, and in one case the branch wire landed 10
  units off, leaving two arms pointing the same way so no Junction dot was
  drawn — the assertion was right and the geometry had moved.
- Validation: full unit suite (1187), full Playwright suite (208 passed),
  typecheck, prettier, diff checks.
- Commit status: completed on `claude/chrome-half-screen`; mainline merge gated
  on the remote required checks.

## 2026-08-22 - Document settings dock beside the canvas

- The style knobs rescale what the canvas draws but lived in a modal covering
  it, so a change could not be judged while it was made. They now dock as a
  "Document" section in the Properties sidebar, toggled by the Style button.
- The Default NMOS/PMOS bulk Net selects moved out of a transistor's own Bulk
  section into that same Document section: one Net answers for every NMOS or
  PMOS in the Document, so they were never per-instance settings.
- Removed the now unrendered modal, kept its pure knob helpers, and renamed the
  module to `style-knobs.ts`. Its four component tests were replaced rather
  than dropped — direct helper coverage, a rendering test for the new section,
  and a Playwright case that asserts the canvas stays visible while a knob moves.
- The background-dot toggle now reports in the status bar; it was the one
  canvas control that changed the view silently.
- Validation: full unit suite (1189), full Playwright suite (209 passed);
  verified live that Font size 1× → 2× moved the rendered label from 15.116 to
  30.232 with the canvas visible throughout.
- Commit status: completed on `claude/properties-cleanup`; mainline merge gated
  on the remote required checks.
