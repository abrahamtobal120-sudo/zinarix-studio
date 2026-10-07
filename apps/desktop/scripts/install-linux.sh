#!/usr/bin/env bash
# Installs an "Zinarix Studio" launcher for the current user (no root needed):
#   ~/.local/bin/zinarix-studio                       -> `zinarix-studio [carpeta]` from any terminal
#   ~/.local/share/applications/zinarix-studio.desktop -> entry in the applications menu
#   ~/.local/share/icons/hicolor/512x512/apps/zinarix-studio.png
set -euo pipefail
# Remove launchers from the previous product name.
rm -f "$HOME/.local/bin/omnicode" "$HOME/.local/share/applications/omnicode.desktop" "$HOME/.local/share/icons/hicolor/512x512/apps/omnicode.png"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON="$APP_DIR/node_modules/electron/dist/electron"
[ -x "$ELECTRON" ] || { echo "Falta Electron: ejecuta 'pnpm install' en la raíz del repo." >&2; exit 1; }
[ -f "$APP_DIR/dist/main/main.js" ] || { echo "Falta compilar: ejecuta 'pnpm --filter @omni/desktop build'." >&2; exit 1; }

mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps" "$HOME/.local/share/icons/hicolor/scalable/apps"
cat > "$HOME/.local/bin/zinarix-studio" <<LAUNCHER
#!/usr/bin/env bash
# Opens Zinarix Studio detached from the terminal; GPU/driver chatter goes to a log.
# Use --foreground to keep it attached (useful for debugging).
LOG="\$HOME/.omni/logs/desktop.log"
mkdir -p "\$(dirname "\$LOG")"
if [ "\${1:-}" = "--foreground" ]; then
  shift
  exec "$ELECTRON" "$APP_DIR" "\$@"
fi
nohup "$ELECTRON" "$APP_DIR" "\$@" >>"\$LOG" 2>&1 </dev/null &
disown
LAUNCHER
chmod +x "$HOME/.local/bin/zinarix-studio"
# Vector icon (sharp at any size) plus a PNG fallback.
cp "$APP_DIR/build/logo.svg" "$HOME/.local/share/icons/hicolor/scalable/apps/zinarix-studio.svg"
if command -v rsvg-convert >/dev/null; then
  rsvg-convert -w 512 -h 512 "$APP_DIR/build/logo.svg" -o "$HOME/.local/share/icons/hicolor/512x512/apps/zinarix-studio.png"
else
  cp "$APP_DIR/build/icon.png" "$HOME/.local/share/icons/hicolor/512x512/apps/zinarix-studio.png"
fi
cat > "$HOME/.local/share/applications/zinarix-studio.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Zinarix Studio
GenericName=Editor de código con IA
Comment=Editor de código con cualquier modelo de IA
Exec=$HOME/.local/bin/zinarix-studio %F
Icon=zinarix-studio
Terminal=false
Categories=Development;IDE;TextEditor;
MimeType=inode/directory;text/plain;
StartupWMClass=Zinarix Studio
Keywords=code;editor;ia;ai;ide;
DESKTOP
update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
gtk-update-icon-cache "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
echo "Listo. Abre 'Zinarix Studio' desde el menú de aplicaciones o ejecuta: zinarix-studio [carpeta]"
