#!/bin/sh
set -eu

gateway="${SIMULATION_GATEWAY_CONTAINER_NAME:-analog-canvas-ngspice}"
sky130="${SIMULATION_EXECUTOR_CONTAINER_NAME:-analog-canvas-ngspice-executor}"
sg13g2="${SG13G2_EXECUTOR_CONTAINER_NAME:-analog-canvas-sg13g2-executor}"
set -- "$sky130" "$sg13g2"

fail() {
  printf 'simulator host runtime invalid: %s\n' "$1" >&2
  exit 1
}

value() {
  container="$1"
  format="$2"
  docker inspect --format "$format" "$container"
}

for container in "$gateway" "$@"; do
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

previous_sources=''
for executor in "$@"; do
  nanocpus="$(value "$executor" '{{.HostConfig.NanoCpus}}')"
  [ "$nanocpus" -eq 8000000000 ] 2>/dev/null \
    || fail "executor CPU limit is $nanocpus nanocpus, expected 8000000000"

  memory="$(value "$executor" '{{.HostConfig.Memory}}')"
  [ "$memory" -eq 17179869184 ] 2>/dev/null \
    || fail "executor memory limit is $memory bytes, expected 17179869184"

  run_root_rw="$(value "$executor" '{{range .Mounts}}{{if eq .Destination "/var/lib/simulation"}}{{.RW}}{{end}}{{end}}')"
  [ "$run_root_rw" = "true" ] \
    || fail "the private run-root volume is absent or read-only"
  source="$(value "$executor" '{{range .Mounts}}{{if eq .Destination "/var/lib/simulation"}}{{.Source}}{{end}}{{end}}')"
  [ -n "$source" ] || fail "$executor has no scratch mount source"
  if printf '%s\n' "$previous_sources" | grep -Fxq -- "$source"; then
    fail "Profiles share a run-root volume"
  fi
  previous_sources="$(printf '%s\n%s' "$previous_sources" "$source")"

  # ngspice's tmpfile() always goes to /tmp; on a read-only root that must be a
  # private tmpfs or every run dies with "tmpfile(): Read-only file system".
  tmp_type="$(value "$executor" '{{range .Mounts}}{{if eq .Destination "/tmp"}}{{.Type}}{{end}}{{end}}')"
  [ "$tmp_type" = "tmpfs" ] \
    || fail "/tmp is not a private tmpfs, so the simulator cannot open its scratch files"

  executor_env="$(value "$executor" '{{json .Config.Env}}')"
  case "$executor_env" in
    *SIMULATION_ACCESS_TOKEN=*) fail "executor received the gateway token" ;;
  esac
done

gateway_env="$(value "$gateway" '{{json .Config.Env}}')"
case "$gateway_env" in
  *SIMULATION_ACCESS_TOKEN=*) ;;
  *) fail "gateway has no access token" ;;
esac

printf 'simulator host runtime verified: isolated gateway; SKY130 and SG13G2 executors each cpus=8 memory=16GiB\n'
