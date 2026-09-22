# VACASK Qualification

Status: recurring qualification and proposed scope extensions.

Owners: simulation integration and release owners.

## Outcome and current boundary

VACASK is a second, Profile-selected engine beside ngspice, preserving the
shared GUI/MCP source and result workflow. Source preparation dispatches by
engine; Production registers `vacask-sky130-candidate`. Qualification of an
engine/runtime expansion includes discovery and execution through public MCP
and the managed queue; configuration or a local successful run alone is not
acceptance. Ordinary release checks remain owned by [deployment](../deployment.md).

The current contracts belong to [simulation](../specs/simulation.md),
[execution](../specs/simulation-execution.md) and
[results](../specs/simulation-results.md). Other open capabilities belong to
[simulation remaining work](simulation-remaining-work.md).
Implementation progress and candidate receipts belong in commits and CI artifacts.

## Remaining acceptance

- Bind native runtime, compiler, models and declared device/corner/analysis
  coverage to one reproducible candidate and target Linux environment.
- Verify the integrated manual and Agent journeys below against that candidate,
  including failures, recovery, provenance and bounded resource use.
- Review the evidence and explicitly authorize any Production engine expansion.
  Existing ngspice execution remains supported; removal is not this outcome.

Preserve Canvas topology/device authority, source-folder ownership, hierarchy,
File Resources, run lifecycle, revision/freshness and numeric result mapping.
Native VACASK compilation consumes circuit IR, not regex-rewritten SPICE.
Do not add a second editable JSON authority for native settings. A broken
experiment remains saveable and must not disable unrelated work.

Arbitrary uploaded Verilog-A compilation, model marketplaces, new simulation
layouts and RF analyses are outside this qualification.

## Environment and electrical acceptance

Qualification must account for the current seven qualified SKY130
wrappers (core/LVT NFET/PFET, high-poly resistor, MIM capacitor and fixed PNP),
all five qualified corners and OP/DC/AC/TRAN/Noise. Missing equivalents remain
an explicit release gap; do not silently substitute generic devices or drop an
existing advertised capability. Model scope changes require a product decision.

The product owner approved upgrading the MOS equation implementation from the
source models' BSIM4 4.5/4.62 declarations to **4.8.3**. The converter must
emit 4.8.3 and retain the original versions in its evidence. Do not claim that a
4.5 parameter string selects 4.5 equations inside `sp_bsim4v8`. The original
ngspice baseline remains historical evidence, not a VACASK acceptance oracle.

The product owner's revised acceptance decision is **native VACASK execution,
not numerical equivalence to another simulator**. Neither a same-version ngspice
reference nor AC/TRAN/Noise cross-simulator error thresholds block native qualification.
Do not tune model coefficients, solver settings or sampling solely to reproduce
old results. Existing comparison reports remain research evidence; discrepancies
alone are not release failures. A demonstrated native implementation defect is
still a defect: retain regression protection for the module's chain-rule fix.
This qualification rule does not permit changing foundry coefficients or
deploying an expanded environment without its own acceptance.

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
not be part of the native release gate. Full GUI/MCP and isolated-executor journeys
below remain required; local native runs do not by themselves authorize release.

## Functional acceptance inventory

| Surface     | Required evidence                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DUT/TB      | Import an authorized saved DUT Cell closure, place it, create a TB; two occurrences have independent probes; Project top does not change                       |
| Sources     | Canvas source values have one authority; code-only TB has no invented binding; native parameters/loops remain native                                           |
| Files       | Explicit entry, includes, dependency hashes, generated-file ownership, drafts/CAS, rename/delete, export before run, save/reload and undo/redo                 |
| Operations  | Active folder targeting, clone/delete, batch selected folders, apply drafts, prepare, run, cancel, reopen result and freshness                                 |
| Numbers     | OP/DC/complex AC/TRAN/Noise; native vectors and units; device OP, measurements, multiple analyses/sweeps; no missing-as-zero behavior                          |
| Mapping     | Ground/global names, hierarchy paths, current sign and multiplicity; result uses its own prepared mapping after edits                                          |
| Export      | Authored/prepared/executed input, logs, raw files, numeric results, CSV and provenance through the existing File Resource                                      |
| Failure     | Bad syntax/model/parameter/probe, partial/truncated output, convergence failure, timeout, cancellation, queue expiry, interrupted response and storage failure |
| Recovery    | Same GUI/MCP session can repair and rerun; uncertain admission does not automatically execute twice; another folder remains usable                             |
| Access      | Unauthorized owner/session cannot read/run artifacts; no credentials in executor; per-job files, process-tree kill and cleanup                                 |
| Performance | Click-to-result separated into queue, transport, startup/model load, solve, collection/render; cold/warm runs, peak RSS and bounded output                     |

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

## Existing inputs

Keep ngspice source executable under its selected, available ngspice Profile.
Native translation is explicit, preserves original source bytes and topology,
and must not change only a Profile ID to run incompatible syntax. Historical
results retain the identity of the environment that produced them.

Back up before any cloud conversion. Migration is separate from ordinary
load/save. A Production expansion must define data-aware rollback, not just
retain an old image.

## Hosting and delivery

The two engines require separate endpoints and bounded resources; do not replace
the accepted ngspice runtime in place. The operator workflow's `vacask-preview`
action provisions the candidate on its isolated target and verifies runtime
identity and anonymous refusal. Sharing a machine still requires capacity and
resource-isolation evidence; otherwise use an independent host.

Candidate acceptance binds app SHA, image digest, Profile and observed runtime
identity. Follow [deployment](../deployment.md) for the actual channel and
release route; this roadmap does not define another branch/deployment policy.
An existing successful deployment does not qualify a changed runtime or
expanded model scope.

## External authorities

- [VACASK source and manual](https://codeberg.org/arpadbuermen/VACASK): inspect
  the exact selected commit, not just latest README claims.
- [VACASK binary packages](https://fides.fe.uni-lj.si/vacask/download/).
- [OpenVAF-Reloaded](https://github.com/OpenVAF-Reloaded/OpenVAF) and
  [OSDI interface](https://openvaf.semimod.de/docs/details/osdi/).
- [SKY130 source](https://github.com/fossi-foundation/skywater-pdk-libs-sky130_fd_pr):
  conversion availability does not establish our qualified device/corner scope.
- [ngspice 46 reference manual](https://ngspice.sourceforge.io/docs/ngspice-46-manual.pdf):
  ngspice input interpretation, not VACASK native syntax.

These are technical references, not a restriction against justified native
solutions. Record any source/manual disagreement using actual runtime evidence.
