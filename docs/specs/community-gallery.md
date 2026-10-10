# Community Gallery

Status: `accepted`

Primary owners: `worker/gallery.ts` with its route modules,
`worker/gallery-do.ts` with the `worker/gallery-store*.ts` modules,
`worker/auth.ts`, `worker/auth-do.ts`, `apps/editor` landing feed

## Trust boundary

The only accepted input is Project JSON that passes the strict protocol
boundary (`parseProject`; the chained schema upgrades apply).
Everything stored and served — canonical Project text and the preview SVG —
is derived server-side from that validated model. Client-supplied markup is
never stored, echoed, or served. Previews are rendered by `@icm/render-svg`
from the entry's top document and served as `image/svg+xml` with a
restrictive content-security-policy.

## Reader access

The Gallery is for signed-in readers. Every Gallery read (the list and its
search, tags, authors, an entry and its Project, its preview and its history)
needs a signed-in session or the read-only Gallery credential
(`GALLERY_BACKUP_TOKEN` as a Bearer token). Signed out, every one of them
answers `401 {"error":"sign-in-required"}` with `cache-control: no-store`:
a visitor sees no circuit, name or count. The landing page then shows grey
stand-ins for the wall's tiles under a veil, with "The Gallery is for
signed-in members" and a Sign in button that opens the header's sign-in
choices; no tags, search or filters sit beside it. The editor's Insert from
Gallery panel shows the same veil over grey cards, with "Sign in to insert circuits from
the Gallery." and its own Sign in button. Agent Gallery reads made through a
signed-out editor fail with a message saying to sign in to the editor. Built-in
examples bundled with the editor are not Gallery content. "Public" below
means published on the wall for signed-in readers. Admin and owner-only
routes keep their own, stricter checks, and writes keep theirs.
A reader's preview is served `private`, so a shared cache never keeps it; the
Worker's edge cache keeps the immutable bytes behind the reader check. A valid
session is remembered for a minute per Worker isolate, so a wall of previews
asks the AuthDO once.

Opening someone else's public circuit — reading its Project Code through
`GET /api/gallery/<id>`, as the editor's Open, Insert and duplicate-check
Compare and Agent Gallery reads do — spends one of the account's 100 daily
opens (`GALLERY_DAILY_OPEN_LIMIT`, per UTC day). Each circuit counts once a
day. Past the allowance the read answers
`429 {"error":"daily-open-limit","limit":100,"resetAt":…}` with `Retry-After`,
opening or inserting in the editor shows a card in the middle of the canvas
saying when more open (with Back to Gallery and Close; the next attempt or a
tab change clears it), and an Agent read fails with
`GALLERY_DAILY_LIMIT`. The wall, search, tags, previews and
`GET /api/gallery/<id>?summary=1` (the entry's details without its Project
Code, used by links and publishing) are not counted, nor are an author's own
circuits, curators, the Owner's AI accounts (`AI_SEATS`), or the read-only
credential. A person browsing never meets the limit; a script cannot carry the
whole Gallery off at once. The record of today's opens is dropped by the
five-minute scheduled pass after the day ends, and with the account when it is
deleted.

## Public surface

- `GET /api/gallery` — newest-first `public` entries
  (`{entries, nextCursor, total}`; keyset cursor; limit clamps at 60; optional
  `author` filters to that exact byline and optional `tags=a,b` to
  entries carrying ANY listed tag, both ahead of pagination; `total` counts
  the whole filtered set and repeats on every page). `netlistable=1` keeps
  only the entries whose stored mark says the drawing extracts and
  `netlistable=0` only the ones it says do not; `ai=1` keeps only the entries
  marked AI-generated and `ai=0` only the others; and `liked=1` only the ones
  this session has liked — a signed-out request for the session's likes
  therefore selects none of them, never all of them. `filterCounts` counts
  both sides of each pair (`netlistable`/`withoutNetlist`, `ai`/`human`) with
  every other filter applied but its own pair's choice left out, so each side
  says what choosing it would show. The wall's side panel offers them as two
  pairs under Needs attention, "AI generated"/"Human made" and "With
  netlist"/"Without netlist": choosing one side of a pair moves the choice
  there, and choosing it again shows both. Every
  narrowing composes and every one of them precedes the cursor, so `total`
  and the page agree. Rejected and
  recycled entries never appear. Every entry includes the content-derived
  `previewRevision` used by its thumbnail URL plus `previewWidth` and
  `previewHeight` from the stored SVG viewBox. Older or invalid previews may
  omit the dimensions; clients must then retain their existing natural-size
  fallback.
  Each entry also carries `netlistable`: whether that stored drawing extracts
  to a netlist, answered by `designExtractsNetlist` through the same export
  the editor's Netlist panel uses, held to the same standard the editor's own
  copy/export is held to. The mark is about the drawing, not about a process
  library — a missing device model or an unbound width exports as a TODO
  placeholder and leaves the mark standing. A missing MOS body, an unresolved
  required pin, or a node only one pin reaches
  (`DEAD_END_NET`, see [netlist export](netlist-export.md)) clears it: those
  say the drawing is unfinished, which no export option can supply. It is
  re-answered whenever an entry is written, so repairing a published circuit
  lights its mark immediately, and the scheduled maintenance pass below
  re-answers stored marks after the rule itself changes.
  An entry whose publisher marked it as made by an AI also carries
  `aiGenerated: true`; every other entry omits the field. That mark is the
  publisher's word, never something the server infers from the drawing. An
  entry whose testbench passed the server's [simulation
  check](#simulation-checks) carries `simVerified: true` for a viewer who may
  see that mark, and omits it for everyone else. A card on the wall spells
  them out after the circuit name: a green "Netlist", then a purple "AI",
  then a blue "Sim".
  Each entry may also carry `componentCount`: the parts its top Cell draws —
  devices, sources, switches, blocks and gates, a subcircuit block counting
  once — leaving out Ports, supply and ground markers, drafting objects and
  undrawn Instances. It is stored with its rule version beside the netlist
  mark, answered on every write and by the same scheduled pass; an entry not
  counted yet omits it. `parts=0-5,6-10` keeps the entries in ANY listed
  size, from the sizes `config/gallery-taxonomy.json` defines (≤ 5, 6–10,
  11–15, 16–25, 26+); an unknown size narrows nothing.
  `filterCounts.componentRanges` counts the entries per size with every other
  filter applied, so each size shows what choosing it would add. The landing
  Gallery lists the sizes under Components in the left sidebar, above the
  tags, for any multi-selection; the tag counts follow the chosen sizes.
- `GET /api/gallery/tags` — distinct public tags with counts, most
  frequent first. The landing Gallery places these in a left sidebar grouped
  by circuit family, with per-tag counts and clearable multi-selection. Groups
  are presentation only: no authored tag or URL value is rewritten, unknown
  tags remain available under Custom & legacy, and tags restored from old links
  remain removable. One overall search at the top of the left column matches
  circuit names, authors, descriptions and tags without changing the tag list.
  Narrow mobile layouts keep that search visible while collapsing the filters
  and tag groups behind a Search & filters button. An empty tag selection result
  does not substitute unfiltered examples. The counts follow every filter of
  the wall except the tag choice itself (author or `owner`, netlist, AI mark,
  liked, Needs attention and its reason, sizes, and `q`), so no tag claims more
  circuits than the narrowed wall holds; with `q` they are those of the
  circuits the search finds.
- `GET /api/gallery/authors` — non-empty public bylines with their currently
  visible circuit counts, ranked by count and then author name. This endpoint
  remains the unfiltered public ranking. The clickable wall count instead uses
  the `authors` aggregate returned by `GET /api/gallery`: the same author,
  tags, netlist, AI mark, liked and authorized Needs attention filters as its cards,
  counted before pagination. Empty results show no contributors. Selecting an
  author retains the other active filters. While the wall is narrowed to one
  author, the menu opens with "Circuits by <author>" and an All authors
  button, the same control as the one beside the wall's author line; it
  clears the author and keeps every other filter. A wall narrowed to one
  account names it by the account's current byline once its contributors
  answer, even when a remembered filter or an older link carries a former
  name; the wall then remembers the current byline, and requests narrowed to
  an account send only `owner`. A link naming only the account shows the same
  line, as "this contributor" until a contributor answers.
- `GET /api/gallery?q=<words>` — the server searches every public circuit's
  name, byline, description and tags, never its Project Code or preview, with
  the rule the browser uses (`apps/editor/src/gallery-search.ts`):
  case-insensitive containment, else each word within one small Latin-letter
  edit of a word (`stgae` finds `stage`; words under four letters must match
  exactly). The search narrows the wall before its cursor, total, contributors
  and filter counts, so an older match comes back on the first page, and the
  response echoes it as `search`. The wall and the editor's Insert from
  Gallery panel send
  the same query a quarter second after typing pauses; until an echoed answer
  arrives they narrow what they have loaded by the same rule, and they read no
  older pages for words the server has not been asked yet. A server that
  answers without `search` did not search, and the page walk with counts
  marked “so far” remains the fallback. Signed out, a search is refused like
  every other read.
- `GET /api/gallery/<id>` — one public entry with its canonical
  `projectText`, spending one of the reader's daily opens (see
  [Reader access](#reader-access)); `?summary=1` answers the entry alone, free.
  The Project carries its simulation folders only for a reader of its
  testbench ([Testbench privacy](#testbench-privacy)); the entry carries
  `simVerified` as the wall's cards do.
- `GET /api/gallery/<id>/preview.svg?v=<previewRevision>&render=formula-label-v5` — the
  server-rendered preview. A revision matching the stored SVG is immutable;
  unversioned, stale-revision, hidden, and missing responses are `no-store`.
  The renderer variant bypasses browser caches of obsolete formula artwork.
  Old formula placeholders and earlier formula typography are rendered from
  their stored Project on read, without rewriting publication data, revisions,
  or history. Hidden-entry authorization still applies, including on edge
  cache hits. Ordinary previews retain their stored artwork and do not require
  a Project read. Shelf and historical previews share formula preparation and
  recovery while retaining their private access rules.
- Which circuits a reader is looking at — the wall (`view`), the byline
  (`author`), the tags (`tags`), the text (`q`), and the netlist and liked
  filters (`netlist`, `liked`) — is one preference and persists as one: it rides in
  the address so a link and the Back button carry the same slice, and in the
  browser's own store (`icm.gallery-filters.v1`) so opening a circuit and
  returning to the bare address restores it, including an emptiness the reader
  chose. A link that names any narrowing parameter is somebody's request for
  exactly that slice and replaces the stored preference outright rather than
  intersecting with it. The text query is answered in the browser over what
  has loaded, so it never speaks for the wall's `total`. The store is a
  convenience: a browser that refuses it loses only the memory, never the wall.
- `/` serves the full-screen feed; each tile links to `/g/<id>`, which the
  editor opens through the ordinary protocol boundary. `/editor` is the
  plain editor; `/editor?example=<id>` opens a bundled example. One thing
  in the editor is called Gallery: the blue entry beside the wordmark, which
  leaves for `/` through the editor's guard for unsaved work, as the wordmark
  does. The toolbar's Insert (G) opens the Insert from Gallery panel, which
  reads the same gallery list and inserts entries through the same path as
  `/g/<id>`. The panel has no heading or link of its own: it starts with its
  search, count and circuit cards, and the header's Gallery entry is the way
  to the Gallery itself. While the gallery is empty or
  unreachable, the feed and the panel both fall back to the bundled
  Library examples, so neither surface is ever blank. The landing feed loads
  its renderer, symbol catalogue, and bundled Projects only after the remote
  feed has settled empty or unavailable; a populated Gallery never pays for
  those fallback-only dependencies.
- The editor Publish dialog offers an on-demand **Check Duplicate**
  action. It compares the currently visible Cell (not
  unconditionally the Project's root Cell) against every public Gallery
  entry through the [duplicate-task service](#current-cell-duplicate-tasks).
  Exact topology results ignore instance, Net, Cell and
  external-port names; model and parameter values; top-level port order; and
  whether an external rail was represented as a Port or a global power Net.
  Device classes, recognizable MOS/BJT polarity, terminal roles and actual
  connectivity remain structural evidence. This topology-only contract is
  intentionally broader than the administrator's exact electrical duplicate
  contract. Results are bounded and ranked by verified structural coverage and
  parameter/model closeness as described in the task contract. The action is
  public and does not mutate Gallery entries: results
  link to the existing Gallery entry and offer read-only snapshot comparison.
  No cleanup authority is exposed in the editor.
  The click captures the comparison Cell: subsequent edits, hiding the panel,
  or refreshing its feed do not cancel the running scan or erase its results.
  A notice identifies results from an earlier canvas state; checking again
  captures the latest state. Only explicit Cancel or leaving the editor stops
  the job. Transient read failures retry within a bounded budget. Unverified
  comparisons are counted separately, and approximate results never display
  100%. Topology projection uses authored transistor polarity and reviewed
  external device pin mappings; unknown black-box targets remain distinct.
  The administrator's stricter netlist duplicate contract is unchanged.

## Classification and attention

[The taxonomy](../../config/gallery-taxonomy.json) defines one tag vocabulary
covering circuit function, topology, implementation and architecture. A circuit
may carry up to twelve tags; catalog suggestions include unused tags so the
current library does not define the limits of classification. Legacy/custom
tags remain browsable. Visual group headings organize the tag list but are not
a second filtering system. Tag search and multi-selection live in the resizable
left sidebar; its preferred width is local to the browser.

Attention is independent of publication status. Each finding carries one
reason from the taxonomy's `issueKinds` and explains where it is. The netlist
reasons are a global VDD (the netlist declares `.global VDD` instead of the Cell
exposing its supply as a Pin), an undefined component (a part the netlist has no
definition for) and a component without netlist (a block with no circuit
inside it). The drawing reasons are a wiring break (a suspected gap), an
unintended diagonal, an overlap, clipping, an unreadable label and an
incomplete drawing; anything else is `other`. A textbook abstraction,
intentional open port or missing simulation model alone is not a defect.
Review does not certify electrical correctness.

`attention=1` requires a session. Authors receive only their own pending entries;
administrators receive all pending entries. Under it, `reason=<kind>` narrows
the wall to the entries with a pending finding of that reason, and the tag
counts follow. The list's `filterCounts.attentionKinds` counts the pending
entries per reason over the wall with every other filter applied, so the
Gallery's reason menu shows each reason with how many entries carry it. An
unknown reason narrows nothing. Attention details on both the feed
and individual entries are omitted for everyone else. A tile looks the same to
every reader: the review is not a row under it but opens from the tile's `⋯`
menu, for its author or an administrator. The review lists each finding under
its reason and allows adding a note with a reason, marking the findings
resolved and reopening them. None of
these actions unpublishes the circuit or changes its Project, name, owner,
likes, preview, or visitor statistics.

`PATCH /api/gallery/<id>/curation` accepts `tags`, `attention`
(`null` or `{status: "needs-attention" | "resolved", issues: [{kind, detail}]}`),
`expectedPreviewRevision`, and `expectedCurationRevision`. It requires same-origin
requests and the entry's author or an administrator. An empty pending finding
is invalid. A changed image or review returns 409; an old review never silently
overwrites newer work. Revisions are existing identifiers/counters, with no
new payload hashing. A drawing changed after assessment retains its findings
and displays a recheck notice. Metadata changes preserve a version snapshot;
curation fields are included in backups and restores.

A bulk visual audit records the inspected image revision, original tags,
proposed tags, findings and uncertainty for every entry. The
[application script](../../scripts/curate-gallery.mjs) validates this report
without writing by default. Explicit application requires an origin, a session
cookie file and a before/after receipt. Changed entries are skipped for review;
interruption can resume without repeating already-applied metadata. Local
inspection does not authorize publication or a production data rewrite.

## Publishing

`POST /api/gallery/submissions` (same-origin) publishes immediately with:
trimmed `name` (required, ≤120), `description`
(≤1000, room for a full citation; a Gallery tile shows its first three lines
and the entry shows all of it), and `tags` (array; normalized lowercase `[a-z0-9 +/-]`, ≤32
chars each, at most 12, deduplicated — `sanitizeGalleryTags` is the one
normalization for writes and filters), `projectText` ≤2 MiB, and an optional
boolean `aiGenerated` (the AI mark; any other value is `invalid-fields`). The Worker validates, stamps the canonical
serialization, renders the preview, and stores the entry as `public`.
The editor's publish dialog shows the mark as an **AI-generated** box. It
starts ticked only when the Project came from an entry that carries the mark;
publishing by hand never ticks it for the person. When, in that browser tab,
an Agent changed the Project or opened it from a file the Agent staged, the
box's note says "An Agent worked on this Project", and the publisher decides.
A blank Project or one of the person's own Cloud Projects that an Agent merely
opens is not the Agent's work. The tab remembers the Agent's work across
reloads, but the Project does not carry it.
An Agent can publish or update through the Agent API's Project resource
(`publish-gallery-entry`, `update-gallery-entry`; MCP `gallery_circuits`
`publish`/`update`), which drives the same client as the dialog under the
signed-in Editor session and needs the session scope `gallery.publish`.
Whatever an Agent publishes or updates this way carries the AI mark; the author
changes it in the Editor's dialog with a later update.
Ordinary submissions count against a per-account limit of 100 per UTC day
(500 for an AI account),
counted from that account's entries created that day that are not in the
recycle bin: deleting or withdrawing an entry returns its slot, restoring it
spends the slot again, and a rejected entry keeps it. Admin and moderator
sessions are exempt — the quota is anti-garbage protection, and curators are
the ones cleaning up. `GET /api/gallery/quota` tells a signed-in session its
allowance before it fills in a form: `{limit, used, remaining, resetsAt,
exempt}`, `resetsAt` being the next 00:00 UTC. The publish dialog shows what
is left for new entries and when it resets, and keeps Publish closed once the
day's allowance is spent; an update spends nothing and shows none of it.

Publishing authority: a signed-in session is the whole gate. Every
signed-in account publishes directly as `public`; an ordinary member
receives the quality advice below; it does not veto publication for any role.
Anonymous upload stays impossible — an entry has to be attributable to
the account that published it. A successful submission answers 201
`{id, status, previewRevision}` with `status` always `public`. The editor
starts a non-blocking fetch of that revision immediately, then notifies other
same-origin tabs so an already-open Gallery switches URLs and refreshes its
no-store metadata without waiting for a cache TTL.

The byline is not a request field: the Worker takes `author` from the
session's display name, so one account cannot publish under another's
name, and an update never re-attributes an entry, save an AI account's
take-over (Owner editing).

After a successful first publication, the editor associates the live Project
with the returned entry id. Further edits followed by Publish default to
`PUT /api/gallery/<id>` for that same item rather than creating duplicates.
For a saved Shelf draft, this association is persisted as private Cloud Project
metadata (`gallery_entry_id`) and is restored after reopening, including browser
recovery. Loading this metadata never replaces private drawing content with the
public snapshot. A transient lookup failure blocks publication and offers Retry,
instead of falling back to a new entry. Replacing the active Project clears only
the editor's old context; the replacement draft restores its own association.

A bound Publish/Update sends `cloudProjectId` and `expectedGalleryEntryId` (null
before the first link). The Durable Object scopes the draft to the signed-in
account, rejects a changed link with 409, and commits the publication and source
association in one transaction. Publication does not Save or rewrite the private
draft. A first private Save after publishing may establish the link too, provided
that account has not already assigned another draft to the publication.

For historical drafts without a link, **Use an existing Gallery publication…**
accepts a Gallery address the user may update. Selecting it previews the update
target; **Update entry** commits the source change. This keeps the public id,
byline, likes and bounded version history, retires this account's previous source
association, and preserves both private drafts. Old tabs with a retired link
cannot overwrite the publication. No matching by title, Project id or topology
runs automatically. Source selection requires a saved Shelf draft.

Deliberately choosing **Publish as a new entry** associates the current draft
with the newly returned id and leaves the earlier public entry intact. Unbound
Gallery editing remains possible under the existing ownership/moderator rules;
it does not change another account's private source association.

Every entry records the submitting account: `owner_user_id` plus the
`submitter_email` and `submitter_provider` read from the session at
submission time, so an entry stays traceable to the identity that
published it even if the account is later renamed. These two fields are
traceability data, not feed data — the detail route returns them only to
a moderator or admin, never on a public surface.

## Submission quality advice

`evaluateSubmissionGates` in `@icm/derived` supplies quality advice when the
publish dialog opens. Findings are informational for
every role and never disable Publish. The worker does not enforce an ERC
quality veto; authentication, Project parsing, ownership, and size/quota
boundaries still apply. Diagnostic codes:

- `erc-errors` — any ERC diagnostic with `severity: "error"`.
- `floating-endpoints` — `ERC_UNCONNECTED_PIN`, `ERC_BULK_UNRESOLVED`,
  and `ERC_FLOATING_GATE`. A name on a singleton local Net is not electrical
  connectivity. The sanctioned cases are a real peer connection, a formal
  boundary, a reviewed global supply, an implicit pin, or explicit NoConnect.
  `ERC_UNDRIVEN_GATE_NET`, a Net of several gates, bulks or block inputs that
  nothing drives, is an editor warning only and is not part of this advice.
- `empty-project` — fewer than 2 instances AND no substantial drawing
  (3+ drafting objects including a text); pure block diagrams pass.

Failures carry `message`, `count`, and up to five example labels.

## Moderation

Statuses: `public | rejected | recycled`. Publishing is direct, so
nothing new ever enters a queue; curation is post-publication. A
`rejected` or `recycled` entry never appears on a public surface (list,
detail, preview); its detail and preview answer only to a moderator or
the owning session, and an AI account's also to every AI account (see Owner
editing).

`pending` is retired. Opening the storage promotes any leftover `pending` row
to `public` rather than stranding it. `rejected` is now the Owner's explicit
post-publication decision: its required reason remains visible to the
submitter until the Owner restores the entry.

- `GET /api/gallery/mine` — the calling session's entries with `status`,
  `rejectReason`, the withdrawal time `recycledAt`, their `likes`, and
  `withdrawnByCurator: true` on an entry the Owner withdrew. With
  `scope=ai-seats`, an AI account's session gets every AI account's entries
  in the same shape, newest first; any other session gets 403
  `ai-accounts-only`, and another scope 400 `invalid-scope`.
- Moderators: `users.role` (`user`/`moderator`); the super-admin
  appoints by email via `POST /api/auth/users/role` `{email, role}`,
  which applies to every account carrying that verified email. A
  moderator curates; quality advice is non-blocking for every role. The recycle bin and
  maintenance stay admin-only.
- The Gallery has no bulk process-model fill action, including for the Owner.
  One-off library repairs belong outside the Gallery browsing interface;
  process and model editing remain available inside each circuit's editor.

Every community tile carries a Like toggle backed by
`POST /api/gallery/<id>/like` (same-origin): a signed-in account holds at most
one like per public entry, pressing again removes it, and the feed reports each
entry's `likes` count and the viewer's `likedByViewer`. The Gallery feed gives
the super-admin a direct Reject (`×`) control on every community tile, plus a
`⋯` menu for Review drawing, Edit and replace and Withdraw. A signed-in
member's own tiles carry a `⋯` menu for Review drawing and Withdraw, the same
owner withdrawal as `/mine`. Withdraw acts at once, without a second step: the
recycle bin or My submissions restores the entry.
Reject opens a multi-select form with common reasons (`too ugly`,
`circuit incorrect`, `too simple`, `duplicate`) and an independent optional
note/other-reason field. The editor surfaces the full administration lifecycle
at `/moderation` (full-width masonry for rejected entries and the recycle bin)
and the submitter's view at `/mine` (status chips, rejection
reason, owner-visible preview, open-in-editor). Every gallery page state wears
the shared site chrome. Moderation cards open the circuit normally; their
actions are a visible row of alike buttons, with no menu: Restore to Gallery,
Move to recycle bin and Delete on a rejected entry, and Delete on a recycled
one. Delete removes the entry in one click, without a confirmation; for a
rejected entry the editor first moves it to the bin, the only place the server
deletes from. Moderator appointment,
schema convergence, and netlist-mark maintenance have no product forms;
authorized operator scripts use the existing admin-only APIs.

## Owner editing

`PUT /api/gallery/<id>` (same-origin) updates an entry's content and
metadata (tags included — they stay editable any time) with the
submission field rules. Authority: an admin or moderator session may
update any entry; an ordinary session must own the entry (403 otherwise)
and the submitted content must satisfy input validation. ERC and visual quality
advice do not block updates. Either way the entry keeps its
byline and its current status, so editing a published circuit neither
takes it off the wall nor re-attributes it. The Project is re-serialized
canonically, the preview is re-rendered, and the netlistable marker is
recalculated; 200 answers `{id, status, previewRevision}`. `aiGenerated` true
or false sets the AI mark and leaving it out keeps the stored one, so an
author can clear the mark an Agent's publish set (an AI account's entries keep
it); the update dialog starts from the entry's current mark and notes when an
Agent has worked on the Project. The mark belongs to the entry, not to
a version: restoring an earlier version keeps it. What an update does to the
entry's private testbench is under [Testbench privacy](#testbench-privacy).

An AI account may take over another AI account's entry (#1499; owner
decision 2026-10-08, the AI accounts all being the Owner's): when one model's
circuit is poor, another redraws it and its update carries `takeOver: true`.
The entry then moves to that account, owner and byline, as the new version
lands, and 200 also answers `{ownerUserId, author}`. It keeps its id, link,
likes, tags and AI mark; the version it replaced keeps the account that made
it, and the former account's Shelf draft no longer publishes as it. A
person's entry is never taken over, and a person takes over none: `takeOver`
then answers 403 `take-over-forbidden`. Without `takeOver`, another account's
entry stays forbidden to an AI account.

AI accounts see each other's hidden work (#1540; owner decision 2026-10-09):
an AI account's session lists every AI account's entries, rejected and
withdrawn ones with their reasons (`/mine?scope=ai-seats`), and reads such an
entry's detail, preview and version history as its owner does. It can then
take a rejected entry over as above; the entry keeps its status and reason, so
putting it back on the wall stays the Owner's decision, as for an entry the
Owner withdrew (see Owner withdrawal). Reading grants nothing
else: recycle, restore, delete and version restore keep their owner and admin
rules, an AI account never reviews, and a person's hidden entries stay their
own and the reviewers'. Which session is an AI account is the server's
answer (provider `ai` and a listed seat), never the request's.

The detail response carries `ownerUserId` so the editor offers "update the
opened entry" exactly to owners and moderators.

Owner withdrawal: `POST /api/gallery/<id>/recycle` (same-origin) also
accepts the owning session — the entry moves to `recycled` and leaves
every public surface, exactly like an admin recycle. The owner brings a
voluntary withdrawal back with `POST /api/gallery/<id>/restore`, which
republishes it. An ordinary owner cannot restore or recycle an Owner-rejected
entry; it remains editable but hidden until the Owner restores it. Nor can an
owner restore an entry the Owner withdrew (#1540), whoever owns it since: the
Owner's Withdraw of someone else's entry, like duplicate cleanup, records the
reviewer at the withdrawal, and `/mine` marks it `withdrawnByCurator` without
a Restore; 409 `invalid-status` otherwise. The recycle
bin keeps each account's 25 most recently recycled entries: an older one is
removed permanently when that account next publishes or has an entry recycled,
and nothing expires by age. Legacy entries without an owning account are
exempt, and so is what the Owner rejected or withdrew.

Owner deletion: `DELETE /api/gallery/<id>` (same-origin) also accepts the
owning session, which removes the entry with its saved versions and likes
permanently in one step, without withdrawing it first. `/mine` surfaces the
available actions as the same visible row: Withdraw, then Restore and Delete
on a withdrawn entry. Delete removes it in one click, without a confirmation.

## Version history

Every content-replacing update (`PUT`, and Restore itself) first
snapshots the entry's previous state — name, author, description, tags,
canonical project text and its private testbench, preview — into
`gallery_entry_versions`,
numbered per entry and capped at the newest 3 (older versions are pruned).
The live current state is separate and does not count toward those 3 snapshots.
Maintenance re-serialization does not snapshot (content-equivalent).
Authority: moderators (admin or moderator session) and the entry's
owning session:

- `GET /api/gallery/<id>/versions` — versions, newest first.
- `GET /api/gallery/<id>/versions/<versionId>/preview.svg`.
- `GET /api/gallery/<id>/versions/<versionId>/project` — canonical Project text;
  same owner/reviewer access, `no-store`, no submitter metadata. The
  version's simulation folders come only to a reader of the entry's testbench.
- `POST /api/gallery/<id>/versions/<versionId>/restore` — snapshots the
  current state, then adopts the version's content and metadata, so
  restores are themselves reversible. A restore keeps the entry's status
  and byline.

The editor surfaces this as "Version history…" inside the publish
dialog's update mode (moderators and owners) and as a per-entry
"Version history" action on `/mine`. Compare loads frozen historical and current
published Projects, shows additions (green), removals (red) and modifications
(amber), with per-component field changes and a Cell selector. Stable Cell and
Instance ids own correspondence; delete/recreate is addition/removal. Parameters,
placement, labels, embedded definitions and logical terminal membership are
compared; generated Net ids and source provenance are not. Standalone drawings
and raw source-file changes are outside this component report. A component with
no placement remains listed but has no highlight on the canvas.

Branch opens a full independent Project, with a fresh Project identity and no
Cloud/publication binding. In the editor it opens a new project tab; `/mine`
opens an editor tab using the protected historical Project endpoint. Save creates
an independent private draft; publishing it is a separate action. There is no
merge graph or automatic publication. Private Cloud Project history follows
the separate [save-history contract](persistence-and-recovery.md#private-save-history).

## Testbench privacy

A circuit's testbench — its simulation folders (`simulationFolders`: sources,
analyses, measurements and specs) — is its author's (#1545; Owner decision
2026-10-09). The drawing stays on the wall; the testbench does not.

- **Who reads it.** One of the Owner's own accounts (`OWNER_ACCOUNT_IDS`), the
  entry's owner, and an AI account reading an AI account's entry
  (`readsTestbench`). Nobody else, curators and the read-only credential
  included.
- **What they get.** `GET /api/gallery/<id>` and a version's `…/project`
  answer such a reader the Project with its folders, and everyone else the
  same Project with `"simulationFolders": []`. The editor's Open, Insert and
  Compare and the Agent's Gallery read, open and insert read these routes, so
  opening one's own circuit brings its testbench back and copying someone
  else's carries none. Previews, netlist marks, part counts, the netlist read
  and the public documents read only the drawing.
- **Storage.** Every write — publish, update, take-over, version restore,
  dataset import — serializes the Project, stores `project_text` with the
  folders emptied to `[]`, and keeps the folders' own text in the row's
  `testbench_text` column; a version snapshot copies both. A column of each
  entry and version row rather than a table: the testbench goes wherever its
  row goes (history, take-over, retention, deletion), and every backup page
  carries it without a new table, so the off-site collector's check of the
  tables it captures holds. Every other byte of the Project Code stays, and
  putting the testbench back gives the serialized Project byte for byte.
- **Updates.** An update replaces the content, so a writer who reads the
  testbench replaces it with the folders its Project holds; none clears it. A
  writer who does not (a curator's Edit and replace) never received it: the
  entry keeps the one it holds, and folders in that writer's Project are
  ignored. A take-over is an AI account writing an AI account's entry, so the
  redraw's folders become the entry's. A restore brings back that version's.

**Moving the existing ones.** Entries and versions stored before this keep
their folders inside `project_text`; reads strip them for everyone else from
the deploy on. `POST /api/gallery/maintenance/testbench-privacy`
(administrator session, same-origin) moves them into `testbench_text`. It
moves nothing until a backup is recorded: backups run in the private backup
repository, which the Worker cannot start. So the Owner first

1. runs `node scripts/gallery-private-snapshot.mjs --store` from the main
   checkout (the Gallery backup, without `--store`, holds these tables too);
   the folder it downloads is named after the Release,
   `store-<time>Z-<run>-<attempt>`;
2. sends that name from a signed-in administrator's browser on the site. A
   Release more than 24 hours old answers 400 `invalid-backup`.

```js
await fetch("/api/gallery/maintenance/testbench-privacy", {
  method: "POST",
  body: JSON.stringify({ backup: "store-<time>Z-<run>-<attempt>" }),
}).then((response) => response.json());
```

Every call answers `{backup, applied, moved, remaining, legacy, failures}`,
counting entries and versions. Once a backup is recorded, the five-minute
scheduled pass moves 25 rows a tick, and `{"apply": true, "limit": n}`
(n ≤ 200) moves a batch at once; before, `apply` answers 409
`backup-required`. A moved row keeps every other byte of its Project Code and
the rest of the row (status, byline, preview, curation revision); no version
is snapshotted. Each row is checked first — the text round-trips byte for
byte and, read as JSON, only the testbench changed — and a row that fails
stays, listed in `failures`. A second run finds nothing and changes nothing;
with nothing left the schedule reads one row a tick. Rows from before schema
42 keep one `simulation` instead and are counted as `legacy`: `schema-current`
converts them, and the pass then moves them. A schema conversion or a
`schema-restore` makes the schedule look again.

## Simulation checks

The Sim mark (#1545; Owner decisions 2026-10-09) says a circuit's testbench,
run again by the server on the hosted simulator, completes and meets every
Spec it states.

- **Criterion (rule 1).** Every simulation folder of the stored Project runs
  to completion, the testbench states at least one Spec, and every Spec it
  states (`* @spec` with a condition, or one written wrongly) passes. A
  folder that cannot be prepared or whose run does not complete is `error`;
  a stated Spec that misses, or cannot be judged (its measurement missing,
  for one), is `fail`, as is a testbench that states no Spec (`no-specs`);
  an entry without a testbench is `no-testbench`. Only `pass` earns the
  mark, and only under the rule its verdict was judged by: a verdict of an
  older rule shows nothing until checked again.
- **Running it.** Checks run only when the Owner asks, never on publish.
  `POST /api/gallery/simulation-checks` (one of the Owner's accounts,
  same-origin, else 401/403 `owner-only`) queues `{"ids": [...]}` (up to
  500, any status) or `{"all": true}` (every public entry with a testbench)
  and answers 202 `{queued, noTestbench, missing, waiting}`; an entry
  already waiting keeps its place, and one without a testbench is answered
  `no-testbench` at once. `GET` on the same path reads `{waiting, current,
counts, results}`. On the wall, an Owner account's `⋯` menu on a tile
  offers Verify simulation, and the sidebar offers Verify simulations for
  all of them with how the checks stand.
- **How it runs.** The five-minute scheduled pass works the queue, first
  entry first and one folder at a time, for up to four minutes. The Worker
  prepares each folder from the stored Project and testbench with the code
  the Simulation panel prepares a run with (`prepareFolderExecutionInput`),
  submits it as a managed run through the same admission, queue, limits and
  retries every run takes, under an account of its own
  (`gallery-simulation-check`, one run waiting and one running at most), and
  judges the result with the panel's Spec evaluation
  (`executionSpecReport`). It asks ngspice for the log alone, where the
  Specs are, and reads no result larger than 8 MiB. While the simulator
  cannot take the run or has not answered, the folder waits at the head of
  the queue, and the next pass asks for the same run again rather than
  starting another; a run that ends without a result (expired in the queue,
  for one) is that folder's `error`. A folder that errs or fails ends the
  entry's check.
- **Storage.** Each entry's latest verdict is its `simulation_check_json`
  column: `{status, checkedAt, rule, simulator, reason?, folders}`, each
  folder with its status, Problem or Spec reason, simulator, Profile, and
  each stated Spec's expected condition, value, unit and judgment. A column
  of the entry, it goes where the entry goes and rides in the backup pages;
  a restore brings it back with the content it checked. Any change to the
  stored Project Code or testbench clears it, whoever writes it (an update,
  a take-over, a version restore, a maintenance pass), and a check whose
  entry changes while it runs starts over. The queue is its own table, not
  backed up.
- **Who sees it.** The verdict, Specs included, is private like the
  testbench: `GET /api/gallery/<id>/simulation-check` answers
  `{check, waiting}` to a reader of the entry's testbench and 404 to
  everyone else. The mark, `simVerified` on the wall's entries and an
  entry's details, goes to the same readers — the Owner's accounts, the
  entry's own author, and AI accounts for AI accounts' entries — until the
  date `publicFrom` in [config/gallery-sim.json](../../config/gallery-sim.json)
  names (null: not yet; proposed about six months on, with the dataset
  release). From that date every reader sees the mark; the verdict's
  details stay private. Until then the API sends nobody else any of it; the
  wall has no Sim filter or count yet. The Agent API's Gallery reads do
  not carry the mark.

## Reference datasets

Published circuit datasets (AnalogGenie, CircuitThink, AMS-Net, #1510; AnalogRetriever, #1498) can be
read beside the community wall without crowding it. `config/gallery-sources.json`
lists each dataset once: `key`, entry-id `prefix`, display `name`, the `byline`
its circuits carry, `license`, and its `homepage` and `paper` links.

- **Separate stores.** Each dataset lives in its own Gallery Durable Object,
  `source:<key>`; the community store stays `gallery`. No community list,
  count, tag, search or maintenance pass sees a dataset entry.
- **Ids say the store.** A dataset entry's id is `<prefix>-<id>` (`ag-308`,
  `ct-12`, `amsnet-5`); a community id never holds a hyphen. Every
  `/api/gallery/<id>…` request is answered from the store its id names, so
  `/g/ag-308` and `/?entry=ag-308` open the dataset circuit directly. The feed
  and tag list take `source=<key>` to read a dataset's wall.
- **Read-only.** A request that would change a dataset entry — like, update,
  withdraw, restore, delete, publish — answers 403 `dataset-read-only`, for
  every account. Entries carry no owner and no AI mark. Opening one in the
  editor makes an ordinary working copy that publishes as a new community
  entry, never as an update.
- **Switch.** `GET /api/gallery/sources` answers `{sources: [... , count]}`.
  The wall shows a Source switch beside the circuit count: Community (the
  default) or one dataset at a time, each with its count. A reader is offered
  only the datasets that hold circuits, so the switch stays hidden until one
  is imported; an Owner account is always offered every dataset, empty ones
  with their 0. A dataset wall drops the like control and the author
  tools and opens with one line naming the dataset, its licence and links. The
  choice rides in the URL as `source=<key>`; switching clears the author and
  attention narrowings.
- **Import (Owner only).** `POST /api/gallery/sources/<key>/entries`
  (same-origin; an Owner account's session, else 403 `owner-only`) takes
  `{entries: [{id, name, description?, tags?, projectText, createdAt?}]}`, at
  most 10 per request. Each entry is checked like a submission — name and
  description lengths, Project size, Project parse — and its id must carry the
  dataset's prefix (`invalid-id` otherwise). The server stores the canonical
  Project, renders its preview, answers its netlist mark and part count, and
  sets the byline from the configuration. An existing id is replaced in place
  (its earlier version kept), so a re-import repairs rather than duplicates.
  The answer lists `{id, ok, created, previewRevision}` or `{id, ok: false,
error}` per entry. Import runs from the Owner's signed-in browser
  (`fetch` from the Gallery page's console or a page script), so no new key or
  secret exists for it.

## Accounts and sessions

`AuthDO` (one SQLite Durable Object singleton) owns users and sessions
behind `/api/auth/*`. Every provider is invisible until its Worker
secrets exist (`GET /api/auth/providers` reports `{github, google,
email}`); with no provider configured the site shows no sign-in UI at
all. Otherwise both the Gallery header and the editor's top bar show the
signed-in display name with its account menu, or Sign in. No passwords ever
exist. The browser holds a random session token in
an HttpOnly `SameSite=Lax` cookie (`icm_session`, 30-day TTL); the
database stores only SHA-256 hashes of session tokens and sign-in codes.

- `GET /api/auth/github/start|callback` — GitHub OAuth code flow
  (secrets `GH_OAUTH_CLIENT_ID`/`GH_OAUTH_CLIENT_SECRET`; GitHub Actions
  forbids the `GITHUB_` prefix, hence the names). Callback URL:
  `<origin>/api/auth/github/callback`. Only a verified email is stored.
- `GET /api/auth/google/start|callback` — Google OAuth code flow
  (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`); an unverified Google email
  is treated as absent.
- `POST /api/auth/email/start` + `POST /api/auth/email/verify` — an
  emailed six-digit sign-in code via Resend (`RESEND_API_KEY`, optional
  `AUTH_EMAIL_FROM`), typed into the page that asked for it, so the email
  may be read in any browser or on another device. `start` takes `{email}`;
  `verify` takes `{email, code}` and sets the session cookie. A code is
  single-use, expires in 10 minutes, and stops working after 5 wrong
  guesses; asking again replaces it. Sending is limited to 5 codes per
  address per UTC day.
- AI accounts ("seats") are the super-admin's, for Agents to publish under
  without taking a person's account. They are listed in code (`AI_SEATS` in
  `worker/auth-do.ts`): seat, account id and the model's official name
  (`ai-designer-1` Claude Opus 5.5, `ai-designer-2` GPT-6 Astra,
  `ai-designer-3` GPT-6.1 Sol). A seat has
  `provider` `ai`, `provider_id` its seat, role `user` and no email, so it is
  never the super-admin, and no identity, code or password signs in to one.
  - When AuthDO starts, each listed seat is made, or the account an Agent
    already published under is converted in place, only while it still has
    the name it published under (`formerName`): its id, sessions and Gallery
    entries stay, and the email and provider identity it held are released
    to their owner. AuthDO restores the listed name, and GalleryDO the byline
    of the seat's entries and saved versions and their AI mark, whenever
    they start; a seat cannot rename itself (409). A new seat is a new line;
    seats are never reused.
  - GPT-6.1 Sol published through GPT-6 Astra's seat before it had its own.
    A one-time GalleryDO migration moved GPT-6 Astra's entries published
    after its 25th (after 2026-10-07 21:50 UTC) to `ai-designer-3`, with
    their saved versions' bylines, the AI mark and GPT-6 Astra's Cloud
    Projects published as them. Restoring a backup from before the move
    moves them again, up to the time it first ran; what GPT-6 Astra
    publishes afterwards stays its own.
  - The account page's **AI Accounts** tab (`GET /api/auth/ai-accounts`,
    super-admin only) lists the seats, each with **Switch to this account**
    (`POST /api/auth/ai-accounts/switch {userId}`, same-origin gated): the
    browser gets a 30-day session as the seat, and a fresh session of the
    super-admin's, just as long, waits in `icm_owner_session`, an HttpOnly
    cookie sent only to `/api/auth`. `me` then carries `switchedFrom`, and
    the header's ↩ button (`POST /api/auth/ai-accounts/return`) ends the
    seat's session there and restores the super-admin's; a second tab's ↩
    after that changes nothing. Without a live super-admin session to return
    to, the browser is signed out instead. Signing out clears both; a seat is
    not deleted from its own page.
  - A seat's entries always carry the AI mark, whoever publishes or updates
    them, and a seat may publish 500 entries a UTC day (people 100). Its
    Gallery opens are not counted at all. The Publish dialog shows the box
    ticked and fixed for a seat. The administrator statistics count people's
    accounts only.
- `GET /api/auth/me` — `{user}` with `id`, `displayName`, `email`,
  `provider`, `role` (`user`/`moderator`), the per-request `isAdmin` flag,
  for an AI account its `seat` and, while switched, `switchedFrom`, and
  `isOwner` for one of the Owner's own accounts (see Administration).
- `POST /api/auth/profile` — rename the caller's display name (trimmed,
  1–40 chars). `POST /api/auth/logout` ends the session. Both are
  same-origin gated like submissions.
- `POST /api/auth/account/delete` with `{confirm: "delete-account"}` —
  delete the signed-in account (account menu → **Delete account…**),
  same-origin gated. `GalleryDO` deletes the circuits the account
  published, in every status, with their versions and likes; then the
  account's likes on other circuits; then its Cloud Projects and their
  revisions. `ComponentLibraryDO` deletes the components it shared.
  AnalogArena unlinks the account from its Voter
  ([Account deletion](analog-arena.md#account-deletion)). Last,
  `AuthDO` deletes the account's sessions, sign-in codes, daily code
  counters and the account row, and clears the session cookie. A failing
  step answers 503 and leaves the account signed in. Every step is
  idempotent, so retrying finishes the deletion. The reply counts what
  went: `{deleted: {circuits, likes, projects, components}}`.
- OAuth `state` is double-submitted through a short-lived HttpOnly cookie
  and compared on the callback; failures redirect to `/?auth=failed`.

Identities from different providers are distinct accounts in G2 (linking
is a later refinement). Super-admin is computed per request: a session
whose email appears in the union of the `ADMIN_EMAILS` and additive
`ADMIN_EMAILS_EXTRA` secrets (both comma-separated and case-insensitive)
has admin authority — including the administration routes below — and
rotation of either secret needs no re-login. The additive secret allows
operators to grant access without replacing the primary administrator
list. The session cookie is the only publishing credential there is: there is no
passphrase, bearer token, or shared secret anywhere on the gallery
write path.

## Administration

Admin routes require a signed-in super-admin session. There is no bearer
alternative: `GALLERY_ADMIN_TOKEN` is retired, and an `Authorization`
header buys nothing. Without such a session every admin route answers
401:

- `POST /api/gallery/<id>/recycle` — soft delete into the restorable bin;
  the entry disappears from every public surface. (Also open to the
  owning session as withdrawal — see Owner editing.)
- `POST /api/gallery/<id>/reject` — hide a public entry and record a required
  `{reason}` (trimmed, at most 500 characters), the reviewing account, and the
  review time. The submitter sees the reason on `/mine`.
- `POST /api/gallery/<id>/restore` — back to `public`.
- `DELETE /api/gallery/<id>` — permanent; a super-admin session deletes only
  entries already in the bin (`409` otherwise). (Also open to the owning
  session as one-step deletion — see Owner editing.)
- `GET /api/gallery/recycled` — the bin.
- `GET /api/gallery/rejected` — rejected entries and their reasons.
- `GET /api/gallery/maintenance/schema-backup?table=…` — one-row pages of the
  whole store (entries, saved versions, likes, private Cloud Projects and their
  versions) for an administrator session; `table=inventory` answers counts,
  schema and the store revision. A request without `table` is refused
  (`table-required`): the whole store no longer fits one response.
- `GET /api/gallery/maintenance/automated-backup` — the same bounded pages for
  the dedicated read-only credentials: Gallery-only for `GALLERY_BACKUP_TOKEN`,
  and with `scope=store` the whole store for `STORE_BACKUP_TOKEN`, which reads
  nothing else. No writes. See
  [off-site backups and recovery](../gallery-backup.md).
- `GET|POST /api/admin/recovery` — Cloudflare point-in-time recovery of a
  whole store (this one holds the Gallery and every private Cloud Project);
  see [deployment](../deployment.md#point-in-time-recovery).
- `GET /api/gallery/maintenance/netlists` — the public entries' netlists, in
  entry-id order, for an administrator session or the same read-only
  credential. `format=spice|spectre` (default `spice`), `limit=1..200`
  (default 100) and `after=<nextCursor>` page through the wall; `id=<entry>`
  reads one entry. Each entry carries its name, author, tags, creation time
  and stored netlistable mark, then the design netlist its drawing prints
  (the editor's netlist printer), or `null` when printing is blocked, with
  every diagnostic. A drawing the editor calls unfinished (a wire that
  reaches no peer) still prints; its `DEAD_END_NET` finding says so and its
  netlistable mark is false. A page also ends once its Project Code reaches
  8,000,000 characters; `nextCursor` is `null` on the last page. Recycled and
  rejected entries are not included.
- `POST /api/gallery/maintenance/schema-current` — validate or transactionally
  converge every stored Project to `CURRENT_PROJECT_FILE_VERSION`. The
  request body is `{ "apply": false }` for a dry run and `{ "apply": true }`
  to commit only when every record is valid. The response reports
  source-version counts, validation failures, and the current target version;
  it does not embed a second Gallery-specific migration policy.
- `POST /api/gallery/maintenance/netlist-badges` — re-answer one batch of
  stored netlistable marks (`{ "limit"?: 1..200 }` → `{scanned, changed,
unreadable, ruleVersion, remaining}`). Every entry stores the rule version
  its mark came from (`NETLIST_MARK_RULE_VERSION`, bumped whenever a change
  can turn a stored answer stale), so the pass selects exactly the entries
  behind this build and carries no cursor: running it again when none is
  stale reads one count and stops. An unreadable stored Project keeps its
  mark, is counted, and is stamped so the pass does not meet it for ever.
  The same pass runs on a schedule (`triggers.crons` in both channels'
  Wrangler configs), so a deployed rule change converges without anybody
  pressing anything; the route stays for when somebody wants it now.
- `POST /api/gallery/maintenance/label-looks` — bring up to 20 entries'
  labels to the standard (see [names and labels](names-and-labels.md)):
  drawn supply, device Reference, Cell Pin and Net labels without a look of
  their own take their standard look (V_DD, M₁, V_BP), and a drawing that
  never chose a subscript slant draws subscripts upright. The body is
  `{ "ids": [...], "table"?: "galleryEntries" | "galleryEntryVersions",
"apply"?: true, "expected"?: {<id>: <sha256>}, "nudges"?:
{<id>: [{label, dx, dy}]}, "keep"?: {<id>: [label]}, "legacyLooks"?: true }`.
  `legacyLooks` also restyles looks stored before these standards (stored
  copies of a historical look, scripts slanted by the surrounding italic).
  The server applies it only to content saved before them (2026-09-24, #1052):
  an entry by its creation or newest update, a version by its own date. The
  server computes the change itself; a nudge may only move a label given its
  standard look, by at most 16 × 12 units, and `keep` names standard-look
  candidates to leave exactly as they are. A label whose standard look would
  draw it over a wire, part or label it was clear of keeps its look and is
  reported in `clearanceKept`, for manual repair; a nudge that leaves it over
  something refuses the row. Without `apply` it reports, per row, the labels,
  the SHA-256 of the stored Project Code, and whether every electrical name
  and the SPICE and Spectre netlists are unchanged. An apply needs that
  SHA-256 for each row (`stale` otherwise), refuses any electrical change,
  re-renders the preview, and replaces only the Project Code and preview
  through a compare-and-set. With the default `galleryEntries` the entry's
  saved versions, byline, status, tags and likes are untouched; with
  `galleryEntryVersions` the ids name retained versions, and only their
  Project Code and preview change, never their number, byline, text, tags or
  date. Only the public Gallery is maintained: a row whose entry is not
  public is skipped (`not-public`). Each result carries the content's
  `savedAt` (and a version's `entryId`), and `legacyWithheld` when that date
  kept `legacyLooks` from applying. Same-origin only.
- `POST /api/gallery/maintenance/testbench-privacy` — record the backup the
  testbench move follows, report it, and move a batch: see
  [Testbench privacy](#testbench-privacy).
- `POST /api/gallery/maintenance/schema-restore` — atomically restore the three
  Project-bearing tables from a `schema-backup` payload supplied as
  `{ "backup": ... }`, assembled from the backup pages. Current retention is
  reapplied, so a legacy backup with more than 3 versions for an entry restores
  only its newest 3. The payload must fit one Worker request (100 MB), which
  the whole store has outgrown; whole-store rollback is point-in-time recovery.
  This same-origin endpoint is an emergency rollback operation, not a general
  import surface.

The Owner's own accounts, listed by account ID in code (`OWNER_ACCOUNT_IDS`:
the Owner's Google and GitHub sign-ins), have one more view that no other
administrator has: the account page's **Data** tab. `GET /api/auth/me` marks
such an account `isOwner`; a browser switched to an AI account is not one.
`GET /api/gallery/owner-data` answers only them (401 signed out, including
the read-only credential; 403 otherwise), with public facts only, what the
wall itself shows:

- each author's public circuits, grouped as the wall's contributors are (by
  account, or `legacy:` and the byline for an entry without one): the count,
  the average part count of those whose count is known, how many carry the
  AI mark and the netlist mark, their likes and the newest one's
  publication time;
- with `author=<key>`, that author's public circuits, newest first, each with
  its parts, marks and likes.

The tab shows the totals, the authors as a table searchable by byline, and
one author's circuits on a click, each linking to its `/g/<id>` page.

## Retention and privacy

Entries are public content. Publishing is publish-then-moderate: a
signed-in account puts a circuit straight on the wall, and the recycle
bin is the takedown mechanism if it should not have gone up.

The submitting account is the only notion of "who submitted", and its
identity is not public:

- the daily quota counts that account's own entries; the Gallery keeps no
  connecting-IP hash or separate submission counter;
- an entry stores the submitting account's id, email, and provider, and
  the API discloses the email and provider only to a moderator or admin.

What a visitor sees is the byline — the account's display name — which
the account holder controls from the account menu.

Deleting the account removes its entries with everything else the site
keeps for it ([Accounts and sessions](#accounts-and-sessions)). The public
notice at `/privacy` describes this to readers, with the cookies, the
retention periods and the outside services; it is readable signed out.

Off-site backups are operator copies, not publication: Gallery backups and
the manually started whole-store backups — which also hold every private
Cloud Project — live as private Releases of the operators' private backup
repository, never automatically deleted, and are read only to recover data
([off-site backups](../gallery-backup.md)). A deleted account's rows remain
in backups taken before the deletion.

## Current-cell duplicate tasks

The duplicate scan captures the current Cell when started. On the hosted site,
one private durable task belongs to the signed-in account; signed out, none
starts (`401 sign-in-required`) and a read finds no job, since the Publish
dialog offers the check only to a signed-in account.
Server alarms advance and checkpoint work; browser polling observes it.
Closing the dialog, changing the drawing, refreshing or closing the page does
not cancel it. Reopening resumes progress/results within the seven-day retention
window. Explicit Cancel stops work. A second start while running is refused;
request identity makes a lost start acknowledgement safe to retry.
Results of a check of another Project or Cell are not shown in that Cell's
dialog, only that the last check was of that circuit; a check of the same Cell
since edited stays, marked historical.

The hosted result shows what the local check shows (below), at most 20
matches within an 8 MiB result budget; omissions and incomplete coverage
remain explicit. Access does not expose another
owner's snapshot. A match names its circuit, scores and correspondences and
the preview revision it was compared at, never the drawing itself: Compare on
canvas opens that circuit as an ordinary read (one of the day's opens) and
refuses a circuit changed since the check. Storage, admission and limits are owned by
[TopologyTaskDO](../../worker/topology-task.ts), and browser resumption by
[the task client](../../apps/editor/src/features/editor-shell/gallery-topology-task.ts).

Without the hosted endpoint, the local Web Worker fallback belongs to the page
session. It survives closing the Publish dialog but ends on page close/reload.
The UI distinguishes this fallback from durable execution; it is not a second
promise of server recovery.

Exact topology is confirmed using device classes, polarity, pin roles and
connectivity. Full netlist equivalence, including models and parameters, is
checked separately. The public comparison returns a graph witness and device
occurrence paths; it does not weaken the administrator's exact-duplicate
cleanup contract.

For partial results, a bounded injective mapping of compatible devices and
incident nets proves each displayed correspondence. A common net remains
common and distinct nets cannot collapse. Passive two-pin devices may reverse;
transistor and external black-box terminal roles may not. Structural score is
matched-device Dice coverage multiplied by `0.8 + 0.2 × neighborhood score`.
An exact topology receives structural score 1.

Parameter comparison normalizes SPICE engineering numbers and averages
`min(abs(a), abs(b)) / max(abs(a), abs(b))` over parameter names present on either
side, with equal values scoring 1, missing values or different signs scoring 0.
Symbolic expressions require literal equality. This contributes 80% of the
parameter/model score, with 20% from matching model and invocation identity.
Overall score is `structure × (0.85 + 0.15 × parameter/model score)`. Results
sort by this score; only confirmed full netlist equality displays 100%. Both the
local fallback and hosted tasks select every exact topology match and at most
three close partial matches, those scoring 50% or more (a hosted task then
applies its bounds above), and count the close ones left out; a circuit with
none reads "No close match", never a list of unrelated nearest circuits. A similarity
percentage is not a simulation-equivalence guarantee.

**Compare on canvas** renders frozen source and candidate Projects side by
side. Equal colors mark corresponding devices. Selecting a pair opens each
leaf Cell, focuses its device and lists the original parameters. Complete
instance paths distinguish repeated child Cell occurrences. Unplaced devices
have a parameter comparison but no highlight. Subsequent live edits or Gallery
updates do not replace these snapshots; closing or using keys in this dialog
cannot edit the live circuit.

Matching is bounded. Budget exhaustion is visible and only verified pairs are
shown, without claiming maximal coverage. Symmetric circuits may have multiple
valid correspondences; parameter ordering is a preference, not a guarantee of
the globally best assignment. Graph extraction's existing limits and
uncheckable cases remain explicit. The primary algorithm tests live in
`packages/netlist/src/topology-correspondence.test.ts`; Gallery ranking, task
lifetime and browser workflows cover their own boundaries.
