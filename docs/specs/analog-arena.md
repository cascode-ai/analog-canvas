# AnalogArena

Status: `accepted`

Primary owner: `worker/arena.ts` (hosts, forwarding, identity), with
`worker/arena-account.ts` (vouched account, deletion call),
`worker/arena-paths.ts` (hosts, `/schematic` rule), `worker/auth-do.ts`
(sign-in handoff and return, account deletion) and `wrangler.jsonc` (hosts,
binding)

AnalogArena (shown as **Chip Arena**) is the Worker `analog-arena` from the
private repository Arcadia-1/chip-arena; its name stays because its Durable
Objects and the binding are keyed to it. Only this Worker reaches it, on
`chip-arena.com`, with Analog Canvas accounts. This spec owns the contract
between the sides (Arena keeps its half in its `docs/contracts.md`); a change
starts here and each side tests its own half. What Arena does with a
forwarded request is Arena's.

## Hosts

This Worker answers `analog-canvas.tokenzhang.com` (Analog Canvas) and
`chip-arena.com` (AnalogArena, a custom domain of the same Cloudflare account).
The hosts share only accounts and the way between them. Before any route,
`routeArenaHosts` redirects:

- On AnalogArena's host:
  - `/`, `/analytics`, `/schematic`, `/schematic/…`, `/api/arena/…` and
    `/api/auth/…` stay.
  - `GET /api/auth/<github|google>/start` → `302` to the same path on Analog
    Canvas's host (the only host the providers return to); a `return` naming a
    Schematic Arena page becomes that page's full address here
    ([Sign-in return](#sign-in-return)).
  - Every other path the Worker sees → `302` to the same path and query on
    Analog Canvas's host. Static-asset paths never reach the Worker.
- On Analog Canvas's host, `/arena`, `/arena/…`, `/schematic` and
  `/schematic/…` → the same Schematic Arena page on AnalogArena's host
  (`/arena…` becomes `/schematic…`, query kept) through the
  [sign-in handoff](#sign-in-handoff) (`302` to its beginning).
- Elsewhere (local development), `/arena` and `/arena/…` → `301` to the same
  path under `/schematic` on the same origin.

## Forwarded identity and routing

### Routing

- Only the Production Worker binds the service `analog-arena` as `ARENA` (not
  the retired Preview Worker, not the local replica). Arena trusts the account
  of whoever calls it, so the binding is the trust boundary.
- Forwarded: exactly `/schematic`, `/schematic/…` and `/api/arena/…` on any
  host that keeps them, plus `/` and `/analytics` on AnalogArena's host only.
  Nothing else (`/schematics`, `/api/arena`, `/analytics/…`, `/api/auth/…`).
  `/schematic`, `/schematic/*`, `/arena`, `/arena/*`, `/` and `/analytics` run
  the Worker before static assets, as `/api/*` does.
- The forwarded request keeps method, URL (Analog Canvas's origin, path,
  query), body and client headers, except the account header.
- Credentials never reach Arena: `Cookie` loses `icm_session` (others kept),
  `Authorization` is removed, and an answer's `Set-Cookie` naming
  `icm_session` or `icm_owner_session` is dropped.
- Arena's answer is otherwise returned unchanged, except failures (below).

### Forwarded identity

Header `x-arena-account` carries the signed-in account as one JSON object:

| Field         | Type                      | Meaning                         |
| ------------- | ------------------------- | ------------------------------- |
| `id`          | non-empty string          | Analog Canvas account id        |
| `displayName` | string                    | Name Analog Canvas shows        |
| `isOwner`     | boolean                   | One of the Owner's own accounts |
| `isAdmin`     | boolean                   | Analog Canvas administrator     |
| `role`        | `"user"` or `"moderator"` | Account role                    |
| `seat`        | string or `null`          | AI seat; `null` for people      |

- Facts come from the account store for this request; a browser the Owner
  switched to an AI account is that AI account.
- Present only when signed in; absent means signed out.
- Every character outside printable ASCII is a JSON `\u` escape; the value
  still parses to the same strings.
- The Worker deletes any client copy of the header from every request at its
  entry, then sets its own on forwarded ones.
- Analog Canvas may add fields (Arena ignores unknown ones); removing or
  retyping a field changes both sides.

### Failure

Binding absent, call throws, or Arena answers 5xx → `503` with
`cache-control: no-store`: `{ "error": "arena-unavailable" }` for
`/api/arena/…`, otherwise a small unavailable page linking to the Gallery and
editor. Every other answer, Arena's own `404` included, passes through; Arena
reserves 5xx for failures, never for answers it designed.

## The Arena gate

After a manual Cloud Save, and whenever the person opens the Cloud shelf
themselves (editor Shelf menu, Gallery My shelf tab, account Cloud Projects
tab), the editor asks a signed-in person for `min(5, battlesLeft)` Votes
before its panel closes. A page that loads already on the shelf (a reload)
opens no gate. Voting happens in Arena's own window on AnalogArena's host;
Analog Canvas only counts. Arena's pages never run on Analog Canvas's origin.

The panel frames `https://chip-arena.com/schematic/preview` (a fixed Battle
that reads and records nothing) from AnalogArena's host, sandboxed to its own
scripts and origin, no referrer, no pointer or focus. The panel works without
it.

### Vote source

The panel's link opens `/schematic?from=canvas-gate` on Analog Canvas's host
in a new window; the [sign-in handoff](#sign-in-handoff) brings it to
`https://chip-arena.com/schematic?from=canvas-gate`, signed in, query kept.
Arena records every Vote cast on a page opened with `from=canvas-gate`
(queued retries included) with source `canvas-gate`, every other Vote with
source `arena` (Arcadia-1/chip-arena#234). Analog Canvas adds nothing to the
vote requests.

### Counting

The gate reads on Analog Canvas's host, forwarded with the vouched account:

- `GET /api/arena/battles/past`: voted Battles, newest first, each with `id`
  and `castAt`. A Vote counts when its Battle was not listed as the gate
  opened and `castAt` ≥ the `Date` of Arena's first answer; without a `Date`,
  the initially listed Battles alone decide. The first page (20) suffices.
  Re-read every 4 s while visible and on return to the window, one at a time.
  `403 consent-required` still opens the gate (Votes count once the list
  answers).
- `GET /api/arena/session`, read with every count: `signedIn`, `aiAccount`,
  `battlesLeft` (active-Season pairings without a Vote by this account; 0 with
  no open Season or for an AI seat). Never cached, creates no Battle
  (Arcadia-1/chip-arena#238). N = `min(5, battlesLeft)` is fixed as the gate
  opens and shown as N dots ("Voted x of N" for readers). `battlesLeft` 0 →
  no panel; reaching 0 before the Votes are in → panel may close. Only a
  whole number ≥ 0 is accepted; anything else is a failed read.
- The gate never calls `POST /api/arena/battles/next` (it assigns Battles).
- No panel: `signedIn: false`, `aiAccount: true`, list `401` or
  `403 ai-account`, or a non-JSON-object answer to either read (Arena and this
  Worker answer JSON on every `/api/arena` path, so that means no Arena).
- Panel may close at once: either read fails as the gate opens (unreachable,
  JSON 5xx such as `503 arena-unavailable`, unexpected shape), or three
  consecutive failed reads while counting.

The gate keeps nothing across a reload and no page opens one on load; the
reload bypass is accepted.

## Drawing delivery

Implemented and tested in the Arena repository:

- The next Battle's two drawings are prepared while the current one is judged
  (after it is noted shown); every Battle is shown and votable only after both
  load and decode. Each attempt has 15 s and one automatic retry, then retry
  and online recovery for the same Battle without marking it shown. Finishing
  preparation while viewing a past Battle marks or requests nothing until the
  Voter returns.
- Arena may cache immutable SVG bytes and content headers in a named edge
  cache keyed by content hash per data center, after checking identity and
  Battle ownership (or live Submission membership); never accounts, cookies,
  metadata or personalized responses; the key is no public route. Failures
  fall back to private R2; failed or missing reads are never cached; writes
  run after the response is ready. Server-Timing `arena_image` may say
  `hit`/`miss`/`bypass` without naming the image.
- Battle and Submission responses stay
  `Cache-Control: private, max-age=31536000, immutable`, Battle addresses
  expose no hash or ETag; the signed-out example keeps its public 5-minute
  policy and resolves the active Season first. Analog Canvas adds no shared
  cache of authenticated responses.

## Draw it yourself

After a Both bad Vote, the Arena's Reveal invites the Voter to draw the
circuit themselves, starting from either side's drawing (#1695).

- **Arena serves the project.** `GET /api/arena/battles/<battle>/a.icproj.json`
  and `/b.icproj.json` answer the Analog Canvas project behind that side, as
  the Season bundle holds it. They answer only the Voter whose Battle it is,
  once they have voted on it, as `a.svg` and `b.svg` do. Before the Vote they
  answer 409 `vote-required`; another Voter's or an unknown Battle answers
  404 `battle-unknown`; a side with no project answers 404
  `project-unknown`. On the Canvas host they go through the forwarding above,
  signed in as the Canvas account.
- **Arena links to Canvas.** The Reveal's "Draw it yourself" card links, in a
  new tab, `https://analog-canvas.tokenzhang.com/editor?arena-battle=<battle>&arena-side=a`
  and `…&arena-side=b`. The Gallery's address with the same query (`/?…`)
  opens the editor too.
- **Canvas opens it as the Voter's own.** Canvas fetches the side's project
  and opens it as a new, unsaved project with a new identity, named
  `<circuit> (from Arena)`. The Arena's stored project is untouched, and the
  address drops the query once handled, so a reload opens no second copy.
- **Signed out**, the fetch answers 401: the editor asks the Voter to sign
  in. An email-code sign-in reloads the entry. Choosing GitHub or Google
  keeps the entry in the tab for 15 minutes; that sign-in returns to `/`,
  which continues to the entry once. A Voter who declines finds `/` as
  usual.
- **A refused or failed fetch** (`vote-required`, `battle-unknown`,
  `project-unknown`, or the Arena unreachable) opens the editor as usual with
  a short notice, never an error page.

## Account deletion

Deleting an account ([Accounts and sessions](community-gallery.md#accounts-and-sessions))
asks Arena to unlink it from its Voter. Arena removes the account and keeps the
Voter's Votes, Battles, Profile answers and measurements anonymously under the
Voter id; the same account signing in again becomes a new Voter.

- Runs in the account store after the Gallery and component-library steps,
  before the account goes: `POST /api/canvas/account-deletion` on the Analog
  Canvas origin over `ARENA`, no body, cookie or `Authorization`, the account
  in `x-arena-account` built as for forwarding.
- Only this Worker can send it: the path is never forwarded, and the entry
  strips client `x-arena-account`, so the account is always the session's.
- Arena answers `200 { "unlinked": true }` with or without a Voter, and again
  on repeat (idempotent). A throw or any non-success (including 404 from an
  Arena without this call) → `503 { "error": "arena-unlink-failed" }` with
  `cache-control: no-store`; the account stays signed in to retry.
- Without the binding (every Worker but Production) the step is skipped, like
  the Gallery and component steps without theirs; such a Worker never
  forwarded an account, so no Voter names it.

Arena's handling is in its `docs/contracts.md` (Account deletion). `/privacy`
describes it in its AnalogArena section, following Arena's Consent text.

## Sign-in handoff

Cookies cannot be shared between `tokenzhang.com` and `chip-arena.com`, so
each host has its own host-only `icm_session`. The handoff is three `302`s,
each with `cache-control: no-store` and `referrer-policy: no-referrer`:

1. AnalogArena `GET /api/auth/handoff/begin?return=<page path>` sets
   `icm_handoff`, a fresh random binding (host-only,
   `Path=/api/auth/handoff`, `HttpOnly`, `SameSite=Lax`, one minute), then →
   Analog Canvas `/api/auth/handoff?return=<page address>&binding=<binding>`.
2. Analog Canvas sends a signed-out browser straight to the page. Signed in,
   it stores a random one-time code (SHA-256 only) with the account, the
   binding's SHA-256 and a one-minute expiry, then → AnalogArena
   `/api/auth/handoff/complete?code=<code>&return=<page path>`. Without a
   binding it goes to step 1 first.
3. AnalogArena consumes the code once whatever happens and clears
   `icm_handoff`. A live code whose binding equals the browser's
   `icm_handoff` signs this host in with a new session; any other signs
   nothing in. The browser lands on the page.

The page is a normalized Schematic Arena page on AnalogArena's host, query
kept; anything else lands on `/schematic`. Sessions are per host: signing out
on one leaves the other signed in.

## Sign-in return

`GET /api/auth/<github|google>/start?return=<return>` returns to `<return>`
after successful sign-in when it is a same-origin path normalizing to
`/schematic` or `/schematic/…`, or `https://chip-arena.com/schematic…` (the
latter via the [sign-in handoff](#sign-in-handoff), signing in both hosts).
Query kept. Anything else, including no `return`, → `/`; failure →
`/?auth=failed`.

The OAuth state is a random token, a dot, then the URL-encoded return; the
state cookie holds the same value. The callback uses the return only when the
returned state equals the cookie, and re-checks the rule. Email-code sign-in
takes no return.

## Evidence

`worker/arena.test.ts` (real account store, stand-in Arena),
`apps/editor/src/components/arena-gate*.test.ts(x)`, `privacy-page.test.tsx`,
`worker/index.test.ts`, `worker/preview-config.test.ts`.
