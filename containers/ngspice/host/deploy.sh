#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
source_root="$(CDPATH= cd -- "$script_dir/../../.." && pwd)"
host_home="${SIMULATOR_HOST_HOME:-$HOME/analog-canvas-sim}"
runtime_env="$host_home/secrets/runtime.env"
tunnel_env="$host_home/secrets/tunnel.env"
# The China region's credential; present only once that region is connected.
regional_env="$host_home/secrets/regional.env"
compose_file="$script_dir/compose.yaml"

fail() {
  printf 'simulator host deploy failed: %s\n' "$1" >&2
  exit 1
}

"$script_dir/bootstrap.sh" >/dev/null

[ -f "$runtime_env" ] || fail "missing $runtime_env"
grep -Eq '^SIMULATION_ACCESS_TOKEN=.+$' "$runtime_env" \
  || fail "$runtime_env does not contain SIMULATION_ACCESS_TOKEN"

if [ -f "$source_root/SOURCE_COMMIT" ]; then
  source_commit="$(sed -n '1p' "$source_root/SOURCE_COMMIT" | tr -d '\r\n')"
elif command -v git >/dev/null 2>&1 \
    && git -C "$source_root" rev-parse --verify HEAD >/dev/null 2>&1; then
  source_commit="$(git -C "$source_root" rev-parse HEAD)"
else
  fail "SOURCE_COMMIT is absent and the source is not a Git checkout"
fi

printf '%s\n' "$source_commit" | grep -Eq '^[0-9a-f]{7,40}$' \
  || fail "SOURCE_COMMIT is not a Git object id"
SIMULATION_IMAGE_TAG="$(printf '%s' "$source_commit" | cut -c1-12)"
export SIMULATION_IMAGE_TAG

tunnel_enabled=false
if [ -f "$tunnel_env" ]; then
  grep -Eq '^TUNNEL_TOKEN=.+$' "$tunnel_env" \
    || fail "$tunnel_env exists but does not contain TUNNEL_TOKEN"
  tunnel_enabled=true
fi

regional_enabled=false
if [ -f "$regional_env" ]; then
  grep -Eq '^REGIONAL_SIMULATION_ACCESS_TOKEN=.+$' "$regional_env"     || fail "$regional_env exists but does not contain REGIONAL_SIMULATION_ACCESS_TOKEN"
  regional_enabled=true
fi

compose() {
  set -- -f "$compose_file" "$@"
  if [ "$regional_enabled" = true ]; then
    set -- --env-file "$regional_env" --profile regional "$@"
  fi
  if [ "$tunnel_enabled" = true ]; then
    set -- --env-file "$tunnel_env" --profile tunnel "$@"
  fi
  docker compose --project-name analog-canvas-sim --env-file "$runtime_env" "$@"
}

# The #587 host used the same deliberate container names but created them with
# operator-owned docker commands. Compose cannot adopt such a container. The
# one-time transition removes only those exact legacy resources; a container
# already owned by this Compose project is updated normally.
replace_legacy_container() {
  legacy_container="$1"
  if ! docker inspect "$legacy_container" >/dev/null 2>&1; then
    return
  fi
  owner="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$legacy_container" 2>/dev/null || true)"
  if [ "$owner" != "analog-canvas-sim" ]; then
    printf 'replacing legacy container outside tracked Compose ownership: %s\n' \
      "$legacy_container"
    docker rm -f "$legacy_container" >/dev/null
  fi
}

compose build --pull executor sg13g2
replace_legacy_container analog-canvas-ngspice
replace_legacy_container analog-canvas-ngspice-executor
if [ "$tunnel_enabled" = true ]; then
  replace_legacy_container analog-canvas-tunnel
  compose up -d --remove-orphans simulator tunnel
else
  compose up -d --remove-orphans simulator
fi

"$script_dir/health.sh" >/dev/null
ln -sfn "$source_root" "$host_home/current"

if [ "$regional_enabled" = true ]; then
  sh "$script_dir/check-regional-budget.sh"
  compose up -d regional-gateway
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if curl -fsS --max-time 5 http://127.0.0.1:19094/health >/dev/null 2>&1 \
        && curl -fsS --max-time 5 http://127.0.0.1:19094/sg13g2/health >/dev/null 2>&1; then break; fi
    [ "$attempt" = 12 ] && fail "regional gateway did not become healthy"
    sleep 5
  done
fi

printf 'simulator host deployed: commit=%s image=analog-canvas-ngspice:%s tunnel=%s\n' \
  "$source_commit" "$SIMULATION_IMAGE_TAG" "$tunnel_enabled"
