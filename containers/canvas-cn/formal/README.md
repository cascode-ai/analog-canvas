# Restricted regional Canvas candidate

This opt-in profile implements the [Project contract](../../../docs/specs/regional-projects.md)
with [regional sessions](../../../docs/specs/regional-login.md). It is separate
from both acceptance datasets and is not installed or activated by a code push.
The entry uses the common Canvas router and regional sessions. Its local
bindings cover Gallery, User Components, Agent, topology, analytics, Projects
and simulation storage. Route availability does not certify resource replication
or an operator connection; the restricted trial's acceptance remains Issue #1974.

## Preparation

- Build `bundle.jsonc` using the repository-pinned Wrangler with `deploy --dry-run
--outdir <absolute-private-release>/worker`. It bundles `worker/regional-entry.ts`;
  rename the generated `regional-entry.js` to `index.js`. Never invoke a real
  deploy for this profile. Separately dry-run `egress-bundle.jsonc`, then place
  its bundled `egress.js` as `egress.mjs` beside `config.capnp`. The raw egress
  source imports the shared Auth route contract and cannot be copied unbundled.
- Build the editor into the release's `assets/`. Install `nginx.conf` for the
  browser proxy and separate static-asset listener; both bind only to loopback.
- Run `node containers/canvas-cn/formal/prepare-artifacts.mjs <private-release>`
  and copy `artifact-storage.capnp` beside the main configuration. The script
  copies the installed, pinned Miniflare storage modules and records their
  hashes and upstream metadata. These modules provide the native R2-compatible
  artifact binding; no Miniflare development server or storage control endpoint
  runs. Preserve their license and include both blob files and metadata in backup.
- Use the pinned workerd binary from the [standalone runtime](../README.md).
  Namespace keys and state paths in `config.capnp` are persistent identities.
  One process owns each directory. Never copy trial accounts into formal state.
  This profile starts from an empty formal store. Startup refuses an earlier
  separate Project namespace; migrate and verify its complete Project/journal/
  quota state before adopting the shared Gallery store. Never discard that
  directory to bypass the check.
- The service's `LoadCredential` entries enumerate required private files.
  Write token and URL files without trailing newlines. `regional-client.json`
  follows the Auth contract; its secret and `identity-token` must agree. Inbound,
  outbound and admin synchronization credentials are separate. The opposite
  region uses the corresponding inbound token for its outbound delivery.
- `project-region-users.json` contains the private, confirmed original account
  IDs. Use the same cohort at the source, following the Project contract.
- Set `PROJECT_REGION=overseas` only on a reviewed source candidate; the
  [Project contract](../../../docs/specs/regional-projects.md) reuses its existing
  singleton. Leave `PROJECTS` unbound at the source. The unmodified overseas
  configuration remains disabled.
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
   The first restricted trial uses a localhost SSH entrance and the existing
   overseas business origin. Same-domain TLS and geographic routing belong to
   the later public-opening rehearsal.
2. Install the formal service under its dedicated Unix user and prepare its
   state directory. Keep `PROJECT_WRITES_ENABLED=false`; the loopback entry is
   accessible through SSH. The entry normalizes trusted proxy requests to the
   configured client origin and preserves browser Origin checks.
3. Enable scoped source capture in an approved maintenance change, then call its admin
   seed endpoint until `remaining=0`. Run delivery in both directions until
   contiguous receipts agree. Compare owner-scoped Project IDs, bytes, history
   and counts. Unknown owners and gaps must be resolved before proceeding.
4. Install the replication timer and its root-owned curl credential file as
   specified by the unit. Each tick reports `sent`, `caught-up`, `retry` or
   `blocked`; HTTP success alone is not convergence. Connect status/lag/capacity
   and timer-failure monitoring to an actually delivered alert. The private
   region actively pulls and pushes; the source needs no inbound domestic URL.
5. Qualify off-host backup and restore for the whole stopped state directory,
   including sessions, Project journal, quota, receipts and artifact storage.
   Restore to a separate directory/port. Clear restored regional sessions and
   pending handoffs before connecting it to the authority; reconcile Project cursors
   before writes. Preserve every acknowledged save when rolling back binaries.
6. Enable writes for a small verified cohort only after catch-up and recovery
   acceptance. ICP, HTTPS and public regional routing remain separate gates.

The profile does not provide operator simulation, Gallery synchronization,
automatic journal compaction, abandoned quota reclamation or account-deletion
propagation. These limits are visible deployment dependencies, not implemented
by pointing DNS at this service. Source activation also requires reviewing the
regional mode's disabled legacy operations in the Project contract.
