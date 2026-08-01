#!/usr/bin/env bash
set -euo pipefail

keyshift_command="${1:?KeyShift command path is required}"

cleanup() {
  "$keyshift_command" stop >/dev/null 2>&1 || true
  osascript -e 'tell application "TextEdit" to quit saving no' >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$keyshift_command" init
"$keyshift_command" start

osascript <<'APPLESCRIPT'
tell application "TextEdit"
  activate
  make new document
end tell
delay 1
tell application "System Events"
  keystroke "sghl"
  key code 40 using {command down, shift down}
end tell
APPLESCRIPT

sleep 4

osascript <<'APPLESCRIPT'
tell application "System Events"
  keystroke "a" using command down
  keystroke "c" using command down
end tell
APPLESCRIPT

sleep 1
actual="$(pbpaste)"
[[ "$actual" == "سلام" ]] || {
  printf 'Expected: سلام\nActual: %s\n' "$actual" >&2
  exit 1
}

echo "macOS integration test passed."
