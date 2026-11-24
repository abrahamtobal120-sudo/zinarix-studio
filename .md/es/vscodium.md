# Zinarix Studio sobre VSCodium

[VSCodium](https://github.com/VSCodium/vscodium) toma el codigo abierto de VS Code (licencia MIT), le quita la telemetria y la marca de Microsoft, y usa [Open VSX](https://open-vsx.org) como tienda de extensiones. Esta variante compila esa misma base con la marca Zinarix.

Esto reemplaza el uso directo de `vendor/vscode-main` (`pnpm code:*`): aquel ZIP era la rama `main` sin fijar, mientras que VSCodium fija una version estable de VS Code y sus parches estan probados contra ella.

## Que hace el script

`scripts/vscodium.sh` (lanzado por `pnpm codium:*`):

1. Clona VSCodium en `vendor/vscodium` en la revision fijada en `VSCODIUM_COMMIT` (hoy VS Code 1.143.1).
2. Fusiona `config/code-oss/product.json` (nombre, carpeta de datos, protocolo e IDs de instalador propios) sobre el `product.json` de VSCodium.
3. Copia los parches de `config/code-oss/patches/*.patch`, si hay, a `patches/user/`. Se aplican despues de los de VSCodium.
4. Descarga VS Code en el tag fijado, aplica los parches y compila con `APP_NAME=Zinarix`, `BINARY_NAME=zinarix-code` y las actualizaciones automaticas desactivadas (`DISABLE_UPDATE=yes`). Si quedaran activas, la app instalaria VSCodium encima.

## Requisitos en Windows

| Herramienta                                | Instalacion                                                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node **24** (ver `vendor/vscodium/.nvmrc`) | `winget install CoreyButler.NVMforWindows`, despues `nvm install 24.18.0` y `nvm use 24.18.0`                                                            |
| jq                                         | `winget install jqlang.jq -e`                                                                                                                            |
| 7-Zip                                      | ya instalado; el script lo agrega al PATH                                                                                                                |
| Python 3.11                                | ya instalado                                                                                                                                             |
| Rust (cargo)                               | ya instalado                                                                                                                                             |
| Visual Studio Build Tools con C++          | `winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"` |
| WiX v3 (solo `codium:package`)             | https://wixtoolset.org/releases/                                                                                                                         |

Node 26 no sirve: los modulos nativos de VS Code se compilan para Node 24. Zinarix (`apps/desktop`) pide Node >= 24.7, asi que con Node 24 funcionan los dos.

## Comandos

```powershell
pnpm codium:check     # comprueba requisitos
pnpm codium:prepare   # clona y aplica la marca (no compila)
pnpm codium:build     # compila; la app queda en vendor/vscodium/VSCode-win32-x64
pnpm codium:package   # compila y genera instaladores
```

La primera compilacion tarda (de 30 a 60 minutos) y descarga varios GB. Smart App Control de Windows puede bloquear el ejecutable sin firmar.

## Siguiente etapa: llevar las funciones de Zinarix

VSCodium solo es la base del editor. Los modelos de IA, el chat con aprobaciones, el navegador, el correo y las integraciones de `apps/desktop` todavia no estan dentro. El plan sigue siendo el de [code-oss.md](code-oss.md): primero una extension integrada (`extensions/zinarix`) que use `packages/providers`, `packages/core` y `packages/security`, y cambios al workbench solo donde haga falta. Una extension integrada se agrega como parche en `config/code-oss/patches/` o copiandola a `vscode/extensions/` antes de compilar.

## Licencias

El codigo de VS Code y de VSCodium es MIT; conserva sus avisos de licencia. Open VSX tiene sus propias condiciones; el Marketplace de Microsoft no puede usarse desde esta variante. Los iconos actuales son los de VSCodium: hay que sustituirlos (`vendor/vscodium/icons`, o con un parche) antes de distribuir.
