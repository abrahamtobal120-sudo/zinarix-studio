# Zinarix Studio para iPad

Zinarix Studio en el iPad, como **otra sesión** de tu computadora: el iPad muestra y maneja el Zinarix de tu PC o Mac (chats, agentes, aprobaciones, archivos, terminal, Git).

- **Nombre:** Zinarix Studio
- **Identificador (bundle ID):** `com.zinarix.studio.ipad`
- **Funciona en:** solo iPad, con iPadOS 16 o más nuevo
- **Código:** esta carpeta + [`../ios-comun`](../ios-comun/LEEME.md)
- **Compilación automática:** `.github/workflows/ios.yml`

## Qué tiene de especial en iPad

- **Barra lateral** con tus computadoras y el panel al lado.
- **Varias ventanas** (botón de ventanas, o ⌘N con teclado): dos computadoras, o dos chats de la misma, lado a lado con Split View o Stage Manager. Cada ventana es su propia sesión.
- Atajos de teclado: **⌘R** recargar, **⌘N** ventana nueva.
- El chat se centra con un ancho cómodo en pantallas grandes.
- Escanear el QR, bloqueo con Face ID / Touch ID, avisos y reconexión automática, igual que en iPhone.

## Lo que debes saber (límites)

- **El trabajo lo hace tu computadora.** Tiene que estar prendida, con Zinarix Studio abierto y el control a distancia encendido (Configuración → Celular). El iPad es la pantalla y el teclado.
- El Zinarix Studio de escritorio completo (Electron) no puede instalarse en un iPad: Apple no permite apps que abran una terminal real o instalen programas. Por eso esta app se conecta a tu computadora.
- "Controlar la compu" y el navegador integrado se quedan solo en la computadora.
- La app de escritorio **no se cambió**.

---

## Firmar y publicar, paso a paso

Los pasos 1 a 4 son **los mismos que en el iPhone** y se hacen una sola vez para las dos apps. Si ya los hiciste, empieza en el paso 5.

### Paso 1. Cuenta de Apple Developer (99 USD al año)

<https://developer.apple.com/programs/enroll/> → paga → espera 1 o 2 días.

### Paso 2. Tu Team ID

<https://developer.apple.com/account> → **Membership details** → copia el **Team ID**.

### Paso 3. Llave para que GitHub suba la app

<https://appstoreconnect.apple.com> → **Users and Access** → **Integrations** → **App Store Connect API** → **Generate API Key** con acceso **Admin**. Apunta el **Issuer ID** y el **Key ID**, y baja el archivo `AuthKey_XXXXXXXXXX.p8` (solo se puede una vez).

### Paso 4. Secretos en GitHub

```sh
gh secret set APPLE_TEAM_ID --body "A1B2C3D4E5"
gh secret set APPSTORE_ISSUER_ID --body "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
gh secret set APPSTORE_KEY_ID --body "XXXXXXXXXX"
gh secret set APPSTORE_PRIVATE_KEY < "C:\ruta\a\AuthKey_XXXXXXXXXX.p8"
```

### Paso 5. Registrar tu iPad (una vez)

1. Conecta el iPad a la PC y abre **Dispositivos Apple** (o iTunes). Haz clic en el número de serie hasta que diga **UDID** y cópialo.
2. <https://developer.apple.com/account/resources/devices/list> → **+** → pega el UDID.

### Paso 6. Crear la ficha de la app

1. <https://developer.apple.com/account/resources/identifiers/list> → **+** → **App IDs** → **App** → Bundle ID **Explicit**: `com.zinarix.studio.ipad` → Register.
2. <https://appstoreconnect.apple.com/apps> → **+** → **New App**:
   - Platform: **iOS**
   - Name: `Zinarix Studio` (si está ocupado: `Zinarix Studio para iPad`)
   - Primary language: Spanish (Mexico)
   - Bundle ID: `com.zinarix.studio.ipad`
   - SKU: `zinarix-studio-ipad`

### Paso 7. Compilar, firmar y subir

- Con una versión nueva (etiqueta `v…`, mira [`../LEEME.md`](../LEEME.md)) se sube sola.
- O a mano: GitHub → **Actions** → **iOS** → **Run workflow** → marca **subir**.

  ```sh
  gh workflow run ios.yml -f subir=true
  ```

El mismo workflow sube las dos apps (iPhone y iPad). Si una todavía no tiene su ficha (paso 6), esa falla y la otra sube bien.

### Paso 8. Probarla en tu iPad (TestFlight)

1. App Store Connect → tu app → **TestFlight** → **Internal Testing** → crea un grupo y agrégate.
2. En el iPad instala **TestFlight** desde la App Store y entra con tu Apple ID.
3. Instala Zinarix Studio. En la computadora abre Configuración → Celular y escanea el QR desde el iPad.

### Paso 9. Mandarla a la App Store

App Store Connect → tu app → **Distribution**:

1. **Capturas** de iPad de 13" (2064 × 2752 px, o 2048 × 2732 px). Tómalas en tu iPad desde TestFlight.
2. **Descripción**, palabras clave, URL de soporte y categoría (**Developer Tools**).
3. **App Privacy** → **Data Not Collected**, con la URL de tu política de privacidad.
4. Elige la **compilación**.
5. **App Review Information → Notes** (muy importante, el revisor no tiene tu computadora):
   - explica que la app es la pantalla de Zinarix Studio (programa de escritorio gratis, con la liga de descarga);
   - deja **un enlace de prueba que funcione** durante la revisión (una computadora con Zinarix abierto: el enlace de "Desde cualquier lugar" y el PIN);
   - o un video corto de la app funcionando.
6. **Add for Review** → **Submit**. Tarda normalmente de 1 a 3 días.

### Paso 10. Actualizaciones

Cada etiqueta `v…` sube una compilación nueva. Para publicarla: **+ Version** → elige la compilación → **Submit**.

---

## Nota: dos apps o una sola

Hoy hay dos apps separadas, como pediste: **Zinarix Studio** (solo iPad) y **Zinarix Remote** (solo iPhone). Apple a veces rechaza dos apps muy parecidas del mismo desarrollador (regla 4.3). Si pasa, la solución es fácil: publicar **una sola app universal**. En `plataformas/iphone/project.yml` cambia `TARGETED_DEVICE_FAMILY: '1'` por `'1,2'` y en `App/Variante.swift` pon:

```swift
import UIKit

enum Variante {
    static var esIPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    static let nombre = "Zinarix Remote"
}
```

Con eso la app del iPhone también trae la vista de iPad (barra lateral y varias ventanas; para las ventanas pon además `UIApplicationSupportsMultipleScenes: true` y agrega `UIInterfaceOrientationPortraitUpsideDown`).

## Problemas comunes

Los mismos que en el iPhone: mira la tabla de [`../iphone/LEEME.md`](../iphone/LEEME.md#problemas-comunes) (cambia `com.zinarix.remote` por `com.zinarix.studio.ipad`).

## Compilar en una Mac (opcional)

```sh
brew install xcodegen
cd plataformas/ipad
xcodegen generate
open ZinarixStudioPad.xcodeproj
```
