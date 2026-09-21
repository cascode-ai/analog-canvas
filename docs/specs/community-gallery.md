# Community Gallery

Status: `accepted`

Primary owners: `worker/gallery.ts`, `worker/gallery-do.ts`, `worker/auth.ts`,
`worker/auth-do.ts`, `apps/editor` landing feed

## Trust boundary

The only accepted input is Project JSON that passes the strict protocol
boundary (`parseProject`; the chained schema upgrades apply).
Everything stored and served — canonical Project text and the preview SVG —
is derived server-side from that validated model. Client-supplied markup is
never stored, echoed, or served. Previews are rendered by `@icm/render-svg`
from the entry's top document and served as `image/svg+xml` with a
restrictive content-security-policy.

## Public surface

- `GET /api/gallery` — newest-first `public` entries
  (`{entries, nextCursor, total}`; keyset cursor; limit clamps at 60; optional
  `author` filters to that exact byline and optional `tags=a,b` to
  entries carrying ANY listed tag, both ahead of pagination; `total` counts
  the whole filtered set and repeats on every page). `netlistable=1` keeps
  only the entries whose stored mark says the drawing extracts, and `liked=1`
  only the ones this session has liked — a signed-out request for the
  session's likes therefore selects none of them, never all of them. Every
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
- `GET /api/gallery/tags` — distinct public tags with counts, most
  frequent first. The landing Gallery places these in a left sidebar grouped
  by circuit family, with per-tag counts and clearable multi-selection. Groups
  are presentation only: no authored tag or URL value is rewritten, unknown
  tags remain available under Custom & legacy, and tags restored from old links
  remain removable. One overall search at the top of the left column matches
  circuit names, authors, descriptions and tags without changing the tag list.
  Narrow mobile layouts keep that search visible while collapsing the filters
  and tag groups behind a Search & filters button. An empty tag selection result
  does not substitute unfiltered examples.
- `GET /api/gallery/authors` — non-empty public bylines with their currently
  visible circuit counts, ranked by count and then author name. The clickable
  wall count uses this roll-up for its contributor leaderboard; expanding one
  author lazily reads that author's newest circuits from the ordinary feed and
  can switch the wall to the existing exact-author filter.
- `GET /api/gallery/<id>` — one public entry with its canonical
  `projectText`.
- `GET /api/gallery/<id>/preview.svg?v=<previewRevision>` — the
  server-rendered preview. A revision matching the stored SVG is immutable;
  unversioned, stale-revision, hidden, and missing responses are `no-store`.
- Which circuits a reader is looking at — the wall (`view`), the byline
  (`author`), the tags (`tags`), the text (`q`), and the two marks
  (`netlist`, `liked`) — is one preference and persists as one: it rides in
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
  plain editor; `/editor?example=<id>` opens a bundled example. The
  editor's Examples panel reads the same gallery list and opens entries
  through the same path as `/g/<id>`. While the gallery is empty or
  unreachable, the feed and the panel both fall back to the bundled
  Library examples, so neither surface is ever blank. The landing feed loads
  its renderer, symbol catalogue, and bundled Projects only after the remote
  feed has settled empty or unavailable; a populated Gallery never pays for
  those fallback-only dependencies.
- The editor Publish dialog offers an on-demand **Check Duplicate**
  action. It compares the currently visible Cell (not
  unconditionally the Project's root Cell) against every public Gallery
  entry in a Web Worker. Exact topology results ignore instance, Net, Cell and
  external-port names; model and parameter values; top-level port order; and
  whether an external rail was represented as a Port or a global power Net.
  Device classes, recognizable MOS/BJT polarity, terminal roles and actual
  connectivity remain structural evidence. This topology-only contract is
  intentionally broader than the administrator's exact electrical duplicate
  contract. Results retain all exact topology matches and at most five partial
  matches, ranked by verified structural coverage and parameter/model closeness
  as described in [Current-cell duplicate tasks](#current-cell-duplicate-tasks). The action is public and read-only: results
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

## Classification and visual attention

[The taxonomy](../../config/gallery-taxonomy.json) defines one tag vocabulary
covering circuit function, topology, implementation and architecture. A circuit
may carry up to twelve tags; catalog suggestions include unused tags so the
current library does not define the limits of classification. Legacy/custom
tags remain browsable. Visual group headings organize the tag list but are not
a second filtering system. Tag search and multi-selection live in the resizable
left sidebar; its preferred width is local to the browser.

Visual attention is independent of publication status and netlist extraction.
A suspected gap, unintended diagonal, overlap, clipping, unreadable label or
incomplete drawing may be flagged with a location-specific explanation. A
textbook abstraction, intentional open port or missing simulation model alone
is not a drawing defect. Visual review does not certify electrical correctness.

`attention=1` requires a session. Authors receive only their own pending entries;
administrators receive all pending entries. Attention details on both the feed
and individual entries are omitted for everyone else. The author/admin card
allows adding a note, marking the finding resolved and reopening it. None of
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
(≤300), and `tags` (array; normalized lowercase `[a-z0-9 +/-]`, ≤32
chars each, at most 12, deduplicated — `sanitizeGalleryTags` is the one
normalization for writes and filters), `projectText` ≤2 MiB. The Worker validates, stamps the canonical
serialization, renders the preview, and stores the entry as `public`.
Ordinary submissions count against a per-account limit of 100 per UTC day,
counted from that account's entries created that day that are not in the
recycle bin: deleting or withdrawing an entry returns its slot, restoring it
spends the slot again, and a rejected entry keeps it. Admin and moderator
sessions are exempt — the quota is anti-garbage protection, and curators are
the ones cleaning up.

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
name, and an update never re-attributes an entry.

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
- `empty-project` — fewer than 2 instances AND no substantial drawing
  (3+ drafting objects including a text); pure block diagrams pass.

Failures carry `message`, `count`, and up to five example labels.

## Moderation

Statuses: `public | rejected | recycled`. Publishing is direct, so
nothing new ever enters a queue; curation is post-publication. A
`rejected` or `recycled` entry never appears on a public surface (list,
detail, preview); its detail and preview answer only to a moderator or
the owning session.

`pending` is retired. Opening the storage promotes any leftover `pending` row
to `public` rather than stranding it. `rejected` is now the Owner's explicit
post-publication decision: its required reason remains visible to the
submitter until the Owner restores the entry.

- `GET /api/gallery/mine` — the calling session's entries with `status`,
  `rejectReason`, and the withdrawal time `recycledAt`.
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
the super-admin a direct Reject (`×`) control on every community tile, plus an
Owner menu for Edit and replace and Withdraw.
Reject opens a multi-select form with common reasons (`too ugly`,
`circuit incorrect`, `too simple`, `duplicate`) and an independent optional
note/other-reason field. The editor surfaces the full administration lifecycle
at `/moderation` (rejected entries, recycle bin, plus admin-only moderator
appointment) and the submitter's view at `/mine` (status chips, rejection
reason, owner-visible preview, open-in-editor). Every gallery page state wears
the shared site chrome.

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
recalculated; 200 answers `{id, status, previewRevision}`. The detail response
carries `ownerUserId` so the editor offers "update the opened entry" exactly
to owners and moderators.

Owner withdrawal: `POST /api/gallery/<id>/recycle` (same-origin) also
accepts the owning session — the entry moves to `recycled` and leaves
every public surface, exactly like an admin recycle. The owner brings a
voluntary withdrawal back with `POST /api/gallery/<id>/restore`, which
republishes it. An ordinary owner cannot restore or recycle an Owner-rejected
entry; it remains editable but hidden until the Owner restores it. The recycle
bin keeps each account's 25 most recently recycled entries: an older one is
removed permanently when that account next publishes or has an entry recycled,
and nothing expires by age. Legacy entries without an owning account are
exempt.

Owner deletion: `DELETE /api/gallery/<id>` (same-origin) also accepts the
owning session, which removes the entry with its saved versions and likes
permanently in one step, without withdrawing it first. `/mine` surfaces the
available actions: a two-step Withdraw, a Restore on voluntarily withdrawn
entries, and a confirmed Delete.

## Version history

Every content-replacing update (`PUT`, and Restore itself) first
snapshots the entry's previous state — name, author, description, tags,
canonical project text, preview — into `gallery_entry_versions`,
numbered per entry and capped at the newest 3 (older versions are pruned).
The live current state is separate and does not count toward those 3 snapshots.
Maintenance re-serialization does not snapshot (content-equivalent).
Authority: moderators (admin or moderator session) and the entry's
owning session:

- `GET /api/gallery/<id>/versions` — versions, newest first.
- `GET /api/gallery/<id>/versions/<versionId>/preview.svg`.
- `GET /api/gallery/<id>/versions/<versionId>/project` — canonical Project text;
  same owner/reviewer access, `no-store`, no submitter metadata.
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
merge graph, automatic publication, or private Shelf timeline. Expanding the cap
from 2 to 3 does not recover versions already pruned under the old policy.

## Accounts and sessions

`AuthDO` (one SQLite Durable Object singleton) owns users and sessions
behind `/api/auth/*`. Every provider is invisible until its Worker
secrets exist (`GET /api/auth/providers` reports `{github, google,
email}`); with no provider configured the site shows no sign-in UI at
all. No passwords ever exist. The browser holds a random session token in
an HttpOnly `SameSite=Lax` cookie (`icm_session`, 30-day TTL); the
database stores only SHA-256 hashes of session and login tokens.

- `GET /api/auth/github/start|callback` — GitHub OAuth code flow
  (secrets `GH_OAUTH_CLIENT_ID`/`GH_OAUTH_CLIENT_SECRET`; GitHub Actions
  forbids the `GITHUB_` prefix, hence the names). Callback URL:
  `<origin>/api/auth/github/callback`. Only a verified email is stored.
- `GET /api/auth/google/start|callback` — Google OAuth code flow
  (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`); an unverified Google email
  is treated as absent.
- `POST /api/auth/email/start` + `GET /api/auth/email/callback` — email
  magic links via Resend (`RESEND_API_KEY`, optional `AUTH_EMAIL_FROM`);
  links are single-use, expire in 15 minutes, and are limited to 5 per
  address per UTC day.
- `GET /api/auth/me` — `{user}` with `id`, `displayName`, `email`,
  `provider`, `role` (`user`/`moderator`), and the per-request `isAdmin` flag.
- `POST /api/auth/profile` — rename the caller's display name (trimmed,
  1–40 chars). `POST /api/auth/logout` ends the session. Both are
  same-origin gated like submissions.
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
- `GET /api/gallery/maintenance/schema-backup` — download a full-fidelity
  administrator backup of entries, saved versions, and private Cloud Projects.
- `GET /api/gallery/maintenance/automated-backup` — bounded Gallery-only pages
  for the dedicated read-only backup credential; no Cloud Projects or writes.
  See [off-site backups and recovery](../gallery-backup.md).
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
- `POST /api/gallery/maintenance/schema-restore` — atomically restore the three
  Project-bearing tables from a `schema-backup` payload supplied as
  `{ "backup": ... }`. Current retention is reapplied, so a legacy backup with
  more than 3 versions for an entry restores only its newest 3. This same-origin
  endpoint is an emergency rollback operation, not a general import surface.

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


## Current-cell duplicate tasks

The editor's duplicate scan captures the current Cell when started. Its worker
and results belong to the page session, independent of the Publish dialog.
Closing the dialog, editing the canvas or changing browser focus leaves it
running; a persistent notice exposes progress and completed results. Explicit
Cancel, a new check, or closing/reloading the browser page ends the old task.
This is not a server-persisted job and does not claim restart recovery.

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
sort by this score; only confirmed full netlist equality displays 100%. Keep
all exact topology matches and at most five partial matches. A similarity
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
