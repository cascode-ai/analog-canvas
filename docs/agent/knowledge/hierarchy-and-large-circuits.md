# Hierarchy and repeated Cells

Use when editing a child Cell, reused definition or a circuit whose boundaries
matter more than a single page view. There is no instance-count threshold.

Read the Snapshot Project index and each relevant child's ordered formal
terminals. Match them to the parent instance pins. A terminal's owned Port
Instance and its Net are separate facts to verify, not inferred from its name.
Navigate without changing `topDocumentId`.

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
