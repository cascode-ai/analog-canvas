#!/bin/sh
set -eu

container="${SIMULATION_CONTAINER_NAME:-analog-canvas-ngspice}"

fail() {
  printf 'simulator host runtime invalid: %s\n' "$1" >&2
  exit 1
}

value() {
  docker inspect --format "$1" "$container"
}

restart="$(value '{{.HostConfig.RestartPolicy.Name}}')"
case "$restart" in
  always|unless-stopped) ;;
  *) fail "restart policy is '$restart', expected always or unless-stopped" ;;
esac

[ "$(value '{{.HostConfig.ReadonlyRootfs}}')" = "true" ] \
  || fail "root filesystem is writable"

cap_drop="$(value '{{json .HostConfig.CapDrop}}')"
case "$cap_drop" in
  *ALL*) ;;
  *) fail "the container does not drop all Linux capabilities" ;;
esac

pids="$(value '{{.HostConfig.PidsLimit}}')"
[ "$pids" -gt 0 ] 2>/dev/null || fail "there is no positive PID limit"

nanocpus="$(value '{{.HostConfig.NanoCpus}}')"
[ "$nanocpus" -eq 8000000000 ] 2>/dev/null \
  || fail "CPU limit is $nanocpus nanocpus, expected 8000000000"

memory="$(value '{{.HostConfig.Memory}}')"
[ "$memory" -eq 17179869184 ] 2>/dev/null \
  || fail "memory limit is $memory bytes, expected 17179869184"

published="$(value '{{json .HostConfig.PortBindings}}')"
case "$published" in
  null|'{}') ;;
  *) fail "the simulator publishes host ports: $published" ;;
esac

run_root_rw="$(value '{{range .Mounts}}{{if eq .Destination "/var/lib/simulation"}}{{.RW}}{{end}}{{end}}')"
[ "$run_root_rw" = "true" ] \
  || fail "the private run-root volume is absent or read-only"

printf 'simulator host runtime verified: restart=%s pids=%s cpus=8 memory=16GiB\n' \
  "$restart" "$pids"
