#!/bin/sh
set -eu

container="${SIMULATION_CONTAINER_NAME:-analog-canvas-ngspice}"
attempts="${SIMULATION_HEALTH_ATTEMPTS:-180}"
interval="${SIMULATION_HEALTH_INTERVAL_SECONDS:-1}"
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

case "$attempts" in
  ''|*[!0-9]*)
    printf 'SIMULATION_HEALTH_ATTEMPTS must be a positive integer\n' >&2
    exit 1
    ;;
esac
[ "$attempts" -gt 0 ] || {
  printf 'SIMULATION_HEALTH_ATTEMPTS must be positive\n' >&2
  exit 1
}

probe='const response = await fetch("http://127.0.0.1:8080/health"); const text = await response.text(); if (!response.ok) throw new Error(`health ${response.status}: ${text}`); const value = JSON.parse(text); if (value.status !== "ready") throw new Error(`health status ${value.status}`); process.stdout.write(text);'

i=1
ready=false
while [ "$i" -le "$attempts" ]; do
  if health="$(docker exec "$container" node --input-type=module -e "$probe" 2>/dev/null)"; then
    ready=true
    break
  fi
  sleep "$interval"
  i=$((i + 1))
done

if [ "$ready" != true ]; then
  printf 'simulator host health failed after %s attempts\n' "$attempts" >&2
  docker logs --tail 100 "$container" >&2 || true
  exit 1
fi

if ! smoke_result="$(docker exec -i "$container" node --input-type=module < "$script_dir/numerical-smoke.mjs")"; then
  printf 'simulator host numerical smoke failed\n' >&2
  docker logs --tail 100 "$container" >&2 || true
  exit 1
fi

printf '%s\n' "$smoke_result" >&2
printf '%s\n' "$health"
