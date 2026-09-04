#!/bin/sh
set -eu

host_home="${SIMULATOR_HOST_HOME:-$HOME/analog-canvas-sim}"

fail() {
  printf 'simulator host bootstrap failed: %s\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is not installed"
docker compose version >/dev/null 2>&1 \
  || fail "the Docker Compose plugin is not installed"
docker info >/dev/null 2>&1 \
  || fail "the current account cannot reach the Docker daemon"

mkdir -p "$host_home/releases" "$host_home/secrets"
chmod 700 "$host_home/secrets"

# The first repository-owned deployment may land on the host created by #587.
# Preserve its connector credential while moving it to the only location the
# tracked topology reads. A clean replacement host has no legacy file and
# takes the ordinary bootstrap-tunnel path instead.
if [ -f "$host_home/tunnel.env" ] \
    && [ ! -f "$host_home/secrets/tunnel.env" ]; then
  mv "$host_home/tunnel.env" "$host_home/secrets/tunnel.env"
  chmod 600 "$host_home/secrets/tunnel.env"
  printf 'migrated legacy tunnel credential into the tracked host layout\n'
fi

printf 'simulator host ready for repository-owned deployment: %s\n' "$host_home"
