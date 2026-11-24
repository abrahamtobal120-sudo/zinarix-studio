# Zinarix Studio para Mac

La app de escritorio completa para macOS. **Ya se compila sola**; lo que falta es firmarla con tu cuenta de Apple para que la Mac no muestre el aviso de "desarrollador no identificado".

- **Identificador:** `dev.zinarix.studio`
- **Funciona en:** Mac con Apple Silicon (arm64) y con Intel (x64)
- **Archivos que salen:** `Zinarix-Studio-<versión>-arm64.dmg`, `…-x64.dmg` y los `.zip` (para las actualizaciones)
- **Código:** [`apps/desktop`](../../apps/desktop) (el mismo de Windows y Linux; no se tocó)
- **Compilación automática:** `.github/workflows/release.yml` (corre en una Mac de GitHub)

## Estado

| Cosa                                   | Estado                   |
| -------------------------------------- | ------------------------ |
| Compilación para Apple Silicon e Intel | Lista, en cada versión   |
| Firma de la descarga (minisign)        | Lista (secretos puestos) |
| Firma de Apple (Developer ID)          | Falta: pasos 1 a 4       |
| Notarización de Apple                  | Falta: paso 5            |

Sin la firma de Apple la app funciona, pero la primera vez hay que abrirla con clic derecho → **Abrir**.

**No necesitas una Mac** para ninguno de estos pasos.

---

## Firmar y publicar, paso a paso

### Paso 1. Cuenta de Apple Developer (99 USD al año)

<https://developer.apple.com/programs/enroll/> → paga → espera 1 o 2 días. Es la misma cuenta del iPad y del iPhone.

### Paso 2. Crear la solicitud del certificado (en tu PC)

Abre **Git Bash** en una carpeta **fuera del proyecto** (por ejemplo `C:\Users\<tú>\.zinarix-apple`) y corre, con tu correo y tu nombre:

```sh
mkdir -p ~/.zinarix-apple && cd ~/.zinarix-apple
openssl genrsa -out mac.key 2048
MSYS_NO_PATHCONV=1 openssl req -new -key mac.key -out mac.csr -subj "/emailAddress=tu@correo.com/CN=Tu Nombre/C=MX"
```

Quedan dos archivos: `mac.key` (tu llave secreta, **no la compartas**) y `mac.csr` (la solicitud).

### Paso 3. Pedir el certificado "Developer ID Application"

1. Entra a <https://developer.apple.com/account/resources/certificates/add>.
2. Elige **Developer ID Application** → Continue. (Solo el dueño de la cuenta lo puede crear.)
3. Perfil **G2 Sub-CA** → sube `mac.csr` → Continue → **Download**.
4. Guarda el archivo `developerID_application.cer` en la misma carpeta `.zinarix-apple`.

### Paso 4. Convertirlo y subirlo a GitHub

En Git Bash, en esa carpeta (inventa una contraseña y úsala en los dos lugares):

```sh
cd ~/.zinarix-apple
openssl x509 -inform DER -in developerID_application.cer -out mac.pem
openssl pkcs12 -export -legacy -inkey mac.key -in mac.pem -out mac.p12 -passout pass:TU_CONTRASEÑA
base64 -w0 mac.p12 | gh secret set MAC_CSC_LINK --repo abrahamtobal120-sudo/zinarix-studio
gh secret set MAC_CSC_KEY_PASSWORD --repo abrahamtobal120-sudo/zinarix-studio --body "TU_CONTRASEÑA"
```

(`-legacy` es necesario: macOS no lee el formato nuevo de OpenSSL 3.)

### Paso 5. Datos para la notarización

La notarización es la revisión automática de Apple; con ella desaparece el aviso por completo.

1. **Team ID**: <https://developer.apple.com/account> → **Membership details**.
2. **Contraseña de app**: <https://account.apple.com> → **Inicio de sesión y seguridad** → **Contraseñas de apps** → **+** → nombre `Zinarix notarizar` → copia la contraseña (`xxxx-xxxx-xxxx-xxxx`). Necesita la verificación en dos pasos activada.
3. Súbelos:

```sh
gh secret set APPLE_ID --body "tu@correo.com"
gh secret set APPLE_APP_SPECIFIC_PASSWORD --body "xxxx-xxxx-xxxx-xxxx"
gh secret set APPLE_TEAM_ID --body "A1B2C3D4E5"
```

### Paso 6. Publicar

Publica una versión (etiqueta `v…`, mira [`../LEEME.md`](../LEEME.md)). GitHub compila, **firma y notariza** los `.dmg` y los deja en la página de Releases. La notarización suma de 5 a 15 minutos.

### Paso 7. Comprobar

En el registro del trabajo de macOS (Actions → Release → build macos) debe aparecer `signing` y `notarization successful`, y **no** debe salir `macOS: signed but NOT notarized`.

Quien tenga una Mac lo puede comprobar así:

```sh
spctl --assess --type execute -vv "/Applications/Zinarix Studio.app"
# accepted · source=Notarized Developer ID
```

### Cómo la instalan tus usuarios

- Descargando el `.dmg` desde el sitio o desde Releases, o
- con una línea en la Terminal:

  ```sh
  curl -fsSL https://zinarix-studio.vercel.app/install.sh | sh
  ```

---

## Mac App Store

Zinarix Studio **no puede** ir en la Mac App Store: Apple exige ahí el "sandbox", que prohíbe la terminal, instalar programas y controlar la computadora. Se reparte por tu sitio con Developer ID, igual que VS Code o Cursor.

## Problemas comunes

| Mensaje                                             | Solución                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `macOS: signed but NOT notarized`                   | Falta alguno de los tres secretos del paso 5.                                         |
| `MAC verify error` / no se puede importar el `.p12` | Faltó `-legacy` en el paso 4, o la contraseña no coincide con `MAC_CSC_KEY_PASSWORD`. |
| `Unable to authenticate` / error 401 al notarizar   | La contraseña de app es incorrecta o se revocó: crea otra (paso 5).                   |
| `You must first sign the relevant contracts online` | Entra a developer.apple.com y acepta el acuerdo nuevo.                                |
| El certificado venció (dura 5 años)                 | Repite los pasos 2 a 4. Las apps ya firmadas siguen funcionando.                      |

Guarda una copia de la carpeta `.zinarix-apple` (llave, certificado y contraseña) en un lugar seguro.

Detalle técnico: [`.md/release-signing.md`](../../.md/release-signing.md) y `apps/desktop/scripts/build-editions.mjs` (`withSigning`).
