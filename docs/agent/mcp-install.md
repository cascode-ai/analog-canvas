# Install the Analog Canvas MCP adapter

Analog Canvas ships a self-contained Node.js stdio MCP package. Its tools,
server instructions, quickstart, authoring contracts, built-in catalog, and
recovery references are compiled into the package; an Agent does not need a
source checkout.

The editor's **Copy to Agent** handoff prefers a compatible MCP and asks the
Agent to install or update it when missing or incompatible. It includes a
one-time Claim and the public bootstrap manifest:

    https://analog-canvas.tokenzhang.com/api/agent/mcp-manifest.json

The manifest is the machine-readable distribution authority. It declares the
current version, Node requirement, immutable GitHub Release asset, SHA-256,
version-pinned launch command, host setup snippets, and Agent Kit fallback.
Node.js 24 or newer is the only runtime requirement.

The declared SHA-256 belongs to the canonical Linux-built GitHub Release
tarball. Local development tarballs built on another operating system may have
different archive metadata without changing the bundled MCP program.

For Codex, the equivalent first-time command is:

    codex mcp add analog-canvas -- <the manifest launch command>

For Claude Code:

    claude mcp add analog-canvas --scope user -- <the manifest launch command>

On native Windows, Claude Code wraps an `npx` launch with `cmd /c`; the
manifest supplies that exact command. Cursor consumes the manifest's
`hosts.cursor.config` object as its user-level MCP configuration.

The GitHub Release is always usable. When the same version is also published
to npm, a later distribution declaration may switch the launch source without
changing MCP tools or the Agent session protocol.

The first `connect` call takes the Claim Code copied from the editor. Later
MCP processes call `connect` without a code: the Helper reads the revocable
connector from the user's `.analog-canvas/connector.json` and obtains a new
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
be needed; do not restart it automatically. Continue the current task through
`GET /api/agent/kit` when installation is declined, blocked or cannot load now.
If the Claim expires during setup, request a fresh code. The Kit is a
same-source fallback, not a second product protocol: it teaches the Agent to
use the existing four-capability
HTTP API without guessing raw requests.

For a deployment check, `pnpm release:verify` builds the browser release,
bundles and packs MCP, and runs a local golden path covering initial claim,
inspection, atomic edit, verification, render, export, staged import, process
restart, and connector resume.
