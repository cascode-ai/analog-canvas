Connect to Analog Canvas at {{origin}}.
Claim: {{claim}}

I authorize MCP first, with raw HTTP Kit fallback before pairing; respect MCP-only requests.

1. If MCP is callable for this exact origin, check `connection_status({"refresh":false})`, connect, then read analog-canvas://reference/quickstart. No download needed.
2. Otherwise install once only with evidence this host can run/register stdio here; shell/npm alone is insufficient. Check Node before executing the pinned package. Manifest: {{manifestUrl}}
Use its host-specific setup, verify SHA-256 and preserve unrelated settings. Local handshake is not host loading: verify callable tools.
3. Unknown host, unsuitable Node, download/startup failure or unloaded tools: report the stage, keep any installation and use the raw HTTP Kit and its OpenAPI: {{kitUrl}}
The HTTP CLI still needs Node. No system Node upgrade or host restart. If HTTPS requests cannot run, report that blocker.

Stop on integrity/identity failures. Retry transient public GETs at most once. Choose one transport before Claim; recover an uncertain Claim through session rules, never by switching transport. Expired Claim: ask for a new code; revoked/permission errors follow session recovery.
Report connected only after pairing and read the actual circuit; name MCP or HTTP. HTTP success is not MCP acceptance.
Keep Claim private and Editor open. Loopback requires the Editor's computer.
