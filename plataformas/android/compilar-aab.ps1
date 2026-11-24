# Compila Zinarix Remote como .aab (el formato que pide Google Play), firmado con la llave
# permanente del proyecto. Uso, desde la carpeta del proyecto:
#
#   pwsh plataformas/android/compilar-aab.ps1            (usa la versión de package.json)
#   pwsh plataformas/android/compilar-aab.ps1 0.6.6
#
# Necesita JDK 17 y el SDK de Android (JAVA_HOME / ANDROID_HOME, o la copia portátil de
# %TEMP%\zs-android) y la llave: ZX_KEYSTORE + ZX_KEYSTORE_PASSWORD, o
# %USERPROFILE%\.zinarix-android\zinarix-remote.jks con password.txt al lado.
# El resultado queda en plataformas/android/Zinarix-Remote.aab (no se sube a git).
param([string]$Version)
$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$project = Join-Path $root 'apps\remote-android'
if (-not $Version) { $Version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version }

$portable = Join-Path $env:TEMP 'zs-android'
if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME 'bin\javac.exe'))) {
  $jdk = Get-ChildItem (Join-Path $portable 'jdk') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}
if (-not $env:ANDROID_HOME -and (Test-Path (Join-Path $portable 'sdk'))) { $env:ANDROID_HOME = Join-Path $portable 'sdk' }
if (-not $env:GRADLE_USER_HOME -and (Test-Path (Join-Path $portable 'gradle-home'))) { $env:GRADLE_USER_HOME = Join-Path $portable 'gradle-home' }
if ("$env:JAVA_TOOL_OPTIONS" -notmatch 'trustStoreType') {
  $env:JAVA_TOOL_OPTIONS = "$env:JAVA_TOOL_OPTIONS -Djavax.net.ssl.trustStoreType=Windows-ROOT".Trim()
}
if (-not $env:ZX_KEYSTORE) {
  $dir = Join-Path $env:USERPROFILE '.zinarix-android'
  $jks = Join-Path $dir 'zinarix-remote.jks'
  if (Test-Path $jks) {
    $env:ZX_KEYSTORE = $jks
    $pw = Join-Path $dir 'password.txt'
    if (-not $env:ZX_KEYSTORE_PASSWORD -and (Test-Path $pw)) { $env:ZX_KEYSTORE_PASSWORD = (Get-Content $pw -Raw).Trim() }
  }
}
if (-not $env:JAVA_HOME) { throw 'No encontré Java 17 (JAVA_HOME).' }
if (-not $env:ANDROID_HOME) { throw 'No encontré el SDK de Android (ANDROID_HOME).' }
if (-not $env:ZX_KEYSTORE -or -not $env:ZX_KEYSTORE_PASSWORD) { throw 'No encontré la llave de firma (ZX_KEYSTORE / ZX_KEYSTORE_PASSWORD).' }

Push-Location $project
try {
  & .\gradlew.bat --no-daemon bundleRelease "-PzxVersion=$Version"
  if ($LASTEXITCODE -ne 0) { throw "Gradle falló ($LASTEXITCODE)." }
} finally { Pop-Location }

$aab = Join-Path $project 'app\build\outputs\bundle\release\app-release.aab'
if (-not (Test-Path $aab)) { throw 'Gradle no dejó app-release.aab.' }
$out = Join-Path $PSScriptRoot 'Zinarix-Remote.aab'
Copy-Item $aab $out -Force
& (Join-Path $env:JAVA_HOME 'bin\jarsigner.exe') -verify $out | Select-String 'verified'
Write-Host "Zinarix-Remote.aab $Version ($([math]::Round((Get-Item $out).Length / 1KB)) KB) -> $out"
