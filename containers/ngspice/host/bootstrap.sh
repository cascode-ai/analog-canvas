#!/bin/sh
set -eu

host_home="${SIMULATOR_HOST_HOME:-$HOME/analog-canvas-sim}"

fail() {
  printf 'simulator host bootstrap failed: %s\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is not installed"
compose_version="2.33.1"

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  command -v sudo >/dev/null 2>&1 \
    || fail "installing the Docker Compose plugin requires root or sudo"
  sudo -n true >/dev/null 2>&1 \
    || fail "installing the Docker Compose plugin requires passwordless sudo"
  sudo -n "$@"
}

install_compose_plugin() {
  command -v curl >/dev/null 2>&1 \
    || fail "installing the Docker Compose plugin requires curl"
  command -v sha256sum >/dev/null 2>&1 \
    || fail "installing the Docker Compose plugin requires sha256sum"

  case "$(uname -m)" in
    x86_64|amd64)
      compose_arch="x86_64"
      compose_sha256="3efda1ad6caed49dedd5644cadbf7e0c9cc3d74d8844ca5237b6a43ac1ef1a46"
      ;;
    aarch64|arm64)
      compose_arch="aarch64"
      compose_sha256="fa0e077510c852237b0da426d0daf6853446e7760145ce7665ec401892a4d0de"
      ;;
    *) fail "Docker Compose $compose_version is not pinned for $(uname -m)" ;;
  esac

  compose_tmp="$(mktemp)"
  trap 'rm -f "$compose_tmp"' 0 1 2 15
  printf 'installing pinned Docker Compose %s for %s\n' \
    "$compose_version" "$compose_arch"
  curl --fail --location --silent --show-error \
    "https://github.com/docker/compose/releases/download/v$compose_version/docker-compose-linux-$compose_arch" \
    --output "$compose_tmp"
  printf '%s  %s\n' "$compose_sha256" "$compose_tmp" | sha256sum --check --status \
    || fail "the Docker Compose download did not match its pinned digest"
  as_root install -d -m 755 /usr/local/lib/docker/cli-plugins
  as_root install -m 755 "$compose_tmp" \
    /usr/local/lib/docker/cli-plugins/docker-compose
  rm -f "$compose_tmp"
  trap - 0 1 2 15
}

compose_current="$(docker compose version --short 2>/dev/null || true)"
if [ "${compose_current#v}" != "$compose_version" ]; then
  install_compose_plugin
fi
compose_current="$(docker compose version --short 2>/dev/null || true)"
[ "${compose_current#v}" = "$compose_version" ] \
  || fail "Docker Compose $compose_version is unavailable after installation"
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
