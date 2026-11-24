# Zinarix Remote para Android

La app para manejar Zinarix Studio desde el celular Android. **Ya está lista y firmada.**

- **Nombre:** Zinarix Remote
- **Identificador (package):** `com.zinarix.remote`
- **Funciona en:** Android 8 o más nuevo
- **Código:** [`apps/remote-android`](../../apps/remote-android) (no se movió, para no romper la compilación)
- **Compilación automática:** `.github/workflows/release.yml` (trabajo `android`)

## Estado

| Cosa                                 | Estado                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------- |
| Llave de firma                       | Hecha: `C:\Users\<tú>\.zinarix-android\zinarix-remote.jks` + `password.txt` |
| Secretos en GitHub                   | Puestos: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`             |
| APK firmado en cada versión          | Automático: `Zinarix-Remote.apk` en la página de Releases                   |
| Enlaces que abren la app (App Links) | Listo: `website/.well-known/assetlinks.json`                                |
| Google Play                          | Falta: necesitas la cuenta (pasos de abajo)                                 |

> **Guarda una copia de la carpeta `.zinarix-android`** (USB o gestor de contraseñas). Android solo instala actualizaciones firmadas con la misma llave: si la pierdes, nadie puede actualizar la app.

---

## A. Publicar el APK (gratis, ya funciona)

1. Publica una versión (etiqueta `v…`, mira [`../LEEME.md`](../LEEME.md)).
2. GitHub compila y firma `Zinarix-Remote.apk` y lo deja en la versión.
3. La liga fija para descargarlo es:
   `https://github.com/abrahamtobal120-sudo/zinarix-studio/releases/latest/download/Zinarix-Remote.apk`
   (Zinarix Studio ya la muestra en Configuración → Celular.)

Para compilarlo en tu PC:

```sh
node apps/desktop/scripts/build-remote-apk.mjs
```

Quien lo instala tiene que permitir "instalar apps de orígenes desconocidos". Para quitar ese paso, publícalo en Google Play.

---

## B. Publicar en Google Play, paso a paso

### Paso 1. Cuenta de Google Play Console (25 USD, un solo pago)

1. Entra a <https://play.google.com/console/signup>.
2. Elige cuenta **personal** o de **organización**, paga y verifica tu identidad (INE o pasaporte). Tarda unos días.

### Paso 2. Crear la app

1. Play Console → **Crear app**.
2. Nombre: `Zinarix Remote` · Idioma: Español (Latinoamérica) · **App** · **Gratis**.
3. Acepta las declaraciones.

### Paso 3. Compilar el archivo para Play (.aab)

Google Play pide un `.aab` en lugar del `.apk`. En la carpeta del proyecto:

```powershell
pwsh plataformas/android/compilar-aab.ps1
```

Deja `plataformas/android/Zinarix-Remote.aab`, firmado con tu llave.

### Paso 4. Firma de apps de Play

1. Play Console → tu app → **Probar y publicar → Configuración → Firma de apps**.
2. Elige **Usar una llave generada por Google** (lo recomendado). Tu llave `zinarix-remote.jks` queda como **llave de subida**.
3. Copia la **huella SHA-256 del certificado de firma de apps** que te muestra Google y agrégala en `website/.well-known/assetlinks.json` (dentro de `sha256_cert_fingerprints`, junto a la que ya está). Despliega el sitio. Sin esto, los enlaces del QR abren el navegador en vez de la app instalada desde Play.

### Paso 5. Llenar la ficha

En **Presencia en Play Store → Ficha principal**:

- Descripción corta y completa.
- Ícono de 512 × 512 px (sale de `apps/desktop/build/icon.png`).
- Gráfico destacado de 1024 × 500 px.
- Al menos 2 capturas de pantalla del celular.

En **Política y programas → Contenido de la app**:

- **Política de privacidad**: URL de una página de tu sitio.
- **Seguridad de los datos**: la app no recoge ni comparte datos.
- **Clasificación de contenido**: llena el cuestionario (herramienta/utilidad).
- **Público objetivo**: 18 años o más.
- **Anuncios**: no tiene.
- **Acceso a la app**: indica que necesita Zinarix Studio en una computadora y deja un enlace de prueba con su PIN para el revisor.

### Paso 6. Prueba cerrada (obligatoria en cuentas personales nuevas)

Google pide a las cuentas personales nuevas una **prueba cerrada con al menos 12 personas durante 14 días** antes de publicar.

1. **Probar y publicar → Pruebas → Prueba cerrada → Crear versión**.
2. Sube `Zinarix-Remote.aab`.
3. Agrega los correos de tus 12 testers y mándales la liga de invitación.
4. Espera 14 días con los testers dentro.

(Las cuentas de organización se saltan este paso.)

### Paso 7. Producción

1. **Probar y publicar → Producción → Crear versión** → sube el `.aab` (o promueve el de la prueba).
2. Elige países → **Enviar a revisión**. La primera revisión tarda de 1 a 7 días.

### Paso 8. Actualizaciones

Por cada versión nueva: `pwsh plataformas/android/compilar-aab.ps1` → Producción → **Crear versión** → sube el `.aab`. El número interno (`versionCode`) sale solo de la versión de `package.json`, así que siempre sube.

---

## Problemas comunes

| Mensaje                                                         | Solución                                                                                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| "El código de versión ya se usó"                                | Sube la versión en `package.json` antes de compilar.                                                                                |
| "Tu app debe orientarse al nivel de API …"                      | Google subió el mínimo: hay que cambiar `targetSdk` y `compileSdk` en `apps/remote-android/app/build.gradle`.                       |
| "El paquete no está firmado con la llave de subida correcta"    | Se compiló con otra llave: revisa que exista `.zinarix-android\zinarix-remote.jks`.                                                 |
| Aviso amarillo en GitHub "ANDROID\_KEYSTORE\_BASE64 is not set" | Se borró el secreto. Vuelve a ponerlo: `base64 -w0 ~/.zinarix-android/zinarix-remote.jks \| gh secret set ANDROID_KEYSTORE_BASE64`. |
