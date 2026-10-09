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

## Page-load times

A counted page load also reports, once, how long it took (#1581): the
document's first byte and when the page was shown (its largest paint, or the
load event where a browser has none), at `POST /api/track/load`. The report
carries no visitor id and sets no cookie; the same rules decide whether it is
counted (same origin, no Do Not Track, Global Privacy Control or opt-out,
no bot). The object keeps only histogram counts per day, country, metric and
bucket (`load_times`), drops days older than the retention window, and the
dashboard shows each country's median and 75th percentile over the last 30
days as bucket upper bounds.

The statistics are only shown as totals. Nothing is shared or combined with
other data.
