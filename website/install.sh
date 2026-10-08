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
#
# What it does: downloads the installer for your system from the official GitHub release,
# checks its SHA-256 against the value GitHub publishes, and installs it:
#   Ubuntu / Debian / Mint / Pop!_OS  -> .deb with apt
#   Arch / Manjaro / EndeavourOS      -> .pacman with pacman
#   any other Linux (Fedora, openSUSE…) -> AppImage in ~/.local (no sudo)
#   macOS (Apple Silicon or Intel)    -> .dmg copied to /Applications
set -euo pipefail

REPO="abrahamtobal120-sudo/zinarix-studio"
SITE="https://zinarix-studio.vercel.app"
APP="Zinarix Studio"

MODE="auto"
VERSION=""
DRY_RUN=0
UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --appimage) MODE="appimage" ;;
    --version) VERSION="${2:-}"; shift ;;
    --version=*) VERSION="${1#*=}" ;;
    --uninstall) UNINSTALL=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help) sed -n '2,20p' "$0" 2>/dev/null || true; exit 0 ;;
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
  TAG="$(printf '%s' "$JSON" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
else
  # API unavailable (rate limit, firewall): resolve the tag from the release page redirect.
  warn "No se pudo usar la API de GitHub; se usará la página de descargas (sin verificación SHA-256)."
  if [ -n "$VERSION" ]; then
    TAG="v${VERSION#v}"
  else
    TAG="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest" | sed -E 's#.*/tag/##')"
  fi
fi
[ -n "$TAG" ] && [ "$TAG" != "latest" ] || die "No se encontró la versión."
V="${TAG#v}"

# Prints "<digest>" for an asset name from the release JSON (empty if GitHub has none).
asset_digest() {
  printf '%s\n' "$JSON" | awk -v want="\"name\": \"$1\"" '
    index($0, want) { found = 1; next }
    found && /"name":/ { exit }
    found && /"digest":/ { gsub(/.*"digest": *"sha256:|".*/, ""); print; exit }'
}

download() { # name -> path of the verified file
  local name="$1" url="https://github.com/${REPO}/releases/download/${TAG}/$1" dest
  dest="${TMP}/${name}"
  say "Descargando ${name}…"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s\n' "  [dry-run] curl -fL $url" >&2
    printf '%s' "$dest"
    return
  fi
  curl -fL --progress-bar -o "$dest" "$url" || die "No se pudo descargar $url"
  local want got
  want="$(asset_digest "$name")"
  if [ -n "$want" ]; then
    if command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$dest" | cut -d' ' -f1)"; else got="$(shasum -a 256 "$dest" | cut -d' ' -f1)"; fi
    [ "$got" = "$want" ] || die "La suma SHA-256 no coincide para ${name}. Descarga cancelada por seguridad."
    ok "Integridad verificada (SHA-256)"
  else
    warn "GitHub no publicó la suma SHA-256 de ${name}; no se pudo verificar."
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
  [ "$ARCH" = "x86_64" ] || die "Por ahora el AppImage solo está disponible para x86_64 (tu equipo: $ARCH)."
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
    [ "$ARCH" = "x86_64" ] || { [ "$FAMILY" = "appimage" ] || warn "Arquitectura $ARCH: solo hay paquetes x86_64; se intentará el AppImage."; FAMILY="appimage"; }
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
      MNT="$(mktemp -d)"
      hdiutil attach -nobrowse -quiet -mountpoint "$MNT" "$FILE"
      rm -rf "${DEST}/${APP}.app"
      cp -R "${MNT}/${APP}.app" "$DEST/"
      hdiutil detach -quiet "$MNT" || true
      # Not notarized yet: clear the quarantine flag so Gatekeeper lets it open.
      xattr -dr com.apple.quarantine "${DEST}/${APP}.app" 2>/dev/null || true
    fi
    link_cli "open -a \"${DEST}/${APP}.app\" --args"
    ok "Instalado en ${DEST}/${APP}.app — ábrelo desde Launchpad o con: zinarix-studio"
    ;;
  *)
    die "Sistema no soportado: $OS. En Windows usa PowerShell: irm ${SITE}/install.ps1 | iex"
    ;;
esac
