#!/usr/bin/env bash
# Zinarix Studio installer for Linux and macOS.
#
#   curl -fsSL https://zinarix-studio.vercel.app/install.sh | bash
#
# Options (pass after `bash -s --`, e.g. `curl ... | bash -s -- --appimage`):
#   --appimage        Linux: install the AppImage in your home folder (no sudo)
#   --version X.Y.Z   install a specific version instead of the latest
#   --uninstall       remove Zinarix Studio
#   --dry-run         show what would be done without changing anything
#   --insecure        install even if the SHA-256 cannot be checked (not recommended;
#                     same as ZINARIX_INSECURE=1)
#
# What it does: downloads the installer for your system from the official GitHub release,
# checks its SHA-256 against the release's SHA256SUMS, whose minisign signature it verifies
# with the public key embedded below (needs `minisign` or OpenSSL 3), and installs it. If the
# checksum or the signature cannot be checked it stops, unless you pass --insecure:
#   Ubuntu / Debian / Mint / Pop!_OS  -> .deb with apt
#   Arch / Manjaro / EndeavourOS      -> .pacman with pacman
#   any other Linux (Fedora, openSUSE…) -> AppImage in ~/.local (no sudo)
#   macOS (Apple Silicon or Intel)    -> .dmg copied to /Applications
set -euo pipefail
trap 'printf "\033[31m✗ Falló el paso: %s (línea %s)\033[0m\n" "$BASH_COMMAND" "$LINENO" >&2' ERR

REPO="abrahamtobal120-sudo/zinarix-studio"
SITE="https://zinarix-studio.vercel.app"
APP="Zinarix Studio"

MODE="auto"
VERSION=""
DRY_RUN=0
UNINSTALL=0
INSECURE="${ZINARIX_INSECURE:-0}"
while [ $# -gt 0 ]; do
  case "$1" in
    --appimage) MODE="appimage" ;;
    --version) VERSION="${2:-}"; shift ;;
    --version=*) VERSION="${1#*=}" ;;
    --uninstall) UNINSTALL=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --insecure) INSECURE=1 ;;
    -h | --help) sed -n '2,21p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -t 1 ]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; N=$'\033[0m'
else
  B=''; G=''; Y=''; R=''; C=''; N=''
fi
say() { printf '%s\n' "${C}›${N} $*" >&2; }
ok() { printf '%s\n' "${G}✓${N} $*" >&2; }
warn() { printf '%s\n' "${Y}!${N} $*" >&2; }
die() { printf '%s\n' "${R}✗ $*${N}" >&2; exit 1; }
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '%s\n' "  [dry-run] $*" >&2; else "$@"; fi
}
need() { command -v "$1" >/dev/null 2>&1 || die "Falta el comando '$1'. Instálalo y vuelve a intentar."; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; elif command -v doas >/dev/null 2>&1; then SUDO="doas"; fi
fi

OS="$(uname -s)"
ARCH="$(uname -m)"
BIN_DIR="${HOME}/.local/bin"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
APPIMAGE_PATH="${DATA_DIR}/zinarix-studio/Zinarix-Studio.AppImage"

linux_family() {
  local id="" like=""
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    id="${ID:-}"; like="${ID_LIKE:-}"
  fi
  case " $id $like " in
    *" debian "* | *" ubuntu "*) echo debian ;;
    *" arch "*) echo arch ;;
    *) command -v apt-get >/dev/null 2>&1 && echo debian && return
       command -v pacman >/dev/null 2>&1 && echo arch && return
       echo other ;;
  esac
}

# ---------------------------------------------------------------- uninstall
if [ "$UNINSTALL" = 1 ]; then
  say "Desinstalando ${APP}…"
  if [ "$OS" = "Darwin" ]; then
    for d in "/Applications/${APP}.app" "$HOME/Applications/${APP}.app"; do
      [ -d "$d" ] && run rm -rf "$d" && ok "Eliminado $d"
    done
  else
    if command -v dpkg >/dev/null 2>&1 && dpkg -s zinarix-studio >/dev/null 2>&1; then
      run $SUDO apt-get purge -y zinarix-studio && ok "Paquete .deb eliminado"
    fi
    if command -v pacman >/dev/null 2>&1; then
      # Look the package up by the file it owns: early builds were named "Zinarix Studio".
      PKG="$(pacman -Qqo "/opt/${APP}/zinarix-studio" 2>/dev/null || true)"
      [ -z "$PKG" ] && pacman -Q zinarix-studio >/dev/null 2>&1 && PKG="zinarix-studio"
      if [ -n "$PKG" ]; then run $SUDO pacman -R --noconfirm "$PKG" && ok "Paquete pacman eliminado"; fi
    fi
    if [ -f "$APPIMAGE_PATH" ]; then
      run rm -rf "$(dirname "$APPIMAGE_PATH")" "${DATA_DIR}/applications/zinarix-studio.desktop" \
        "${DATA_DIR}/icons/hicolor/512x512/apps/zinarix-studio.png"
      ok "AppImage eliminado"
    fi
  fi
  [ -L "${BIN_DIR}/zinarix-studio" ] || [ -f "${BIN_DIR}/zinarix-studio" ] && run rm -f "${BIN_DIR}/zinarix-studio"
  ok "Listo. Tus chats y llaves siguen en ~/.omni (bórralo si ya no los quieres)."
  exit 0
fi

# ---------------------------------------------------------------- release lookup
need curl
if [ -n "$VERSION" ]; then
  API="https://api.github.com/repos/${REPO}/releases/tags/v${VERSION#v}"
else
  API="https://api.github.com/repos/${REPO}/releases/latest"
fi
say "Buscando la versión ${VERSION:-más reciente} de ${B}${APP}${N}…"
AUTH=()
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
[ -n "$TOKEN" ] && AUTH=(-H "Authorization: Bearer ${TOKEN}")
JSON=""
if [ "${ZINARIX_NO_API:-0}" != 1 ]; then
  JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' ${AUTH[@]+"${AUTH[@]}"} "$API" 2>/dev/null)" || JSON=""
fi
if [ -n "$JSON" ]; then
  # Parse in-process (no pipes): an early-closing pipe would trip `set -o pipefail`.
  TAG=""
  re='"tag_name": *"([^"]+)"'
  [[ $JSON =~ $re ]] && TAG="${BASH_REMATCH[1]}"
else
  # API unavailable (rate limit, firewall): resolve the tag from the release page redirect.
  warn "No se pudo usar la API de GitHub; se usará la página de descargas (la suma SHA-256 se tomará de SHA256SUMS)."
  if [ -n "$VERSION" ]; then
    TAG="v${VERSION#v}"
  else
    EFFECTIVE="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest")" || EFFECTIVE=""
    TAG="${EFFECTIVE##*/tag/}"
    # Without a published release GitHub redirects to /releases (no /tag/ in the URL).
    case "$EFFECTIVE" in
      */tag/*) ;;
      *) die "No se pudo determinar la versión más reciente: GitHub respondió ${EFFECTIVE:-sin URL} (¿no hay releases publicados todavía?). Prueba con --version X.Y.Z." ;;
    esac
  fi
fi
[ -n "$TAG" ] && [ "$TAG" != "latest" ] || die "No se encontró la versión."
case "$TAG" in
  */* | *:* | *' '*) die "Versión inválida obtenida de GitHub: '$TAG'. Prueba con --version X.Y.Z." ;;
esac
V="${TAG#v}"

# Prints "<digest>" for an asset name from the release JSON (empty if GitHub has none).
asset_digest() {
  [ -n "$JSON" ] || return 0
  awk -v want="\"name\": \"$1\"" '
    index($0, want) { found = 1; next }
    found && /"name":/ { exit }
    found && /"digest":/ { gsub(/.*"digest": *"sha256:|".*/, ""); print; exit }' <<<"$JSON"
}

# ---------------------------------------------------------------- signature (minisign)
# SHA256SUMS is signed by the release workflow with the project's minisign key; the public
# half is below. Once it is set, the checksums are only trusted if the signature is valid
# (fail-closed): a file swapped in the GitHub release cannot come with a matching signature.
# Until the owner pastes the real key (docs/release-signing.md), signatures are not checked.
MINISIGN_PUBKEY="REPLACE_WITH_MINISIGN_PUBLIC_KEY"
signing_enabled() { case "$MINISIGN_PUBKEY" in RW*) return 0 ;; *) return 1 ;; esac; }

hex() { od -An -v -tx1 | tr -d ' \n'; }
b64d() { openssl base64 -d -A; }
bytes() { dd if="$1" bs=1 skip="$2" count="$3" 2>/dev/null; } # file offset length
# Hex to bytes without xxd (not installed everywhere), through printf escapes.
unhex() {
  local h i out=''
  h="$(cat)"
  for ((i = 0; i < ${#h}; i += 2)); do out+="\\x${h:i:2}"; done
  # shellcheck disable=SC2059
  printf "$out"
}

# Verifies an Ed25519 signature with OpenSSL 3: raw 32-byte public key file, message file,
# raw 64-byte signature file.
ossl_ed25519() {
  local pem="${3}.pem"
  {
    printf '%s\n' '-----BEGIN PUBLIC KEY-----'
    { printf '\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00'; cat "$1"; } | openssl base64 -A
    printf '\n%s\n' '-----END PUBLIC KEY-----'
  } >"$pem"
  openssl pkeyutl -verify -pubin -inkey "$pem" -rawin -in "$2" -sigfile "$3" >/dev/null 2>&1
}

# Whether this OpenSSL can check Ed25519 signatures (OpenSSL 3 can; macOS's LibreSSL
# usually cannot): RFC 8032 test vector 2 must verify and a changed message must not.
ossl_ed25519_works() {
  command -v openssl >/dev/null 2>&1 || return 1
  local d="${TMP}/selftest"
  mkdir -p "$d"
  printf '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c' | unhex >"$d/pk"
  printf '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00' | unhex >"$d/sig"
  printf 'r' >"$d/msg" # the vector's one-byte message, 0x72
  printf 'x' >"$d/bad"
  ossl_ed25519 "$d/pk" "$d/msg" "$d/sig" && ! ossl_ed25519 "$d/pk" "$d/bad" "$d/sig"
}

# Verifies a minisign signature (file, .minisig) against MINISIGN_PUBKEY and prints the
# signature's trusted comment. Uses `minisign` when installed, otherwise OpenSSL 3.
# Returns 1 if the signature is invalid, 2 if no available tool can check it.
minisign_verify() {
  local file="$1" sig="$2" tc
  if command -v minisign >/dev/null 2>&1; then
    tc="$(minisign -V -Q -P "$MINISIGN_PUBKEY" -m "$file" -x "$sig" 2>/dev/null)" || return 1
    printf '%s' "${tc#trusted comment: }"
    return 0
  fi
  ossl_ed25519_works || return 2
  local d="${TMP}/minisig" alg
  mkdir -p "$d"
  printf '%s' "$MINISIGN_PUBKEY" | b64d >"$d/pub" 2>/dev/null || return 1
  sed -n 2p "$sig" | tr -d '\r' | b64d >"$d/sig" 2>/dev/null || return 1
  sed -n 4p "$sig" | tr -d '\r' | b64d >"$d/global" 2>/dev/null || return 1
  tc="$(sed -n 3p "$sig" | tr -d '\r')"
  case "$tc" in "trusted comment: "*) tc="${tc#trusted comment: }" ;; *) return 1 ;; esac
  [ "$(wc -c <"$d/pub" | tr -d ' ')" = 42 ] && [ "$(wc -c <"$d/sig" | tr -d ' ')" = 74 ] &&
    [ "$(wc -c <"$d/global" | tr -d ' ')" = 64 ] || return 1
  [ "$(bytes "$d/pub" 0 2 | hex)" = "4564" ] || return 1 # "Ed"
  # The signature must name the same key id as the public key.
  [ "$(bytes "$d/pub" 2 8 | hex)" = "$(bytes "$d/sig" 2 8 | hex)" ] || return 1
  bytes "$d/pub" 10 32 >"$d/pk"
  bytes "$d/sig" 10 64 >"$d/s"
  alg="$(bytes "$d/sig" 0 2 | hex)"
  case "$alg" in
    4564) cp "$file" "$d/msg" ;; # "Ed": legacy, the file itself is signed
    4544) openssl dgst -blake2b512 -binary "$file" >"$d/msg" 2>/dev/null || return 2 ;; # "ED": BLAKE2b-512 of it
    *) return 1 ;;
  esac
  ossl_ed25519 "$d/pk" "$d/msg" "$d/s" || return 1
  # The trusted comment is signed too (global signature over signature + comment).
  { cat "$d/s"; printf '%s' "$tc"; } >"$d/gmsg"
  ossl_ed25519 "$d/pk" "$d/gmsg" "$d/global" || return 1
  printf '%s' "$tc"
}

insecure_or_die() {
  if [ "$INSECURE" = 1 ]; then
    warn "--insecure: $1"
  else
    die "$1 Instalación cancelada por seguridad. Si confías en la descarga, vuelve a ejecutar con --insecure."
  fi
}

# Downloads the release's SHA256SUMS (generated by .github/workflows/release.yml) once and,
# when signing is set up, checks its signature. Leaves ${TMP}/SHA256SUMS only if it may be
# used, and ${TMP}/SHA256SUMS.signed when its signature was verified.
fetch_sums() {
  local sums="${TMP}/SHA256SUMS" sig="${TMP}/SHA256SUMS.minisig" tc rc=0
  local base="https://github.com/${REPO}/releases/download/${TAG}"
  [ -f "${TMP}/SHA256SUMS.tried" ] && return 0
  : >"${TMP}/SHA256SUMS.tried"
  curl -fsSL -o "$sums" "${base}/SHA256SUMS" 2>/dev/null || rm -f "$sums"
  signing_enabled || return 0
  if [ ! -f "$sums" ] || ! curl -fsSL -o "$sig" "${base}/SHA256SUMS.minisig" 2>/dev/null; then
    rm -f "$sums" "$sig"
    insecure_or_die "La versión ${TAG} no tiene sumas firmadas (SHA256SUMS y SHA256SUMS.minisig)."
    return 0
  fi
  tc="$(minisign_verify "$sums" "$sig")" || rc=$?
  case "$rc" in
    0) ;;
    2)
      rm -f "$sums"
      insecure_or_die "Para comprobar la firma de la descarga hace falta 'minisign' (u OpenSSL 3). Instálalo (macOS: brew install minisign · Ubuntu/Debian: sudo apt install minisign · Arch: sudo pacman -S minisign · Fedora: sudo dnf install minisign) y vuelve a intentar."
      return 0
      ;;
    *)
      rm -f "$sums"
      die "La firma de SHA256SUMS de ${TAG} NO es válida: la descarga pudo ser alterada. Instalación cancelada por seguridad."
      ;;
  esac
  # The signed comment names the release: a validly signed SHA256SUMS of an older release
  # copied into this one (to install an outdated build) is rejected.
  case " $tc " in
    *" ${TAG} "*) ;;
    *)
      rm -f "$sums"
      die "SHA256SUMS está firmado para otra versión ('$tc'; se esperaba ${TAG}). Instalación cancelada por seguridad."
      ;;
  esac
  : >"${TMP}/SHA256SUMS.signed"
  ok "Firma de SHA256SUMS verificada (minisign)"
}

# Prints the SHA-256 for an asset name from SHA256SUMS; empty if there is none.
sums_digest() {
  fetch_sums || return 1
  local sums="${TMP}/SHA256SUMS"
  [ -f "$sums" ] || return 0
  awk -v want="$1" '{ f = $2; sub(/^\*/, "", f) } f == want && $1 ~ /^[0-9a-fA-F]{64}$/ { print tolower($1); exit }' "$sums"
}

# Prints the expected SHA-256 for an asset (empty if none could be obtained). With signing
# set up, the signed SHA256SUMS is the source of truth and GitHub's digest must agree.
expected_sha() {
  local want gh
  gh="$(asset_digest "$1")"
  if signing_enabled; then
    want="$(sums_digest "$1")" || exit 1
    if [ -f "${TMP}/SHA256SUMS.signed" ]; then
      [ -n "$want" ] || die "${1} no aparece en el SHA256SUMS firmado de ${TAG}. Instalación cancelada por seguridad."
      [ -z "$gh" ] || [ "$gh" = "$want" ] || die "La suma SHA-256 que publica GitHub para ${1} no coincide con la firmada. Instalación cancelada por seguridad."
    fi
    [ -n "$want" ] || want="$gh" # only reachable with --insecure
  else
    want="$gh"
    [ -n "$want" ] || want="$(sums_digest "$1")" || exit 1
  fi
  printf '%s' "$want"
}

download() { # name -> path of the verified file
  local name="$1" url="https://github.com/${REPO}/releases/download/${TAG}/$1" dest
  dest="${TMP}/${name}"
  say "Descargando ${name}…"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s\n' "  [dry-run] curl -fL $url (y verificar SHA-256$(signing_enabled && printf ' y la firma de SHA256SUMS'))" >&2
    printf '%s' "$dest"
    return
  fi
  local want got
  # Get the expected checksum before downloading: fail fast instead of fetching
  # a large file that would be rejected anyway.
  want="$(expected_sha "$name")" || exit 1
  if [ -z "$want" ] && [ "$INSECURE" != 1 ]; then
    die "No se pudo obtener la suma SHA-256 de ${name} (ni de la API de GitHub ni de SHA256SUMS). Instalación cancelada por seguridad. Si confías en la descarga, vuelve a ejecutar con --insecure."
  fi
  curl -fL --progress-bar -o "$dest" "$url" || die "No se pudo descargar $url"
  if [ -n "$want" ]; then
    if command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$dest" | cut -d' ' -f1)"; else got="$(shasum -a 256 "$dest" | cut -d' ' -f1)"; fi
    [ "$got" = "$want" ] || die "La suma SHA-256 no coincide para ${name}. Descarga cancelada por seguridad."
    : >"${dest}.verified"
    # The checksum came from the SHA256SUMS whose minisign signature was verified: this is
    # the file the release workflow signed, not just whatever the release page now holds.
    if [ -f "${TMP}/SHA256SUMS.signed" ]; then : >"${dest}.signed"; fi
    ok "Integridad verificada (SHA-256)"
  else
    warn "--insecure: se instalará ${name} SIN verificar su suma SHA-256."
  fi
  printf '%s' "$dest"
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

link_cli() { # target command line
  run mkdir -p "$BIN_DIR"
  if [ "$DRY_RUN" = 1 ]; then printf '%s\n' "  [dry-run] crear ${BIN_DIR}/zinarix-studio" >&2; return; fi
  printf '#!/usr/bin/env bash\n%s "$@"\n' "$1" >"${BIN_DIR}/zinarix-studio"
  chmod +x "${BIN_DIR}/zinarix-studio"
  case ":$PATH:" in *":${BIN_DIR}:"*) ;; *) warn "Agrega ${BIN_DIR} a tu PATH para usar el comando 'zinarix-studio'." ;; esac
}

install_appimage() {
  local file
  file="$(download "Zinarix-Studio-${V}-x86_64.AppImage")"
  run mkdir -p "$(dirname "$APPIMAGE_PATH")" "${DATA_DIR}/applications" "${DATA_DIR}/icons/hicolor/512x512/apps"
  run install -m 755 "$file" "$APPIMAGE_PATH"
  run curl -fsSL -o "${DATA_DIR}/icons/hicolor/512x512/apps/zinarix-studio.png" "${SITE}/assets/logo-512.png" || true
  if [ "$DRY_RUN" = 0 ]; then
    cat >"${DATA_DIR}/applications/zinarix-studio.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=${APP}
Comment=Editor de código con cualquier modelo de IA
Exec="${APPIMAGE_PATH}" %F
Icon=zinarix-studio
Terminal=false
Categories=Development;IDE;
StartupWMClass=${APP}
DESKTOP
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "${DATA_DIR}/applications" >/dev/null 2>&1 || true
  fi
  link_cli "exec \"${APPIMAGE_PATH}\""
  if ! { ldconfig -p 2>/dev/null | grep -q 'libfuse.so.2' || ls /usr/lib*/libfuse.so.2* /usr/lib/*/libfuse.so.2* /lib/*/libfuse.so.2* >/dev/null 2>&1; }; then
    warn "Los AppImage necesitan FUSE 2. Si no abre, instala 'libfuse2' (Ubuntu/Debian), 'fuse2' (Arch) o 'fuse-libs' (Fedora)."
  fi
  ok "Instalado en ${APPIMAGE_PATH}"
}

# ---------------------------------------------------------------- install
printf '%s\n' "${B}Zinarix Studio ${V}${N} · ${OS} ${ARCH}"
case "$OS" in
  Linux)
    FAMILY="$(linux_family)"
    [ "$MODE" = "appimage" ] && FAMILY="appimage"
    # Every Linux build (.deb, .pacman and AppImage) is x86_64 only for now.
    [ "$ARCH" = "x86_64" ] || die "Por ahora Zinarix Studio solo se publica para Linux x86_64 (tu equipo: $ARCH); no hay .deb, .pacman ni AppImage para esta arquitectura."
    if [ "$FAMILY" != "appimage" ] && [ -z "$SUDO" ] && [ "$(id -u)" -ne 0 ]; then
      warn "No hay sudo disponible: se instalará el AppImage en tu carpeta personal."
      FAMILY="appimage"
    fi
    case "$FAMILY" in
      debian)
        FILE="$(download "zinarix-studio_${V}_amd64.deb")"
        say "Instalando con apt (puede pedir tu contraseña)…"
        run $SUDO apt-get install -y "$FILE"
        ok "Instalado. Ábrelo desde el menú de aplicaciones o con: zinarix-studio"
        ;;
      arch)
        FILE="$(download "zinarix-studio-${V}-x64.pacman")"
        say "Instalando con pacman (puede pedir tu contraseña)…"
        run $SUDO pacman -U --noconfirm "$FILE"
        ok "Instalado. Ábrelo desde el menú de aplicaciones o con: zinarix-studio"
        ;;
      *)
        install_appimage
        ok "Ábrelo desde el menú de aplicaciones o con: zinarix-studio"
        ;;
    esac
    ;;
  Darwin)
    need hdiutil
    case "$ARCH" in arm64) DMG="Zinarix-Studio-${V}-arm64.dmg" ;; *) DMG="Zinarix-Studio-${V}-x64.dmg" ;; esac
    FILE="$(download "$DMG")"
    DEST="/Applications"
    [ -w "$DEST" ] || DEST="$HOME/Applications"
    run mkdir -p "$DEST"
    if [ "$DRY_RUN" = 1 ]; then
      printf '%s\n' "  [dry-run] montar $DMG y copiar ${APP}.app a $DEST" >&2
    else
      # Mount and locate the .app instead of assuming the volume layout.
      MNT="$(hdiutil attach -nobrowse -noautoopen "$FILE" | awk -F'\t' '/\/Volumes\//{print $NF}' | tail -1)"
      [ -n "$MNT" ] && [ -d "$MNT" ] || die "No se pudo montar $DMG."
      SRC="$(find "$MNT" -maxdepth 2 -name '*.app' -type d -print 2>/dev/null | head -1)"
      if [ -z "$SRC" ]; then
        ls -la "$MNT" >&2 || true
        hdiutil detach -quiet "$MNT" || true
        die "No se encontró la aplicación dentro de $DMG."
      fi
      rm -rf "${DEST}/${APP}.app"
      ditto "$SRC" "${DEST}/${APP}.app"
      hdiutil detach -quiet "$MNT" || hdiutil detach -force -quiet "$MNT" || true
      # Gatekeeper: a notarized app passes `spctl --assess` and keeps its quarantine flag
      # (macOS checks it once on first launch, as it should). An app that is not notarized
      # only gets the flag removed when its checksum came from the minisign-signed
      # SHA256SUMS: that proves it is the build the release workflow signed. A checksum
      # alone (GitHub's digest or an unsigned SHA256SUMS) only proves the download matches
      # the release page, so then Gatekeeper still gets its say.
      if spctl --assess --type execute "${DEST}/${APP}.app" >/dev/null 2>&1; then
        ok "App firmada y notarizada por Apple: Gatekeeper la acepta."
      elif [ -f "${FILE}.verified" ] && [ -f "${FILE}.signed" ]; then
        xattr -dr com.apple.quarantine "${DEST}/${APP}.app" 2>/dev/null || true
      else
        warn "La app no está notarizada y su descarga no tiene firma verificada: se dejó la cuarentena de macOS. La primera vez ábrela con clic derecho > Abrir (o Ajustes del Sistema > Privacidad y seguridad > Abrir igualmente)."
      fi
    fi
    link_cli "open -a \"${DEST}/${APP}.app\" --args"
    ok "Instalado en ${DEST}/${APP}.app — ábrelo desde Launchpad o con: zinarix-studio"
    ;;
  *)
    die "Sistema no soportado: $OS. En Windows usa PowerShell: irm ${SITE}/install.ps1 | iex"
    ;;
esac
