#!/usr/bin/env bash
# Daily and pre-release stopped-state snapshot of state and artifacts.
# Cloud Backup copies the published directories off the host (README).
set -euo pipefail
test "$(id -u)" = 0
umask 077
exec 9>/run/lock/canvas-cn-formal-backup.lock
flock -n 9
root=/var/lib/analog-canvas-formal
test -d "$root/state" && test -d "$root/artifacts"
release=$(readlink -f /opt/analog-canvas/current-formal)
[[ "$release" == /opt/analog-canvas/formal-releases/* ]]
test -f "$release/release.json"
systemctl is-active --quiet canvas-cn-formal
backups=/var/backups/analog-canvas-formal
install -d -o root -g root -m 0700 "$backups"
dest=$backups/$(date -u +%Y%m%dT%H%M%SZ)
stage=$(mktemp -d "$backups/.incomplete.XXXXXXXX")
restart=0
cleanup() {
  if test "$restart" = 1; then systemctl start canvas-cn-formal || true; fi
  rm -rf -- "$stage"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
restart=1
systemctl stop canvas-cn-formal
tar --numeric-owner -cf "$stage/state.tar" -C "$root" state artifacts
systemctl start canvas-cn-formal
restart=0
systemctl is-active --quiet canvas-cn-formal
gzip -1 "$stage/state.tar"
cp "$release/release.json" "$stage/release.json"
(cd "$stage" && sha256sum state.tar.gz > state.sha256)
mv -T -- "$stage" "$dest"
find "$backups" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -printf '%f\n' | sort -r | tail -n +21 | while read -r old; do rm -rf -- "${backups:?}/$old"; done
echo "$dest"
