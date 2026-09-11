# Simulation Integration: Remaining Work

Status: proposed

Owners: editor/Project services, simulation integration, and release owners;
each execution target must name its accountable implementer.

## Boundary

The accepted [Code Workspace target](../specs/simulation-code-workspace.md)
owns the C0 source-authoring decisions and C1–C5 implementation/acceptance
boundaries. Its contract is frozen, not delivered. It replaces the settings
authoring shell without relaxing the integration and qualification obligations
below. The disposable dock prototype still needs user acceptance before UI
cutover; lifecycle/compiler work need not wait for pixel-level layout choices.

The product already has named saved setups, structured/raw preparation,
OP/DC/AC/TRAN/Noise, qualified SKY130 corners, outputs and measurements, runtime
isolation, and managed Preview execution. Their current contracts are in
[simulation](../specs/simulation.md) and [deployment](../deployment.md).
Do not reimplement them from a historical work-package description.

This plan retains the integration and acceptance obligations that are not
closed merely by those modules existing. It does not assert that a remote
issue is open or closed; the candidate's evidence decides completion.

## 1. Cross-Project reuse acceptance closure

Cross-Project reuse is implemented through the Editor's **Import Cell** flow
and the Agent's `project_cells` resource. Both call the same atomic planner and
import a local, independent Cell closure rather than creating a live reference
to another Project. The closure includes called Cells, formal interfaces and
pin order, presentation, netlist bindings, source/provenance, and required
symbol locks. The source stays unchanged and later edits do not synchronize the
copies.

The remaining work is integrated acceptance of that implementation, not a new
Project store, library protocol, or second import path.

Acceptance:

- Inspect an authorized saved source Project and select a DUT Cell through
  ordinary public UI/Agent entry points, without database or filesystem access.
- Import its complete dependency closure with deterministic ID/name remapping.
  Handle repeated imports, repeated child names, unsupported dependencies,
  capacity limits, missing read authority, and stale destination revision.
- Place a previously uninstantiated top Cell, including one without source
  binding. Review its formal-interface-derived symbol without a dummy instance;
  do not persist an invented default presentation.
- Create a Testbench, place one or more DUT occurrences, and retain independent
  occurrence mappings. Project top remains unchanged; the setup names its root.
- Preserve interface update/rename/reorder/delete behavior and caller
  consistency. Reject hierarchy cycles; do not conflate two reused occurrences.
- Save/reload and undo/redo the operations through existing Project transactions.

Project roster and Cell retrieval already wrap the authorized Cloud Project
service. Any later create/save/rename/delete exposure must continue to wrap
existing shared services. Do not build another Cloud Project store, broad file
API, or Library/Cell/View platform. Capability absence must be explicit;
simulation execution authority does not implicitly authorize Project
management.

## 2. One-candidate vertical acceptance

The integration owner selects one candidate SHA and performs the complete
journey through the supported Preview GUI and public MCP/client resources.
Separate passing tests from different commits do not constitute this evidence.

Required journey:

1. Inspect/import/place a named saved SKY130 five-transistor OTA DUT, construct
   its ordinary Testbench and sources, and author OP plus AC in a saved setup.
2. Prepare, inspect the deck and bindings, start once, read the terminal result,
   and compare declared outputs with the reference experiment.
3. Save/reload the Project and export prepared/executed input, logs, rawfile,
   structured data, numeric CSV, and evidence manifest through File Resource.
4. Introduce a recoverable input error, repair it in the same authorized
   session, and complete another run without replacing the Project or bypassing
   the compiler through a handwritten fallback deck.
5. Independently exercise TRAN with a suitable fixture, DC and Noise with their
   qualified fixtures, and raw entry/include preparation with no hidden
   stimulus, analysis, root call, or circuit mutation.

The boundary matrix must additionally demonstrate:

- Two DUT occurrences do not share a probe accidentally; source values have
  one Instance authority; setup/root choice does not modify Project top.
- Input changes preserve old immutable evidence but mark it stale. Results use
  their own prepared mapping, not the latest setup. Save carries intent only.
- Raw workspace CAS, include-byte identity, declared dependency digest/path
  validation, input export before execution, and artifact access after failure.
- Cancel, busy/queue expiry, timeout, interrupted transport, idempotent retry,
  truncation, missing/unusable vectors, partial output, and storage failure
  remain explicit recoverable outcomes. No uncertain request auto-runs twice.
- Another owner, an expired/revoked session, or an unauthorized source cannot
  read or execute the protected inputs/results. No secret or circuit payload
  leaks through health, ordinary logs, analytics, or browser recovery.
- Simulation is loaded on demand; closing its presentation does not fake
  cancellation. GUI and MCP use one service/parser/compiler rather than private
  result parsing or direct-execution fallbacks.

Record simulator, models, corner, analyses, inputs, measured outputs, and
absolute/relative tolerances. Screenshots and exit code alone are not electrical
evidence. Never substitute simplified models or alter geometry/parameters merely
to make a reference pass.

## 3. Qualification and promotion closure

Use the existing Profile manifest and deployed gate, not a second receipt store.
The release owner must verify the candidate's actual image, binary, complete
model tree, startup policy, and qualified scope against its reproducible source
and licensing evidence. A pinned digest alone is not model qualification.

Confirm private per-run writable storage, read-only models/runtime, non-root
execution, process-tree termination, bounded resources, and protection from
other jobs/platform secrets. Raw control language does not exempt any of these
requirements. Missing evidence blocks the applicable capability, not saving or
editing unrelated circuit work.

Preview acceptance must match the candidate and named Profile.
The current Production workflow checks for any successful Preview run at the
candidate SHA, not the latest completed run or a runtime/Profile-bound receipt.
Review whether to strengthen that predicate before claiming the full promotion
guarantee; document acceptance or implement the stronger check in a separate
release-policy target. This documentation cleanup does not change that gate. Production
promotion and Worker/executor recovery follow the existing deployment contract;
this plan adds no alternative acceptance channel or automatic release authority.
After promotion, verify actual Production identity and health separately.

## Deferred product extensions

These are not implicit promises of the current UI or executor:

- Live cross-Project library synchronization and automatic version following.
- Persistent Project result archives.
- Monte Carlo, batch optimization, and automated circuit modification.
- A second simulator, general simulator plugins, or uploaded Verilog-A compilation.
- Model marketplaces, automatic PDK/binned-model fallback, or parameter rewriting.
- Arbitrary lossless two-way synchronization between raw SPICE and the drawing.

Raw input may express capabilities supported by the selected environment even
when no dedicated GUI exists. It does not create unqualified Canvas mappings.

## Completion

Record evidence in the target commit/PR. A failed journey requires a corrected
candidate and repeatable verification; an external or product blocker must name
the missing decision/evidence. Closing this plan requires accepted integration
evidence, not deleting unfinished rows or labelling foundation code complete.
