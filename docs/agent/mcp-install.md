# Install the Analog Canvas MCP adapter

Analog Canvas ships a self-contained Node.js stdio MCP package. Its tools,
server instructions, quickstart, authoring contracts, built-in catalog, and
recovery references are compiled into the package; an Agent does not need a
source checkout.

The editor's **Copy message** handoff prefers a compatible MCP and asks the
Agent to install or update it when missing or incompatible. It includes a
one-time Claim and the public bootstrap manifest:

    https://analog-canvas.tokenzhang.com/api/agent/mcp-manifest.json

The manifest is the machine-readable distribution authority. It declares the
current version, Node requirement, immutable GitHub Release asset, SHA-256,
version-pinned package, host setup snippets, and an explicitly selected HTTP path.
Node.js 24 or newer is required; the one-time installer also uses `tar` to read
the verified bundle from its archive (available on current Windows/macOS/Linux).

The declared SHA-256 belongs to the canonical Linux-built GitHub Release
tarball. Local development tarballs built on another operating system may have
different archive metadata without changing the bundled MCP program.

## Install once, launch offline

Use the manifest from the **exact editor origin**, including Preview when that
is where the circuit is open. When `installation.available` is true, download
its immutable release archive, verify SHA-256, extract the bundle, then run:

    node <verified-bundle.mjs> --install --origin <exact-editor-origin> --host codex

The installer downloads and verifies the declared package, installs it under
`~/.analog-canvas/mcp/`, and runs actual stdio `initialize` / `tools/list` with
an unreachable relay origin. Runtime version must match the manifest and the
connection/context/simulation tools must exist. Only then does it back up and
update the named Codex MCP configuration, preserving unrelated host settings.
The saved command is an absolute Node path plus a local bundle path, with an
explicit `ANALOG_CANVAS_API_URL`. Ordinary startup does not use `npx`, GitHub,
or npm. Updating is an explicit re-run of installation, not a startup download.

For Claude Code, Cursor or another host, use `--host config`; copy the returned
`launch` object into that host's named MCP entry. This mode does not change host
configuration. The manifest's legacy `launch` / Cursor snippet remains a
compatibility option, not the recommended steady-state installation route.

Immutable releases through 0.15.1 lack the installer; the manifest marks it
unavailable for them. Source changes are not a new published distribution.
Do not invoke `--install` against those old packages. Publish and verify a new
release before enabling this route for hosted users.

The GitHub Release is always usable. When the same version is also published
to npm, a later distribution declaration may switch the launch source without
changing MCP tools or the Agent session protocol.

The first `connect` call takes the Claim Code copied from the editor. Later
MCP processes call `connect` without a code: the Helper reads the revocable
connector from the user's `.analog-canvas/connectors/<origin-hash>.json` and obtains a new
short-lived bearer. Set `ANALOG_CANVAS_MCP_CONNECTOR` only when the host needs
a different private credential location.

The connector remains bound to one browser-authorized Project/session. The
editor's **Disconnect** action or the MCP `disconnect` tool revokes it.
Closing the connection details does not disconnect it. Project replacement
also revokes it.

Check runtime requirements, package integrity and the exact target origin;
preserve unrelated host configuration. Respect a user's refusal and host
permission limits. Configuration success is not proof that tools are loaded:
verify tools are callable and compatible in the current conversation.

If a host cannot load a newly configured MCP process in the current
conversation, tell the user once that a host restart or new conversation may
be needed; do not restart it automatically. Report the failed stage: download,
integrity, local stdio readiness, host loading, pairing or editor readiness.
Use `GET /api/agent/kit` only when the user explicitly chooses HTTP;
never count this as MCP acceptance or silently mask a broken host installation.
If the Claim expires during setup, request a fresh code. The Kit is a
same-source fallback, not a second product protocol: it teaches the Agent to
use the existing four-capability
HTTP API without guessing raw requests.

`connection_status({"refresh":false})` reports runtime version and exact API
origin without contacting the relay. The normal refreshed status additionally
reports session observations. Neither a local probe nor installed configuration
proves the tools are callable in the current Agent conversation. Final host
acceptance must call actual MCP tools: status, claim/resume, context and one
requested operation; a simulation acceptance must retrieve the completed result.

For a deployment check, `pnpm release:verify` builds the browser release,
bundles and packs MCP, and runs a local golden path covering initial claim,
inspection, atomic edit, verification, render, export, staged import, process
restart, and connector resume.

Package smoke also reads a complete captured Spec response through the adapter's
actual HTTP response validator. Run `node scripts/mcp-release-smoke.mjs <executable>`
against an independently downloaded/verified executable, not just its source build.
Preview's public MCP journey downloads the exact package in the served manifest,
verifies its SHA-256, and records its distribution identity in the acceptance receipt.
It must not fall back to the locally built adapter when that package fails.
The journey defaults to the published package on either hosted channel. An
explicit `ICM_ACCEPTANCE_MCP_SOURCE=built` is available for local development;
its receipt says `source: built` and is not distribution acceptance.

The published 0.10.0 package predates Spec reports and rejects
`outputData.specs`. MCP 0.11.0 carries the converged Simulation contract and
captured Spec support but predates Project schema 56 electrical Wire styles.
Those immutable assets cannot be replaced. MCP 0.12.0 adds schema 56 support
while retaining the Spec contract. MCP 0.13.0 adds relay Session status and
the host-independent `--http` entry using the same shared client. Each new version is published through
Publish MCP with its verified Linux tarball hash pinned in the distribution
declaration, then passes public-package Preview acceptance. Local compilation
with an old version label is not a distribution update.
