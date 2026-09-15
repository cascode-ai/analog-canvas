# Native VACASK execution harness

This is the migration branch's native harness, not an already qualified hosted
SKY130 environment. It uses the existing simulation service, result protocol and
process supervisor. It never falls back to ngspice.

## Run locally

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
Unresolved conditional primitives remain explicit in the report; a successful
inspection is not model/electrical qualification or authorization to deploy.

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
    "maxOutputBytes": 1048576,
    "cancel": true
  },
  "limits": {
    "maxInputFiles": 24,
    "maxInputBytes": 1048576,
    "maxOutputBytes": 1048576,
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

## Transport and shutdown

The native Worker route requires `SIMULATION_PROFILE_ID` plus the explicitly
selected executor (`SIMULATION_UPSTREAM_URL`/token for the private HTTPS gateway,
or a provisioned `VACASK` binding). `/health` must report that Profile, verified
pinned VACASK environment metadata and the native capabilities above. Worker
forwards exact input files and validates result evidence through the shared
service; it does not add `.lib`, `.include`, or parse numbers independently.
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
