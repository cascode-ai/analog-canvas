# Formal regional Project candidate

This opt-in profile implements the [Project contract](../../../docs/specs/regional-projects.md)
with [regional sessions](../../../docs/specs/regional-login.md). It is separate
from both acceptance datasets and is not installed or activated by a code push.
Only Auth, private Projects and replication APIs are served; other capabilities
return 404. The built editor assets need a reverse proxy on the same origin.

## Preparation

- Build `bundle.jsonc` using the repository-pinned Wrangler with `deploy --dry-run
--outdir <absolute-private-release>/worker`. It bundles `worker/regional-entry.ts`;
  rename the generated `regional-entry.js` to `index.js`. Never invoke a real
  deploy for this profile. Separately dry-run `egress-bundle.jsonc`, then place
  its bundled `egress.js` as `egress.mjs` beside `config.capnp`. The raw egress
  source imports the shared Auth route contract and cannot be copied unbundled.
- Use the pinned workerd binary from the [standalone runtime](../README.md).
  Namespace keys and state paths in `config.capnp` are persistent identities.
  One process owns each directory. Never copy trial accounts into formal state.
- The service's `LoadCredential` entries enumerate required private files.
  Write token and URL files without trailing newlines. `regional-client.json`
  follows the Auth contract; its secret and `identity-token` must agree. Inbound,
  outbound and admin synchronization credentials are separate. The opposite
  region uses the corresponding inbound token for its outbound delivery.
- Bind source `PROJECTS` to its existing `GalleryDO` namespace and select
  `PROJECTS_STORE_NAME=gallery`; set `PROJECT_REGION=overseas` only on a reviewed
  source candidate. A new source namespace would hide existing Projects.
  The unmodified overseas configuration remains disabled.
- Authority and peer origins must reach overseas unambiguously. Geographic DNS
  on a shared public domain is not sufficient for background traffic or login
  handoff. For a shared browser origin, pin `transportOrigin` to a separate
  overseas endpoint and use that origin in `identity-url`. Only the
  [Auth contract's browser routes](../../../worker/regional-auth-contract.ts)
  are proxied there, preserving Origin, cookies and query parameters. Browser
  redirects return to the browser without being followed; server-side RPC and
  synchronization redirects are rejected. Local session and account routes are
  never included in this browser proxy.

## Activation gates

1. Qualify both candidates on isolated data, including process restart, actual
   workerd alarms, session lease renewal and the editor's central-login flow.
   Before activating a shared browser domain, qualify its TLS, provider callbacks
   and fixed-origin routing in a restricted real-domain rehearsal. The localhost
   SSH trial does not require that rehearsal or a new domain alias.
2. Install the formal service under its dedicated Unix user and prepare its
   state directory. Keep `PROJECT_WRITES_ENABLED=false`; the loopback entry is
   accessible through SSH. The entry normalizes trusted proxy requests to the
   configured client origin and preserves browser Origin checks.
3. Enable source capture in an approved maintenance change, then call its admin
   seed endpoint until `remaining=0`. Run delivery in both directions until
   contiguous receipts agree. Compare owner-scoped Project IDs, bytes, history
   and counts. Unknown owners and gaps must be resolved before proceeding.
4. Install the replication timer and its root-owned curl credential file as
   specified by the unit. Each tick reports `sent`, `caught-up`, `retry` or
   `blocked`; HTTP success alone is not convergence. Connect status/lag/capacity
   and timer-failure monitoring to an actually delivered alert.
5. Qualify off-host backup and restore for the whole stopped state directory,
   including sessions, Project journal, quota and receipts. Restore to a separate
   directory/port. Invalidate restored session state; reconcile Project cursors
   before writes. Preserve every acknowledged save when rolling back binaries.
6. Enable writes for a small verified cohort only after catch-up and recovery
   acceptance. ICP, HTTPS and public regional routing remain separate gates.

The profile does not provide operator simulation, Gallery synchronization,
automatic journal compaction, abandoned quota reclamation or account-deletion
propagation. These limits are visible deployment dependencies, not implemented
by pointing DNS at this service. Source activation also requires reviewing the
regional mode's disabled legacy operations in the Project contract.
