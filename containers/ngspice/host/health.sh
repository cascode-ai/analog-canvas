#!/bin/sh
set -eu

container="${SIMULATION_CONTAINER_NAME:-analog-canvas-ngspice}"
attempts="${SIMULATION_HEALTH_ATTEMPTS:-180}"
interval="${SIMULATION_HEALTH_INTERVAL_SECONDS:-1}"

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
while [ "$i" -le "$attempts" ]; do
  if health="$(docker exec "$container" node --input-type=module -e "$probe" 2>/dev/null)"; then
    printf '%s\n' "$health"
    exit 0
  fi
  sleep "$interval"
  i=$((i + 1))
done

printf 'simulator host health failed after %s attempts\n' "$attempts" >&2
docker logs --tail 100 "$container" >&2 || true
exit 1
