#!/usr/bin/env bash
set -euo pipefail

keyshift_command="${1:?KeyShift command path is required}"

cleanup() {
  "$keyshift_command" stop >/dev/null 2>&1 || true
  [[ -n "${editor_pid:-}" ]] && kill "$editor_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$keyshift_command" init
setxkbmap -layout us
"$keyshift_command" start

python3 scripts/linux-x11-target.py &
editor_pid=$!

for _ in {1..50}; do
  window_id="$(xdotool search --name "KeyShift integration target" 2>/dev/null | head -n 1 || true)"
  [[ -n "$window_id" ]] && break
  sleep 0.1
done

[[ -n "${window_id:-}" ]] || { echo "X11 test window was not found." >&2; exit 1; }

# Direct X11 focus works under Xvfb even when no EWMH-compatible window
# manager is running. `windowactivate` depends on _NET_ACTIVE_WINDOW and
# therefore fails on GitHub's bare Xvfb display.
xdotool windowfocus --sync "$window_id"
focused_window_id="$(xdotool getwindowfocus)"
[[ "$focused_window_id" == "$window_id" ]] || {
  printf 'Unable to focus X11 test window. Expected: %s, Actual: %s\n' \
    "$window_id" "$focused_window_id" >&2
  exit 1
}
xdotool type --delay 80 sghl
sleep 0.2

shortcut_detected="false"
for _ in {1..5}; do
  xdotool keydown ctrl
  sleep 0.1
  xdotool keydown shift
  sleep 0.1
  xdotool keydown k
  sleep 0.1
  xdotool keyup k
  sleep 0.1
  xdotool keyup shift
  sleep 0.1
  xdotool keyup ctrl

  for _ in {1..20}; do
    if "$keyshift_command" logs 2>/dev/null | grep -q 'Shortcut detected.'; then
      shortcut_detected="true"
      break 2
    fi
    sleep 0.1
  done
done

[[ "$shortcut_detected" == "true" ]] || {
  echo "The global shortcut was not detected after 5 attempts." >&2
  "$keyshift_command" logs >&2 || true
  exit 1
}

"$keyshift_command" stop
sleep 0.5
setxkbmap -layout us
printf 'sghl' | xclip -selection clipboard -in >/dev/null 2>&1
"$keyshift_command" convert-clipboard

active_layout=""
for _ in {1..150}; do
  active_layout="$(setxkbmap -query | awk '/^layout:/ { print $2 }')"
  [[ "$active_layout" == "ir" ]] && break
  sleep 0.1
done

[[ "$active_layout" == "ir" ]] || {
  printf 'Expected active layout: ir\nActual active layout: %s\n' "$active_layout" >&2
  printf 'Desktop session: XDG_CURRENT_DESKTOP=%s DESKTOP_SESSION=%s GDMSESSION=%s\n' \
    "${XDG_CURRENT_DESKTOP:-}" "${DESKTOP_SESSION:-}" "${GDMSESSION:-}" >&2
  "$keyshift_command" logs >&2 || true
  exit 1
}

actual="$(xclip -selection clipboard -out)"
[[ "$actual" == "سلام" ]] || {
  printf 'Expected: سلام\nActual: %s\n' "$actual" >&2
  exit 1
}

echo "Linux X11 global-shortcut detection, clipboard conversion and input-source integration test passed."
