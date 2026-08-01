param(
    [Parameter(Mandatory = $true)]
    [string]$KeyShiftCommand
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class KeyShiftWindowsInput
{
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr handle);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern void SwitchToThisWindow(IntPtr handle, bool altTab);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr handle, out Rect rectangle);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
"@

$compilerCandidates = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw "The .NET Framework C# compiler was not found." }

$targetExe = Join-Path $env:TEMP "keyshift-integration-target.exe"
$targetSource = Join-Path $PSScriptRoot "WindowsShortcutTarget.cs"
& $compiler /nologo /target:winexe "/out:$targetExe" /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll $targetSource
if ($LASTEXITCODE -ne 0) { throw "Unable to compile the Windows test target." }

& $KeyShiftCommand init
& $KeyShiftCommand start
$targetProcess = Start-Process -FilePath $targetExe -PassThru

try {
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 100
        $targetProcess.Refresh()
        $windowHandle = $targetProcess.MainWindowHandle
    } while ([Int64]$windowHandle -eq 0 -and [DateTime]::UtcNow -lt $deadline)

    if ([Int64]$windowHandle -eq 0) { throw "The Windows test target did not open." }

    [KeyShiftWindowsInput]::SwitchToThisWindow($windowHandle, $true)
    [KeyShiftWindowsInput]::SetForegroundWindow($windowHandle) | Out-Null
    $rectangle = New-Object KeyShiftWindowsInput+Rect
    [KeyShiftWindowsInput]::GetWindowRect($windowHandle, [ref]$rectangle) | Out-Null
    [KeyShiftWindowsInput]::SetCursorPos($rectangle.Left + 100, $rectangle.Top + 100) | Out-Null
    [KeyShiftWindowsInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [KeyShiftWindowsInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 500

    if ([KeyShiftWindowsInput]::GetForegroundWindow() -ne $windowHandle) {
        throw "The Windows test target could not receive foreground focus."
    }

    [System.Windows.Forms.Clipboard]::Clear()
    [System.Windows.Forms.SendKeys]::SendWait("sghl")

    [KeyShiftWindowsInput]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
    [KeyShiftWindowsInput]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [KeyShiftWindowsInput]::keybd_event(0x4B, 0, 0, [UIntPtr]::Zero)
    [KeyShiftWindowsInput]::keybd_event(0x4B, 0, 2, [UIntPtr]::Zero)
    [KeyShiftWindowsInput]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [KeyShiftWindowsInput]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)

    Start-Sleep -Seconds 5
    [KeyShiftWindowsInput]::SwitchToThisWindow($windowHandle, $true)
    [KeyShiftWindowsInput]::SetForegroundWindow($windowHandle) | Out-Null
    [System.Windows.Forms.SendKeys]::SendWait("^a")
    [System.Windows.Forms.SendKeys]::SendWait("^c")
    Start-Sleep -Milliseconds 500

    $actual = [System.Windows.Forms.Clipboard]::GetText()
    $expected = -join @(
        [char]0x0633,
        [char]0x0644,
        [char]0x0627,
        [char]0x0645
    )
    if ($actual -ne $expected) { throw "Converted text did not match the expected Persian text. Actual: '$actual'." }
    Write-Host "Windows integration test passed."
} finally {
    & $KeyShiftCommand stop
    if (-not $targetProcess.HasExited) { Stop-Process -Id $targetProcess.Id -Force }
}
