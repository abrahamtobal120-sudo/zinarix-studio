# Zinarix 3D Pro

## Español

**Qué es.** El botón "Modo Pro" del estudio 3D abre Blender 4.2 o más nuevo con la
plantilla "Zinarix" (tema, menús, splash) y el complemento **Zinarix AI**: un agente que
mira la escena, escribe un script `bpy`, lo ejecuta, lee el resultado y repite hasta
terminar. Las preferencias de esta copia de Blender viven en la carpeta de datos de la app
(`zinarix-3d-pro`), así que un Blender normal en la misma PC conserva las suyas.

**Cómo se conecta la IA.** La app arranca un puente local compatible con OpenAI
(`src/main/blenderBridge.ts`): solo en `127.0.0.1`, puerto al azar, token bearer al azar,
solo acepta `Host`/`Origin` de loopback, cuerpo de 2 MB como máximo, y cancela el modelo si
Blender corta la conexión. Blender lo recibe en el entorno:

| Variable                                           | Uso                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `ZINARIX_BRIDGE_URL`, `ZINARIX_BRIDGE_TOKEN`       | URL y token del puente (el token solo se envía a URLs de loopback) |
| `ZINARIX_AI_PROVIDER=ZINARIX`                      | El complemento usa el puente                                       |
| `ZINARIX_LANG` (`es`/`en`), `ZINARIX_LOOK`         | Idioma y colores del tema de la app                                |
| `BLENDER_SYSTEM_SCRIPTS`, `BLENDER_USER_RESOURCES` | Esta carpeta `scripts/` y la configuración aparte                  |

El agente usa los modelos ya conectados en Zinarix (Claude Code, Codex, Ollama, proveedores
de API): **no hacen falta claves de API en Blender**. Las variables de entorno con secretos
de la app no pasan a Blender. Sin el puente, el complemento puede usar su propio proveedor
(Anthropic, OpenAI, OpenRouter, Ollama o uno compatible) desde sus preferencias.

**Puente permanente.** El botón "Puente" de la barra de estado (abajo, en cualquier parte de Zinarix) lo deja abierto siempre (también al
iniciar la app) en un puerto fijo (`47815`, o uno libre si está ocupado) con un token que se
guarda en `blender-bridge.json` de la carpeta de datos. Mientras está abierto, la app escribe
`~/.zinarix/blender-bridge.json` (`{url, token, pid}`; otra ruta con `ZINARIX_BRIDGE_FILE`):
cualquier Blender con el complemento Zinarix AI instalado lo lee y usa tus modelos aunque no
lo hayas abierto desde Zinarix. El entorno de "Modo Pro" tiene prioridad sobre el archivo, y
una URL que no sea de loopback se ignora. Al apagarlo se borra el archivo y el token cambia.
Ojo: con el puente abierto, cualquier programa de tu usuario que lea ese archivo puede usar
tus modelos.

**Puente para la web.** Con el puente permanente abierto, una app web también puede usar tus
modelos: en el menú "Puente" copia la URL (`http://127.0.0.1:47815/v1`) y el token, y úsalos
como una API compatible con OpenAI (`Authorization: Bearer <token>`, `GET /models`,
`POST /chat/completions`). Las páginas de `localhost` / `127.0.0.1` pueden siempre; cualquier
otro sitio (p. ej. `https://mi-app.vercel.app`) solo si lo añades en "Sitios web permitidos"
(CORS, también la respuesta de Private Network Access de Chrome). El token sigue siendo
obligatorio: no lo pongas en el código de una web pública, pídeselo al usuario.

```js
const r = await fetch('http://127.0.0.1:47815/v1/chat/completions', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Hola' }] }),
});
```

**Sigue activo con la ventana cerrada.** Con el puente permanente encendido, cerrar la ventana
no cierra Zinarix: se queda en la bandeja del sistema (icono junto al reloj) con el puente
abierto, y en Windows y Linux también arranca oculto al iniciar sesión. "Salir del todo" en el
menú de la bandeja (o Ctrl+Q) lo cierra de verdad.

**Dejar tareas.** `POST /v1/jobs` (el mismo cuerpo que `/chat/completions`, más un `title`
opcional) deja la tarea en cola y responde enseguida `202 {id, status: "queued"}`. Zinarix la
ejecuta en segundo plano y guarda la respuesta en disco; si se apaga la computadora antes de
terminar, la tarea sigue la próxima vez que Zinarix abra (hasta 3 intentos). `GET /v1/jobs/<id>`
da `status` (`queued`, `running`, `done`, `error`, `cancelled`) y, cuando termina, `completion`
con la respuesta; `GET /v1/jobs` las lista y `DELETE /v1/jobs/<id>` cancela o borra una. Las
terminadas se guardan 7 días. Desde Python del complemento: `client.submit_job(...)` y
`client.get_job(id)`.

**Seguridad.**

- Sin "Ejecución automática", cada script espera a "Ejecutar paso" u "Omitir"; el script
  que se ejecuta es el texto `zinarix_ai.py`, incluidas tus ediciones.
- Con ella (la plantilla la activa una vez), los scripts con llamadas riesgosas (archivos,
  procesos, red, `exec`/`eval`, guardar el .blend…) **siempre** piden confirmación. Es una
  revisión por patrones, no un sandbox: el código corre con los permisos de Blender.
- Cada script deja un paso de deshacer ("Zinarix AI"), también si falla: Ctrl+Z lo revierte.
- Abrir otro archivo o "Detener" corta el ciclo; las respuestas tardías se ignoran.

**Pruebas.**

```sh
# Python puro (sin Blender), desde la raíz del repo:
python -I -m unittest discover -s apps/desktop/blender/tests
# Puente + plantilla + complemento dentro de Blender (Blender portable vía ZINARIX_BLENDER):
ZINARIX_BLENDER=/ruta/a/blender npx vitest run apps/desktop/test/blender-bridge.test.ts \
  apps/desktop/test/zinarix-3d-pro.test.ts apps/desktop/test/zinarix-3d-pro-e2e.test.ts
```

Sin `ZINARIX_BLENDER` (ni Blender instalado) las pruebas que necesitan Blender se omiten.

**Archivos.**

```
scripts/addons/zinarix_ai/
  __init__.py       UI, operadores, ciclo del agente (bpy solo en el hilo principal)
  agent.py          prompt del sistema, descripción de la escena, run_code
  client.py         HTTP (solo stdlib): proveedores, puente, risky_calls
  translations.py   textos en español
scripts/startup/bl_app_templates_system/Zinarix/
  __init__.py       plantilla: tema, menús, splash, activa el complemento
tests/              unittest de client.py y agent.py
```

En la app empaquetada esta carpeta `scripts/` se copia a `resources/blender-scripts`
(`extraResources` en `package.json`).

## English

**What it is.** The 3D studio's "Pro Mode" button launches Blender 4.2+ with the "Zinarix" app template and
the **Zinarix AI** add-on, an agent that inspects the scene, writes a `bpy` script, runs it,
reads the result and repeats.

**How the AI connects.** Zinarix starts a local OpenAI-compatible bridge (loopback only,
random port and bearer token, loopback `Host`/`Origin` only, 2 MB body limit, the model run
is aborted when Blender disconnects) and passes `ZINARIX_BRIDGE_URL` / `ZINARIX_BRIDGE_TOKEN`
/ `ZINARIX_AI_PROVIDER=ZINARIX` to Blender. The add-on uses the models already connected in
Zinarix, so no API keys are needed in Blender.

**Safety.** Without Auto-run every script waits for Run Step / Skip. With Auto-run, scripts
with risky calls (files, processes, network, `exec`/`eval`, saving the .blend) always ask
first; this is a pattern check, not a sandbox. Every script leaves an undo step, even when
it fails.

**Tests.** `python -I -m unittest discover -s apps/desktop/blender/tests`, then the vitest
files above with `ZINARIX_BLENDER` pointing at a (portable) Blender 4.2+.

## Own build / Compilación propia

Some things only change by compiling Blender: the version number on the splash, the name in
the window title from the first frame, and the icon and details inside the `.exe`. Those
changes live in `build/zinarix-3d.patch` (applied to `<repo>/blender`); the splash image and
icon are copied from the template. `build/build-zinarix-3d.ps1 -CheckOnly` lists the missing
tools (Visual Studio 2022 Build Tools with C++, CMake, Git LFS, Python); without `-CheckOnly`
it downloads the Blender libraries, compiles and installs to
`%LOCALAPPDATA%\Programs\Zinarix Studio 3D`, which the app tries before any other Blender.
The `.exe` is unsigned: Smart App Control blocks it. Blender is GPL: share the source with
the build.
