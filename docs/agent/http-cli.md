# Shared-client command line

This path is an explicit user choice, not an automatic recovery from failed
MCP host loading. Report the failed MCP stage before offering HTTP; successful
HTTP execution is not MCP acceptance.

HTTP uses the same server validation and permissions. The version-pinned package
in the MCP bootstrap manifest also runs without an MCP host: execute its binary
with --http followed by a published tool name (connect, connection_status,
get_context, etc.), supplying that tool's JSON arguments on standard input.
Use --http list-tools to discover argument schemas. Full per-tool contracts,
including legacy expression details, are available through --http resource
with `analog-canvas://contract/tools/{name}` on standard input. Use the same
resource command for quickstart and task-selected references.
This is a local entry into the same AgentSessionClient and operation registry, not
another network protocol. The package must be installed, but no MCP-host
configuration or restart is required. Each invocation is a new process:
persisted connector credentials survive, process-local context does not.
CLI invokes operations directly, not through the MCP handler; its existing JSON
content-block output and failure exit codes are retained for compatibility.
Both entries use the same validation, error classification and download logic.
Neither requires a source checkout, Git, pnpm or a local simulator. Node must
meet the installed package's runtime requirement. Local plotting additionally
needs Python >=3.10 and matplotlib; no dependencies are installed automatically.
Local result bases use explicit `basePath`, a saved server/Project location,
an explicitly configured `ANALOG_CANVAS_TASK_DIR`, then user application data.
The process working directory does not select a base. Files survive disconnect;
an explicit old base remains usable without migration or automatic overwrite.
Set ANALOG_CANVAS_API_URL to this exact server. The default connector file is
isolated by origin; ANALOG_CANVAS_MCP_CONNECTOR overrides a file path, never a token.
For caller-managed exact retries, --http circuit accepts the published Circuit
request unchanged, including its requestId and transactionId. Keep that request
before sending; after an uncertain process exit retry it unchanged, never repeat
a higher-level write tool that would allocate a new ID.
The shared client owns bearer refresh, credential storage, bounded HTTP retries
and verified downloads. Do not rebuild lifecycle in a wrapper. An uncertain exit
from a non-Circuit write needs reconciliation with resource state before retry;
`--http circuit` is not a generic simulation retry command.
Read [native authoring](shared/authoring.md) for circuit and result rules.
For raw HTTP rather than this shared client, obtain the independent workflow
from the exact origin's `/api/agent/kit`.
