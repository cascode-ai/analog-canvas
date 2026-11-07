#!/bin/sh
set -eu

# Reserve half of the 128-task run limit for starting the profile and running
# its simulators. Count the real UID across the host, including other containers.
threads="$(ps -eLo ruid=)"
used="$(printf '%s\n' "$threads" | awk '$1 == 10002 { used++ } END { print used + 0 }')"
if [ "$used" -gt 64 ]; then
  printf 'regional simulator UID 10002 has %s threads; at most 64 may be in use before starting services\n' "$used" >&2
  exit 1
fi
