# User Component publication

Status: `accepted`

Primary owner: User Components publication modules and the Worker component
library; Project model/transactions own captured provenance; Agent and GUI
consume.

## Identity and provenance

- Public `componentId` is stable across updates; names are display content,
  not unique.
- A Project captures a local class with optional
  `ComponentDefinition.libraryOrigin`: public ID, captured revision, author
  ID, content algorithm version, digest. Copies and portable saves keep it;
  local edits keep the original baseline. It never grants permission; the
  server authenticates every write. Published packages omit it.
- Automatic native artwork stores origin on the native owner; Custom ⇄
  Automatic keeps the baseline on the active representation. Copying
  automatic artwork into an equivalent owner with a different baseline
  captures the artwork and its provenance as a local class; the destination
  baseline is unchanged.
- Legacy Agent snapshots omit it; `inspect` exposes the association.

## Catalog reads

- `GET /api/components?view=summary&catalog=1` keeps the same filter, order,
  revision and opaque cursor contract for all page sizes. The default remains
  20; explicit limits are capped at 128. Legacy reads without `catalog=1`
  keep their existing limits.
- Summary entries stop at 256 KiB of UTF-8 JSON per page; one oversized
  historical entry travels alone, unchanged, so the cursor can advance.
  Author aggregates are separate from this entry budget. Clients follow the
  returned cursor, not the requested page size, until complete; catalog
  changes still reject mixed-revision pages.

## Destination

- New and Create from stay new through sign-in and draft recovery, even for
  one's own work. Editing a verified own capture targets its ID and captured
  revision; others' captures publish as new work.
- Stale, deleted or unauthorized updates never silently become new
  publications. Legacy captures without provenance need explicit association,
  checked against the current public record and matching normalized package.

## Exact content (version 1)

- Compare canonical JSON of the complete validated package: sorted keys,
  array order and source bytes kept. Only owned Symbol/electrical/subcircuit
  IDs, native owner/source/terminal identities and their references are
  replaced, and the local source revision normalized; everything authored
  stays. No string search/replace or circuit equivalence. Provenance omitted.
- Worker: SHA-256 lookup, then canonical-byte comparison before rejecting a
  new ID with the same author's exact content. Same name with different
  content, or same content by different authors, is allowed. Updating a
  historical ID to match another merges nothing. Deleted records are not
  candidates. Matches order by creation time, then ID.
- The derived SQLite index allows multiple historical matches; missing rows
  are backfilled in resumable batches of 50 before writes use it; invalid
  history gets an index diagnostic. Concurrent creates check and write in one
  Durable Object transaction. The index never changes public records or
  collapses library cards.

## Writes and recovery

- An identical update returns `unchanged` (no revision or time change).
  Duplicate new publications: HTTP 409 `COMPONENT_ALREADY_PUBLISHED` with
  `existing:{id,revision}`; GUI offers Use existing or Continue editing.
- Success and duplicate outcomes keep account-scoped receipts for 7 days; a
  fixed key identifies fixed request bytes. A private browser journal (account,
  destination, package) shared by GUI and Agent survives Project undo; retry
  sends the original snapshot. After receipt expiry, recovery may use the fixed
  target only when permissions, bytes and expected revision agree. Conflicts
  never generate a new ID. The journal stays in the browser that began it.
- Cloud write and Project association are separate transactions; association
  changes metadata only, needs matching applied content and uses Project
  history. Undo cannot undo publication or its receipt.
- Agent: `publicationVersion:1` opts into outcome/recovery/association
  metadata and structured duplicate references; without it, legacy shapes are
  unchanged (duplicate refusal still has a code and message). New MCP schemas
  ship as a smoke-tested package; a website merge does not release it.
- Portable schema 69 / runtime model 58 carry provenance; schemas 24–68 read
  without invented origins. Rollback must keep a schema-69 reader and the
  journal, never drop origins or turn pending writes into new publications.
