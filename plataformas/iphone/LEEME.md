# Zinarix Remote para iPhone

La misma idea que la app de Android: desde el iPhone ves y manejas el Zinarix Studio de tu computadora (chats, agentes, aprobaciones, archivos, terminal).

- **Nombre:** Zinarix Remote
- **Identificador (bundle ID):** `com.zinarix.remote`
- **Funciona en:** iPhone con iOS 16 o más nuevo
- **Código:** esta carpeta + [`../ios-comun`](../ios-comun/LEEME.md)
- **Compilación automática:** `.github/workflows/ios.yml`

## Qué hace

- Agregar la computadora **escaneando el QR** de Zinarix Studio (Configuración → Celular), pegando el enlace o escribiéndolo.
- Guarda hasta 10 computadoras; se renombran u olvidan deslizando la fila.
- Bloqueo con **Face ID, Touch ID o código**.
- Avisos cuando la IA pide permiso o termina (mientras la app sigue abierta o recién minimizada; iOS duerme las apps en segundo plano).
- Si la computadora no responde, se reconecta sola.

Límite: la computadora tiene que estar prendida con Zinarix Studio abierto y el control a distancia encendido.

## No necesitas una Mac

GitHub compila, firma y sube la app con sus Mac en la nube. Tú solo pones los datos de tu cuenta de Apple una vez.

---

## Firmar y publicar, paso a paso

### Paso 1. Cuenta de Apple Developer (99 USD al año)

1. Entra a <https://developer.apple.com/programs/enroll/> con tu Apple ID.
2. Elige **Individual** (persona) o **Organization** (empresa; pide número D-U-N-S).
3. Paga. Apple tarda de 1 a 2 días en aprobar.

Esta misma cuenta sirve para el iPad y para firmar la versión de Mac.

### Paso 2. Tu Team ID

1. Entra a <https://developer.apple.com/account>.
2. Baja a **Membership details** y copia el **Team ID** (10 letras y números, por ejemplo `A1B2C3D4E5`).

### Paso 3. Llave para que GitHub suba la app

1. Entra a <https://appstoreconnect.apple.com> → **Users and Access** → pestaña **Integrations** → **App Store Connect API**.
2. Pulsa **Generate API Key** (la primera vez pide aceptar el acceso).
   - Nombre: `GitHub`
   - Acceso: **Admin** (hace falta para que Apple cree los certificados solo).
3. Apunta el **Issuer ID** (arriba de la lista) y el **Key ID** (en la fila de la llave).
4. Pulsa **Download** y guarda el archivo `AuthKey_XXXXXXXXXX.p8`. **Solo se puede bajar una vez.** Guárdalo fuera del proyecto, junto con tus otras llaves.

### Paso 4. Poner los secretos en GitHub

En una terminal, dentro de la carpeta del proyecto (cambia los valores por los tuyos):

```sh
gh secret set APPLE_TEAM_ID --body "A1B2C3D4E5"
gh secret set APPSTORE_ISSUER_ID --body "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
gh secret set APPSTORE_KEY_ID --body "XXXXXXXXXX"
gh secret set APPSTORE_PRIVATE_KEY < "C:\ruta\a\AuthKey_XXXXXXXXXX.p8"
```

(O a mano: GitHub → **Settings → Secrets and variables → Actions → New repository secret**. En `APPSTORE_PRIVATE_KEY` pega todo el contenido del archivo `.p8`.)

### Paso 5. Registrar tu iPhone (una vez)

Apple necesita al menos un dispositivo registrado para crear los perfiles de firma.

1. Conecta el iPhone a la PC y abre **Dispositivos Apple** (o iTunes). Haz clic en el número de serie hasta que diga **UDID** y cópialo.
2. Entra a <https://developer.apple.com/account/resources/devices/list> → **+** → pega el UDID.

### Paso 6. Crear la ficha de la app

1. Entra a <https://developer.apple.com/account/resources/identifiers/list> → **+** → **App IDs** → **App** → Bundle ID **Explicit**: `com.zinarix.remote` → Register.
2. Entra a <https://appstoreconnect.apple.com/apps> → **+** → **New App**:
   - Platform: **iOS**
   - Name: `Zinarix Remote` (si ya está ocupado, prueba `Zinarix Remote: control de IA`)
   - Primary language: Spanish (Mexico)
   - Bundle ID: `com.zinarix.remote`
   - SKU: `zinarix-remote`

### Paso 7. Compilar, firmar y subir

Dos maneras:

- **Con una versión nueva:** al subir una etiqueta `v…` (mira [`../LEEME.md`](../LEEME.md)) se sube sola.
- **Sin versión nueva:** GitHub → **Actions** → **iOS** → **Run workflow** → marca **subir** → Run.

  ```sh
  gh workflow run ios.yml -f subir=true
  ```

En 10 a 20 minutos la compilación aparece en App Store Connect → tu app → **TestFlight** (primero dice "Processing").

### Paso 8. Probarla en tu iPhone (TestFlight)

1. En App Store Connect → **TestFlight** → **Internal Testing** → **+** → crea un grupo y agrégate.
2. En el iPhone instala la app **TestFlight** desde la App Store y entra con tu Apple ID.
3. Instala Zinarix Remote y pruébala con tu computadora.

### Paso 9. Mandarla a la App Store

En App Store Connect → tu app → pestaña **Distribution**:

1. **Capturas de pantalla** de iPhone de 6.9" (1320 × 2868 px). Tómalas en tu iPhone desde TestFlight; si tu iPhone es de otro tamaño, Apple acepta también 6.5" (1284 × 2778 px).
2. **Descripción**, palabras clave, URL de soporte (`https://zinarix-studio.vercel.app`) y categoría (**Developer Tools** o **Productivity**).
3. **App Privacy**: la app no recoge datos → elige **Data Not Collected**. Pon una URL de política de privacidad (una página en tu sitio que lo diga).
4. **Build**: elige la compilación que subiste.
5. **App Review Information** (muy importante): el revisor de Apple no tiene tu computadora. Escribe en **Notes**:
   - que la app es el control a distancia de Zinarix Studio (programa gratis para Windows, Mac y Linux, con la liga de descarga);
   - **un enlace de prueba que funcione** mientras dure la revisión: deja una computadora con Zinarix Studio abierto, copia el enlace de "Desde cualquier lugar" y el PIN de emparejamiento, y pégalos ahí;
   - o un video corto que muestre la app funcionando.
6. Pulsa **Add for Review** → **Submit**. La revisión tarda normalmente de 1 a 3 días.

### Paso 10. Actualizaciones

Cada versión nueva (etiqueta `v…`) sube una compilación nueva a TestFlight. Para publicarla: App Store Connect → **+ Version** → elige la compilación → **Submit**.

---

## Problemas comunes

| Mensaje                                                                  | Solución                                                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Aviso amarillo "APPSTORE\_… are not all set"                             | Falta algún secreto del paso 4.                                                                                     |
| `There are no devices registered in your account`                        | Haz el paso 5.                                                                                                      |
| `No profiles for 'com.zinarix.remote' were found` o error de permisos    | La llave del paso 3 no es **Admin**: crea otra con ese acceso.                                                      |
| `No suitable application records were found`                             | Falta la ficha del paso 6, o el Bundle ID no coincide.                                                              |
| `The bundle version must be higher than the previously uploaded version` | Vuelve a correr el workflow (usa un número nuevo cada vez).                                                         |
| Apple rechaza por "minimum functionality" (4.2)                          | Responde explicando que es el control a distancia de un programa de escritorio, con el enlace de prueba y el video. |
| Apple rechaza por apps repetidas (4.3)                                   | Mira la nota de [`../ipad/LEEME.md`](../ipad/LEEME.md) sobre publicar una sola app universal.                       |

## Compilar en una Mac (opcional)

```sh
brew install xcodegen
cd plataformas/iphone
xcodegen generate
open ZinarixRemote.xcodeproj
```

En Xcode elige tu equipo en **Signing & Capabilities** y pulsa ▶ con tu iPhone conectado.
