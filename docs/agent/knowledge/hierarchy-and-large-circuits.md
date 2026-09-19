# Hierarchy and repeated Cells

Use when editing a child Cell, reused definition or a circuit whose boundaries
matter more than a single page view. There is no instance-count threshold.

Read the Snapshot Project index and each relevant child's ordered formal
terminals. Match them to the parent instance pins. A terminal's owned Port
Instance and its Net are separate facts to verify, not inferred from its name.
Navigate without changing `topDocumentId`.

The Project index preserves authored Cell order. A reference's `targetKind`
distinguishes internal, external and unresolved calls; only an explicit internal
binding identifies `targetDocumentId`. Matching names do not establish a call.
Calls exist even with no Ports or wires. Missing optional classification on an
older server means unknown, not internal. External IDs refer to the Project's
`externalSubcircuitDefinitions`. Never repair bindings by guessing from names.

`reorder_documents` and `set_top_document` are existing `structureEdits`.
Reordering does not choose the default Top; changing Top does not rewrite a
saved simulation folder's entry. Explicit export/simulation roots remain separate.

Use existing `transact.command` (MCP `advanced_transact`) for
`bind-cell-parameter`, `rename-cell-parameter`, `set-cell-parameter-default`,
`remove-cell-parameter`, `rename-cell-terminal` and `remove-cell-terminal`.
Read the current schema and `commandKinds`; address the child `documentId` and
current `expectedStructureRevision`. These commands reuse GUI planners and
commit affected callers atomically. Parameter rename updates local references
and caller override keys, not the caller expressions themselves. Defaults are
Cell-owned, overrides instance-owned; clearing an override restores inheritance.
Removal rejects still-used parameters. Native expression syntax is unchanged.

For a Port rename, `mergeExistingPort: true` explicitly requests electrical
merging with an existing Port, including affected caller nets. Omitted/false
retains the planner's non-merging behavior. Removal retains disconnected parent
wire stubs as Junctions. These commands add no GUI confirmation and do not
replace or restrict raw typed edits. Reviewed PDK External interfaces retain
their existing constraints; edit supported instance parameters instead.

A reused child is one definition in several parent contexts. Before changing
its interface or internal meaning, inspect affected references; do not clone it
merely to simplify reasoning. Use the current `structureRevision` and the typed
structure-edit contract for interface changes.

Keep stable reusable Cells hierarchical when their terminals explain their
function. Enter the child for device-level work; flatten only as a deliberate
user-scoped change. Parent placement does not determine child semantics.

Review the changed child and affected parent contexts. In the parent render,
shared supply/bias/control relationships need a clear rail, boundary convention
or attached labels, not unexplained stubs or labels at every pin.
