#!/usr/bin/env bash
set -euo pipefail

keyshift_command="${1:?KeyShift command path is required}"

cleanup() {
  "$keyshift_command" stop >/dev/null 2>&1 || true
  [[ -n "${terminal_pid:-}" ]] && kill "$terminal_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$keyshift_command" init
"$keyshift_command" start

xterm -title "KeyShift integration target" &
terminal_pid=$!

for _ in {1..50}; do
  window_id="$(xdotool search --name "KeyShift integration target" 2>/dev/null | head -n 1 || true)"
  [[ -n "$window_id" ]] && break
  sleep 0.1
done

[[ -n "${window_id:-}" ]] || { echo "X11 test window was not found." >&2; exit 1; }

xdotool windowactivate --sync "$window_id"
xdotool type --delay 80 sghl
xdotool key ctrl+shift+k
sleep 4
xdotool key ctrl+a ctrl+c
sleep 1

actual="$(xclip -selection clipboard -out)"
[[ "$actual" == "سلام" ]] || {
  printf 'Expected: سلام\nActual: %s\n' "$actual" >&2
  exit 1
}

echo "Linux X11 integration test passed."
