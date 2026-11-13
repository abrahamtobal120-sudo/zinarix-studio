# Zinarix Studio installer for Windows (PowerShell 5.1+ / PowerShell 7).
#
#   irm https://zinarix-studio.vercel.app/install.ps1 | iex
#
# Downloads the latest installer from the official GitHub release, verifies its SHA-256
# against the release's SHA256SUMS, whose minisign signature it checks with the public key
# embedded below (in plain PowerShell, nothing to install), and installs it silently for
# the current user. If the checksum or the signature cannot be checked it stops.
# Optional: set $env:ZINARIX_VERSION = '0.3.2' before running to pick a version,
#           $env:ZINARIX_UNINSTALL = '1' to uninstall,
#           or $env:ZINARIX_INSECURE = '1' to install even if the SHA-256 cannot be
#           checked (not recommended).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is much faster without the bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'abrahamtobal120-sudo/zinarix-studio'
$App = 'Zinarix Studio'
$Insecure = $env:ZINARIX_INSECURE -eq '1'

function Say($m) { Write-Host "› $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "✓ $m" -ForegroundColor Green }
function Warn($m) { Write-Host "! $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "✗ $m" -ForegroundColor Red; throw $m }
function InsecureOrFail($m) {
  if ($Insecure) { Warn "ZINARIX_INSECURE=1: $m" }
  else { Fail "$m Instalación cancelada por seguridad. Si confías en la descarga, define `$env:ZINARIX_INSECURE = '1' y vuelve a ejecutar." }
}

# ---------------------------------------------------------------- signature (minisign)
# SHA256SUMS is signed by the release workflow with the project's minisign key; the public
# half is below. Once it is set, the checksums are only trusted if the signature is valid
# (fail-closed): a file swapped in the GitHub release cannot come with a matching signature.
# Until the owner pastes the real key (docs/release-signing.md), signatures are not checked.
$MinisignPubKey = 'REPLACE_WITH_MINISIGN_PUBLIC_KEY'
$SigningEnabled = $MinisignPubKey.StartsWith('RW')

# Ed25519 signature check (RFC 8032, section 5.1.7) in plain PowerShell: Windows ships no
# Ed25519 and no minisign, and this keeps the installer free of extra downloads.
function Test-Ed25519([byte[]]$PublicKey, [byte[]]$Message, [byte[]]$Signature) {
  if ($PublicKey.Length -ne 32 -or $Signature.Length -ne 64) { return $false }
  $BI = [System.Numerics.BigInteger]
  $p = $BI::Pow(2, 255) - 19
  $L = $BI::Pow(2, 252) + $BI::Parse('27742317777372353535851937790883648493')
  $inv = { param($x) $BI::ModPow((($x % $p) + $p) % $p, $p - 2, $p) }
  $d = ((-121665 * (& $inv 121666)) % $p + $p) % $p
  $d2 = (2 * $d) % $p
  $sqrtM1 = $BI::ModPow(2, ($p - 1) / 4, $p)
  $toInt = { param([byte[]]$b) $c = New-Object byte[] ($b.Length + 1); [Array]::Copy($b, $c, $b.Length); New-Object System.Numerics.BigInteger (, $c) }
  # Extended coordinates (X, Y, Z, T); values may be negative between steps, compared mod p.
  $add = {
    param($U, $V)
    $aa = (($U[1] - $U[0]) * ($V[1] - $V[0])) % $p
    $bb = (($U[1] + $U[0]) * ($V[1] + $V[0])) % $p
    $cc = ($U[3] * $d2 * $V[3]) % $p
    $dd = (2 * $U[2] * $V[2]) % $p
    $e1 = $bb - $aa; $f1 = $dd - $cc; $g1 = $dd + $cc; $h1 = $bb + $aa
    @((($e1 * $f1) % $p), (($g1 * $h1) % $p), (($f1 * $g1) % $p), (($e1 * $h1) % $p))
  }
  $mul = {
    param($k, $W)
    $acc = @($BI::Zero, $BI::One, $BI::One, $BI::Zero)
    while ($k.Sign -gt 0) {
      if (-not $k.IsEven) { $acc = & $add $acc $W }
      $W = & $add $W $W
      $k = $k / 2
    }
    $acc
  }
  $recoverX = {
    param($y, $sign)
    if ($y -ge $p) { return $null }
    $x2 = ((($y * $y - 1) % $p) * (& $inv ($d * $y * $y + 1))) % $p
    $x2 = ($x2 + $p) % $p
    if ($x2.IsZero) { if ($sign -eq 1) { return $null } else { return $BI::Zero } }
    $x = $BI::ModPow($x2, ($p + 3) / 8, $p)
    if (((($x * $x - $x2) % $p) + $p) % $p -ne 0) { $x = ($x * $sqrtM1) % $p }
    if (((($x * $x - $x2) % $p) + $p) % $p -ne 0) { return $null }
    if ([int]($x % 2) -ne $sign) { $x = $p - $x }
    $x
  }
  $decompress = {
    param([byte[]]$enc)
    $sign = $enc[31] -shr 7
    $c = [byte[]]$enc.Clone(); $c[31] = $c[31] -band 0x7f
    $y = & $toInt $c
    $x = & $recoverX $y $sign
    if ($null -eq $x) { return $null }
    @($x, $y, $BI::One, (($x * $y) % $p))
  }
  $gy = (4 * (& $inv 5)) % $p
  $gx = & $recoverX $gy 0
  $Gp = @($gx, $gy, $BI::One, (($gx * $gy) % $p))

  $ptA = & $decompress $PublicKey
  $Rb = [byte[]]$Signature[0..31]
  $ptR = & $decompress $Rb
  if ($null -eq $ptA -or $null -eq $ptR) { return $false }
  $sc = & $toInt ([byte[]]$Signature[32..63])
  if ($sc -ge $L) { return $false }
  $sha = [System.Security.Cryptography.SHA512]::Create()
  $hk = (& $toInt $sha.ComputeHash([byte[]]($Rb + $PublicKey + $Message))) % $L
  # [S]B must equal R + [k]A.
  $lhs = & $mul $sc $Gp
  $rhs = & $add $ptR (& $mul $hk $ptA)
  $same = { param($u, $v) ((($u % $p) + $p) % $p) -eq ((($v % $p) + $p) % $p) }
  return ((& $same ($lhs[0] * $rhs[2]) ($rhs[0] * $lhs[2])) -and (& $same ($lhs[1] * $rhs[2]) ($rhs[1] * $lhs[2])))
}

# Verifies a minisign signature (file, .minisig) against $MinisignPubKey and returns the
# signature's trusted comment; throws if it is not valid. Uses minisign.exe when installed.
function Test-Minisign([string]$File, [string]$SigFile) {
  $mini = Get-Command minisign -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($mini) {
    $tc = & $mini.Source -V -Q -P $MinisignPubKey -m $File -x $SigFile 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'firma no válida' }
    return ("$tc".Trim() -replace '^trusted comment: ', '')
  }
  $pub = [Convert]::FromBase64String($MinisignPubKey)
  $lines = [IO.File]::ReadAllLines($SigFile, [Text.Encoding]::UTF8)
  if ($lines.Count -lt 4 -or -not $lines[2].StartsWith('trusted comment: ')) { throw 'firma mal formada' }
  $sig = [Convert]::FromBase64String($lines[1].Trim())
  $global = [Convert]::FromBase64String($lines[3].Trim())
  $tc = $lines[2].Substring(17)
  if ($pub.Length -ne 42 -or $sig.Length -ne 74 -or $global.Length -ne 64) { throw 'firma mal formada' }
  if ([Text.Encoding]::ASCII.GetString($pub, 0, 2) -cne 'Ed') { throw 'llave pública desconocida' }
  # The signature must name the same key id as the public key.
  if ([BitConverter]::ToString($pub, 2, 8) -ne [BitConverter]::ToString($sig, 2, 8)) { throw 'firmado con otra llave' }
  $alg = [Text.Encoding]::ASCII.GetString($sig, 0, 2)
  # "Ed": the file itself is signed (the release workflow signs this way, minisign -l).
  # "ED" (BLAKE2b-512 prehash) needs minisign.exe.
  if ($alg -cne 'Ed') { throw "formato de firma '$alg' no soportado sin minisign.exe" }
  $pk = [byte[]]$pub[10..41]
  $s = [byte[]]$sig[10..73]
  if (-not (Test-Ed25519 $pk ([IO.File]::ReadAllBytes($File)) $s)) { throw 'firma no válida' }
  # The trusted comment is signed too (global signature over signature + comment).
  if (-not (Test-Ed25519 $pk ([byte[]]($s + [Text.Encoding]::UTF8.GetBytes($tc))) $global)) { throw 'comentario firmado no válido' }
  return $tc
}


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
  Warn 'No se pudo usar la API de GitHub; se usará la página de descargas (la suma SHA-256 se tomará de SHA256SUMS).'
  $tag = if ($env:ZINARIX_VERSION) { "v$($env:ZINARIX_VERSION.TrimStart('v'))" } else {
    $r = Invoke-WebRequest -Uri "https://github.com/$Repo/releases/latest" -UseBasicParsing
    $final = if ($r.BaseResponse.ResponseUri) { $r.BaseResponse.ResponseUri.AbsoluteUri } else { $r.BaseResponse.RequestMessage.RequestUri.AbsoluteUri }
    # Without a published release GitHub redirects to /releases (no /tag/ in the URL).
    if ($final -notmatch '/tag/') { Fail "No se pudo determinar la versión más reciente: GitHub respondió $final (¿no hay releases publicados todavía?). Define `$env:ZINARIX_VERSION = 'X.Y.Z'." }
    ($final -split '/tag/')[-1]
  }
  if ($tag -match '[/:\s]') { Fail "Versión inválida obtenida de GitHub: '$tag'. Define `$env:ZINARIX_VERSION = 'X.Y.Z'." }
  $v = $tag.TrimStart('v')
  $name = "Zinarix-Studio-Setup-$v.exe"
  $release = [pscustomobject]@{ tag_name = $tag }
  $asset = [pscustomobject]@{ name = $name; size = 0; digest = $null; browser_download_url = "https://github.com/$Repo/releases/download/$tag/$name" }
}

# Private, unpredictable download folder (not a fixed name in %TEMP%).
$tmp = (New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) "zinarix-$([guid]::NewGuid())")).FullName
try {
  # Expected SHA-256. With signing set up: the release's SHA256SUMS (generated by
  # .github/workflows/release.yml), trusted only if its minisign signature is valid and
  # names this release; GitHub's digest must agree with it. Without: GitHub's digest, else
  # the unsigned SHA256SUMS.
  $tag = $release.tag_name
  $base = "https://github.com/$Repo/releases/download/$tag"
  $ghWant = $null
  if ($asset.digest -and $asset.digest.StartsWith('sha256:')) { $ghWant = $asset.digest.Substring(7).ToLower() }
  $sums = Join-Path $tmp 'SHA256SUMS'
  $sumsOk = $false
  try { Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile $sums -UseBasicParsing; $sumsOk = $true } catch { $sumsOk = $false }
  $signed = $false
  if ($SigningEnabled) {
    $sigFile = Join-Path $tmp 'SHA256SUMS.minisig'
    $sigOk = $false
    if ($sumsOk) { try { Invoke-WebRequest -Uri "$base/SHA256SUMS.minisig" -OutFile $sigFile -UseBasicParsing; $sigOk = $true } catch { $sigOk = $false } }
    if (-not $sigOk) {
      $sumsOk = $false
      InsecureOrFail "La versión $tag no tiene sumas firmadas (SHA256SUMS y SHA256SUMS.minisig)."
    } else {
      $tc = $null
      try { $tc = Test-Minisign $sums $sigFile } catch {
        Fail "La firma de SHA256SUMS de $tag NO es válida ($($_.Exception.Message)): la descarga pudo ser alterada. Instalación cancelada por seguridad."
      }
      # The signed comment names the release: a validly signed SHA256SUMS of an older
      # release copied into this one (to install an outdated build) is rejected.
      if (" $tc " -notlike "* $tag *") { Fail "SHA256SUMS está firmado para otra versión ('$tc'; se esperaba $tag). Instalación cancelada por seguridad." }
      $signed = $true
      Ok 'Firma de SHA256SUMS verificada (minisign)'
    }
  }
  $want = $null
  if ($sumsOk) {
    foreach ($line in [IO.File]::ReadAllLines($sums)) {
      $parts = $line.Trim() -split '\s+', 2
      if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $asset.name -and $parts[0] -match '^[0-9a-fA-F]{64}$') { $want = $parts[0].ToLower(); break }
    }
  }
  if ($signed) {
    if (-not $want) { Fail "$($asset.name) no aparece en el SHA256SUMS firmado de $tag. Instalación cancelada por seguridad." }
    if ($ghWant -and $ghWant -ne $want) { Fail "La suma SHA-256 que publica GitHub para $($asset.name) no coincide con la firmada. Instalación cancelada por seguridad." }
  } elseif ($ghWant -and -not $SigningEnabled) {
    $want = $ghWant
  } elseif (-not $want) {
    $want = $ghWant # only reachable with ZINARIX_INSECURE=1 when signing is set up
  }
  if (-not $want) {
    if (-not $Insecure) {
      Fail "No se pudo obtener la suma SHA-256 de $($asset.name) (ni de la API de GitHub ni de SHA256SUMS). Instalación cancelada por seguridad. Si confías en la descarga, define `$env:ZINARIX_INSECURE = '1' y vuelve a ejecutar."
    }
    Warn "ZINARIX_INSECURE=1: se instalará $($asset.name) SIN verificar su suma SHA-256."
  }

  $dest = Join-Path $tmp $asset.name
  Say "Descargando $($asset.name)$(if ($asset.size) { " ($([math]::Round($asset.size / 1MB)) MB)" })…"
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -UseBasicParsing

  $verified = $false
  if ($want) {
    $got = (Get-FileHash -Algorithm SHA256 -Path $dest).Hash.ToLower()
    if ($got -ne $want) { Fail 'La suma SHA-256 no coincide. Instalación cancelada por seguridad.' }
    $verified = $true
    Ok 'Integridad verificada (SHA-256)'
  }

  # Authenticode signing is optional (docs/release-signing.md): report the status, do not
  # block on it (the checksum above already ties the file to the release).
  try {
    $sig = Get-AuthenticodeSignature -FilePath $dest
    if ($sig.Status -eq 'Valid') { Ok "Firma Authenticode válida ($($sig.SignerCertificate.Subject))" }
    else { Warn "El instalador no tiene firma Authenticode válida (estado: $($sig.Status)); por ahora los binarios no se firman." }
  } catch { Warn 'No se pudo comprobar la firma Authenticode.' }

  Say "Instalando $App…"
  # Only drop the "downloaded from the Internet" mark when the checksum was verified;
  # otherwise SmartScreen still gets a say.
  if ($verified) { Unblock-File -Path $dest }
  $p = Start-Process -FilePath $dest -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { Fail "El instalador terminó con código $($p.ExitCode)." }
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Ok "$App $($release.tag_name.TrimStart('v')) instalado. Ábrelo desde el menú Inicio."
