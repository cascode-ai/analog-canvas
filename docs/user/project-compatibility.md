# Project File Compatibility

The current portable Project schema is `60`; the normalized editor model is
schema `58`. Supported files from schemas 24 through 60 enter through the same
validated reader. Historical input is upgraded or decoded before installation;
all current writers emit schema 60. See the
[file-format contract](../specs/project-file-format.md) for the authoritative
representation and compatibility boundary.

## Opening and saving

Use **Import Project File…** to open portable bytes, **File / Save** to save a
private Cloud Project, and **Export Project File…** for a portable backup.
Import/export does not silently overwrite the selected source file or establish
a Cloud Save baseline. An upgraded import needs an explicit save/export.

An unsupported, corrupt or ambiguous file is rejected before it replaces the
live circuit. Versions below the supported floor or above the current version
are not guessed into a usable shape. Some historical records also require a
located refusal: an ownerless electrical equivalence cannot safely be guessed
into a Wire, Label or interface. Keep the original file when reporting or
repairing an import failure.

## What travels with a Project

A Project carries its circuit topology, instances and parameters, referenced
component definitions, Cell interfaces, authored labels/drawing styles and
simulation source folders. Portable connection facts determine physical
membership; equal scoped Net/Port names retain their logical meaning without
physically merging independently drawn conductors. Import provenance alone
does not join Nets.

The authored device Reference is preserved. Netlist export can derive a
dialect-specific name, such as `XM1` for a SPICE subcircuit called `M1` on the
canvas; it does not rename the drawing. Text styling and literal display labels
do not create a second electrical identity.

Simulation source is not an embedded simulator or a guarantee of available
models. Run processes, receipts and numeric results do not travel in the Project
file; use the simulation result export for that evidence.

## Recovery and durability

Browser-local workspace restoration can reopen unsaved tabs and views after
refresh; bounded crash-recovery copies provide a separate safety net. Neither
replaces Cloud Save or a downloaded backup, and clearing site data can remove
both. Undo history, unfinished text-field edits and Agent credentials are not
portable Project content. See
[persistence and recovery](../specs/persistence-and-recovery.md) for storage,
history and failure boundaries.

The [compatibility corpus](../../fixtures/projects/compatibility-corpus.json)
protects current round trips, supported historical inputs and deliberate
rejections. Version-by-version implementation history belongs to the reader,
tests and Git, not a second user-facing schema definition.
