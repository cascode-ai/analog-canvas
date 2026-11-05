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
before updating the named host configuration and keeps unrelated settings. The
launch names the Node that ran the installer (a Homebrew Node through its
formula's `opt` link; re-run to replace a versioned Cellar path). Updating is
explicit. Without installer support, use the manifest's configuration mode and
launch configuration; never infer flags from another version or assume an old
package has the installer.

Configuration success does not mean tools are loaded in this conversation:
verify callable tools and `connection_status({refresh:false})` (version, API
origin). If loading needs a host restart or new conversation, tell the user
once, retain the installation and use authorized HTTP for this connection.
Leave host restarts to the user. A local probe is not acceptance: complete
the requested operation.

Installer failures return `ok:false`, `stage`, `code`, a safe `message`,
`nextAction` and bounded `evidence` (HTTP status, system code or runtime facts).
The stage identifies arguments/runtime, manifest, download, integrity,
extraction, local probe or host configuration. `use-http-kit` is a recovery
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

Connect with the human's claim, then follow the [quickstart](mcp-quickstart.md).
Later processes resume the saved revocable connector without a claim; keep it
private. `ANALOG_CANVAS_MCP_CONNECTOR` overrides its file path, never a token.
The default file (one per origin) belongs to the first running MCP process that
uses it and a restart resumes it; a concurrent process keeps its own connector
in memory and needs its own claim, so parallel clients never drive one page by
accident. Give each parallel worker its own connector file, or share one file
to share a page on purpose. Disconnect or expiry revokes the session; Project
switches do not.

Automation that opens the editor itself (a headless browser driving batch
workers) opens `/editor?agent=pair`: the page connects on load as **Connect
Agent** does, without the panel, and `await window.analogCanvasAgent.claimCode()`
returns its claim. It rejects when the page is already paired, connecting
failed or the claim expired; a page that resumed its pairing keeps it. Never
put the claim in a URL, storage or log.

The same-origin `/api/agent/kit` supplies the raw HTTP workflow and links its
OpenAPI. It needs neither the adapter package nor Node.
