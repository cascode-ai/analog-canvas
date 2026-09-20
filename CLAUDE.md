# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Analog Canvas is a local-first, connectivity-aware schematic editor for the
web: hierarchical Cells, structural SPICE/Spectre interchange, private Cloud
Projects, a Community Gallery, formal SVG/PDF/PNG and netlist export, and
analog simulation orchestration. Supported native primitives and qualified
device models run through the selected executor Profile — ngspice, plus
VACASK as a second Production engine whose operator-host resources retain their
historical `preview` names; unsupported blocks are
diagnosed. Humans and authorized Agents share the typed Edit Engine.
[Product architecture](docs/overall-product-plan.md) owns the complete boundary;
[simulation](docs/specs/simulation.md) owns saved intent and execution contracts.

- pnpm workspace: `apps/*` and `packages/*` (21 projects, all scoped `@icm/*`). The private root package `interactive-circuit-maker` carries the product version; [CHANGELOG.md](CHANGELOG.md) records user-facing changes per release.
- Node >= 24, pnpm >= 11.16 (`packageManager: pnpm@11.16.0`), ESM only. Pinned toolchain: TypeScript 7, Vite 8, Vitest 4, Playwright 1.62, Prettier 3.
- License: AGPL-3.0-only ([LICENSE.md](LICENSE.md)).

## Commands

```bash
pnpm install --frozen-lockfile    # setup
pnpm dev                          # editor dev server (Vite, http://localhost:5173) + local Agent relay, netlist conversion, simulation proxy (ICM_SIMULATION_URL)
pnpm build                        # build everything (pnpm -r, topological order); needed once after install
pnpm typecheck                    # single root tsc pass (also the only typecheck of test files)
pnpm format:check                 # Prettier for code/JSON/YAML (pnpm format to write); Markdown is not covered
pnpm docs:check                   # Markdown links + ADR/spec index contracts

# Focused loops — preferred during development
pnpm test:local <test-paths>                        # Vitest, 2 workers
pnpm test:local <test-path> -t "<name>"             # single test by name
pnpm test:e2e:local <spec-paths> --grep <pattern>   # Playwright, 2 workers
pnpm setup:e2e                                      # once per machine: install Playwright Chromium

# Full suites
pnpm test                         # all unit/module tests
pnpm test:e2e                     # all Playwright specs

pnpm test:impact -- --base <base-ref>   # validates the commits' Test-Impact trailer

# Gates
pnpm ci:static       # format, docs, references, component/Razavi/Agent catalog drift, MCP distribution, typecheck
pnpm verify:branch   # branch integration: static + all unit + build + production smoke
pnpm release:verify  # build + performance, visual/export goldens, PWA icons, production smoke, release/MCP packaging smoke
pnpm gate:plan -- --base <base-ref>      # select validation by changed paths (--path <p> before editing)
pnpm gate:preflight -- --base <base-ref> # preflight before selected gates
pnpm gate:affected -- --base <base-ref>  # focused path, unless full-delivery selected
pnpm gate:full                          # conservative full-delivery path (ci:check)
```

Unit tests sit beside their implementation under one root `vitest.config.ts`: `*.test.ts(x)` in `apps/`, `packages/`, and `worker/`, and `*.test.mjs` in `scripts/` and `containers/` (exception: `packages/agent-routing/test/`). Workspace packages have no test scripts of their own. Playwright specs live in `apps/editor/e2e/`; the config auto-starts a Vite server on `127.0.0.1:4173` (`ICM_E2E_PORT`), reuses a running one unless `CI` or `ICM_E2E_ISOLATED=1` is set, and drives system Chrome locally (`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` overrides).

CI (`.github/workflows/ci.yml`) plans validation from the changed paths (`scripts/ci-plan.mjs`, `config/validation-gates.json`). The two required PR checks are `Core contracts` (`ci:static`, `ci:unit`, `release:verify`) and `Browser tests` (only the specs mapped to the PR's paths, or a small fallback); nightly and manual runs perform a four-shard full browser audit.

### Generated artifacts

Component data flows one way. `packages/components/definitions/<symbol-id>.json` (symbol + electrical + catalog, indexed by `packages/components/catalog.json`) is the authoring source; see [packages/components/README.md](packages/components/README.md). Reference-derived geometry inside those files is written by family generators from `fixtures/visual-reference/razavi-reference-v1/` — change the generator or its evidence, not the JSON.

Never hand-edit these; each generator has a paired `:check` drift gate:

- `packages/devices/src/components.generated.ts` and `packages/symbols/src/{expanded-components,razavi-catalog}.generated.ts` (`components:generate`, also part of `symbols:razavi`), `packages/derived/src/razavi-peripheral-geometry.generated.ts` (`symbols:razavi-peripherals`), `packages/agent-adapter/src/agent-authoring-catalog.generated.ts` (`agent-kit:catalog`), `apps/mcp-server/src/resources.generated.ts` (`agent-docs:generate`).
- `fixtures/agent-api/*` (`agent-api:artifacts`), `fixtures/visual-golden/*` (`visual:golden`), `fixtures/exports/*` (`export:golden`), `fixtures/editor-production-smoke/report.json` (`test:production-smoke`), and the PWA icons in `apps/editor/public/` (`pwa:icons`).

Regeneration order when symbol data changes:

1. Base family generators: `symbols:razavi-{mos,peripherals,inductor,opamp,common,logic,buffer-dff,delay-cell,zener}`, `symbols:converters`.
2. Derived siblings: `symbols:lettered-amps`, then `symbols:swap-inputs`.
3. `pnpm symbols:razavi` — the signal-flow and magnetic families, then the component-library projections, Razavi catalog, Agent catalog, and MCP resources. After editing definitions by hand, `pnpm components:generate` is enough.
4. `pnpm build`, then as affected: `agent-api:artifacts`, `pwa:icons`, `visual:golden`, `export:golden`.

`ci:static` enforces `components:check` and `agent-kit:catalog:check`; `symbols:razavi:check` covers the Razavi chain including MCP resources; `apps/mcp-server/src/resources.test.ts` fails when MCP resources are stale; release verification runs the golden, icon, and smoke checks.

## Required workflow (AGENTS.md)

[AGENTS.md](AGENTS.md) defines the mandatory working discipline; read it before working. Summary:

- **Two stages**: (1) local iteration — continue the current local batch branch (a new batch starts as `codex/local-batch` from `main`); each bounded target ends with its own local commit and validation; (2) Production delivery — one PR, the mainline delivery gate, merge, deploy, and verify Production. The hosted Preview channel is retired; its isolated data is dormant and retained. Track an in-progress batch in the untracked `plan/local-batch.md`.
- **Before editing tracked files**: run `git status --short --branch` and audit dirty paths by ownership (unrelated dirty files don't block; overlapping or unclear ones do). Know the target's goal, owned paths, and shared contracts; `plan/` is the untracked scratch area.
- **Test impact**: a commit that changes implementation code — `.ts/.tsx/.js/.mjs` under `apps/*/src/`, `packages/*/src/`, `worker/`, or `scripts/` — carries a `Test-Impact:` trailer: `tests-updated`, or `no-test-change — <evidence>`. `pnpm test:impact -- --base <ref>` cross-checks the claim against the diff and CI runs the same check.
- **Validation is risk-proportional**: run the smallest deterministic checks that cover the change (documentation-only → `pnpm docs:check`); full suites only when breadth, risk, or policy justifies them. Every target closes with `git diff --check`, `git status --short --branch`, and a commit message that stands alone: what changed, why, the validation and chosen gates, and the trailer.
- **Mainline delivery gate**: follow the selected gates and the required `Core contracts` and `Browser tests` checks in [AGENTS.md](AGENTS.md); [deployment](docs/deployment.md) owns Production release and recovery.
- **Circuit assets**: one circuit per `netlists/<name>/` directory; `.subckt` interfaces and instance pin order are shared contracts (check every caller before changing); never claim electrical correctness from syntax inspection alone; never silently replace vendor/foundry model data with illustrative values.
- Commit subjects use conventional scopes: `feat(editor):`, `fix(netlist):`, `docs(specs):`, `test(editor):`.

## Architecture

### Repository layout

- `apps/` — `editor`, `local-host`, `mcp-server` (below).
- `packages/` — the `@icm/*` libraries below, plus the `components/` data directory.
- `worker/` — the Cloudflare Worker (not a workspace package; its tests run in the root Vitest).
- `containers/` — simulator images and host tooling: `ngspice/` (gateway, run supervisor, rawfile collector, hosted SKY130 profile), `vacask/` (HTTP executor, job runner, model symbols), and `simulation/run-local-files.mjs`.
- `netlists/<circuit>/` — one simulation example or acceptance circuit per directory (native ngspice, SKY130, VACASK, held-out Phase 9 cases).
- `fixtures/` — cross-package test data: Agent API artifacts, the Razavi visual reference, visual and export goldens, ngspice rawfiles, legacy and Gallery-redline Projects, SPICE baselines and vendor decks, simulation acceptance.
- `scripts/` — generators, gate planning (`gate-plan.mjs`, `gate-run.mjs`, `ci-plan.mjs`, `lib/`), packaging, release smoke, and simulation acceptance, with `*.test.mjs` beside them.
- `tools/` — Python PDF-vector extraction and Razavi calibration tooling.
- `config/` — the validation-gate catalog, the MCP distribution declaration (`agent-mcp-distribution.json` holds the published MCP version), and the historically named VACASK candidate environment.
- `skills/circuit-layout/` — the repo-local Agent layout skill. `references/` — pinned research-only reference repositories (fetched into the ignored `.reference-src/`, never imported or bundled).
- `docs/` — product plan, ADRs, specs, user and Agent guides, roadmap, testing, deployment. `.github/workflows/` — `ci`, `cloudflare` (production), `retire-preview` (manual dormant-data shutdown), `container`, `simulator-host`, `mcp-release`.

### Package layering

Dependencies flow strictly downward and pnpm's topological order is the only build order. `@icm/math-typesetting` and `@icm/spice-run` are leaves; `@icm/model` (which depends only on math-typesetting) is the root every domain package shares. Roughly bottom-up:

- `@icm/math-typesetting` — MathJax TeX → SVG formula typesetting with a fixed profile and bounded cache; used by model, derived, render-svg, and the editor.
- `@icm/model` — Zod schemas and branded IDs for the persisted Project (documents, instances, nets, routes, annotations, rich text, geometry, simulation source folders). The single source of type truth.
- `@icm/devices` — built-in device descriptor registry (projected from component definitions): device facts, reference-designator rules, parameter validation.
- `@icm/symbols` — symbol semantics and artwork (projected from component definitions): built-in symbols, generated Razavi catalog, pin anchors.
- `packages/components/` — not a workspace package: the canonical component definitions and catalog behind `devices` and `symbols`.
- `@icm/derived` — pure read-only projections over the model: connectivity index, Base/Logical Nets, ERC/diagnostics, anchors, label placement, resolved route geometry, search.
- `@icm/spice` — structural SPICE import (lexer, dialects, expression eval → transient Circuit IR) and the pure SPICE → Spectre converter behind `POST /api/netlist/convert`; Node-only `./node` entry.
- `@icm/spice-run` — deck and environment-Profile contracts; ngspice and VACASK rawfile/result interpretation.
- `@icm/netlist` — deterministic design-netlist extraction and printing (transient DesignNetlistIR), formal cell-interface derivation, and simulation source compilation.
- `@icm/project-protocol` — bounded `.icproj.json` parse/migrate/serialize compatibility boundary with load diagnostics.
- `@icm/edit-engine` — **the sole mutation boundary**: typed schematic edits, dry-run/commit transactions, revision checks, undo history, and planners (routing, power/named nets, references, hierarchy). Both the GUI and the Agent go through it.
- `@icm/render-svg` — persisted document → formal SVG scene, including rich-text and formula layout.
- `@icm/exporters` — SVG/PNG/PDF artifacts; browser entries (`./browser`, `./browser-raster`, `./browser-pdf`) plus Node-only `./node` (resvg, pdf-lib).
- `@icm/timing-simulation` — deterministic digital event simulation (clock, gates, flip-flops; four-state values; integer picoseconds). Its editor UI is experimental and hidden in Cloudflare production builds.
- `@icm/simulation-service` — shared preparation, managed run lifecycle, measurements and Spec results, outputs, and File artifacts (`./contract`, `./files`).
- `@icm/agent-adapter` — Agent API 3.0 surface: the Circuit endpoint's four operations (capabilities/snapshot/transact/render) plus the File, Simulation, and Project resources; envelopes, zod+OpenAPI schemas, session state, browser-safe host; `./loopback` and the HTTP Agent Kit payload `./kit`.
- `@icm/agent-client` — Node-only Agent-side client: HTTP/session clients, credential store, snapshot cache.
- `@icm/agent-routing` — Agent-local transient RouteGraph → typed-edit expander. Agent rationale: these types never enter the API schema or persisted model; Agent-side scaffolding with no in-repo importers.
- `@icm/platform-node` — Node filesystem storage/recovery adapters; no in-repo importers.
- `apps/editor` — the React/SVG editor and installable PWA, plus the Gallery, account, and moderation surfaces. `analytics/` is the self-contained first-party analytics module; `dev/` holds the Vite dev-server plugins (local Agent relay, netlist conversion, local simulation).
- `apps/local-host` — loopback-only static host for `apps/editor/dist` with a local simulation transport seam (`bin: interactive-circuit-maker`; its only dependency is `@icm/spice-run`).
- `apps/mcp-server` — stdio MCP server (`bin: analog-canvas-mcp`) over `agent-client`, with generated doc resources. Release packaging (`scripts/package-mcp.mjs`) bundles it with Vite and takes the version from `config/agent-mcp-distribution.json`, not from its `package.json`.
- `worker/` — Cloudflare Worker (`worker/index.ts`) serving `apps/editor/dist` and `/api/*`: Durable Objects `AnalyticsDO` (from `apps/editor/analytics`), `AgentSessionDO`, `GalleryDO`, `AuthDO`, and `SimulationControlDO`, plus the `SIMULATION_JOBS` queue and `SIMULATION_ARTIFACTS` R2 bucket behind hosted simulation (`simulation-ngspice.ts`, `simulation-vacask.ts`). `.github/workflows/cloudflare.yml` builds and deploys every non-documentation merge directly to Production (`wrangler.jsonc`); tags and manual dispatches may release only commits already on `main`. The retired Preview Worker remains route-free through `wrangler.preview.jsonc` solely to preserve its isolated data. Markdown/`docs/`-only merges deploy nothing.

### Build mechanics

- Packages and `apps/{local-host,mcp-server}` build with plain `tsc`; only `apps/editor` uses Vite (MCP release packaging also bundles with Vite). Build order comes solely from pnpm topological ordering (no `tsc -b` project references).
- The `development` package-export condition maps `@icm/*` to `src/*.ts` (every package except `platform-node`), so the browser code served by Vite dev and Vitest run from source with no build. Node consumers (`scripts/*.mjs`, mcp-server, packaged release) resolve `dist/` — that is why those npm scripts are prefixed with a build. The Vite config loader and the Node-side Playwright specs also resolve `dist/`, so a fresh checkout needs `pnpm build` before `pnpm dev` or browser tests; `ci:e2e` compiles every non-editor workspace project first.
- `pnpm typecheck` (`tsconfig.check.json`) maps `@icm/*` straight to source and covers `apps/`, `packages/`, and `worker/`, including the `*.test.ts` files that package builds exclude.

### Editor internals

[apps/editor/src/README.md](apps/editor/src/README.md) is the normative layering doc. Dependency direction: `main → app → features/components/document/interaction/canvas → packages/*`. Each directory under `features/` (clipboard, component-insert, drafting, editor-shell, hierarchy, instance-display, netlist-export, project-code, properties, search, selection, simulation, text-editing, wiring) owns its pure proposals, view adapters, and tests; other source roots include `agent/`, `commands/`, `demos/` (test fixtures), `deployment/` (public UI flags), `examples/` (bundled starter Projects), `presentation/`, `snap/`, and `styles/`. Rules: feature and infrastructure modules never import `app/App.tsx`; pure proposal/reducer/geometry modules never import React components; avoid cross-feature imports — the tree already contains many, so do not treat them as precedent; promote a genuinely shared primitive to `canvas/`, `document/`, `interaction/`, `snap/`, or a workspace package instead; no barrel files added just to shorten imports; stylesheets load from the route-level entries in `styles/`, never from a lazy component.

### Core invariants

- Connectivity is explicit: net membership, Junctions, formal cell terminals, and typed Instance terminals are electrical facts. Drawing geometry never silently creates a connection; a Crossing is not a Junction — ambiguous intersections are rejected, not guessed.
- Routes are visible geometry only; they may stretch during movement without changing logical connectivity.
- An Agent reads a complete Snapshot and submits typed edits with an expected revision. There is no second command language and no DOM-automation mutation path.
- Canonical Project content follows the file-format spec; Cloud Save, portable export, browser recovery, and execution retention have distinct ownership.
- The Razavi reference manifest (`fixtures/visual-reference/razavi-reference-v1/`) is the sole visual authority.

## Documentation authority

Specifications own accepted contracts; topic ADRs explain reasons and link to specs. When code and a spec disagree, inspect behavior and tests, preserve deliberate coherent behavior, and surface unresolved choices. Follow `docs/README.md`; do not treat an old ADR as a competing rule or silently endorse an implementation accident.

- Default reading set for product work: [docs/README.md](docs/README.md#contributor-reading-order).
- Test layers and contract ownership: [docs/testing/README.md](docs/testing/README.md) and its contract matrix.
- Agent schematic-layout workflow: [docs/agent/workflow.md](docs/agent/workflow.md) and the repo-local [skills/circuit-layout/SKILL.md](skills/circuit-layout/SKILL.md).
- `pnpm docs:check` validates links in `README.md` and `docs/`, and requires every ADR and spec to be indexed with a `Status:` line (specs also need an owner line). `format:check` skips Markdown, though most docs are Prettier-formatted.
- Some docs are test-pinned: `packages/{model,edit-engine,agent-adapter}/src/protocol-documentation.test.ts` read spec and plan text (for example the current Project schema version), and `apps/mcp-server/src/resources.test.ts` requires `resources.generated.ts` to match the docs listed in `docs/agent/distribution.json` — after editing one of those docs, run `pnpm agent-docs:generate`.
