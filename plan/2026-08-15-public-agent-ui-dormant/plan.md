---
status: completed
experience: none
---

# Public Agent UI Dormant Mode

## Goal

Make the production editor publicly human-only while retaining the Agent API,
MCP package, and local/staging development path. Production must not render or
expose Agent controls, status, dialogs, or recovery/reconnect behavior.
Existing Agent sessions naturally become offline when an old page reloads; this
target does not introduce server-side global revocation or API blocking.

## State and Ownership

Start state from `git status --short --branch`:

```text
## main...origin/main
```

The worktree was clean. Work starts from current `origin/main` on
`agent/public-agent-ui-dormant`.

- `apps/editor/src/agent/` public UI mode and session lifecycle
- `apps/editor/src/app/App.tsx` and focused App tests
- `apps/editor/e2e/` only if a focused production-hidden browser assertion is
  required
- user-facing editor help/docs if Agent commands are surfaced there
- `plan/2026-08-15-public-agent-ui-dormant/plan.md` and `plan/log.md`

Read-only shared dependencies: Worker Agent endpoints, MCP package, Agent Kit,
Agent helper, and typed circuit/edit contracts. They remain operational and
must not change.

## Work

1. Add a build-time public Agent UI mode: production defaults disabled; local
   development defaults enabled; explicit environment values can enable staging
   or disable local testing.
2. Gate every editor Agent surface as one feature: menu, connect/manage dialog,
   file approval dialog, shelf indicator, and Properties section.
3. Make disabled mode inert in `useAgentSession`: no recovery read, socket,
   heartbeat, reconnect, revision event, timer, or cleanup request may begin.
4. Add focused tests proving a disabled public App contains no Agent controls
   or accessible labels and that the mode resolver has safe production/local
   defaults. Preserve existing enabled-mode Agent contracts.
5. Update user-visible product wording only where it advertises a now-hidden
   connection feature; retain internal/developer MCP documentation.

## Validation

- focused Agent/App unit tests
- focused production-hidden browser test or equivalent compiled-mode assertion
- `pnpm typecheck`
- `git diff --check`
- `git status --short --branch`
- `pnpm verify:branch` before delivery because the change crosses editor
  startup, session lifecycle, and browser behavior
- required remote checks before merging to `main`

## Commit Intent

Commit as:

```text
feat(editor): hide public Agent controls
```

## Outcome

Implemented production-dormant Agent UI mode. The production editor hides all
Agent controls, dialogs, status indicators, Properties affordances, and file
approval UI. `useAgentSession` becomes inert while disabled: it performs no
recovery read, browser transport, heartbeat/reconnect, revision notification,
expiry timer, or cleanup request. Local development remains enabled by default;
trusted staging can opt in with `VITE_ICM_AGENT_UI=enabled`.

The MCP/API/worker contracts and existing development Agent tests remain
unchanged. User-facing README and troubleshooting wording no longer advertises
the hidden production connection flow.

Validation: focused resolver/App tests (15/15), production smoke check,
`pnpm typecheck`, `pnpm docs:check`, `pnpm format:check`, `git diff --check`,
and `pnpm verify:branch` (123 files / 740 tests, workspace build, production
smoke) passed.
