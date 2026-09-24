Connect to Analog Canvas at {{origin}}.
Claim: {{claim}}

1. If Analog Canvas MCP is callable, check `connection_status({"refresh":false})` for this exact origin, then connect with the Claim. Connect checks compatibility and returns current context; read analog-canvas://reference/quickstart. Do not fetch a package merely to connect.
2. If MCP is missing, targets another origin, or connect reports incompatibility, fetch the public bootstrap manifest over HTTPS: {{manifestUrl}}
   Follow its version-pinned package, runtime, integrity, and host installation instructions. Use verified local installation and its returned launch command when available; preserve unrelated host settings. Verify the tools are callable in this conversation before claiming success. Respect permission limits; do not retry indefinitely.
3. If manifest retrieval, installation, or host loading fails, report the failed stage. A host restart or new conversation may be needed; tell the user once, but do not restart it yourself. Do not silently switch to HTTP. Only if the user explicitly chooses HTTP, fetch {{kitUrl}} and follow its Kit and published OpenAPI; HTTP success is not MCP acceptance.

Keep the Claim private. If it expires, ask for a new code. Keep the Editor open. For a loopback origin, run on the Editor's computer.
