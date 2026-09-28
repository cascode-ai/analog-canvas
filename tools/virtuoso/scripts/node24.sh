#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${VC_NODE_PATH:-}" ]]; then
  exec "$VC_NODE_PATH" "$@"
fi
if command -v node >/dev/null 2>&1 && [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]]; then
  exec node "$@"
fi
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
  nvm use 24 >/dev/null
  exec node "$@"
fi
printf '%s\n' 'Node.js 24 or newer is required. Set VC_NODE_PATH to its node executable.' >&2
exit 1
