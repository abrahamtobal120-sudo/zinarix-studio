# Installs an already-built edition (release\win-unpacked) over the current install in
# %LOCALAPPDATA%\Programs\<slug>, without running an installer .exe. Needed on PCs with
# Windows Smart App Control on: it blocks the unsigned NSIS setup, but lets the untouched
# Electron exe run (build with ZINARIX_KEEP_ELECTRON_EXE=1, see build-editions.mjs).
#
#   ZINARIX_KEEP_ELECTRON_EXE=1 node scripts/build-editions.mjs ai -- --win dir --publish never
#   powershell -ExecutionPolicy Bypass -File scripts\install-built-windows.ps1 -Slug zinarix-studio-ai -Name 'Zinarix Studio AI'
#
# Waits until the running app is closed, copies the new files, points the shortcuts at the
# app icon (the untouched exe carries Electron's) and opens the app again.
param(
  [string]$Slug = 'zinarix-studio-ai',
  [string]$Name = 'Zinarix Studio AI',
  [string]$Source = (Join-Path $PSScriptRoot '..\release\win-unpacked')
)
$ErrorActionPreference = 'Stop'
$Source = (Resolve-Path $Source).Path
$Target = Join-Path $env:LOCALAPPDATA "Programs\$Slug"
$Exe = Join-Path $Target "$Slug.exe"
if (-not (Test-Path (Join-Path $Source "$Slug.exe"))) { throw "No hay $Slug.exe en $Source; compila esa edición primero." }

# Wait (up to 1 hour) for every window of the installed app to close.
$deadline = (Get-Date).AddHours(1)
while (Get-Process -Name $Slug -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe }) {
  if ((Get-Date) -gt $deadline) { throw 'La app sigue abierta; ciérrala y vuelve a correr el script.' }
  Start-Sleep -Seconds 2
}

New-Item -ItemType Directory -Force $Target | Out-Null
# /E copies everything and keeps files only the old install has (its uninstaller).
robocopy $Source $Target /E /R:3 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "No se pudieron copiar los archivos (robocopy $LASTEXITCODE)." }

$Icon = Join-Path $Target 'app.ico'
Copy-Item (Join-Path $PSScriptRoot '..\build\icon.ico') $Icon -Force
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
foreach ($dir in @($desktop, $menu)) {
  $lnk = $shell.CreateShortcut((Join-Path $dir "$Name.lnk"))
  $lnk.TargetPath = $Exe
  $lnk.WorkingDirectory = $Target
  $lnk.IconLocation = "$Icon,0"
  $lnk.Save()
}

Start-Process $Exe
