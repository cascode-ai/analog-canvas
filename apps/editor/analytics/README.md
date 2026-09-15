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
- cookies: `canvas_vid` and `canvas_sid`
- routes: `/api/track`, `/api/stats`, and `/api/analytics`
- initial SQL migration: production `v1`

Moving or importing the module does not migrate or clear stored counts. Renaming
the Worker, binding, class, or object can select a new empty namespace. The
schema initializer uses `CREATE TABLE IF NOT EXISTS` and never clears existing
rows; schema changes must preserve that rule unless a separately reviewed data
migration and recovery plan exists.
