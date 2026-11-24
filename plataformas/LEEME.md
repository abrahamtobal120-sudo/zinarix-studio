# Plataformas de Zinarix

Una carpeta por plataforma. Cada una tiene su `LEEME.md` con **cómo firmar y publicar, paso a paso**.

| Carpeta                        | Qué es                                                  | Dónde está el código                           | Se compila sola en GitHub           |
| ------------------------------ | ------------------------------------------------------- | ---------------------------------------------- | ----------------------------------- |
| [`ipad/`](ipad/LEEME.md)       | **Zinarix Studio para iPad** (App Store)                | `plataformas/ipad` + `plataformas/ios-comun`   | Sí: `.github/workflows/ios.yml`     |
| [`iphone/`](iphone/LEEME.md)   | **Zinarix Remote para iPhone** (App Store)              | `plataformas/iphone` + `plataformas/ios-comun` | Sí: `.github/workflows/ios.yml`     |
| [`android/`](android/LEEME.md) | **Zinarix Remote para Android** (APK y Google Play)     | `apps/remote-android`                          | Sí: `.github/workflows/release.yml` |
| [`mac/`](mac/LEEME.md)         | **Zinarix Studio para Mac** (.dmg)                      | `apps/desktop`                                 | Sí: `.github/workflows/release.yml` |
| [`linux/`](linux/LEEME.md)     | **Zinarix Studio para Linux** (AppImage, .deb, .pacman) | `apps/desktop`                                 | Sí: `.github/workflows/release.yml` |

La app de escritorio (`apps/desktop`) no se tocó: Windows, Mac y Linux salen del mismo código de siempre.

## Cómo se publica una versión (todas las plataformas a la vez)

1. Sube el número de versión en `package.json` y en `apps/desktop/package.json` (por ejemplo `0.6.6`).
2. Guarda los cambios (commit) y súbelos a GitHub.
3. Crea la etiqueta y súbela:

   ```sh
   git tag v0.6.6
   git push origin v0.6.6
   ```

4. GitHub compila todo solo (pestaña **Actions**):
   - **Release**: Windows, Mac, Linux y el APK de Android → quedan en la página de _Releases_.
   - **iOS**: las apps de iPhone y de iPad → se suben a TestFlight (si ya pusiste los secretos de Apple).

Lo que no tenga sus secretos puestos sale **sin firmar** (o no se sube), con un aviso amarillo en Actions. Nada se rompe.

## Qué cuenta necesitas para cada una

| Plataforma     | Cuenta                              | Costo          | Sirve también para |
| -------------- | ----------------------------------- | -------------- | ------------------ |
| iPad y iPhone  | Apple Developer Program             | 99 USD al año  | Mac                |
| Mac            | Apple Developer Program (la misma)  | —              | iPad y iPhone      |
| Android (APK)  | Ninguna (ya está firmado)           | Gratis         | —                  |
| Android (Play) | Google Play Console                 | 25 USD una vez | —                  |
| Linux          | Ninguna (firma minisign, ya puesta) | Gratis         | —                  |

Con **una sola cuenta de Apple (99 USD al año)** cubres iPad, iPhone y Mac.

## Secretos de GitHub (Settings → Secrets and variables → Actions)

| Secreto                                                                           | Para qué                                     | Estado     |
| --------------------------------------------------------------------------------- | -------------------------------------------- | ---------- |
| `MINISIGN_SECRET_KEY`, `MINISIGN_PASSWORD`                                        | Firma de las descargas (Linux, Mac, Windows) | Ya puestos |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`                            | Firma del APK de Android                     | Ya puestos |
| `APPLE_TEAM_ID`                                                                   | Mac, iPad y iPhone                           | Falta      |
| `APPSTORE_ISSUER_ID`, `APPSTORE_KEY_ID`, `APPSTORE_PRIVATE_KEY`                   | Subir iPad y iPhone a TestFlight             | Faltan     |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` | Firma y notarización de Mac                  | Faltan     |
