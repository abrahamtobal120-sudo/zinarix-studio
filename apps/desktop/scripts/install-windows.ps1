# Installs a "Zinarix Studio" launcher for the current user (no admin needed), the Windows
# counterpart of install-linux.sh:
#   %LOCALAPPDATA%\zinarix-studio-dev\bin\zinarix-studio.cmd  -> `zinarix-studio [carpeta]` from any terminal
#   Start menu and desktop shortcuts "Zinarix Studio (dev)" (the release installer owns "Zinarix Studio")
# Run with -Uninstall to remove them.
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'

$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Electron = Join-Path $AppDir 'node_modules\electron\dist\electron.exe'
$DataDir = Join-Path $env:LOCALAPPDATA 'zinarix-studio-dev'
$Bin = Join-Path $DataDir 'bin'
$Icon = Join-Path $DataDir 'zinarix-studio.ico'
$Launcher = Join-Path $Bin 'start-local.ps1'
$Shortcuts = @(
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Zinarix Studio (dev).lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Zinarix Studio (dev).lnk')
)

function Get-UserPath { [Environment]::GetEnvironmentVariable('Path', 'User') }
function Set-UserPath($value) { [Environment]::SetEnvironmentVariable('Path', $value, 'User') }
function Remove-FromPath($entries) {
  ($entries -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $Bin) }) -join ';'
}

if ($Uninstall) {
  $Shortcuts | Where-Object { Test-Path $_ } | Remove-Item -Force
  if (Test-Path $DataDir) { Remove-Item $DataDir -Recurse -Force }
  Set-UserPath (Remove-FromPath (Get-UserPath))
  Write-Host 'Zinarix Studio (lanzador local) desinstalado.'
  exit 0
}

if (-not (Test-Path $Electron)) { throw "Falta Electron: ejecuta 'pnpm install' en la raiz del repo." }
$NodeExe = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $AppDir 'dist\main\main.js'))) {
  throw "Falta compilar: ejecuta 'pnpm --filter @omni/desktop build'."
}

New-Item -ItemType Directory -Force -Path $Bin | Out-Null
Copy-Item (Join-Path $AppDir 'build\icon.ico') $Icon -Force

# Hidden launcher: rebuild before opening, preserving diagnostics if compilation fails.
$NodeLiteral = $NodeExe.Replace("'", "''")
$ScriptLiteral = (Join-Path $AppDir 'scripts\start-local.mjs').Replace("'", "''")
@"
`$ErrorActionPreference = 'Continue'
`$log = Join-Path `$env:LOCALAPPDATA 'zinarix-studio-dev\build.log'
try {
  & '$NodeLiteral' '$ScriptLiteral' @args *> `$log
  if (`$LASTEXITCODE -ne 0) { throw "Error al compilar (codigo `$LASTEXITCODE)." }
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("No se pudieron aplicar los cambios. Revisa: `$log`n`$(`$_.Exception.Message)", 'Zinarix Studio') | Out-Null
  exit 1
}
"@ | Set-Content -Encoding UTF8 $Launcher

# Terminal launcher uses the same automatic build as the shortcuts.
@"
@echo off
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$Launcher" %*
"@ | Set-Content -Encoding ASCII (Join-Path $Bin 'zinarix-studio.cmd')

# Put the launcher on the user's PATH (new terminals pick it up).
$path = Get-UserPath
if (-not (($path -split ';') | Where-Object { $_.TrimEnd('\') -eq $Bin })) {
  Set-UserPath ((@((Remove-FromPath $path), $Bin) | Where-Object { $_ }) -join ';')
}

$shell = New-Object -ComObject WScript.Shell
foreach ($lnk in $Shortcuts) {
  New-Item -ItemType Directory -Force -Path (Split-Path $lnk) | Out-Null
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = Join-Path $PSHOME 'powershell.exe'
  $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Launcher`""
  $s.WorkingDirectory = $AppDir
  $s.IconLocation = "$Icon,0"
  $s.Description = 'Compila los cambios locales y abre Zinarix Studio'
  $s.Save()
}

Write-Host "Listo. Abre 'Zinarix Studio' desde el menu Inicio o el escritorio, o ejecuta en una terminal nueva: zinarix-studio [carpeta]"
