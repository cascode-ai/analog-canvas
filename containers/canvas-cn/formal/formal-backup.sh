#!/usr/bin/env bash
# Consistent stopped-state backup of the regional runtime (state, journal,
# sessions, receipts and artifacts). Keeps the newest 20 snapshots locally;
# off-host copies are an operator step (README).
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
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backups=/var/backups/analog-canvas-formal
dest=$backups/$stamp
install -d -o root -g root -m 0700 "$dest"
restart=0
restore_service() {
  if test "$restart" = 1; then systemctl start canvas-cn-formal; fi
}
trap restore_service EXIT
restart=1
systemctl stop canvas-cn-formal
tar --numeric-owner -czf "$dest/state.tar.gz" -C "$root" state artifacts
cp "$release/release.json" "$dest/release.json"
sha256sum "$dest/state.tar.gz" > "$dest/state.sha256"
systemctl start canvas-cn-formal
restart=0
trap - EXIT
systemctl is-active --quiet canvas-cn-formal
find "$backups" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -printf '%f\n' | sort -r | tail -n +21 | while read -r old; do rm -rf -- "${backups:?}/$old"; done
echo "$dest"
