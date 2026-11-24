# Zinarix Studio para Linux

La app de escritorio completa para Linux. **Ya está lista**: se compila sola en cada versión y la firma (minisign) ya tiene sus secretos puestos. En Linux no hay que comprar ningún certificado.

- **Funciona en:** Linux de 64 bits (x86_64)
- **Archivos que salen:**
  - `Zinarix-Studio-<versión>-x86_64.AppImage` (cualquier distribución)
  - `zinarix-studio_<versión>_amd64.deb` (Ubuntu, Debian, Mint)
  - `zinarix-studio-<versión>-x64.pacman` (Arch, Manjaro)
- **Código:** [`apps/desktop`](../../apps/desktop) (el mismo de Windows y Mac; no se tocó)
- **Compilación automática:** `.github/workflows/release.yml`

## Estado

| Cosa                                     | Estado                                                            |
| ---------------------------------------- | ----------------------------------------------------------------- |
| AppImage, .deb y .pacman                 | Listos, en cada versión                                           |
| Llave de firma (minisign)                | Hecha: `C:\Users\<tú>\.zinarix-minisign\`                         |
| Secretos en GitHub                       | Puestos: `MINISIGN_SECRET_KEY`, `MINISIGN_PASSWORD`               |
| Llave pública dentro de los instaladores | Falta: paso 3 (se hace **después** de la primera versión firmada) |

## Cómo funciona la firma en Linux

En Linux no existe un "certificado de desarrollador" como en Windows o Mac. Lo que se firma es la lista de huellas de las descargas (`SHA256SUMS`) con tu llave **minisign**. El instalador (`install.sh`) trae tu llave pública y rechaza cualquier descarga que no coincida.

Tu llave pública es:

```
RWRNlLpnAVFVPbwX+65Ai62xCzzfoF/TyFUp833rESez866U0cJLYSAf
```

---

## Firmar y publicar, paso a paso

### Paso 1. Publicar una versión

Publica una versión (etiqueta `v…`, mira [`../LEEME.md`](../LEEME.md)). GitHub compila los tres paquetes, crea `SHA256SUMS`, lo firma (`SHA256SUMS.minisig`) y publica todo en Releases.

### Paso 2. Comprobar que salió firmada

```sh
gh release view --json assets --jq '.assets[].name' | grep SHA256SUMS
```

Deben salir `SHA256SUMS` **y** `SHA256SUMS.minisig`.

### Paso 3. Poner la llave pública en los instaladores (una sola vez)

Hazlo **solo después** del paso 2. Si lo haces antes, el instalador rechaza la versión anterior, que no tiene firma.

1. En `website/install.sh` cambia

   ```sh
   MINISIGN_PUBKEY="REPLACE_WITH_MINISIGN_PUBLIC_KEY"
   ```

   por

   ```sh
   MINISIGN_PUBKEY="RWRNlLpnAVFVPbwX+65Ai62xCzzfoF/TyFUp833rESez866U0cJLYSAf"
   ```

2. En `website/install.ps1` cambia `REPLACE_WITH_MINISIGN_PUBLIC_KEY` por la misma llave.
3. Guarda (commit), sube a GitHub y despliega el sitio (Vercel lo hace solo al subir).

Desde ahí, toda versión tiene que salir firmada: si falta el secreto, la publicación se detiene con un error en vez de publicar algo sin firma.

### Paso 4. Cómo la instalan tus usuarios

Con una línea (elige sola .deb, .pacman o AppImage):

```sh
curl -fsSL https://zinarix-studio.vercel.app/install.sh | sh
```

O descargando el archivo desde Releases:

| Sistema              | Comando                                                             |
| -------------------- | ------------------------------------------------------------------- |
| Ubuntu, Debian, Mint | `sudo apt install ./zinarix-studio_<versión>_amd64.deb`             |
| Arch, Manjaro        | `sudo pacman -U zinarix-studio-<versión>-x64.pacman`                |
| Cualquier otro       | `chmod +x Zinarix-Studio-*.AppImage && ./Zinarix-Studio-*.AppImage` |

### Paso 5. Comprobar una descarga a mano (opcional)

```sh
minisign -Vm SHA256SUMS -P RWRNlLpnAVFVPbwX+65Ai62xCzzfoF/TyFUp833rESez866U0cJLYSAf
sha256sum -c SHA256SUMS --ignore-missing
```

---

## Compilar en una computadora con Linux (opcional)

```sh
pnpm install
pnpm build
cd apps/desktop
node scripts/build-editions.mjs -- --linux AppImage deb pacman
```

Los paquetes quedan en `apps/desktop/release`.

## Tiendas de Linux (opcional, todavía no preparado)

Flathub, Snap Store y AUR son gratis, pero cada una pide su propio empaquetado y no están hechas. Las tres tienen el mismo problema que la Mac App Store en menor grado: Flatpak y Snap aíslan la app, y Zinarix necesita terminal y acceso a tus carpetas. La más sencilla sería **AUR** (un archivo `PKGBUILD` que baja el `.pacman` de Releases).

## Problemas comunes

| Mensaje                                                                                      | Solución                                                                                                                                                  |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `website/install.sh has a minisign public key but the MINISIGN_SECRET_KEY secret is not set` | Se borró el secreto: vuelve a subir `zinarix.key` y su contraseña.                                                                                        |
| El AppImage no abre                                                                          | Falta FUSE 2: `sudo apt install libfuse2` (Ubuntu/Debian), `fuse2` (Arch).                                                                                |
| El instalador dice que la firma no es válida                                                 | La llave de los instaladores no es la pareja del secreto. Revisa el paso 3.                                                                               |
| Perdiste `zinarix.key` o su contraseña                                                       | Crea una llave nueva, cambia los dos secretos y la llave pública de los dos instaladores, y vuelve a firmar la última versión (`.md/release-signing.md`). |

Guarda una copia de `C:\Users\<tú>\.zinarix-minisign\` en un lugar seguro.
