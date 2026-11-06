#!/usr/bin/env bash
# Transfer the stopped private dataset, including writes made after a switch.
set -euo pipefail
umask 077
test "$(id -u)" = 0
exec 9>/run/lock/canvas-cn-native.lock
flock -n 9 || { echo 'Maintenance already running' >&2; exit 1; }
case "${1:-}" in
  native)
    source=/var/lib/analog-canvas/trial/state/v3/do
    destination=/var/lib/analog-canvas/native/state
    from=canvas-cn-trial; to=canvas-cn-native; port=8788
    ;;
  replica)
    source=/var/lib/analog-canvas/native/state
    destination=/var/lib/analog-canvas/trial/state/v3/do
    from=canvas-cn-native; to=canvas-cn-trial; port=8787
    ;;
  *) echo 'Usage: switch-private-runtime.sh native|replica' >&2; exit 2 ;;
esac
printf '%s\n' 'caf8ce67240e4349e50c839cd06b29b6eea6ff3867ade44ce1b287649f282242  /opt/analog-canvas/runtime/workerd-2026-09-11' | sha256sum --check --status
systemctl is-active --quiet "$from"
test -d "$source"
test ! -L "$source"
test ! -L "$destination"
site=/etc/nginx/sites-available/analog-canvas-trial
test "$(grep -c 'proxy_pass http://127.0.0.1:878[78];' "$site")" = 1
backup=$(mktemp -d /var/backups/analog-canvas/switch-XXXXXXXX)
cp "$site" "$backup/nginx.conf"
recover() {
  systemctl stop "$to" || return 1
  cp "$backup/nginx.conf" "$site" || return 1
  systemctl start "$from" || return 1
  systemctl enable "$from" || return 1
  systemctl disable "$to" || return 1
  nginx -t && systemctl reload nginx
}
cutover=false
completed=false
finish() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$completed" != true ]; then
    if [ "$cutover" = true ]; then
      echo "Cutover attempted: retain $to and its state; inspect/retry nginx reload. Do not reopen stale $from state." >&2
    else
      recover || { echo 'Pre-cutover recovery failed; inspect both services' >&2; exit 1; }
    fi
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
systemctl stop "$from" "$to"
tar -czf "$backup/state.tar.gz" -C "$source" .
if [ -e "$destination" ]; then mv "$destination" "$backup/previous-destination"; fi
cp -a "$source" "$destination"
systemctl start "$to"
ready=false
for attempt in $(seq 1 20); do
  if curl --fail --silent --max-time 3 "http://127.0.0.1:$port/api/auth/me" >/dev/null; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
sed "s|proxy_pass http://127.0.0.1:878[78];|proxy_pass http://127.0.0.1:$port;|" "$backup/nginx.conf" > "$site"
chmod 0644 "$site"
nginx -t
systemctl enable "$to"
systemctl disable "$from"
# Reload can expose new acknowledged writes even if its caller is interrupted.
# From this point, recovery must retain the destination as the authority.
cutover=true
systemctl reload nginx
completed=true
trap - EXIT HUP INT TERM
echo "Private entry now uses $to; previous state and entry: $backup"
