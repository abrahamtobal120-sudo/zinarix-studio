# Zinarix Studio installer for Windows (PowerShell 5.1+ / PowerShell 7).
#
#   irm https://zinarix-studio.vercel.app/install.ps1 | iex
#
# Downloads the latest installer from the official GitHub release, verifies its SHA-256
# against the value GitHub publishes, and installs it silently for the current user.
# Optional: set $env:ZINARIX_VERSION = '0.3.2' before running to pick a version,
#           or $env:ZINARIX_UNINSTALL = '1' to uninstall.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is much faster without the bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'abrahamtobal120-sudo/zinarix-studio'
$App = 'Zinarix Studio'

function Say($m) { Write-Host "› $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "✓ $m" -ForegroundColor Green }
function Fail($m) { Write-Host "✗ $m" -ForegroundColor Red; throw $m }

if ($env:ZINARIX_UNINSTALL -eq '1') {
  $keys = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $entry = Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "$App*" } | Select-Object -First 1
  if (-not $entry) { Ok "$App no está instalado."; return }
  Say "Desinstalando $App…"
  $cmd = $entry.QuietUninstallString
  if (-not $cmd) { $cmd = "$($entry.UninstallString) /S" }
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -Wait -WindowStyle Hidden
  Ok "Listo. Tus chats y llaves siguen en $HOME\.omni (bórralo si ya no los quieres)."
  return
}

if (-not [Environment]::Is64BitOperatingSystem) { Fail 'Zinarix Studio requiere Windows de 64 bits.' }

$api = if ($env:ZINARIX_VERSION) {
  "https://api.github.com/repos/$Repo/releases/tags/v$($env:ZINARIX_VERSION.TrimStart('v'))"
} else {
  "https://api.github.com/repos/$Repo/releases/latest"
}
Say "Buscando la versión $(if ($env:ZINARIX_VERSION) { $env:ZINARIX_VERSION } else { 'más reciente' }) de $App…"
$headers = @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'zinarix-installer' }
$token = if ($env:GITHUB_TOKEN) { $env:GITHUB_TOKEN } else { $env:GH_TOKEN }
if ($token) { $headers.Authorization = "Bearer $token" }
$release = $null
try { $release = Invoke-RestMethod -Uri $api -Headers $headers } catch { $release = $null }
if ($release) {
  $asset = $release.assets | Where-Object { $_.name -match '^Zinarix-Studio-Setup-.*\.exe$' } | Select-Object -First 1
  if (-not $asset) { Fail "La versión $($release.tag_name) no tiene instalador para Windows." }
} else {
  # API unavailable (rate limit, proxy): resolve the version from the release page redirect.
  Write-Host '! No se pudo usar la API de GitHub; se usará la página de descargas (sin verificación SHA-256).' -ForegroundColor Yellow
  $tag = if ($env:ZINARIX_VERSION) { "v$($env:ZINARIX_VERSION.TrimStart('v'))" } else {
    $r = Invoke-WebRequest -Uri "https://github.com/$Repo/releases/latest" -UseBasicParsing
    $final = if ($r.BaseResponse.ResponseUri) { $r.BaseResponse.ResponseUri.AbsoluteUri } else { $r.BaseResponse.RequestMessage.RequestUri.AbsoluteUri }
    ($final -split '/tag/')[-1]
  }
  $v = $tag.TrimStart('v')
  $name = "Zinarix-Studio-Setup-$v.exe"
  $release = [pscustomobject]@{ tag_name = $tag }
  $asset = [pscustomobject]@{ name = $name; size = 0; digest = $null; browser_download_url = "https://github.com/$Repo/releases/download/$tag/$name" }
}

$dest = Join-Path $env:TEMP $asset.name
Say "Descargando $($asset.name)$(if ($asset.size) { " ($([math]::Round($asset.size / 1MB)) MB)" })…"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -UseBasicParsing

if ($asset.digest -and $asset.digest.StartsWith('sha256:')) {
  $want = $asset.digest.Substring(7).ToLower()
  $got = (Get-FileHash -Algorithm SHA256 -Path $dest).Hash.ToLower()
  if ($got -ne $want) { Remove-Item $dest -Force; Fail 'La suma SHA-256 no coincide. Instalación cancelada por seguridad.' }
  Ok 'Integridad verificada (SHA-256)'
} else {
  Write-Host '! GitHub no publicó la suma SHA-256; no se pudo verificar.' -ForegroundColor Yellow
}

Say "Instalando $App…"
Unblock-File -Path $dest
$p = Start-Process -FilePath $dest -ArgumentList '/S' -Wait -PassThru
Remove-Item $dest -Force -ErrorAction SilentlyContinue
if ($p.ExitCode -ne 0) { Fail "El instalador terminó con código $($p.ExitCode)." }

Ok "$App $($release.tag_name.TrimStart('v')) instalado. Ábrelo desde el menú Inicio."
