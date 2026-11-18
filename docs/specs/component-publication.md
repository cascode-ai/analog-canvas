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

## Visibility

- Statuses: `shared` (public), `official`, `private` (the author's library),
  `superseded` (folded into `supersededBy`), `deleted`. Private, superseded and
  deleted records are readable only by their author and administrators;
  public discovery, previews for others and the legacy list show only `shared`
  and `official`.
- PUT `visibility: "private" | "public"`: a new record without it is public
  (older writers keep their behaviour); an existing record without it keeps
  its status; `official` stays official. The visibility is part of the fixed
  request bytes (idempotency digest and browser journal).
- PATCH `{revision, action: "make-public" | "make-private"}` moves an author's
  own `private` ⇄ `shared` record under the lifecycle rules below; official,
  deleted and superseded records refuse it.
- Insertion and captures do not depend on visibility: a private record is
  placed from any of its author's Projects exactly like a public one.

## Versions

- Each content change keeps the replaced definition in the append-only
  `component_versions` table (component ID, source ID, revision, name, saved
  time); the `components` row stays the authority and insertion always takes
  it. Visibility-only changes add no version. A component's retained history
  is capped at 16 MiB (`COMPONENT_HISTORY_FULL`; save as a new component).
- `GET /api/components/<id>?view=versions` lists version metadata, newest
  first, with the record's visibility rule; definitions are not served.
- New saves resolve their destination by name: `GET
  /api/components?view=same-name&name=<name>` (signed in) returns the
  author's own `shared`/`private` records whose trimmed, case-insensitive name
  matches, most recently changed first. By default a GUI or Agent save of such
  a name updates that record (same ID, next revision) unless the author asks
  for a separate one. Exact content is left to the duplicate refusal below.
  The server never redirects a write to another ID.

## Catalog reads

- `GET /api/components?view=summary&catalog=1` keeps the same filter, order,
  revision and opaque cursor contract for all page sizes. `private=1` adds the
  signed-in reader's own private records. The default remains
  20; explicit limits are capped at 128. Legacy reads without `catalog=1`
  keep their existing limits.
- Summary entries stop at 256 KiB of UTF-8 JSON per page; one oversized
  historical entry travels alone, unchanged, so the cursor can advance.
  Author aggregates are separate from this entry budget. Clients follow the
  returned cursor, not the requested page size, until complete; catalog
  changes still reject mixed-revision pages.
- `GET /api/components?view=previews&ids=<id>:<revision>,…` returns up to 48
  revision-bound preview symbols in request order. Each item applies its
  record's visibility and carries its own changed, missing or repair error; a
  longer or malformed list is refused. Clients read one batch per screenful
  and fall back to `/<id>?view=preview` where a service predates it.

## Destination

- New and Create from stay new through sign-in and draft recovery, even for
  one's own work, except that a name the author already uses becomes a
  [version](#versions) of that record unless they choose a separate one.
  Editing a verified own capture targets its ID and captured revision, or the
  record it was folded into; others' captures publish as new work.
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

- Library deletion is reversible withdrawal, independent of Project captures.
  Authors may delete their own records; administrators may delete all. Definition
  parsing is not a prerequisite. Permanent purge is outside this operation;
  historical deduplication is [maintenance](#maintenance).
- PATCH `{revision,action:"delete"|"restore"}` uses stored ownership and server
  authentication. Authors restore only their own withdrawals; administrator and
  legacy removals require an administrator. Restore keeps the ID and restores
  the recorded prior status, including official; only administrators may otherwise
  change official status. Legacy administrator status PATCH remains supported.
- Lifecycle transitions increment revision atomically. Repeating the last identical
  actor/action/expected-revision returns `unchanged`; stale competing writes refuse.
  Deleted discovery, previews and records are visible only to their author and
  administrators. Public discovery and new insertion exclude deleted and
  superseded records; saving a superseded record refuses with
  `COMPONENT_SUPERSEDED` and its `supersededBy`.
  Catalog revisions, author totals and duplicate lookup reflect each transition.
- GUI row menus and Agent `delete`/`restore` share this authority; menus offer
  deletion only to authorized users. The Deleted fold is opt-in; restore feedback
  and management menus do not change Project Undo history.

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
- Agent `user_components`: `publish` takes optional `visibility` (omitted:
  public, as before) and `onSameName: "version" | "new"` (default `version`;
  an old call without visibility only versions a public record, and a
  private save never withdraws a public one); `update` takes optional
  `visibility`; `make-public`/`make-private` take the lifecycle arguments;
  `versions` reads the version list; `browse` takes `includePrivate`. A retry
  with the same idempotency key resends its journaled destination. The
  maintenance operation is not exposed to Agents.
- Agent: `publicationVersion:1` opts into outcome/recovery/association
  metadata and structured duplicate references; without it, legacy shapes are
  unchanged (duplicate refusal still has a code and message). New MCP schemas
  ship as a smoke-tested package; a website merge does not release it.
- Portable schema 69 / runtime model 58 carry provenance; schemas 24–68 read
  without invented origins. Rollback must keep a schema-69 reader and the
  journal, never drop origins or turn pending writes into new publications.

## Maintenance

- `POST /api/admin/components/consolidate`, administrator session and same
  origin only. Body `{dryRun?: boolean = true, foldDuplicates?: boolean = true,
  makePrivate?: string[] (≤500 IDs), planDigest?: string}`.
- The plan: each author's `shared` records sharing a normalized name form a
  group; the newest by creation time (then ID) is kept and the others are
  folded into it — their own versions and current definitions become the kept
  record's versions, and they become `superseded` with `supersededBy`, each at
  its next revision. `makePrivate` records that are `shared` become `private`.
  Records the other region writes, and groups past the history cap, are
  skipped with a reason; run it at each entrance for that region's records.
- The reply: `{dryRun, planDigest, groups:[{authorId, author, name, keep:{id,
  revision, name, createdAt}, fold:[…], outcome, reason?}], private:[{id,
  outcome, reason?, revision?}], totals:{groups, records, private, skipped,
  failed}}`; outcomes `would-fold`/`folded`/`skipped`/`failed` and
  `would-make-private`/`made-private`/`unchanged`/`skipped`/`failed`.
- A dry run changes nothing. Apply (`dryRun:false`) commits each group and each
  privacy change in its own transaction after rechecking its revisions; with
  `planDigest` it applies only the reviewed plan and otherwise answers 409
  `COMPONENT_PLAN_CHANGED` with the current plan. Repeating an apply changes
  nothing more. Captured Project copies never change; folded records stay
  readable by their author and administrators.
