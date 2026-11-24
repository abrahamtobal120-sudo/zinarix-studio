# Estudio de Zinarix Studio: qué cambiar para ser la mejor app de programación

Fecha: 2026-11-22 · Versión revisada: 0.6.5 (rama `main`)

## 0. Avance del plan

| Fase | Estado |
|---|---|
| **0. Cortar el riesgo** | Hecha el 2026-11-22, salvo el cifrado de la red local de D1 (ver abajo) |
| **1. Medir** | Hecha el 2026-11-23 en su primera versión (ver "Fase 1" abajo); falta una línea base con un modelo capaz |
| 2. Motor del agente | Empezada: A1 hecho para Anthropic, A5 hecho en parte; falta el resto |
| 3. Editor y arranque | Pendiente |
| 4. Confianza para distribuir | Pendiente |
| 5. Pulido y ventaja | Pendiente |

Lo que quedó hecho en la Fase 0:

| # | Cambio | Dónde |
|---|---|---|
| C1 | Barrera de errores por área (barra lateral, editor, panel inferior, chat, diálogos, estudio de video, ayudante) y una para toda la app. Un fallo muestra "Reintentar" en esa área y el resto sigue. | `renderer/components/ErrorBoundary.tsx`, `App.tsx`, `main.tsx` |
| E1 | Registro en archivo `<datos>/logs/main.log` (rota a 1 MB, guarda 3, pasa por el redactor de secretos). Anota fallos del proceso principal, de ventanas, de procesos hijos, del actualizador y de la interfaz. Comando "Exportar diagnóstico…" en la paleta. | `main/log.ts`, `main.ts`, `updates.ts` |
| B2 | Abrir carpeta, soltar una carpeta, clonar o abrir un proyecto del playground preguntan antes si hay archivos sin guardar. | `renderer/store.ts` (`api()`) |
| D5 | El contenido ya no puede cerrar ni abrir la etiqueta `<untrusted>`; la salida de un comando que falla también va marcada como no confiable. | `packages/core/src/context.ts`, `agent.ts` |
| D6 | Los comandos del agente en el chat ya no reciben tokens ni llaves del entorno (`GITHUB_TOKEN`, `NPM_TOKEN`, `DATABASE_URL`…). Se conserva el agente de SSH. `ZINARIX_AGENT_ENV=inherit` devuelve el comportamiento anterior. | `agent.ts` |
| D1 | Celular: la terminal queda apagada hasta activarla en la PC; un celular sin uso por 30 días debe emparejarse otra vez; el celular no puede poner un chat en "acceso total". | `main/phone.ts` |
| E2 | El release corre todo el CI sobre el tag antes de crear el borrador; si falla, no se construye nada. | `.github/workflows/release.yml`, `ci.yml` |
| A1 (parte) | Caché de prompts en el adaptador de Anthropic: un punto al final del prompt de sistema (cubre herramientas + sistema) y otro en el último bloque de la conversación. Sin probar contra la API real: confirmar con `cache_read_input_tokens` > 0 en el segundo paso de un agente. | `packages/providers/src/adapters/anthropic.ts` |

Pendiente de la Fase 0:

- **D1, cifrado en la red local.** El servidor del celular sigue en HTTP sobre `0.0.0.0`. Cambiarlo afecta a las apps de iPhone, iPad y Android, así que necesita diseño aparte (TLS con certificado propio fijado al emparejar, o solo túnel).

### Fase 1 (medir), 2026-11-23

| # | Cambio | Dónde |
|---|---|---|
| A10 | Banco de 12 tareas para el agente: cada una trae un proyecto pequeño, una comprobación oculta y una solución de referencia. Corre con `omni agent` contra cualquier modelo y da aciertos, pasos, errores de herramientas, tokens, costo y tiempo. `pnpm evals:check` valida las tareas sin usar ningún modelo y corre en CI. | `evals/` (`evals/README.md`) |
| E4 | Prueba de punta a punta: abre la app compilada sobre un proyecto de ejemplo, salta el cuestionario, abre un archivo en el editor, comprueba que no hubo errores ni barreras de error, que se escribió el log y que la app cierra sola. En CI solo en Windows. | `apps/desktop/scripts/e2e.mjs`, `ci.yml` |
| Arranque | La misma prueba mide el arranque con `--runs N`. | `pnpm e2e --runs 5` |
| `main` en verde (parte) | Las dos pruebas rojas ya pasan: `10-browser.css` usa el token `--text-sm` y el catálogo volvió a firmarse. | `catalog/`, `styles/10-browser.css` |
| A5 (parte) | `edit_file` ya no falla por fin de línea o sangría: si el texto exacto no está, prueba con el fin de línea del archivo y luego ignorando sangría y espacios finales (solo si coincide en un único lugar), y escribe con el estilo del archivo. Una sola función para el agente del escritorio y el de la terminal. | `packages/core/src/editMatch.ts`, `agent.ts`, `agentTools.ts` |

**Línea base medida** (esta PC, Windows 11, app compilada sin empaquetar, perfil vacío, 5 arranques):

| Medida | Resultado |
|---|---|
| Hasta que aparece la ventana | 324 ms (mediana; 313–329) |
| Hasta que la interfaz se puede usar | 740 ms (mediana; 718–742) |
| Banco con `ollama/qwen2.5:1.5b` (el único modelo disponible sin costo) | 0 de 12 tareas; 17 000 tokens de entrada; 13 errores de herramientas; 182 s |

Lo que dicen estos números:

- **El arranque ya cumple la meta de 2 s.** C2 baja de prioridad: lo que queda de ese punto es el tamaño del paquete (4,5 MB) y la memoria, no el tiempo de abrir. Falta medirlo con el instalador real y en una PC lenta.
- **El 0 de 12 mide al modelo, no al motor.** Un modelo de 1 500 millones de parámetros inventa nombres de archivo en vez de listar la carpeta (edita `src/app.js`, que no existe, y se rinde). Sirve para comprobar que el banco funciona, no como línea base. **Falta correrlo con un modelo capaz** (`pnpm evals --model <proveedor/modelo>`); la llave de OpenAI conectada no tiene saldo.
- De ese mismo fallo sale una mejora barata para la Fase 2: dar al modelo el árbol de archivos del proyecto al empezar y, cuando pide un archivo que no existe, devolverle los nombres parecidos.

Pendiente de la Fase 1:

- **`pnpm format:check` falla en 399 archivos versionados** (362 en `apps/desktop`), así que el CI sigue en rojo y, desde E2, el release queda bloqueado. Se arregla con `pnpm format` en un commit aparte, con el árbol de trabajo limpio para no mezclarlo con otros cambios.
- **La llave privada del catálogo se había perdido** (la firma no coincidía desde el 29 de octubre). Se generó un par nuevo: la privada está en `~/.omni-signing/catalog.key` (hay que respaldarla) y la pública en `catalog/keys/catalog.pub`. Las apps ya instaladas no aceptarán una actualización del catálogo firmada con la llave nueva hasta actualizarse.
- La prueba de punta a punta usa la app compilada, no el instalador, y no corre en Linux ni macOS.
- El banco tiene 12 tareas de las 30–50 de la meta; faltan proyectos grandes, TypeScript con tipos, Python y tareas largas.

## 1. Veredicto

Zinarix Studio tiene una base de seguridad y de limpieza de código mejor que la de muchos productos comerciales, y una amplitud de funciones enorme. Lo que hoy le impide ser la mejor app **de programación** no es que le falten funciones, sino cuatro cosas:

1. **El motor del agente gasta de más y se equivoca de más.** En cada paso manda unas 175 herramientas, sin caché de prompts, sin resumir la conversación, sin contar tokens contra el límite del modelo y sin ver los errores del LSP después de editar.
2. **El editor tiene un límite de estructura.** Hay un solo editor Monaco para toda la app: no hay editores divididos ni varias carpetas raíz.
3. **La app hace demasiadas cosas a la vez y las carga todas al arrancar.** Unas 55 pantallas (video, 3D, CAD, correo, WhatsApp, juegos…) viven en el mismo árbol de React, sin carga diferida.
4. **No hay forma de saber si algo se rompió.** No hay pruebas de punta a punta en CI ni una medición de qué tan bien resuelve tareas el agente. Los binarios salen sin firma. (El registro de fallos y las barreras de error ya se añadieron en la Fase 0.)

Recomendación central: **congelar las funciones nuevas que no sean de programación durante unas 10–12 semanas** y dedicar ese tiempo a las fases 0–4 del plan (sección 8).

## 2. Cómo se hizo

- Cuatro revisiones en paralelo del código real (interfaz, seguridad, motor de IA, proceso de ingeniería) sobre `apps/desktop`, `packages/*`, `apps/cli`, `website/`, `scripts/` y `.github/`.
- Se revisaron las capturas de `website/assets/shots/` y los planes anteriores, para no repetirlos.
- Los hallazgos más graves se comprobaron a mano. Uno resultó falso y se quitó (`vscode-main.zip` **no** está en git).
- No se comparó contra las versiones de hoy de Cursor, Zed o VS Code en internet.
- Los tiempos del plan y las cifras de tokens son estimaciones, no mediciones.
- Lo marcado "por confirmar" salió de leer el código y no se probó en la app.

## 3. Radiografía en números

| Qué | Dato |
|---|---|
| Código de la app de escritorio | ~172 000 líneas de TypeScript en 421 archivos |
| Interfaz (renderer) | 81 000 líneas TS/TSX + 24 000 de CSS |
| Archivos más grandes | `main.ts` 5 822 · `Chat.tsx` 4 077 · `agent.ts` 3 582 |
| Canales IPC | ~550, todos por un solo punto con validación |
| Herramientas que recibe el modelo en cada paso | ~175 (más las de MCP) |
| Pantallas distintas | ~55 |
| Pruebas | 140 archivos, ~1 820 casos |
| Cobertura medida | Solo `packages/*` (~13 000 líneas); el escritorio no cuenta |
| `any`, `@ts-ignore`, TODO/FIXME | 0 · 0 · 0 |
| `React.lazy` | 0 |
| Instalador de Windows | ~209 MB |

## 4. Lo que está bueno (no tocar)

**Seguridad de la app**
- Las siete ventanas y vistas usan `sandbox`, `contextIsolation` y sin `nodeIntegration` (`main.ts`).
- Todo el IPC pasa por un único punto que revisa el origen `app://` y valida con Zod; ESLint prohíbe saltárselo.
- CSP estricta sin `unsafe-eval` y cero `innerHTML` en la interfaz.
- La aprobación de acciones se decide en el proceso principal. "Siempre" vale solo para ese comando exacto; `git push` y enviar correo preguntan siempre (`approvalPolicy.ts`).
- Llaves en el llavero del sistema, bóveda AES-256-GCM y redactor de secretos en cada línea de log.

**Motor del agente**
- Checkpoints en disco con retroceso por turno y revisión por bloque.
- Agentes en segundo plano en *worktrees* de git, con tope de costo y tiempo (`tasks.ts`).
- Sandbox real para comandos (bwrap, sandbox-exec, variante de Windows).
- Lee `AGENTS.md`, `CLAUDE.md`, reglas de Cursor y Copilot, skills, subagentes y hooks.
- Si un proveedor no acepta herramientas nativas, cambia solo a un protocolo por texto.
- Capa de proveedores cuidada: reintentos que no cobran doble, presupuestos con corte, catálogo firmado.

**Interfaz**
- Se ve limpia y ordenada.
- Accesibilidad por encima de lo normal: 852 atributos ARIA, diálogos con trampa de foco, contraste AA probado.
- Sistema de tokens de diseño con capas CSS (`ui/tokens.css`).
- Streaming del chat fluido.

**Proceso**
- TypeScript estricto y CI en tres sistemas con lint, tipos, formato, auditoría y prueba canario contra fugas de llaves.
- Acciones de GitHub fijadas por SHA.
- GPL bien cumplida para FFmpeg y OpenSCAD.

## 5. Lo que está malo y cómo arreglarlo

Gravedad: 🔴 frena el producto · 🟠 importante · 🟡 mejora · ✅ hecho.

### A. Motor de IA (lo que más pesa)

| # | Problema | Evidencia | Arreglo |
|---|---|---|---|
| A1 🟠 | **Caché de prompts a medias.** Hecho para Anthropic. Falta OpenAI (`prompt_cache_key`), Gemini (`cachedContent`), Bedrock y Vertex, y comprobar que el prompt de sistema y la lista de herramientas no cambian entre pasos (si cambian, la caché no acierta). | `packages/providers/src/adapters/*` | Mismo patrón en los demás adaptadores; prompt de sistema idéntico entre turnos; herramientas en orden fijo. |
| A2 🔴 | **175 herramientas en cada petición.** Un proyecto de Python recibe las de SketchUp, Godot, video y correo; los modelos baratos se confunden. | `agent.ts:322-525`, `:1499` | Un juego base de ~12 herramientas de código y una meta-herramienta "activar grupo". |
| A3 🔴 | **No se resume la conversación ni se cuenta contra el límite del modelo.** Una tarea larga crece hasta que el proveedor da error. | `usage.ts:68-70`; `ai.ts:1393` | Presupuesto = contexto del modelo − reserva de salida; al 80 %, resumir los turnos viejos. |
| A4 🔴 | **El agente no ve los errores del LSP.** Editar devuelve solo `Edited <ruta>`. | `agent.ts`; cero `lsp`/`diagnostic` | Devolver los diagnósticos con cada edición; añadir `go_to_definition`, `find_references`, `rename_symbol`. |
| A5 🟠 (parte ✅) | **Ediciones frágiles.** Coincidencia exacta y única; sin edición múltiple ni parche. | `packages/core/src/editMatch.ts` | Hecho: tolera fin de línea y sangría distintos. Falta `multi_edit` y `apply_patch`. |
| A6 🟠 | **Errores del bucle mal tratados.** Una respuesta cortada parece terminada; el JSON inválido se vuelve `{}`; a los 60 pasos se detiene sin avisar. | `agent.ts:231`, `:1013-1020`, `:1752` | Continuar si se cortó; reportar el JSON malo al modelo; avisar del límite; reintentar el paso una vez. |
| A7 🟠 | **Dos bucles de agente distintos** (escritorio y CLI), con cargadores duplicados. | `agent.ts` vs `packages/core/src/headlessAgent.ts` | Un solo bucle en `@omni/core`. |
| A8 🟠 | **Búsqueda semántica básica.** Trozos de 60 líneas, sin modelo de *embeddings* por defecto, vectores en un JSON. | `knowledge.ts:36-40`, `:496` | Trozos por símbolo (tree-sitter), modelo local incluido, indexador en segundo plano, mapa del repo. |
| A9 🟠 | **Autocompletado lento.** Formato de chat, 550 ms de espera, sin caché; el método FIM existe y nadie lo llama. | `inline.ts:8`; `openai-compatible.ts:307-325` | Enrutar a endpoints FIM, caché por prefijo. |
| A10 ✅ (primera versión) | No se medía la calidad del agente. | `evals/` | Hecho: banco de 12 tareas con `omni agent`. Falta llegar a 30–50 y la línea base con un modelo capaz. |
| A11 🟡 | **Agentes de terminal y MCP a medias.** Cada turno con un CLI externo arranca de cero; MCP sin OAuth, recursos ni prompts. | `cli-agent.ts:172`; `mcp.ts:41-45` | Reanudar sesión del CLI; foto con git antes y después; completar MCP. |

### B. Editor

| # | Problema | Evidencia | Arreglo |
|---|---|---|---|
| B1 🔴 | **Un solo editor para toda la app.** Sin editores divididos ni grupos. | `store.ts`; `Editor.tsx:73` | Grupos de editor, cada uno con su Monaco. Es el cambio de estructura más caro del plan. |
| B2 ✅ | Se podían perder cambios sin guardar al cambiar de carpeta. | `store.ts` | Hecho: se pregunta antes en todos los caminos que salen de la interfaz. |
| B3 🟠 | **El aviso de cambios en disco no dice qué archivo cambió**; los archivos abiertos no se recargan tras un `git checkout`. | `shared/api.ts`; `Explorer.tsx:76-82` | Evento con rutas; recargar si no está sucio. |
| B4 🟠 | **Las pestañas no se restauran** al reiniciar (por confirmar). | `shared/layout.ts` | Guardar pestañas y cursor por carpeta. |
| B5 🟠 | **Configuración pobre.** Sin `settings.json` ni buscador; atajos sin acordes. | `Settings.tsx`; `keys.ts:17-33` | Ajustes en JSON con buscador; atajos con acordes y `when`. |
| B6 🟠 | **La tienda de extensiones existe pero la interfaz no la usa**; los temas son una lista cerrada de 8. | `shared/api.ts` | Conectar el panel de extensiones. |
| B7 🟡 | Faltan esquema (outline), marcas de git en el margen, migas con símbolos, varias carpetas raíz. | `Editor.tsx:138-211` | Añadir en ese orden. |

### C. Interfaz

| # | Problema | Evidencia | Arreglo |
|---|---|---|---|
| C1 ✅ | Ninguna barrera de errores: un fallo en un panel desmontaba toda la app. | — | Hecho: una barrera por área. |
| C2 🟠 | **Todo se carga al arrancar.** three.js y el estudio 3D están en el camino de inicio; el proceso principal importa ~80 servicios. | `vite.config.ts:14`; `App.tsx:1-35`; `Editor.tsx:42` | Carga diferida de estudios y paneles; servicios al primer uso. Medido el 2026-11-23: abre en 0,74 s, así que baja de prioridad; queda el tamaño del paquete. |
| C3 🟠 | **El chat es un componente de ~2 300 líneas** con 36 estados. | `Chat.tsx` | Partirlo y sacar el estado a un *store*. |
| C4 🟠 | **La edición con IA es modal.** Ctrl+K exige selección y se acepta todo o nada. | `Modals.tsx:707-832` | Diff dentro del editor, aceptar o rechazar por bloque con teclado. |
| C5 🟠 | **Listas sin virtualizar** (chat, explorador, búsqueda). | `Chat.tsx` | Virtualizar chat y explorador primero. |
| C6 🟠 | **El código en el chat no tiene colores.** | `Markdown.tsx:384-386` | Colorear con Monaco. |
| C7 🟠 | **Demasiado a la vista.** 12 iconos sin texto, "Más" con 24 entradas, ~8 controles en la caja de mensaje, selector de 553 modelos. | `Chrome.tsx:335-361` | Paneles como módulos (sección 7); caja de mensaje con 3 controles visibles. |
| C8 🟡 | **Sistema de diseño a medio usar.** Del kit `ui/` solo se importa `Badge`; emojis como iconos en Pintura, Vector y 3D. | `ui/`; `PaintView.tsx` | Migrar pantalla por pantalla. |
| C9 🟡 | **Textos repartidos** en 25 módulos y ~86 comparaciones sueltas; todo sistema que no esté en inglés recibe español. | `i18n.ts` | Un solo `t()`; inglés por defecto salvo sistemas en español. |

### D. Seguridad

| # | Problema | Evidencia | Arreglo |
|---|---|---|---|
| D1 🟠 | **Un token robado del celular daba control total de la PC.** Ya hecho: terminal apagada por defecto, caducidad a 30 días sin uso, sin "acceso total" desde el celular. **Falta:** el tráfico va por HTTP sin cifrar en `0.0.0.0`. | `phone.ts` | Cifrado en la red local o solo túnel. |
| D2 🔴 | **Binarios sin firma y actualización automática.** La llave de minisign existe, pero los instaladores llevan el texto de relleno. | `package.json`; `install.sh`; `install.ps1` | Firma de Windows y notarización de Apple; poner la llave pública en el próximo release firmado. |
| D3 🔴 | **Sin "fuses" de Electron** en una instalación que el usuario puede modificar. | Sin `@electron/fuses` | Apagar `RunAsNode` y `NODE_OPTIONS`; activar integridad del ASAR. |
| D4 🟠 | **"Acceso total" + "Controlar la compu"**: una página maliciosa puede ejecutar cosas; `computer_open` se salta la aprobación de comandos. | `approvalPolicy.ts:123`; `computerDrivers.ts:301` | Preguntar siempre antes de abrir terminales y después de leer web o correo. |
| D5 ✅ | La etiqueta de "contenido no confiable" se podía cerrar desde dentro. | `packages/core/src/context.ts` | Hecho. |
| D6 ✅ | Los comandos del chat heredaban credenciales del entorno. | `agent.ts` | Hecho. |
| D7 🟠 | **Huecos en las rutas prohibidas en Windows** (mayúsculas, Edge, gcloud, `~/.omni-signing`). Por confirmar. | `system.ts:159-207` | Comparar en minúsculas; añadir rutas. |
| D8 🟠 | **Una sola llave firma licencias y configuración remota**, y la configuración se puede reenviar vieja. | `website/api/license.mjs:26`; `remote.ts:17-36` | Dos llaves; número de secuencia que solo sube. |
| D9 🟡 | Navegador de la IA con cookies reales; FFmpeg sin suma de verificación; Dependabot sin npm; informes de seguridad en el repo. | `browser.ts:36`; `.github/dependabot.yml:5` | Sesión aparte; fijar SHA-256; sacar los informes. |

### E. Calidad y proceso

| # | Problema | Evidencia | Arreglo |
|---|---|---|---|
| E1 ✅ | Sin visibilidad de fallos; el actualizador se tragaba los errores. | — | Hecho: registro en archivo y "Exportar diagnóstico". |
| E2 ✅ | Se publicaba sin pasar pruebas. | `release.yml` | Hecho: el release depende del CI. |
| E3 🟠 | **La cobertura no mide el producto.** | `vitest.config.ts` | Incluir el escritorio con umbral que solo suba. |
| E4 ✅ (primera versión) | No había prueba de punta a punta en CI. | `apps/desktop/scripts/e2e.mjs` | Hecho en Windows con la app compilada. Falta el instalador y los otros sistemas. |
| E5 🟠 | **Pruebas que se saltan en silencio** si falta Blender, Docker, etc. | `describe.skipIf` | Flujo nocturno con esas herramientas. |
| E6 🟠 | **Historial ilegible.** Commits llamados `t`, `g`, `e`; todo directo a `main`. | `git log` | Rama por cambio y mensajes con sentido. |
| E7 🟡 | Documentación vieja (README dice v0.6.2 y "180 pruebas"); paquetes vacíos; faltan `CHANGELOG` y `SECURITY.md`. | `README.md` | Limpiar y generar los números en CI. |
| E8 🟠 | **`main` no pasa su propio CI**: formato sin aplicar y dos pruebas en rojo (ver sección 0). | `pnpm format:check`, `pnpm test` | Commit de formato; volver a firmar el catálogo; corregir el CSS. |

### F. Estrategia

- **F1 🔴 Dos bases de editor.** La migración a VSCodium está en la etapa 0 de 5 y sin tocar desde el 14 de noviembre. **Recomendación: quedarse con la app propia** y cerrar B1–B7: migrar significaría reescribir ~81 000 líneas de interfaz. El costo es que las extensiones de VS Code que ejecutan código nunca van a funcionar. Si eso es decisivo, hacer una prueba de dos semanas con fecha límite; si no, borrar los scripts `code:*`/`codium:*`.
- **F2 🔴 El producto no dice qué es.** Decidir: Zinarix es un **editor de código con IA**; lo demás son módulos opcionales.
- **F3 🟠 Licencia y App Store.** GPL-3.0 con apps de iPhone/iPad y el titular escrito de dos formas: consultar a un abogado antes de publicar.

## 6. Funciones extra que agregaría

1. **Revisión de cambios dentro del editor**, por bloque y con teclado.
2. **Modo "hasta que pase"**: corre pruebas y tipos y sigue hasta dejar todo en verde.
3. **Mapa del repositorio** en el contexto del agente.
4. **Medidor de contexto y costo en vivo** en el chat.
5. **Bandeja de agentes** en segundo plano con diff y botón de fusionar.
6. **Revisión de PR con IA** (la acción `zinarix-review` existe y nadie la usa).
7. **Selector de modelo corto**: 5–8 recomendados y el catálogo detrás de "ver todos".
8. **Actualización automática del catálogo** en el escritorio.
9. **Reanudar una tarea** después de un cierre inesperado.

## 7. Qué escondería

- **Módulos que se activan aparte:** Video, 3D, CAD, SketchUp, Estudio gráfico, Juegos, Hardware, Celular, Correo, WhatsApp, Automatizaciones. Sin activar no cargan código, no salen en "Más" y sus herramientas no van al modelo. Esto resuelve a la vez A2, C2 y C7.
- **Fuera del prompt del agente:** el texto de producto (`agent.ts:248-265`).
- **Fuera del repo:** informes de seguridad, `.md/notas/`, la APK compilada, los paquetes vacíos.
- **Apagado por defecto:** reconexión de WhatsApp y del celular.

## 8. Plan de trabajo

| Fase | Qué | Tiempo estimado | Criterio de salida |
|---|---|---|---|
| **0. Cortar el riesgo** ✅ | C1, B2, E1, D1, D5, D6, E2 | 1 semana | Un error en un panel no cierra el editor; hay archivo de log; no se publica con CI en rojo |
| **1. Medir** ✅ (primera versión) | A10, E4, E8, tiempo de arranque | 1–2 semanas | Tabla base con aciertos, costo por tarea y segundos de arranque; `main` en verde |
| **2. Motor del agente** | A7 primero; luego A1–A6 | 3–4 semanas | Costo por tarea a menos de la mitad y más aciertos con el modelo barato |
| **3. Editor y arranque** | C2, B1, B3, B4, C4, C5, C6 | 3–4 semanas | Abre en menos de 2 s; editor dividido; `git checkout` actualiza los archivos |
| **4. Confianza para distribuir** | D1 (cifrado), D2, D3, D8, E3, E5 | 2 semanas + trámites | Instalador firmado; el release falla si falta una firma |
| **5. Pulido y ventaja** | A8, A9, A11, B5–B7, C3, C8, C9, sección 6 | Continuo | — |

Las fases 2 y 3 pueden ir en paralelo. La Fase 1 no se salta: sin medición no se sabe si la Fase 2 funcionó.

## 9. Cómo saber si mejora

| Métrica | Hoy | Meta |
|---|---|---|
| Tareas resueltas del banco (modelo barato) | 0 de 12 con `qwen2.5:1.5b` (no sirve de base); sin medir con un modelo capaz | Subir en cada fase |
| Tokens de entrada por tarea | Sin medir | Menos de la mitad tras la Fase 2 |
| Herramientas enviadas en un proyecto de código | ~175 | ≤ 20 |
| Tiempo de arranque | 0,74 s (app compilada, PC de desarrollo) | < 2 s también con el instalador y en una PC lenta |
| Paquete inicial de la interfaz | 4,5 MB | < 1,5 MB |
| Fallos de panel que tumban la app | Ninguno (desde la Fase 0) | Ninguno |
| Instaladores firmados | 0 de 3 | 3 de 3 |
