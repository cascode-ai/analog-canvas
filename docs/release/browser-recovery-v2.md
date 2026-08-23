# Browser Recovery v2 Delivery

Status: `delivered-on-branch`

This note records the robust page persistence and recovery delivery for the
browser editor. The coordination plan lives in
an August 2026 recovery-hardening target; the normative contract
lives in [`docs/specs/persistence-and-recovery.md`](../specs/persistence-and-recovery.md).

## What changed for users

- After each accepted edit, the editor keeps a safety copy of the complete
  Project in this browser's IndexedDB — at most two recent working copies,
  each with a current and a previous generation, at most 4 MB per copy and
  12 MB in total.
- **File / Recover recent work…** opens a dialog listing those copies with
  name, time, source, and per-generation status; Restore installs the newest
  valid generation (a damaged latest falls back to the previous copy),
  Download backup exports the exact stored bytes, and Delete removes exactly
  one working copy.
- **File / Save Project** prefers the File System Access picker where the
  browser supports it; only a confirmed write/close reports a confirmed
  save. Everywhere else the editor downloads the canonical `.icproj.json`
  and reports `Download requested`, because browsers do not confirm durable
  download completion. Saving or downloading never deletes safety copies.
- Opening, importing, or accepting an Agent replacement of a Project with
  unsaved changes first confirms a recovery write; if storage fails, the
  editor offers Download current Project / Replace anyway / Cancel, defaulting
  to Cancel. A rejected file keeps its diagnostic code and path.
- Storage failures (quota, unavailable) show a persistent warning with a
  direct download action; they never change or crash the live Project.
- The legacy `icm.recovery.v1` localStorage slot migrates into IndexedDB on
  first upgraded launch; the old key is removed only after the IndexedDB
  commit. Unmigratable legacy data stays in place for raw download or
  discard.

## Known limitations

- Clearing site data removes safety copies; the formal Project file remains
  the only authoritative artifact.
- A reload or crash within the short debounce window after an edit may lose
  that very last edit (Chromium aborts uncommitted IndexedDB transactions
  during unload even for synchronously dispatched writes); the committed
  session before it stays recoverable.

## Validation summary

Unit contracts: envelope decode/byte accounting, rotation and deduplication,
two-session and 12 MB retention, oversized/quota/abort/unavailable typed
failures, corrupt versus unsupported-schema classification, migration
outcomes, coordinator coalescing and forking, and every File System Access
save outcome. Browser behavior: durable restore after abrupt tab death and
reload, damaged-latest fallback, two tabs with separate working copies,
quota-exceeded survival, Cache Storage isolation, download fallback and
confirmed-save paths, staged rejection of invalid opens, and the replacement
guard matrix.
