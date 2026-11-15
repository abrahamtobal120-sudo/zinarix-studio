# Vender Zinarix Studio: cobro, licencias, avisos y versiones nuevas

Todo se controla con **un archivo**: `website/app-config.json`. Cada app instalada lo lee al abrir
y cada 6 horas desde `https://zinarix-studio.vercel.app/app-config.json`. Cambias el archivo,
**lo firmas** (`pnpm config:sign`, ver abajo), publicas la página (Vercel lo hace solo al subir
a GitHub) y en unas horas todas las apps ya
instaladas lo obedecen, sin reinstalar nada.

No hay servidores ni bases de datos que pagar: la página es estática en Vercel (gratis), las
licencias se revisan dentro de la app sin internet y Stripe solo cobra su comisión por venta.

## Hoy: todo gratis

```json
"billing": false
```

Con `billing` en `false` nadie paga y nada se limita: chats ilimitados, dos a la par, varias
ventanas y todos los agentes. La app no muestra nada de planes ni de compras.

## El día que quieras cobrar

1. Edita `website/app-config.json`:
   ```json
   "billing": true,
   "trialDays": 14,
   "free": { "maxChats": 2, "split": false, "windows": false },
   "price": "US$29",
   "priceNote": "pago único · actualizaciones incluidas",
   "stripeLink": "https://buy.stripe.com/…"
   ```
2. Fírmalo: `ZINARIX_LICENSE_KEY=…/license-private.pem pnpm config:sign` (escribe
   `website/app-config.json.sig`). Sin una firma válida las apps instaladas **ignoran** el
   archivo y siguen con el último bueno: así nadie puede apagar el cobro con un archivo falso o
   un proxy. La variable `ZINARIX_CONFIG_URL` solo funciona en copias de desarrollo.
3. Sube los dos archivos a GitHub (`git commit` + `git push`). Vercel publica la página.
4. Cada copia instalada, en cuanto lee el archivo, empieza **su** prueba de `trialDays` días con
   todo (aunque la hayan usado gratis meses: la prueba cuenta desde que ve el cobro encendido).
   Al terminar queda en el plan gratis (`free`) hasta que active una licencia.

Lo que **nunca** se cobra, ni en el plan gratis: el editor, cualquier IA, el modo agente
(archivos, terminal, navegador, clics) y que una IA le pase trabajo a otra con tu permiso. Pro
solo agrega **más a la vez**: más chats trabajando en paralelo, dos chats a la par y varias
ventanas.

Para volver a dejarlo gratis: `"billing": false` y publicar.

## Tu licencia de dueño

Ya no hay palabra de dueño ni códigos de plan (se podían adivinar o leer en el código). Hazte una
licencia firmada con tu llave privada:

```bash
ZINARIX_LICENSE_KEY=~/Desktop/zinarix-licencias-PRIVADO/license-private.pem   node scripts/license.mjs issue tu@correo.com --owner
```

Pégala en **Ayuda → Plan y licencia…**. Esa copia queda como "Dueño": todo, en cualquier
edición, sin importar el cobro. Para probar un plan, hazte una clave de ese plan con `--days 1`.

> El código es público (licencia MIT). Quien quiera puede quitar el cobro y compilar su propia
> copia; lo que ya no se puede es activar planes en las apps oficiales sin una clave firmada.

## Cobrar con Stripe (las licencias se entregan solas)

1. Crea una cuenta en [stripe.com](https://stripe.com) (México incluido). Sin mensualidad.
2. **Productos → Crear producto** "Zinarix Studio Pro", pago único (o suscripción anual).
3. **Payment Links → Crear**. En "Después del pago" elige "No mostrar página de confirmación,
   redirigir a tu sitio" y pon:
   ```
   https://zinarix-studio.vercel.app/gracias?session_id={CHECKOUT_SESSION_ID}
   ```
   Opcional: en los metadatos del enlace pon `days` = `365` para que la licencia dure un año
   (sin `days` no vence nunca).
4. En **Vercel → tu proyecto → Settings → Environment Variables** agrega:
   - `STRIPE_SECRET_KEY`: tu clave secreta de Stripe (`sk_live_…`; mejor una "restricted key"
     con permiso solo de lectura de Checkout Sessions).
   - `LICENSE_PRIVATE_KEY`: el contenido completo de `license-private.pem` (la llave privada que
     se te entregó **fuera** del repo, en la carpeta `zinarix-licencias-PRIVADO`).
   - `STRIPE_PAYMENT_LINK`: el id `plink_…` del enlace de Pro.
   - `STRIPE_LINK_AI` y `STRIPE_LINK_PROAI`: los `plink_…` de los enlaces de AI y Pro + AI; esas
     compras dan una clave de ese plan. **Hace falta al menos un enlace**: sin ninguno, la página
     no entrega claves (antes cualquier compra en tu cuenta de Stripe daba una clave Pro).
   - `LICENSE_CLAIM_HOURS` (opcional, 72 por omisión): cuántas horas después de pagar se puede
     volver a sacar la clave con el enlace de `/gracias`. Después, el cliente te escribe.
   - En **Vercel → Firewall** agrega una regla de límite de peticiones para `/api/license`
     (la función ya limita por IP, pero solo dentro de cada instancia).
5. Pega el enlace de pago en `stripeLink` de `website/app-config.json` y publica.

El cliente paga → Stripe lo manda a `/gracias` → la página pide la licencia a `/api/license`
(que revisa con Stripe que el pago esté hecho y la firma con tu llave privada) → el cliente la
copia y la pega en **Ayuda → Plan y licencia…**. La misma compra siempre da la misma clave, así
que puede volver a la página si la pierde (durante `LICENSE_CLAIM_HOURS`).

## Reembolsos y disputas

`/api/license` revisa el cargo en Stripe: si se reembolsó (total o parcial) o está en disputa,
no entrega la clave. Para apagar una clave que ya se entregó, agrega su id (el `session_id`
`cs_live_…` de la compra) a `"revoked"` en `website/app-config.json`, fírmalo y publícalo: las
apps instaladas la desactivan al leer el archivo, y la página ya no la vuelve a dar.

## Licencias a mano (regalos, pagos por transferencia)

```bash
ZINARIX_LICENSE_KEY=~/Desktop/zinarix-licencias-PRIVADO/license-private.pem \
  node scripts/license.mjs issue cliente@correo.com --name "Nombre" --days 365
```

Imprime la clave `ZX1.…` para mandarla por correo. Sin `--days` no vence.
`node scripts/license.mjs verify <clave>` muestra de quién es y si es válida.

**Cuida la llave privada**: con ella cualquiera puede hacer licencias. Nunca la subas a GitHub
(el `.gitignore` ya bloquea `*private*.pem` y `*.key`). Si la pierdes no podrás hacer más
licencias que la app acepte; guarda una copia en un lugar seguro.

## Avisos a todas las apps instaladas

```json
"notice": {
  "id": "promo-noviembre",
  "text": "¡Nuevo! Ya puedes usar Claude y GPT en el mismo chat.",
  "url": "https://zinarix-studio.vercel.app/#funciones"
}
```

Cada app lo muestra una vez arriba de la ventana, con "Ver más" si pones `url`. Para mandar
otro aviso cambia el `id`. Para quitarlo, borra `notice`.

## Versiones nuevas

1. Sube el número en `apps/desktop/package.json` (`"version": "0.6.0"`).
2. `git commit -am "v0.6.0" && git tag v0.6.0 && git push && git push --tags`
3. GitHub Actions compila los instaladores de Windows, Mac y Linux y los publica.

Las apps instaladas en **Windows y Linux** la descargan solas y muestran "Reiniciar para
actualizar". En **Mac** (sin firma de Apple) muestran "Hay una versión nueva" con el botón
Descargar. Para avisar también a copias viejas sin actualizador, pon en `app-config.json`:

```json
"latestVersion": "0.6.0",
"downloadUrl": "https://zinarix-studio.vercel.app/#descargar"
```

Además, **Ayuda → Buscar actualizaciones** revisa en el momento, y al abrir una versión nueva la
app muestra "Novedades de esta versión" una sola vez.

## Costos

- Vercel (página, `app-config.json`, `/api/license`): plan gratis.
- GitHub (código, instaladores, actualizaciones): gratis en repos públicos.
- Stripe: solo su comisión por cada venta.
- Opcional, cuesta dinero y no hace falta para vender: firma de código de Apple (US$99/año, quita
  el aviso de "desarrollador no identificado" y habilita la actualización automática en Mac) y
  certificado de Windows (quita el aviso de SmartScreen).
