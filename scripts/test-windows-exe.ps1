param([string]$Exe = (Join-Path $PSScriptRoot '../src-tauri/target/release/pixel-rig-studio.exe'))

$ErrorActionPreference = 'Stop'
$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Exe).Path)
if ($bytes.Length -lt 64 -or [BitConverter]::ToUInt16($bytes, 0) -ne 0x5a4d) {
  throw 'Expected a Windows executable.'
}
$header = [BitConverter]::ToInt32($bytes, 0x3c)
if ($header -lt 0 -or $header -gt ($bytes.Length - 94) -or [BitConverter]::ToUInt32($bytes, $header) -ne 0x4550) {
  throw 'Invalid PE header.'
}
$subsystem = [BitConverter]::ToUInt16($bytes, $header + 24 + 68)
if ($subsystem -ne 2) {
  throw "Expected the Windows GUI subsystem (2), found $subsystem. A release build must not start a console."
}
Write-Output 'Windows release EXE uses the GUI subsystem.'
