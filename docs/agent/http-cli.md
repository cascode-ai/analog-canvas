# Shared-client command line

Use when the user chooses the installed CLI. Bootstrap fallback in the copied
handoff means the **raw HTTP Kit**, not this Node-dependent command. Follow
the [connection rules](shared/session.md#connection).

The version-pinned package from the MCP bootstrap manifest runs without an MCP
host: run its binary with `--http <tool>` (connect, connection_status,
get_context, …) and the tool's JSON arguments on standard input.
`--http list-tools` lists argument schemas; `--http resource` with a URI on
stdin reads `analog-canvas://contract/tools/{name}`, the quickstart and other
references. It is the same AgentSessionClient, operation registry, validation,
error classification and download logic as MCP, with JSON content-block output
and failure exit codes. It needs the installed package and its Node version,
but no host configuration, checkout or simulator; plotting needs Python ≥3.10
and matplotlib (nothing is installed automatically).

Each invocation is a new process: connector credentials persist, process-local
context does not. Set `ANALOG_CANVAS_API_URL` to the exact server. The
connector file is per origin; `ANALOG_CANVAS_MCP_CONNECTOR` overrides its path
(never a token). CLI commands share the default file without taking a running
MCP process's lease; give parallel CLI tasks their own connector files.

A `project_cells` `bind-workspace` target persists only when
`ANALOG_CANVAS_TASK_DIR` names an absolute task directory (one per task, apart
from credentials); otherwise CLI binding is rejected. Tab switches do not
retarget it; a closed or replaced copy fails closed (`bind-workspace` with
`workspaceId:null`, then choose another); a new Claim clears it. Result bases
follow the MCP rules, never the working directory.

For caller-managed exact retries, `--http circuit` takes the published Circuit
request unchanged, including requestId and transactionId: keep it before
sending and, after an uncertain exit, retry it unchanged rather than a
higher-level write that allocates a new ID. It is not a simulation retry
command: an uncertain non-Circuit write needs reconciliation first. The client
owns bearer refresh, credential storage, bounded retries and verified
downloads; do not rebuild them. Circuit rules: [native authoring](shared/authoring.md).
For raw HTTP, use the exact origin's `/api/agent/kit`.
