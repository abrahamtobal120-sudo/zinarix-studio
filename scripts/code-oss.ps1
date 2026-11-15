param(
  [ValidateSet('prepare', 'install', 'build', 'start', 'status')]
  [string]$Action = 'prepare',
  [string]$Archive = (Join-Path $env:USERPROFILE 'Downloads/vscode-main.zip')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$vendorRoot = Join-Path $projectRoot 'vendor'
$sourceRoot = Join-Path $vendorRoot 'vscode-main'

if ($Action -eq 'prepare') {
  if (!(Test-Path (Join-Path $sourceRoot 'package.json'))) {
    if (!(Test-Path -LiteralPath $Archive -PathType Leaf)) {
      throw "No se encontro el ZIP de Code - OSS: $Archive"
    }
    New-Item -ItemType Directory -Force -Path $vendorRoot | Out-Null
    Expand-Archive -LiteralPath $Archive -DestinationPath $vendorRoot
  }
  $productPath = Join-Path $sourceRoot 'product.json'
  $product = Get-Content -LiteralPath $productPath -Raw | ConvertFrom-Json
  $overlay = Get-Content (Join-Path $projectRoot 'config/code-oss/product.json') -Raw | ConvertFrom-Json
  foreach ($property in $overlay.PSObject.Properties) {
    $product | Add-Member -MemberType NoteProperty -Name $property.Name -Value $property.Value -Force
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($productPath, (($product | ConvertTo-Json -Depth 100) + "`n"), $utf8)
  Write-Host "Base Code - OSS preparada en $sourceRoot"
  Write-Host 'Siguiente paso: pnpm code:install'
  exit 0
}

if (!(Test-Path (Join-Path $sourceRoot 'product.json'))) {
  throw 'Primero ejecuta pnpm code:prepare.'
}
$requiredNode = (Get-Content (Join-Path $sourceRoot '.nvmrc') -Raw).Trim()
$metadata = Get-Content (Join-Path $sourceRoot 'package.json') -Raw | ConvertFrom-Json
if ($Action -eq 'status') {
  Write-Host "Fuente: $sourceRoot"
  Write-Host "Code - OSS: $($metadata.version)"
  Write-Host "Node requerido: $requiredNode (misma version mayor)"
  Write-Host "Gestor requerido: $($metadata.packageManager)"
  Write-Host "Node actual: $(node --version)"
  Write-Host "Dependencias instaladas: $(Test-Path (Join-Path $sourceRoot 'node_modules'))"
  Write-Host "Compilado: $(Test-Path (Join-Path $sourceRoot 'out/main.js'))"
  exit 0
}
$actualNode = [version](node -p 'process.versions.node')
$minimumNode = [version]$requiredNode
if ($actualNode.Major -ne $minimumNode.Major -or $actualNode -lt $minimumNode) {
  throw "Code - OSS requiere Node $requiredNode o posterior de la rama $($minimumNode.Major). Actual: $actualNode. Cambia Node y vuelve a ejecutar este comando."
}
Push-Location $sourceRoot
try {
  if ($Action -eq 'start') {
    & cmd.exe /d /c scripts\code.bat
  } else {
    # pnpm selecciona el packageManager fijado en el package.json de esta base.
    if ($Action -eq 'install') { & pnpm install }
    if ($Action -eq 'build') { & pnpm run compile }
  }
  if ($LASTEXITCODE -ne 0) { throw "Code - OSS ($Action) fallo con codigo $LASTEXITCODE." }
} finally {
  Pop-Location
}
