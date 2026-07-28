# KeyShift

<p align="center">
  <strong>Typed in the wrong keyboard layout? KeyShift fixes it.</strong>
</p>

<p align="center">
  A lightweight cross-platform CLI that converts text typed with the wrong
  keyboard layout using one global shortcut.
</p>

<p align="center">
  Windows · TypeScript · Native C# · Global Hotkey
</p>

---

## Overview

KeyShift fixes text that was accidentally typed with the wrong keyboard
layout.

For example, you intended to type:

```text
سلام
```

but your keyboard layout was English, so you typed:

```text
sghl
```

Press the configured KeyShift shortcut and the text is converted automatically:

```text
سلام
```

On Windows, KeyShift reads the keyboard layouts installed in the operating
system. On macOS and Linux it currently provides the English (US) and Persian
ISIRI 9147 conversion pair.

---

## Features

- Global keyboard shortcut on Windows, macOS and X11 Linux
- Converts text between two configured keyboard layouts
- Automatic conversion-direction detection
- Uses installed keyboard layouts on Windows
- English (US) and Persian ISIRI 9147 on macOS and Linux
- English and Persian conversion
- Turkish, German, French, Arabic and other installed layouts on Windows
- Optional clipboard preservation
- Convert the complete focused text field
- Convert only selected text
- Configurable copy and paste delays
- Native Windows host and portable macOS/Linux host
- CLI-based configuration
- Lightweight installation
- A single background host process

---

## Platform support

KeyShift can be installed and run on:

```text
Windows 10
Windows 11
macOS
Linux
```

The Windows host supports every keyboard layout exposed by the Windows
keyboard APIs. The macOS/Linux host currently supports the `en-US` and
`fa-IR` pair.

Linux global input uses X11. It works in X11 sessions and with compatible
XWayland applications. Native Wayland compositors can restrict global hooks
and injected keystrokes, so a full Wayland session is not guaranteed.

KeyShift does not currently run on:

```text
Android
iOS
```

---

## Requirements

Before installing KeyShift, make sure the following software is available:

- Node.js 18 or newer
- npm

Platform requirements:

- Windows: .NET Framework 4.x runtime
- macOS: grant Accessibility permission to the terminal/Node process
- Linux X11: `xclip` or `xsel`
- Linux Wayland clipboard: `wl-clipboard`; global input still depends on
  X11/XWayland compatibility

The npm package includes the Windows executable and prebuilt macOS/Linux
global-input bindings. The .NET Framework compiler is required only when
building the Windows host from source.

---

## Installation

Install KeyShift globally:

```bash
npm install -g keyshift
```

On Ubuntu/Debian X11, install a clipboard helper:

```bash
sudo apt-get install xclip
```

On Wayland, install `wl-clipboard` as well. For macOS, allow the terminal or
Node.js under **System Settings > Privacy & Security > Accessibility** so
KeyShift can observe the shortcut and send copy/paste keystrokes.

Initialize the default configuration:

```bash
keyshift init
```

Start KeyShift:

```bash
keyshift start
```

Check its status:

```bash
keyshift status
```

Expected result:

```text
running
```

---

## Quick start

After installation:

```bash
keyshift init
keyshift layouts
keyshift start
```

Open Notepad or another editable application.

Type:

```text
sghl
```

Press:

```text
Ctrl + Alt + K
```

The result should be:

```text
سلام
```

The default shortcut is:

```text
Control+Alt+K
```

---

## Keyboard layouts

Display the layouts available to KeyShift:

```bash
keyshift layouts
```

Example output:

```text
Supported portable keyboard layouts:

en-US  English (US)
fa-IR  Persian (ISIRI 9147)
```

On Windows, `keyshift layouts` instead lists the layouts installed in the
current Windows session, for example:

```text
00000409     English (United States)
00000429     Persian [active]
0000041F     Turkish (Turkey)
```

Use these IDs when configuring `sourceLayout` and `targetLayout`. Portable
aliases include `en`, `us`, `00000409`, `fa`, `ir`, `persian`, `00000429`
and `00050429`.

Common Windows keyboard layout identifiers include:

| Layout                  |         ID |
| ----------------------- | ---------: |
| English — United States | `00000409` |
| Persian                 | `00000429` |
| Arabic                  | `00000401` |
| Turkish Q               | `0000041F` |
| German                  | `00000407` |
| French                  | `0000040C` |
| Russian                 | `00000419` |

Always prefer the values returned by:

```bash
keyshift layouts
```

The exact layout installed on a machine may differ from the common examples.

---

## Commands

## Author

**Mohadese Ghadimi**

- GitHub: [mohadesegh](https://github.com/mohadesegh)
- LinkedIn: [Mohadese Ghadimi](https://www.linkedin.com/in/mohadese-ghadimi/)

### Initialise configuration

```bash
keyshift init
```

Creates or resets the KeyShift configuration file.

Configuration path:

```text
%APPDATA%\keyshift\config.json
```

`keyshift init` only creates the configuration. It does not start or replace
the native host.

---

### Start KeyShift

```bash
keyshift start
```

Starts the native KeyShift host in the background.

Example output:

```text
KeyShift running. Shortcut: Control+Alt+K
Conversion: 00000409 <-> 00000429
Mode: auto
```

---

### Stop KeyShift

```bash
keyshift stop
```

Stops the native host and removes the saved process ID.

---

### Restart KeyShift

```bash
keyshift restart
```

Equivalent to:

```bash
keyshift stop
keyshift start
```

Restart KeyShift after changing configuration.

---

### Check status

```bash
keyshift status
```

Possible results:

```text
running
```

or:

```text
stopped
```

---

### List installed layouts

```bash
keyshift layouts
```

Displays installed Windows layouts on Windows, or the supported portable
layouts on macOS and Linux.

---

### Display logs

```bash
keyshift logs
```

The log file is stored under the platform application-data directory.

Run `keyshift init` to print the exact directory.

---

### Display configuration

```bash
keyshift config show
```

Example:

```json
{
	"shortcut": "Control+Alt+K",
	"layoutMode": "auto",
	"sourceLayout": "00000409",
	"targetLayout": "00000429",
	"directionDetection": "hybrid",
	"preserveClipboard": false,
	"copyDelayMs": 150,
	"pasteDelayMs": 120,
	"selectAllText": true
}
```

---

### Reset configuration

```bash
keyshift config reset
```

Restores the default configuration.

Restart KeyShift afterwards:

```bash
keyshift restart
```

---

### Update the native host

```bash
keyshift stop
keyshift update-host
keyshift start
```

Use this command after upgrading KeyShift or replacing the packaged Windows
host. On macOS and Linux the portable host is part of the installed package,
so no separate host copy is needed.

The host cannot be replaced while `keyshift-host.exe` is running because
Windows locks executable files that are currently in use.

---

## Configuration

KeyShift configuration is stored in `%APPDATA%\keyshift` on Windows,
`~/Library/Application Support/keyshift` on macOS, and
`${XDG_CONFIG_HOME:-~/.config}/keyshift` on Linux.

Default configuration:

```json
{
	"shortcut": "Control+Alt+K",
	"layoutMode": "auto",
	"sourceLayout": "00000409",
	"targetLayout": "00000429",
	"directionDetection": "hybrid",
	"preserveClipboard": false,
	"copyDelayMs": 150,
	"pasteDelayMs": 120,
	"selectAllText": true
}
```

Configuration values should normally be changed through the CLI instead of
editing the JSON file manually.

---

## Changing the shortcut

```bash
keyshift config set shortcut Control+Alt+K
```

Examples:

```bash
keyshift config set shortcut Control+Shift+K
keyshift config set shortcut Alt+F8
keyshift config set shortcut Control+Alt+Space
```

After changing the shortcut:

```bash
keyshift restart
```

Supported shortcut modifiers:

```text
Control
Ctrl
Alt
Shift
Win
Windows
```

Supported main keys:

```text
A-Z
Space
F1-F12
```

---

## Setting source and target layouts

First display installed layouts:

```bash
keyshift layouts
```

Then configure the desired pair.

English US to Persian:

```bash
keyshift config set sourceLayout 00000409
keyshift config set targetLayout 00000429
```

Restart KeyShift:

```bash
keyshift restart
```

---

## Layout modes

KeyShift supports two layout modes:

```text
auto
pair
```

### Auto mode

```bash
keyshift config set layoutMode auto
```

In auto mode, KeyShift detects the likely conversion direction using:

- Characters found in the copied text
- Script direction
- Characters supported by each layout
- The active Windows keyboard layout

This is the recommended mode for bidirectional conversion.

Example:

```text
English → Persian
Persian → English
```

---

### Pair mode

```bash
keyshift config set layoutMode pair
```

Pair mode always converts:

```text
sourceLayout → targetLayout
```

It does not reverse the configured direction automatically.

This is useful when conversion must always run in one direction.

---

## Direction detection

KeyShift supports three direction-detection methods:

```text
hybrid
content
active-layout
```

### Hybrid

```bash
keyshift config set directionDetection hybrid
```

Hybrid mode uses text content and the active Windows keyboard layout.

This is the recommended default.

---

### Content

```bash
keyshift config set directionDetection content
```

Uses the characters and scripts found in the copied text.

The active Windows layout is used less aggressively.

---

### Active layout

```bash
keyshift config set directionDetection active-layout
```

Uses the keyboard layout currently active in the focused Windows application.

---

## Convert all text or selected text

By default, KeyShift sends `Ctrl+A` before copying text.

That means all text in the focused editable control is converted.

```bash
keyshift config set selectAllText true
```

To convert only manually selected text:

```bash
keyshift config set selectAllText false
```

Restart after changing the setting:

```bash
keyshift restart
```

When `selectAllText` is false, select the text manually before pressing the
KeyShift shortcut.

---

## Clipboard preservation

By default, KeyShift does not restore the previous clipboard contents:

```bash
keyshift config set preserveClipboard false
```

To restore text that was already in the clipboard:

```bash
keyshift config set preserveClipboard true
```

Restart KeyShift:

```bash
keyshift restart
```

Clipboard preservation currently focuses on Unicode text. Rich clipboard
formats, copied files and application-specific clipboard data may not be
preserved.

---

## Copy and paste delays

Some applications require more time to respond to synthetic copy and paste
commands.

Change the copy delay:

```bash
keyshift config set copyDelayMs 250
```

Change the paste delay:

```bash
keyshift config set pasteDelayMs 200
```

Restart KeyShift:

```bash
keyshift restart
```

Recommended values:

```text
copyDelayMs: 100-300
pasteDelayMs: 100-300
```

If conversion works in Notepad but fails in a heavier application, increase
both values.

---

## How KeyShift works

When the shortcut is pressed, KeyShift performs these steps:

1. Waits for the physical shortcut keys to be released.
2. Focuses on the currently active application.
3. Optionally sends `Ctrl+A` (`Command+A` on macOS).
4. Sends the platform copy shortcut.
5. Reads the selected Unicode text from the platform clipboard.
6. Determines the source and target keyboard layouts.
7. Maps each character back to its physical virtual key.
8. Resolves the corresponding character in the target layout.
9. Writes the converted value to the clipboard.
10. Sends the platform paste shortcut.
11. Optionally restores the previous clipboard text.

The Windows native host uses APIs including:

```text
GetKeyboardLayout
GetKeyboardLayoutList
LoadKeyboardLayout
VkKeyScanEx
MapVirtualKeyEx
ToUnicodeEx
SendInput
SetWindowsHookEx
```

The macOS/Linux host uses `uiohook-napi` for the global shortcut and key
injection, plus `pbcopy`/`pbpaste`, `wl-clipboard`, `xclip`, or `xsel` for
clipboard access. The TypeScript CLI manages configuration, process lifecycle,
logs and host selection.

---

## Application data

KeyShift stores its runtime files in:

```text
Windows: %APPDATA%\keyshift
macOS:   ~/Library/Application Support/keyshift
Linux:   ${XDG_CONFIG_HOME:-~/.config}/keyshift
```

The directory contains:

```text
config.json
keyshift-host.exe
keyshift.log
keyshift.pid
```

`keyshift-host.exe` exists only on Windows. The portable host runs from the
installed npm package.

---

## Troubleshooting

### `EBUSY: resource busy or locked`

Example:

```text
EBUSY: resource busy or locked, copyfile ...
keyshift-host.exe
```

This means the native executable is currently running and Windows has locked
the file.

Stop it:

```bash
keyshift stop
```

If it is still running:

```powershell
taskkill /IM keyshift-host.exe /F
```

Then update the host:

```bash
keyshift update-host
keyshift start
```

---

### KeyShift is already running

Check its status:

```bash
keyshift status
```

Restart it:

```bash
keyshift restart
```

---

### Shortcut does not work

Check the log:

```bash
keyshift logs
```

Try a different shortcut:

```bash
keyshift config set shortcut Control+Shift+K
keyshift restart
```

Make sure another application is not using the same global shortcut.

---

### No text is converted

Make sure the focused application supports:

```text
Ctrl+A
Ctrl+C
Ctrl+V
```

Test with Windows Notepad first.

When converting selected text only:

```bash
keyshift config set selectAllText false
```

make sure text is selected before pressing the shortcut.

---

### Wrong conversion direction

Use hybrid mode:

```bash
keyshift config set layoutMode auto
keyshift config set directionDetection hybrid
keyshift restart
```

Check the configured layouts:

```bash
keyshift config show
```

Check installed layout IDs:

```bash
keyshift layouts
```

---

### Conversion is too slow

Reduce delays:

```bash
keyshift config set copyDelayMs 100
keyshift config set pasteDelayMs 100
keyshift restart
```

Do not reduce delays too aggressively because some applications may fail to
copy or paste in time.

---

### Conversion fails in a specific application

Increase delays:

```bash
keyshift config set copyDelayMs 300
keyshift config set pasteDelayMs 300
keyshift restart
```

Some applications, terminals, browser pages, elevated windows and protected
input controls may block synthetic keyboard input or clipboard operations.

---

### KeyShift cannot interact with an Administrator application

A non-elevated process may not be able to send input to an application running
as Administrator.

Run KeyShift and the target application at the same privilege level.

Avoid running KeyShift as Administrator unless it is necessary.

---

### View the raw log file

PowerShell:

```powershell
Get-Content "$env:APPDATA\keyshift\keyshift.log"
```

Follow new log entries:

```powershell
Get-Content "$env:APPDATA\keyshift\keyshift.log" -Wait
```

---

### Completely reset KeyShift

Stop KeyShift:

```bash
keyshift stop
```

Remove application data:

```powershell
Remove-Item "$env:APPDATA\keyshift" -Recurse -Force
```

Reinitialise:

```bash
keyshift init
keyshift start
```

---

## Limitations

KeyShift is designed for standard Windows keyboard layouts that map physical
keys to Unicode characters.

The following cases may not convert completely:

- Chinese IMEs
- Japanese IMEs
- Korean IMEs
- Multi-stage composition systems
- Complex dead-key sequences
- Application-specific input editors
- Password fields
- Protected browser inputs
- Elevated applications when KeyShift is not elevated
- Applications that do not support standard copy and paste shortcuts

Some keyboard layouts may map one physical key to multiple Unicode characters.
Those mappings depend on Windows and the installed keyboard layout.

---

## Security and privacy

KeyShift does not send copied text to a server.

Text conversion happens locally on the Windows machine.

KeyShift temporarily uses the Windows clipboard to copy, convert and paste
text.

Sensitive text should not be converted in password fields or protected input
controls.

---

## Building from source

Clone the repository:

```bash
git clone <repository-url>
cd keyshift
```

Install dependencies:

```bash
npm install
```

Build TypeScript and prepare the native host:

```bash
npm run build
```

On macOS and Linux, this builds the CLI and packages the checked-in prebuilt
Windows host without invoking PowerShell. This makes `npm pack` work on all
three desktop platforms.

On Windows, the native host is compiled using the .NET Framework C# compiler:

```text
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
```

or:

```text
C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe
```

If the compiler is unavailable, enable `.NET Framework 4.x` in Windows
Features or install the `.NET Framework 4.8 Developer Pack`.

---

## Local development

Build the project:

```bash
npm run build
```

Link the package globally:

```bash
npm link
```

Initialise:

```bash
keyshift init
```

List layouts:

```bash
keyshift layouts
```

Start:

```bash
keyshift start
```

Check status:

```bash
keyshift status
```

After changing the native C# host:

```bash
npm run build
keyshift stop
keyshift update-host
keyshift start
```

---

## Testing the npm package

Inspect the files that will be published:

```bash
npm pack --dry-run
```

Create the package archive:

```bash
npm pack
```

Install the generated archive globally:

```bash
npm uninstall -g keyshift
npm install -g ./keyshift-1.1.0.tgz
```

Test:

```bash
keyshift init
keyshift layouts
keyshift start
keyshift status
```

---

## Publishing

Log in to npm:

```bash
npm login
```

Verify the current user:

```bash
npm whoami
```

Inspect package contents:

```bash
npm pack --dry-run
```

Publish:

```bash
npm publish
```

When npm requires two-factor authentication:

```bash
npm publish --otp=123456
```

---

## Updating the version

Patch release:

```bash
npm version patch
```

Example:

```text
1.1.0 → 1.1.1
```

Minor release:

```bash
npm version minor
```

Example:

```text
1.1.0 → 1.2.0
```

Major release:

```bash
npm version major
```

Example:

```text
1.1.0 → 2.0.0
```

Do not manually run `npm version minor` if `package.json` already contains the
intended version.

---

## Architecture

```text
┌───────────────────────────────────────┐
│              KeyShift CLI             │
│                                       │
│  init · start · stop · status · logs  │
│  layouts · config · update-host       │
└───────────────────┬───────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│          Native Windows Host          │
│                                       │
│  Global keyboard hook                 │
│  Shortcut detection                   │
│  Clipboard operations                 │
│  Windows keyboard-layout APIs         │
│  Character conversion                 │
└───────────────────┬───────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│       Focused Windows application     │
└───────────────────────────────────────┘
```

---

## Project structure

```text
keyshift/
├── native/
│   ├── KeyShiftHost.cs
│   └── keyshift-host.exe
├── scripts/
│   ├── build-host.js
│   └── build-host.ps1
├── src/
│   ├── cli.ts
│   ├── config.ts
│   └── types.ts
├── .gitignore
├── LICENSE
├── README.md
├── package.json
└── tsconfig.json
```

---

## Roadmap

Planned improvements include:

- Start automatically with Windows
- System tray icon
- Native notifications
- Application-specific rules
- Multiple layout pairs
- Configurable conversion profiles
- Better dead-key handling
- Signed Windows executable
- Automated release workflow
- macOS support
- Linux support
- Optional graphical configuration interface

---

## Contributing

Contributions are welcome.

Before submitting a pull request:

1. Create a feature branch.
2. Keep changes focused.
3. Build the TypeScript CLI.
4. Build the native Windows host.
5. Test installation through `npm pack`.
6. Test conversion in Windows Notepad.
7. Include a clear explanation of the change.

Suggested workflow:

```bash
git checkout -b feature/my-change
npm install
npm run build
npm pack --dry-run
```

---

## Reporting issues

When reporting an issue, include:

- Windows version
- Node.js version
- KeyShift version
- Source layout ID
- Target layout ID
- KeyShift configuration
- Application where the issue occurred
- Relevant log output

Commands:

```bash
node --version
keyshift config show
keyshift layouts
keyshift logs
```

Do not include sensitive clipboard contents in public issue reports.

---

## Licence

KeyShift is released under the MIT Licence.

See the `LICENSE` file for details.

---

<p align="center">
  Made with ❤️ for anyone who has typed an entire sentence using the wrong keyboard layout.
</p>
