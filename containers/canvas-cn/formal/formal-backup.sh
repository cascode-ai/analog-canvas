#!/usr/bin/env bash
# The caller holds the release lock; daily and release snapshots cannot race.
set -euo pipefail
test "$(id -u)" = 0
exec 9>/run/lock/canvas-cn-formal-backup.lock
flock -n 9
exec python3 "$(dirname "$0")/daily-backup.py"
