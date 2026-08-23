# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Analog Canvas (repo `interactive-circuit-maker`) is a local-first, connectivity-aware schematic editor: structural SPICE is imported into a typed circuit model, edited in the browser (React + SVG), persisted as one canonical `.icproj.json` Project file, and exported as formal SVG/PNG/PDF and deterministic SPICE/Spectre design netlists. It is an editor and structural circuit tool — not a simulator. A human UI and an authorized Agent API edit the same live Project through the same edit engine; neither may bypass electrical, revision, lock, or transaction invariants.

pnpm workspace (`apps/*`, `packages/*`, all scoped `@icm/*`), Node >= 24, pnpm >= 11.16, TypeScript, ESM only.

## Commands

```bash
pnpm install --frozen-lockfile    # setup
pnpm dev                          # editor dev server (Vite, http://localhost:5173)
pnpm build                        # build everything (pnpm -r, topological order)
pnpm typecheck                    # single root tsc pass (also the only typecheck of test files)
pnpm format:check                 # Prettier (pnpm format to write)

# Focused loops — preferred during development
pnpm test:local <test-paths>                        # unit tests (Vitest), capped workers
pnpm test:local <test-path> -t "<name>"             # single test by name
pnpm test:e2e:local <spec-paths> --grep <pattern>   # Playwright, 1 worker

# Full suites
pnpm test                         # all unit tests
pnpm test:e2e                     # all Playwright specs

pnpm test:impact -- --base <base-ref>   # validates the commits' Test-Impact trailer

# Gates
pnpm ci:static      # format, markdown links, references, generated-catalog drift, typecheck
pnpm verify:branch  # branch integration: static + all unit + build + production smoke
pnpm ci:check       # full local mainline gate (required before non-doc changes reach main)
```

Unit tests are co-located `*.test.ts(x)` beside implementations under one root `vitest.config.ts` (exception: `packages/agent-routing/test/`). Playwright specs live in `apps/editor/e2e/`; the config auto-starts a Vite server on `127.0.0.1:4173` (reuses a running one) and drives system Chrome locally; CI installs Chromium via `pnpm exec playwright install --with-deps chromium`.

### Generated artifacts

Never hand-edit `*.generated.ts` files, `packages/symbols/assets/razavi-v1/*`, `fixtures/agent-api/*`, golden fixtures, or PWA icons — each generator has a paired `:check` drift gate enforced in `ci:static` / release verification. Regeneration order when symbol data changes: `symbols:razavi-{mos,peripherals,inductor,opamp,common}` (assets) → `symbols:swap-inputs` (siblings derived from those assets) → `symbols:razavi` (TS catalog) → `agent-kit:catalog` → `pnpm build` → `mcp:resources` / `agent-api:artifacts` / `pwa:icons`. Golden outputs: `visual:golden`, `export:golden`.

## Required workflow (AGENTS.md)

[AGENTS.md](AGENTS.md) defines the mandatory working discipline; read it before working. Summary:

- **Before editing tracked files**: run `git status --short --branch` and audit dirty paths by ownership (unrelated dirty files don't block, overlapping ones do). Know the target's goal, owned paths, and shared contracts; `plan/` is an untracked scratch area if you want notes.
- **Test impact**: every commit that changes implementation code carries a `Test-Impact:` trailer — `tests-updated`, or `no-test-change — <evidence>`. `pnpm test:impact -- --base <ref>` cross-checks the claim against the diff and CI runs the same check.
- **Validation is risk-proportional**: run the smallest deterministic checks that cover changed behavior; full suites only when breadth or policy justifies them. Every target closes with `git diff --check` and `git status --short --branch`, and a commit message that stands alone.
- **Mainline delivery gate**: non-document changes reach `main` only after a clean `pnpm install --frozen-lockfile && pnpm ci:check` and green remote GitHub Actions checks. Never weaken, skip, or delete a failing check to pass the gate.
- **Circuit assets**: one circuit per `netlists/<name>/` directory; `.subckt` interfaces and instance pin order are shared contracts (check every caller before changing); never claim electrical correctness from syntax inspection alone; never silently replace vendor/foundry model data with illustrative values.
- Commits are conventional with scope: `feat(editor):`, `fix(connectivity):`, `docs(specs):`, `test(editor):`.

## Architecture

### Package layering

Dependencies flow strictly downward; `@icm/model` is the root everything shares.

- `@icm/model` — Zod schemas and branded IDs for the persisted Project (documents, instances, nets, routes, annotations, rich text, geometry). The single source of type truth.
- `@icm/devices` — built-in device descriptor registry: device facts, reference-designator rules, parameter validation.
- `@icm/project-protocol` — bounded `.icproj.json` parse/migrate/serialize compatibility boundary with load diagnostics.
- `@icm/symbols` — symbol semantics and artwork: built-in symbols, generated Razavi catalog, pin anchors.
- `@icm/derived` — pure read-only projections over the model: connectivity index, ERC/diagnostics, anchors, label placement, resolved route geometry.
- `@icm/spice` — structural SPICE import (lexer, dialects, expression eval → transient Circuit IR).
- `@icm/edit-engine` — **the sole mutation boundary**: typed schematic edits, dry-run/commit transactions, revision checks, undo history, and planners (routing, power/named nets, references, hierarchy). Both the GUI and the Agent go through it.
- `@icm/render-svg` — persisted document → formal SVG scene, including rich-text layout.
- `@icm/netlist` — deterministic design-netlist extraction and printing (transient DesignNetlistIR), formal cell-interface derivation.
- `@icm/exporters` — SVG/PNG/PDF artifacts; browser entry plus Node-only `./node` (resvg, pdf-lib).
- `@icm/agent-adapter` — Agent API 2.0 surface (capabilities/snapshot/transact/render): envelopes, zod+OpenAPI schemas, session state, browser-safe host.
- `@icm/agent-client` — Node-only Agent-side client: HTTP/session clients, credential store, snapshot cache.
- `@icm/agent-routing` — Agent-local transient RouteGraph → typed-edit expander. ADR 0008: these types never enter the API schema or persisted model; shipped as Agent-side scaffolding via the MCP kit, no in-repo importers.
- `@icm/platform-node` — Node filesystem storage/recovery adapters (currently unused).
- `apps/editor` — the React/SVG editor and installable PWA.
- `apps/local-host` — dependency-free loopback-only static host for `apps/editor/dist` (`bin: interactive-circuit-maker`).
- `apps/mcp-server` — stdio MCP server (`bin: analog-canvas-mcp`) over `agent-client`, with generated doc resources.
- `worker/` (not a workspace package) — Cloudflare Worker serving `apps/editor/dist` with Analytics and AgentSession Durable Objects (`wrangler.jsonc`; deployed by `.github/workflows/cloudflare.yml`).

### Build mechanics

- Packages and `apps/{local-host,mcp-server}` build with plain `tsc`; only `apps/editor` uses Vite. Build order comes solely from pnpm topological ordering (no `tsc -b` project references).
- The `development` package-export condition maps `@icm/*` to `src/*.ts`, so Vite dev and Vitest run from source with no build. Node consumers (`scripts/*.mjs`, mcp-server, packaged release) resolve `dist/` — that is why those npm scripts are prefixed with `pnpm build`.
- `pnpm typecheck` (`tsconfig.check.json`) maps `@icm/*` straight to source and includes the `*.test.ts` files that package builds exclude.

### Editor internals

`apps/editor/src/README.md` is the normative layering doc. Dependency direction: `main → app → features/components/document/interaction/canvas → packages/*`. Each directory under `features/` (clipboard, component-insert, drafting, editor-shell, hierarchy, instance-display, netlist-export, properties, search, selection, text-editing, wiring) owns its pure proposals, view adapters, and tests. Rules: feature and infrastructure modules never import `app/App.tsx`; pure proposal/reducer/geometry modules never import React components; no cross-feature imports (promote shared primitives to `canvas/`, `document/`, `interaction/`, `snap/`, or a workspace package); no barrel files added just to shorten imports.

### Core invariants

- Connectivity is explicit: net membership, Junctions, formal cell terminals, and typed Instance terminals are electrical facts. Drawing geometry never silently creates a connection; a Crossing is not a Junction — ambiguous intersections are rejected, not guessed.
- Routes are visible geometry only; they may stretch during movement without changing logical connectivity.
- An Agent reads a complete Snapshot and submits typed edits with an expected revision. There is no second command language and no DOM-automation mutation path.
- The `.icproj.json` Project file is canonical; browser recovery copies are non-authoritative.
- The Razavi reference manifest (`fixtures/visual-reference/razavi-reference-v1/`) is the sole visual authority (ADR 0011); retired Visio/VSS assets are historical evidence only.

## Documentation authority

When documents disagree: accepted ADR / normative spec (`docs/adr/`, `docs/specs/`) → `docs/overall-product-plan.md` → `docs/roadmap/` → implementation and tests. Implementation never silently redefines an approved contract — update the spec or ADR when behavior intentionally changes.

- Default reading set for product work: `docs/current/README.md` (ordered list of the ADRs and specs defining the current Project shape).
- Test layers and contract ownership: `docs/testing/README.md` and its contract matrix.
- Agent schematic-layout workflow: `docs/agent/workflow.md` and the repo-local `skills/circuit-layout/SKILL.md`.
- `docs/archive/` is historical, non-authoritative, and excluded from default task context.
