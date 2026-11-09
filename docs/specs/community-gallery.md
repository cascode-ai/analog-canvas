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

- Every Gallery read is open to anyone, signed in or not, with no count of
  who reads and no daily limit: list, search, tags, sources, authors, entry,
  Project, preview, the version history of public entries, statistics,
  reference images and `maintenance/netlists`. Writes (publish, update,
  likes, reference images, moderation) need a session, and so do the review
  routes, whose queue is a reviewer's own. Bundled editor examples are not
  Gallery content.
- "Public" means on the wall; admin, owner-only and write routes keep
  stricter checks. Previews are `private`; the edge cache holds immutable
  bytes; sessions are cached one minute per isolate.
- Every read of a public circuit's Project (`GET /api/gallery/<id>`, not
  `summary=1` or a bulk download's `download=1`) by anyone but its owner, repeats included, adds one to the
  circuit's opens for the day (`gallery_entry_opens`: entry, day, count;
  never who; not backed up), which only `owner-data` reports.

## Crawlers, AI and floods

- `robots.txt` and `llms.txt` (`worker/usage-policy.ts`) state the usage
  policy: every public circuit is free to read, download in bulk, mirror and
  use for any purpose, AI training included; circuits from reference datasets
  keep their dataset's license; clients stay under the flood limit.
  `robots.txt` admits every crawler with `Content-Signal: search=yes,
ai-train=yes` and `Disallow: /g/`. `llms.txt` names the download script and
  the list and entry API and no other resource while public Gallery
  documents are off; `sitemap.xml` stays 404. The page shell's `<noscript>`
  note and the signed-in Gallery's footnote show the one-line note
  (`apps/editor/src/usage-policy-note.ts`, its one source); the Agent's MCP
  Gallery tool and the HTTP Agent operation point to `llms.txt`.
- `scripts/gallery-download.mjs` (Node 18 or newer, no account or install)
  downloads every public circuit, oldest first, or those its filters select:
  `--source`, `--q`, `--tags`, `--author`, `--parts`, `--netlistable`, and
  `--url` with a wall link's filters (the link's `netlist` is the list's
  `netlistable`; a link needing a signed-in reader is refused). It writes
  `index.json` (the list's entries) and `entries/<id>.json`
  (`{entry, projectText}`, each written whole through a temporary file), at
  most 600 requests a minute. A rerun keeps a file only if it parses with its
  id and a non-empty `projectText`. It ends with downloaded, kept and failed
  counts and exits 1 when the list or any circuit failed; a `--source` that
  `GET /api/gallery/sources` does not list is refused.
- The wall's Download menu, the same for every reader and signed out too,
  saves the wall's current results (its own list query) or every public
  circuit as one `.zip`: `<id>.icproj.json` (the circuit's `projectText`) and
  `manifest.json` (`query`, `generatedAt`, `origin`, `usage`, `sources` with
  each dataset's license, `count`, `entries` with `id`, `name`, `author`,
  `source`, `previewRevision` and `file`, and `failed` with `id`, `name` and
  `reason`). Each choice states its count first; a run shows its progress
  and can be cancelled. It lists oldest first and reads at most 10 requests
  a second, 4 at once; network, 408, 429 (every reader waits its
  `Retry-After`) and 5xx failures are retried, circuits still failing are
  named, a list failure saves nothing and so do zero matches. The archive
  code loads on first use.
- No account is blocked for how it reads or writes; the account blocks and
  trap circuits of before 2026-11-09 are retired with their records.
- `/api/*` has a flood limit of 1200 requests a minute per client address
  (Workers rate limiting, `API_RATE_LIMITER`). Past it:
  `429 {"error":"too-many-requests","retryAfterSeconds":60,"usage":…}` with
  `Retry-After: 60`. It is neither a quota nor a daily allowance; clients
  show their daily-limit messages only for other `429`s. Uncounted: the
  Owner's backup and smoke credentials, requests with no client address, and
  `/api/arena/…`, which is forwarded unchanged. A failing limiter lets
  requests through.

## Public surface

### List

`GET /api/gallery` → `{entries, nextCursor}`, newest-first `public`
entries, keyset cursor, limit ≤60.

- The first page adds `total`, `filterCounts`, `authors` and, on the merged
  wall, `sources`. Cursor pages omit these statistics and run no wall-wide
  aggregate queries; callers retain the first page's statistics until a
  refresh or filter change.
- Filters, all applied before the first page's statistics:
  `author` (byline) or `owner` (account), `tags=a,b` (ANY), `netlistable=0|1`,
  `ai=1|0|dataset` (the AI mark; community circuits without it; reference
  datasets' circuits), `reference=0` (no reference image from its author; not
  offered on a dataset's wall), `liked=1` (signed out selects none),
  `parts=0-5,…` (ANY taxonomy size; unknown narrows nothing), `q`, authorized
  `attention`/`reason`.
- `order`: `newest` (default), `oldest`, `parts`/`fewest` (unknown counts
  last), `likes` (most first, then newest), or `random` with
  `seed=[a-z0-9]{1,16}`; the cursor is opaque. A page's ids are sorted off
  the covering metadata index and its tiles read off the card index, never
  the rows behind their Projects and previews.
- `filterCounts` gives each side (`netlistable`/`withoutNetlist`,
  `ai`/`human`/`datasets`), size (`componentRanges`) and reason
  (`attentionKinds`) with every other filter applied and its own left out, and
  `liked`, `attention` and `withoutReference` over the wall as filtered; the
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

- `GET /api/gallery/<id>` returns canonical `projectText`; `?summary=1`
  the entry alone (with `&netlist=spice`, its netlist alone). `?netlist=spice` adds
  `netlist: {format: "spice", text, instances: [{instanceId, line}]}` (each
  top-level device's first line, from 0, as the editor's Project Code locates
  it), or `{format: "spice", blocked}` with the error messages when the
  drawing does not extract. Folders only for testbench
  readers
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
- Every drawing shows Project Info floating over the canvas's bottom-right
  corner from the start: its name, a Gallery entry's contributor, its
  description and its reference picture. Closing it is
  remembered in this browser; Project Info in the status bar or the File menu
  opens it again. The picture is a
  pasted screenshot (⌘V / Ctrl+V, unless a text field or a circuit takes the
  paste), a dropped image or a chosen file, kept per tab for the page's life;
  a drawing opened from the Gallery starts from its entry's figure (a
  dataset's original or the reference image). The window moves by its title
  bar, resizes from any edge or corner, folds onto its bottom edge (its title
  bar rests where the window's foot was, and it opens upward again), keeps
  its place across tabs,
  and selects nothing on the page while it moves; the image zooms with the
  wheel and pans with a drag.
- Save keeps an unpublished drawing's name and description with it (Publish
  starts from them). For a community entry its owner, an admin or a moderator
  may change, Save writes them to the entry at once, and the image as its
  reference image when its owner or the Owner saves; a dataset's entry, or
  another's, is read-only and an image there stays on the page.

## On a phone

A phone (`(max-width: 700px) and (pointer: coarse)`,
`apps/editor/src/phone-viewing.ts`) browses the Gallery and views circuits;
drawing needs a computer or a tablet. `/g/<id>` shows the circuit's preview,
facts, tags, its SPICE netlist on request and its link; `/editor` says to draw
on a computer or a tablet and links the Gallery. Neither loads the editor or
preloads it. "Open the editor anyway" opens it for that tab
(`icm.phone-editor` in sessionStorage).

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
- One veto: drafting in the white sheet's own color (stroke or fill, every
  channel ≥ 0xF8; a pale tint shows and is allowed) only covers the drawing, as hand-made wire hops masked the
  wires they crossed. A submission or update holding one answers 400
  `drafting-cover` with a `message`; the edit engine refuses creating one or
  turning an object that color (an older one keeps its color and still moves).
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
- Statistics tab (account page; `view=mine` opens the account's own,
  `source=community|datasets` the Gallery's stores, all by default):
  - `GET /api/gallery/stats?source=all|community|datasets` (anyone):
    the chosen stores' merged `summary`, their 10 `topAuthors` and `sources`
    (`{key, name, circuits}` per store; a dataset that fails adds nothing).
    A dataset's circuits count in `datasets` and its weeks as `dataset`,
    neither people's nor AI's. A read never counts: each store answers the
    figures it keeps (`computedAt`, the oldest store's), which the scheduled
    pass counts again when an hour old or once a new or edited circuit is
    counted, and a store's Recount when it ends.
  - `GET /api/gallery/mine/stats` (401 signed out): the account's public
    circuits, newest first (`{id,name,createdAt,components,transistors,
aiGenerated,netlistable,simulatable}`; `simulatable`: it carries a
    testbench, the Sim badge after Netlist), its `summary`, and `rank`
    `{position, authors}` by public circuits (null with none); the account's
    view compares it with the community's.
  - `summary` counts public circuits: totals, `counted`, `ai`, `netlist`,
    likes received; `types` (each circuit's first tag of a circuit-function
    group, the boards' rule; null untagged), the 12 most used `tags`,
    `devices` by kind, `sizes` (the component ranges), `transistorBins`
    (0, 1–5, 6–10, 11–20, 21–50, 51+) and `weeks` (the last 16, Monday UTC,
    people and AI).
  - Devices are the drawn parts of the top Cell and of each called Cell, once
    per call: NMOS, PMOS, BJT, resistor, capacitor, inductor, diode, source,
    switch, block (a behavioral body), other; Ports, markers and undrawn parts
    are not counted. Transistors are its MOS and BJT parts. Kept beside their
    rule version, not backed up, counted by the scheduled pass (100 per
    store a tick), again after an edit, and on an account's own read of its
    still uncounted circuits; null while unreadable.
- Moderators: `users.role` (`user`/`moderator`), set by the super-admin via
  `POST /api/auth/users/role` `{email, role}` for every account with that
  verified email. Bin and maintenance stay admin-only. No bulk model fill.
- `POST /api/gallery/<id>/like` (same-origin) toggles one like per account.
  The Owner's accounts instead add a heart each press and take one back with
  `?take=1` (⌥-click), the last taking the like away; `likes` counts hearts.
- Withdraw is immediate and restorable; Reject takes preset reasons plus a note
  and, ticked by default, emails the author that reason (the account's address,
  else the one it published with; replies to the Owner; never an AI account);
  a failed email leaves the rejection standing and says so. Delete is one click (rejected entries are recycled first, since the server
  deletes only from the bin).

## Owner editing

- `PUT /api/gallery/<id>` (same-origin) updates content and metadata under
  submission rules: admins and moderators any entry, others their own. Anyone
  else fixes its drawing in place under the dataset rule (403 `fix-locked`
  `{contributions, needed}` below 10 public circuits): only the drawing
  changes, the fixer's Shelf draft stays unlinked, and anyone but the owner
  changing the drawing is an `edit` fix shown as "fixed by" ([Fixes](#fixes)).
  Byline and status are kept; the preview and marks are recomputed; 200
  `{id, status, previewRevision}`. `aiGenerated` sets the mark, omission keeps
  it (seat entries always keep it); the mark belongs to the entry, not a
  version. `ownerUserId` in the detail tells the editor who may update.
- `PATCH /api/gallery/<id>` (same-origin) `{name, description}` changes them
  alone under the same rules for its owner, admins and moderators (others 403,
  a dataset's entry 403 `dataset-read-only`): the drawing, preview and marks
  stay and the version before is kept. 200 `{id, name, description}`.
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
  maintenance re-serialization does not. Reading a public entry's history is
  open to anyone; a private one's, and restoring, to moderators and the
  owner.
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
  wall. A key the Gallery does not have answers
  `400 {"error":"unknown-source","sources":[…]}`, never the whole wall.
- Without `source`, the feed and tags answer the community wall with every
  dataset in it (#1697): one order across the stores (each row's cursor resumes
  them all), totals, `filterCounts` and tag counts summed, `sources` each
  dataset's share of `total`, `authors` the community's. `source=community`
  answers the community store alone: the duplicate and topology scans, and
  the wall while the reader leaves the datasets out (the contributor list's
  Datasets box unticked; kept with the other filters, in the link as
  `source=community`).
- List entries are requested only from stores included by the AI/human/dataset
  selection. The first page can read other stores' statistics for facets that
  ignore their own selection. Dataset statistics are cached by normalized
  filters, access scope and data revision; imports and netlist-mark
  recomputation invalidate them.
- Every write answers 403 `dataset-read-only` except a like, a review, a
  fix of its drawing and the Owner's imports; entries have no owner or AI
  mark (they count under `datasets`, not `human`) and show no owner tools;
  an opened copy publishes as a new community entry, or saves as a fix.
- Fixing a dataset's drawing: the Owner, admins, moderators and any account
  with at least 10 public circuits of its own may, from the editor's Save fix
  (`PUT /api/gallery/<id>` `{projectText}`, same-origin; 401; 403
  `fix-locked` `{contributions, needed}`). Only the drawing changes:
  name, description, tags and byline stay, a testbench the fixer did not send
  too. The fix is recorded as an `edit` fix ([Fixes](#fixes)); entries name
  their `edit` fixers, first first, as `fixedBy`, shown as "fixed by" beside
  the byline on tiles, the phone page and Review. `GET /api/gallery/quota`
  adds `fixes: {allowed, contributions, needed}`, the right to fix drawings not
  one's own (a dataset's or another account's).
- `GET /api/gallery/sources` → `{sources: [... , count]}`; readers see non-empty
  datasets, Owner accounts all.
- `POST /api/gallery/sources/<key>/entries` (the Owner's same-origin session,
  or `Authorization: Bearer <Owner token>` without the same-origin check; 401
  without either, 403 `owner-only` once the account is no longer an Owner
  account): `{entries: [{id, name, description?, tags?, projectText,
createdAt?}]}` (≤10), validated like submissions with the prefix
  (`invalid-id`); existing ids are replaced in place (version kept); per-entry
  `{id, ok, created, previewRevision}` or `{id, ok: false, error}`. Imports
  post from the CLI with `pnpm gallery:import-batches … --post`
  ([Batch drawing](../agent/batch-drawing.md)).
- Owner tokens (#1769): one labelled token per machine for that import and
  the comparison import below; no other route accepts one, and a token does
  not expire until it is revoked.
  The Owner's same-origin session (else 401/403) mints one
  with `POST /api/auth/owner-tokens {label}` → `{id, label, token, createdAt}`
  (`acot_…`, shown once; AuthDO keeps its SHA-256), lists them with
  `GET /api/auth/owner-tokens` → `{tokens: [{id, label, createdAt,
lastUsedAt}]}`, and revokes one with `DELETE /api/auth/owner-tokens/<id>`.

### Dataset comparisons

`/datasets`, Review's Statistics mode, sets each dataset circuit's original
figure beside our redraw, with the verdict of comparing both netlists; a
dataset's wall also links to it. It opens on its numbers: the totals, then
a board with one line a dataset (its name links its own page and paper; its
verdicts as one bar; circuits large, then errors and accuracy; most circuits
first, every dataset together at the foot) whose lines and verdict legend
narrow the page; then, a row each, why the datasets differ (their errors and
what they write differently, side by side) and circuit size; for the Owner alone, the
reviews; then the circuits, each with both netlists in the netlists view. The
page is English and reads like every other Gallery read (signed in; signed
out it asks to sign in).

- Only datasets whose figures we may show take comparisons: `comparisons:
true` in `config/gallery-sources.json` (AnalogGenie, MIT; CircuitThink,
  Apache-2.0; AMS-Net, GPL-3.0). Any other answers 404.
- A comparison belongs to an entry of its dataset's store and is listed only
  while that entry is public. Comparisons are re-importable derived data:
  not in the backups.
- Verdicts: `match` (netlists agree), `notation` (same circuit, written
  differently, such as an ideal source as a port), `error` (the dataset's
  netlist is wrong), `unclear` (the figure is ambiguous). Every verdict
  except `match` names a `category`; all of them are public. The pages name
  them Match, Written differently, Dataset error and Figure ambiguous, with
  no gloss: the board's legend is one row of name, count and share.
- A reader saves circuits for reference, privately: Save on a row or in the
  viewer, and the toolbar's Saved filter (`saved=1` in the address). `POST
/api/gallery/<id>/bookmark` (same-origin, signed in) toggles one →
  `{saved}`; `GET /api/gallery/sources/<key>/bookmarks` → `{ids}`, newest
  first. Bookmarks are not backed up. The viewer's pictures zoom and pan
  as Review's do.
- `GET /api/gallery/sources` adds `comparisons`, each dataset's listed count.
- `GET /api/gallery/sources/<key>/comparisons` → `{source, comparisons:
[{id, name, verdict, category, detail, reason, families, components,
previewRevision, figureRevision}]}`, every listed one; the page sorts,
  filters and counts them itself.
- `GET …/comparisons/<id>` → `{id, sourceNetlist}`: the dataset's own
  netlist. Our netlist is the entry's netlist alone
  (`GET /api/gallery/<id>?summary=1&netlist=spice`), which spends no open.
- `GET …/comparisons/<id>/figure[?v=<figureRevision>]` → the original figure
  (`image/png`, `image/jpeg` or `image/webp`), immutable when `v` names it.
- `POST …/comparisons` (Owner session or Owner token, as the entry import):
  `{comparisons: [{id, verdict, category?, detail?, reason?, families?,
sourceNetlist?, figure?: {type, data}}]}` (≤10; `data` base64, ≤512 KB
  decoded, its bytes the named type; `families` from MOS, BJT, Op-amp,
  Inductor, Diode, Switch). An existing id is replaced; a figure left out
  keeps the stored one. Per row `{id, ok}` or `{id, ok: false, error}`:
  `invalid-id`, `invalid-fields`, `invalid-figure`, `figure-required` (a new
  comparison without one). Imports post with `pnpm gallery:import-batches
--post-comparisons FILE --source KEY`.

### Reviews

`/review` shows one drawing at a time beside its reference (a dataset's
original figure, or a community circuit's reference image): the comment,
Like and ✕ Submit issue (no Pass button), the reasons (always shown; digits toggle
them, Esc clears them), and others' reviews, above the two pictures. Enter,
in the comment too (Shift+Enter starts a new line), sends what is there:
with a reason an issue, else a pass, the comment and boxes going with
either; → does the same for a drawing not yet reviewed or changed since,
so moving on passes it, and ← only steps back. Random (R) opens a drawing
of the list not yet reviewed. Submit issue is outlined in
red, half-filled under the pointer and solid when pressed or chosen (once a
reason is). Below the pictures, what comparing a dataset's two netlists found (a
callout in the verdict's tint: verdict and kind as tags, then the
difference, two lines unless opened); then each side's SPICE netlist at its full
length. The page
scrolls. A drag on a picture boxes a spot (numbered, removable, ≤12 per
review); a click opens both pictures over the window, each zoomed by the
wheel and panned by a drag, where B or Shift-drag boxes too. Pointing at
another review shows its boxes. Choosing a device's netlist line lights the
device the other side's netlist pairs with it, matched by what the devices
connect to (names differ; a reading aid rather than a check), and lights our
device in our drawing (by its instance, as the editor's Project Code finds
it). Fix in editor, on the drawing's title row, opens a tab; back in Review, a drawing changed there
shows its new version. Under the pictures, Auto check lists by kind what the layout
checks (`apps/editor/src/layout-check.ts`) find in our drawing: a step of at
most 20 in a wire between two runs; neighbours alike and turned alike whose
pins miss a shared row or column by at most 15; branch dots off level or out
of line by at most 15; structural twins (alike in all they connect to) at
most 40 apart in height but not level, or level but not mirrored; branch
dots of one net at most 10 apart; a net's wires closing a loop; wires of one
net over each other. Pointing at a kind boxes its findings on our picture; a
click keeps them. It is the Gallery's Review tab,
between Community gallery and My shelf; its pages keep that tab row, which
ends in the switch between Review (the default) and Statistics (`/datasets`,
look only). Its sidebar, in the wall sidebar's markup, starts with a search
over names, authors and ids (a pasted link or id, entered, opens its drawing
in its own store), then filters, each with the count choosing it would show:
Random (every store mixed, the default; choosing it again shuffles anew),
Community and each dataset with comparisons; With a reference figure (on by
default, off when Community is chosen, whose drawings rarely have one); My
drawings, when the list holds the reader's own (All mine, Flagged, Passed, No
reference; choosing one leaves the author and reference filters off, and the
bar above then counts what others' reviews of them come to); and Authors, most
drawings first (twelve, then the rest on request). A reviewer's own drawings
are in their list to look at, never to review. The address keeps them
(`?scope=<random|community|key>`, `&refs=0|1` when the reference filter differs
from its default, `&author=`, `&mine=<all|flagged|passed|no-reference>`;
`&id=` opens one drawing, turning off any filter that hides it). Every tile's ⋯ menu has Report an issue, a link to
the drawing in Review, for anyone signed in but its author. Both
sidebars fold to a strip at the left from a button at their top; each
browser remembers it. Statistics shows the Owner each person's reviews and
fixes over every store, and the open issues and disputes (each a link into
Review), exported as JSON.

- Any signed-in account reviews any public entry except its own, a dataset's
  too. A review is
  `pass`, or `issue` with flags from `wrong`, `netlist`, `loose`, `ugly`, `overlap`,
  `wiring`, `incomplete`, `simple`, `duplicate`, `other`; either may carry a
  comment (`note`, ≤1000). At most 300 reviews per account per store each UTC day
  (`daily-review-limit`).
- A review belongs to the entry's preview revision at that moment (`stale`
  when the reviewer's is older). Each reviewer's latest review of the current
  revision counts; an update leaves earlier reviews in the history, no
  longer counting. Rows are only added; the Owner marks an issue resolved.
  Reviews are backed up in the `reviews` scope ([backups](../gallery-backup.md)).
- Blind: a reviewer sees others' reviews of an entry only once their own of
  its current revision is in; the Owner always.
- `GET /api/gallery/review/<scope>/queue` (`scope`: a dataset with
  comparisons, or `community`) → `{entries: [{id, name, author,
previewRevision, components, reviews, likes, likedByViewer, mine, own?,
outcome?, comparison?, reference?, fixedBy?}]}`: every entry, unreviewed by
  the reader first, then fewest counting reviews; `mine` is the reader's
  latest review, `reviews` how many count. The reader's own entries carry
  `own: true` and, once reviewed, `outcome`: `flagged` while a counting issue
  is open, else `passed` when a counting review passes it; no one else's.
- `GET /api/gallery/<id>/reviews` → `{blind: true, revision}` or `{blind:
false, revision, current, history}`. `POST` `{revision, verdict, flags,
note, marks?}` → `{review}` (`marks`: ≤12 `{side: original|redraw, x, y,
w, h}` as fractions of that picture, else 400); 403 `own-entry`, 409
  `stale`, 429. `PATCH
…/reviews/<reviewId>` `{resolved: true}`: Owner only.
- `GET /api/gallery/review/<scope>/issues` (Owner) → `{issues, disputed}`:
  open issues counting now, and entries whose counting reviews both pass and
  hold an open issue. `…/people`: see Fixes.

### Fixes

- Every change of an entry's preview (its author's or the Owner's update, a
  dataset re-import, a dataset fix) adds a fix: who made it (the importing
  Owner for a re-import; `kind: edit` for a dataset fix), the revisions before
  and after, how many devices (instances),
  wires (routes and junctions) and labels (annotations and drafting text)
  were added, removed or changed, and the open issues of the replaced
  revision it answers. Fixes are only added; the `reviews` backup scope holds them.
- `GET /api/gallery/<id>/reviews`, unblinded, adds `fixes` (newest first).
  `GET /api/gallery/review/<scope>/people` → `{people: [{person, reviews,
passes, issues, fixes, circuits, changes, addressed}]}`: everything each
  person reviewed and fixed in that store.

### Reference images

- A community entry's owner or the Owner puts a reference image (what the
  drawing was drawn from, such as a textbook figure) from the tile's ⋯ menu:
  a dialog takes a pasted screenshot (⌘V / Ctrl+V or its Paste button), a
  dropped image or a chosen file, shows it, and uploads once they confirm
  they may share it (Review's empty Reference pane takes a pasted or dropped
  one the same way, for the Owner and the entry's author):
  `PUT /api/gallery/<id>/reference` `{image:
{type, data}, rights: true}` (PNG, JPEG or WebP, ≤512 KB decoded; the page
  redraws a larger file as WebP) → `{revision}`; `DELETE` removes it. Errors:
  403 `forbidden`, 400 `rights-required` or `invalid-image`. Dataset entries
  take none (404): their figures are comparisons.
- Publishing or updating from the editor (not a fix) with an image in the
  reference window offers it, unticked: ticked, saying they may share it,
  it is put the same way after the entry saves; a failure leaves the entry
  published and the notice says how to attach it.
- Anyone reads it: `GET …/reference[?v=<revision>]` (immutable when
  `v` names it). The wall marks such entries (`hasReference: true`, a
  Reference word mark on the tile). The community review queue names it (`reference:
{revision}`), lists such entries first, and `/review` sets it beside the
  drawing. The `reviews` backup scope holds them.

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
  versions, likes and Cloud Projects;
  ComponentLibraryDO its components; AnalogArena unlinks its Voter
  ([Account deletion](analog-arena.md#account-deletion)); AuthDO last removes
  sessions, Owner tokens, codes, counters and the row. A failing step answers 503 leaving the
  account signed in; steps are idempotent. Reply
  `{deleted: {circuits, likes, projects, components}}` in the single-region flow.
  [Regional deletion](regional-login.md#account-deletion) tracks cleanup after
  authority revocation.
- Super-admin is computed per request from `ADMIN_EMAILS` ∪ `ADMIN_EMAILS_EXTRA`
  (comma-separated, case-insensitive). The session cookie is the only write
  credential, except an Owner token on the dataset import
  ([Reference datasets](#reference-datasets)).

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
  and time recorded; `notify: true` emails the author and answers `emailed`),
  `/restore`; `DELETE /api/gallery/<id>` only from the bin
  (409 otherwise); `GET /api/gallery/recycled`, `/rejected`.
- `GET /api/gallery/maintenance/schema-backup?table=…`: bounded pages of the
  whole store; `table=inventory` for counts and revision; missing `table` is
  `table-required`. `GET …/automated-backup`: the same for read-only credentials
  (`GALLERY_BACKUP_TOKEN`; `scope=store` with `STORE_BACKUP_TOKEN`); see
  [off-site backups](../gallery-backup.md).
- `GET|POST /api/admin/recovery`: point-in-time recovery
  ([deployment](../deployment.md#point-in-time-recovery)).
- `GET /api/gallery/maintenance/netlists` (anyone): public entries in id order (`format=spice|spectre`,
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
  403 otherwise): public per-author counts, opens, total `components` and
  `transistors` (`transistorsPending`: circuits the scheduled pass has yet to
  count), AI and netlist marks, likes and newest time, and `mostOpened` (the 50
  circuits opened most, datasets' included, with `opens` and `opensLastWeek`);
  `author=<key>` counts that author's circuits, each with its `parts`,
  `transistors`, `simulatable` and the same opens, with their `summary` and
  `rank` as `mine/stats` gives them.
- `POST /api/gallery/owner-data/recount` (same-origin, Owner accounts):
  counts the devices of up to 200 public circuits of `store` (`community`,
  the default, or a dataset's key) after `after`, in ID order, whatever their
  stored count; the community's first, then each dataset holding any circuit.
  `{counted, remaining, store, next}`: `remaining` over every store still to
  come, resumed from `store` and `next` until `next` is null; an unknown
  store is 400. The Data tab's Recount runs it to the end.

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
- [Off-site backup retention](../gallery-backup.md) applies to snapshots
  containing rows of accounts deleted after capture.

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
