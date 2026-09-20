# Project fixtures

Canonical `.icproj.json` Projects shared across packages, plus the manifest
that keeps the set closed.

## The corpus lock

`compatibility-corpus.json` lists every shipped Project exactly once, split
into `current` (canonical, already at the current schema version), `migrated`
(retained migration witnesses at an older version) and `rejected` (inputs that
must keep failing, with the expected error message).

`packages/project-protocol/src/compatibility-corpus.test.ts` asserts that this
list equals the set of tracked `.icproj.json` files under `fixtures/projects/`
and `netlists/`, that every `current` file round-trips byte-for-byte through
`parseProject` / `serializeProject`, that each `migrated` witness still loads
and upgrades, and that each `rejected` input still throws its recorded message.

**Adding, renaming or removing a Project fixture therefore requires editing the
manifest in the same change.** A file that is listed but untracked, or tracked
but unlisted, fails the lock. Author the JSON through
`serializeProject` rather than by hand: the round trip is byte-exact, so a
hand-edited file fails on key order or whitespace alone.

`fixtures/legacy-projects/` and `fixtures/gallery-redline/` hold Projects that
deliberately sit outside this corpus — the first at historical schema versions,
the second as snapshots of published Gallery documents.

## What each fixture is for

| Fixture | Protects |
| --- | --- |
| `minimal` | An empty Project: the floor case for parse, save and render. |
| `manual-basics` | Three devices drawn by hand through the editor. |
| `port-nets` | Five Ports across two Nets — the shared blank scratch input for connectivity and routing suites. It has **no Routes** on purpose: `direct-contact-lifecycle.test.ts` asserts route-free outcomes, and the routing suites read `routes[0]` as the Route they just authored. Do not add Routes here; use `crossing-routes`. |
| `crossing-routes` | Four Ports and two Routes on different Nets (`net-h` and `net-v`), crossing without a Junction. Rendered by `scripts/visual-golden.mjs`; the shared `port-nets` scratch input stays Route-free. |
| `differential-stage` | A small analog stage with Routes and annotations; also the source Project for `fixtures/exports/`. |
| `hierarchical-gain-stage` | The only Project here with **hierarchy**: a `GainStage` Cell placed twice in a `GainStagePair` top. It is what proves a Cell instance and a child Document render at all; the visual golden covers both halves. |
| `instance-value-display` | Device values and the annotation set that renders them. |
| `rejected-missing-top` | A Project whose `topDocumentId` names a missing Document — the refusal case. |

## Constructed fixtures

Most of these are hand-authored or saved from the editor. `crossing-routes`
and `hierarchical-gain-stage` were constructed through the model factories
(`createEmptyDocument`, `createEmptyProject`, `createRoutePath`) and written
with `serializeProject`, so their committed bytes are canonical by
construction. Their geometry is described where it matters: the crossing is
horizontal `A`–`B` against vertical `C`–`D`, intersecting at the centre.
