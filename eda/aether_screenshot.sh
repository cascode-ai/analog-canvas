#!/usr/bin/env bash
set -euo pipefail

# Run on the Linux host while the licensed Aether desktop is active.
# Cellviews are opened and fitted through PyAether's embedded Python Console;
# ImageMagick captures the resulting real editor window.

export DISPLAY="${DISPLAY:?Set the existing Aether X11 DISPLAY}"

library="${AETHER_LIBRARY:?Set the target library}"
output_dir="${AETHER_CAPTURE_DIR:?Set the capture directory}"
console_x="${AETHER_CONSOLE_X:?Set the Python console X coordinate}"
console_y="${AETHER_CONSOLE_Y:?Set the Python console Y coordinate}"
capture_width=1920
capture_height=1080
fit_margin="${AETHER_FIT_MARGIN:-0.95}"
if [[ ! "$fit_margin" =~ ^0\.[0-9]+$ || "$fit_margin" =~ ^0\.0+$ ]]; then
  echo "AETHER_FIT_MARGIN must be between 0 and 1" >&2
  exit 1
fi

if (( $# == 0 )); then
  echo "Pass explicit cell names" >&2
  exit 1
fi
cells=("$@")
for name in "$library" "${cells[@]}"; do
  if [[ ! "$name" =~ ^[A-Za-z][A-Za-z0-9_]*$ ]]; then
    echo "Invalid library or cell identifier" >&2
    exit 1
  fi
done
if [[ ! "$console_x" =~ ^[0-9]+$ || ! "$console_y" =~ ^[0-9]+$ ]]; then
  echo "Console coordinates must be nonnegative integers" >&2
  exit 1
fi
exec 9>"${XDG_RUNTIME_DIR:-/tmp}/canvas-aether-${UID}-${DISPLAY//[^a-zA-Z0-9]/_}.lock"
flock -n 9 || { echo "Another capture owns this display" >&2; exit 1; }

mkdir -p "$output_dir"
dm_window="$(xdotool search --onlyvisible --name 'Design Manager - Aether' || true)"
if [[ ! "$dm_window" =~ ^[0-9]+$ ]]; then
  echo "Require exactly one visible Design Manager - Aether on $DISPLAY" >&2
  exit 1
fi

python_console() {
  local command=$1
  xdotool windowactivate --sync "$dm_window"
  xdotool mousemove --window "$dm_window" "$console_x" "$console_y" click 1
  xdotool key --clearmodifiers ctrl+a
  xdotool type --clearmodifiers --delay 1 "$command"
  xdotool key --clearmodifiers Return
}

for cell in "${cells[@]}"; do
  if [[ -e "$output_dir/${cell}.png" ]]; then
    echo "Capture already exists for $cell; use a new capture directory" >&2
    exit 1
  fi
  if xdotool search --onlyvisible --name "$library/$cell/schematic" >/dev/null; then
    echo "Close the existing editor for $cell before capturing" >&2
    exit 1
  fi
  python_console \
    "ae.aeOpenDesign(\"$library\",\"$cell\",\"schematic\");ae.aeZoomFit(1, $fit_margin)"
  sleep 3

  window="$(xdotool search --onlyvisible --name "$library/$cell/schematic" || true)"
  if [[ ! "$window" =~ ^[0-9]+$ ]]; then
    echo "Require exactly one editor window for $cell" >&2
    exit 1
  fi

  # Include the WM title bar and borders inside the requested full-image size.
  frame_extents="$(xprop -id "$window" _NET_FRAME_EXTENTS)"
  if [[ ! "$frame_extents" =~ =[[:space:]]+([0-9]+),[[:space:]]+([0-9]+),[[:space:]]+([0-9]+),[[:space:]]+([0-9]+) ]]; then
    echo "Cannot determine full window frame for $cell" >&2
    exit 1
  fi
  left=${BASH_REMATCH[1]}
  right=${BASH_REMATCH[2]}
  top=${BASH_REMATCH[3]}
  bottom=${BASH_REMATCH[4]}
  xdotool windowsize "$window" "$((capture_width - left - right))" "$((capture_height - top - bottom))"
  xdotool windowmove "$window" "$left" "$top"
  sleep 1

  # Keep the user's docks. Their close buttons move with desktop geometry.
  python_console "ae.aeZoomFit(1, $fit_margin)"
  sleep 2

  xdotool windowactivate --sync "$window"
  sleep 1
  import -frame -window "$window" "$output_dir/${cell}.png"
  if [[ "$(identify -format '%wx%h' "$output_dir/${cell}.png")" != "${capture_width}x${capture_height}" ]]; then
    echo "Full window does not fit the desktop for $cell" >&2
    exit 1
  fi
  identify -format "$cell %wx%h %b\n" "$output_dir/${cell}.png"

  xdotool windowactivate --sync "$window"
  xdotool key --clearmodifiers alt+F4
  sleep 1
done
