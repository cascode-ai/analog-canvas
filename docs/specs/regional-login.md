# Regional Login

Status: `accepted`

Primary owner: Auth. Opt-in implementation; disabled in Production.

The overseas account authority authenticates users; a regional session store
serves local authorization. Resource replication is owned by
[regional data synchronization](china-regional-identity-sync.md).

## Rules

- Preserve the authority's user ID and provider separation. Only the authority
  registers users, links identities and changes roles. Email equality never
  merges accounts. Domestic acceptance probe IDs are disposable.
- Provider secrets and provider callbacks stay at the authority. A shared browser
  domain requires a distinct fixed `transportOrigin` for authority traffic. The
  domestic entry proxies only the method/path pairs in
  `isRegionalAuthorityBrowserRoute`; regional start, callback and local sessions
  stay domestic. The authority recognizes only its configured transport alias
  and preserves the browser Origin check. Forwarded headers grant no trust.
- A region uses its own AUTH binding, storage and HttpOnly host-only
  `icm_regional_session`; overseas retains `icm_session`. Regional logout clears
  only the regional session and pending handoff. The editor recognizes `central`
  with the local `loginUrl` `/api/auth/regional/start`; overseas provider choices
  stay intact.
- Handoff codes are short-lived, single-use, browser-bound and redeemable only
  by the configured client with its verifier and service credential. A lost
  redemption response requires restarting login. The starting region binds a
  same-origin page continuation to the pending handoff; callbacks cannot change
  it. External and API continuations fall back to `/`. Returning to the editor
  preserves its browser-local workspace under the existing recovery contract.
- Ordinary `sessionUserOf()` calls read local state without network I/O. Its
  `SessionUser | null` shape remains unchanged. Local authority-originated flags
  are never inferred from email or granted by a resource store.
- Account operations use the explicit `isRegionalAccountRoute` allowlist on
  both peers. The regional entry checks the browser origin and active local
  session; the authority revalidates its grant and runs existing account
  permission checks. Browser-supplied identities, headers and source cookies
  never establish the delegated actor. Responses refresh the local identity;
  a session generation fences stale renewal responses. Account operations for
  one regional session run in order and revalidate the current lease when they
  begin. Local reads and logout do not wait for that queue; logout rejects
  pending responses and queued operations. Account
  operations require authority connectivity. RPC requests are size-bounded;
  successful account results retain the existing account API's listing range.
- Owner token management retains its existing Owner-only session checks.
  Import-token lookup uses only the internal AUTH binding and an authenticated
  authority RPC; it creates no session or lease and caches no authorization.
  Invalid/revoked tokens yield no user; resource owners still enforce `isOwner`
  and the import-only scope.
- Regional AI switching changes only the authority grant's effective subject;
  it never replaces or ends the overseas browser session. A live administrator
  session remains the original actor; an overseas AI handoff also requires its
  live original-actor cookie. Regional projections retain that actor's ID and
  display name in `switchedFrom`. Resource permissions, ownership and quotas
  use the effective user, never the actor's administrative privileges. Switching
  and returning recheck authority permissions; local authorization pauses until
  the transition is confirmed. Renewal recovers a lost transition reply after
  restart but cannot revive a logged-out session. Unbound legacy AI grants fail
  closed and require a new handoff.
- The authorization lease and alarm interval are defined in the
  [protocol module](../../worker/regional-auth-contract.ts). Background alarms
  renew before expiry; a failed renewal never extends a lease. Expired leases
  return no user. Alarm delay or cross-border outages can therefore pause private
  operations even while regional data is available. Production must qualify
  alarm capacity and clock synchronization before enabling this profile.
- Authority logout, session expiry or account disappearance stops renewal;
  prior leases expire within their bound. `blocked` retains its Gallery-only meaning; it is not a
  global account-disable flag. This protocol adds no global-disable feature.
- Identity lookup establishes an owner exists; it does not authorize a browser
  to read that owner's resources or allocate another quota. Unknown identities
  wait for reconciliation. Resource ownership, quotas and resource deletion
  remain the data worker's responsibility.
- Identity disappearance cannot distinguish deletion from an unknown ID. It
  never instructs a resource store to erase data. Versioned account-deletion
  events and resource-cleanup receipts require a separate delivery.
- Session cookies, pending verifiers and authority grants stay in regional
  private storage; they are excluded from resource replication. Store credentials
  outside source and logs. Recovery from a stale session-store backup must
  invalidate its pending handoffs and sessions before accepting traffic.

## Contract

The same [configuration shape](../../worker/regional-auth-contract.ts) pins
browser authority origin, client origin and a separate shared client secret.
Optional `transportOrigin` pins the backend independently of browser routing;
without it, the two browser origins must differ. Server exchanges never follow
transport redirects. Set
`AUTH_REGIONAL_AUTHORITY` only on the authority and `AUTH_REGIONAL_CLIENT` only
on `RegionalSessionDO`. Invalid or absent configuration keeps the new surface
closed. HTTPS is required except explicit loopback acceptance origins. No
production bindings, migrations or credentials are activated by this change.

| Endpoint                                        | Caller and result                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Regional `GET /api/auth/regional/start`         | Browser; starts a bound handoff to the authority.                                                                                  |
| Authority `GET /api/auth/regional/authorize`    | Browser; reuses existing login, then returns a code and state to the configured regional callback.                                 |
| Regional `GET /api/auth/regional/callback`      | Browser; verifies state and redeems the code server-side, then establishes a regional session.                                     |
| Authority `POST /api/auth/regional/exchange`    | Authenticated region; `{code, verifier}` → `{user, grant, expiresAt}`.                                                             |
| Authority `POST /api/auth/regional/renew`       | Authenticated region; `{grant}` → `{user, expiresAt}`.                                                                             |
| Authority `POST /api/auth/regional/identities`  | Authenticated importer; `{userIds}` (up to 100 IDs) → `{identities: [{id, status: "found", user} \| {id, status: "missing"}]}`.    |
| Authority `POST /api/auth/regional/account`     | Authenticated region; `{grant, method, path, body}` → `{result: {status, body}, user, expiresAt}` for the exact account allowlist. |
| Authority `POST /api/auth/regional/owner-token` | Authenticated region; `{token}` → `{user}` or 401. Only internal import authorization consumes this result.                        |
| Regional `GET /api/auth/me`                     | Browser; `{user, authorization: "active" \| "expired" \| "anonymous"}`.                                                            |

Authority POSTs require `Authorization: Bearer <client secret>` over the pinned
HTTPS endpoint; no CORS grant is issued. They accept bounded JSON bodies.
Unauthorized/invalid grants return 401, malformed requests 400, disabled routes
404 and wrong origins 421. Resource callers consume the trusted internal AUTH
binding rather than accepting browser-supplied user IDs or service credentials.
The same client credential authorizes identity lookup; it is not a global
Cloudflare management token. This implementation admits one configured client.

## Acceptance criteria

- [Auth HTTP tests](../../worker/auth.test.ts) exercise real isolated stores:
  same identity after handoff, browser binding, single use, expiry, trusted
  destinations, authenticated lookup, local-only reads, background role refresh,
  outage expiry and authority-session revocation.
- Existing overseas provider, session and Arena handoff tests remain valid with
  the new authority configuration absent.
- Real provider/browser routing, runtime alarm load and resource integration are
  deployment acceptance gates; synthetic HTTP tests do not certify them.
