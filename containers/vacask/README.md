# Native VACASK execution harness

This is the native VACASK harness, not an already qualified hosted SKY130
environment. It uses the existing simulation service, result protocol and
process supervisor. It never falls back to ngspice.

## Run locally

The development editor can connect to an already running native harness:

```powershell
$env:ICM_SIMULATION_URL = "http://127.0.0.1:9000"
pnpm dev
```

Use the actual port reported by the harness. This server-side setting reuses
the local-host adapter; it does not launch a simulator, discover binaries or
contact a hosted fallback. Without it, capabilities report unconfigured and
editing remains available. Restart Vite after changing the setting. The
development endpoint accepts only loopback Host and same-origin JSON requests.

For a standalone harness artifact (for a later image build), run:

```sh
node scripts/package-vacask-harness.mjs /absolute/new-output-directory
node /absolute/new-output-directory/vacask-harness.mjs /absolute/runtime-config.json
```

Build the service dependencies first as below. Packaging bundles this same
entrypoint and workspace dependencies into one Node 24 ESM file, with a SHA-256
manifest; it refuses existing output directories. No models, simulator binary,
Python, operator configuration or credentials are embedded. The artifact is not
an image or deployment, and its manifest does not replace the runtime lock.
The real CLI journey accepts `ICM_VACASK_HARNESS_ENTRY` to exercise that artifact
from a scratch working directory, without workspace module resolution.

For a flattened native model artifact, derive read-only symbol evidence with
`node scripts/vacask-model-symbols.mjs --library <file> --dependency-id <id> --master <wrapper> --output <new-json-file>`
after building the service dependencies below. Repeat `--master` for each public
wrapper; use `--section` only for a sectioned native library. The tool refuses
missing includes or overwriting an existing report. `report.library` can populate
the selected capability Profile's `modelSymbols`; it names the same dependency
ID/digest as `dependencies`, never an editable Project model.

Boot verifies those symbols against the actual bounded model file, not just a
copied hash. A mismatch leaves the executor not-ready. This inspection currently
supports flattened regular files up to 16 MiB, not arbitrary dependency trees.
Conditional paths are potential acquisitions only when every declaration at
that path proves the same module. Unknown or conflicting alternatives remain
unresolved; no geometry expression is evaluated. Only returned numeric records
establish that a potential acquisition actually exists. A successful inspection
is not model/electrical qualification or authorization to deploy.

Use the repository's supported Node version and build the service dependencies:

```sh
pnpm --filter @icm/simulation-service... build
node containers/vacask/entrypoint.mjs /absolute/path/runtime-config.json
```

On Windows, pass an absolute Windows configuration path. Paths inside the JSON
must also be absolute for that host. The CLI prints a `vacask-listening` JSON
event with its actual address/port; listening is not proof of runtime readiness.
Check `GET /health` before using it. Startup identity failures remain not-ready
and are logged to the operator's stderr; there is no implicit executable search.
The exported `ready` promise also includes capability and model-symbol validation.
Those failures are reported through the same `vacask-runtime-not-ready` event;
successful binary measurement alone is not readiness.

The operator-owned file composes existing contracts, not a new Project or Profile
format. A minimal **local OP test** configuration is:

```json
{
  "runtime": {
    "executor": "local-host",
    "profileId": "local-op-proof",
    "binary": "/absolute/vacask/bin/vacask",
    "modules": "/absolute/vacask/lib/vacask/mod",
    "startupPath": "/absolute/config/vacaskrc.toml",
    "runRoot": "/absolute/scratch/vacask-jobs"
  },
  "capabilities": {
    "configured": true,
    "rawfileCollection": "native-multi-ascii",
    "inputs": ["source"],
    "analyses": ["op"],
    "parsedAnalyses": ["op"],
    "profiles": [{ "id": "local-op-proof", "corners": [] }],
    "maxTimeoutMs": 15000,
    "maxInputFiles": 24,
    "maxInputBytes": 1048576,
    "maxOutputBytes": 67108864,
    "cancel": true
  },
  "limits": {
    "maxInputFiles": 24,
    "maxInputBytes": 1048576,
    "maxOutputBytes": 67108864,
    "maxLogBytes": 65536,
    "maxRawFiles": 64,
    "maxEntries": 4096
  },
  "listen": { "host": "127.0.0.1", "port": 0 }
}
```

Create the controlled startup TOML explicitly (an empty file is valid). Adapt
the module directory to the selected package; Windows and Linux release layouts
can differ. Use a dedicated writable run root, never a Project/model directory
or another active harness's scratch root. The harness creates the root but
does not erase existing contents or claim recovery from arbitrary hard kills.

Only list analyses/devices/corners actually qualified for the declared Profile.
The example does not establish SKY130 or model qualification. Runtime optionally
accepts `dependencies` (`id`, `runtimePath`, `sha256`), `libraryPath`, and
`expectedEnvironment` using the shared measured-environment contract. The
capability dependency declarations must match the runtime registry. A hosted
runtime requires an accepted pinned environment, read-only assets and a pinned
image; copying this local example does not meet that requirement.

### Python runtime identity

For native `postprocess(PYTHON, ...)`, also declare operator-owned `runtime.python`:

```json
{
  "binary": "/usr/bin/python3",
  "libraries": ["/usr/lib/python3.12", "/absolute/vacask/lib/vacask/python"]
}
```

These paths are illustrative, not a qualified Python version or complete library
manifest. Include the actual standard library, installed packages used by the
Profile, and bundled helpers. A library tree's file symlink that points outside
the tree requires its exact target file as another `libraries` entry; allowing
an entire external directory is not sufficient. Directory symlinks are refused.

Set the controlled startup TOML to the same interpreter:

```toml
[Binaries]
python = "/usr/bin/python3"
```

Boot hashes the interpreter and declared library bytes into the existing
`vacask-runtime-assets` fingerprint, asks VACASK which interpreter its `PYTHON`
variable selects, and checks the resolved path before invoking that interpreter
for its Python 3 version. An accepted lock's asset mismatch fails before process
probing. Python bytecode writes are disabled by default; deployment must still
keep measured assets read-only. Startup failures leave this executor not-ready,
not the editor or authoring service unusable.

Python declarations are required with `expectedEnvironment` (therefore for a
hosted runtime); they may be omitted only for an unqualified, observed local
runtime. This measures declared files, not the completeness of Python's import
closure, all dynamic-loader dependencies, or arbitrary postprocessor programs.
Image pinning, package/model qualification and OS isolation remain separate
requirements. A local successful probe is not hosted acceptance.

## Native postprocessor measurements

### Shared authoring entry points

In Code, **Helper → embed** (outside `control`) inserts editable Python scalar
and curve-report functions. **Helper → postprocess** (inside `control`, after
the required analyses) inserts the native invocation. Sample calculations stay
commented until the author supplies real expressions and data reading. Check
the `reports.py` filename against existing files; insertion does not silently
replace a companion file. These are source edits with the editor's normal
draft, undo and save behavior, not a separate configuration form.

The same catalogue is available through the existing Simulation Resource and
the MCP `simulation` tool, without calling or requiring a configured executor:

```json
{
  "request": {
    "operation": "authoring-help",
    "context": "circuit",
    "name": "embed"
  }
}
```

Omit `name`/`context` to list helpers. Returned items contain the signature,
summary, upstream web reference and an editable `source` skeleton. Apply source
through revision-guarded `simulation_files` edits. Skeleton names are examples,
not collision-checked edits against the user's current Project. An unknown name
returns `SIMULATION_HELPER_NOT_FOUND`; it does not disable the session or forbid
native commands absent from the catalogue. Helpers do not install Python or
certify its runtime/library environment.

### Derived waveforms

`vacaskPlotPythonSource()` from `@icm/netlist` supplies ordinary Python defining
`report_plot`. After its own computation writes a **new native ASCII rawfile**,
the authored program can publish that record's meaning:

```python
report_plot("derived/gain.raw", "ac", axis="frequency",
            probes=[{"name": "Gain", "quantity": "transfer", "unit": "1"}])
```

The helper emits `ICM_PLOT_V1 ` followed by a result declaration containing
`artifactPath`, zero-based `plotOrdinal` (default 0), `analysis`, `axis` and
`probes`. It does not generate/evaluate a second experiment or serialize numeric
arrays into stdout. The bounded rawfile collector, native reader and existing
result/CSV APIs handle the actual samples. Supported projections are `op`
(one real point, no axis), `ac` (complex values, frequency in Hz), `tran` (real
values, time in seconds) and `dc` (real values, explicit axis probe with name,
quantity and unit). This does not qualify a custom Noise analysis or infer PSD
semantics. Unmapped columns keep unknown units; declared units are the author's
claim, not a dimensional proof. Names are case-sensitive.

Declarations cannot override source-derived solver mappings. Repeated record
declarations are ambiguous and excluded; malformed declarations, absent files,
bad arrays or missing vectors produce diagnostics without discarding other
valid records. No filesystem access is made using a reported path. Truncation
and dropped electrical inputs still withhold numerical results.

Each mapped analysis carries `postprocessor.logLine` in the shared result
(`result.data`/`result.json`); new runs publish no evaluated-output copy. The
GUI offers only Specs and Console, and nothing binds a computed same-name vector
to a Canvas node. Raw artifacts, the original console declaration and source
remain available through File APIs. This is output provenance, not a new
Project schema or saved input protocol.

The helper deliberately supplies neither a numeric evaluator nor a rawfile
writer: authors use their program/library. The real local journey test below
now reads actual native AC arrays, computes a complex expression in Python,
writes a new record, and checks result arrays, provenance, units and CSV export.
It is not full GUI/MCP simulation-journey or hosted acceptance. Shared helper
discovery is available above; qualified Python libraries and hosted isolation
remain migration work.

### Scalar measurements

The native source remains authoritative. VACASK's `postprocess(...)` runs the
author's program; the editor does not translate Python into another measurement
language or evaluate a parallel JSON experiment. The exported
`vacaskMeasurementPythonSource()` helper in `@icm/netlist` supplies ordinary,
editable, standard-library-only Python defining:

```python
report_measurement("gain", lambda: abs(gain_at_1khz), "1")
report_measurement("settling", lambda: find_settling_time(), "s")
```

Put that helper text and the computation in an authored file or a native
`embed` block, then invoke it with native `postprocess(PYTHON, "reports.py")`.
The helper does not include a waveform reader: the program can use the runtime's
qualified reader/library, or its own code, to read the actual run artifacts.
Interpreter/library availability and version qualification remain runtime
obligations; the helper itself imports only Python's `json`, `math` and `numbers`.

Each evaluated callable emits one console line prefixed `ICM_MEASUREMENT_V1 `
followed by an explicit JSON report:

```json
{ "name": "gain", "status": "available", "value": 12.5, "unit": "1" }
```

An exception or nonfinite/non-scalar result emits `status: "unavailable"` and a
`detail` string instead of `value`; later calls can continue. Names are
case-sensitive, available repetitions retain separate report numbers, and
units are author-declared rather than inferred from names. Ordinary printed
numbers are not interpreted as measurements. Invalid/incomplete framed lines
produce output diagnostics without discarding valid neighboring reports.
Reports from a run with dropped electrical input have their values withheld.

These are **output evidence**, not persisted input declarations or an assertion
that the editor verified the author's computation. The shared service parses
them, keeping occurrence and console line evidence, and passes them to the
run's Spec evaluation (`outputData.specs`, `specs.json`, `specs.csv`). New runs
publish no `native-measurements.json`/`.csv` artifacts, and the GUI shows Specs
and Console rather than a separate measurement view. Unavailable CSV values are
empty, never zero. No raw plot/analysis association is guessed. Original
console/source artifacts remain available. A program that fails before
reporting cannot be used to infer an expected name, value or successful
measurement.

The real local service/process test also uses the shared helper and reads an
actual OP artifact before reporting; it verifies failure recovery, repeated
reports and File Resource export. Run it with explicit `VACASK_BIN`,
`VACASK_MODULES`, an absolute `ICM_PYTHON` interpreter path, and
`ICM_PYTHON_LIBRARIES` containing the declared library directories and external
target files, separated by the host path delimiter (`:` on Linux, `;` on Windows):

```sh
pnpm test:local containers/vacask/native-measurement-journey.test.mjs
```

This is not a hosted Python/sandbox qualification or a complete GUI/MCP
simulation journey. Derived curves can be reported as described above; reusable
numeric computation/writing libraries and richer measurement recipes remain
separate migration work, not features of the declaration helper.

## Real hierarchical OTA journey

After the dependency build, run the original shipped OTA through Prepare/Start,
the local-host HTTP adapter, the actual native process and the shared File Resource:

```sh
VACASK_BIN=/absolute/vacask/bin/vacask \
VACASK_MODULES=/absolute/vacask/lib/vacask/mod \
ICM_VACASK_CONVERTED_TT=/absolute/converted/tt.sim \
pnpm test:local containers/vacask/sky130-public-journey.test.mjs
```

The test skips without these explicit inputs. The TT file must match the captured
dependency digest in `netlists/vacask-sky130/model-symbols-tt.json`; substituting a
different model without updating and verifying its evidence is rejected. Linux
packages needing additional shared libraries can explicitly supply the existing
operator-owned `ICM_VACASK_LIBRARY_PATH`. No implicit PDK discovery is performed.

The fixture keeps the shipped Canvas topology and dimensions. Its model-loading
policy declares `defaultScale: 1e-6`, matching the candidate model's micrometre-valued
wrapper parameters and existing reference decks. Prepare inserts an inspectable
initial `options scale` in the first reached control block; authored source needs
no scale patch. Later authored options and `clear options` retain native semantics.
This is not a hidden geometry rewrite or a globally qualified Profile. The test
reads complete result artifacts in pages, checks OP/DC/AC/TRAN/Noise
records, nine M1 model-parameter mappings, CSV/raw exports and scratch cleanup.
Its authored program switches VINP to DC for the transfer sweep, restores
the nominal bias for AC/Noise, and restores pulse mode for TRAN. It requests
explicit high precision, with a 1 pA transient current floor: the tighter
1 fA floor caused NR timestep collapse at the 1 ns edge even with more
iterations or Gear2. No product solver defaults or foundry values change.
The transient capture requires more than 1 MB, so this test advertises an
8 MiB output cap and still reads the same paged File Resource. Optional
`ICM_VACASK_EVIDENCE_DIR` retains exact prepared/input/result artifacts in a
fresh `ota-public-*` directory, including failed-run evidence. Those artifacts
are observations, not auto-approved numerical baselines.
The serialized executor envelope allows 256 MiB when an updated caller requests
`x-analog-execution-transfer: receipt-v1`; legacy buffered readers keep the
8 MiB ceiling. The native Worker and local forwarder negotiate this explicitly.
The isolated native gateway forwards the opt-in and sets
`SIMULATION_GATEWAY_MAX_RESPONSE_BYTES` to 268435456. Its accepted executor
configuration separately declares matching collector limits and capabilities;
the local example above budgets 64 MiB. Raw budgets exclude JSON escaping and
parsed-result duplication, so they must leave envelope headroom. Oversized
responses still fail explicitly without automatic re-execution. None of these
configuration changes deploys or modifies an already running operator host.
A passing run proves this local integration only: it does not certify model
accuracy, all analyses/corners, GUI/public MCP transport or hosted isolation.

## Transport and shutdown

The native Worker route requires `VACASK_PROFILE_ID` plus the explicitly
selected executor (`VACASK_UPSTREAM_URL`/`VACASK_UPSTREAM_TOKEN` for the private
HTTPS gateway, or a provisioned `VACASK` binding); there,
`SIMULATION_UPSTREAM_URL` and its token stay with the ngspice route. A Worker
with `SIMULATION_PROFILE_ID` but no `VACASK_PROFILE_ID` keeps the older
native-only route, which uses those `SIMULATION_*` settings. `/health` must
report that Profile, verified pinned VACASK environment metadata and the native
capabilities above. Worker forwards exact input files and validates result
evidence through the shared service; it does not add `.lib`, `.include`, or
parse numbers independently.
Do not point this migration at the current production/shared operator endpoint.
No deployment configuration or qualified model registration is supplied by this
harness. Use the isolated migration delivery described in the roadmap.

To connect the built local Editor host to this separately running executor:

```sh
pnpm --filter @icm/local-host build
node apps/local-host/dist/cli.js --root apps/editor/dist --simulation-url http://127.0.0.1:9000
```

Replace `9000` with the native service's actual port. Build the Editor with
`VITE_ICM_SIMULATION_UI=enabled` and `VITE_ICM_SIMULATION_TRANSPORT=direct` for
this local-host route, not the hosted managed queue transport. The CLI serves
the Editor on port 4173 and forwards only the
shared `/api/simulate` protocol. The executor URL must be a literal loopback HTTP
origin; redirects and caller credentials are not forwarded. Omitting the option
retains the unconfigured editing-only behavior. Stopping the Editor does not own
or stop the separately launched executor; use that service's shutdown path.
This is a local transport setup, not evidence of GUI/MCP or cloud acceptance.

- `GET /health`: startup/runtime readiness and current activity.
- `POST /run`: the existing native `ExecutionInput`, plus optional timeout/token;
  returns the existing result with separate raw/executed file collections.
- `POST /cancel`: `{ "runToken": "..." }`; cancellation can arrive before Run.
- `POST /api/simulate`: the existing local client transport, including
  `operation: "capabilities"` and `operation: "cancel"`.

This is an **internal** HTTP server: local mode binds only loopback. Hosted mode
may use an explicit private-container binding, behind the existing separate
credential-owning [gateway](../ngspice/gateway.mjs). Never expose the executor
port publicly. Browser Origin calls are refused. The deployment still owes
filesystem/process/network isolation; an HTTP input guard is not a sandbox.

`SIGINT`/`SIGTERM` on platforms with catchable signals stop admission, cancel
the active process and await its lease cleanup. Disconnected clients do not
release this responsibility. Pending HTTP replies may be lost during shutdown;
that is not authority to resubmit an uncertain run. The exported
`startVacaskService(...).stop()` uses the same path and is idempotent. Windows
forced process termination is not catchable shutdown; a Job Object/enclosing
sandbox remains required before hostile-code isolation or forced-stop safety
can be claimed there.

The launcher does not change Worker URLs, install services, register model
Profiles, publish deployments, or recover Gallery/Project data. Deployment and
cloud acceptance remain separate migration obligations.
