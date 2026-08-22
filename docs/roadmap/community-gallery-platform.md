# Community Gallery Platform

Status: `active`

Owner direction (2026-08-21, refined the same day): the site opens as a
full-screen gallery feed (Pinterest-style tiles of example circuits); every
circuit is openable and editable; ordinary users may modify only their own
entries while the site owner is super-admin over all content; signing in
works with any single credential — GitHub, Google, or plain email — and
users can rename their own display name; publishing requires sign-in AND
review: submissions enter a pending queue that the owner, or reviewers the
owner appoints, approve or reject (rejection carries an optional reason);
anonymous visitors browse and use everything read-only.

This roadmap frames the cross-module outcome; each phase lands as its own
bounded target under `plan/` with the normal delivery gate. The normative
server contract lives in
[`../specs/community-gallery.md`](../specs/community-gallery.md).

## Phase G1 — Public feed foundation (this phase)

- `GalleryDO` (SQLite, third Durable Object) stores published entries:
  canonical strict-schema Project text plus a server-rendered preview SVG;
  nothing client-authored is ever stored or served as markup.
- Public read API: list, entry, preview image. Publishing exists but is
  admin-token-gated until real sign-in lands (anonymous upload stays
  impossible from day one; admin-published entries go live directly — the
  end-state review queue for ordinary users arrives in G3). The editor's
  File > "Publish to Gallery…" dialog is the in-app publishing surface:
  it posts the live Project with the owner passphrase (remembered per
  browser session, forgotten on a 401) and later switches to signed-in
  identity without moving the entry point.
- Admin API (bearer `GALLERY_ADMIN_TOKEN`): recycle (soft, restorable),
  restore, hard-delete from the bin only, recycled list, and batch
  re-serialization that keeps long-lived entries inside the rolling schema
  window (previews stored independently so browsing survives an expired
  entry).
- The site opens at `/` as the full-screen feed; `/editor` is the editor;
  `/g/<id>` opens one gallery entry in the editor. While the gallery is
  empty the feed shows the bundled Library examples as tiles so the landing
  page is never blank.
- Entries already carry a nullable owner column so G3 needs no migration.

Acceptance: feed loads from the deployed worker; a seeded entry renders as
a tile, opens in the editor, and survives recycle/restore; all existing
editor behavior reachable at `/editor` unchanged.

## Phase G2 — Accounts and sign-in (live: all three providers lit)

- `AuthDO` (users, sessions): GitHub and Google OAuth code flows on the
  worker plus email magic-link sign-in (Resend) — any one credential
  signs a user in, no passwords stored, only token hashes persisted;
  HttpOnly session cookie; sign-in/account UI on the gallery feed.
- Profile basics: users rename their own display name; identities from
  different providers stay distinct accounts in G2 (linking is a later
  refinement).
- Super-admin is computed per request from the `ADMIN_EMAILS` secret; an
  admin session carries the same authority as the gallery bearer,
  including in-app publishing without the pasted passphrase.
- Every provider ships dark until its secrets exist; the deploy workflow
  syncs whichever of the GitHub secrets are present. To light one up, the
  owner provisions (Claude cannot create accounts or handle credentials):
  - GitHub: an OAuth App with callback
    `https://analog-canvas.tokenzhang.com/api/auth/github/callback`;
    secrets `GH_OAUTH_CLIENT_ID` + `GH_OAUTH_CLIENT_SECRET` (GitHub
    Actions forbids the `GITHUB_` prefix).
  - Google: an OAuth client with redirect URI
    `https://analog-canvas.tokenzhang.com/api/auth/google/callback`;
    secrets `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`.
  - Email: `RESEND_API_KEY` (optional `AUTH_EMAIL_FROM` once a domain is
    verified at the mail provider).
  - Admin: `ADMIN_EMAILS` (comma-separated owner emails).
  - Then re-run the Deploy Cloudflare workflow once.
- Provisioned 2026-08-22: GitHub OAuth App (owner account), Google OAuth
  client (consent screen published to production, basic scopes only), and
  Resend with the verified `tokenzhang.com` domain (DKIM/SPF/MX/DMARC on
  Cloudflare DNS; magic links send from `login@tokenzhang.com`);
  `/api/auth/providers` reports all three enabled and a production magic
  link delivered end to end.

Acceptance: sign in/out round-trips on the deployed site with any single
provider; display-name edits stick; the owner's account sees admin
affordances; no credential material ever transits or is stored beyond the
provider contract.

## Phase G3 — Ownership, review, and editing (queue + gates live)

- Publishing requires a session; a submission enters a `pending` queue
  instead of going live. The super-admin — or reviewers the super-admin
  appoints (a `moderator` role) — approves it to `public` or rejects it
  with an optional reason shown to the submitter.
- Entries record their owner; owners can update or withdraw their own
  entries (an update to an approved entry re-enters review), the
  super-admin and moderators can act on any entry; the recycle bin remains
  the post-approval takedown path.
- Editor gains "submit to gallery / update my tile" against the signed-in
  identity; anonymous visitors keep full read-and-local-edit freedom
  without any way to write back.

Shipped 2026-08-22: ordinary signed-in submissions pass deterministic
quality gates (owner policy: no ERC errors; no floating endpoints —
wire, name the net, or NoConnect; no near-empty projects) enforced by
one shared evaluator in the worker and previewed live in the publish
dialog, then wait in `pending` (publicly invisible) until the
super-admin or an appointed moderator (`/review`, in-app appointment by
email) approves or rejects with an optional reason surfaced at `/mine`.
Remaining in this phase: owner editing/withdrawal of published entries
re-entering review.

Acceptance: an ordinary submission is invisible publicly until approved;
rejection stores and surfaces its optional reason; two ordinary accounts
cannot touch each other's tiles while moderators and the admin can;
anonymous writes are impossible at the API, not just the UI.

## Phase G4 — Feed experience (masonry live)

- Masonry (shipped 2026-08-22: JS greedy shortest-column layout keeping
  each circuit's natural aspect ratio, left-to-right reading order,
  balanced bottoms); still open: infinite scroll, per-author filtering,
  in-feed admin recycle-bin view, and seeded starter content curation.

Each phase closes by updating this file's status line for that phase.
