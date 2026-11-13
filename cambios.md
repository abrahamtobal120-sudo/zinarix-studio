# Cambios: funciones que tiene Cursor y Zinarix Studio no

Este documento pide crear las funciones que le faltan a Zinarix Studio frente a Cursor. Sale de revisar el código del repositorio y toda la documentación oficial de Cursor (cursor.com/docs y cursor.com/help, 12 de noviembre de 2026). Cada petición dice qué existe hoy, qué hay que crear, en qué archivos y cómo saber que quedó bien.

**Solo cosas locales.** Zinarix corre en la PC del usuario. Por eso se quitó todo lo que en Cursor depende de sus servidores: agentes en la nube, BugBot en GitHub, automatizaciones, Origin, integraciones con Slack/Teams/Jira/Linear, SDK, cuentas de equipo, app móvil, transcripciones compartidas, el clasificador de permisos en la nube y el chat de voz con Grok. La lista completa está al final, en "Lo que se dejó fuera".

Las peticiones 1 a 13 son de la primera revisión. De la 14 a la 44 salen de revisar la documentación de Cursor a fondo. La 12 se quitó porque depende de servidores.

Las rutas son relativas a `apps/desktop/src/` salvo que digan otra cosa.

## Resumen y orden sugerido

| # | Petición | Impacto | Esfuerzo | Base que ya existe |
|---|---|---|---|---|
| 1 | Pegar imágenes en el chat (**en curso**: `main/chatImages.ts`, sin commit) | Alto | Bajo | Los adaptadores ya mandan imágenes |
| 2 | Soporte MCP para el agente | Alto | Medio | Patrón de herramientas de `cloudTools.ts` |
| 3 | Búsqueda por significado en el proyecto | Alto | Medio | `embed()` ya existe en 3 adaptadores |
| 4 | Memorias entre conversaciones | Medio | Bajo | Base SQLite y bloque de reglas |
| 5 | Copia aislada (worktree) por chat | Medio | Medio | Los chats ya aceptan una carpeta propia |
| 6 | Documentación externa (`@Docs`) | Medio | Medio | Depende de la #3 |
| 7 | Tab que predice la siguiente edición | Alto | Medio-alto | Texto fantasma en `inline.ts` |
| 8 | Revisión automática de PRs | Medio | Medio | `gh` y el Vigilante (`watch.ts`) |
| 9 | Servidores de lenguaje (LSP) | Alto | Alto | Nada |
| 10 | Panel de Problemas | Medio | Bajo | Nada (va junto con la #9) |
| 11 | Depurador (DAP) | Medio | Alto | Panel Ejecutar (`RunPanel.tsx`) |
| ~~12~~ | ~~Agentes en la nube~~ (quitada: depende de servidores; la parte local pasó a la #38) | — | — | — |
| 13 | Temas externos y extensiones | Bajo-medio | Alto | Temas fijos en `themes.ts` |
| 14 | Modos Preguntar / Planear / Depurar / propios | Alto | Medio | Interruptor agente/chat (`Chat.tsx:888`) |
| 15 | Lista de tareas del agente | Medio | Bajo | Nada |
| 16 | Dirigir al agente mientras trabaja | Medio | Medio | Cola de mensajes (`Chat.tsx:1394`) |
| 17 | Restaurar a cualquier mensaje | Alto | Bajo | `Checkpoint` (`agent.ts:544`) |
| 18 | Medidor de contexto y resumen del chat | Medio | Bajo | `compactToolResults` (`agent.ts:1993`) |
| 19 | Más tipos de `@` | Alto | Medio | `mentionedFiles` (`Chat.tsx:147`) |
| 20 | Reglas con frontmatter, anidadas y globales | Alto | Bajo | `RULES_FILES` (`ai.ts:63`) |
| 21 | Skills (`SKILL.md`) | Alto | Medio | Nada |
| 22 | Subagentes propios | Medio | Medio | `delegate_to_ai` (`agent.ts:298`) |
| 23 | Hooks | Medio | Medio | Nada |
| 24 | Comandos `/` propios | Medio | Bajo | 12 comandos fijos (`Chat.tsx:129`) |
| 25 | Plugins de agente | Medio | Medio | Depende de #2, #20-#24 |
| 26 | Archivo `.zinarixignore` | Medio | Bajo | `isSecretFile` (`guard.ts:23`) |
| 27 | Permisos guardados y modos de ejecución | Alto | Medio | `approvalKey` (`agent.ts:365`) |
| 28 | Sandbox para comandos | Medio | Alto | Nada |
| 29 | Revisar cambios por bloque y revisión local | Alto | Medio | `DiffView` (`Chat.tsx:523`) |
| 30 | Chats laterales y bifurcar | Medio | Medio | Editar/regenerar el último mensaje |
| 31 | Búsqueda de conversaciones mejorada | Bajo | Bajo | `LIKE` en `history.ts:80` |
| 32 | Dictado por voz local | Medio | Medio | Nada |
| 33 | IA en la terminal y en Git | Medio | Bajo | Mensaje de commit con IA (`ai.ts:772`) |
| 34 | Notebooks Jupyter | Medio | Alto | Nada |
| 35 | Importar configuración de VS Code / Cursor | Medio | Bajo | Atajos editables (`Settings.tsx:539`) |
| 36 | Enlaces `zinarix://` | Bajo | Bajo | Nada |
| 37 | Modelo automático y contexto máximo | Medio | Medio | Roles por modelo (`omni.ts:217`) |
| 38 | Agente en la CLI y protocolo ACP | Medio | Medio | `omni ask` (`apps/cli/src/commands/ask.ts:140`) |
| 39 | Canvas (artefactos interactivos) | Medio | Medio | Markdown del chat |
| 40 | Modo diseño en el navegador | Alto | Medio | Localizar elementos (`browser.ts:90`) |
| 41 | Navegador del agente: consola, red, capturas | Alto | Bajo | Herramientas `browser_*` (`agent.ts:238`) |
| 42 | Preguntar al usuario y generar imágenes | Medio | Bajo | Nada |
| 43 | Objetivos largos y tareas repetidas | Medio | Medio | Vigilante (`watch.ts`) |
| 44 | Editor y Git más completos | Medio | Medio | `Editor.tsx`, `GitModals.tsx` |

Para cualquier canal IPC nuevo se siguen 4 pasos, y `apps/desktop/test/ipc-contract.test.ts` falla si no coinciden:
1. Tipo en `OmniApi` (`shared/api.ts`).
2. Nombre en `CHANNELS` (`shared/api.ts`, ~:1225).
3. Exponerlo en `preload/preload.ts` con `call('ns:nombre')`.
4. Registrarlo con `handle('ns:nombre', z.tuple([...]), fn)` en `main/main.ts`.

---

## 1. Crear: pegar y arrastrar imágenes en el chat

**Hoy.** El tipo `ContentPart` ya acepta imágenes (`packages/shared/src/schemas.ts:181-205`). Los adaptadores ya las convierten al formato de cada proveedor: `anthropic.ts:46`, `openai-compatible.ts:10`, `openai-responses.ts:29`, `google-gemini.ts:58`, `aws-bedrock.ts:528` y `replicate.ts`. Pero ninguna parte de la app las crea:
- El cuadro de texto del chat (`renderer/components/Chat.tsx:1856`) no tiene `onPaste` ni manejo de soltar archivos.
- El clip (`Chat.tsx:1891`) solo inserta `@`.
- `buildContextMessages` (`packages/core/src/context.ts:18`) siempre devuelve texto.
- El esquema de `ai:chat` (`main/main.ts:492`) solo acepta texto.

**Crear:**
1. En `Chat.tsx`, `onPaste` y `onDrop` en el cuadro de texto que lean imágenes (`png`, `jpg`, `webp`, `gif`) y las guarden como adjuntos con vista previa en miniatura y botón de quitar.
2. Que el clip abra un selector de archivos que también acepte imágenes.
3. Ampliar `ChatContext` (`shared/api.ts:513`) o el pedido del chat con `images: {mediaType, data}[]`, y el esquema zod en `main.ts`.
4. Que `buildContextMessages` arme `ContentPart[]` cuando haya imágenes.
5. Si el modelo elegido no tiene `capabilities.vision` (`schemas.ts:61`), avisar antes de enviar.
6. Guardar en el historial que hubo una imagen (hoy `history.ts:169` muestra "[imagen]"; está bien, pero que se vea la miniatura en el chat abierto).
7. Límite de tamaño (por ejemplo, 5 MB por imagen y reducir a 1568 px de lado si es más grande).

**Listo cuando:** pegas una captura con Ctrl+V, ves la miniatura, la envías a un modelo con visión y responde sobre lo que se ve en ella. Con un modelo sin visión sale un aviso claro. Los agentes CLI siguen mostrando "[imagen omitida]" (`cli-agent.ts:179`) sin romperse.

---

## 2. Crear: soporte MCP para el agente propio

**Hoy.** No hay cliente MCP. Lo único es `packages/providers/src/adapters/cli-agent.ts:549`, que muestra las llamadas MCP que hace Codex. Las herramientas del agente son una lista fija (`TOOLS`, `main/agent.ts:111-294`).

**Crear:**
1. Un módulo `main/mcp.ts` que use `@modelcontextprotocol/sdk` como cliente y soporte servidores `stdio` (lanzar un comando) y `http` (Streamable HTTP, con cabeceras para tokens).
2. Configuración en `.zinarix/mcp.json` (por proyecto) y en el inicio de Zinarix (global), con el mismo formato que usan Cursor y Claude Code (`{"mcpServers": {"nombre": {"command", "args", "env"} | {"url", "headers"}}}`). Así se pueden reusar las configuraciones que el usuario ya tiene.
3. Guardar los tokens y las variables `env` secretas en el almacén cifrado que ya usan Vercel y Supabase (`main/token-store.ts`), no en texto plano.
4. Seguir el patrón de `cloudTools.ts`:
   - Exponer `mcpTools()`, con nombres `mcp__<servidor>__<herramienta>`.
   - Exponer `mcpPreview()` con un `SystemPreview` (`system.ts:212`) para pedir aprobación.
   - Exponer `runMcpTool()`.
5. En `agent.ts`:
   - Pasar las herramientas MCP al `loop` (:790).
   - Agregar una rama MCP en la vista previa (:1136) y en la ejecución (:1249).
   - Las herramientas MCP marcadas `readOnlyHint` entran a `READ_ONLY` (:347, :910) y las demás piden aprobación.
   - Dejar que funcionen sin carpeta abierta (:1120).
   - Pasar los resultados por `untrusted()` (:1116), porque vienen de fuera.
6. Un panel en Configuración: lista de servidores, estado (conectado/error), herramientas de cada uno, interruptor por servidor y por herramienta, y botón de reiniciar.
7. Soportar también recursos y prompts de MCP (los prompts como comandos `/` en el chat).
8. Detalles que tiene Cursor y conviene copiar:
   - Leer también `.cursor/mcp.json` y `~/.cursor/mcp.json`, para usar las configuraciones que el usuario ya tenga.
   - En cada servidor `stdio`: `type`, `command`, `args`, `env` y `envFile`. En los remotos: `url`, `headers` y `auth` (`CLIENT_ID`, `CLIENT_SECRET`, `scopes`).
   - Reemplazar variables en la configuración: `${env:NOMBRE}`, `${userHome}`, `${workspaceFolder}`, `${workspaceFolderBasename}` y `${pathSeparator}`.
   - OAuth con PKCE, registro dinámico del cliente y renovación del token. La respuesta llega a `http://localhost:<puerto>/callback`.
   - Soportar `roots` (avisar al servidor qué carpeta está abierta) y `elicitation` (que el servidor pida un dato al usuario con un formulario).
   - Aprobar la conexión de cada servidor la primera vez, además de cada llamada.
   - Un canal "Registro MCP" con lo que imprime cada servidor, para ver por qué falla.
   - Resultados con imágenes (`{type:"image", data, mimeType}`) que pasen al modelo como imagen.

**Listo cuando:** agregas un servidor MCP (por ejemplo, el de sistema de archivos o uno de GitHub), el agente lo ve, lo usa pidiendo aprobación, y si el servidor se cae se muestra el error sin colgar el chat.

---

## 3. Crear: índice y búsqueda por significado en el proyecto

**Hoy.** Las herramientas `search` y `glob` (`agent.ts:1573`, `:1666`) usan ripgrep por texto (`main/workspace.ts:121`). La interfaz `embed()` ya existe (`packages/providers/src/types.ts:54`) y está hecha en `openai-compatible.ts:290`, `openai-responses.ts:201` y `google-gemini.ts:334`. Pero `OmniCore` no la expone, aunque ya hay un rol `'embeddings'` en `packages/core/src/config.ts:23`.

**Crear:**
1. `OmniCore.embed(texts)` en `packages/core` que use el modelo del rol `embeddings`. Que también acepte Ollama local para que funcione sin internet y sin costo.
2. Un indexador en el proceso principal:
   - Recorre `listFiles` respetando `.gitignore`.
   - Corta los archivos en trozos por función o clase (o cada ~60 líneas si no hay forma de detectarlas).
   - Calcula un hash de cada trozo y solo vuelve a calcular los que cambiaron.
3. Guardar los vectores en la base SQLite que ya existe (`packages/core/src/db.ts`), en una tabla nueva con migración (`schema_version`). Primera versión: búsqueda por similitud coseno en memoria; si es lenta, `sqlite-vec`.
4. Volver a indexar en segundo plano cuando se guarda un archivo (el guardado ya está en `renderer/store.ts:276`).
5. Una herramienta nueva del agente `codebase_search(query)` de solo lectura que devuelva archivo, líneas y fragmento.
6. Excluir siempre los archivos secretos (`.env`, llaves), con el mismo filtro que ya usa `search`.
7. Barra de estado con el progreso ("Indexando 340/1200"), un botón para borrar el índice y un ajuste para apagarlo.
8. Avisar del costo estimado antes de indexar con un proveedor de pago.

**Listo cuando:** preguntas "¿dónde se valida la licencia?" y el agente encuentra `main/license.ts` sin que digas la palabra exacta. Un cambio en un archivo se refleja en el índice en segundos.

---

## 4. Crear: memorias entre conversaciones

**Hoy.** Solo existen las reglas de proyecto (`RULES_FILES`, `main/ai.ts:62`), que se agregan al prompt en `rulesBlock()` (`ai.ts:690`). La app no recuerda nada por sí sola.

**Crear:**
1. Una tabla `memories` en SQLite (`packages/core/src/db.ts`) con texto, alcance (global o proyecto), fecha y origen (qué chat la creó).
2. Una herramienta del agente `remember(text, scope)`: el agente la usa cuando el usuario dice "recuerda que…" o corrige algo que se repite.
3. Agregar las memorias relevantes al prompt junto a `rulesBlock()`, con un límite de tamaño. Si hay muchas, elegirlas con la búsqueda de la petición #3.
4. Un panel en Configuración para ver, editar y borrar memorias, y un interruptor para apagarlas (como `prefs.projectRules`, `main.ts:1026`).
5. Que cada memoria nueva se muestre en el chat ("Guardé esta memoria: …") con un botón de deshacer.

**Listo cuando:** dices "siempre responde en español y usa pnpm", abres otro chat días después y el agente lo cumple sin que lo repitas, y puedes borrar la memoria desde Configuración.

---

## 5. Crear: copia aislada del repo (git worktree) por chat

**Hoy.** Los chats ya corren en paralelo (`main.ts:1049`, `Agent.sessions` :93) y cada uno puede tener carpeta propia (`ChatTab.folder`, `renderer/store.ts:117`; `scope()`, `main.ts:410`). Pero `git.ts` no maneja worktrees, así que dos agentes en el mismo proyecto editan los mismos archivos.

**Crear:**
1. En `main/git.ts`: `worktreeAdd(path, branch)`, `worktreeList()`, `worktreeRemove(path)`, usando la validación de nombres de rama que ya existe (`checkBranch`, :58).
2. Una opción "Trabajar en copia aislada" al crear un chat. Crea la rama `zinarix/<nombre-chat>` y un worktree en una carpeta fuera del proyecto (por ejemplo, `<inicio Zinarix>/worktrees/<repo>/<chat>`), y pasa esa ruta como `folder` del chat.
3. Al terminar, botones en el chat:
   - "Ver cambios" (diff contra la rama base).
   - "Fusionar" (usa `merge`, :318).
   - "Crear PR" (`gh pr create`).
   - "Descartar" (borra worktree y rama, pidiendo confirmación).
4. Mostrar en la lista de chats en qué rama trabaja cada uno.
5. Cuidar `revert()` (`agent.ts:1777`): hoy se niega si la raíz abierta es distinta de `cp.root`. Debe funcionar con la raíz del worktree.
6. Opcional: correr el mismo pedido con varios modelos, cada uno en su worktree, y comparar los resultados. Cursor lo llama `/best-of-n modelo1,modelo2 tarea`.
7. Comandos de preparación en `.zinarix/worktrees.json`, como hace Cursor:
   - Claves `setup-worktree-windows`, `setup-worktree-unix` y `setup-worktree`, con una lista de comandos o un script (por ejemplo, `pnpm install` o copiar el `.env`).
   - Una variable `ROOT_WORKTREE_PATH` con la ruta del proyecto original.
   - Mostrar la salida de esos comandos en el panel de abajo.
8. Limpieza: un máximo de worktrees (Cursor usa 25) y borrar los viejos cada cierto tiempo, siempre pidiendo confirmación si tienen cambios sin fusionar.

**Listo cuando:** dos chats del mismo proyecto cambian el mismo archivo sin pisarse, y cada uno se puede fusionar o descartar por separado.

---

## 6. Crear: documentación externa indexada (`@Docs`)

**Hoy.** No existe. Los `@` del chat solo buscan archivos del proyecto (`mentionedFiles`, `Chat.tsx:113`).

**Crear (depende de la #3):**
1. "Agregar documentación": el usuario da una URL. La app descarga esa página y las que cuelgan de ella (mismo dominio y ruta, con límite de páginas). Puede usar el navegador que ya existe (`main/browser.ts`) o `fetch` normal, y convierte el HTML a texto.
2. Guardar los trozos y vectores con el mismo indexador de la #3, marcados con el nombre de la documentación.
3. En el chat, `@Docs` muestra la lista de documentaciones guardadas. Al elegir una, se buscan los trozos más parecidos a la pregunta y se agregan como contexto, citando la URL.
4. Una herramienta del agente `docs_search(nombre, query)`.
5. Botón para volver a descargar (las documentaciones cambian) y para borrar.

**Listo cuando:** agregas la documentación de una librería, preguntas con `@Docs` algo que solo está ahí, y la respuesta cita la página correcta.

---

## 7. Crear: Tab que predice la siguiente edición

**Hoy.** `renderer/inline.ts` registra un solo proveedor de texto fantasma (:47). Espera 550 ms (:36), manda el texto antes y después del cursor (main lo corta a 4000/1500 caracteres, `main/ai.ts:708-738`) y siempre inserta en el cursor. No usa los cambios recientes ni puede saltar a otra línea.

**Crear:**
1. Guardar los últimos ~10 cambios del usuario (diffs pequeños por archivo) desde `onDidChangeContent` (`renderer/store.ts:276`).
2. Un modo "siguiente edición": mandar al modelo los cambios recientes y una ventana de ~40 líneas alrededor del cursor, y pedirle la ventana reescrita.
3. Comparar la ventana original con la nueva. Si el cambio está en el cursor, se muestra como texto fantasma normal. Si está en otra línea, se muestra una marca en esa línea ("Tab para ir"):
   - El primer Tab lleva el cursor ahí.
   - El segundo aplica el cambio, mostrado como diff en línea con decoraciones de Monaco.
4. Encadenar sugerencias: al aceptar una, pedir la siguiente (por ejemplo, renombrar una variable en todos los lugares del archivo).
5. Esc descarta, y la sugerencia se cancela si el usuario sigue escribiendo (`ai.abort`, `inline.ts:71`).
6. Ajuste para elegir entre "solo completar" (lo de hoy) y "predecir siguiente edición". Recomendar un modelo rápido para el rol `inline` (uno local con Ollama sirve, para no depender de internet).
7. Lo que Cursor tiene alrededor del Tab:
   - Ctrl+Flecha derecha acepta palabra por palabra.
   - Un menú "Tab" en la barra de estado para pausarlo un rato, apagarlo y apagarlo por tipo de archivo (por ejemplo, en `.md`).
   - Agregar la importación que falta al aceptar una sugerencia que usa algo no importado.
   - Cuando el cambio sugerido es en otro archivo, mostrarlo en un recuadro abajo del editor.

**Listo cuando:** cambias el nombre de un parámetro en la firma de una función y con Tab, Tab vas corrigiendo sus usos en el mismo archivo.

---

## 8. Crear: revisión automática de pull requests

**Hoy.** `git.ts` usa `gh` (`pr()` :323, `githubStatus()` :419). El comando `ai.review` (`renderer/commands.ts:319`) solo manda un prompt al chat. El Vigilante (`main/watch.ts`) ya hace revisiones automáticas, pero de cambios locales sin commit.

**Crear:**
1. En `git.ts`, con `gh`:
   - `prDiff(n)` (`gh pr diff`).
   - `prList()`.
   - `prComment(n, path, line, body)` y `prReview(n, event, body)` (`gh api repos/{o}/{r}/pulls/{n}/reviews`).
2. "Revisar PR": elegir un PR, la IA revisa el diff (más el contexto de los archivos tocados) y devuelve una lista de problemas en JSON con archivo, línea, gravedad y sugerencia. Se puede reusar el formato del Vigilante.
3. Mostrar los hallazgos en un panel. El usuario elige cuáles publicar como comentarios en GitHub, y nada se publica sin aprobación.
4. Botón "Arreglar" por hallazgo, que manda la corrección al agente.
5. Opcional: que el Vigilante revise solo los PR nuevos de los repos que el usuario marque, con el mismo límite diario que ya tiene (4 por día). Corre en la PC, así que solo revisa mientras Zinarix está abierto.
6. Leer un archivo `.zinarix/review.md` (y `BUGBOT.md` si existe, por compatibilidad) con lo que el usuario quiere que se revise.

**Listo cuando:** eliges un PR, ves los problemas encontrados, apruebas dos y aparecen como comentarios en las líneas correctas del PR en GitHub.

---

## 9. Crear: servidores de lenguaje (LSP)

**Hoy.** Monaco solo trae inteligencia para TS/JS, JSON, CSS y HTML (`renderer/monaco.ts:2-16`). En el resto de los lenguajes solo hay colores. No hay `registerDefinitionProvider` ni marcadores de error. Los modelos usan URIs relativas (`file:///<ruta-relativa>`, `renderer/store.ts:270`), y un LSP necesita rutas absolutas reales.

**Crear:**
1. Un gestor en el proceso principal (`main/lsp.ts`) que lance servidores de lenguaje por stdio según el lenguaje del archivo:
   - Python: `pyright` o `basedpyright`.
   - Go: `gopls`.
   - Rust: `rust-analyzer`.
   - Java: `jdtls`.
   - C/C++: `clangd`.
   - PHP: `intelephense`.
   - C#: `csharp-ls`.
2. Detectar si el servidor está instalado. Si no, ofrecer instalarlo (`pip`, `go install`, `rustup component add`, `npm i -g`) en la terminal, con aprobación.
3. Pasar los mensajes JSON-RPC por IPC al renderer y conectarlos a Monaco (`monaco-languageclient` o un puente propio). Funciones mínimas:
   - Errores y avisos.
   - Ir a la definición y ver referencias.
   - Renombrar.
   - Información al pasar el mouse.
   - Autocompletado.
   - Formatear.
   - Esquema del archivo (outline).
4. Cambiar las URIs de los modelos a rutas absolutas (`file:///C:/...`), o traducirlas en el puente.
5. Mandar `didOpen`/`didChange`/`didSave` desde `store.ts:276`.
6. Dar al agente una herramienta `diagnostics(path)` para que vea los errores después de editar y los corrija solo.

**Listo cuando:** en un proyecto Python, F12 sobre una función abre su definición, F2 la renombra en todos los archivos y un error de tipo sale subrayado.

---

## 10. Crear: panel de Problemas

**Hoy.** El panel de abajo solo tiene terminales (`renderer/App.tsx:336`) y nada llama a `setModelMarkers`.

**Crear:**
1. Pestañas en el panel de abajo: Terminal, Problemas, Salida (y Consola de depuración cuando exista la #11).
2. En Problemas, la lista de errores y avisos de todos los archivos (de Monaco y de los LSP de la #9), agrupada por archivo. Clic lleva a la línea.
3. Contador en la barra de estado.
4. Botón "Arreglar con IA" por error o para todos.

**Listo cuando:** un error de TypeScript aparece en Problemas, el clic te lleva a la línea y "Arreglar con IA" lo corrige.

---

## 11. Crear: depurador (DAP)

**Hoy.** No hay. El panel Ejecutar (`renderer/components/RunPanel.tsx:192-205`) detecta scripts y los escribe en la terminal.

**Crear:**
1. Un cliente del Debug Adapter Protocol en el proceso principal (`main/debug.ts`). Primeros adaptadores:
   - Node/TS: `js-debug`.
   - Python: `debugpy`.
   - Go: `dlv dap`.
   - C/C++/Rust: `codelldb`.
2. Leer `.vscode/launch.json` si existe, para aprovechar las configuraciones que el usuario ya tiene. Si no, generar una desde lo que detecta `RunPanel`.
3. Puntos de pausa en el margen del editor (decoraciones de Monaco), con condiciones.
4. Barra de control: continuar, pasar, entrar, salir, reiniciar, detener.
5. En la barra lateral, una vista "Depurar" con variables, expresiones vigiladas y pila de llamadas, y la Consola de depuración en el panel de abajo (#10). La vista se agrega en el `sidebar` de `store.ts:70`, `Chrome.tsx` y `App.tsx:280`.
6. "Preguntar a la IA" cuando el programa se detiene en una excepción: mandar la pila y las variables al chat.

**Listo cuando:** pones un punto de pausa en un script de Node o Python, se detiene ahí, ves las variables y avanzas línea por línea.

---

## 12. Quitada: agentes en la nube

En Cursor estos agentes corren en sus servidores. Zinarix es local, así que no se hace. Lo que sí sirve en la PC, que es correr el agente sin la ventana abierta desde la terminal, está en la #38. Para los avisos al teléfono cuando termina una tarea ya están `phone.ts` y `bots.ts`.

---

## 13. Crear: temas externos y extensiones

**Hoy.** Los temas son una lista fija (`THEME_IDS`, `shared/api.ts:~130`, validada con `z.enum` en `main.ts:641`), y no hay sistema de extensiones. Ser compatible con las extensiones de VS Code no es realista sin basarse en VS Code. La recomendación es un sistema propio y pequeño.

**Crear:**
1. **Temas de VS Code.**
   - Importar un archivo `.json` de tema (o un `.vsix` y sacar el tema de adentro).
   - Convertir `colors` a las variables CSS de Zinarix y `tokenColors` a reglas de Monaco. El parecido no será exacto, porque Monaco usa Monarch y no TextMate.
   - Cambiar `ThemeId` a texto libre y quitar el `z.enum`.
2. **Gramáticas TextMate (opcional).** `vscode-textmate` + `vscode-oniguruma` para colorear igual que VS Code y aceptar gramáticas de lenguajes que Monaco no trae.
3. **Complementos propios.**
   - Una carpeta `extensions/` con un `manifest.json` que declare comandos, atajos, temas, servidores MCP (#2) y servidores de lenguaje (#9).
   - Usan el registro de comandos que ya existe (`renderer/commands.ts`).
   - Corren con permisos limitados, no con acceso total a Node.

**Listo cuando:** importas un tema popular de VS Code y el editor y la interfaz se ven parecidos, y un complemento de ejemplo agrega un comando a la paleta.

---

## 14. Crear: modos Preguntar, Planear, Depurar y modos propios

**Hoy.** Solo hay un interruptor entre agente y chat simple (`Chat.tsx:888`, comandos `/agente` y `/chat`; `agent.ts:96-110`). `Plan.tsx` es de los planes de licencia, no tiene que ver con el agente.

**Cómo lo hace Cursor.** Un selector de modo junto al cuadro de texto, Shift+Tab para pasar al siguiente y Ctrl+. para abrir el menú. Las reglas se aplican en todos los modos.

**Crear:**
1. **Preguntar:** solo lectura. El agente usa `read_file`, `search`, `glob` y el navegador, pero no edita ni corre comandos. Se arma quitando de `TOOLS` lo que no está en `READ_ONLY` (`agent.ts:347`).
2. **Planear:**
   - El agente hace preguntas para aclarar el pedido, investiga el código en modo solo lectura y escribe un plan en Markdown con pasos y archivos.
   - El plan se abre como documento editable. Botón **Construir**, que pasa a modo Agente con el plan como instrucción.
   - Guardar los planes en el inicio de Zinarix, con un botón "Guardar en el proyecto" (`.zinarix/plans/`).
   - Sugerir este modo cuando el pedido parece grande.
   - Opcional: "Construir en paralelo", que corre a la vez los pasos independientes (depende de la #22).
3. **Depurar:**
   - El agente propone varias causas posibles del error.
   - Agrega líneas de registro que mandan datos a un pequeño servidor local de Zinarix (en `127.0.0.1`, puerto al azar).
   - Le dice al usuario los pasos exactos para reproducir el error.
   - Lee los registros, hace un arreglo pequeño, el usuario confirma y el agente borra todas las líneas que agregó.
4. **Modos propios:** cualquier skill (#21) se puede usar como modo fijo que dura hasta que lo quitas, con su icono y color.
5. Atajos: Shift+Tab para cambiar de modo y Ctrl+. para el menú. Comandos `/preguntar`, `/planear` y `/depurar`.

**Listo cuando:** en modo Preguntar el agente no puede editar aunque se lo pidas, en modo Planear sale un plan que editas y con Construir se ejecuta, y en modo Depurar encuentra un error con registros y luego los quita.

---

## 15. Crear: lista de tareas del agente

**Hoy.** No hay. El prompt solo dice "planea brevemente".

**Crear:**
1. Una herramienta `update_todos(items, merge)` con estados `pendiente`, `en curso`, `hecha` y `cancelada` (los mismos de Cursor).
2. Mostrar la lista fija arriba del chat mientras el agente trabaja, tachando lo que termina.
3. Guardarla con la conversación, para verla al reabrir el chat.
4. Pedir en el prompt que la use en tareas de más de 3 pasos.

**Listo cuando:** pides algo grande y ves la lista de pasos llenándose y marcándose mientras el agente avanza.

---

## 16. Crear: dirigir al agente mientras trabaja

**Hoy.** Existe una cola visible que se puede editar y borrar, y se manda al terminar la respuesta actual (`sendQueued`, `Chat.tsx:1394`; `enqueue`, `:1642`). No se puede meter un mensaje en una respuesta que ya está corriendo.

**Crear:**
1. **Enviar ahora** (Ctrl+Enter): el mensaje entra en el bucle del agente (`loop`, `agent.ts:790`) antes de la siguiente llamada a una herramienta, sin detenerlo.
2. Reordenar la cola arrastrando.
3. Indicar en el chat dónde entró el mensaje.

**Listo cuando:** el agente está editando, escribes "usa async/await, no promesas" con Ctrl+Enter y el agente lo toma en el siguiente paso sin empezar de nuevo.

---

## 17. Crear: restaurar a cualquier mensaje

**Hoy.** Se guarda cada escritura (`Checkpoint`, `agent.ts:544`), pero el botón "revertir" deshace toda la conversación de una vez (`agent.ts:1779`, `Chat.tsx:1755`).

**Crear:**
1. Agrupar los puntos de restauración por mensaje del usuario.
2. En cada mensaje, un botón "Restaurar aquí" que devuelva los archivos a como estaban antes de ese mensaje. Los mensajes del chat se quedan.
3. Vista previa de qué archivos cambian antes de restaurar.
4. Opción "Restaurar y editar este mensaje" para volver a mandarlo cambiado (en la CLI de Cursor es `/rewind`).
5. Guardar también los archivos que el agente borró o creó con comandos de terminal, si es posible (por lo menos avisar que esos no se pueden deshacer).

**Listo cuando:** tras cinco mensajes con cambios, restauras al mensaje dos y los archivos quedan como estaban entonces.

---

## 18. Crear: medidor de contexto y resumen del chat

**Hoy.** Los resultados viejos de herramientas se recortan solos pasando 250 000 caracteres (`compactToolResults`, `agent.ts:1993`). Se ven los tokens y el costo de cada turno (`Chat.tsx:357`), pero no cuánto del límite del modelo se ha usado.

**Crear:**
1. Un anillo junto al cuadro de texto con el porcentaje del contexto usado. Al hacer clic, el desglose: prompt del sistema, herramientas, reglas, skills, MCP, conversación y resumen.
2. Resumen automático cuando se acerca al límite: un modelo barato resume los mensajes viejos y se guardan los últimos completos.
3. Comando `/resumir` (en Cursor `/summarize` o `/compress`) para hacerlo a mano.
4. Mostrar en el chat dónde se resumió, con opción de ver el resumen.

**Listo cuando:** en un chat largo el anillo marca 85 %, se resume solo, baja a ~30 % y el agente sigue sabiendo de qué se trata.

---

## 19. Crear: más tipos de `@` en el chat

**Hoy.** `@` solo acepta archivos que existen (`mentionedFiles`, `Chat.tsx:147`). La salida de la terminal se puede mandar al chat con un botón (`Terminal.tsx:94`), pero no con `@`.

**Crear:**
1. `@carpeta/`: al escribir `/` se entra a la carpeta. Agrega la lista de archivos y los más importantes.
2. `@terminal`: la salida reciente de una terminal abierta.
3. `@chat`: un resumen de otra conversación.
4. `@cambios`: el diff sin commit. `@rama`: el diff contra `main`. `@commit`: un commit en particular.
5. `@navegador`: la página abierta en el navegador.
6. `@regla`: una regla manual (#20). `@docs` es la #6 y `@problemas` sale del panel de la #10.
7. Poder poner varios `@` en un mismo mensaje y verlos como etiquetas que se pueden quitar.

**Listo cuando:** escribes "por qué falla @terminal según @cambios" y el agente recibe la salida de la terminal y el diff.

---

## 20. Crear: reglas con frontmatter, anidadas y globales

**Hoy.** Usa solo el primer archivo que encuentra entre `.zinarix/rules.md`, `AGENTS.md`, `CLAUDE.md` y `.cursorrules`, y solo en la raíz (`RULES_FILES`, `ai.ts:63`; `rulesBlock()`, `:707-736`).

**Crear (igual que Cursor, para que sus reglas sirvan sin cambios):**
1. Carpeta `.zinarix/rules/**/*.mdc`, y leer también `.cursor/rules/**/*.mdc`. Frontmatter:
   - `alwaysApply: true`: siempre.
   - `globs: "src/**/*.ts"`: solo cuando el agente lee o edita archivos que coinciden.
   - Solo `description`: el agente decide si la necesita (se le pasa la lista de descripciones y una herramienta `fetch_rule(nombre)`).
   - Nada: solo cuando el usuario la menciona con `@nombre`.
2. `AGENTS.md` en subcarpetas: se aplica a esa parte del proyecto y gana el más cercano.
3. Juntar todos los archivos que existan, no solo el primero. `CLAUDE.md` en la raíz siempre se aplica.
4. Reglas del usuario para todos los proyectos, en el inicio de Zinarix (`~/.zinarix/rules/`, y leer `~/.cursor/rules`). Orden: proyecto antes que usuario.
5. Las reglas no se mandan al Tab.
6. Una pantalla en Configuración con todas las reglas, de dónde vienen, su tipo y un interruptor. Comando `/crear-regla`.
7. Avisar si una regla pasa de 500 líneas.

**Listo cuando:** una regla con `globs: "**/*.py"` solo aparece en el contexto cuando el agente toca archivos Python, y un `AGENTS.md` en `packages/core` solo afecta ese paquete.

---

## 21. Crear: skills (`SKILL.md`)

**Hoy.** No hay.

**Cómo lo hace Cursor.** Una skill es una carpeta con un `SKILL.md` y, si hace falta, `scripts/`, `references/` y `assets/`. El agente ve el nombre y la descripción de todas, y lee el contenido completo solo cuando la necesita.

**Crear:**
1. Buscar skills, también dentro de subcarpetas (en un monorepo cada una aplica a su parte):
   - Del proyecto: `.zinarix/skills/`, `.agents/skills/`, `.cursor/skills/`, `.claude/skills/`, `.codex/skills/`.
   - Del usuario: las mismas carpetas en el inicio del usuario.
2. Frontmatter:
   - `name`: minúsculas, números y guiones, igual al nombre de la carpeta.
   - `description`.
   - `paths`: globs; solo se ofrece cuando se tocan esos archivos.
   - `disable-model-invocation`: si es `true`, solo se usa cuando el usuario escribe `/nombre`.
   - `icon` y `color`, para cuando se usa como modo (#14).
3. Agregar al prompt la lista de nombres y descripciones, y una herramienta `read_skill(nombre)`.
4. `/nombre` en el chat usa la skill en ese mensaje. Alt+Enter la deja como modo.
5. Skills incluidas: `/crear-skill`, `/crear-regla`, `/crear-hook`, `/crear-subagente`, `/revisar` y `/dividir-en-prs`.
6. Los scripts de una skill se corren con la misma aprobación que cualquier comando.

**Listo cuando:** copias una skill de Claude Code a `.claude/skills/` y Zinarix la usa sola cuando el pedido coincide con su descripción.

---

## 22. Crear: subagentes propios

**Hoy.** `delegate_to_ai` (`agent.ts:298-319`) le pasa una tarea a otro modelo. No hay agentes definidos por el usuario ni varios en paralelo.

**Crear:**
1. Archivos Markdown en `.zinarix/agents/`, y leer también `.cursor/agents/`, `.claude/agents/` y `.codex/agents/`, del proyecto y del usuario. Si dos tienen el mismo nombre, gana el del proyecto. El texto es el prompt del sistema. Frontmatter:
   - `name` y `description` (con "úsalo de forma proactiva" el agente lo llama solo).
   - `model`: `inherit` o un modelo de los que el usuario tiene conectados.
   - `readonly`: sin edición ni comandos.
   - `is_background`: corre sin bloquear el chat.
2. Un subagente incluido, **Explorar**: un modelo rápido que hace muchas búsquedas en su propio contexto y devuelve solo un resumen.
3. Cada subagente empieza con contexto limpio. El agente principal solo recibe el mensaje final.
4. Varios en paralelo cuando el agente pide varios en un mismo turno, cada uno opcionalmente en su worktree (#5).
5. Mostrar cada subagente como una tarjeta que se puede abrir para ver lo que hizo.
6. Que se puedan retomar con su id.

**Listo cuando:** defines un subagente `revisor` de solo lectura y el agente principal le pide revisar sus cambios antes de terminar.

---

## 23. Crear: hooks

**Hoy.** No hay.

**Crear (con el formato de Cursor para que sus `hooks.json` funcionen):**
1. Archivos:
   - Del proyecto: `.zinarix/hooks.json`, y leer `.cursor/hooks.json`. Solo si el usuario confió en el proyecto.
   - Del usuario: en el inicio de Zinarix.
   - Se vuelven a cargar al guardarlos.
2. Formato:

   ```json
   {
     "version": 1,
     "hooks": {
       "<evento>": [
         { "command": "...", "timeout": 30, "matcher": "regex", "failClosed": false }
       ]
     }
   }
   ```

3. El hook recibe JSON por stdin y responde JSON por stdout. En Windows se corre con PowerShell.
   - Salida 0: se usa lo que respondió.
   - Salida 2: bloquea la acción.
   - Otra salida: se sigue adelante, salvo que tenga `failClosed`.
4. Eventos a soportar:
   - `sessionStart` y `sessionEnd`.
   - `beforeSubmitPrompt`.
   - `preToolUse` y `postToolUse`.
   - `beforeShellExecution` y `afterShellExecution`.
   - `beforeMCPExecution` y `afterMCPExecution`.
   - `beforeReadFile` y `afterFileEdit`.
   - `afterAgentResponse`.
   - `preCompact`.
   - `stop`: su `followup_message` se manda solo como siguiente mensaje.
5. Si hay varios hooks, gana el más restrictivo: negar > preguntar > permitir.
6. Variables de entorno `ZINARIX_PROJECT_DIR` y `CURSOR_PROJECT_DIR`, para compatibilidad.
7. Un canal "Hooks" en el panel de Salida (#10) con lo que imprime cada hook.

**Listo cuando:** un hook `afterFileEdit` que corre `prettier` formatea cada archivo que edita el agente, y uno `beforeShellExecution` bloquea `git push --force`.

---

## 24. Crear: comandos `/` propios

**Hoy.** Hay 12 comandos fijos (`Chat.tsx:129-144`).

**Crear:**
1. Archivos Markdown en `.zinarix/commands/`, y leer también `.cursor/commands/` y `.claude/commands/`. El nombre del archivo es el comando y el contenido es el prompt.
2. Soportar `$ARGUMENTS` para lo que se escribe después del comando.
3. Que aparezcan en el autocompletado de `/` junto a los fijos y a las skills (#21).

**Listo cuando:** creas `.zinarix/commands/release.md` y `/release 1.2.0` manda ese prompt con la versión.

---

## 25. Crear: plugins de agente

**Hoy.** Están los tipos de extensión en `shared/devtools.ts:67-115`, sin commit, y la carpeta `main/extensions/` vacía.

**Crear (junto con la #13):**
1. Un plugin es una carpeta con `plugin.json` (`name`, `description`, `version`, `author`) que puede traer reglas, skills, subagentes, comandos, hooks y `mcp.json`.
2. Leer también el formato de Cursor (`.cursor-plugin/plugin.json`) y el estándar abierto (`plugin.json` con `$schema` de agent-plugins.org).
3. Instalar desde una carpeta local o un repo de Git, para todos los proyectos o solo para uno. Carpeta de desarrollo: `<inicio Zinarix>/plugins/local/<nombre>/`.
4. Variable `${PLUGIN_ROOT}` en su `mcp.json`.
5. Una lista de plugins con interruptor para cada uno.

**Listo cuando:** clonas un repo de plugin de Cursor y sus skills, reglas y servidores MCP aparecen en Zinarix.

---

## 26. Crear: archivo `.zinarixignore`

**Hoy.** Solo existe el filtro de archivos secretos (`isSecretFile`, `guard.ts:23`) y lo que ignora `.gitignore` en las búsquedas.

**Crear:**
1. Un archivo `.zinarixignore` en la raíz con el formato de `.gitignore`. Leer también `.cursorignore`.
2. El agente no puede leer, buscar, editar ni mencionar con `@` lo que coincide, y el Tab tampoco lo manda.
3. Proteger el propio archivo para que el agente no lo cambie sin aprobación.
4. Avisar en la documentación que los comandos de terminal y el MCP pueden saltarse esta protección (igual pasa en Cursor), salvo con el sandbox de la #28.

**Listo cuando:** pones `datos-clientes/` en `.zinarixignore` y el agente responde que no tiene acceso cuando le pides leer un archivo de ahí.

---

## 27. Crear: permisos guardados y modos de ejecución

**Hoy.** Cada acción pide aprobación, con una opción "siempre" que solo dura esa conversación (`approvalKey`, `agent.ts:365`; `:1154-1383`).

**Crear:**
1. Listas de permitir y de negar que se guarden, por proyecto (`.zinarix/permissions.json`) y por usuario, con el formato de la CLI de Cursor:
   - `Shell(npm test)` o `Shell(git:*)`.
   - `Read(glob)` y `Write(glob)`.
   - `WebFetch(dominio)`.
   - `Mcp(servidor:herramienta)`.
   - Negar gana sobre permitir.
2. Tres modos en Configuración:
   - **Preguntar**: lo de hoy.
   - **Lista permitida**: lo que está en la lista corre solo y lo demás pregunta.
   - **Ejecutar todo**: con aviso fuerte.
   - Comando `/ejecutar-todo` para activarlo solo en un chat.
3. En la tarjeta de aprobación, "Permitir siempre en este proyecto", que agrega la regla a la lista.
4. Protecciones que se respetan aunque esté en Ejecutar todo:
   - Borrar archivos (`rm`, `del`, `Remove-Item`) siempre pregunta.
   - Escribir fuera del proyecto siempre pregunta.
   - Nunca tocar `.git/config`, `.git/hooks`, `.zinarixignore` ni la configuración de Zinarix.
5. Opción "Leer solo dentro del proyecto": lo de fuera pide aprobación, con una lista de carpetas permitidas.
6. En vez del clasificador en la nube de Cursor, ofrecer uno opcional con el modelo que elija el usuario (puede ser local), que lea instrucciones en lenguaje normal (`allow_instructions` y `block_instructions`).
7. Variable `ZINARIX_AGENT=1` en la terminal del agente, para que la configuración de la terminal del usuario se salte cosas pesadas (Cursor usa `CURSOR_AGENT`).

**Listo cuando:** permites `Shell(npm test)` en un proyecto, cierras la app, la vuelves a abrir y el agente corre `npm test` sin preguntar, pero `npm publish` sí pregunta.

---

## 28. Crear: sandbox para comandos del agente

**Hoy.** Los comandos corren con todos los permisos del usuario.

**Cómo lo hace Cursor.** En Mac usa Seatbelt y en Linux Landlock. En Windows no documenta sandbox. Configura en `sandbox.json` la red (solo lo permitido, lo permitido más los registros de paquetes, o todo) y rutas extra para leer y escribir.

**Crear:**
1. En Windows, la opción más realista: correr los comandos en un proceso con un token restringido o un AppContainer, con un Job Object que limite procesos hijos. Si el usuario tiene WSL, ofrecer correrlos ahí.
2. `.zinarix/sandbox.json` y uno global:
   - Red: ninguna, solo registros de paquetes (npm, PyPI, crates…) o toda.
   - `additionalReadPaths` y `additionalWritePaths`.
   - Permitir la carpeta temporal y los cachés de compilación.
3. Si un comando falla por el sandbox, ofrecer "Correr sin sandbox" con aprobación.
4. Mostrar en cada comando si corrió en sandbox o no.

**Listo cuando:** en sandbox, `npm install` funciona pero un script que intenta escribir en `C:\Windows` o mandar datos a un sitio no permitido falla.

---

## 29. Crear: revisar cambios por bloque y revisión local

**Hoy.** Cada edición se aprueba o se rechaza completa, viendo el diff antes (`DiffView`, `Chat.tsx:523`). El Vigilante (`watch.ts`) revisa cambios locales en automático.

**Crear:**
1. Aceptar o rechazar cada bloque de un cambio por separado, en la tarjeta del chat y en el editor (con botones sobre cada bloque, como en un merge).
2. Un panel "Cambios del agente" con todo lo que cambió en la conversación: archivos, `+/-` y "Aceptar todo" / "Rechazar todo".
3. **Revisión del agente** (Agent Review en Cursor):
   - Comando `/revisar-cambios` y botón en el panel de Git. Revisa los cambios del agente o todo lo que cambió contra `main`.
   - Dos niveles: rápida y profunda.
   - Puede correr sola al terminar una tarea, si el usuario lo activa.
   - Lee las indicaciones de `.zinarix/review.md` (#8).
   - Muestra los hallazgos con botón "Arreglar".

**Listo cuando:** el agente cambia tres partes de un archivo, aceptas dos, rechazas una, y luego `/revisar-cambios` encuentra un error que tú no viste.

---

## 30. Crear: chats laterales y bifurcar

**Hoy.** Solo se puede editar o regenerar el último mensaje.

**Crear:**
1. **Chat lateral** (`/lado` o Ctrl+Shift+S, y "Preguntar en chat lateral" sobre una selección):
   - Una pregunta rápida que ve el chat principal como referencia, pero no lo ensucia.
   - Solo lectura. Se cierra con X y se puede traer su respuesta al chat principal con `@`.
2. **Bifurcar**: desde cualquier mensaje, "Seguir desde aquí en un chat nuevo", que copia la conversación hasta ese punto.

**Listo cuando:** a mitad de una tarea preguntas en un chat lateral qué hace una función sin interrumpir al agente, y bifurcas un chat para probar otra solución sin perder la primera.

---

## 31. Crear: búsqueda de conversaciones mejorada

**Hoy.** Se busca en títulos y contenido con `LIKE` (`history.ts:80-91`), y se puede exportar a Markdown.

**Crear:**
1. Un índice de texto completo en SQLite (FTS5) para que sea rápido con miles de chats.
2. Ctrl+F dentro de una conversación, con contador de coincidencias.
3. Una herramienta del agente `search_chats(query)` para buscar en conversaciones anteriores cuando el usuario dice "como lo hicimos la otra vez".

**Listo cuando:** con 2000 chats, la búsqueda responde en menos de un segundo, y Ctrl+F resalta cada coincidencia en el chat abierto.

---

## 32. Crear: dictado por voz local

**Hoy.** No hay.

**Crear:**
1. Un botón de micrófono en el chat y el atajo Ctrl+Shift+Space.
2. Transcribir en la PC con `whisper.cpp` o un modelo Whisper local: se descarga una vez y funciona sin internet. Como opción, usar el proveedor de transcripción del usuario si tiene uno conectado. La API de voz de Chromium no sirve porque en Electron depende de servidores de Google.
3. Ver el texto mientras se habla y poder corregirlo antes de mandar.
4. Elegir el idioma (español por defecto).

**Listo cuando:** dictas un pedido en español sin internet y aparece escrito en el cuadro del chat.

---

## 33. Crear: IA en la terminal y en Git

**Hoy.** Ya hay mensaje de commit con IA (`ai.ts:772`, `GitPanel.tsx:169`). Los conflictos solo se marcan (`git.ts:149`).

**Crear:**
1. **Ctrl+K en la terminal:** escribir en lenguaje normal ("borra las ramas ya fusionadas") y recibir el comando para PowerShell o bash, que se revisa antes de correrlo.
2. **"Resolver en el chat"** para conflictos de merge: manda los dos lados y el ancestro común al agente, y muestra el resultado como diff para aceptar.
3. **"Arreglar con IA"** sobre un comando que falló en la terminal (manda el comando y el error).
4. Opcional: agregar una línea `Co-authored-by: Zinarix` a los commits que hace el agente, con un ajuste para apagarlo.

**Listo cuando:** un merge con conflicto se resuelve desde el chat y el archivo queda sin marcas `<<<<<<<`.

---

## 34. Crear: notebooks Jupyter (`.ipynb`)

**Hoy.** Un `.ipynb` se abre como JSON.

**Crear:**
1. Una vista de notebook con celdas de código y Markdown, y salidas (texto, tablas, imágenes).
2. Correr celdas con un kernel local (`jupyter` o `ipykernel` instalado por el usuario), con la misma oferta de instalar que tienen los LSP (#9).
3. Que el agente pueda editar celdas por número y leer las salidas.
4. Ctrl+K y el Tab dentro de cada celda.

**Listo cuando:** abres un notebook, corres una celda que dibuja una gráfica y le pides al agente que agregue otra celda que la mejore.

---

## 35. Crear: importar configuración de VS Code y Cursor

**Hoy.** Los atajos se pueden cambiar (`Settings.tsx:539-580`), pero no se puede importar nada.

**Crear:**
1. Un botón "Importar de VS Code / Cursor" que lea los `settings.json` y `keybindings.json` del usuario y traduzca:
   - Atajos.
   - Fuente y tamaño.
   - Tema (con la #13).
   - Tabulación, formatear al guardar, minimapa.
2. Traer también las reglas, skills, comandos, `mcp.json` y `hooks.json` de `~/.cursor` y `~/.claude` (con la #2 y de la #20 a la #24).
3. Antes de aplicar, mostrar qué se va a importar y qué no tiene equivalente.

**Listo cuando:** alguien que viene de Cursor importa y tiene sus atajos, su fuente y sus servidores MCP sin configurar nada a mano.

---

## 36. Crear: enlaces `zinarix://`

**Hoy.** La app no registra ningún protocolo.

**Crear:**
1. Registrar `zinarix://` en el instalador de Windows y con `app.setAsDefaultProtocolClient`.
2. Enlaces:
   - `zinarix://prompt?text=`: abre un chat con ese texto.
   - `zinarix://rule?name=&text=`: crea una regla.
   - `zinarix://command?name=&text=`: crea un comando.
   - `zinarix://mcp/install?name=&config=<base64>`: instala un servidor MCP.
3. Nunca se ejecutan solos: siempre se muestra qué van a hacer y el usuario confirma. Límite de 10 000 caracteres.

**Listo cuando:** abres un enlace `zinarix://mcp/install…` desde el navegador y Zinarix pregunta si quieres agregar ese servidor.

---

## 37. Crear: modelo automático y contexto máximo

**Hoy.** Se elige un modelo por rol (chat, agente, inline, commit…) y hay una cadena de respaldo (`omni.ts:217-224`, `:350`).

**Crear:**
1. Un modelo "Automático" que corre en la PC y elige entre los modelos que el usuario tiene conectados según el tipo de tarea:
   - Pregunta corta: el más barato.
   - Cambio grande o muchos archivos: el más capaz.
   - Con imagen: uno con visión.
   - Con el presupuesto agotado: uno local.
   - Ajuste: priorizar costo, equilibrio o calidad.
   - Cursor lo hace en sus servidores; aquí son reglas locales.
2. Un interruptor de "contexto máximo" para usar el límite más grande del modelo, cuando lo tiene (por ejemplo, 1M tokens), avisando que cuesta más.
3. Ctrl+/ para cambiar de modelo rápido.

**Listo cuando:** en Automático, una pregunta simple usa un modelo barato y una refactorización grande usa el mejor, y el chat dice cuál usó y por qué.

---

## 38. Crear: agente en la CLI y protocolo ACP

**Hoy.** `omni ask` (`apps/cli/src/commands/ask.ts:140-151`) contesta una vez sin interfaz y acepta `--json`, pero no tiene herramientas: no edita ni corre comandos.

**Crear:**
1. Separar el agente de Electron (`packages/agent`), con navegador, correo y nube como partes opcionales.
2. `omni agent "tarea"` con herramientas de archivos y terminal. Opciones:
   - `-p` para correr sin preguntas.
   - `--output-format text|json|stream-json`.
   - `--mode agent|ask|plan`.
   - `--resume <id>`.
   - `--model`.
   - `--worktree` (#5).
   - `--force` para no pedir aprobación, respetando los permisos de la #27.
3. Modo interactivo en la terminal: Shift+Tab para cambiar de modo y Ctrl+R para revisar los diffs. Comandos `/model`, `/plan`, `/ask`, `/resumir`, `/rewind` y `/mcp`.
4. **ACP** (`omni acp`): JSON-RPC por stdio para que editores como Zed, JetBrains o Neovim usen el agente de Zinarix. Métodos:
   - `initialize`.
   - `session/new`, `session/load`, `session/prompt` y `session/cancel`.
   - `session/request_permission`.
5. Que las conversaciones de la CLI aparezcan en el historial de la app.

**Listo cuando:** en una terminal corres `omni agent -p "arregla los tests" --output-format stream-json` y el agente edita los archivos y devuelve eventos JSON, sin abrir la ventana.

---

## 39. Crear: canvas (artefactos interactivos)

**Hoy.** El chat solo muestra Markdown y código.

**Crear:**
1. Que el agente pueda crear un "canvas": un archivo HTML/React que se muestra junto al chat en un `iframe` aislado (`sandbox`, sin acceso a Node ni a la red salvo que se permita).
2. Diagramas `mermaid` dentro del Markdown del chat.
3. Lista de canvas del proyecto y comando "Abrir canvas". Se puede editar el código a mano.
4. Comando `/canvas`.

**Listo cuando:** pides "haz un tablero con el tamaño de cada carpeta del proyecto" y aparece una gráfica interactiva al lado del chat.

---

## 40. Crear: modo diseño en el navegador

**Hoy.** El navegador puede localizar elementos (`browser.ts:90-102`), pero solo para que el agente haga clic.

**Crear:**
1. Un botón "Diseño" (Ctrl+Shift+D) en el navegador.
   - Al pasar el mouse se resalta el elemento.
   - Clic lo selecciona. Flechas arriba y abajo van al padre o al hijo. Shift+clic agrega más.
2. Dibujar un recuadro o una flecha sobre la página y escribir una nota.
3. Doble clic para editar el texto ahí mismo, y un inspector para cambiar CSS.
4. Al mandar al chat, el agente recibe:
   - Etiqueta, id, clases y selector.
   - Los primeros 200 caracteres del texto, tamaño, posición y estilos principales.
   - El componente de React/Vue/Svelte, si lo hay.
   - Una captura recortada.
5. El agente busca ese componente en el código y hace el cambio.

**Listo cuando:** en tu app corriendo en `localhost`, seleccionas un botón, escribes "más grande y azul" y el agente cambia el archivo correcto.

---

## 41. Crear: navegador del agente con consola, red y capturas

**Hoy.** El agente puede abrir, leer, hacer clic, escribir, desplazarse y volver (`agent.ts:238-289`).

**Crear:**
1. `browser_console()`: los mensajes y errores de la consola de la página.
2. `browser_network()`: las peticiones con método, URL, estado y tiempo. Sin cuerpos con contraseñas ni cookies.
3. `browser_screenshot()`: una captura que va al modelo como imagen (depende de la #1).
4. Clic derecho, doble clic y pasar el mouse.
5. Detectar servidores de desarrollo corriendo (`localhost:3000`, `5173`…) y ofrecer abrirlos.
6. Guardar las cookies y la sesión por proyecto, para que el login de una app no se mezcle con otra.

**Listo cuando:** pides "abre la app y dime por qué no carga" y el agente lee el error de la consola y la petición que falló.

---

## 42. Crear: preguntar al usuario y generar imágenes

**Hoy.** El agente solo puede preguntar terminando su respuesta.

**Crear:**
1. Herramienta `ask_question(pregunta, opciones)`: muestra botones en el chat. El agente puede seguir trabajando en otra cosa mientras el usuario contesta.
2. Herramienta `generate_image(prompt, referencia?)` con el proveedor de imágenes que tenga conectado el usuario. Guarda en `assets/` y la muestra en el chat.

**Listo cuando:** el agente pregunta "¿Postgres o SQLite?" con dos botones, eliges uno y sigue con esa opción.

---

## 43. Crear: objetivos largos y tareas repetidas

**Hoy.** El Vigilante (`watch.ts`) revisa cambios en automático, con un límite diario.

**Crear (todo corre en la PC mientras Zinarix está abierto):**
1. `/objetivo <meta>`: el agente sigue trabajando, mensaje tras mensaje, hasta cumplir la meta o hasta el límite de pasos y de gasto. Se puede pausar.
2. `/repetir <intervalo> <prompt>`: corre un prompt o una skill cada cierto tiempo (por ejemplo, "cada 30 min revisa si pasaron los tests"). Con aviso al teléfono cuando hay algo importante (`phone.ts`, `bots.ts`).
3. `/multitarea`: manda varios pedidos a subagentes (#22) en paralelo en lugar de hacer cola.

**Listo cuando:** pides `/objetivo que pasen todos los tests` y el agente sigue corrigiendo y corriendo tests hasta que pasan, sin que escribas nada más.

---

## 44. Crear: editor y Git más completos

**Hoy.** Hay minimapa (`Editor.tsx:31`), buscar y reemplazar en varios archivos (`Search.tsx`) y Git con diff, preparar por archivo, ramas, stash, merge y PRs (`shared/api.ts:926-951`). Solo se pueden dividir los chats, no el editor, y la ventana abre una sola carpeta.

**Crear:**
1. Dividir el editor a la derecha y abajo.
2. Abrir varias carpetas en la misma ventana (multi-raíz).
3. Buscar símbolos en todo el proyecto (Ctrl+T) y en el archivo (Ctrl+Shift+O), con el LSP de la #9 o con el índice de la #3.
4. Preparar (stage) por bloque, no solo por archivo.
5. Blame en la línea, marcando qué escribió la IA y qué la persona (Cursor Blame): guardar qué líneas vienen del agente al aplicar sus cambios.
6. Gráfico del historial de ramas.

**Listo cuando:** ves dos archivos lado a lado, preparas solo un bloque de un archivo para el commit y el blame dice qué líneas escribió el agente.

---

## Lo que se dejó fuera (depende de servidores de Cursor)

- Agentes en la nube, en segundo plano y "Projects" (coordinador en la nube, multijugador).
- BugBot, Security Review, arreglo automático de vulnerabilidades, automatizaciones y despliegues por etapas.
- Origin (sus repos y PRs propios).
- Integraciones con Slack, Microsoft Teams, Jira, Linear, Notion, GitLab, Azure DevOps, Bitbucket y Tailscale.
- SDK, Agent SDK y API de agentes.
- Cuentas de equipo, empresa, SSO, analíticas y administración.
- App móvil y transcripciones compartidas.
- Clasificador de permisos en la nube. Se cambió por la opción local de la #27.
- Ruteo "Auto" de Cursor. Se cambió por las reglas locales de la #37.
- Chat de voz con Grok. Se cambió por el dictado local de la #32.
- Publicar canvas y sincronizar skills con el equipo.
- Tienda de extensiones en línea (Open VSX). Se cambió por la instalación local de la #13 y la #25.

## Lo que no hace falta copiar

Zinarix ya tiene cosas que Cursor no. Hay que cuidarlas al hacer estos cambios:
- 62 proveedores, modelos locales y presupuesto por proveedor.
- Navegador que controla la IA.
- Centro de seguridad.
- Delegar tareas entre modelos.
- Paneles de correo, Supabase y Vercel.
- Control desde el teléfono y bots.

Varias peticiones (#2, #3, #5, #37, #38) se pueden hacer de forma que esas ventajas sigan funcionando. Por ejemplo, un índice con modelos locales y el agente en la CLI con cualquier proveedor.
