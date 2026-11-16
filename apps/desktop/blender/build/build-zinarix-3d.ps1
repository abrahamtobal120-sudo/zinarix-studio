<#
.SYNOPSIS
  Compiles Zinarix Studio 3D: the Blender source in <repo>\blender with the Zinarix changes.

.DESCRIPTION
  1. Checks the tools: Visual Studio 2022 (or its Build Tools) with C++, CMake, Git, Git LFS, Python.
  2. Applies zinarix-3d.patch to the Blender source unless it is already applied. The patch sets
     the name in the window title, the About box and the .exe details, and takes the version
     number off the splash screen and the title.
  3. Copies the Zinarix splash image and icon (they are kept in the app template, not in the patch).
  4. Downloads the Blender libraries for Windows (about 7 GB) the first time.
  5. Compiles with make.bat (30 to 60 minutes the first time, much less after that).
  6. Copies the result to %LOCALAPPDATA%\Programs\Zinarix Studio 3D. The app looks there first.

  The .exe is not signed. If Windows Smart App Control is on, Windows will not let it run.
  Blender is GPL: if you share the build with other people, publish this source too.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File apps\desktop\blender\build\build-zinarix-3d.ps1 -CheckOnly
  powershell -ExecutionPolicy Bypass -File apps\desktop\blender\build\build-zinarix-3d.ps1
#>
[CmdletBinding()]
param(
  # Default: <repo>\blender (worked out below; Windows PowerShell 5.1 has no $PSScriptRoot here).
  [string]$BlenderDir = '',
  [string]$BuildDir = (Join-Path $env:LOCALAPPDATA 'ZinarixBuild\blender'),
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\Zinarix Studio 3D'),
  # Only check the tools and the patch, do not download or compile.
  [switch]$CheckOnly,
  # Do not download or update the Blender libraries (use the ones already there).
  [switch]$SkipLibs
)

$ErrorActionPreference = 'Stop'
if (-not $BlenderDir) { $BlenderDir = Join-Path $PSScriptRoot '..\..\..\..\blender' }
$BlenderDir = (Resolve-Path $BlenderDir).Path
$Template = Join-Path $PSScriptRoot '..\scripts\startup\bl_app_templates_system\Zinarix'
$Patch = Join-Path $PSScriptRoot 'zinarix-3d.patch'
$problems = @()

function Step($text) { Write-Host "`n== $text" -ForegroundColor Magenta }
function Ok($text) { Write-Host "   OK  $text" -ForegroundColor Green }
function Bad($text, $fix) {
  Write-Host "   FALTA  $text" -ForegroundColor Red
  if ($fix) { Write-Host "          $fix" -ForegroundColor Yellow }
  $script:problems += $text
}

Step 'Herramientas'

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs = $null
if (Test-Path $vswhere) {
  $vs = & $vswhere -latest -products * -version '[17.0,18.0)' `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json | ConvertFrom-Json |
    Select-Object -First 1
}
if ($vs) {
  Ok "Visual Studio 2022 con C++: $($vs.installationPath)"
} else {
  Bad 'Visual Studio 2022 con C++ (o sus Build Tools)' `
    'winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"'
}

$cmake = (Get-Command cmake.exe -ErrorAction SilentlyContinue).Source
if (-not $cmake -and $vs) {
  $vsCmake = Join-Path $vs.installationPath 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin'
  if (Test-Path (Join-Path $vsCmake 'cmake.exe')) {
    $env:PATH = "$vsCmake;$env:PATH"
    $cmake = Join-Path $vsCmake 'cmake.exe'
  }
}
if ($cmake) { Ok "CMake: $cmake" } else { Bad 'CMake' 'winget install Kitware.CMake' }

if (Get-Command git.exe -ErrorAction SilentlyContinue) { Ok 'Git' } else { Bad 'Git' 'winget install Git.Git' }
git lfs version *> $null
if ($LASTEXITCODE -eq 0) { Ok 'Git LFS' } else { Bad 'Git LFS' 'winget install GitHub.GitLFS' }

$python = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
if ($python) { Ok "Python: $python" } else { Bad 'Python 3 (solo para descargar las librerías)' 'winget install Python.Python.3.13' }

$disk = (Get-PSDrive -Name ($BuildDir.Substring(0, 1))).Free / 1GB
if ($disk -ge 40) { Ok ("Espacio libre: {0:N0} GB" -f $disk) } else { Bad ("Espacio libre: {0:N0} GB (hacen falta unos 40 GB)" -f $disk) }

# Smart App Control: 1 = on, 2 = evaluation, 0 = off. It does not stop the build, only running it.
$sac = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState
if ($sac -eq 1) {
  Write-Host '   AVISO  El Control inteligente de aplicaciones está activado: Windows no dejará abrir el .exe sin firmar.' -ForegroundColor Yellow
}

Step 'Código de Blender'
Push-Location $BlenderDir
try {
  git apply --reverse --check $Patch 2>$null
  if ($LASTEXITCODE -eq 0) {
    Ok 'Los cambios de Zinarix ya están aplicados.'
  } else {
    git apply --check $Patch 2>$null
    if ($LASTEXITCODE -ne 0) {
      Bad 'El parche zinarix-3d.patch no entra en esta versión de Blender.' `
        "Revisa a mano: git -C `"$BlenderDir`" apply --reject `"$Patch`""
    } elseif (-not $CheckOnly) {
      git apply $Patch
      if ($LASTEXITCODE -ne 0) { throw 'No se pudo aplicar el parche.' }
      Ok 'Cambios de Zinarix aplicados.'
    } else {
      Ok 'El parche se puede aplicar.'
    }
  }
} finally { Pop-Location }

if ($problems.Count) {
  Write-Host "`nFaltan $($problems.Count) cosas. Instálalas y vuelve a correr el script." -ForegroundColor Red
  exit 1
}
if ($CheckOnly) {
  Write-Host "`nTodo listo para compilar." -ForegroundColor Green
  exit 0
}

Copy-Item (Join-Path $Template 'splash.png') (Join-Path $BlenderDir 'release\datafiles\splash.png') -Force
Copy-Item (Join-Path $Template 'zinarix.ico') (Join-Path $BlenderDir 'release\windows\icons\winblender.ico') -Force
Ok 'Imagen de inicio e ícono de Zinarix copiados.'

if (-not $SkipLibs) {
  Step 'Librerías de Blender para Windows (la primera vez son unos 7 GB)'
  # --no-blender: do not "git pull" the Blender source, that would mix in newer upstream code.
  & $python -B (Join-Path $BlenderDir 'build_files\utils\make_update.py') --no-blender --no-lfs-fallback
  if ($LASTEXITCODE -ne 0) { throw 'No se pudieron descargar las librerías.' }
}
if (-not (Test-Path (Join-Path $BlenderDir 'lib\windows_x64\python'))) {
  throw "Faltan las librerías en $BlenderDir\lib\windows_x64. Corre el script sin -SkipLibs."
}

Step 'Compilando (de 30 a 60 minutos la primera vez)'
$vsArg = if ($vs.productId -eq 'Microsoft.VisualStudio.Product.BuildTools') { '2022b' } else { '2022' }
New-Item -ItemType Directory -Force (Split-Path $BuildDir) | Out-Null
& cmd.exe /c "`"$BlenderDir\make.bat`" $vsArg x64 builddir `"$BuildDir`""
if ($LASTEXITCODE -ne 0) { throw 'La compilación falló. El error está arriba.' }

$out = Join-Path $BuildDir 'bin\Release'
if (-not (Test-Path (Join-Path $out 'blender.exe'))) { throw "No encontré blender.exe en $out" }

Step "Instalando en $InstallDir"
New-Item -ItemType Directory -Force $InstallDir | Out-Null
robocopy $out $InstallDir /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'No se pudieron copiar los archivos.' }
# The app hands Blender its own, newer copy of the AI add-on; a second bundled copy would clash.
Get-ChildItem $InstallDir -Directory -Filter '[0-9]*' | ForEach-Object {
  $dup = Join-Path $_.FullName 'scripts\addons_core\zinarix_ai'
  if (Test-Path $dup) { Remove-Item $dup -Recurse -Force }
}

& (Join-Path $InstallDir 'blender.exe') --version | Select-Object -First 1
Write-Host "`nListo. Zinarix Studio 3D quedó en $InstallDir y la app lo usará en Modo Pro." -ForegroundColor Green
