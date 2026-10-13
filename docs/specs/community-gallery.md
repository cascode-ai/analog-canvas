# Community Gallery

Status: `accepted`

Primary owners: `worker/gallery.ts` with its route modules,
`worker/gallery-do.ts` with the `worker/gallery-store*.ts` modules,
`worker/auth.ts`, `worker/auth-do.ts`, `apps/editor` landing feed

## Trust boundary

The only input is Project JSON passing `parseProject`. Stored canonical text and
preview SVG are derived server-side; client markup is never stored or served.
Previews come from `@icm/render-svg` (top document) as `image/svg+xml` with a
restrictive CSP.

## Reader access

- Every Gallery read (list, search, tags, authors, entry, Project, preview,
  history) needs a session or the read-only credential (`GALLERY_BACKUP_TOKEN`
  Bearer); otherwise `401 {"error":"sign-in-required"}`, `no-store`. The one
  exception (owner decision): `GET /api/gallery` with no query answers the first
  twelve public entries as `{entries, nextCursor: null, signedOut: true}` with no
  count, and those twelve serve previews. Only the landing wall uses it; other
  readers (Insert from Gallery, Agent reads) treat it as a sign-in request.
  Bundled editor examples are not Gallery content.
- "Public" means on the wall for signed-in readers; admin, owner-only and write
  routes keep stricter checks. Previews are `private`; the edge cache holds
  immutable bytes behind the reader check; sessions are cached one minute per
  isolate.
- Reading someone else's Project (`GET /api/gallery/<id>`: Open, Insert,
  duplicate Compare, Agent reads) spends one of 100 daily opens
  (`GALLERY_DAILY_OPEN_LIMIT`, UTC day, each circuit once). Past it:
  `429 {"error":"daily-open-limit","limit":100,"resetAt":…}` with `Retry-After`;
  Agents get `GALLERY_DAILY_LIMIT`. Uncounted: wall, search, tags, previews,
  `?summary=1`, own circuits, curators, AI seats, the read-only credential. The
  scheduled pass drops finished days.
- Every allowed read, repeats included, adds one to the circuit's opens for
  the day (`gallery_entry_opens`: entry, day, count; never who; not backed
  up), which only `owner-data` reports.

## Public surface

### List

`GET /api/gallery` → `{entries, nextCursor, total}`, newest-first `public`
entries, keyset cursor, limit ≤60.

- Filters, all before the cursor so `total` (repeated per page) matches:
  `author` (byline) or `owner` (account), `tags=a,b` (ANY), `netlistable=0|1`,
  `ai=1|0|dataset` (the AI mark; community circuits without it; reference
  datasets' circuits), `liked=1` (signed out selects none), `parts=0-5,…` (ANY
  taxonomy size; unknown narrows nothing), `q`, authorized `attention`/`reason`.
- `order`: `newest` (default), `oldest`, `parts`/`fewest` (unknown counts
  last), `name`/`name-desc` (case-insensitive, then id), or `random` with
  `seed=[a-z0-9]{1,16}`; the cursor is opaque. A page's ids are sorted off
  the covering metadata index and only its rows are read.
- `filterCounts` gives each side (`netlistable`/`withoutNetlist`,
  `ai`/`human`/`datasets`), size (`componentRanges`) and reason
  (`attentionKinds`) with every other filter applied and its own left out; the
  `authors` aggregate counts before pagination. Rejected and recycled entries
  never appear.
- Entry fields: `previewRevision`, `previewWidth`/`previewHeight` (may be absent;
  clients keep a fallback), `netlistable`, `aiGenerated: true` (publisher's word;
  else omitted), `simVerified: true` (allowed viewers only), `componentCount`
  (top-Cell parts, a subcircuit once; not Ports, markers, drafting or undrawn
  Instances), `likes`, `likedByViewer`.
- `netlistable` is `designExtractsNetlist` at the editor's export standard:
  missing models leave it; a missing MOS body, unresolved required pin or
  `DEAD_END_NET` ([netlist export](netlist-export.md#unfinished-drawings))
  clears it. It and `componentCount` are recomputed on every write and, by
  stored rule version, by the scheduled pass.

### Search, tags and authors

- `q` matches name, byline, description and tags (never Project or preview)
  with `apps/editor/src/gallery-search.ts`: case-insensitive containment, else
  each word within one Latin-letter edit (words under four letters exact). It
  narrows before cursor and counts and is echoed as `search`; a response without
  it did not search, and clients fall back to local narrowing.
- `GET /api/gallery/tags`: tags with counts under every filter except tags.
  Family groups are presentation only; unknown tags stay under Custom & legacy.
  `GET /api/gallery/authors`: the unfiltered ranking.
- Filter preference (`view`, `author`, `tags`, `netlist`, `liked`) lives in the
  URL and `icm.gallery-filters.v1`; a link naming any narrowing replaces it. `q`
  lives only in the URL and any reload clears it.

### Entry and preview

- `GET /api/gallery/<id>` returns canonical `projectText` (one daily open);
  `?summary=1` is free. Folders only for testbench readers
  ([Testbench privacy](#testbench-privacy)).
- `GET /api/gallery/<id>/preview.svg?v=<previewRevision>&render=formula-label-v5`
  is immutable when the revision matches; unversioned, stale, hidden and missing
  are `no-store`. Old formula artwork re-renders from the stored Project on read
  without rewriting data.

### Editor routes

- `/` is the feed; `/g/<id>` opens an entry through the protocol boundary;
  `/editor?example=<id>` is loopback-only. Insert (G) reads the same list.
- Hosted Production/preview always uses Gallery, never bundled examples;
  loopback hosts (`localhost`, `127.0.0.1`, `[::1]`) use Examples and request no
  Gallery data; `dev:replica` uses its mirror.

## Classification and attention

- [The taxonomy](../../config/gallery-taxonomy.json) defines one tag vocabulary;
  ≤12 tags per circuit; legacy/custom tags stay browsable.
- Attention is independent of status. Each finding has one `issueKinds` reason
  and location: netlist (global VDD, undefined component, component without
  netlist), drawing (wiring break, diagonal, overlap, clipping, unreadable label,
  incomplete), or `other`. Textbook abstractions, open ports and missing models
  are not defects; review never certifies correctness.
- `attention=1` needs a session: authors see their own pending entries,
  administrators all. Details are hidden from everyone else. Review actions
  never unpublish or change Project, name, owner, likes, preview or statistics.
- `PATCH /api/gallery/<id>/curation` (same-origin; author or administrator):
  `tags`, `attention` (`null` or `{status: "needs-attention" | "resolved",
  issues: [{kind, detail}]}`), `expectedPreviewRevision`,
  `expectedCurationRevision`. Empty pending findings are invalid; stale
  revisions answer 409. Metadata changes snapshot a version; curation is backed up.
- [`curate-gallery.mjs`](../../scripts/curate-gallery.mjs) validates bulk audits
  without writing; applying needs an origin, a session cookie file and a
  before/after receipt, and skips changed entries.

## Publishing

- `POST /api/gallery/submissions` (same-origin) publishes immediately as
  `public`: `name` (trimmed, ≤120), `description` (≤1000), `tags` (lowercase
  `[a-z0-9 +/-]`, ≤32 chars, ≤12, deduplicated; `sanitizeGalleryTags` is the one
  normalization), `projectText` (≤2 MiB), optional boolean `aiGenerated` (else
  `invalid-fields`). Answers 201 `{id, status, previewRevision}`.
- A session is the whole gate; quality advice never vetoes. `author` is the
  session display name; updates never re-attribute except AI take-over.
- AI mark: the dialog pre-ticks it only for a Project from a marked entry and
  notes Agent work in that tab (remembered per tab, not in the Project); the
  publisher decides. Agent API `publish-gallery-entry`/`update-gallery-entry`
  (MCP `gallery_circuits`, scope `gallery.publish`) always sets it.
- Quota: 100 per UTC day (500 for AI seats), counting the day's entries outside
  the bin (withdraw/delete frees, restore spends, rejected keeps). Admins and
  moderators are exempt. `GET /api/gallery/quota` → `{limit, used, remaining,
  resetsAt, exempt}`. Updates spend nothing.
- Entries record `owner_user_id`, `submitter_email`, `submitter_provider`; email
  and provider go only to moderators and admins.

### Publication binding

- After first publication Publish defaults to `PUT /api/gallery/<id>`. Shelf
  drafts persist the link as private metadata `gallery_entry_id` (never replacing
  private content); a lookup failure blocks with Retry instead of creating a new
  entry.
- Bound requests send `cloudProjectId` and `expectedGalleryEntryId`; the Durable
  Object scopes the draft to the account, answers 409 on a changed link, and
  commits publication and link atomically without saving the draft.
- **Use an existing Gallery publication…** retargets an unlinked saved draft,
  keeping id, byline, likes and history and retiring the old link; nothing
  matches automatically. **Publish as a new entry** leaves the old entry.

## Submission quality advice

`evaluateSubmissionGates` (`@icm/derived`) is informational only; the Worker
enforces no ERC veto. Failures carry `message`, `count` and ≤5 example labels.

- `erc-errors`: any ERC error.
- `floating-endpoints`: `ERC_UNCONNECTED_PIN`, `ERC_BULK_UNRESOLVED`,
  `ERC_FLOATING_GATE` (not `ERC_UNDRIVEN_GATE_NET`).
- `empty-project`: fewer than 2 instances and fewer than 3 drafting objects
  including a text.

## Moderation

- Statuses `public | rejected | recycled`; curation is post-publication. Hidden
  entries answer only moderators, the owner and, for seat entries, every AI seat.
  Leftover `pending` rows become `public`. `rejected` is the Owner's decision
  with a reason shown to the submitter.
- `GET /api/gallery/mine`: own entries with `status`, `rejectReason`,
  `recycledAt`, `likes`, `withdrawnByCurator`; `scope=ai-seats` for AI seats
  (others 403 `ai-accounts-only`; unknown 400 `invalid-scope`).
- Moderators: `users.role` (`user`/`moderator`), set by the super-admin via
  `POST /api/auth/users/role` `{email, role}` for every account with that
  verified email. Bin and maintenance stay admin-only. No bulk model fill.
- `POST /api/gallery/<id>/like` (same-origin) toggles one like per account.
- Withdraw is immediate and restorable; Reject takes preset reasons plus a note;
  Delete is one click (rejected entries are recycled first, since the server
  deletes only from the bin).

## Owner editing

- `PUT /api/gallery/<id>` (same-origin) updates content and metadata under
  submission rules: admins and moderators any entry, others their own (403).
  Byline and status are kept; the preview and marks are recomputed; 200
  `{id, status, previewRevision}`. `aiGenerated` sets the mark, omission keeps
  it (seat entries always keep it); the mark belongs to the entry, not a
  version. `ownerUserId` in the detail tells the editor who may update.
- Take-over: an AI seat updating another seat's entry with `takeOver: true` moves
  owner and byline (200 adds `{ownerUserId, author}`), keeping id, likes, tags,
  mark and status; earlier versions keep their account. Involving a person is
  403 `take-over-forbidden`.
- AI seats read each other's hidden entries like owners, but recycle, restore,
  delete, version restore and review keep owner/admin rules. Seat identity is the
  server's answer (provider `ai` and a listed seat).
- Owners may recycle and restore voluntary withdrawals, but not Owner-rejected
  entries or ones the Owner withdrew (`withdrawnByCurator`, 409
  `invalid-status`). Owners may `DELETE` directly (entry, versions, likes).
- The bin keeps each account's 25 newest recycled entries (older ones go when the
  account next publishes or recycles); ownerless legacy entries and Owner
  rejections or withdrawals are exempt.

## Version history

- Every content-replacing update (`PUT`, restore) snapshots name, author,
  description, tags, Project text, testbench and preview into
  `gallery_entry_versions`, keeping the newest 3 beside the live state;
  maintenance re-serialization does not. Access: moderators and the owner.
- `GET …/versions` (newest first), `…/versions/<versionId>/preview.svg`,
  `…/versions/<versionId>/project` (`no-store`, folders only for testbench
  readers), `POST …/versions/<versionId>/restore` (snapshots first; keeps status
  and byline).
- Compare matches by stable Cell and Instance ids (delete/recreate is
  add/remove), comparing parameters, placement, labels, definitions and
  membership but not generated Net ids or provenance. Branch opens an
  independent Project with no binding. Private history:
  [save history](persistence-and-recovery.md#private-save-history).

## Testbench privacy

A circuit's testbench (`simulationFolders`) is its author's (owner decision).

- Readers (`readsTestbench`): Owner accounts (`OWNER_ACCOUNT_IDS`), the entry's
  owner, AI seats reading seat entries; not curators or the read-only
  credential. Everyone else gets `"simulationFolders": []`. Previews, marks,
  counts and netlist reads use only the drawing.
- Every write (publish, update, take-over, version restore, dataset import)
  stores `project_text` with folders emptied and the folders in the row's
  `testbench_text`, so the testbench follows the row through history, retention,
  deletion and backups; recombining is byte-identical.
- A reader-writer replaces the testbench; a non-reader (curator Edit and
  replace) leaves it and its submitted folders are ignored; take-over adopts the
  redraw's; restore brings back the version's.
- `POST /api/gallery/maintenance/testbench-privacy` (administrator, same-origin)
  migrates legacy in-text folders, but only after a backup Release
  (`{"backup": "store-<time>Z-<run>-<attempt>"}` from
  `node scripts/gallery-private-snapshot.mjs --store`; >24 h old is 400
  `invalid-backup`; earlier `apply` is 409 `backup-required`). Answers `{backup,
  applied, moved, remaining, legacy, failures}`; the scheduled pass moves 25 rows
  a tick and `{"apply": true, "limit": n}` (n ≤ 200) a batch. Rows must
  round-trip byte-identically with only the testbench changed, else stay in
  `failures`; pre-schema-42 `legacy` rows move after `schema-current`.

## Simulation checks

The Sim mark says the server re-ran the testbench on the hosted simulator, it
completed, and every stated Spec passed.

- Every folder must complete, at least one Spec must be stated, and every stated
  Spec (including malformed ones) must pass. Statuses: `error` (unpreparable or
  incomplete), `fail` (missed or unjudgeable Spec, `no-specs`), `no-testbench`,
  `pass`. Only `pass` under the current rule version earns the mark.
- Only the Owner starts checks: `POST /api/gallery/simulation-checks` (Owner
  account, same-origin, else 401/403 `owner-only`) queues `{"ids": [...]}` (≤500)
  or `{"all": true}` and answers 202 `{queued, noTestbench, missing, waiting}`;
  `GET` reads `{waiting, current, counts, results}`.
- The five-minute pass works the queue first-in first, one folder at a time, for
  ≤4 minutes: `prepareFolderExecutionInput`, a managed run as
  `gallery-simulation-check` (one waiting, one running), `executionSpecReport`,
  log only, ≤8 MiB. A busy simulator keeps the folder at the head and re-asks the
  same run; a run ending without a result is `error`; an erring or failing folder
  ends the check.
- `simulation_check_json` on the entry holds `{status, checkedAt, rule,
  simulator, reason?, folders}` with per-Spec condition, value, unit and
  judgment. Any Project or testbench change clears it; a mid-run change
  restarts. The queue is not backed up.
- `GET /api/gallery/<id>/simulation-check` answers `{check, waiting}` to
  testbench readers, 404 to others. `simVerified` goes to the same readers until
  `publicFrom` in [config/gallery-sim.json](../../config/gallery-sim.json) (null:
  not yet), then to all; details stay private. Agent Gallery reads omit it.

## Reference datasets

`config/gallery-sources.json` lists each dataset: `key`, id `prefix`, `name`,
`byline`, `license`, `homepage`, `paper`.

- Each dataset has its own Durable Object `source:<key>` (community: `gallery`).
  Ids are `<prefix>-<id>` (`ag-308`); community ids never contain a hyphen;
  routes dispatch by id; feed and tags take `source=<key>` for one dataset's
  wall.
- Without `source`, the feed and tags answer the community wall with every
  dataset in it (#1697): one order across the stores (each row's cursor resumes
  them all), totals, `filterCounts` and tag counts summed, `sources` each
  dataset's share of `total`, `authors` the community's. `source=community`
  answers the community store alone (the duplicate and topology scans).
- Every write answers 403 `dataset-read-only`; entries have no owner or AI mark
  (they count under `datasets`, not `human`) and show no like or owner tools;
  an opened copy publishes as a new community entry.
- `GET /api/gallery/sources` → `{sources: [... , count]}`; readers see non-empty
  datasets, Owner accounts all.
- `POST /api/gallery/sources/<key>/entries` (same-origin, Owner account, else 403
  `owner-only`): `{entries: [{id, name, description?, tags?, projectText,
  createdAt?}]}` (≤10), validated like submissions with the prefix
  (`invalid-id`); existing ids are replaced in place (version kept); per-entry
  `{id, ok, created, previewRevision}` or `{id, ok: false, error}`. It runs from
  the Owner's browser, so no new secret exists.

## Accounts and sessions

`AuthDO` (one SQLite Durable Object) owns users and sessions behind
`/api/auth/*`. Providers appear only with their secrets
(`GET /api/auth/providers` → `{github, google, email}`). No passwords; the token
is in HttpOnly `SameSite=Lax` `icm_session` (30 days); only SHA-256 hashes of
tokens and codes are stored.

- GitHub OAuth (`GH_OAUTH_CLIENT_ID`/`GH_OAUTH_CLIENT_SECRET`, since Actions
  forbids `GITHUB_`) and Google OAuth (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`)
  store only verified email: `GET /api/auth/<github|google>/start|callback`,
  callback URL `<origin>/api/auth/<provider>/callback`. OAuth `state` is
  double-submitted via a short-lived cookie; failures redirect to
  `/?auth=failed`. Providers are distinct accounts.
- Email codes via Resend (`RESEND_API_KEY`, optional `AUTH_EMAIL_FROM`):
  `POST /api/auth/email/start` `{email}`, `/verify` `{email, code}`; six digits,
  single use, 10 minutes, 5 wrong guesses, 5 sends per address per UTC day.
- `GET /api/auth/me` → `{user}`: `id`, `displayName`, `email`, `provider`,
  `role`, per-request `isAdmin`, AI `seat`, `switchedFrom`, `isOwner`.
- `POST /api/auth/profile` (1–40 chars) and `/logout` are same-origin.
- `POST /api/auth/account/delete` `{confirm: "delete-account"}` (same-origin):
  an AI seat gets 409 `ai-account`. GalleryDO deletes the account's circuits,
  versions, likes, daily-open records and Cloud Projects;
  ComponentLibraryDO its components; AnalogArena unlinks its Voter
  ([Account deletion](analog-arena.md#account-deletion)); AuthDO last removes
  sessions, codes, counters and the row. A failing step answers 503 leaving the
  account signed in; steps are idempotent. Reply
  `{deleted: {circuits, likes, projects, components}}`.
- Super-admin is computed per request from `ADMIN_EMAILS` ∪ `ADMIN_EMAILS_EXTRA`
  (comma-separated, case-insensitive). The session cookie is the only write
  credential.

### AI seats

- Seats are listed in `AI_SEATS` (`worker/auth-do.ts`); a seat has provider `ai`,
  role `user`, no email and no sign-in path. On start AuthDO creates seats or
  converts the account an Agent published under while it keeps its
  `formerName`, and restores seat names; GalleryDO restores seat bylines and
  marks. Seats cannot rename (409) and are never reused.
- A one-time migration moved GPT-6 Astra entries after 2026-10-07 21:50 UTC to
  `ai-designer-3`; restoring an older backup re-applies it.
- `GET /api/auth/ai-accounts` (super-admin); `POST …/switch {userId}`
  (same-origin) gives a 30-day seat session and parks a super-admin session in
  HttpOnly `icm_owner_session` (path `/api/auth`); `POST …/return` restores it
  (signing out if none). Sign-out clears both.
- Seat entries always carry the AI mark; seats publish 500 a day, opens are
  uncounted, and statistics count people only.

## Administration

Admin routes need a super-admin session (`GALLERY_ADMIN_TOKEN` is retired),
else 401.

- `POST /api/gallery/<id>/recycle`, `/reject` (required `{reason}` ≤500, reviewer
  and time recorded), `/restore`; `DELETE /api/gallery/<id>` only from the bin
  (409 otherwise); `GET /api/gallery/recycled`, `/rejected`.
- `GET /api/gallery/maintenance/schema-backup?table=…`: bounded pages of the
  whole store; `table=inventory` for counts and revision; missing `table` is
  `table-required`. `GET …/automated-backup`: the same for read-only credentials
  (`GALLERY_BACKUP_TOKEN`; `scope=store` with `STORE_BACKUP_TOKEN`); see
  [off-site backups](../gallery-backup.md).
- `GET|POST /api/admin/recovery`: point-in-time recovery
  ([deployment](../deployment.md#point-in-time-recovery)).
- `GET /api/gallery/maintenance/netlists` (administrator or read-only
  credential): public entries in id order (`format=spice|spectre`,
  `limit=1..200`, `after`, or `id`) with metadata, stored mark, netlist (or
  `null`) and diagnostics; pages end at 8,000,000 characters of Project Code.
- `POST …/schema-current`: `{apply: false}` validates; `{apply: true}` converges
  every Project to `CURRENT_PROJECT_FILE_VERSION` only if all are valid.
- `POST …/netlist-badges` (`{limit?: 1..200}` → `{scanned, changed, unreadable,
  ruleVersion, remaining}`) re-answers marks behind `NETLIST_MARK_RULE_VERSION`
  (bump it whenever stored answers can go stale); unreadable Projects keep their
  mark and are stamped; it also runs from `triggers.crons`.
- `POST …/label-looks` (same-origin, ≤20 ids; fields below) brings labels to
  [names and labels](names-and-labels.md) standards. Dry runs report labels,
  Project SHA-256 and electrical/netlist invariance; `apply` needs the SHA-256
  (`stale`), refuses electrical change, and compare-and-sets
  only Project Code and preview. `nudges` move standard-look labels ≤16 × 12
  units; `keep` exempts labels; colliding labels keep their look
  (`clearanceKept`); `legacyLooks` applies only to content saved before
  2026-09-24. Non-public rows are `not-public`.
- `POST …/testbench-privacy`: see [Testbench privacy](#testbench-privacy).
- `POST …/schema-restore` (same-origin, emergency): atomically restores the
  Project-bearing tables from `{backup}` with 3-version retention, within one
  100 MB request; whole-store rollback is point-in-time recovery.
- `GET /api/gallery/owner-data` (Owner accounts; 401 signed out or credential,
  403 otherwise): public per-author counts, opens, average parts, AI and
  netlist marks, likes and newest time, and `mostOpened` (the 50 circuits
  opened most, datasets' included, with `opens` and `opensLastWeek`);
  `author=<key>` lists that author's circuits with the same opens.

`label-looks` fields (body, then each of the reply's `results`):

| Field                                    | Meaning                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `ids`, `table`                           | entry ids (`galleryEntries`, default) or version ids (`galleryEntryVersions`) |
| `apply`, `expected`                      | `apply: true` writes; `expected` maps each id to its dry-run `sha`            |
| `nudges`, `keep`, `legacyLooks`          | `{id: [{label, dx, dy}]}`, `{id: [label]}`, `true`                            |
| `id`, `status`, `savedAt`, `entryId`     | the row read (`entryId` for versions)                                         |
| `sha`, `labels`, `clearanceKept`, `kept` | Project SHA-256 and the restyled, colliding and kept labels                   |
| `legacyWithheld`                         | `legacyLooks` asked, but the content is not older than the cutoff             |
| `changed`, `applied`, `skipped`          | outcome; `skipped` names why (`stale`, `electrical-change`, …)                |

## Retention and privacy

- Entries are public, published then moderated; the bin is the takedown.
- The submitting account is the only submitter identity: no IP hash or separate
  counter; email and provider only for moderators and admins.
- Account deletion removes its entries; `/privacy` is readable signed out.
- Off-site backups (Gallery and whole-store, including Cloud Projects) are
  private Releases never auto-deleted and read only for recovery
  ([off-site backups](../gallery-backup.md)); they keep rows of later-deleted
  accounts.

## Current-cell duplicate tasks

- **Check Duplicate** compares the visible Cell with every public entry,
  ignoring names, values, port order and Port vs global rail; device classes,
  polarity, terminal roles and connectivity count. It mutates nothing and is
  broader than the administrator's exact electrical contract, which is
  unchanged.
- Hosted: one private durable task per signed-in account
  ([TopologyTaskDO](../../worker/topology-task.ts)); signed out none starts
  (`401 sign-in-required`). Server alarms advance it; the browser polls
  ([task client](../../apps/editor/src/features/editor-shell/gallery-topology-task.ts)).
  Edits and closing never cancel; results resume within seven days; only Cancel
  stops; a second start is refused; request identity makes retries safe. Results
  for another Cell are not shown; edited-Cell results are marked historical.
- Results: ≤20 matches within 8 MiB, omissions explicit, never another owner's
  snapshot. Compare on canvas is an ordinary read (spends an open) of frozen
  Projects and refuses a circuit changed since.
- Without the hosted endpoint a page-session Web Worker runs it (lost on reload).
- Partial matches need a bounded injective device/net mapping (common nets stay
  common; two-pin passives may reverse, transistor and black-box roles not).
  Structure = matched-device Dice coverage × (0.8 + 0.2 × neighborhood); exact
  topology is 1. Parameters: mean of `min(|a|,|b|)/max(|a|,|b|)` over names on
  either side (missing or opposite sign 0; expressions need literal equality),
  80%, plus model/invocation identity 20%. Overall = structure × (0.85 + 0.15 ×
  parameter/model). Only confirmed full netlist equality shows 100%. Every exact
  match plus ≤3 partial matches ≥50% are returned, the rest counted.
- Matching is bounded; exhaustion is visible and only verified pairs show.
  Algorithm tests: `packages/netlist/src/topology-correspondence.test.ts`.
