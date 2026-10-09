# AnalogArena

Status: `accepted`

Primary owner: `worker/arena.ts` (forwarding and identity), with
`worker/auth-do.ts` (sign-in return) and `wrangler.jsonc` (the binding)

## Scope

AnalogArena is its own Worker, `analog-arena`, deployed from the private
repository Arcadia-1/analog-arena. It has no route of its own: it is reached
only through Analog Canvas, on Analog Canvas's domain and sign-in. This
specification owns the forwarded identity, the routing and the sign-in return
between the two sides; the Arena repository keeps its half in its
`docs/contracts.md`. A change starts here, and each side tests its own half.
What Arena does with a forwarded request is Arena's.

## Forwarded identity and routing

### Routing

- The Production Worker binds the service `analog-arena` as `ARENA`. No other
  Worker holds that binding: not the retired Preview Worker, not the local
  replica. Arena trusts the account of whoever calls it, so the binding is
  the trust boundary.
- It forwards exactly `/arena`, `/arena/…` and `/api/arena/…`. Nothing else
  reaches Arena, including `/arenas`, `/api/arena` and `/api/auth/…`.
  `/arena` and `/arena/*` run the Worker before the static assets, as `/api/*`
  already does; otherwise the editor's shell would answer them.
- The forwarded request keeps the method, the URL (Analog Canvas's origin,
  the path and the query), the body and the client's headers, except the
  account header below.
- Arena's answer is returned unchanged, unless it is a failure (below).

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

## Sign-in return

Sign-in stays Analog Canvas's.
`GET /api/auth/<github|google>/start?return=<path>` comes back to `<path>`
after a successful sign-in when `<path>` is a path on the same origin whose
normalized path is `/arena` or starts with `/arena/`. Its query is kept.
Anything else, a missing `return` included, comes back to `/` as before, and
a failed sign-in still lands on `/?auth=failed`.

The path travels in the OAuth state. The state is a random token, then a dot
and the URL-encoded path, and the state cookie holds the same value. The
callback uses the path only when the returned state equals that cookie, and
checks it against the same rule again. Email-code sign-in completes on the page
that asked for it and takes no return path.

## Evidence

- [`worker/arena.test.ts`](../../worker/arena.test.ts) drives the Worker's
  fetch handler with the real account store and a stand-in Arena at the
  binding: the vouched account and its facts, a forged header dropped, other
  paths left alone, the failure answers and the sign-in return.
- [`worker/index.test.ts`](../../worker/index.test.ts) pins the binding and the
  Worker-first paths;
  [`worker/preview-config.test.ts`](../../worker/preview-config.test.ts) pins
  that the Preview Worker holds no binding.
