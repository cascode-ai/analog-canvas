# First-party analytics module

This directory owns the complete Analog Canvas analytics feature: browser
tracking, dashboard UI and styles, world-map data, HTTP routes, and the
Cloudflare Durable Object backend. The host editor only mounts the dashboard,
calls `useVisitStats`, delegates requests to `routeAnalyticsRequest`, and
re-exports the Durable Object class.

The deployed counts live in Cloudflare Durable Object storage rather than in
these source files. For an existing deployment, keep every persistence identity
below unchanged:

- Worker script: `interactive-circuit-maker`
- Durable Object binding: `ANALYTICS`
- exported class: `AnalyticsDO`
- object name: `global`
- visitor cookie: `canvas_vid`
- routes: `/api/track`, `/api/stats`, and `/api/analytics`
- initial SQL migration: production `v1`

Moving or importing the module does not migrate or clear stored counts. Renaming
the Worker, binding, class, or object can select a new empty namespace. The
schema initializer uses `CREATE TABLE IF NOT EXISTS` and never clears existing
rows; schema changes must preserve that rule unless a separately reviewed data
migration and recovery plan exists.

## The visitor cookie and its limits

Returning visitors are counted with one first-party cookie. Its limits follow
the conditions under which audience-measurement cookies may be set without
asking first:

- `canvas_vid` holds a random id. It is set on a visitor's first counted page
  view, lasts one year, and is never renewed.
- The object stores only a hash of the id, with the last day it was seen. An
  id unseen for 366 days can never return, since its cookie has expired, so
  it is deleted. The public visitor total is a counter that keeps counting
  deleted ids (`visitor_total`). It starts once from the size of `visitors`.
- Finished days keep only their visitor count (`daily_visitor_counts`). Each
  day's hashes are deleted on the next day's first request.
- A visit keeps its first source of the day on the server. The retired
  30-minute source cookie `canvas_sid` is expired when a request still
  carries it.
- Do Not Track, Global Privacy Control, or the privacy notice's "Stop
  counting me" (`canvas_optout`, 13 months, set at `/api/track/opt-out`) mean
  no counting and no visitor cookie.

The statistics are only shown as totals. Nothing is shared or combined with
other data.

## Arena and Analog Canvas

AnalogArena is a separate Worker served at `/arena` on this origin through
the Analog Canvas Worker, so its pages count in these same statistics. A
tracked path that is `/arena` or starts with `/arena/` counts as **Arena**;
every other tracked path counts as **Analog Canvas**. `/arenafoo` is Analog
Canvas, and `/api/arena/…`, like every API path, is not a page.

- Each day keeps its page views and unique visitors per product beside its
  totals (`daily_product_views`, `daily_product_visitors`). A browser that
  uses both products counts once in the day's visitors and once in each
  product's; the all-time visitor total still counts it once.
- Per-product visitor hashes follow the day's: they stay only for today,
  and the day's first request after it turns them into counts
  (`daily_product_visitor_counts`) and deletes them, in the same roll-up.
  Only counts are kept; there is no IP address and no account.
- The split is additive. Days before it began (`products_started_at`) keep
  their totals and have no split; the day it began is split from that
  moment only. The dashboard says so when it shows such days.

## The page-view beacon

This is the contract every counted page follows, Analog Canvas's
(`client.ts`) and Arena's alike. It belongs in the AnalogArena
specification once that lands (cascode-ai/analog-canvas#1556,
cascode-ai/analog-canvas#1558); until then this section is normative.

- A page sends one beacon per page view: `POST /api/track` on the same
  origin, with `credentials: "same-origin"`, `keepalive: true`,
  `cache: "no-store"` and `content-type: application/json`.
- The body is `{ "p": string, "r": string, "s": string }`:
  - `p`, the page's path (`location.pathname`). The server drops any query
    or fragment, keeps at most 120 characters, and ignores `/api/…` and
    `/analytics`.
  - `r`, the referrer's origin when it is `http:` or `https:`, else `""`.
  - `s`, the `utm_source` query value, trimmed, lower-cased and at most 40
    characters, else `""`.
- The page sends nothing when `navigator.doNotTrack` is `"1"` or
  `navigator.globalPrivacyControl` is `true`.
- The server counts nothing, and sets no cookie, for a `DNT: 1` or
  `Sec-GPC: 1` request, a browser carrying `canvas_optout=1`, a request
  from another origin, or a bot; it answers 204. The opt-out cookie is
  HttpOnly, so a page cannot read it: the browser sends it with the beacon
  and the server applies it.
- The answer sets `canvas_vid` (`Path=/`) on a browser's first counted
  view. Arena and Analog Canvas share one origin, so they share the cookie
  and a browser is one visitor across both.
- The beacon is fire-and-forget: a page ignores the answer and any failure.
