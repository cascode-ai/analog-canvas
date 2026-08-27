# Community Gallery

Status: `accepted`

Primary owners: `worker/gallery.ts`, `worker/auth.ts`, `apps/editor`
landing feed

## Trust boundary

The only accepted input is Project JSON that passes the strict protocol
boundary (`parseProject`; the rolling previous-version upgrade applies).
Everything stored and served — canonical Project text and the preview SVG —
is derived server-side from that validated model. Client-supplied markup is
never stored, echoed, or served. Previews are rendered by `@icm/render-svg`
from the entry's top document and served as `image/svg+xml` with a
restrictive content-security-policy.

## Public surface

- `GET /api/gallery` — newest-first `public` entries
  (`{entries, nextCursor}`; keyset cursor; limit clamps at 60; optional
  `author` filters to that exact byline and optional `tags=a,b` to
  entries carrying ANY listed tag, both ahead of pagination). Rejected and
  recycled entries never appear. Every entry includes the content-derived
  `previewRevision` used by its thumbnail URL.
- `GET /api/gallery/tags` — distinct public tags with counts, most
  frequent first (feeds the multi-select menu).
- `GET /api/gallery/<id>` — one public entry with its canonical
  `projectText`.
- `GET /api/gallery/<id>/preview.svg?v=<previewRevision>` — the
  server-rendered preview. A revision matching the stored SVG is immutable;
  unversioned, stale-revision, hidden, and missing responses are `no-store`.
- `/` serves the full-screen feed; each tile links to `/g/<id>`, which the
  editor opens through the ordinary protocol boundary. `/editor` is the
  plain editor; `/editor?example=<id>` opens a bundled example. The
  editor's Examples panel reads the same gallery list and opens entries
  through the same path as `/g/<id>`. While the gallery is empty or
  unreachable, the feed and the panel both fall back to the bundled
  Library examples, so neither surface is ever blank.

## Publishing

`POST /api/gallery/submissions` (same-origin) publishes immediately with:
trimmed `name` (required, ≤120), optional `author` (≤40), `description`
(≤300), and `tags` (array; normalized lowercase `[a-z0-9 +/-]`, ≤24
chars each, at most 5, deduplicated — `sanitizeGalleryTags` is the one
normalization for writes and filters), `projectText` ≤2 MiB. The Worker validates, stamps the canonical
serialization, renders the preview, and stores the entry as `public`.
Ordinary submissions count against a per-submitter (hashed IP) limit of
10 per UTC day; admin and moderator sessions are exempt — the quota is
anti-garbage protection, and curators are the ones cleaning up.

Publishing authority: a signed-in session is the whole gate. Every
signed-in account publishes directly as `public`; an ordinary member
passes the quality gates below first, and a moderator curates past them.
Anonymous upload stays impossible — an entry has to be attributable to
the account that published it. A successful submission answers 201
`{id, status, previewRevision}` with `status` always `public`. The editor
starts a non-blocking fetch of that revision immediately, then notifies other
same-origin tabs so an already-open Gallery switches URLs and refreshes its
no-store metadata without waiting for a cache TTL.

The byline is not a request field: the Worker takes `author` from the
session's display name, so one account cannot publish under another's
name, and an update never re-attributes an entry.

Every entry records the submitting account: `owner_user_id` plus the
`submitter_email` and `submitter_provider` read from the session at
submission time, so an entry stays traceable to the identity that
published it even if the account is later renamed. These two fields are
traceability data, not feed data — the detail route returns them only to
a moderator or admin, never on a public surface.

## Submission quality gates

`evaluateSubmissionGates` in `@icm/derived` is the single evaluator; the
worker enforces it (422 `{error: "quality-gate", failures}`) and the
publish dialog runs the same function live, so the API can never accept
what the UI refuses. Gates apply only to ordinary users — the bearer and
admin/moderator sessions bypass them (failures still shown as
informational in the dialog). Failure codes:

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

- `GET /api/gallery/mine` — the calling session's entries with `status`
  and `rejectReason`.
- Moderators: `users.role` (`user`/`moderator`); the super-admin
  appoints by email via `POST /api/auth/users/role` `{email, role}`,
  which applies to every account carrying that verified email. A
  moderator curates and bypasses the quality gates; the recycle bin and
  maintenance stay admin-only.

The Gallery feed gives the super-admin direct Like and Reject (`×`) controls
on every community tile, plus an Owner menu for Edit and replace and Withdraw.
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
and passes the quality gates (422). Either way the entry keeps its
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
entry; it remains editable but hidden until the Owner restores it. `/mine`
surfaces the available actions: a two-step Withdraw and a Restore on
voluntarily withdrawn entries.

## Version history

Every content-replacing update (`PUT`, and Restore itself) first
snapshots the entry's previous state — name, author, description, tags,
canonical project text, preview — into `gallery_entry_versions`,
numbered per entry and capped at the newest 2 (older versions are pruned).
The live current state is separate and does not count toward those 2 snapshots.
Maintenance re-serialization does not snapshot (content-equivalent).
Authority: moderators (admin or moderator session) and the entry's
owning session:

- `GET /api/gallery/<id>/versions` — versions, newest first.
- `GET /api/gallery/<id>/versions/<versionId>/preview.svg`.
- `POST /api/gallery/<id>/versions/<versionId>/restore` — snapshots the
  current state, then adopts the version's content and metadata, so
  restores are themselves reversible. A restore keeps the entry's status
  and byline.

The editor surfaces this as "Version history…" inside the publish
dialog's update mode (moderators and owners) and as a per-entry
"Version history" action on `/mine`.

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
  `provider`, and the per-request `isAdmin` flag.
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
- `DELETE /api/gallery/<id>` — permanent, and only for entries already in
  the bin (`409` otherwise).
- `GET /api/gallery/recycled` — the bin.
- `GET /api/gallery/rejected` — rejected entries and their reasons.
- `GET /api/gallery/maintenance/schema-backup` — download a full-fidelity
  administrator backup of entries, saved versions, and workspace slots.
- `POST /api/gallery/maintenance/schema-current` — validate or transactionally
  converge every stored Project to the current schema 26. The request body is
  `{ "apply": false }` for a dry run and `{ "apply": true }` to commit only
  when every record is valid. The response reports each migrated Route leg,
  bend, and route-attachment rebinding.
- `POST /api/gallery/maintenance/schema-restore` — atomically restore the three
  Project-bearing tables from a `schema-backup` payload supplied as
  `{ "backup": ... }`. Current retention is reapplied, so a legacy backup with
  more than 2 versions for an entry restores only its newest 2. This same-origin
  endpoint is an emergency rollback operation, not a general import surface.

## Retention and privacy

Entries are public content. Publishing is publish-then-moderate: a
signed-in account puts a circuit straight on the wall, and the recycle
bin is the takedown mechanism if it should not have gone up.

Two separate notions of "who submitted" coexist, and neither is public:

- the daily quota keys on a salted hash of the connecting IP, which
  identifies nobody and is never stored against an entry;
- an entry stores the submitting account's id, email, and provider, and
  the API discloses the email and provider only to a moderator or admin.

What a visitor sees is the byline — the account's display name — which
the account holder controls from the account menu.
