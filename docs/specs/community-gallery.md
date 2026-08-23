# Community Gallery

Status: `accepted` (Phase G1 surface + Phase G2 accounts, dark-shipped)

Primary owners: `worker/gallery.ts`, `worker/auth.ts`, `apps/editor`
landing feed

Roadmap: [community gallery platform](../roadmap/community-gallery-platform.md)
(G1 public feed foundation → G2 sign-in → G3 ownership → G4 feed
experience). This specification describes the currently shipped surface and
names the clauses later phases replace.

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
  entries carrying ANY listed tag, both ahead of pagination). Recycled
  entries never appear.
- `GET /api/gallery/tags` — distinct public tags with counts, most
  frequent first (feeds the multi-select menu).
- `GET /api/gallery/<id>` — one public entry with its canonical
  `projectText`.
- `GET /api/gallery/<id>/preview.svg` — the server-rendered preview.
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
`{id, status}` with `status` always `public`.

The byline is not a request field: the Worker takes `author` from the
session's display name, so one account cannot publish under another's
name, and an update never re-attributes an entry.

Every entry records the submitting account: `owner_user_id` plus the
`submitter_email` and `submitter_provider` read from the session at
submission time, so an entry stays traceable to the identity that
published it even if the account is later renamed. These two fields are
traceability data, not feed data — the detail route returns them only to
a moderator or admin, never on a public surface.

## Submission quality gates (Phase G3)

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

`pending` is retired. `rejected` remains only for the entries a reviewer
turned down before the queue was removed, so their owners still see why;
opening the storage promotes any leftover `pending` row to `public`
rather than stranding it, and leaves a real rejection alone.

- `GET /api/gallery/mine` — the calling session's entries with `status`
  and `rejectReason`.
- Moderators: `users.role` (`user`/`moderator`); the super-admin
  appoints by email via `POST /api/auth/users/role` `{email, role}`,
  which applies to every account carrying that verified email. A
  moderator curates and bypasses the quality gates; the recycle bin and
  maintenance stay admin-only.

The editor surfaces moderation at `/moderation` (the recycle bin, plus
admin-only moderator appointment) and the submitter's view at `/mine`
(status chips, owner-visible preview, open-in-editor). Every gallery
page state wears the shared site chrome.

## Owner editing (Phase G3 completion)

`PUT /api/gallery/<id>` (same-origin) updates an entry's content and
metadata (tags included — they stay editable any time) with the
submission field rules. Authority: an admin or moderator session may
update any entry; an ordinary session must own the entry (403 otherwise)
and passes the quality gates (422). Either way the entry keeps its
byline and its current status, so editing a published circuit neither
takes it off the wall nor re-attributes it. The Project is re-serialized
canonically and the preview re-rendered; 200 answers `{id, status}`. The
detail response carries `ownerUserId` so the editor offers "update the
opened entry" exactly to owners and moderators.

Owner withdrawal: `POST /api/gallery/<id>/recycle` (same-origin) also
accepts the owning session — the entry moves to `recycled` and leaves
every public surface, exactly like an admin recycle. The owner brings it
back with `POST /api/gallery/<id>/restore`, which republishes it — for
the owner exactly as for an admin. `/mine` surfaces both actions (a
two-step Withdraw and a Restore on withdrawn entries).

## Version history

Every content-replacing update (`PUT`, and Restore itself) first
snapshots the entry's previous state — name, author, description, tags,
canonical project text, preview — into `gallery_entry_versions`,
numbered per entry and capped at the newest 20 (older pruned).
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

## Accounts and sessions (Phase G2, dark-shipped)

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
whose email appears in the `ADMIN_EMAILS` secret (comma-separated,
case-insensitive) has admin authority — including the administration
routes below — and rotation of `ADMIN_EMAILS` needs no re-login. The
session cookie is the only publishing credential there is: there is no
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
- `POST /api/gallery/<id>/restore` — back to `public`.
- `DELETE /api/gallery/<id>` — permanent, and only for entries already in
  the bin (`409` otherwise).
- `GET /api/gallery/recycled` — the bin.
- `POST /api/gallery/maintenance/reserialize` — re-parse and re-serialize
  every stored entry through the current protocol and refresh its preview;
  run once per schema advance while the rolling window still reads the old
  version. Failures are reported per entry and never destroy the record;
  the independently stored preview keeps expired entries browsable.

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
