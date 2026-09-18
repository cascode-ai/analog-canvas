# Isolated native candidate topology

This Compose project is an isolated candidate, not the shared operator deployment.
It reuses the existing credential-owning gateway (currently under
`containers/ngspice/`); that file does not invoke a simulator. No alternate
authentication or execution protocol is introduced.

Set `VACASK_IMAGE` to the accepted native repository image digest (a locally
built tag is usable for local tests; inspect and record its resolved identity).
Set `VACASK_RUNTIME_CONFIG` to the absolute existing runtime configuration file:
hosted-container, pinned expected environment, `listen.host=0.0.0.0`,
`listen.port=8080`, and `/var/lib/vacask` as the run root. Never use the shared
operator credential: provide a separate `SIMULATION_ACCESS_TOKEN`.

```sh
docker compose -p icm-vacask-candidate -f containers/vacask/host/compose.yaml config --quiet
docker compose -p icm-vacask-candidate -f containers/vacask/host/compose.yaml up -d
```

Only the gateway publishes a port, on loopback (`VACASK_GATEWAY_PORT`, default
19090). It joins both the entry network and the private simulation network.
The executor joins only the internal network, has no published port or gateway
credential, and uses bounded private tmpfs scratch, non-root, read-only root and
resource limits. No globally named container, volume or network collides with
the existing operator stack. Project names must remain distinct.

Acceptance: GET `/health` returns the pinned native environment; POST `/run`
without a token or with the wrong token returns 401; a valid Bearer token and
existing native ExecutionInput returns complete native results. Inspect the
executor container to verify no token environment or published ports. Run the
[image lifecycle smoke](../IMAGE.md) separately for cancellation and recovery.

Remove only this test project's resources when finished:

```sh
docker compose -p icm-vacask-candidate -f containers/vacask/host/compose.yaml down
```

Local startup does not enable the optional `tunnel` profile. The existing
**Simulator host** workflow now has an explicit `vacask-preview` action. It takes
a draft asset release (`vacask-preview-assets-*`), the SHA256 of its
`vacask-candidate-source.tgz`, and the SHA256 of `native-compose-config.json`.
It checks available host memory/disk, verifies both downloads, builds the image
on the host, and starts only Compose project `icm-vacask-preview` under
`~/analog-canvas-vacask-preview/releases/<commit>`.

That opt-in action owns tunnel `analog-canvas-vacask-preview`, DNS
`vacask-preview-sim.tokenzhang.com`, and the `VACASK_UPSTREAM_TOKEN` secrets on
both hosted channel Workers. It never edits the shared ngspice stack. Gateway
and tunnel tokens stay outside the executor and the image. A mismatching
existing DNS record is refused rather than overwritten. `/health` must match
the supplied pinned fingerprint, and anonymous `/run` must return 401. The
action does **not** deploy Worker/editor code or certify an Agent journey; those
are subsequent acceptance.
Failed candidates remain isolated for diagnosis; use only this candidate's
Compose project for recovery, never a shared-host prune or reset.
The gateway source is mounted read-only from the checkout, so record the code
revision with the image and runtime lock. Do not claim the image alone pins it.
