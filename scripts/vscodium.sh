#!/usr/bin/env bash
# Compila Zinarix Studio sobre VSCodium (VS Code libre: sin telemetria, Open VSX).
# Uso (Git Bash):  bash scripts/vscodium.sh [check|prepare|build|package]
#   check    comprueba herramientas requeridas
#   prepare  clona VSCodium en la revision fijada y aplica la marca Zinarix
#   build    prepare + descarga VS Code en el tag de VSCodium, aplica parches y compila
#   package  igual que build y ademas genera instaladores (necesita WiX en Windows)
set -euo pipefail

ACTION="${1:-build}"
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
VSCODIUM_DIR="${ROOT}/vendor/vscodium"
VSCODIUM_REPO="https://github.com/VSCodium/vscodium.git"
# Revision fijada de VSCodium (VS Code 1.143.1). Actualizar a proposito, no en cada build.
VSCODIUM_COMMIT="ca7f7b44b5e5c3faa663f6cdc043998f71936653"
OVERLAY="${ROOT}/config/code-oss/product.json"

# 7-Zip suele instalarse sin agregarse al PATH.
[[ -d "/c/Program Files/7-Zip" ]] && export PATH="${PATH}:/c/Program Files/7-Zip"

check() {
  local missing=0
  for tool in git node npm jq python3 7z cargo; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
      echo "Falta: ${tool}"; missing=1
    fi
  done
  if command -v node >/dev/null 2>&1 && [[ -f "${VSCODIUM_DIR}/.nvmrc" ]]; then
    local want have
    want="$( tr -d '\r\n ' < "${VSCODIUM_DIR}/.nvmrc" )"
    have="$( node -p 'process.versions.node' )"
    if [[ "${want%%.*}" != "${have%%.*}" ]]; then
      echo "Node ${have} instalado; VSCodium requiere Node ${want} (misma version mayor)."; missing=1
    fi
  fi
  if [[ "${OSTYPE}" == msys* || "${OSTYPE}" == cygwin* ]]; then
    local vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
    if [[ ! -x "${vswhere}" ]] || [[ -z "$( "${vswhere}" -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>/dev/null )" ]]; then
      echo "Faltan las herramientas C++ de Visual Studio (Desktop development with C++)."; missing=1
    fi
  fi
  if [[ "${missing}" == 1 ]]; then
    echo "Consulta docs/es/vscodium.md para instalar lo que falta."; return 1
  fi
  echo "Herramientas listas."
}

prepare() {
  if [[ ! -d "${VSCODIUM_DIR}/.git" ]]; then
    mkdir -p "${ROOT}/vendor"
    git clone "${VSCODIUM_REPO}" "${VSCODIUM_DIR}"
  fi
  cd "${VSCODIUM_DIR}"
  if [[ "$( git rev-parse HEAD )" != "${VSCODIUM_COMMIT}" ]]; then
    git fetch --depth 1 origin "${VSCODIUM_COMMIT}"
  fi
  # Restaura los archivos que modificamos para que prepare sea repetible.
  git checkout -q --force "${VSCODIUM_COMMIT}" -- .
  git checkout -q --detach "${VSCODIUM_COMMIT}"

  # VSCodium fusiona su product.json sobre el de VS Code al final de prepare_vscode.sh;
  # fusionamos aqui la marca Zinarix para que gane sobre los valores de VSCodium.
  node -e '
    const fs = require("fs");
    const [base, overlay] = process.argv.slice(1);
    const merge = (a, b) => {
      for (const [k, v] of Object.entries(b)) {
        a[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object"
          ? merge(a[k], v) : v;
      }
      return a;
    };
    const out = merge(JSON.parse(fs.readFileSync(base, "utf8")), JSON.parse(fs.readFileSync(overlay, "utf8")));
    fs.writeFileSync(base, JSON.stringify(out, null, 2) + "\n");
  ' "${VSCODIUM_DIR}/product.json" "${OVERLAY}"

  # Parches propios de Zinarix (se aplican despues de los de VSCodium).
  if compgen -G "${ROOT}/config/code-oss/patches/*.patch" >/dev/null; then
    mkdir -p patches/user
    cp "${ROOT}"/config/code-oss/patches/*.patch patches/user/
  fi

  # dev/build.sh fija la marca VSCodium; generamos una copia que respeta nuestras variables.
  sed -E 's/^export (APP_NAME|ASSETS_REPOSITORY|BINARY_NAME|GH_REPO_PATH|ORG_NAME)=.*$/: # \1 lo define Zinarix/' \
    dev/build.sh > dev/zinarix-build.sh
  echo "VSCodium preparado en ${VSCODIUM_DIR} con la marca Zinarix."
}

run_build() {
  check
  prepare
  cd "${VSCODIUM_DIR}"
  # Sin espacios: VSCodium lo usa en nombres de archivo. El nombre visible viene de product.json.
  export APP_NAME="Zinarix"
  export BINARY_NAME="zinarix-code"
  export ORG_NAME="Zinarix"
  export GH_REPO_PATH="abrahamtobal120-sudo/zinarix-studio"
  export ASSETS_REPOSITORY="abrahamtobal120-sudo/zinarix-studio"
  export GLOBAL_DIRNAME="zinarix-code"
  # Sin esto la app buscaria actualizaciones de VSCodium e instalaria VSCodium encima.
  export DISABLE_UPDATE="yes"
  if [[ "${ACTION}" == "package" ]]; then
    bash dev/zinarix-build.sh -p
  else
    bash dev/zinarix-build.sh
  fi
  echo "Compilado. Busca la app en ${VSCODIUM_DIR}/VSCode-* (por ejemplo VSCode-win32-x64)."
}

case "${ACTION}" in
  check) check ;;
  prepare) prepare ;;
  build | package) run_build ;;
  *) echo "Accion desconocida: ${ACTION}"; exit 2 ;;
esac
