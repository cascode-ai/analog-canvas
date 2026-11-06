#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(id -u)" = 0
exec 9>/run/lock/canvas-cn-native.lock
flock -n 9 || { echo 'Another native maintenance operation is running' >&2; exit 1; }
systemctl is-active --quiet canvas-cn-native
backup=$(mktemp -d /var/backups/analog-canvas/native-XXXXXXXX)
release=$(readlink -f /opt/analog-canvas/current-native)
case "$release" in /opt/analog-canvas/releases/native-*) ;; *) echo 'Unexpected release path' >&2; exit 1 ;; esac
recover() {
  status=$?
  trap - EXIT HUP INT TERM
  if ! systemctl start canvas-cn-native; then
    echo 'Backup interrupted and runtime recovery failed; inspect canvas-cn-native' >&2
    exit 1
  fi
  exit "$status"
}
trap recover EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
systemctl stop canvas-cn-native
tar -czf "$backup/state.tar.gz" -C /var/lib/analog-canvas/native state session-token
systemctl start canvas-cn-native
trap - EXIT HUP INT TERM
tar -czf "$backup/release.tar.gz" -C "$release" .
cp /opt/analog-canvas/runtime/workerd-2026-09-11 "$backup/workerd"
cp /etc/systemd/system/canvas-cn-native.service "$backup/"
date --iso-8601=seconds > "$backup/created-at.txt"
(cd "$backup" && sha256sum state.tar.gz release.tar.gz workerd canvas-cn-native.service > SHA256SUMS)
chmod 0600 "$backup"/*
for attempt in $(seq 1 15); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:8788/api/auth/me >/dev/null; then
    echo "$backup"
    exit 0
  fi
  sleep 1
done
echo 'Backup written, but runtime did not recover; inspect canvas-cn-native' >&2
exit 1
