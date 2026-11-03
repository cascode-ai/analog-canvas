# Simulation Execution and Resources

Status: accepted

Owners: `packages/simulation-service`, `packages/spice-run`, `worker`,
`containers/ngspice`, `containers/vacask`, `apps/local-host`,
`apps/editor/src/features/simulation`

[Setup and compilation](simulation.md) owns authored inputs;
[numeric results](simulation-results.md) owns their interpretation.

## Ownership boundary

- Netlist compiles source intent and Canvas bindings; the service's preparation
  module resolves capabilities and immutable input identity. SimulationService
  owns preparation and presentation; its Executor is the execution port shared
  by GUI and MCP. On Production the managed control plane owns admission,
  idempotency, queueing, retry, cancellation and retention.
- Gallery [simulation checks](community-gallery.md#simulation-checks) are one
  more managed caller (`prepareFolderExecutionInput`, account
  `gallery-simulation-check`, judged by `executionSpecReport`).
- Model-library selection belongs to the execution environment. Stimuli are
  Testbench Instances or source text; nothing duplicates a drawn source.
  Preparation preserves the entry and file closure; the Worker never recompiles
  or inserts model directives or a terminator.
- Preparation checks external calls against the Profile's qualified names and
  verifies dependency identities, digests, mounts and sections; a mixed-process
  source runs when the Profile supplies it all. Native Spectre is converted
  ([simulation](simulation.md#shared-external-implementations)), never run as
  Spectre.
- The local host has no default binary or models and probes nothing; without
  its optional `simulationHandler` (`/api/simulate`) capabilities report
  `configured: false` and runs return `simulation-not-configured`, a deployment
  condition, not a circuit failure.
- Reads return bounded receipts; full `result.json`/`specs.json` stay File
  artifacts. Freshness is cached per structure revision and folder ID. Session
  results are not saved in the Project. Lost responses never re-execute. Agents
  get raw series; the product derives no charts or summaries.

## Native Worker execution boundary

- `worker/simulation.ts` routes by Profile; `worker/simulation-vacask.ts` takes
  VACASK source only. `VACASK_PROFILE_ID` (or `SIMULATION_PROFILE_ID` on an
  isolated native Worker) selects the Profile; `/health` supplies the measured
  environment. Required: verified pinned VACASK identity, matching Profile,
  `inputs: ["source"]`, `rawfileCollection: "native-multi-ascii"`. The Worker
  holds no model path, corner list or analysis interpretation.
- The label is `SKY130 · VACASK <release> (preview)` with the release read
  strictly from the simulator version (`0.3.4-icm-hard-switch2` → `0.3.4`); an
  executor-declared label wins; unreadable releases show the Profile id.
- Targets (`VACASK_UPSTREAM_URL`/`VACASK_UPSTREAM_TOKEN` operator host, or a
  `VACASK` container binding) are locations, not engines; missing targets never
  fall back; an ngspice target never registers VACASK.
  [Deployment](../deployment.md) owns registration; the
  [qualification roadmap](../roadmap/vacask-migration.md) owns scope evidence.
- Worker and harness share `validateNativeExecutionInput` (revision, entry bytes,
  disjoint portable paths, registry digests, bounds). The Worker forwards exact
  files and checks hashes, executed bytes and runtime fingerprint against
  admission, withholding mismatches rather than retrying. Cancellation bypasses
  readiness checks; refusals keep bounded details and Retry-After.

### Execution receipt

- Native executors add `x-analog-simulation-receipt`: URI-encoded JSON ≤8192
  ASCII characters (run token, outcome, collection completeness, input and
  environment metadata, executed-file digest, body length and digest). No
  waveforms; body and endpoints unchanged.
- The Worker checks the receipt and forwards the length-bounded stream, which
  the dispatcher writes to R2 with its expected SHA-256 (transfer integrity).
  ngspice receipts match bundled Profile facts with no post-run `/health`;
  VACASK capability facts are cached ≤30 s per binding, credential and Profile
  and dropped on failure.
- Without the header, bounded JSON validation applies; malformed receipts fail
  without fallback; interrupted bodies are uncertain, never rerun.
- `x-analog-execution-transfer: receipt-v1` opts into a 256 MiB response
  ceiling; old buffered readers stay at 8 MiB (exceeding it is a transport
  failure). The gateway forwards the opt-in with backpressure. Collector budgets
  come from runtime configuration, never the client.

## Ngspice baseline model-library selection

These sections are ngspice-only; one engine's configuration never registers the
other.

```ts
type ModelLibrarySelection =
  | { directive: "include"; path: string }
  | { directive: "lib"; path: string; section: string };
```

- The directive is explicit, never inferred; paths are quoted without quotes or
  line breaks; a section is one SPICE token. Violations are
  `simulation-environment-invalid`. A sectioned library is never `.include`d (it
  would expand every corner).
- Hosted SKY130 uses the benchmark suite's digest-pinned image and the
  **continuous** library's `tt` section
  (`.lib "/opt/sky130/continuous/sky130.lib.spice" tt`); binned models cap width
  at 100 µm and are not default.
- The library is added only for decks with a semiconductor card or a Sky130
  model name outside comments; otherwise `modelLibrary: null`.

### Hosted SG13G2 Profile

- The [SG13G2 Profile](../../containers/ngspice/sg13g2/profile.json) names all
  13 qualified Library primitives and 37 combinational standard-cell masters.
  Discovery offers this single SG13G2 environment after proving the exact
  model, simulator and startup identities. Retired Profile ids are refused.
- The Profile offers 135 deterministic combinations of five MOS,
  three HBT, three resistor and three capacitor corners. `nominal` selects
  TT/typ/typ/typ. Gate truth tables qualify at each MOS corner at −40, 27 and
  125 °C. Choose a named section in the Profile model dependency's `.lib` line.
- For seeded sampling, select `statistical` or `nominal-mismatch`, then run
  `setseed 7101` and `reset` before analysis in the ngspice control block.
  Use the upstream `mm_ok=1` instance switch on models that expose it.
  The lateral PNP has no local mismatch term. VACASK SG13G2 remains unqualified.
- PSP103 native OP exposes `ide` as `id`, `vgs` and `vds`. These are native,
  polarity-normalized model quantities (including PMOS); derivative fields are
  unavailable. The current Helper refuses hierarchical PSP PMOS drain current
  rather than presenting normalized `ide` as signed terminal current.
- Qualification requires original-model electrical checks, Canvas/reference
  numerical agreement, and saved-Project GUI/MCP execution through the real
  executor. [The qualification workflow](../../.github/workflows/sg13g2-tests.yml)
  retains native, service and browser evidence.

### Hosted SKY130 Profile

- `containers/ngspice/hosted-sky130-profile.json` is the single runtime contract
  (image and binary digests, platform, version, model-tree digest, continuous
  mapping, corners, startup-policy digest, qualified scope).
- The harness measures binary, models, platform, `.spiceinit` and cell-library
  bytes at startup and reports `reproducibility: "pinned"` only when all match;
  otherwise `/health` and `/run` stay not ready, never downgraded.
- Qualified scope: core and LVT 1.8 V NFET/PFET, high-Vt 1.8 V PFET,
  `res_high_po`, `cap_mim_m3_1`, three-terminal `pnp_05v5_W0p68L0p68`; corners
  `tt/ff/ss/fs/sf`; OP/DC/AC/TRAN/Noise. New devices need a hosted OP/AC fixture
  at every corner. Excluded: SKY130 diode (unresolved in the continuous library)
  and four-terminal NPN (ngspice 46 discards parameters).

#### Standard cells

- `cellLibraries` adds `sky130_fd_sc_hd.spice` (vendored with provenance in
  `containers/ngspice/cells/`, `cells` and `directive: "include"`), installed at
  `/opt/sky130-cells/` outside the measured model tree so the fingerprint stays
  the primitive library's. The harness verifies it, mounts it by `{id, sha256}`,
  lists it in `/health` and the receipt's `cellLibraries`; the Worker checks it.
- Capabilities add `cellLibraries` only when the request's `accepts` lists
  `"cell-libraries"`, limited to what `/health` reports. A library with a qualified
  subset of masters also requires `"cell-masters"` in the request.
- Preparation loads a cell library after the model `.lib` when the source calls
  its gates. Errors: `STANDARD_CELL_LIBRARY_UNAVAILABLE`,
  `STANDARD_CELL_UNSUPPORTED` (wrong pin order or no Library gate),
  `MODEL_IMPLEMENTATION_MISSING` (bodiless definition outside the reviewed set
  without a model source).
- Cells use `scale=1.0u`; only Library-gate cells are reviewed; flip-flops and
  latches need `special_*` models the continuous library lacks.

## Run metadata V1

[SimulationRunMetadata](../../packages/spice-run/src/contract.ts) owns the fields;
[metadata validation](../../packages/spice-run/src/metadata.ts) owns integrity.

- `inputRevision` is opaque freshness state.
- `netlistSha256` covers the drawn circuit as sent (generated files joined by
  newlines in compile order), or the empty netlist when there is none, when an
  ngspice input would exceed its budget, and for VACASK until circuit text is
  accepted. `testbenchSha256` and `deckSha256` cover the executed entry.
  `catalog.files` holds every other file's SHA-256.
- Hosted executors report `pinned` only after matching the Profile; nothing is
  fabricated. Metadata is provenance, not correctness.

## Execution boundary

Shared minimums for the hosted runner and the local host:

- Non-root, per-run directory removed afterwards, minimal secret-free
  environment, read-only models.
- One job per container; concurrent requests get `503` with `Retry-After`.
- Timeouts kill the process tree (`timedOut`); cut output is reported truncated.
- One Run Supervisor owns admission, phase, timeout, termination, collection,
  cleanup and slot lifetime; if it cannot settle, the harness exits.
- Raw `.control` is allowed; isolation contains it.

### How the hosted container meets it

- uid 10001 cannot write simulator, models or harness (the workflow asserts it).
- The run root is image-prepared outside `/run`; the harness falls back to the
  platform temp dir and reports both in `/health`; no directory is
  `run-directory-unavailable`.
- The per-run directory is cwd, `HOME`, `TMPDIR` and the only writable path; the
  deck is `deck.cir`, named relatively so no host path reaches the log. The
  environment is only `PATH`, `HOME`, `TMPDIR`, `TERM`, `C` locale.
- `.spiceinit` sets `filetype=ascii`; deck text is never modified.
- The simulator runs in its own session and the deadline signals its group. A
  lease watchdog covers admission through cleanup; on expiry the harness marks
  itself fatal and exits. Health never extends it.

| Limit                   | Value                        | Enforcement                                              |
| ----------------------- | ---------------------------- | -------------------------------------------------------- |
| Deck size               | 2 MiB                        | `413 deck-too-large`                                     |
| Request envelope        | 8 MiB                        | connection closed, `413 request-too-large`               |
| Raw waveform collection | 64 MiB per run               | incomplete collection reported, never certified complete |
| Simulator logs          | 1 MiB per run, independently | split between stdout and stderr; truncation reported     |
| Default deadline        | 30 s                         | when the caller names none                               |
| Maximum deadline        | 120 s                        | longer requests clamped                                  |
| Lifecycle grace         | 10 s                         | hard lease watchdog after the run deadline               |
| Identity / limits probe | 5 s                          | identity: abandoned; limits: not ready until read back   |
| Processes               | 128 (`RLIMIT_NPROC`)         | image `ulimit` (host-wide per uid); not ready without it |
| Written file size       | 256 MiB (`RLIMIT_FSIZE`)     | image `ulimit`; not ready without it                     |

- `SIMULATION_MAX_OUTPUT_BYTES` sets waveform collection, `SIMULATION_MAX_LOG_BYTES`
  logs (defaults in `packages/spice-run`); capabilities use the harness's
  `limits.outputBytes`. A cut waveform never certifies a result.
- The ngspice executor parses on the operator host into the receipt-bound
  256 MiB envelope; the Worker never materializes arrays.
- `ContainerRunResponse` adds `log`, `stdout`, `stderr`, `truncated`,
  `truncatedOutputs` (`"log" | "rawfile"`), `rawfileRequested`, `rawfile`
  (verbatim ASCII when the deck has `.save` or `write`), `rawfileName`,
  `rawfileFormat` (`ascii | binary | null`), `limits`. Stderr is never
  acceptance; the Worker re-derives `rawfileRequested` and rejects disagreement.
- `GET /health` answers during runs with environment, limits and one `activity`
  (`idle`, or phase, elapsed and remaining deadline; no lease, deck or user data);
  missing binary or models answer `503 not-ready`.

## Run lifecycle

- Capabilities read qualified `analyses` from the Profile, report
  `parsedAnalyses` separately and advertise `maxOutputBytes`; an estimated
  rawfile over budget warns but never blocks.
- The service exposes `prepare`, `start`, `read`, `cancel`, `export`. `start`
  runs exactly the prepared digest; run ids are bound to their session or
  Project owner. Unavailable evidence reads as lost; lost runs never rerun.
- Batches (`prepare-batch`, `start-batch`, `read-batch`, `cancel-batch`) freeze
  1–16 members at one structure revision and run them sequentially as ordinary
  Runs; failures do not stop later members; cancel stops the active one and marks
  queued ones cancelled; `start-batch` follows request-ID idempotency.
- `prepare-sweep` expands corner, temperature, Design Variable (stable
  Setup-local ID fanned to all bindings) and exact Instance-parameter axes into
  the same 1–16 batch of immutable projections ([simulation](simulation.md#runs-and-sweeps)).
  An ngspice corner changes only the Profile dependency's `.lib` section.

## Resources and presentation

### Agent resource implementation

- `packages/simulation-service` owns lifecycle and codecs; `SimulationFiles` is
  exposed through the File Resource; adapters never compile decks.
- `prepare` takes a saved folder (requires `expectedStructureRevision`) or a raw
  workspace and publishes SHA-256-addressed input artifacts before execution;
  input/runtime disagreement is repairable.
- `start` is idempotent by request ID and payload (a changed payload is
  rejected). `read` returns running/cancelling/finished/cancelled/lost; late
  success is never relabelled cancelled. `cancel` needs a private run token never
  exposed; cancel-before-admission is remembered for the maximum run window.
  Refusals keep their Problem; partial results of a failed analysis stay
  readable.
- Managed retries only for proven pre-dispatch failures or explicit busy /
  not-ready refusals; lost replies, post-dispatch failures and expired leases end
  `infrastructure-failed`; duplicate deliveries never restart a Run. MCP
  transport failures return the effective request ID; File Resource `list`
  recovers draft IDs.
- Hosted runs require sign-in (`401 simulation-authentication-required` from
  `start` and `/api/simulate`); Profile discovery stays open.
- Managed admission: runs survive tab loss with one day of evidence; at most 50
  waiting, one queued and one active per owner, five-minute wait, one
  operator-host slot. `SIMULATION_DISPATCH=alarm` schedules a control-DO alarm
  draining up to four runs under one global lease (fencing legacy Queue
  deliveries); Queue is a rollback setting, switched only after draining.
- Agent `run` captures input before capability waits and keeps one request
  identity; timing separates controller wait, input read, upstream request and
  result commit.
- Direct/local: 15-minute File Resource retention, one active run, eight raw
  workspaces (24 files / 1 MiB each); revoking a session cancels and clears it.
- Export returns File Resource references; large reads omit arrays and set
  `resultPreview`; files read by UTF-16 `offset`/`maxChars` with `nextOffset`;
  MCP local export assembles and verifies the complete file. Storage-capacity
  failures keep evidence and return an explicit error.
- Each completed run publishes `evidence-manifest.json` (run, prepared digest,
  revision, environment, probe mapping, every artifact's name, size and hash).

### Results

- The workspace offers Specs and Console; Plot, Compare, OP views and
  result-to-Canvas are retired (`simulation-plot` export returns
  `SIMULATION_PLOT_RETIRED`).
- `* @spec` comments ([Spec annotations](../agent/simulation-specs.md)) judge
  native `meas` values from captured source only; `outputData.specs`,
  `specs.json` and `specs.csv` agree. Missing measurements or incomplete runs
  never Pass; unruled metrics are unconstrained; edits mark reports stale.
- New runs produce `out.raw` plus `<analysis>-<record-index>.csv` per analysis;
  `result.json` owns the numbers; legacy output arrays stay empty and legacy
  artifacts are not generated (archived ones stay readable).
- Browser archives ([evidence storage](simulation-evidence-storage.md)): 512 MiB
  per run, 1 GiB per Project, 256 MiB per file; eviction protects explicit
  Saves, legacy records, the latest durable result and evidence in use; opening
  never reruns.
- Problems use `{code,message,stage,recovery,diagnostics?}` and never end the
  Agent session.

## Validation

- Rawfile/result tests use ngspice- and VACASK-generated divider, RC and resistor
  Noise fixtures with closed-form expectations; harness tests use real processes
  and misbehaving stand-ins.
- `scripts/simulation-acceptance.mjs` and `scripts/preview-simulation-smoke.mjs`
  check the OTA through the hosted path.
- Recorded fixtures and local runs prove protocol handling, not hosted
  qualification; [deployment](../deployment.md) owns Production verification.
