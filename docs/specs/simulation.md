# Simulation Folders and Compilation

Status: accepted

Owners: `packages/model`, `packages/netlist`, `packages/simulation-service`,
`apps/editor/src/features/simulation`

Related decision: [ADR 0055](../adr/0055-simulation-is-part-of-the-product.md).

## Contract map

- [Code Workspace](simulation-code-workspace.md) owns source authoring,
  generated circuit boundaries, the version-4 source input, configuration, language
  assistance, migration and the Code/Properties dock.
- [Execution and resources](simulation-execution.md) owns Profiles, preparation,
  isolation, admission, lifecycle, retention, artifacts and qualification.
- [Numeric results](simulation-results.md) owns rawfile records, units, validity,
  measurements and CSV.
- [User workflow](../user/analog-simulation.md) describes the interaction.

Project schema 50 writes **source-only** simulation folders. A folder has a stable id/name,
an authored entry and configuration path, authored virtual files, generated
Canvas circuit bindings and declared dependencies. There is no persistent
structured/raw choice or parallel analyses/form state. The schema-48 reader
converts older inputs to source; the schema-49 reader renames the collection
to `simulationFolders`, retaining IDs and source bytes. Historical
schemas and the old structured compiler remain internal migration/qualification
oracles, not current Project writers or separate public execution paths.

All folders share Project save/load, structure revision, Undo/Redo and cloud
ownership. Invalid source syntax and unresolved references remain saveable.
Unsafe paths, duplicate ownership and invalid outer Project structure do not.
Model bytes, generated text, prepared decks, runs, receipts and results are
not persisted as another folder authority.

## Compilation and circuit ownership

`compileSourceSimulation` and the shared service's
`prepareSourceExecutionInput` consume one Project/folder snapshot.
They reuse electrical extraction, ordinary SPICE printing, terminal-current
instrumentation, expression evaluation and managed Run Plan projection.

A `top-level` binding prints an already drawn Testbench's root cards and
reached definitions; it does not invent another DUT call. A `subcircuit`
binding prints definitions; authored text owns the calls, stimuli and loads.
A purely textual experiment needs no Canvas binding. None of these operations
changes `project.topDocumentId`.

Generated circuit topology, model/device identity and interfaces remain
Canvas-owned. Editable numeric spans are derived from printer locations.
Edits to those spans use the existing Instance-parameter transaction; a paste
that also changes connectivity is refused atomically. Authored files remain
native ngspice, including commands outside the local checker's understanding.
The compiler never round-trips free control through a structured analysis form.

GUI and Agent use the same File Resource. One update can atomically apply
authored text and digest-guarded generated parameter edits. Old source or
Project revisions return a repairable conflict rather than overwriting another
writer. Prepare and Run capture committed source; File Save/Export and Check
and Save first save the human code buffer into that same Project snapshot.
Valid generated-parameter edits update Instances atomically; unfinished edits
remain explicit, unapplied drafts. These drafts are saveable but prevent
preparation until applied or discarded, so Run never silently uses stale values.

Profile selection, output expressions, saved measurements, value-free variable
bindings and managed Run Plan are authored in the configuration file. Nominal
variable values are native `.param` text, nominal temperature is `.temp`.
Point values project only into the immutable execution snapshot. An exact
parameter axis applies after a variable axis; it is not a new stored override.

## Acquisition and identity

Output ids and labels are durable authored presentation. Object acquisition
uses an explicit binding/call scope plus the existing Cell occurrence and
terminal/Route/Junction/Base-Net anchor. Native vector expressions remain
available without pretending they can be painted back onto Canvas.

Terminal-current acquisition inserts deterministic 0 V sense sources into
prepared IR only. Positive current enters the selected terminal. This supports
passive, MOS/BJT, independent-source and Cell-instance terminals without guessing
model-specific `i(m1)` names. Hierarchy references follow actual occurrences,
not a global spelling match.

| Acquisition | Example ngspice vector |
| --- | --- |
| Root Net | `v(mid)` |
| Nested Net | `v(x1.xi1.mid)` |
| Root terminal sense source | `i(vicmprb001)` |
| Nested terminal sense source | `i(v.x1.xi1.vicmprb001)` |

Canvas acquisition declarations are inspectable generated `.save` text.
Native vector leaves refer to what the authored program actually captures.
Default templates issue `write out.raw` after each analysis with ASCII and
appendwrite enabled in a fresh execution directory. Noise captures both its
density and integrated records. Missing captures are diagnosed, never repaired
by an invisible final write. Exact collection and repeated-record limitations
are defined in the Code Workspace and results contracts.

Input identity covers authored bytes, configuration, generated electrical
content, bindings, dependencies and effective conditions. Results retain their
own captured mappings and labels; later edits mark them stale instead of
remapping historical numbers. Repeated records are not identified by Plotname
or analysis kind. Canvas OP and cross-run comparisons require a record choice
when more than one candidate exists.

## Device values and simulation syntax

Ordinary drawn voltage/current sources own DC, AC and transient parameters.
The device descriptor/printer is still the common authority for Properties,
mapped source edits and Agent parameter edits. A transient PULSE/SIN/PWL does
not disable AC: they describe different analyses on the same source.

- DC uses `dc`.
- AC uses `acMagnitude` and optional `acPhase` in degrees (default zero).
- `waveform` explicitly selects the transient representation; the presence
  of a period or timing field does not implicitly change the mode.
- PULSE, SIN and PWL use the existing formal source parameters. Text-authored
  sources may use native ngspice syntax directly.

SPICE prints `DC <dc> AC <magnitude> <phase>` plus the selected waveform.
Spectre structural export prints the same device facts in its own syntax.
A phase without a magnitude is not emitted. VDD, GND and Net labels remain
connectivity markers, not energy sources.

The current qualified analysis set is supplied by the selected Profile, not
by a GUI enumeration. OP/DC/AC/TRAN/Noise use the existing numeric adapters.
Literal point/output estimates are advisory; symbolic native programs remain
native. Missing vectors, unit errors and unavailable measurements affect their
own outputs, not the entire Agent session. Actual executor safety and capacity
limits still apply.

## Delivery evidence

Focused source, migration, File Resource, service and browser tests demonstrate
protocol/UI behavior. Mocked browser success does not certify model numbers.
The same-candidate GUI and real MCP/ngspice numerical journeys, and full
delivery gates, remain explicit Code Workspace acceptance requirements.
