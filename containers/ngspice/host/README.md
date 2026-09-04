# Operator simulator host

This directory is the executable recovery record for the operator-run ngspice
host. The host is disposable: simulation runs are temporary, and no Project or
result data is stored here. A replacement host needs only Docker, the Compose
plugin, this repository, and the deployment secrets.

`compose.yaml` is the sole desired-state definition. It gives the harness a
private run-root volume and an internal network with no egress. `cloudflared`
joins that network and a separate egress network, so it is the only path to the
harness. Neither service publishes a host port. `deploy.sh` and `health.sh` are
thin operators over that definition; `../verify-host-runtime.sh` independently
checks the security and resource boundary after deployment.

## Repository-owned deployment

The **Simulator host** GitHub workflow copies the exact
`containers/ngspice/` tree into a commit-addressed directory on the host,
writes the access token from the protected `cloudflare-preview` environment,
builds the pinned image, starts the services, and verifies the result. Its
`bootstrap-tunnel` action creates or reuses the named Cloudflare Tunnel and
writes its connector token without printing it.

The host account needs:

- a Linux host with Docker Engine and Docker Compose 2.33.1 or newer;
- permission to use the Docker daemon without an interactive elevation;
- enough capacity for the declared 8 CPU and 16 GiB harness limit;
- the SSH key and host identity represented by the repository's
  `SIM_HOST_*` environment secrets.

No lifecycle script is installed by hand. The workflow invokes only the files
in this directory.

## Recover onto a clean host

1. Install Docker Engine and the Compose plugin, create the non-root operator
   account, and grant that account access to Docker.
2. Point `SIM_HOST_ADDR`, `SIM_HOST_USER`, `SIM_HOST_SSH_KEY`, and
   `SIM_HOST_KNOWN_HOSTS` at the replacement machine.
3. Run **Simulator host / bootstrap-tunnel**. This installs the tracked bundle,
   restores the named tunnel/DNS configuration, writes both runtime secrets,
   and deploys the services.
4. Run **Simulator host / deploy** once more as a recovery drill. It must be
   idempotent.
5. Require all three checks to pass:

   ```sh
   ~/analog-canvas-sim/current/containers/ngspice/host/health.sh
   ~/analog-canvas-sim/current/containers/ngspice/verify-host-runtime.sh
   curl --fail https://sim-fra.analog-canvas.tokenzhang.com/health
   ```

   An unauthenticated `POST /run` must return HTTP 401; the workflow checks it.

For a destructive drill, use a disposable host, run Compose `down --volumes`
against its current tracked file, remove `~/analog-canvas-sim`, and repeat the
five steps. Nothing from the old host should be copied. GitHub environment
secrets and the Cloudflare account are control-plane inputs, not backup files
inside this repository.

## Manual local proof

For development on a Docker-capable Linux machine, create the runtime secret
without committing it and deploy from a checkout:

```sh
export SIMULATOR_HOST_HOME="$HOME/analog-canvas-sim-test"
containers/ngspice/host/bootstrap.sh
umask 077
printf 'SIMULATION_ACCESS_TOKEN=%s\n' "$SIMULATION_ACCESS_TOKEN" \
  > "$SIMULATOR_HOST_HOME/secrets/runtime.env"
containers/ngspice/host/deploy.sh
containers/ngspice/verify-host-runtime.sh
```

Without `secrets/tunnel.env`, only the harness starts. This is intentional for
local proof and for the first deployment before the named tunnel exists.
