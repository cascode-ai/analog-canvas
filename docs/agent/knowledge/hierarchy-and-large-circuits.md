# Hierarchy and repeated Cells

For editing a child Cell, a reused definition, or a circuit whose boundaries
matter more than one page view.

Read the Snapshot Project index and each relevant child's ordered formal
terminals and match them to the parent instance pins; a terminal's owned Port
Instance and its Net are separate facts, not inferred from its name. Navigate
without changing `topDocumentId`. The index keeps authored Cell order. A
reference's `targetKind` distinguishes internal, external and unresolved calls;
only an explicit internal binding identifies `targetDocumentId` (missing
classification from an older server means unknown). Calls exist without Ports
or wires; external IDs refer to `externalSubcircuitDefinitions`. Never repair
bindings by guessing from names.

`reorder_documents` and `set_top_document` are `structureEdits`. Reordering
does not choose the Top; changing Top does not rewrite a simulation folder's
entry; explicit export/simulation roots stay separate.

`transact.command` (MCP `advanced_transact`) carries `bind-cell-parameter`,
`rename-cell-parameter`, `set-cell-parameter-default`, `remove-cell-parameter`,
`rename-cell-terminal`, `remove-cell-terminal`, `set-cell-symbol-pins` and
`set-cell-symbol-size`
([authoring](../shared/authoring.md#cell-pins-and-supplies)). Read the schema and
`commandKinds`; address the child `documentId` at the current
`expectedStructureRevision`. They reuse GUI planners, commit affected callers
atomically and add no confirmation. Parameter rename updates local references
and caller override keys, not caller expressions. Defaults are Cell-owned,
overrides instance-owned; clearing an override restores inheritance; removal
rejects a used parameter. A Port rename with `mergeExistingPort: true` merges
with an existing Port and its caller Nets (otherwise no merge); an unstyled
renamed Port label takes the new name's placed look (`rfp` → `vrfp` drawn
V_rfp). Removal keeps disconnected parent wire stubs as Junctions. Reviewed PDK
interfaces keep their constraints: edit instance parameters instead.

A reused child is one definition in several parents: inspect affected
references before changing its interface or meaning, never clone it to
simplify reasoning, and flatten only as a deliberate user-scoped change.

Source-defined external circuits are in Snapshot `modelSources` and
`externalSubcircuitDefinitions[].implementation`; read the owner revision,
entry and files, then follow [external model sources](../shared/authoring.md#external-model-sources).
Overrides and symbol metadata stay ordinary typed edits; mapped File Resource
edits write the shared owner.

Review the changed child and affected parents. In a parent render, shared
supply/bias/control relationships need a clear rail, boundary convention or
attached labels, not unexplained stubs or labels at every pin.
