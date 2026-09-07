#!/bin/sh
set -eu

gateway="${SIMULATION_GATEWAY_CONTAINER_NAME:-analog-canvas-ngspice}"
executor="${SIMULATION_EXECUTOR_CONTAINER_NAME:-analog-canvas-ngspice-executor}"

fail() {
  printf 'simulator host runtime invalid: %s\n' "$1" >&2
  exit 1
}

value() {
  container="$1"
  format="$2"
  docker inspect --format "$format" "$container"
}

for container in "$gateway" "$executor"; do
  restart="$(value "$container" '{{.HostConfig.RestartPolicy.Name}}')"
  case "$restart" in
    always|unless-stopped) ;;
    *) fail "$container restart policy is '$restart'" ;;
  esac
  [ "$(value "$container" '{{.HostConfig.ReadonlyRootfs}}')" = "true" ] \
    || fail "$container root filesystem is writable"
  case "$(value "$container" '{{json .HostConfig.CapDrop}}')" in
    *ALL*) ;;
    *) fail "$container does not drop all Linux capabilities" ;;
  esac
  pids="$(value "$container" '{{.HostConfig.PidsLimit}}')"
  [ "$pids" -gt 0 ] 2>/dev/null || fail "$container has no positive PID limit"
  published="$(value "$container" '{{json .HostConfig.PortBindings}}')"
  case "$published" in
    null|'{}') ;;
    *) fail "$container publishes host ports: $published" ;;
  esac
done

nanocpus="$(value "$executor" '{{.HostConfig.NanoCpus}}')"
[ "$nanocpus" -eq 8000000000 ] 2>/dev/null \
  || fail "executor CPU limit is $nanocpus nanocpus, expected 8000000000"

memory="$(value "$executor" '{{.HostConfig.Memory}}')"
[ "$memory" -eq 17179869184 ] 2>/dev/null \
  || fail "executor memory limit is $memory bytes, expected 17179869184"

run_root_rw="$(value "$executor" '{{range .Mounts}}{{if eq .Destination "/var/lib/simulation"}}{{.RW}}{{end}}{{end}}')"
[ "$run_root_rw" = "true" ] \
  || fail "the private run-root volume is absent or read-only"

# ngspice's tmpfile() always goes to /tmp; on a read-only root that must be a
# private tmpfs or every run dies with "tmpfile(): Read-only file system".
tmp_type="$(value "$executor" '{{range .Mounts}}{{if eq .Destination "/tmp"}}{{.Type}}{{end}}{{end}}')"
[ "$tmp_type" = "tmpfs" ] \
  || fail "/tmp is not a private tmpfs, so the simulator cannot open its scratch files"

executor_env="$(value "$executor" '{{json .Config.Env}}')"
gateway_env="$(value "$gateway" '{{json .Config.Env}}')"
case "$executor_env" in
  *SIMULATION_ACCESS_TOKEN=*) fail "executor received the gateway token" ;;
esac
case "$gateway_env" in
  *SIMULATION_ACCESS_TOKEN=*) ;;
  *) fail "gateway has no access token" ;;
esac

printf 'simulator host runtime verified: isolated gateway; executor cpus=8 memory=16GiB\n'
