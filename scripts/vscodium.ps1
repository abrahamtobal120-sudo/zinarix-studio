# Ejecuta scripts/vscodium.sh con Git Bash (no con el bash de WSL).
param([string]$Action = 'build')
$ErrorActionPreference = 'Stop'
$candidates = @(
  (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe')
)
$git = Get-Command git.exe -ErrorAction SilentlyContinue
if ($git) {
  $dir = Split-Path $git.Source -Parent
  while ($dir) {
    $candidates += (Join-Path $dir 'bin\bash.exe')
    $dir = Split-Path $dir -Parent
  }
}
$bash = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (!$bash) { throw 'No se encontro Git Bash. Instala Git for Windows.' }
& $bash (Join-Path $PSScriptRoot 'vscodium.sh') $Action
exit $LASTEXITCODE
