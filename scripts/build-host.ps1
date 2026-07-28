$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$nativeDirectory = Join-Path $projectRoot "native"

$sourcePath = Join-Path `
  $nativeDirectory `
  "KeyShiftHost.cs"

$outputPath = Join-Path `
  $nativeDirectory `
  "keyshift-host.exe"

if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "Native host source was not found: $sourcePath"
}

$cscCandidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)

$csc = $cscCandidates |
  Where-Object {
    Test-Path -LiteralPath $_
  } |
  Select-Object -First 1

if (-not $csc) {
  throw @"
C# compiler was not found.

Enable .NET Framework 4.x in Windows Features
or install .NET Framework 4.8 Developer Pack.

Then run:

npm run build
"@
}

Write-Host "Building KeyShift native host..."
Write-Host "Compiler: $csc"
Write-Host "Source:   $sourcePath"
Write-Host "Output:   $outputPath"

& $csc `
  /nologo `
  /target:winexe `
  /optimize+ `
  /platform:anycpu `
  /out:"$outputPath" `
  /reference:System.dll `
  /reference:System.Core.dll `
  /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll `
  /reference:System.Web.Extensions.dll `
  "$sourcePath"

if ($LASTEXITCODE -ne 0) {
  throw "Native host compilation failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $outputPath)) {
  throw "Compilation completed, but the executable was not created."
}

$file = Get-Item -LiteralPath $outputPath

Write-Host ""
Write-Host "Native host created successfully."
Write-Host "File: $($file.FullName)"
Write-Host "Size: $($file.Length) bytes"