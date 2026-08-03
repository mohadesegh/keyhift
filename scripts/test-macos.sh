#!/usr/bin/env bash
set -euo pipefail

keyshift_command="${1:?KeyShift command path is required}"

cleanup() {
  "$keyshift_command" stop >/dev/null 2>&1 || true
  osascript -e 'tell application "TextEdit" to quit saving no' >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$keyshift_command" init

if [[ "${KEYSHIFT_TEST_GLOBAL_INPUT:-0}" != "1" ]]; then
  "$keyshift_command" config set switchInputLanguage false
  printf 'sghl' | pbcopy
  "$keyshift_command" convert-clipboard
  actual="$(pbpaste)"
  [[ "$actual" == "سلام" ]] || {
    printf 'Expected: سلام\nActual: %s\n' "$actual" >&2
    exit 1
  }

  echo "macOS installed-package clipboard conversion passed."
  echo "Global shortcut and input-source switching require Accessibility and an installed Persian source, so they are skipped on hosted runners."
  exit 0
fi

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
