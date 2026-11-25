# Estudio de Zinarix Studio: qué cambiar para ser la mejor app de programación

Fecha: 2026-11-22 · Versión revisada: 0.6.5 (rama `main`)

## 0. Avance del plan

| Fase                         | Estado                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **0. Cortar el riesgo**      | Hecha el 2026-11-22, salvo el cifrado de la red local de D1 (ver abajo)                                                   |
| **1. Medir**                 | Hecha el 2026-11-23 en su primera versión (ver "Fase 1" abajo); falta una línea base con un modelo capaz                  |
| 2. Motor del agente          | Avanzada: A1 (Anthropic), A2, A3, A5 y A6 hechos; A4, A7 y A9 en parte; faltan A8 y A11                                   |
| 3. Editor y arranque         | Empezada: B3, B4 y C6 hechos; el arranque ya cumple la meta; B1 (primera versión), C2, C4 y C5 (chat y explorador) hechos |
| 4. Confianza para distribuir | Pendiente                                                                                                                 |
| 5. Pulido y ventaja          | Pendiente                                                                                                                 |

Lo que quedó hecho en la Fase 0:

| #          | Cambio                                                                                                                                                                                                                                                                           | Dónde                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| C1         | Barrera de errores por área (barra lateral, editor, panel inferior, chat, diálogos, estudio de video, ayudante) y una para toda la app. Un fallo muestra "Reintentar" en esa área y el resto sigue.                                                                              | `renderer/components/ErrorBoundary.tsx`, `App.tsx`, `main.tsx` |
| E1         | Registro en archivo `<datos>/logs/main.log` (rota a 1 MB, guarda 3, pasa por el redactor de secretos). Anota fallos del proceso principal, de ventanas, de procesos hijos, del actualizador y de la interfaz. Comando "Exportar diagnóstico…" en la paleta.                      | `main/log.ts`, `main.ts`, `updates.ts`                         |
| B2         | Abrir carpeta, soltar una carpeta, clonar o abrir un proyecto del playground preguntan antes si hay archivos sin guardar.                                                                                                                                                        | `renderer/store.ts` (`api()`)                                  |
| D5         | El contenido ya no puede cerrar ni abrir la etiqueta `<untrusted>`; la salida de un comando que falla también va marcada como no confiable.                                                                                                                                      | `packages/core/src/context.ts`, `agent.ts`                     |
| D6         | Los comandos del agente en el chat ya no reciben tokens ni llaves del entorno (`GITHUB_TOKEN`, `NPM_TOKEN`, `DATABASE_URL`…). Se conserva el agente de SSH. `ZINARIX_AGENT_ENV=inherit` devuelve el comportamiento anterior.                                                     | `agent.ts`                                                     |
| D1         | Celular: la terminal queda apagada hasta activarla en la PC; un celular sin uso por 30 días debe emparejarse otra vez; el celular no puede poner un chat en "acceso total".                                                                                                      | `main/phone.ts`                                                |
| E2         | El release corre todo el CI sobre el tag antes de crear el borrador; si falla, no se construye nada.                                                                                                                                                                             | `.github/workflows/release.yml`, `ci.yml`                      |
| A1 (parte) | Caché de prompts en el adaptador de Anthropic: un punto al final del prompt de sistema (cubre herramientas + sistema) y otro en el último bloque de la conversación. Sin probar contra la API real: confirmar con `cache_read_input_tokens` > 0 en el segundo paso de un agente. | `packages/providers/src/adapters/anthropic.ts`                 |

Pendiente de la Fase 0:

- **D1, cifrado en la red local.** El servidor del celular sigue en HTTP sobre `0.0.0.0`. Cambiarlo afecta a las apps de iPhone, iPad y Android, así que necesita diseño aparte (TLS con certificado propio fijado al emparejar, o solo túnel).

### Fase 1 (medir), 2026-11-23

| #                       | Cambio                                                                                                                                                                                                                                                                                                                       | Dónde                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| A10                     | Banco de 12 tareas para el agente: cada una trae un proyecto pequeño, una comprobación oculta y una solución de referencia. Corre con `omni agent` contra cualquier modelo y da aciertos, pasos, errores de herramientas, tokens, costo y tiempo. `pnpm evals:check` valida las tareas sin usar ningún modelo y corre en CI. | `evals/` (`evals/README.md`)                                  |
| E4                      | Prueba de punta a punta: abre la app compilada sobre un proyecto de ejemplo, salta el cuestionario, abre un archivo en el editor, comprueba que no hubo errores ni barreras de error, que se escribió el log y que la app cierra sola. En CI solo en Windows.                                                                | `apps/desktop/scripts/e2e.mjs`, `ci.yml`                      |
| Arranque                | La misma prueba mide el arranque con `--runs N`.                                                                                                                                                                                                                                                                             | `pnpm e2e --runs 5`                                           |
| `main` en verde (parte) | Las dos pruebas rojas ya pasan: `10-browser.css` usa el token `--text-sm` y el catálogo volvió a firmarse.                                                                                                                                                                                                                   | `catalog/`, `styles/10-browser.css`                           |
| A5 (parte)              | `edit_file` ya no falla por fin de línea o sangría: si el texto exacto no está, prueba con el fin de línea del archivo y luego ignorando sangría y espacios finales (solo si coincide en un único lugar), y escribe con el estilo del archivo. Una sola función para el agente del escritorio y el de la terminal.           | `packages/core/src/editMatch.ts`, `agent.ts`, `agentTools.ts` |

**Línea base medida** (esta PC, Windows 11, app compilada sin empaquetar, perfil vacío, 5 arranques):

| Medida                                                                 | Resultado                                                                   |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Hasta que aparece la ventana                                           | 324 ms (mediana; 313–329)                                                   |
| Hasta que la interfaz se puede usar                                    | 740 ms (mediana; 718–742)                                                   |
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

### Fase 2 (motor del agente), A2, 2026-11-23

**Hecho: herramientas por grupos.** El agente manda en cada paso solo las herramientas de código (archivos, búsqueda, comandos, conocimiento) y una herramienta nueva, `use_tools`, que carga el resto por grupo: navegador, correo, nube, medios, imagen, cuadernos, diseño, Docker, hardware, celular, juegos, CAD, SketchUp, 3D, video, compu, sistema y seguridad.

| Medida (agente principal, sin MCP)         | Antes                                          | Ahora                                        |
| ------------------------------------------ | ---------------------------------------------- | -------------------------------------------- |
| Herramientas por petición                  | 175                                            | 21                                           |
| Tamaño de herramientas + prompt de sistema | ~130 000 caracteres (~32 500 tokens estimados) | ~18 000 caracteres (~4 500 tokens estimados) |

Cómo se carga un grupo:

- El modelo llama a `use_tools` (sin aprobación); la respuesta trae las instrucciones del grupo.
- Zinarix lo carga solo si el mensaje lo nombra ("revisa mi correo", una URL, "docker"…) o si la carpeta es de eso (`project.godot`, `platformio.ini`, `Dockerfile`…), o si "Controlar la compu" está encendido.
- Si el modelo llama a una herramienta de un grupo sin cargar, se ejecuta igual y el grupo queda cargado.
- Los agentes de terminal (Claude Code, Codex…) reciben el navegador desde el inicio.
- `ZINARIX_AGENT_TOOLS=all` devuelve el comportamiento anterior.

Archivos: `apps/desktop/src/main/toolGroups.ts`, `agent.ts`, `test/toolGroups.test.ts`.

Sin medir todavía: los tokens son una estimación por caracteres, y falta correr el banco con un modelo capaz para ver si suben los aciertos. El agente de la terminal (`omni agent`) no cambia: ya usaba pocas herramientas.

### Avance del 2026-11-24

Todo lo de esta tabla pasa tipos, lint, formato y la batería completa (1 842 pruebas; solo falla la de PlatformIO, que Windows bloquea en esta PC). **Nada de esto se probó a mano en la app**, salvo donde se indica.

| #          | Cambio                                                                                                                                                                                                                                                                                                                                                                            | Dónde                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| A3         | **Resumen de conversación.** Antes de cada paso se estima el tamaño de la conversación contra el contexto del modelo (menos las herramientas y una reserva para la respuesta). Al pasar el 80 %, el propio modelo resume la parte antigua y los turnos recientes quedan tal cual. Si el resumen falla, no se toca nada. Los agentes de terminal (Claude Code, Codex…) no cambian. | `packages/core/src/compact.ts`, `agent.ts`                    |
| A4 (parte) | **El agente ve los errores tras editar.** Después de `edit_file` o `write_file`, el resultado trae lo que dice el servidor de lenguaje sobre ese archivo (errores primero, hasta 15 líneas). Solo si ya hay un servidor en marcha para ese lenguaje (no arranca uno por el agente) y espera como mucho 2,5 s.                                                                     | `main/lsp.ts`, `main/lspCheck.ts`, `agent.ts`, `main.ts`      |
| A5         | **Varias ediciones en una llamada.** `edit_file` acepta una lista `edits` para cambiar varios puntos del mismo archivo de una vez: se aplican en orden y, si una no encaja, no se cambia nada y el error dice cuál. Una sola aprobación. La vista previa de la aprobación usa ahora la misma coincidencia tolerante que la edición. No se añadió `apply_patch`.                   | `packages/core/src/editMatch.ts`, `agentTools.ts`, `agent.ts` |
| A6         | **Errores del bucle.** Una respuesta cortada por el límite de salida se continúa sola (hasta 3 veces). Los argumentos con JSON roto ya no ejecutan la herramienta con `{}`: el modelo recibe el error y reintenta. Al llegar a los 60 pasos el chat lo dice en vez de terminar callado.                                                                                           | `agent.ts`, `test/agent-loop.test.ts`                         |
| A7 (parte) | El agente de la terminal (`omni agent`) ya usa el mismo protocolo de herramientas por texto que el escritorio: si el modelo no acepta herramientas nativas, o las escribe como JSON en la respuesta, se le dan por texto. También recibe el árbol de archivos y sugerencias de nombres parecidos.                                                                                 | `packages/core/src/textTools.ts`, `headlessAgent.ts`          |
| A9 (parte) | Autocompletado: caché por prefijo (misma posición, o el usuario teclea el inicio de la sugerencia) y uso del endpoint FIM cuando el proveedor lo tiene.                                                                                                                                                                                                                           | `shared/inlineCache.ts`, `renderer/inline.ts`, `main/ai.ts`   |
| B4         | Las pestañas abiertas, la activa y el cursor se guardan por carpeta y vuelven al reabrirla.                                                                                                                                                                                                                                                                                       | `renderer/tabSession.ts`, `store.ts`                          |
| C6         | Código con colores en el chat, con los tokenizadores de Monaco y sin `innerHTML`.                                                                                                                                                                                                                                                                                                 | `renderer/highlight.ts`, `Markdown.tsx`                       |
| D7         | Rutas prohibidas en Windows: comparación sin distinguir mayúsculas y carpetas que faltaban.                                                                                                                                                                                                                                                                                       | `main/system.ts`                                              |
| E5         | Flujo nocturno que instala las herramientas reales y lista las pruebas que se saltaron. Sin ejecutar todavía en GitHub.                                                                                                                                                                                                                                                           | `.github/workflows/nightly.yml`, `scripts/skipped-tests.mjs`  |
| E7 (parte) | `SECURITY.md`, README al día y Dependabot para npm.                                                                                                                                                                                                                                                                                                                               | `SECURITY.md`, `README.md`, `.github/dependabot.yml`          |

Límites de lo hecho hoy:

- **A3 usa una estimación** (3,5 caracteres por token), no el conteo real del proveedor, y supone 32 000 tokens de contexto cuando el catálogo no conoce el modelo. El resumen cuesta una llamada extra al mismo modelo.
- **A9, probado con Ollama real.** El FIM se usa con proveedores que lo declaran en el catálogo (Mistral, DeepSeek, llama.cpp) y con Ollama, donde se prueba una vez por modelo: `qwen2.5-coder:7b` lo acepta y `qwen2.5:1.5b` lo rechaza y sigue por chat. En la misma posición el FIM completó bien la línea (`firstLine(suffix);`) con 454 tokens de entrada; el chat usó 573 y devolvió un bloque que no continuaba la línea. La latencia no se pudo medir: Ollama estaba ocupado con el banco. El uso se anota con tokens estimados. Sin probar en la app (tecleando) ni con Mistral o DeepSeek, que no tienen saldo. La pausa de 550 ms antes de pedir sigue igual.
- **A4 no cubre TypeScript ni JavaScript.** Esos lenguajes los revisa Monaco dentro de la ventana, no un servidor de lenguaje, así que el agente todavía no ve sus errores. Tampoco están `go_to_definition`, `find_references` ni `rename_symbol`. Probado con un servidor simulado, no con pyright o gopls reales.
- **A6 en los dos agentes.** El de la terminal ya reportaba el JSON roto y el límite de pasos; ahora también continúa las respuestas cortadas.

**Banco con el modelo local gratis (`ollama/qwen2.5-coder:7b`, sin costo).** Dos corridas y las dos dieron 0 de 12, pero por fallos del motor, no del modelo:

| Corrida                | Qué pasó                                                                                                                                                                                                     | Arreglo                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (`mapa-de-archivos`) | El modelo escribía las llamadas a herramientas como texto y `omni agent` no las ejecutaba: 0 llamadas en 12 tareas.                                                                                          | Protocolo de herramientas por texto en el agente de la terminal (A7, arriba).                                                                                                                            |
| 2 (`texto`)            | Ya usa herramientas (16 llamadas), pero las 12 tareas terminaron con `timeout after 60000 ms`: Zinarix cortaba la petición si el modelo no empezaba a responder en 60 s, y un modelo local en CPU tarda más. | Los proveedores locales (Ollama, LM Studio…) tienen ahora 10 minutos para empezar a responder (`packages/core/src/omni.ts`). Afectaba a cualquier usuario con un modelo local lento, también en el chat. |

**Tercera corrida (`sin-corte-60s`), ya sin ese corte: 1 de 12** (pasó `02-implement-slugify`). 21 pasos, 25 llamadas a herramientas, 10 con error, ~24 000 tokens de entrada, 65 minutos.

**Corrección (2026-11-25): los cuelgues no eran por la PC.** La lectura anterior decía que el modelo corre en CPU y por eso no respondía. No es así: `qwen2.5-coder:7b` cabe entero en la tarjeta gráfica y da el primer paso en unos 4 s. Las tareas que se quedaron "sin dar un paso" coincidieron con **dos mediciones corriendo a la vez contra el mismo Ollama** (dos sesiones de IA trabajando en paralelo). Las corridas `texto`, `sin-corte-60s` y `leer-antes` no sirven como dato. El banco ahora guarda lo que el agente alcanzó a hacer cuando una tarea se corta (`stuck at: …`), en vez de reportar "0 pasos".

**Corridas a solas (2026-11-25), mismo modelo local:**

| Corrida    | Resueltas | Pasos | Llamadas (con error) | Archivos cambiados | Tiempo |
| ---------- | --------- | ----- | -------------------- | ------------------ | ------ |
| `limpio`   | 0 de 12   | 81    | 123 (54)             | 7 de 12 tareas     | 45 min |
| `comandos` | 2 de 12   | 80    | 71 (19)              | 9 de 12 tareas     | 20 min |

Entre una y otra solo cambió el motor (tabla de abajo). Pasaron `01-off-by-one` y `11-read-only-question`.

| Cambio del motor (2026-11-24/25)                                                                                                                                                                                                        | Dónde                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Llamadas escritas como JSON.** Si el modelo escribe `{"name": …, "arguments": …}` en su respuesta en vez de llamar a la herramienta, se ejecuta y la conversación sigue por el protocolo de texto. En el escritorio y en la terminal. | `packages/core/src/textTools.ts`, `agent.ts` |
| **JSON sin cerrar.** Si a la llamada solo le faltan llaves de cierre, se completa; si está cortada a medias, el modelo recibe el error y la reescribe (antes la corrida terminaba como si fuera la respuesta final).                    | `textTools.ts`                               |
| **Leer antes de editar.** `omni agent` rechaza editar o sobrescribir un archivo existente que el modelo no ha leído en esa corrida.                                                                                                     | `packages/core/src/agentTools.ts`            |
| **Código mostrado pero no guardado.** Si el agente termina enseñando código sin haber cambiado ningún archivo, se le avisa una vez que nada se guardó.                                                                                  | `packages/core/src/headlessAgent.ts`         |
| **Bucles.** La misma llamada 3 veces seguidas recibe un aviso; a la sexta la corrida se detiene con un error claro en vez de gastar pasos hasta el límite.                                                                              | `headlessAgent.ts`                           |
| **Comandos del proyecto.** El agente recibe los scripts de `package.json`, o la frase "no hay pruebas configuradas". Antes gastaba 8 pasos inventando un `package.json` e instalando Jest para poder "correr las pruebas".              | `agentTools.ts` (`projectCommands`)          |

Cómo leer el 2 de 12:

- **Ya no falla el motor, falla el modelo.** En 8 de las 10 tareas no resueltas el agente leyó, editó y terminó; el código que escribió tiene errores de lógica (usa una variable antes de declararla, llama a una función que no existe, compara versiones al revés). En las otras 2 no llegó a cambiar nada.
- **Una sola corrida es ruido con un modelo de este tamaño.** La misma tarea sale bien en una corrida y mal en la siguiente; el resultado se ha movido entre 0 y 2 de 12. Para comparar cambios del motor hace falta `--runs 3` o más (una hora con este modelo) o un modelo más capaz.
- **Sigue faltando la línea base con un modelo capaz.** Por decisión del dueño (2026-11-24) no se paga saldo todavía, así que el banco se queda con el modelo local.
- "Leer antes de editar", el aviso de código no guardado, los bucles y los comandos del proyecto estaban solo en `omni agent`. Desde el 2026-11-25 (segunda tanda, abajo) tres de los cuatro están también en el escritorio.

### Avance del 2026-11-25, segunda tanda

Tipos, lint y formato pasan. La batería completa pasa: 1 893 pruebas en verde y ninguna en rojo. La prueba de punta a punta abre la app compilada sin errores.

**Ollama recortaba las conversaciones sin avisar (arreglado).** Es el hallazgo más importante de la medición, y afectaba a cualquier usuario con un modelo local, también en el chat:

- Ollama carga cada modelo con una ventana de **4 096 tokens** aunque el modelo admita 32 768, y lo que no cabe **lo tira sin dar error**. Comprobado: un mensaje de 38 000 caracteres llegó como 43 tokens y el modelo respondió sin haberlo visto.
- Zinarix hablaba con Ollama por su vía compatible con OpenAI (`/v1`), que **no permite pedir más ventana**. En un agente, el prompt de sistema más dos archivos leídos ya pasan de 4 096 tokens, así que el modelo perdía la tarea o el contenido de los archivos a mitad de la corrida.
- Ahora el chat con Ollama va por su API nativa (`/api/chat`) con `num_ctx` ajustado a la petición: 8 192, 16 384 o 32 768 tokens, sin pasar del límite del modelo. La ventana solo crece (achicarla recarga el modelo) y se respeta la que el modelo ya tenga cargada.
- Si aun así Ollama lee muchos menos tokens de los enviados, la petición **falla con un mensaje claro** en vez de entregar una respuesta escrita a ciegas.
- La lista de modelos de Ollama trae ahora su ventana real, así que el resumen de conversación (A3) se dispara a tiempo.
- `ZINARIX_OLLAMA_CTX=<tokens>` fija la ventana a mano. Un servidor que solo ofrezca `/v1` sigue funcionando por esa vía.
- Comprobado contra el Ollama real: el mismo tipo de mensaje largo (16 800 caracteres, 7 335 tokens) llega completo y la respuesta es correcta. En esta PC (Intel Arc A310) leer esos tokens tarda 140 s: la ventana grande es correcta pero lenta en tarjetas pequeñas.

Archivos: `packages/providers/src/adapters/ollama.ts`, `openai-compatible.ts`, `test/ollama.test.ts` (13 pruebas).

Límites: LM Studio y otros servidores locales no tienen una vía equivalente (la ventana se elige en su propia interfaz). La estimación de tamaño es por caracteres (2 por token, a propósito alta).

**Banco con la ventana real** (corrida `contexto-real`, a solas, mismo modelo local): **2 de 12**, las mismas dos tareas que antes (`01-off-by-one` y `11-read-only-question`).

| Corrida         | Resueltas | Pasos | Errores de herramientas | Tokens de entrada | Tiempo |
| --------------- | --------- | ----- | ----------------------- | ----------------- | ------ |
| `comandos`      | 2 de 12   | 80    | 19                      | 128 000           | 20 min |
| `contexto-real` | 2 de 12   | 109   | 46                      | 317 000           | 36 min |

Cómo leerlo: el arreglo **no subió los aciertos con este modelo**. Lo que cambió es que ahora el modelo sí recibe toda la conversación (2,5 veces más tokens leídos), y con eso las corridas largas se alargan: dos tareas llegaron al límite de 10 minutos y una al de 25 pasos, dando vueltas entre editar y correr el comando. Antes esas mismas corridas "terminaban" porque el modelo había perdido el hilo. El tope sigue siendo la capacidad de un modelo de 7 000 millones de parámetros; una sola corrida sigue siendo ruido.

| #          | Cambio                                                                                                                                                                                                                                                                                                                                                                                                                  | Dónde                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A7 (parte) | **Protecciones del agente de terminal, ahora en el escritorio.** (1) No edita ni sobrescribe un archivo que existe y que el modelo no ha leído en esa conversación; el rechazo llega antes de pedir la aprobación. (2) La misma llamada de archivos o comandos repetida avisa a la tercera y detiene la corrida a la sexta, con un mensaje en el chat. (3) El prompt trae los scripts del `package.json` de la carpeta. | `apps/desktop/src/main/agent.ts`, `test/agent-loop.test.ts`                |
| B3         | **Los archivos abiertos siguen al disco.** El vigilante de la carpeta dice qué archivos cambiaron (o "muchos" si pasan de 300). Una pestaña sin cambios toma el texto nuevo (deshacer devuelve el anterior); una con cambios sin guardar se deja igual y se avisa, como mucho una vez por minuto. Los guardados propios no disparan el aviso. **Comprobado en la app real** con la prueba de punta a punta.             | `main/workspace.ts`, `renderer/diskSync.ts`, `store.ts`, `scripts/e2e.mjs` |

Límites de esta tanda:

- **"Leer antes de editar" cuesta un paso** cuando el usuario adjuntó el archivo al mensaje: el modelo ya tiene el texto, pero igual debe llamar a `read_file`. `ZINARIX_AGENT_EDIT_UNREAD=allow` apaga la regla.
- **El aviso de "mostraste código pero no guardaste nada" no se llevó al escritorio** a propósito: en el chat es normal preguntar algo en modo Agente y recibir código de ejemplo, y el aviso empujaría al modelo a editar archivos sin que se lo pidan.
- El corte por bucle solo mira herramientas de archivos y comandos; leer dos veces una pantalla, una página o un log es normal y no cuenta.
- B3 no sigue el renombrado de una carpeta entera ni cierra la pestaña de un archivo borrado (la pestaña conserva su texto).
- Las protecciones del escritorio están probadas con un modelo simulado, no a mano en la app.

### Avance del 2026-11-25, tercera tanda (C2: paquete inicial)

Tipos, lint y formato pasan; la batería completa pasa (1 893 pruebas) y la prueba de punta a punta también.

**El paquete con el que arranca la interfaz bajó de 4,56 MB a 1,49 MB** (de 1,3 MB a 0,45 MB comprimido). El arranque medido pasó de 0,74 s a 0,66 s (mediana de 5, app compilada, esta PC).

- **Paneles laterales que ya no cargan al arrancar:** Docker, Hardware, Celular, Juegos, CAD, SketchUp, Estudio gráfico, Vercel, Supabase, Google Cloud, Correo, Revisión automática, Automatizaciones y Diseño. Explorador, Git, Ejecutar, Depurar, Pruebas y Buscar siguen en el paquete inicial.
- **Visores del editor que cargan al abrir su archivo:** notebook, vectores, pintura, escena de Godot, modelo 3D, G-code, SketchUp, vista previa de CAD, Playground, WhatsApp y el centro de seguridad.
- **Video Studio y el estudio 3D** se partieron en una parte ligera siempre montada (atajo Ctrl+Shift+V, puente con el agente, píldora de render, barra de grabación) y la parte pesada, que carga al abrirlos. **three.js (581 KB) ya no está en el arranque.** Las herramientas 3D del agente siguen funcionando con el estudio cerrado: el evento carga el módulo y se le reenvía en orden.
- **Tope en la prueba de punta a punta:** `pnpm e2e` falla si el script de arranque pasa de 1,8 MB, y ahora también abre un `.stl` y Video Studio para comprobar que los trozos diferidos cargan en la app real.

Archivos: `renderer/lazy.tsx` (nuevo), `App.tsx`, `components/Editor.tsx`, `components/video/VideoHost.tsx` y `components/three/Host3D.tsx` (nuevos), `VideoStudio.tsx`, `Studio3D.tsx`, `actions3d.ts`, `scripts/e2e.mjs`.

Límites: en la app real solo se abrieron el visor de modelos 3D y Video Studio; los 14 paneles laterales usan el mismo mecanismo pero no se abrieron uno por uno. Lo que queda en el paquete inicial es sobre todo React, xterm, el chat y los textos (`i18n.ts`, 229 KB de fuente); Monaco ya iba en su propio archivo. La parte de C2 del proceso principal (~80 servicios importados al arrancar) no se tocó, porque el arranque ya cumple la meta.

### Avance del 2026-11-25, cuarta tanda (C4: revisión de la edición con IA dentro del editor)

Tipos, lint y formato pasan; la batería completa pasa (1 909 pruebas) y la prueba de punta a punta también.

- **C4: Ctrl+K ya no es todo o nada.** El diálogo solo pide la instrucción; la respuesta se aplica en el editor (un paso de deshacer) y cada bloque cambiado queda marcado: líneas nuevas en verde, las que sustituyó arriba en rojo, con Aceptar / Rechazar por bloque y una barra con "Aceptar todo / Rechazar todo". Teclado: Alt+Y acepta, Alt+N rechaza, Alt+J va al siguiente, Alt+Shift+Y / Alt+Shift+N para todos. Rechazar un bloque devuelve sus líneas originales; aceptar solo quita las marcas.
- **Ctrl+K sin selección** edita la línea del cursor (antes mostraba "Selecciona código primero").
- **Regresión de la tercera tanda, corregida.** Al diferir los visores de CAD, la regla que da altura al editor (`.editor-split`) se fue con su CSS: el editor de texto quedaba con 5 px de alto hasta abrir algo de CAD. La prueba de punta a punta no lo vio porque su archivo tenía una sola línea. La regla vive ahora en `styles/04-editor.css`, igual que la de los botones "abrir en su visor" (`.crumb-action`), que tenía el mismo problema. Se revisó el resto del CSS diferido contra el script de arranque y no apareció otro caso.
- **La prueba de punta a punta cubre las dos cosas:** abre un archivo de cinco líneas, lanza Ctrl+K con el modelo sustituido por una respuesta fija, rechaza un bloque con el ratón, acepta otro con Alt+Y, rechaza el resto, guarda y compara el archivo en disco.

Archivos: `shared/lineHunks.ts` y `renderer/inlineReview.ts` (nuevos), `components/Modals.tsx`, `components/Editor.tsx`, `commands.ts`, `styles/04-editor.css`, `styles/overrides.css`, `components/cad/cad.css`, `components/vector/vector.css`, `test/lineHunks.test.ts`, `scripts/e2e.mjs`.

Límites: la revisión se probó con una respuesta fija, no con un modelo real. La comparación es por líneas completas, así que un cambio de una palabra marca la línea entera. Si se cambia de pestaña a mitad de la revisión, el texto queda como esté y las marcas se quitan. La instrucción no se puede corregir después de generar (hay que deshacer y volver a pedir).

### Avance del 2026-11-25, quinta tanda (B1: editor dividido, primera versión)

Tipos, lint y formato pasan; la batería completa pasa (1 918 pruebas) y la prueba de punta a punta también.

- **B1: un segundo editor a la derecha**, con sus propias pestañas, su cursor y su desplazamiento. Se abre con el botón de columnas de la barra de pestañas, con Ctrl+Alt+B o desde la paleta ("Dividir el editor"). Los dos editores muestran el mismo documento: lo que se escribe en uno aparece en el otro.
- **Los comandos siguen al editor que tiene el foco:** guardar, formatear, Ctrl+K, ir a línea y Ctrl+W actúan sobre el grupo activo. Ctrl+W en el grupo de la derecha cierra solo ese archivo de ese grupo; al cerrar el último, el grupo desaparece.
- **La prueba de punta a punta lo cubre:** divide, escribe en el editor de la derecha, comprueba que el texto llega al principal, cambia de archivo en el principal, guarda desde el de la derecha, compara el disco y cierra el grupo.

Archivos: `renderer/editorSplit.ts` y `components/EditorSplit.tsx` (nuevos), `store.ts`, `components/Editor.tsx`, `commands.ts`, `i18n.ts`, `styles/04-editor.css`, `test/editorSplit.test.ts`, `scripts/e2e.mjs`.

Límites de esta versión: son dos grupos fijos a la mitad (sin arrastrar el divisor ni un tercer grupo). El grupo de la derecha solo muestra archivos de texto que también están abiertos en el principal, así que cerrar el archivo en el principal lo cierra en los dos. Se oculta mientras el principal muestra un visor (imagen, 3D, navegador). No se restaura al reiniciar. La predicción de siguiente edición y los atajos Alt+Y / Alt+N de la revisión con IA solo funcionan en el editor principal; en el de la derecha la revisión se contesta con los botones. La barra de estado y el "archivo actual" del chat siguen al grupo principal.

### Avance del 2026-11-25, sexta tanda (C5: listas largas del explorador y del chat)

Tipos, lint y formato pasan; la batería completa pasa (1 933 pruebas) y la prueba de punta a punta también.

- **Explorador:** solo se montan las filas que están en pantalla (más un margen). Una carpeta de 3 000 archivos monta menos de 200 filas; antes montaba las 3 000. La barra de desplazamiento cubre la lista entera y el teclado (flechas, Inicio, Fin) llega a filas que no estaban montadas. De paso se quitó una búsqueda por fila que hacía el dibujado cuadrático.
- **Chat:** una conversación larga monta solo sus últimos 40 mensajes. Al subir se traen 40 más cada vez, sin mover el texto que se está leyendo; arriba hay también un botón "Mostrar mensajes anteriores". Leyendo al final, la parte montada se recorta de nuevo cuando pasa de 80.
- **La prueba de punta a punta lo cubre:** abre una carpeta de 3 000 archivos (cuenta las filas, se desplaza al final, usa Inicio / flechas / Fin) y una conversación guardada de 300 mensajes (cuenta los turnos montados, sube y comprueba que llegan más y que el texto no se mueve).

Archivos: `renderer/virtualList.ts` (nuevo), `components/Explorer.tsx`, `components/Chat.tsx`, `i18n.ts`, `styles/03-layout.css`, `styles/06-chat.css`, `test/virtualList.test.ts`, `scripts/e2e.mjs`.

Límites: la lista de resultados de búsqueda, el historial de chats y el panel de Git siguen sin ventana. En el chat no se midió la ganancia en tiempo, solo el número de turnos montados. Seleccionar todo el chat para copiarlo solo toma los mensajes montados.

### Avance del 2026-11-25, séptima tanda (Fase 4 sin costo: D4, D8, E3; estado de D3)

Tipos, lint y formato pasan; la batería completa pasa (1 939 pruebas) y la prueba de punta a punta también.

- **D4, hecho.** Con "Controlar la compu" activo, `computer_open` de una terminal, consola o intérprete (cmd, PowerShell, Windows Terminal, bash, regedit, wscript, python, node…) pide aprobación cada vez, sin opción "siempre". Lo mismo los atajos que llevan a una línea de comandos: Win+R, Win+X y Ctrl+Alt+T. Además, cuando la IA ya leyó contenido externo en la conversación (navegador, correo, `http_request`, @Docs o un servidor MCP), todo `computer_open` pide aprobación cada vez. Los clics y el tecleo siguen sin preguntar.
- **D8 (parte), hecho.** `app-config.json` lleva un número de secuencia (`seq`) que `pnpm config:sign` pone al firmar. Una app empaquetada guarda el mayor que aceptó y descarta un archivo firmado con un número menor, así una copia vieja no se puede reenviar. **Falta:** separar la llave de licencias de la de configuración.
- **Hallazgo: la firma publicada de `app-config.json` era inválida** con la llave que lleva la app desde el 2026-11-17, así que las apps empaquetadas ignoraban el archivo (avisos, licencias revocadas, interruptor de cobro). Se firmó de nuevo y hay una prueba que falla si vuelve a pasar. **No está publicado:** llega a las apps cuando se suban `website/app-config.json` y `.sig`.
- **E3, hecho.** La cobertura incluye el proceso principal y el código compartido del escritorio, con un piso de 55 % de líneas (medido: 59 %). Los paquetes siguen en 80 %. La interfaz no entra: la cubre `pnpm e2e`.
- **D3, ya estaba casi hecho** (lo de "sin fuses" del estudio estaba desactualizado): `electronFuses` en `package.json` apaga `NODE_OPTIONS` y `--inspect`, y activa la integridad del ASAR y cargar solo desde el ASAR. **Queda abierto `runAsNode`**, porque cuatro piezas lanzan Electron como Node: el OpenSCAD incluido, quitar fondo, el puente del servidor de lenguaje de Godot y el puente de red del sandbox en Linux. Cerrarlo pide pasar las tres primeras a `utilityProcess` y dejar el fusible abierto solo en Linux; no se hizo porque solo se puede comprobar con una app empaquetada.

Archivos: `main/computerTools.ts`, `main/agent.ts`, `main/remote.ts`, `main/license.ts`, `main/main.ts`, `scripts/sign-app-config.mjs`, `website/app-config.json` y `.sig`, `vitest.config.ts`, `test/computer-mode.test.ts`, `test/license.test.ts`.

Límites: D4 se probó con una computadora simulada, no a mano. El descarte por secuencia solo aplica en apps empaquetadas y no se probó contra el servidor real. Las apps instaladas antes del 2026-11-17 llevan la llave vieja y no aceptarán el archivo recién firmado (se quedan con el último que tenían).

### Avance del 2026-11-25, octava tanda (Fase 5 sin costo: B5, A8, A9)

Tipos, lint y formato pasan; la prueba de punta a punta pasa. De la batería completa pasan 1 957 pruebas y falló 1, `watch.test.ts`, que es intermitente: sola pasó tres veces seguidas.

- **B5 (parte), hecho: buscador en Ajustes.** Una caja arriba de la lista de secciones busca en todos los ajustes y en los atajos de teclado, sin importar acentos ni mayúsculas y con sinónimos en los dos idiomas ("word wrap" encuentra "Ajuste de línea"). Enter o clic abre la sección, desplaza hasta la fila y la resalta un momento. Un atajo abre la sección de atajos ya filtrada. **Falta:** `settings.json` editable y atajos con acordes y `when`.
- **A8 (parte), hecho: la búsqueda semántica corta el código por su estructura.** Antes eran ventanas fijas de 60 líneas que partían funciones por la mitad. Ahora los cortes caen donde empieza una declaración (por sangría y líneas en blanco, sin parser): las funciones quedan enteras, las pequeñas vecinas se agrupan y una clase larga se corta en sus métodos. Medido sobre el código de este repo (592 archivos): 2 747 de 5 143 trozos empiezan en una declaración de primer nivel, contra 789 de 4 970; y se indexa 14 % menos texto, porque ya no hay solape. Un índice sin vectores se rehace solo; uno con vectores conserva sus trozos y cambia archivo por archivo, para no volver a pagar _embeddings_. **Falta:** modelo de _embeddings_ local incluido, indexador en segundo plano y mapa del repo.
- **A9 (parte), hecho: el autocompletado no pregunta a mitad de una instrucción.** Si después del cursor queda código en la línea (algo más que cierres y puntuación), no se llama al modelo. Ahorra peticiones que casi nunca se aceptan.

Archivos: `renderer/settingsSearch.ts`, `components/Settings.tsx`, `styles/13-settings.css`, `main/knowledgeText.ts`, `main/knowledge.ts`, `shared/inlineCache.ts`, `renderer/inline.ts`, `scripts/e2e.mjs`, `test/settingsSearch.test.ts`, `test/chunkCode.test.ts`, `test/inlineCache.test.ts`.

Límites: el buscador de ajustes está comprobado en la app real con un ajuste del editor; las secciones que cargan sus datos aparte (MCP, nube, navegador, celular) solo tienen una o dos entradas cada una. La mejora de A8 está medida en dónde caen los cortes, no en si los resultados de búsqueda son mejores para una persona. La regla de A9 no se midió con un modelo real.

### Avance del 2026-11-25, novena tanda (revisión de la interfaz pantalla por pantalla)

Método: un guion de Playwright (fuera del repo) abrió la app compilada con un proyecto de muestra y recorrió las 9 entradas de la barra, las 24 apps de "Más", las 10 secciones de Ajustes, la paleta, el selector de modelo, el menú del explorador y tres tamaños de ventana, en tema oscuro y claro: unas 130 capturas. En cada pantalla midió el DOM: controles sin nombre accesible, botones de menos de 20 px, texto de menos de 11 px, texto cortado sin puntos suspensivos, contraste por debajo de 4,5:1 y controles fuera de la ventana.

Resultado general: la base es consistente (0 colores fuera de tokens, 0 tamaños de letra en px, 1 control sin nombre en toda la app, sin desbordes horizontales). Lo que falló y quedó corregido:

- **El chat pedía "Elige un modelo" con Ollama ya conectado.** En el primer arranque se detectaba Ollama pero no se elegía ningún modelo. Ahora, si no hay modelo elegido, se toma uno del runtime detectado (primero los que usan herramientas, luego el de mayor contexto) y el aviso lo dice. `renderer/firstModel.ts`, con pruebas.
- **Abrir Zinarix 3D creaba `media/3d` en el proyecto** sin haber renderizado nada (`scene3d:info` creaba la carpeta al pedir la ruta). Ahora se crea al escribir un render.
- **Explorador:** con nombres largos el icono se aplastaba contra el texto. Menú contextual con "Copiar ruta", "Copiar ruta relativa" y "Mostrar en la carpeta" (canal nuevo `workspace:reveal`, limitado al proyecto).
- **Barra de estado:** "Puente" e "IA" apagados tenían contraste 3,2:1 (2,6:1 en claro). Ahora solo se atenúa el icono.
- **Zinarix 3D:** 7 botones de "Herramientas básicas" cortados ("Transpar…", "Desde ar…"). La tarjeta es más ancha y los nombres pasan a dos líneas.
- **Estudio gráfico:** 6 nombres de plantilla cortados; ahora ocupan las líneas que necesitan.
- **Video Studio:** el selector cuadrícula / lista quedaba fuera del panel de medios; la fila ahora salta de línea.
- **Textos:** 6 comandos mezclaban los dos idiomas ("Docker: abrir panel / open panel"); "1 conectados"; la app "Abrir Playground de modelos / Playground" pasa a "Playground de modelos" con descripción.
- **Menores:** cerrar pestaña a 22 px mínimo, cerrar de la tarjeta 3D a 24 px, nombre accesible en los dos campos JSON del Playground, la explicación de un ajuste desactivado ya no se atenúa (estaba a 2,2:1 en claro).

Comprobado en la app real con 15 comprobaciones automáticas (modelo inicial, iconos, menú, rutas copiadas, textos, ausencia de `media/`) más la prueba de punta a punta.

Pendiente, visto pero no tocado:

- **Mica en la barra de título y de actividad.** Con "Efectos de ventana" encendido el fondo es el del sistema: el contraste de los iconos depende del fondo de pantalla y las capturas no lo registran. Falta medirlo con capturas reales de pantalla.
- El portapapeles del sistema no respondía en esta sesión, así que "Copiar ruta" se comprobó registrando lo que la app escribe, no leyendo el portapapeles real. "Mostrar en la carpeta" no se probó a mano.

### Avance del 2026-11-25, décima tanda (pendientes de la interfaz)

- **"Más" con buscador y columnas.** Caja de búsqueda por nombre y descripción (sin acentos ni mayúsculas; Enter abre el primer resultado, Esc limpia). Con el panel ancho o maximizado las apps van en columnas en vez de una lista larga.
- **Panel lateral maximizado:** campos, selectores y botones principales con ancho máximo de 560 px; tarjetas de CAD / SketchUp a 760 px. Las listas y tablas siguen usando todo el ancho. Clase nueva `sidebar-max`.
- **Ventana corta (menos de 620 px de alto):** el chat vacío oculta el logo y la explicación y las sugerencias empiezan arriba; en 640×480 se ven las cuatro.
- **Barra de actividad:** "Depurador" y "Pruebas" en vez de la frase explicativa completa.
- **Video Studio:** el minimapa no se dibuja mientras no hay clips.
- **Texto de 10 px** en las teclas de ayuda del chat y la regla de tiempo de video: sube a 11 px.

Comprobado en la app real con 20 comprobaciones automáticas (guion fuera del repo), más tipos, lint, formato, 1 964 pruebas y la prueba de punta a punta. El guion de arranque quedó en 1,51 MB. Sin comprobar a la vista: el minimapa de Video Studio (solo por código) y los paneles maximizados con una cuenta conectada (se revisaron sin cuenta).

### Avance del 2026-11-25, undécima tanda (B7: marcas de git y migas con símbolos)

- **Marcas de git en el margen del editor.** Junto a los números de línea: verde para líneas añadidas, morado para modificadas y una raya roja donde se borraron, comparando con la versión que git tiene en su índice. Se actualizan al escribir, al cambiar archivos en disco y tras cada operación del panel de Git. Funcionan en los dos lados del editor dividido. Un archivo sin seguimiento o fuera de un repositorio no lleva marcas. `shared/gitGutter.ts`, `renderer/gitGutter.ts`.
- **Moverse entre cambios y deshacer uno.** Alt+F3 / Alt+Shift+F3 van al cambio siguiente / anterior; "Deshacer este cambio" (clic derecho o F1) devuelve ese bloque a la versión de git, en un solo paso de deshacer.
- **Migas con símbolos.** Después de la ruta, la barra muestra la clase y la función donde está el cursor (hasta 4 niveles). Un clic abre la lista de símbolos del archivo. `shared/symbolPath.ts`, `components/SymbolCrumbs.tsx`.
- **"Ir a símbolo del archivo…"** como comando (Ctrl+Shift+O).

Comprobado en la app real por `pnpm e2e` (archivo confirmado en git y luego cambiado: aparecen las tres marcas, las migas dicen `Caja › abrir`, se deshace un cambio, se guarda y se compara el disco), más tipos, lint, formato y 1 979 pruebas. Sin comprobar: Alt+F3 en la app, las marcas tras un commit hecho desde el panel de Git, y los símbolos en lenguajes que dependen de un servidor de lenguaje (solo se probó TypeScript). De B7 faltan el panel de esquema fijo y varias carpetas raíz.

### Avance del 2026-11-25, duodécima tanda (B6: panel de extensiones)

- **Panel "Extensiones"** (en "Más", en la paleta y desde Ajustes → "Más temas…"). Busca en Open VSX, instala, activa / desactiva y quita. Carga diferida: no entra en el guion de arranque. `components/extensions/`.
- **Los temas de las extensiones ya se usan.** Un tema de color de VS Code se convierte en las 25 variables de la app y en un tema de Monaco. Lo que el tema no define se deriva del fondo y del texto del editor; los colores con transparencia se aplanan; el texto se corrige hasta cumplir contraste (7:1 el texto principal, 4,5:1 el resto); un borde chillón se sustituye por uno discreto. `shared/extContrib.ts`.
- **Los temas instalados aparecen en Ajustes → Apariencia**, junto a los 8 propios. Elegir uno propio deja el de la extensión. El tema elegido se guarda ya convertido, así que la app arranca con él sin parpadeo, y las demás ventanas lo siguen.
- **Fragmentos (snippets)** de las extensiones activas: se sugieren al escribir su prefijo, en los lenguajes que Monaco conoce.
- **Lenguajes**: se registran sus extensiones de archivo, comentarios, corchetes y pares. Las expresiones regulares de la configuración (wordPattern, sangría, onEnter) se descartan a propósito: vienen de una descarga.
- La terminal ahora sigue el cambio de tema aunque no cambie el ajuste `theme`.

Comprobado en la app real por `pnpm e2e` (extensión sembrada en disco: el tema aparece en Ajustes y en el panel, cambia los colores, se quita al desactivarla, y su fragmento se inserta y se guarda), y a mano con un guion aparte contra el Open VSX real: buscar "dracula", instalar "Dracula Theme Official" y usar su tema. Más tipos, lint, formato y 1 993 pruebas. Límites: sin gramáticas TextMate, un lenguaje nuevo se abre sin colores de sintaxis; los colores de sintaxis de un tema se aproximan con unos 20 tipos de token de Monaco; desactivar una extensión no retira un lenguaje ya registrado hasta reiniciar; no hay aviso de actualizaciones (solo el botón "Actualizar a…" al buscarla). Sin comprobar: temas de alto contraste reales, snippets de una extensión real, y el cambio de tema entre dos ventanas.

### Avance del 2026-11-25, decimotercera tanda (C3, parte: el chat partido en archivos)

- **`Chat.tsx` bajó de 4 244 a 2 802 líneas.** Lo que salió vive en `components/chat/`: `types.ts` (mensajes y pasos de herramientas), `ToolCard.tsx` (tarjeta de herramienta y su diff), `TurnView.tsx` (un mensaje, razonamiento y resumen), `ChatList.tsx` (lista lateral por proyectos), `handles.ts` (registro de chats abiertos y cierre), `phone.ts` (puente con el celular, `askAgent` / `askInChat`) y `helpers.ts` (comandos "/", imágenes, orden de mensajes).
- Es un movimiento de código sin cambios de comportamiento. `Chat.tsx` sigue exportando lo mismo, así que ningún otro archivo cambió.
- **Falta lo difícil de C3:** `ChatSession` sigue siendo una sola función de unas 2 300 líneas con todos sus estados. El siguiente paso es sacar el envío / streaming y la caja de mensaje a _hooks_ propios.

Comprobado con tipos, lint, formato, las pruebas del escritorio y `pnpm e2e` en la app compilada (que abre el chat y una conversación de 300 mensajes).

### Avance del 2026-11-25, decimocuarta tanda (C3, parte: la caja de mensajes y el contexto fuera de `ChatSession`)

- **`Chat.tsx` bajó de 2 802 a 2 251 líneas.** Dos archivos nuevos en `components/chat/`:
  - `Composer.tsx`: las piezas que solo dibujan — chat vacío (`ChatEmpty`), menú "+" (`AddMenu`), menú de reglas (`RulesMenu`), lista de "/" y "@" (`SuggestList`), cola de mensajes (`QueuePanel`), imágenes y adjuntos pendientes, y el selector de razonamiento (que estaba duplicado).
  - `context.ts`: lo que viaja con el mensaje (`currentFileContext`, `mentionContext`) y el cálculo del menú "/" y "@" (`suggestFor`), sin estado de React.
- Sin cambios de comportamiento. El estado sigue en `ChatSession`; las piezas lo reciben por props.
- **`pnpm e2e` ahora prueba la caja de mensajes:** "/" lista los comandos y elegir uno lo escribe, "@g" ofrece `@git`, el menú "+" abre, su casilla "incluir archivo" cambia sin cerrarlo y Esc lo cierra.
- **Sigue pendiente:** el envío / streaming (`send`, unas 250 líneas) y `runSlash` siguen dentro de `ChatSession`, que aún ronda las 1 900 líneas. No se probaron a mano el menú de reglas, la cola de mensajes ni las imágenes pegadas.

Comprobado con tipos, lint, formato, la batería completa (1 993 pruebas) y `pnpm e2e` en la app compilada.

### Avance del 2026-11-25, decimoquinta tanda (C3, parte: el streaming y los comandos "/" fuera de `ChatSession`)

- **`Chat.tsx` bajó de 2 251 a 2 100 líneas.** Dos archivos nuevos en `components/chat/`:
  - `stream.ts`: cómo se escribe una respuesta mientras llega, sin React ni i18n — `eventUpdate` (qué le hace cada evento del modelo a la respuesta), `applyUpdates`, `chatHistory` (lo que lee el modelo de la conversación) y `batcher` (un render por cuadro).
  - `slash.ts`: `runSlashCommand`, que recibe del chat solo lo que necesita (`SlashHost`).
- Sin cambios de comportamiento. `send` sigue en `ChatSession` pero ya solo orquesta: arma el contexto, crea los turnos, se suscribe y llama a `ai.chat`.
- **Pruebas nuevas:** `test/chatStream.test.ts` (11) cubre texto, herramientas (aprobación, salida, resultado), razonamiento, avisos, costo, error, historial y el agrupado por cuadro.
- **`pnpm e2e` ahora envía un mensaje de verdad por el chat**, con el modelo sustituido por eventos fijos: comprueba `/plan` y `/chat`, el texto de la respuesta, la tarjeta de herramienta terminada y la línea de tokens.
- **Sigue pendiente:** la cola de mensajes con sus reintentos y el registro de "handles" siguen dentro de `ChatSession`. No se probaron a mano los demás comandos "/" (`/commit`, `/indexar`, `/fases`, `/compactar`) ni un error a mitad de respuesta en la app; el error sí está en las pruebas unitarias.

Comprobado con tipos, lint, formato, la batería completa (2 004 pruebas) y `pnpm e2e` en la app compilada.

### Avance del 2026-11-25, decimosexta tanda (B1: divisor arrastrable, el editor dividido vuelve al reabrir; arreglo de B4)

- **Fallo corregido en las pestañas guardadas (B4):** cuando la ventana cargaba con la carpeta ya abierta (una recarga, una ventana abierta sobre una carpeta), las pestañas no se restauraban y, además, la barra vacía se guardaba encima de la sesión. `App.tsx` ponía la carpeta con `setState` sin pasar por `restoreTabs`. Ahora usa `initWorkspace` (en `store.ts`), que congela el guardado mientras pone la carpeta y luego restaura.
- **El divisor entre los dos editores se arrastra.** Entre 20 % y 80 %, con un mínimo de 160 px por lado; doble clic lo devuelve a la mitad; con el foco en él, las flechas lo mueven de 5 en 5 %. El ancho se guarda (`zx.editorSplitRatio`) y es el mismo para todas las carpetas.
- **El lado derecho se restaura** con sus archivos y el que estaba al frente: va en la sesión de pestañas de la carpeta (`TabSession.split`).
- **La revisión con IA (Ctrl+K) ya responde a Alt+Y / Alt+N / Alt+J en el editor de la derecha**: cada editor tiene su propia marca `zxReviewActive`.
- **Pruebas:** 7 nuevas (`editorSplit.test.ts`, `tabSession.test.ts`). `pnpm e2e` arrastra el divisor al 30 %, recarga la ventana, comprueba que el lado derecho vuelve con su archivo y su ancho, y que el doble clic lo deja a la mitad.
- **Sin probar en la app:** los atajos de la revisión en el lado derecho y las flechas sobre el divisor. La restauración se probó recargando la ventana, no cerrando y abriendo Zinarix.
- **Límites que siguen:** dos grupos como máximo; el de la derecha solo muestra archivos de texto abiertos también en el principal; la barra de estado sigue al principal.

Comprobado con tipos, lint, formato, la batería completa (2 011 pruebas) y `pnpm e2e` en la app compilada.

### Avance del 2026-11-25, decimoséptima tanda (B7: esquema del archivo en el explorador)

- **Sección "Esquema" bajo el árbol del explorador.** Lista las clases, funciones y campos del archivo del editor principal, con sangría por nivel y una letra de color por tipo (C clase, M método, F función, P campo…). Empieza cerrada (solo su encabezado) y recuerda si se dejó abierta (`zinarix.outline.open`). `components/Outline.tsx`, lógica pura en `shared/outline.ts`.
- **Sigue al cursor** (resalta el símbolo donde está y lo mantiene a la vista) y **un clic lleva al símbolo**. Con teclado: flechas, Inicio / Fin, Enter, y derecha / izquierda para abrir y cerrar ramas.
- **Filtro** por nombre, sin importar acentos ni mayúsculas: muestra las coincidencias con sus padres. **Contraer / expandir todo** en el encabezado.
- **Comando nuevo** en la paleta: "Mostrar el esquema del archivo".
- Solo se montan las filas en pantalla, igual que el árbol de archivos. El cargador de símbolos es uno solo para el esquema y las migas (`useDocumentSymbols`), y ya no devuelve los símbolos de otro archivo durante un cambio de pestaña.
- **Pruebas:** 9 nuevas (`outline.test.ts`). `pnpm e2e` abre el esquema, comprueba la lista en orden, el símbolo marcado, el clic, el filtro, contraer / expandir y cerrar.
- **Sin probar en la app:** el teclado dentro del esquema, archivos con cientos de símbolos y lenguajes que no sean TypeScript (dependen de que haya un proveedor de símbolos: el de TS / JS, JSON, CSS, HTML o un servidor de lenguaje en marcha).
- **Límites:** describe el editor principal, no el de la derecha; no se puede cambiar su alto (40 % del panel); no ordena por nombre ni por tipo.

Comprobado con tipos, lint, formato, la batería completa (2 020 pruebas) y `pnpm e2e` en la app compilada.

### Avance del 2026-11-25, decimoctava tanda (interfaz: quitar el aspecto de "hecha por IA")

- **Color de acento:** del morado (`#6d5ef6`) a un azul sobrio (`#2f6fdb` oscuro, `#1f5fd0` claro), con selección, foco y marca a juego (`ui/tokens.css`). Los 6 temas propios de `themes.ts` no cambian. También la página del control desde el celular (`phonePage.ts`).
- **Letra:** primero la del sistema (Segoe UI en Windows, San Francisco en macOS); Inter queda como respaldo. El `body` usa `--font-ui` en vez de fijar Inter.
- **Chat vacío:** sin logo ni título grande centrado ni tarjetas; una lista de ideas a la izquierda, pegada a la caja de mensajes.
- **Iconos:** la chispa quedó solo en efectos de video, generación de medios y "auto" del editor de imágenes; en los botones "preguntar / arreglar con IA" va un globo de mensaje. El icono del chat ya no lleva chispa.
- **Emojis:** fuera de las barras de pintura, vectores, 3D rápido y juegos sin conexión. Quedan en los avatares de bots de Automatizar (los elige el usuario).
- **Forma:** radio grande de 10 a 8 px; el botón de ayuda flotante ya no es redondo.
- Verificado con el recorrido de 51 pantallas (sin textos cortados ni errores), tipos, lint, formato, 2 020 pruebas y la prueba de punta a punta.

### Avance del 2026-11-25, decimonovena tanda (interfaz: segunda pasada contra el aspecto de IA)

- **Logo dentro de la app:** `renderer/public/logo.svg` es ahora una Z plana de un solo color, sin degradado de neón ni brillo. El icono del instalador (`build/logo.svg`), el del sitio y el de la página del celular (`main/zinarixLogo.ts`) siguen con el logo anterior.
- **Sin fondos borrosos:** fuera el `backdrop-filter` de los diálogos y del cuestionario; queda un velo oscuro liso.
- **Sombras más cortas** (`--shadow`, `--elevation-3`, `--elevation-4`) y sin el halo de foco alrededor de la caja del chat.
- **Etiquetas cuadradas:** 25 chips y badges en forma de píldora pasan a `--radius-sm`. Puntos de estado, medidores, interruptores y botones redondos no cambian.
- **Sin "levantarse" al pasar el ratón** en tarjetas y en el botón de ayuda.
- **Bienvenidas sobrias:** cuestionario e introducción alineados a la izquierda con logo de 36 px y título "Configuración inicial"; logo chico en la pantalla sin archivo y en el inicio del navegador; el logo de Zinarix 3D ya no gira al abrir.
- **Textos:** fuera los "¡Listo!" y "¡Hola!" en español e inglés.
- Verificado con el recorrido de 51 pantallas (0 errores), 20 comprobaciones en la app, tipos, lint, formato, 2 020 pruebas y la prueba de punta a punta.

### Avance del 2026-11-25, vigésima tanda (interfaz: tercera pasada contra el aspecto de IA)

- **Paleta base neutra (temas Oscuro y Claro):** grises sin tinte azulado y en capas, como un IDE clásico: editor `#1e1e1e` (igual al fondo de Monaco), paneles `#262626`, barras `#2b2b2b`, bordes más marcados. `--fg-dim` subió para conservar 4,5:1 sobre `--bg-4`.
- **Esquinas casi rectas:** los radios bajaron a 2 / 3 / 4 px (eran 4 / 6 / 8) en toda la app, desde los tokens.
- **Chat vacío:** sin título ni lista de "ideas para empezar"; queda una línea de explicación y los atajos.
- **Inicio del navegador:** sin logo, sin título y sin el bloque "Pídele al agente"; quedan la búsqueda y los accesos rápidos.
- Verificado: tipos, lint, formato, 2 020 pruebas, prueba de punta a punta y recorrido de 51 capturas sin errores (`%TEMP%\zs-ui\t6`).
- Sin tocar: el botón flotante de ayuda, las tarjetas del selector de modelo y de "Más", y los otros 6 temas.

### Avance del 2026-11-25, vigésima primera tanda (cuentas, llaves en línea y mensajes a todos)

- **Servidor de cuentas** en `website/api/` (funciones de Vercel sin dependencias): `/api/account` (registro, inicio de sesión, perfil, ligar una clave, cambiar contraseña), `/api/admin` (el dueño) y `/api/feed` (mensajes y claves canceladas, firmados). La lógica está en `website/api/_lib/core.mjs`; los datos, en Supabase por REST (`_lib/store.mjs`, tablas en `scripts/account-schema.sql`).
- **Panel del dueño** en `/admin` (`website/admin.html`): crear llaves (plan, correo, días, cantidad, nota), cancelarlas, mandar un mensaje a todas las apps, ver usuarios, desactivarlos y darles una contraseña temporal. Entra con `ADMIN_TOKEN`.
- **App:** Ajustes → "Cuenta de Zinarix" (registro e inicio de sesión, opcional). Una llave hecha en el panel para un correo con cuenta se activa sola en la app; una llave activada a mano queda ligada a la cuenta. Los mensajes salen como aviso en cada app, con o sin cuenta. Una llave cancelada en el panel deja de valer en la app.
- **Seguridad:** contraseñas con scrypt, sesión de 90 días guardada en el llavero del sistema, bloqueo de 15 minutos tras 8 contraseñas malas, el feed va firmado con la llave de licencias (prefijo propio) y la app empaquetada solo habla con el servidor oficial.
- **Para publicarlo (falta, lo hace el dueño):**
  1. Crear un proyecto en Supabase y correr `scripts/account-schema.sql` en su SQL Editor.
  2. En Vercel → Settings → Environment Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (la `service_role`), `ADMIN_TOKEN` (24 caracteres o más, al azar) y `LICENSE_PRIVATE_KEY` (la llave actual, la del 17 de noviembre).
  3. Desplegar el sitio y entrar a `https://zinarix-studio.vercel.app/admin`.
- **Probar sin publicar:** `pnpm account:dev` levanta el servidor en `http://127.0.0.1:8787` con datos en memoria; la app de desarrollo lo usa con `ZINARIX_ACCOUNT_URL`.
- Verificado: tipos, lint, formato, 2 049 pruebas (29 nuevas), prueba de punta a punta y 17 comprobaciones en la app real contra el servidor local.
- Sin hacer: verificación del correo y "olvidé mi contraseña" por correo (hace falta un servicio de envío), y prueba contra un Supabase real.

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

| Qué                                            | Dato                                                        |
| ---------------------------------------------- | ----------------------------------------------------------- |
| Código de la app de escritorio                 | ~172 000 líneas de TypeScript en 421 archivos               |
| Interfaz (renderer)                            | 81 000 líneas TS/TSX + 24 000 de CSS                        |
| Archivos más grandes                           | `main.ts` 5 822 · `Chat.tsx` 4 077 · `agent.ts` 3 582       |
| Canales IPC                                    | ~550, todos por un solo punto con validación                |
| Herramientas que recibe el modelo en cada paso | ~175 (más las de MCP)                                       |
| Pantallas distintas                            | ~55                                                         |
| Pruebas                                        | 140 archivos, ~1 820 casos                                  |
| Cobertura medida                               | Solo `packages/*` (~13 000 líneas); el escritorio no cuenta |
| `any`, `@ts-ignore`, TODO/FIXME                | 0 · 0 · 0                                                   |
| `React.lazy`                                   | 0                                                           |
| Instalador de Windows                          | ~209 MB                                                     |

## 4. Lo que está bueno (no tocar)

**Seguridad de la app**

- Las siete ventanas y vistas usan `sandbox`, `contextIsolation` y sin `nodeIntegration` (`main.ts`).
- Todo el IPC pasa por un único punto que revisa el origen `app://` y valida con Zod; ESLint prohíbe saltárselo.
- CSP estricta sin `unsafe-eval` y cero `innerHTML` en la interfaz.
- La aprobación de acciones se decide en el proceso principal. "Siempre" vale solo para ese comando exacto; `git push` y enviar correo preguntan siempre (`approvalPolicy.ts`).
- Llaves en el llavero del sistema, bóveda AES-256-GCM y redactor de secretos en cada línea de log.

**Motor del agente**

- Checkpoints en disco con retroceso por turno y revisión por bloque.
- Agentes en segundo plano en _worktrees_ de git, con tope de costo y tiempo (`tasks.ts`).
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

| #                        | Problema                                                                                                                                                                                                                                                      | Evidencia                                          | Arreglo                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A1 🟠                    | **Caché de prompts a medias.** Hecho para Anthropic. Falta OpenAI (`prompt_cache_key`), Gemini (`cachedContent`), Bedrock y Vertex, y comprobar que el prompt de sistema y la lista de herramientas no cambian entre pasos (si cambian, la caché no acierta). | `packages/providers/src/adapters/*`                | Mismo patrón en los demás adaptadores; prompt de sistema idéntico entre turnos; herramientas en orden fijo. |
| A2 🔴                    | **175 herramientas en cada petición.** Un proyecto de Python recibe las de SketchUp, Godot, video y correo; los modelos baratos se confunden.                                                                                                                 | `agent.ts:322-525`, `:1499`                        | Un juego base de ~12 herramientas de código y una meta-herramienta "activar grupo".                         |
| A3 🔴                    | **No se resume la conversación ni se cuenta contra el límite del modelo.** Una tarea larga crece hasta que el proveedor da error.                                                                                                                             | `usage.ts:68-70`; `ai.ts:1393`                     | Presupuesto = contexto del modelo − reserva de salida; al 80 %, resumir los turnos viejos.                  |
| A4 🔴                    | **El agente no ve los errores del LSP.** Editar devuelve solo `Edited <ruta>`.                                                                                                                                                                                | `agent.ts`; cero `lsp`/`diagnostic`                | Devolver los diagnósticos con cada edición; añadir `go_to_definition`, `find_references`, `rename_symbol`.  |
| A5 🟠 (parte ✅)         | **Ediciones frágiles.** Coincidencia exacta y única; sin edición múltiple ni parche.                                                                                                                                                                          | `packages/core/src/editMatch.ts`                   | Hecho: tolera fin de línea y sangría distintos. Falta `multi_edit` y `apply_patch`.                         |
| A6 🟠                    | **Errores del bucle mal tratados.** Una respuesta cortada parece terminada; el JSON inválido se vuelve `{}`; a los 60 pasos se detiene sin avisar.                                                                                                            | `agent.ts:231`, `:1013-1020`, `:1752`              | Continuar si se cortó; reportar el JSON malo al modelo; avisar del límite; reintentar el paso una vez.      |
| A7 🟠                    | **Dos bucles de agente distintos** (escritorio y CLI), con cargadores duplicados.                                                                                                                                                                             | `agent.ts` vs `packages/core/src/headlessAgent.ts` | Un solo bucle en `@omni/core`.                                                                              |
| A8 🟠                    | **Búsqueda semántica básica.** Trozos de 60 líneas, sin modelo de _embeddings_ por defecto, vectores en un JSON.                                                                                                                                              | `knowledge.ts:36-40`, `:496`                       | Trozos por símbolo (tree-sitter), modelo local incluido, indexador en segundo plano, mapa del repo.         |
| A9 🟠                    | **Autocompletado lento.** Formato de chat, 550 ms de espera, sin caché; el método FIM existe y nadie lo llama.                                                                                                                                                | `inline.ts:8`; `openai-compatible.ts:307-325`      | Enrutar a endpoints FIM, caché por prefijo.                                                                 |
| A10 ✅ (primera versión) | No se medía la calidad del agente.                                                                                                                                                                                                                            | `evals/`                                           | Hecho: banco de 12 tareas con `omni agent`. Falta llegar a 30–50 y la línea base con un modelo capaz.       |
| A11 🟡                   | **Agentes de terminal y MCP a medias.** Cada turno con un CLI externo arranca de cero; MCP sin OAuth, recursos ni prompts.                                                                                                                                    | `cli-agent.ts:172`; `mcp.ts:41-45`                 | Reanudar sesión del CLI; foto con git antes y después; completar MCP.                                       |

### B. Editor

| #     | Problema                                                                                                                                              | Evidencia                             | Arreglo                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| B1 🔴 | **Un solo editor para toda la app.** Sin editores divididos ni grupos.                                                                                | `store.ts`; `Editor.tsx:73`           | Grupos de editor, cada uno con su Monaco. Es el cambio de estructura más caro del plan. |
| B2 ✅ | Se podían perder cambios sin guardar al cambiar de carpeta.                                                                                           | `store.ts`                            | Hecho: se pregunta antes en todos los caminos que salen de la interfaz.                 |
| B3 🟠 | **El aviso de cambios en disco no dice qué archivo cambió**; los archivos abiertos no se recargan tras un `git checkout`.                             | `shared/api.ts`; `Explorer.tsx:76-82` | Evento con rutas; recargar si no está sucio.                                            |
| B4 🟠 | **Las pestañas no se restauran** al reiniciar (por confirmar).                                                                                        | `shared/layout.ts`                    | Guardar pestañas y cursor por carpeta.                                                  |
| B5 🟠 | **Configuración pobre.** Sin `settings.json` ni buscador; atajos sin acordes.                                                                         | `Settings.tsx`; `keys.ts:17-33`       | Ajustes en JSON con buscador; atajos con acordes y `when`.                              |
| B6 🟠 | Panel de extensiones conectado: temas, fragmentos y lenguajes de Open VSX. Faltan gramáticas (colores de lenguajes nuevos) y avisos de actualización. | `shared/api.ts`                       | Gramáticas TextMate si se pide.                                                         |
| B7 🟡 | Marcas de git en el margen, migas con símbolos y esquema (outline) en el explorador: hechos. Faltan varias carpetas raíz.                             | `Editor.tsx:138-211`                  | Añadir en ese orden.                                                                    |

### C. Interfaz

| #     | Problema                                                                                                                                | Evidencia                                            | Arreglo                                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1 ✅ | Ninguna barrera de errores: un fallo en un panel desmontaba toda la app.                                                                | —                                                    | Hecho: una barrera por área.                                                                                                                                 |
| C2 🟠 | **Todo se carga al arrancar.** three.js y el estudio 3D están en el camino de inicio; el proceso principal importa ~80 servicios.       | `vite.config.ts:14`; `App.tsx:1-35`; `Editor.tsx:42` | Carga diferida de estudios y paneles; servicios al primer uso. Medido el 2026-11-23: abre en 0,74 s, así que baja de prioridad; queda el tamaño del paquete. |
| C3 🟠 | **El chat es un componente de ~2 300 líneas** con 36 estados. Ya partido en archivos (`components/chat/`); falta dividir `ChatSession`. | `Chat.tsx`                                           | Partirlo y sacar el estado a un _store_.                                                                                                                     |
| C4 🟠 | **La edición con IA es modal.** Ctrl+K exige selección y se acepta todo o nada.                                                         | `Modals.tsx:707-832`                                 | Diff dentro del editor, aceptar o rechazar por bloque con teclado.                                                                                           |
| C5 🟠 | **Listas sin virtualizar** (chat, explorador, búsqueda).                                                                                | `Chat.tsx`                                           | Virtualizar chat y explorador primero.                                                                                                                       |
| C6 🟠 | **El código en el chat no tiene colores.**                                                                                              | `Markdown.tsx:384-386`                               | Colorear con Monaco.                                                                                                                                         |
| C7 🟠 | **Demasiado a la vista.** 12 iconos sin texto, "Más" con 24 entradas, ~8 controles en la caja de mensaje, selector de 553 modelos.      | `Chrome.tsx:335-361`                                 | Paneles como módulos (sección 7); caja de mensaje con 3 controles visibles.                                                                                  |
| C8 🟡 | **Sistema de diseño a medio usar.** Del kit `ui/` solo se importa `Badge`; emojis como iconos en Pintura, Vector y 3D.                  | `ui/`; `PaintView.tsx`                               | Migrar pantalla por pantalla.                                                                                                                                |
| C9 🟡 | **Textos repartidos** en 25 módulos y ~86 comparaciones sueltas; todo sistema que no esté en inglés recibe español.                     | `i18n.ts`                                            | Un solo `t()`; inglés por defecto salvo sistemas en español.                                                                                                 |

### D. Seguridad

| #     | Problema                                                                                                                                                                                                                          | Evidencia                                         | Arreglo                                                                                         |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| D1 🟠 | **Un token robado del celular daba control total de la PC.** Ya hecho: terminal apagada por defecto, caducidad a 30 días sin uso, sin "acceso total" desde el celular. **Falta:** el tráfico va por HTTP sin cifrar en `0.0.0.0`. | `phone.ts`                                        | Cifrado en la red local o solo túnel.                                                           |
| D2 🔴 | **Binarios sin firma y actualización automática.** La llave de minisign existe, pero los instaladores llevan el texto de relleno.                                                                                                 | `package.json`; `install.sh`; `install.ps1`       | Firma de Windows y notarización de Apple; poner la llave pública en el próximo release firmado. |
| D3 🔴 | **Sin "fuses" de Electron** en una instalación que el usuario puede modificar.                                                                                                                                                    | Sin `@electron/fuses`                             | Apagar `RunAsNode` y `NODE_OPTIONS`; activar integridad del ASAR.                               |
| D4 🟠 | **"Acceso total" + "Controlar la compu"**: una página maliciosa puede ejecutar cosas; `computer_open` se salta la aprobación de comandos.                                                                                         | `approvalPolicy.ts:123`; `computerDrivers.ts:301` | Preguntar siempre antes de abrir terminales y después de leer web o correo.                     |
| D5 ✅ | La etiqueta de "contenido no confiable" se podía cerrar desde dentro.                                                                                                                                                             | `packages/core/src/context.ts`                    | Hecho.                                                                                          |
| D6 ✅ | Los comandos del chat heredaban credenciales del entorno.                                                                                                                                                                         | `agent.ts`                                        | Hecho.                                                                                          |
| D7 🟠 | **Huecos en las rutas prohibidas en Windows** (mayúsculas, Edge, gcloud, `~/.omni-signing`). Por confirmar.                                                                                                                       | `system.ts:159-207`                               | Comparar en minúsculas; añadir rutas.                                                           |
| D8 🟠 | **Una sola llave firma licencias y configuración remota**, y la configuración se puede reenviar vieja.                                                                                                                            | `website/api/license.mjs:26`; `remote.ts:17-36`   | Dos llaves; número de secuencia que solo sube.                                                  |
| D9 🟡 | Navegador de la IA con cookies reales; FFmpeg sin suma de verificación; Dependabot sin npm; informes de seguridad en el repo.                                                                                                     | `browser.ts:36`; `.github/dependabot.yml:5`       | Sesión aparte; fijar SHA-256; sacar los informes.                                               |

### E. Calidad y proceso

| #                       | Problema                                                                                                       | Evidencia                        | Arreglo                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| E1 ✅                   | Sin visibilidad de fallos; el actualizador se tragaba los errores.                                             | —                                | Hecho: registro en archivo y "Exportar diagnóstico".                             |
| E2 ✅                   | Se publicaba sin pasar pruebas.                                                                                | `release.yml`                    | Hecho: el release depende del CI.                                                |
| E3 🟠                   | **La cobertura no mide el producto.**                                                                          | `vitest.config.ts`               | Incluir el escritorio con umbral que solo suba.                                  |
| E4 ✅ (primera versión) | No había prueba de punta a punta en CI.                                                                        | `apps/desktop/scripts/e2e.mjs`   | Hecho en Windows con la app compilada. Falta el instalador y los otros sistemas. |
| E5 🟠                   | **Pruebas que se saltan en silencio** si falta Blender, Docker, etc.                                           | `describe.skipIf`                | Flujo nocturno con esas herramientas.                                            |
| E6 🟠                   | **Historial ilegible.** Commits llamados `t`, `g`, `e`; todo directo a `main`.                                 | `git log`                        | Rama por cambio y mensajes con sentido.                                          |
| E7 🟡                   | Documentación vieja (README dice v0.6.2 y "180 pruebas"); paquetes vacíos; faltan `CHANGELOG` y `SECURITY.md`. | `README.md`                      | Limpiar y generar los números en CI.                                             |
| E8 🟠                   | **`main` no pasa su propio CI**: formato sin aplicar y dos pruebas en rojo (ver sección 0).                    | `pnpm format:check`, `pnpm test` | Commit de formato; volver a firmar el catálogo; corregir el CSS.                 |

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

| Fase                              | Qué                                       | Tiempo estimado      | Criterio de salida                                                                         |
| --------------------------------- | ----------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| **0. Cortar el riesgo** ✅        | C1, B2, E1, D1, D5, D6, E2                | 1 semana             | Un error en un panel no cierra el editor; hay archivo de log; no se publica con CI en rojo |
| **1. Medir** ✅ (primera versión) | A10, E4, E8, tiempo de arranque           | 1–2 semanas          | Tabla base con aciertos, costo por tarea y segundos de arranque; `main` en verde           |
| **2. Motor del agente**           | A7 primero; luego A1–A6                   | 3–4 semanas          | Costo por tarea a menos de la mitad y más aciertos con el modelo barato                    |
| **3. Editor y arranque**          | C2, B1, B3, B4, C4, C5, C6                | 3–4 semanas          | Abre en menos de 2 s; editor dividido; `git checkout` actualiza los archivos               |
| **4. Confianza para distribuir**  | D1 (cifrado), D2, D3, D8, E3, E5          | 2 semanas + trámites | Instalador firmado; el release falla si falta una firma                                    |
| **5. Pulido y ventaja**           | A8, A9, A11, B5–B7, C3, C8, C9, sección 6 | Continuo             | —                                                                                          |

Las fases 2 y 3 pueden ir en paralelo. La Fase 1 no se salta: sin medición no se sabe si la Fase 2 funcionó.

## 9. Cómo saber si mejora

| Métrica                                        | Hoy                                                                           | Meta                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| Tareas resueltas del banco (modelo barato)     | 2 de 12 con `qwen2.5-coder:7b` local (ruidoso); sin medir con un modelo capaz | Subir en cada fase                                |
| Tokens de entrada por tarea                    | Sin medir                                                                     | Menos de la mitad tras la Fase 2                  |
| Herramientas enviadas en un proyecto de código | ~175                                                                          | ≤ 20                                              |
| Tiempo de arranque                             | 0,66 s (app compilada, PC de desarrollo)                                      | < 2 s también con el instalador y en una PC lenta |
| Paquete inicial de la interfaz                 | 1,49 MB (era 4,56 MB)                                                         | < 1,5 MB                                          |
| Fallos de panel que tumban la app              | Ninguno (desde la Fase 0)                                                     | Ninguno                                           |
| Instaladores firmados                          | 0 de 3                                                                        | 3 de 3                                            |
