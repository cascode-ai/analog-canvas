# VACASK migration

Status: active. The product decision changed from VACASK-only to dual engines;
VACASK is a second, Profile-selected Preview engine beside ngspice (7305dbe6).
It is not delivered or qualified for Production.

Integration owner: the implementer on `codex/vacask-migration`, accountable for
closing every work package below; the product owner accepts UI and publication.
Assign any future handoff to a named implementer, not just a package name.

## Target and baseline

Replace the executable ngspice simulation stack with one native VACASK stack.
Preserve Canvas, Project/Cell management, source-folder interaction, GUI/MCP
parity, job lifecycle and numeric-result presentation. Do not introduce an
engine selector, automatic fallback or a permanent two-engine product.

The starting main revision is `154f07d993cf8867e4714b19f814c710688886b8`.
Its hosted environment is `sky130-core-continuous-ngspice46-v1`; its contract is
the [existing Profile](../../containers/ngspice/hosted-sky130-profile.json).
Production keeps that accepted environment; `wrangler.jsonc` registers no
VACASK endpoint. Since 7305dbe6, main and ordinary Preview also route the
isolated `vacask-sky130-candidate` Profile beside it (`wrangler.preview.jsonc`).

Current ownership comes from [source authoring](../specs/simulation.md),
[compilation](../specs/simulation.md), [execution](../specs/simulation-execution.md)
and [numeric results](../specs/simulation-results.md). Since 7305dbe6 they
scope their SPICE clauses to ngspice and add native VACASK clauses. Carry
forward the unresolved integrated journeys in
[simulation remaining work](simulation-remaining-work.md).

## Boundaries

| Area | Preserve | Replace or deliberately adapt |
| --- | --- | --- |
| Circuit | Net identity, ERC, pin order, hierarchy, DUT/TB, symbols | Simulation model and parameter mapping |
| Projects | Cloud ownership, Import Cell closure, save/reload, undo/redo | Simulation input migration only where needed |
| Workspace | Explorer, code dock, Console/Specs, folder batch, Run/Cancel | Native templates, syntax, helpers and diagnostic navigation |
| Compilation | Shared electrical IR, object/occurrence/source mapping | VACASK printer, model loading, analyses, acquisitions and expressions |
| Service | One GUI/MCP service and File Resource, revision/freshness | Native execution and result adaptation |
| Hosting | Admission, idempotency, queues, cancellation, bounded artifacts | Isolated VACASK image, gateway and Profile |
| Results | Numeric arrays, units, native evidence, CSV, Spec reports | VACASK file/plot parsing, measurements and device OP semantics |

Structural SPICE import and SPICE/Spectre design export remain interchange
features. They do not authorize a second executable simulator. The VACASK
printer consumes circuit IR directly; a chain of regular-expression SPICE
rewrites is not the native compilation path.

Canvas remains authoritative for bound topology and device values. Generated
Circuit files remain projections; user files own textual TBs, native analyses,
control and measurements. Helpers edit that same source. Do not add editable
JSON copies of native settings. A saved broken native experiment remains
editable/saveable; failure to prepare it does not disable unrelated work.

Controlled Verilog-A compilation/loading is part of environment qualification.
Arbitrary user-uploaded cloud compilation, model marketplaces, new simulation
UI layouts and new RF analyses are not prerequisites for this migration.

## Work packages and exits

All packages start open. A document, module or unit test is not its exit.
The integration owner owns M0-M6 until an explicit handoff is recorded.

| Package | Owned paths / outcome | Required exit |
| --- | --- | --- |
| M0 baseline | This roadmap; acceptance inventory | Every existing simulation capability has a disposition, native fixture and owner; no cross-simulator numerical-equivalence gate |
| M1 isolated cloud | Dedicated deployment config/workflow and host target | Branch worker, auth, DOs, queues, R2, executor, credentials, volumes and network are isolated; no existing endpoint is replaced |
| M2 runtime/models | VACASK runtime, model artifacts and Profile | Fixed simulator/compiler/model/OSDI identities; real native model fixtures execute with correct mappings and complete results on target Linux runtime |
| M3 authoring/compiler | model/netlist/spice language/helpers | Canvas and code-only experiments compile to native VACASK; hierarchy/units/source maps retained; one source authority |
| M4 execution/results | simulation-service/runtime/result reader | Public execution contract, lifecycle, diagnostics and mapped numeric results work for all required analyses |
| M5 integration/retirement | editor/MCP/data/examples/docs | Existing interactions work; owned examples converted; old input preserved; no reachable ngspice execution path remains |
| M6 acceptance/delivery | Existing test/evidence and release boundaries | One candidate passes native result-integrity, GUI, public MCP, resource and isolation journeys; user review precedes Production |

Start M2 before expensive UI adaptation. Build one native end-to-end slice early,
then expand analysis/model coverage. M1 can proceed independently once its
resource boundary is known. Do not migrate every historical drawing layout.

Keep bounded commits and the current progress list in ignored `plan/`, following
the [working rules](../../AGENTS.md). Commit messages own validation and remaining
limitations. Synchronize relevant main changes at integration boundaries; avoid
rebasing for every unrelated commit. No main merge or Production release is
implied by a local package's completion.

## Environment and electrical acceptance

The first replacement must account for the current seven qualified SKY130
wrappers (core/LVT NFET/PFET, high-poly resistor, MIM capacitor and fixed PNP),
all five qualified corners and OP/DC/AC/TRAN/Noise. Missing equivalents remain
an explicit release gap; do not silently substitute generic devices or drop an
existing advertised capability. Model scope changes require a product decision.

The product owner approved upgrading the MOS equation implementation from the
source models' BSIM4 4.5/4.62 declarations to **4.8.3**. The converter must
emit 4.8.3 and retain the original versions in its evidence. Do not claim that a
4.5 parameter string selects 4.5 equations inside `sp_bsim4v8`. The original
ngspice baseline remains historical evidence, not an acceptance oracle.

The product owner's revised acceptance decision is **native VACASK execution,
not numerical equivalence to another simulator**. Neither a same-version ngspice
reference nor AC/TRAN/Noise cross-simulator error thresholds block migration.
Do not tune model coefficients, solver settings or sampling solely to reproduce
old results. Existing comparison reports remain research evidence; discrepancies
alone are not release failures. A demonstrated native implementation defect is
still a defect: retain regression protection for the module's chain-rule fix.
This decision changes neither foundry coefficients nor the current hosted
environment and does not authorize deployment.

Record the actual VACASK build, platform, binary digest, OpenVAF revision,
OSDI ABI, compiled module digests, model source/digests/licenses, startup policy
and solver options. Official source defaults and binary packaging may select
different OSDI ABIs. A downloaded package or simulator exit zero is not a
qualified Profile. Windows local evidence does not qualify hosted Linux.

Acceptance layers:

1. Analytical passives/sources: divider OP/DC, RC complex AC and TRAN,
   resistor noise with declared temperature and density convention.
2. Device characterization: terminal ordering, W/L/NF/M, scale, multiplicity,
   temperature, corner, parasitics, currents and available OP quantities.
3. Real circuit: fixed five-transistor OTA and suitable TRAN/Noise fixtures,
   preserving actual device parameters, supplies, loads and bias.
4. Custom model: one explicitly illustrative Verilog-A device compiled with
   the chosen compiler and loaded by the chosen runtime, without using it as
   a replacement for foundry data.

For the declared device/corner/analysis scope, require native model loading,
correct terminal/parameter/unit mapping, successful analyses, complete finite
results with correct axes/units, and readable/exportable raw and numeric evidence.
Exit zero alone is insufficient. Do not silently ignore unsupported parameters,
substitute illustrative models, fill missing results or rewrite raw artifacts.
Use analytical checks and basic circuit invariants to catch mapping/parser bugs;
these are not a demand that different simulators produce identical numbers.
Existing strict cross-simulator comparisons are optional research only and must
not be part of the native release gate. Full GUI/MCP and isolated-cloud journeys
below remain required; local native runs do not by themselves authorize release.

## Functional acceptance inventory

| Surface | Required evidence |
| --- | --- |
| DUT/TB | Import an authorized saved DUT Cell closure, place it, create a TB; two occurrences have independent probes; Project top does not change |
| Sources | Canvas source values have one authority; code-only TB has no invented binding; native parameters/loops remain native |
| Files | Explicit entry, includes, dependency hashes, generated-file ownership, drafts/CAS, rename/delete, export before run, save/reload and undo/redo |
| Operations | Active folder targeting, clone/delete, batch selected folders, apply drafts, prepare, run, cancel, reopen result and freshness |
| Numbers | OP/DC/complex AC/TRAN/Noise; native vectors and units; device OP, measurements, multiple analyses/sweeps; no missing-as-zero behavior |
| Mapping | Ground/global names, hierarchy paths, current sign and multiplicity; result uses its own prepared mapping after edits |
| Export | Authored/prepared/executed input, logs, raw files, numeric results, CSV and provenance through the existing File Resource |
| Failure | Bad syntax/model/parameter/probe, partial/truncated output, convergence failure, timeout, cancellation, queue expiry, interrupted response and storage failure |
| Recovery | Same GUI/MCP session can repair and rerun; uncertain admission does not automatically execute twice; another folder remains usable |
| Access | Unauthorized owner/session cannot read/run artifacts; no credentials in executor; per-job files, process-tree kill and cleanup |
| Performance | Click-to-result separated into queue, transport, startup/model load, solve, collection/render; cold/warm runs, peak RSS and bounded output |

Port existing primary tests as implementations change. Add real VACASK artifacts
for parser tests. Do not retain ngspice assumptions under renamed tests, delete
difficult behavior to make gates green, or infer all capabilities from one OTA.

The coding implementer must complete both a real GUI and a public MCP journey:
import DUT -> build TB -> author -> prepare/inspect -> run -> view/export ->
save/reload -> introduce recoverable error -> repair -> rerun. Exercise the
remaining analyses with suitable fixtures. Use supported product APIs, not DB
edits, filesystem shortcuts or a replacement handwritten deck for a broken
Canvas compiler. Failed journeys require correction and repeatable evidence;
external blockers must remain explicit. User screenshots alone are not numeric
acceptance. Reuse the existing evidence/artifact system, not a new receipt store.

## Old inputs and retirement

Preserve circuit topology and source bytes. Convert owned examples and known
structured inputs on copies with numerical validation. Arbitrary ngspice control
programs remain accessible as legacy source, with a repairable non-executable
status until explicitly translated; never change only their Profile ID and run
them. No permanent legacy engine or hidden compatibility selector is required.

Back up before any cloud data conversion. Keep migration distinct from normal
load/save. Historical result identity remains historical. Before release, define
whether a previous app can read newly written Projects; retained old images alone
do not solve data rollback. Retire old runtime code, native templates, deployments
and documentation only as their replacement and rejection boundaries are covered.

## Cloud and release boundary

The ordinary Preview workflow uses a fixed hostname; main pushes overwrite it.
Ordinary Preview and Production currently share the same operator gateway.
Therefore neither existing deploy workflow may be used to install the migration
runtime in place. Use a dedicated, manually dispatched branch deployment with a
recorded candidate SHA and isolated resources. No named test URL is claimed live
until provisioned and verified. Check host capacity before sharing a machine;
use an independent host where resource isolation cannot protect Production.
Since 7305dbe6 the Simulator host workflow's manual `vacask-preview` action
provisions `vacask-preview-sim.tokenzhang.com` on the shared operator host after
a capacity check, and verifies its pinned fingerprint and anonymous refusal.

Branch acceptance must bind app SHA, image digest, Profile and actual runtime
identity. After accepted branch integration, run the repository's full mainline
delivery gates and normal Preview verification. Main deployment must no longer
rebuild the production ngspice endpoint implicitly. Production remains a separate
authorized promotion with deployed identity verification and data-aware rollback.

## External authorities

- [VACASK source and manual](https://codeberg.org/arpadbuermen/VACASK): inspect
  the exact selected commit, not just latest README claims.
- [VACASK binary packages](https://fides.fe.uni-lj.si/vacask/download/).
- [OpenVAF-Reloaded](https://github.com/OpenVAF-Reloaded/OpenVAF) and
  [OSDI interface](https://openvaf.semimod.de/docs/details/osdi/).
- [SKY130 source](https://github.com/fossi-foundation/skywater-pdk-libs-sky130_fd_pr):
  conversion availability does not establish our qualified device/corner scope.
- [ngspice 46 reference manual](https://ngspice.sourceforge.io/docs/ngspice-46-manual.pdf):
  reference and legacy-input interpretation only, not target executable syntax.

These are technical references, not a restriction against justified native
solutions. Record any source/manual disagreement using actual runtime evidence.
