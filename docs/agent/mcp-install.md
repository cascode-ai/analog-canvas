# Install the Analog Canvas MCP adapter

Use `/api/agent/mcp-manifest.json` from the **exact editor origin**. It owns
the version, runtime requirement, immutable archive, SHA-256 and host setup
commands; no source checkout is needed.

Prefer already-callable tools for the exact origin. Missing tools are normal
on a new machine. Install only with evidence that this conversation's actual
host supports stdio and reads the configuration you can update. Shell/npm,
an executable or a config file alone is insufficient. For an unknown host,
use the authorized raw HTTP path under the [connection rules](shared/session.md#connection).

Check the Node that will launch the adapter before downloading/executing it.
If it is absent or below the manifest requirement, use raw HTTP without
upgrading the system runtime. The generic installation command returns a local
launch object; select `hosts.codex` only for a confirmed Codex host. Other
hosts use their documented registration boundary, preserving unrelated settings.

When `installation.available` is true, follow its verified installation: check
the archive digest before executing; the installer tests stdio readiness
before updating the named host configuration and keeps unrelated settings.
The installer refuses redirects for the manifest and editor-origin archive.
Regional install commands verify the exact archive bytes before loading any
archive code. In Cursor use the resulting local launch for a regional install;
the manifest's legacy launch keeps the permanent release URL.
Every host registers each site under one stable name derived from the exact
origin: the manifest's `name`, its Cursor entry and the installer's
`serverName`. Codex installs update only that origin's registration; for
Claude Code run the installer's `hosts.claudeCode.command` (`claude mcp add
<serverName>` with the verified local launch). Other origins and legacy
`analog-canvas` registrations remain intact. Use the name as the host's
resource alias. A running adapter keeps its startup origin; disconnecting or
supplying another Claim does not retarget it, and another site's Claim is
refused (`CLAIM_WRONG_SITE`) naming the bound origin: use the server
registered for the address in the copied connection message. Without
`ANALOG_CANVAS_API_URL` an adapter binds to the overseas site and says so in
`connection_status` (`runtime.apiOriginSource: "default"`) and its
instructions. The launch names the Node that ran the installer (a Homebrew
Node through its formula's `opt` link; re-run to replace a versioned Cellar
path). Updating is explicit. Without installer support, use the manifest's configuration mode and
launch configuration; never infer flags from another version or assume an old
package has the installer.

In the web editor, open **Agent → Codex setup**. On a site serving the
verified archive, select **Include the Canvas review shortcut** to install MCP
and the optional skill with one command (`hosts.codex.reviewCommand`). It
installs the skill under `~/.agents/skills/canvas-review` and preserves a
skill already at that path. The MCP registration is per site and the skill
can use any matching registration. Invoke `$canvas-review` in a Codex chat,
or pick it through `/skills` in Codex CLI. Include the source path and,
optionally, the Cell and Web or image preference. Plain-language requests
continue to use the same MCP workflow.

Configuration success does not mean tools are loaded in this conversation:
verify callable tools and `connection_status({refresh:false})` (version, API
origin). If loading needs a host restart or new conversation, tell the user
once, retain the installation and use authorized HTTP for this connection.
Leave host restarts to the user. A local probe is not acceptance: complete
the requested operation.

Installer failures return `ok:false`, `stage`, `code`, a safe `message`,
`nextAction` and bounded `evidence` (HTTP status, system code or runtime facts).
The stage identifies arguments/runtime, manifest, download, integrity,
extraction, local probe, host configuration or optional Skill setup.
`skill-config` means MCP was registered and the optional Skill needs
attention. `use-http-kit` is a recovery
suggestion subject to the connection request's authorization; `stop` requires
addressing the refusal. Older packages can return plain text; report only
observed facts and never assume they implement newer flags or fields.

Public network reads allow one extra attempt for transient failures within
their request timeouts. Respect the installer's retry bound rather than
rerunning it in an outer loop. Package-host failure does not imply Editor
failure: the handoff's Kit URL is independently usable. When a browsing tool
fails, an available HTTPS execution tool may still work. If the Editor origin
remains unreachable or HTTP requests cannot run, report that blocker and one
next action. Never include claims, tokens, raw environment dumps or Project
data in diagnostics.

For a new task in Codex or Claude Code, call `open_canvas`: it opens Canvas
in the system browser. Follow the [quickstart](mcp-quickstart.md) for
approval, trusted devices, task references and reconnects. The connector requires Node, the system browser,
and access to the configured Canvas site and relay. Offline drawing uses the
[optional local engine](https://github.com/cascode-ai/analog-canvas/blob/main/docs/agent/local-workspace.md).

For a manual pairing, connect with the human's Claim.
Later processes resume the saved revocable connector without a claim; keep it
private. `ANALOG_CANVAS_MCP_CONNECTOR` overrides its file path, never a token.
The default file (one per origin) belongs to one running MCP process at a
time. `connect` without a claim takes it over, even from another running
process (an abandoned chat's adapter never blocks a new one); that process
then gets `SESSION_TAKEN_OVER` naming the taker's pid. A process connected
with a claim while another holds the file keeps its connector in memory. Give
each parallel worker its own connector file, or share one file to share a page
on purpose. A Claim connects one adapter: parallel chats each open their own
editor tab and connect with its Claim. A reused Claim is
`CLAIM_ALREADY_REDEEMED`; an adapter replaced by a later redemption or a
takeover gets `SESSION_TAKEN_OVER` and needs its own tab and Claim (or
`connect` without one to take the connection back). Disconnect or expiry
revokes the session; Project switches do not.

Automation that opens the editor itself (a headless browser driving batch
workers) opens `/editor?agent=pair`: the page connects on load as **Connect
Agent** does, without the panel, and `await window.analogCanvasAgent.claimCode()`
returns its claim. It rejects when the page is already paired, connecting
failed or the claim expired; a page that resumed its pairing keeps it. Never
put the claim in a URL, storage or log.

The same-origin `/api/agent/kit` supplies the raw HTTP workflow and links its
OpenAPI. It needs neither the adapter package nor Node.
