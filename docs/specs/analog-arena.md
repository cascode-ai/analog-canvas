# AnalogArena

Status: `accepted`

Primary owner: `worker/arena.ts` (hosts, forwarding and identity), with
`worker/arena-account.ts` (the vouched account and the account deletion's
call), `worker/arena-paths.ts` (the hosts and the `/schematic` path rule),
`worker/auth-do.ts` (sign-in handoff, sign-in return and account deletion) and
`wrangler.jsonc` (the hosts and the binding)

## Scope

AnalogArena is its own Worker, `analog-arena`, deployed from the private
repository Arcadia-1/chip-arena. It has no route of its own: it is reached
only through this Worker, which serves it on its own host,
`chip-arena.com`, with Analog Canvas's accounts. This
specification owns the hosts, the forwarded identity, the routing, the sign-in
handoff, the sign-in return and the account deletion's call between the two
sides; the Arena repository keeps its half in its `docs/contracts.md`. A
change starts here, and each side tests its own half. What Arena does with a
forwarded request is Arena's.

Visitors see the site as **Chip Arena**, and its repository took that name
(2026-10-10). The Worker keeps the name `analog-arena`, because its Durable
Objects are keyed to it and the binding below names it.

## Hosts

This Worker answers two hosts (`wrangler.jsonc`): Analog Canvas's,
`analog-canvas.tokenzhang.com`, and AnalogArena's, `chip-arena.com`, a
custom domain of the same Cloudflare account. Analog Canvas and AnalogArena
are separate products; the hosts share only the accounts and the way from one
to the other. Before any route, `routeArenaHosts` sends a request elsewhere
when its host and path call for it:

- On AnalogArena's host:
  - `/` (Chip Arena's front page), `/analytics` (its visitor statistics),
    `/schematic`, `/schematic/…`, `/api/arena/…` and `/api/auth/…` stay.
  - `GET /api/auth/<github|google>/start` goes to the same path on Analog
    Canvas's host (`302`), the one host those providers return to. A `return`
    naming a Schematic Arena page becomes that page's full address here
    ([Sign-in return](#sign-in-return)).
  - Every other path the Worker sees goes to the same path and query on Analog
    Canvas's host (`302`). Paths the static assets answer first never reach
    the Worker.
- On Analog Canvas's host, `/arena`, `/arena/…` (the Schematic Arena's
  former address), `/schematic` and `/schematic/…` go to the same Schematic
  Arena page on AnalogArena's host, `/arena…` becoming `/schematic…`, with
  the query kept, through the [sign-in handoff](#sign-in-handoff) (`302` to
  its beginning). This is Analog Canvas's way to AnalogArena.
- Elsewhere (local development), `/arena` and `/arena/…` go to the same path
  under `/schematic` on the same origin (`301`).

## Forwarded identity and routing

### Routing

- The Production Worker binds the service `analog-arena` as `ARENA`. No other
  Worker holds that binding: not the retired Preview Worker, not the local
  replica. Arena trusts the account of whoever calls it, so the binding is
  the trust boundary.
- It forwards exactly `/schematic`, `/schematic/…` and `/api/arena/…`, on any
  host that keeps them ([Hosts](#hosts)), and, on AnalogArena's host alone,
  `/` and `/analytics`: Analog Canvas's own `/` and `/analytics` stay
  Analog Canvas's. Nothing else reaches Arena, including `/schematics`,
  `/api/arena`, `/analytics/…` and `/api/auth/…`. `/schematic`,
  `/schematic/*`, `/arena`, `/arena/*`, `/` and `/analytics` run the Worker
  before the static assets, as `/api/*` already does; otherwise the editor's
  shell would answer them.
- The forwarded request keeps the method, the URL (Analog Canvas's origin,
  the path and the query), the body and the client's headers, except the
  account header below.
- Analog Canvas's credentials never reach Arena: the forwarded `Cookie` loses
  `icm_session` (other cookies are kept), `Authorization` is removed, and an
  answer's `Set-Cookie` naming `icm_session` or `icm_owner_session` is dropped.
- Arena's answer is otherwise returned unchanged, unless it is a failure
  (below).

### Forwarded identity

The header `x-arena-account` carries the signed-in account as one JSON object:

| Field         | Type                      | Meaning                                        |
| ------------- | ------------------------- | ---------------------------------------------- |
| `id`          | non-empty string          | The Analog Canvas account id.                  |
| `displayName` | string                    | The name Analog Canvas shows for the account.  |
| `isOwner`     | boolean                   | One of the Owner's own accounts.               |
| `isAdmin`     | boolean                   | An Analog Canvas administrator.                |
| `role`        | `"user"` or `"moderator"` | The account's role.                            |
| `seat`        | string or `null`          | The AI seat the account is; `null` for people. |

- The facts are the session's, read from the account store for this request.
  A browser the Owner switched to an AI account is that AI account.
- The header is present only when the visitor is signed in. Without it, the
  visitor is signed out.
- Every character outside printable ASCII travels as a JSON `\u` escape,
  because a header carries bytes. The value is still one JSON object and
  parses to the same strings.
- The Worker deletes a client's copy of the header from every request at its
  entry, forwarded or not, and then sets its own on a forwarded one.
- Analog Canvas may add a field before Arena reads it; Arena ignores unknown
  fields. Removing or retyping a field is a change to both sides.

### Failure

When the binding is absent, the call throws (Arena unreachable) or Arena
answers with a 5xx status, Analog Canvas answers `503` with
`cache-control: no-store` instead:

- `/api/arena/…`: `{ "error": "arena-unavailable" }`;
- a page: a small notice that Arena is unavailable, with links to the Gallery
  and the editor.

Every other answer of Arena, its own `404` among them, passes through. A
visitor never meets a crash, and Arena keeps 5xx for failures, not for answers
it designed.

## Account deletion

Deleting an Analog Canvas account
([Accounts and sessions](community-gallery.md#accounts-and-sessions)) asks
Arena to unlink the account from its Voter. Arena then removes the account
from its records and keeps the Voter's Votes, Battles, Voter Profile answers
and measurements as anonymous data under the Voter id alone; the same
account, if it signs in and agrees again, becomes a new Voter.

- The step runs in the account store after the Gallery and the component
  library and before the account itself goes. It sends
  `POST /api/canvas/account-deletion` on the Analog Canvas origin over the
  `ARENA` binding, with no body, no cookie and no `Authorization`, and the
  account being deleted in `x-arena-account`, built as for forwarding.
- Only this Worker can send it. The path lies outside `/schematic`,
  `/schematic/…` and `/api/arena/…`, so a browser's request for it is Analog Canvas's own and
  never forwarded; and the entry deletes a client's `x-arena-account`, so the
  account named is always the session's, the one being deleted.
- Arena answers `200 { "unlinked": true }` whether or not the account had a
  Voter, and the same when asked again, so the step is idempotent like the
  other deletion steps. When the call throws or Arena answers anything but
  success, a 404 from an Arena without this call included, the deletion
  answers `503 { "error": "arena-unlink-failed" }`
  with `cache-control: no-store`, and the account stays signed in to retry.
- Where the binding is absent, every Worker but Production, the step is
  skipped and the deletion goes on, as the Gallery and component steps are
  skipped where their bindings are absent. Such a Worker never forwarded an
  account to Arena, so no Voter there names it.

What Arena does with the call is Arena's (its `docs/contracts.md`,
Account deletion). The privacy notice at `/privacy` describes it in its
AnalogArena section, which follows Arena's Consent text.

## Sign-in handoff

A browser cannot share a cookie between `tokenzhang.com` and
`chip-arena.com`, so each host keeps its own host-only `icm_session`, as
before, and the handoff carries a sign-in from Analog Canvas's host to
AnalogArena's. It is three redirects, each `302` with `cache-control: no-store`
and `referrer-policy: no-referrer`:

1. `GET /api/auth/handoff/begin?return=<page path>` on AnalogArena's host sets
   `icm_handoff`, a fresh random binding (host-only, `Path=/api/auth/handoff`,
   `HttpOnly`, `SameSite=Lax`, one minute), and goes to Analog Canvas's
   `/api/auth/handoff?return=<page address>&binding=<binding>`.
2. Analog Canvas's host sends a signed-out browser straight to the page. For a
   signed-in browser it stores a random one-time code (only its SHA-256)
   with the account, the binding's SHA-256 and a one-minute expiry, and goes
   to AnalogArena's `/api/auth/handoff/complete?code=<code>&return=<page path>`.
   Asked without a binding, it goes to step 1 first.
3. AnalogArena's host takes the code once, whatever happens next, and clears
   `icm_handoff`. A live code whose binding equals the browser's
   `icm_handoff` signs this host in as its account with a new session of its
   own; any other code signs nothing in. The browser then lands on the page.

The binding keeps a code to the browser that began the handoff: a completion
address sent to another browser signs nothing in there. The page is a
Schematic Arena page on AnalogArena's host, normalized with its query kept;
anything else lands on `/schematic`. A session on one host is not the other's:
signing out on one leaves the other signed in.

## Sign-in return

Sign-in stays Analog Canvas's.
`GET /api/auth/<github|google>/start?return=<return>` comes back to
`<return>` after a successful sign-in when `<return>` is either
- a path on the same origin whose normalized path is `/schematic` or starts
  with `/schematic/`, or
- the full address of such a page on AnalogArena's host,
  `https://chip-arena.com/schematic…`, which is how a sign-in started there
  comes back ([Hosts](#hosts)). It comes back through the
  [sign-in handoff](#sign-in-handoff), which signs that host in too; Analog
  Canvas's host is signed in as well.

Its query is kept. Anything else, a missing `return` included, comes back to
`/` as before, and a failed sign-in still lands on `/?auth=failed`.

The return travels in the OAuth state. The state is a random token, then a dot
and the URL-encoded return, and the state cookie holds the same value. The
callback uses the return only when the returned state equals that cookie, and
checks it against the same rule again. Email-code sign-in completes on the page
that asked for it and takes no return.

## Evidence

- [`worker/arena.test.ts`](../../worker/arena.test.ts) drives the Worker's
  fetch handler with the real account store and a stand-in Arena at the
  binding: the vouched account and its facts, a forged header dropped, the
  credentials kept from Arena, other paths left alone (the account
  deletion's path among them), the failure answers, the hosts' redirects,
  the sign-in handoff, the sign-in return, and
  account deletion's call to Arena with its failures, retry and absent
  binding.
- [`apps/editor/src/components/privacy-page.test.tsx`](../../apps/editor/src/components/privacy-page.test.tsx)
  checks that the privacy notice describes AnalogArena.
- [`worker/index.test.ts`](../../worker/index.test.ts) pins the binding and the
  Worker-first paths;
  [`worker/preview-config.test.ts`](../../worker/preview-config.test.ts) pins
  that the Preview Worker holds no binding.
