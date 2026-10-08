# Install the Analog Canvas MCP adapter

Use `/api/agent/mcp-manifest.json` from the **exact editor origin**.
The manifest owns the version, runtime requirement, immutable archive,
SHA-256 and host setup commands. The package contains operating resources;
a source checkout is unnecessary.

When `installation.available` is true, follow its verified installation flow.
Check the downloaded archive's digest before executing it. The installer tests
local stdio readiness before updating the named host configuration, preserving
unrelated settings. Startup uses the installed local bundle; updating is explicit.
The launch names the Node that ran the installer; a Homebrew Node is named
through its formula's `opt` link, which follows `brew upgrade` of that formula.
Re-run the installer to replace a launch written with a versioned Cellar path.

For a host without direct installer support, use the manifest's configuration
mode and returned launch configuration. Do not infer flags from another version.
If installation is unavailable, follow the declared launch route; do not assume
an old package contains the installer.

Configuration success does not mean tools are loaded in this conversation.
Verify callable tools and `connection_status({refresh:false})` for runtime
version and API origin. If loading needs a host restart or new conversation,
tell the user once; do not restart automatically. Report the failed stage:
download, integrity, stdio readiness, host loading, pairing or editor readiness.

Connect with the human's claim, then follow the [quickstart](mcp-quickstart.md).
Later processes can resume the saved revocable connector without a claim.
Keep its storage private; `ANALOG_CANVAS_MCP_CONNECTOR` overrides a file path,
never a token. The default file, one per editor origin, belongs to the first
running MCP process that uses it, and a restart resumes it. Another MCP process
running at the same time neither resumes nor overwrites it: it keeps its own
connector in memory and needs its own claim, so parallel clients never drive
one page by accident. Give each parallel worker its own
`ANALOG_CANVAS_MCP_CONNECTOR` file to resume after a restart, or give several
one file to share a page on purpose. Disconnect or expiry revokes the session;
Project switches do not.
A local probe is not live-session acceptance: inspect the authorized context
and complete the requested operation, including results for simulation.

Use HTTP only when the user chooses it. The same-origin `/api/agent/kit`
provides its independent caller workflow. HTTP success does not prove MCP loading.
