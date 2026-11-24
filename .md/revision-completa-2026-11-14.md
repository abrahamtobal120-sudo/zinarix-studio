# Revisión completa de Zinarix Studio — 14 de noviembre de 2026

Este documento junta **todo lo que reportaste** y lo que encontramos al revisar la app completa.
Para cada punto se explica:

- **Qué pasa** (lo que ves como usuario).
- **Por qué pasa** (la causa en el código, con archivo y línea).
- **Cómo arreglarlo** (qué cambiar y dónde).

> Todas las rutas son relativas a `apps/desktop/src/` salvo que se diga otra cosa.
> No se modificó código para este informe; solo se leyó. El chequeo de tipos (`tsc`) pasa sin errores.

---

## Índice

1. [El chat no se puede redimensionar](#1-el-chat-no-se-puede-redimensionar)
2. [Cada chat debe mostrar qué modelo usa](#2-cada-chat-debe-mostrar-qué-modelo-usa)
3. [Chats viejos al historial + historial por carpeta junto al botón "+"](#3-chats-viejos-al-historial--historial-por-carpeta-junto-al-botón-)
4. [Que los chats se vean más acomodados](#4-que-los-chats-se-vean-más-acomodados)
5. [El icono del chat de IA no se ve bien](#5-el-icono-del-chat-de-ia-no-se-ve-bien)
6. [El panel lateral de funciones se ve feo](#6-el-panel-lateral-de-funciones-se-ve-feo)
7. [El panel de seguridad se ve cortado](#7-el-panel-de-seguridad-se-ve-cortado)
8. [WhatsApp no funciona](#8-whatsapp-no-funciona)
9. ["Detectar y ejecutar" vuelve a analizar cada vez que la IA cambia un archivo](#9-detectar-y-ejecutar-vuelve-a-analizar-cada-vez-que-la-ia-cambia-un-archivo)
10. [El navegador no puede importar cookies](#10-el-navegador-no-puede-importar-cookies)
11. [Todos los links que se abran en Zinarix deben ir al navegador interno](#11-todos-los-links-que-se-abran-en-zinarix-deben-ir-al-navegador-interno)
12. [El color de la terminal no gusta](#12-el-color-de-la-terminal-no-gusta)
13. [Lo de "Vigía" no se entiende](#13-lo-de-vigía-no-se-entiende)
14. [Google Cloud: "zinarix no ha completado el proceso de verificación" (Error 403)](#14-google-cloud-zinarix-no-ha-completado-el-proceso-de-verificación-error-403)
15. [Panel de Supabase muy básico](#15-panel-de-supabase-muy-básico)
16. [Panel de Vercel muy básico](#16-panel-de-vercel-muy-básico)
17. [Panel de Git muy básico](#17-panel-de-git-muy-básico)
18. [Buscar en archivos está mal](#18-buscar-en-archivos-está-mal)
19. [Revisión general: lo que le falta o está roto en la app](#19-revisión-general-lo-que-le-falta-o-está-roto-en-la-app)
20. [Orden recomendado de trabajo](#20-orden-recomendado-de-trabajo)
21. [Cambio hecho: carpeta `.md`](#21-cambio-hecho-carpeta-md)

---

## 1. El chat no se puede redimensionar

**Qué pasa:** intentas arrastrar el borde del chat y no se mueve, se mueve a saltos o se "pega".

**Por qué pasa** — hay **cuatro causas** distintas. La barrita que se arrastra se llama `Sash` (`renderer/App.tsx:53-103`) y se dibuja en `App.tsx:507-514`.

1. **Sin archivos abiertos no hay barrita.** Cuando no tienes ningún archivo abierto, el chat entra en "modo ancho" (`chatWide`, `App.tsx:254`) y ocupa todo el centro (`styles.css:6586`). En ese modo la barrita **no se dibuja** (`App.tsx:507`). Al abrir la app recién, que es lo más común, no hay nada que arrastrar. _Probablemente es lo que más te pasa._
2. **Con vista dividida o lista de chats, el ancho queda fijo.** El ancho mínimo sube a 620 px (dividido) + 190 px (lista) (`App.tsx:261`), y la cuenta de `App.tsx:263-268` hace que en pantallas de 1366–1440 px el resultado siempre sea ese mínimo, arrastres para donde arrastres. Además la lista mide en realidad 230 px (`styles.css:6637`), no 190.
3. **El navegador, WhatsApp, el correo y el modo diseño "se comen" el arrastre.** La barrita escucha el mouse en la ventana (`App.tsx:82-100`), pero el navegador y WhatsApp son vistas nativas encima de la app, y correo/diseño son iframes. Cuando el cursor pasa sobre ellos la app deja de recibir el movimiento y a veces pierde el "soltar", así que el arrastre se corta o se queda pegado.
4. **Zona muerta.** Si arrastras más allá del límite, el valor interno sigue cambiando aunque en pantalla no se mueva nada; luego tienes que regresar todo ese tramo antes de que reaccione.

**Cómo arreglarlo:**

- Dibujar **siempre** la barrita del chat, también en modo ancho (o quitar el modo ancho y centrar la columna solo con CSS).
- Rehacer la cuenta del ancho: primero calcular el ancho del chat con un `clamp(mín, valor, máx real)` y darle a la barra lateral lo que sobre (que no dependan uno del otro). Usar 230 px para la lista.
- Cambiar el `Sash` a **pointer events con captura** (`onPointerDown` + `setPointerCapture`), y mientras se arrastra:
  - CSS `body.dragging iframe { pointer-events: none }`.
  - Ocultar temporalmente el navegador/WhatsApp nativos (`setBounds(null)`) y volver a mostrarlos al soltar.
- Limitar el valor dentro de `dragChat` (`App.tsx:357-362`) al máximo real para que no haya zona muerta.

---

## 2. Cada chat debe mostrar qué modelo usa

**Qué pasa:** en las pestañas de chat no se ve qué IA está usando cada una.

**Por qué pasa:**

- Cada chat **sí guarda su modelo** (`ChatTab.model`, `renderer/store.ts:156-157`), pero si usa el modelo por defecto se guarda como `null`.
- **Pestañas:** solo muestran un logo de 12 px del proveedor (`Chat.tsx:2483-2499`), que además se sustituye por el indicador de "trabajando" o "sin leer". Si el chat usa el modelo por defecto, sale un icono genérico. O sea: la mayoría de los chats no dicen qué modelo usan.
- **Lista lateral:** muestra el modelo solo si es propio; si es el de por defecto dice "sin modelo" (`Chat.tsx:2702-2704`).
- **Historial:** solo logo, sin nombre del modelo (`ChatHistory.tsx:160-183`).
- **Error:** al reabrir un chat guardado **no se recupera su modelo** (`loadConversation`, `Chat.tsx:1124`, solo pone el título), así que vuelve al modelo por defecto.

**Cómo arreglarlo:**

- Crear una función `effectiveModel(chat)` en el store (la lógica ya existe en `Chat.tsx:1979-1980`) y usarla en pestañas, lista e historial, para que siempre se vea el modelo real aunque sea el de por defecto.
- En la pestaña: logo siempre visible + nombre corto del modelo (segunda línea o tooltip); el estado "trabajando/sin leer" como puntito encima del logo.
- En `loadConversation`, restaurar `model: conversation.model`.
- Añadir el modelo a la línea de detalles del historial y de la lista.

---

## 3. Chats viejos al historial + historial por carpeta junto al botón "+"

**Qué pides:** que los chats viejos se vayan al historial y que junto al botón **+** haya un historial de **cada carpeta** (proyecto).

**Qué existe hoy:**

- Un historial global (`ChatHistory.tsx`) que se abre con su botón (`Chat.tsx:2978-2988`). Filtra por "este proyecto" o "todos", pero "este proyecto" es la carpeta de la **ventana**, no la del chat (`main/ai.ts:840-852`). Si el proyecto carga tarde, se queda en "todos".
- **Ya existe un historial por carpeta, pero escondido**: la "lista de chats" (`Chat.tsx:2537-2837`) agrupa por carpeta, cada carpeta tiene su propio "+" y sus chats recientes. Pero:
  - Está **apagada por defecto** (`store.ts:657-663`).
  - Se abre con un icono de "menú" sin texto, igual al de la paleta de comandos (`Chat.tsx:2948-2956`), así que nadie lo encuentra.
  - Solo muestra **8** chats viejos por carpeta, sin "ver todos" (`Chat.tsx:2728`).
- El **+** de arriba (`Chat.tsx:2957-2962`) solo crea un chat nuevo, sin historial.

**Cómo arreglarlo:**

- Convertir el **+** en un **botón doble**: "+" (chat nuevo) y una flechita ▾ que abre un menú con:
  - "Nuevo chat aquí".
  - Los chats guardados de la carpeta del chat actual (`projectConversations`).
  - Accesos a las otras carpetas.
- Pasarle la carpeta al historial (nuevo parámetro `folder` en `ai:conversations`) para que "este proyecto" signifique la carpeta del chat.
- Cambiar el límite de 8 por un enlace "Ver todos (n)".
- Cerrar/archivar automáticamente al historial las pestañas sin actividad (por ejemplo, más de 7 días o más de N pestañas abiertas).

---

## 4. Que los chats se vean más acomodados

**Por qué se ven desordenados:**

- La cabecera tiene **7 botones solo con icono** (`Chat.tsx:2947-2992`): lista, +, chat de preguntas, nuevo en carpeta, dividir, historial, cerrar. Tres de ellos son "nuevo chat" y se confunden.
- Esos botones aplastan las pestañas; la barra de pestañas tiene el scroll escondido, así que las pestañas que no caben **desaparecen sin aviso** (`styles.css:5067-5079`).
- Las pestañas miden máximo 180 px fijos y no muestran ni carpeta ni modelo; los chats sin título se llaman "Chat N".
- Hay **dos interfaces distintas** para chats viejos: la lista lateral ("Recientes") y el historial que tapa el chat completo (`Chat.tsx:2014-2028`).
- CSS duplicado que se pisa: `.chat-list` en `styles.css:5162` y `6637`; `.chat-list-item` en `5214`, `6370` y `6654`; `.chat-list-folder` en `5179`, `6344` y `chat-a11y.css:82`.

**Cómo arreglarlo:**

- Un solo **+** con menú (Nuevo chat / Solo preguntas / En carpeta…). Dejar como iconos solo dividir, historial y cerrar.
- Flechas o menú desplegable cuando no caben las pestañas.
- Pestañas con segunda línea: carpeta · modelo.
- Unir historial y lista lateral en un solo panel: buscador arriba, agrupado por carpeta y dentro por fecha (hoy, ayer, esta semana…).
- Juntar el CSS duplicado en un solo bloque.

---

## 5. El icono del chat de IA no se ve bien

**Por qué:** el icono `agent` (`renderer/components/Icon.tsx:64-68`) es un globo de texto cuadrado con `>_` dentro. **Se parece casi igual al de la terminal** (`Icon.tsx:69-73`), que está dos botones abajo. Además todos los iconos usan esquinas rectas (`strokeLinecap="square"`, `Icon.tsx:701-703`), y en esta forma se ve duro.

Se usa en la barra lateral (`Chrome.tsx:101`), en la barra de estado (`Chrome.tsx:185`) y en la bienvenida (`Chrome.tsx:293`).

**Cómo arreglarlo:** redibujarlo como un globo redondeado con la chispa ✦ (ya existe el trazo `sparkle`, `Icon.tsx:514`) o con el logo de Zinarix; quitar el `>_`; usar esquinas redondeadas solo en este icono.

---

## 6. El panel lateral de funciones se ve feo

Es la **barra de actividades** de la izquierda (`renderer/components/Chrome.tsx:24-138`).

**Por qué se ve mal:**

- **Demasiados botones en una sola columna, sin grupos:** 15 arriba (Explorador, Buscar, Git, Diseño, Ejecutar, Vercel, Supabase, Google Cloud, Correo, Vigía, Chat, Video, Terminal, Navegador, WhatsApp) + 5 abajo (Seguridad, Uso, Proveedores, Paleta, Ajustes). Hasta 21 botones.
- **Cada botón hace algo distinto** sin que se note: unos cambian la barra lateral, otros abren paneles, otros abren pestañas, otros ventanas. Las etiquetas solo aparecen al pasar el mouse.
- **Cinco reglas CSS que se pelean** entre sí: `styles.css:244-290` (52 px), `4175`, `6547-6566` (iconos de color que ya no funcionan porque `TONE = {}` en `Icon.tsx:682`), `6798-6825` (48 px), `8269-8297` (32 px en pantallas bajas).
- **Se corta en laptops:** 21 × 42 px ≈ 880 px. En pantallas bajas, los botones de abajo quedan escondidos tras un scroll invisible (`styles.css:8272-8277`).
- El marcador del botón activo se mueve a mano (−7, −5, −8 px) para no cortarse.
- Los iconos de Vercel (un triángulo) y Supabase (un rayo) son muy simples (`Icon.tsx:675-676`).

**Cómo arreglarlo:**

- **Agrupar con separadores:**
  - Trabajo: Explorador, Buscar, Git, Ejecutar.
  - IA: Chat, Revisión IA (Vigía).
  - Crear: Diseño, Video.
  - Integraciones: Vercel, Supabase, Google Cloud, Correo, WhatsApp, Navegador → mejor dentro de un botón **"Más"** con menú, o que el usuario elija cuáles ver.
- Mover Terminal a la barra de estado o al grupo de abajo. Quitar Paleta (ya tiene atajo).
- Borrar el CSS muerto y dejar **una sola** regla para la barra.
- Si no caben, mostrar un botón "…" visible en vez de scroll invisible.
- Logos reales de Vercel y Supabase.

---

## 7. El panel de seguridad se ve cortado

**Por qué:** el botón del escudo abre la seguridad como **pestaña** en el centro (`Chrome.tsx:131` → `SecuritySection`, `Editor.tsx:183`). El centro puede medir solo **360 px** (`App.tsx:109`) porque el chat y la barra lateral ocupan el resto, pero el panel tiene **anchos mínimos fijos** que no caben:

- Menú lateral fijo de 190 px (`styles.css:3876-3886`).
- Puntuación 140 px (`3947`), resumen mínimo 260 px (`3976-3979`), tarjetas mínimo 220 px (`3999-4004`), campos de escaneo 180 + 200 px (`4146-4163`), filas del historial `44px 160px 1fr auto` (`4847-4855`).
- Textos con `nowrap` + "…" que se cortan (`4758-4763`, `4799-4805`).
- `overflow-y: auto` en `.sv-content` (`3935-3940`) hace que también salga scroll horizontal: por eso se ve "cortado".

Además el modal `SecurityCenter` (`Modals.tsx:89`) es **código muerto**: nada lo abre.

**Cómo arreglarlo:**

- Hacer el panel adaptable con _container queries_ (`container-type: inline-size` en `.sec-section`). Debajo de ~640 px: el menú lateral pasa a iconos o pestañas arriba y el relleno baja a 14 px.
- Cambiar los mínimos fijos por `min(220px, 100%)` y similares.
- Filas del historial con `flex-wrap`.
- Opcional: abrir Seguridad siempre maximizado, o como ventana grande.
- Borrar `SecurityCenter.tsx` o conectarlo.

---

## 8. WhatsApp no funciona

**Cómo funciona:** no usa librerías externas. Carga el **WhatsApp Web real** dentro de la app (`main/whatsapp.ts`, sesión `persist:zinarix-whatsapp`) y lo lee/controla con scripts dentro de la página. Los canales de comunicación entre la interfaz y el proceso principal están bien (`preload.ts:279-288` ↔ `main.ts:1913-1936`).

**Por qué falla (de más probable a menos):**

1. **Detecta mal si ya iniciaste sesión.** Busca un elemento llamado `#pane-side` (`whatsapp.ts:64`). Si WhatsApp le cambió el nombre (lo hace seguido), la app cree que **nunca** iniciaste sesión: sigue pidiendo el QR (`WhatsApp.tsx:157-159`), el interruptor queda desactivado (`WhatsApp.tsx:219`) y no aparece "Usar este chat" (`:302`).
2. **Otros selectores igual de frágiles:** leer mensajes (`:86-94`), buscador (`:115`), cuadro de texto y botón enviar (`:125`, `:155-158`), lista de chats (`:40-42`). Si uno se rompe, falla con "abre un chat" o las respuestas se atoran.
3. **Los errores se tragan sin avisar:** `loadURL(...).catch(() => undefined)` (`:372`), scripts que devuelven `null` en cualquier error (`:522`, `:574`), el ciclo de lectura (`:500`) y `bots.ts:509`. Tú solo ves que "no hace nada".
4. **Depende del control remoto del teléfono.** Si `phone.start()` falla (puerto ocupado o firewall), todas las órdenes responden "Zinarix no está conectado…" (`whatsapp.ts:655-659`, `bots.ts:507-513`). Solo una ventana puede tener el remoto.
5. Menos probable: identidad del navegador (las cabeceras Sec-CH-UA siguen diciendo Electron) o un _service worker_ viejo que deja la página en "cargando".

**Cómo arreglarlo:**

- Detección con varias alternativas: `#pane-side, [aria-label="Chat list"], [aria-label="Lista de chats"], [data-testid="chat-list"]`, y detectar el QR aparte. Devolver un estado `'qr' | conectado | desconectado | 'desconocido'`.
- No desactivar el interruptor cuando el estado es "desconocido".
- **Mostrar los errores** en el panel: añadir `error?: string` al estado de WhatsApp y llenarlo en `loadURL`, `did-fail-load` y en los fallos de scripts.
- Botón **"Reiniciar sesión"** que borre _service workers_ y caché de esa sesión y recargue.
- Botón **"Desvincular"**: ya existe `whatsapp.forget` (`preload.ts:285`) pero no hay botón.
- Mensaje claro cuando falla el remoto del teléfono.

---

## 9. "Detectar y ejecutar" vuelve a analizar cada vez que la IA cambia un archivo

**Qué pasa:** cada vez que la IA edita algo, el panel Ejecutar vuelve a decir "Detectando…".

**La cadena exacta:**

1. `main/workspace.ts:173-180` vigila **toda** la carpeta (solo ignora `.git` y `node_modules`, **no** `dist`, `build`, `.next`, `target`, `__pycache__`…). Cualquier cambio dispara un aviso a los 250 ms.
2. `main/main.ts:517` manda `fs:changed` **sin decir qué archivo cambió**.
3. `renderer/App.tsx:397` sube un contador `fsVersion`.
4. `RunPanel.tsx:319-330` espera 1,5 s y vuelve a listar **todos** los archivos (hasta 20 000) y releer los `package.json`, Makefile, etc. para ver si cambió la configuración.
5. Si cambió, `detect()` (`RunPanel.tsx:295-308`) vuelve a listar todo **dos veces más**.

**Por qué se nota tanto:**

- **El resultado se pierde al salir del panel Ejecutar** (solo vive mientras el panel está abierto, `App.tsx:449-450`). Al volver, se hace el análisis completo otra vez.
- Cuentan como "configuración" archivos como `main.py`, `app.py`, `index.html`, `requirements.txt` (`RunPanel.tsx:24-46`). Si la IA crea cualquiera, se reanaliza. Y la IA cambia `package.json` muy seguido.
- Las carpetas de compilación no se ignoran: un servidor de desarrollo corriendo dispara cambios sin parar.
- Ese mismo contador también hace recargar el Explorador, Buscar, Git, Diseño y el chat (`Explorer.tsx:64`, `Search.tsx:195,208`, `GitPanel.tsx:90,104`, `DesignPanel.tsx:123`, `Chat.tsx:1071`).

**Cómo arreglarlo (en orden de impacto):**

1. Enviar **las rutas cambiadas** en `fs:changed` y que Ejecutar solo reaccione si cambió un archivo de configuración real.
2. Guardar el resultado en el store por carpeta, para no reanalizar al volver al panel. El botón de refrescar queda como "Volver a detectar".
3. Sacar `main.py`, `app.py`, `index.html`, `requirements.txt` de la lista que dispara el reanálisis.
4. **No reanalizar mientras la IA está trabajando**: marcar "la configuración cambió" y ofrecer un botón, o hacerlo una sola vez al terminar.
5. Ignorar `dist`, `build`, `out`, `.next`, `target`, `.venv`, `__pycache__` en el vigilante (o respetar `.gitignore`).
6. Usar una sola lista de archivos para detectar y para la huella.

---

## 10. El navegador no puede importar cookies

**Estado actual:** todas las pestañas del navegador comparten una sesión `persist:zinarix-browser` (`main/browser.ts:29`). **No hay nada de cookies** en el código. Tampoco se cambia la identidad del navegador (dice "Electron"), por eso Google y otros sitios bloquean el inicio de sesión. Permisos siempre denegados y descargas bloqueadas (`browser.ts:226-228`).

**Cómo implementarlo:**

- Botón **"Importar cookies"** en la barra del navegador (`Browser.tsx`, junto al botón de abrir fuera, `:309-316`) → IPC nuevo `browser:importCookies` → `ses.cookies.set(...)` por cada cookie y luego `ses.cookies.flushStore()`. Informar cuántas entraron y cuántas fallaron.
- Formatos fáciles de soportar:
  - **`cookies.txt`** (formato Netscape; lo exportan extensiones como "Get cookies.txt").
  - **JSON** (formato de EditThisCookie / Cookie-Editor).
  - **Firefox**: el archivo `cookies.sqlite` del perfil está sin cifrar; se copia (Firefox lo bloquea mientras está abierto) y se lee.
- **Chrome / Edge: difícil.** Las cookies están cifradas. Las versiones nuevas de Chrome (127+) usan "App-Bound Encryption", que en la práctica **otra app no puede descifrar**. Recomendación: para Chrome, usar una extensión que exporte `cookies.txt` y luego importar ese archivo.
- **Seguridad:** como la IA usa la misma sesión del navegador, las cookies importadas (banco, correo…) quedarían al alcance del agente. Opciones: avisar antes de importar, o separar la sesión de tus pestañas de la de las pestañas de la IA.
- Poner una identidad de Chrome normal en esta sesión (reutilizar `chromeAgent()` de `whatsapp.ts:24`) para que Google deje iniciar sesión.

---

## 11. Todos los links que se abran en Zinarix deben ir al navegador interno

**Estado actual:** unos **15 lugares** abren el navegador de Windows (`shell.openExternal`):

| Dónde                                                                                          | Código                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ventanas emergentes de la app (Ctrl+clic en el editor, links de la terminal, links del correo) | `main.ts:2401-2404`                                                                                                                                     |
| Navegación de la ventana (se ignora en silencio)                                               | `main.ts:2405-2407`                                                                                                                                     |
| IPC `app:openExternal` (**solo https**; los `http://localhost` no hacen nada)                  | `main.ts:1847-1850`                                                                                                                                     |
| Links en el chat (Markdown) — y las URL sueltas no se vuelven clicables                        | `Markdown.tsx:260`, `:271-280`                                                                                                                          |
| Git                                                                                            | `GitPanel.tsx:332,357,440,647`; `GitModals.tsx:219,362,395`                                                                                             |
| Nube / correo / otros                                                                          | `GCloudPanel.tsx:25`, `SupabasePanel.tsx:36`, `VercelPanel.tsx:58`, `MailPanel.tsx:24`, `Modals.tsx:652,657`, `Plan.tsx:25,603,639`, `Settings.tsx:301` |
| WhatsApp                                                                                       | `whatsapp.ts:346-354`                                                                                                                                   |
| Terminal: no tiene addon de links; las URL normales no son clicables                           | `Terminal.tsx`                                                                                                                                          |

**Cómo arreglarlo:**

- Crear `openLink(ventana, url)` en el proceso principal: abre una pestaña del navegador interno y le avisa a la interfaz que la muestre (evento nuevo `browser:focus`; no reutilizar `browser:show`, que enciende el aviso de "la IA está usando el navegador").
- Usarlo en `setWindowOpenHandler` y crear el IPC `app:openLink` (acepta http y https).
- Cambiar a `openLink` el Markdown, Git, Google Cloud, Vercel, Supabase, Ajustes y Modals. El regex de Markdown debe aceptar `http://` y URL sueltas.
- Terminal: añadir `@xterm/addon-web-links` y `linkHandler` para links OSC 8.
- Editor (Monaco): `monaco.editor.registerLinkOpener(...)`.
- **Deben seguir abriéndose fuera:** el inicio de sesión de Google (Google bloquea navegadores incrustados, error `disallowed_useragent`, `main.ts:1291`), pagos, el botón "abrir en navegador externo" a propósito (`Browser.tsx:312`) y, por seguridad, quizá los links del correo.

---

## 12. El color de la terminal no gusta

**Por qué:** `Terminal.tsx:132-143` solo define fondo, texto, cursor y selección. **No define los 16 colores ANSI**, así que siempre salen los colores por defecto de xterm, que no combinan con ningún tema. En el tema claro, el amarillo y el blanco casi no se leen. El cursor usa el color violeta del foco. La fuente está fija en `'JetBrains Mono' 13px` (`:177-178`) e ignora tus ajustes de fuente.

**Cómo arreglarlo:**

- Añadir una paleta de terminal a cada tema (`themes.ts`, campo nuevo `terminal`). Ejemplo para el tema oscuro: rojo `#f47174`, verde `#7fd88f`, amarillo `#e5c07b`, azul `#6cb6ff`, magenta `#c49cff`, cian `#56d4dd`. Para Dracula, Nord, Monokai y GitHub, usar sus paletas oficiales.
- Cursor con el color del texto, y `minimumContrastRatio: 4.5` para que todo se lea.
- **Ajustes nuevos:** tema de terminal (seguir app / One Dark / Solarized / Campbell…), tamaño y fuente de terminal, estilo del cursor. Aplicarlos en vivo.

---

## 13. Lo de "Vigía" no se entiende

**Qué es realmente** (`main/watch.ts`): un **revisor de código con IA en segundo plano**. Cada 5 minutos mira gratis (con git) si tus proyectos cambiaron. Si cambiaron, ya pasaron 3 minutos sin cambios y pasaron 120 minutos desde la última revisión, manda a la IA el árbol de archivos + últimos commits + el diff (~10 000 tokens, sin secretos) y te devuelve hasta 5 sugerencias de "arreglar" o "mejorar".

**Por qué confunde:**

- **El nombre:** "Vigía" suena a "vigilante de archivos". Nada dice que es una revisión con IA. El icono es un ojo (`Chrome.tsx:94-99`).
- **El texto se contradice:** dice "Siempre activo" (`i18n.ts:955`) justo encima de un interruptor para apagarlo. Explica los tiempos, pero no **qué revisa** ni **qué envía**.
- **Gasta tokens sin pedir permiso:** viene **encendido por defecto** (`watch.ts:29`), usa el modelo del chat (que puede ser caro) y hasta 4 veces al día. El costo solo aparece por reporte; no hay total.
- Los intentos fallidos gastan el cupo diario (`watch.ts:405-411`).
- No se ve qué se revisó (qué archivos, qué commits).
- Textos fijos en español aunque la app esté en inglés (`main.ts:2553-2554`, `watch.ts:44`, `watch.ts:345`).
- Mezcla reportes de todos los proyectos; no se puede cancelar una revisión (`watch.ts:376`).

**Cómo mejorarlo:**

1. **Renombrar** a "Revisión con IA" con un icono de revisión (no un ojo).
2. **Apagado por defecto**, con una tarjeta inicial: "Cada pocas horas Zinarix envía tus cambios recientes (diff + árbol, sin secretos) a {modelo} y te sugiere hasta 5 arreglos. ~10 000 tokens por revisión ≈ $X." → [Activar] [Ahora no].
3. Mostrar el **costo** por revisión, de hoy y del mes; usar por defecto un modelo barato.
4. En cada reporte, mostrar **qué se revisó** (commits, archivos, "ver lo que se envió").
5. Reescribir la explicación; quitar "Siempre activo".
6. Pausar mientras la IA del chat está trabajando.
7. Traducir textos, filtro por proyecto, botón cancelar, no contar fallos como revisiones.

---

## 14. Google Cloud: "zinarix no ha completado el proceso de verificación" (Error 403)

**El mensaje completo:** _"zinarix no ha completado el proceso de verificación de Google. En estos momentos, la app se está probando y solo pueden acceder a ella los testers aprobados por el desarrollador… Error 403: access_denied"._

**Por qué pasa:** **no es un error del código; es la configuración en Google Cloud Console.** La app trae un cliente OAuth integrado (lo mete `build.mjs:19-31` desde `apps/desktop/google-oauth.local.json`, cliente `1514…apps.googleusercontent.com`). La pantalla de consentimiento de ese proyecto está en estado **"Prueba" (Testing)** y la cuenta con la que entras **no está en la lista de usuarios de prueba**. Google responde exactamente ese 403.

Además el inicio de sesión de Google Cloud pide **también acceso completo a Gmail** (`GOOGLE_ALL_SCOPE`, `googleMail.ts:19-20`: `https://mail.google.com/` + `cloud-platform`). `mail.google.com` es un permiso **restringido**, el más difícil de verificar.

### Solución inmediata (en Google Cloud Console)

1. Entra a [console.cloud.google.com](https://console.cloud.google.com) con la cuenta dueña del proyecto del cliente `1514…`.
2. Ve a **APIs y servicios → Pantalla de consentimiento de OAuth** (en la versión nueva: **Google Auth Platform → Público / Audience**).
3. En **Usuarios de prueba**, pulsa **Agregar usuarios** y escribe los correos que van a usar Zinarix (hasta 100).
4. Guarda y vuelve a intentar en Zinarix.

> Ojo: en modo Prueba, el acceso **caduca cada 7 días** y hay que volver a iniciar sesión. La app ya maneja ese caso (`gcloud.ts:138`).

### Otras opciones

- **Publicar la app ("En producción") sin verificar:** los usuarios verán "Google no ha verificado esta app" y podrán pasar con _Configuración avanzada → Ir a zinarix_. Con permisos sensibles hay un límite de 100 usuarios.
- **Verificación completa** (para venderla a mucha gente): política de privacidad, página principal, dominio verificado y video demo para `cloud-platform`. Para `mail.google.com` además una auditoría de seguridad anual (CASA). Es caro y lento.
- **Si solo la usan cuentas de tu Google Workspace** (por ejemplo, de tu empresa): tipo de usuario **Interno** → no necesita verificación.

### Cambios recomendados en el código

- **Separar permisos:** el inicio de sesión de Google Cloud debe pedir solo `cloud-platform` + `openid email profile`, y el de Correo solo Gmail (con `include_granted_scopes=true`). Así Cloud no queda bloqueado por el permiso restringido de Gmail.
- **"Usar mi propio cliente OAuth" siempre visible.** Hoy ese formulario **nunca aparece**, porque solo se muestra si no hay cliente (`GCloudPanel.tsx:578`, `gcloud.ts:125`) y siempre hay uno integrado. Igual en Correo (`MailPanel.tsx:269-274`). El backend ya funciona (`mail:setGoogleClient`, `main.ts:1277-1281`). Añadir también "volver al cliente integrado" y aceptar el archivo `client_secret_*.json`.
- **Opción con gcloud CLI:** leer `%APPDATA%\gcloud\application_default_credentials.json` (lo crea `gcloud auth application-default login`) y usarlo sin pasar por la pantalla de Zinarix.
- **Mensaje claro** cuando Google devuelve `access_denied` (`googleMail.ts:127`): "Esta cuenta no es usuario de prueba de la app. Agrégala en Google Cloud Console o usa tu propio cliente OAuth."

---

## 15. Panel de Supabase muy básico

Archivos: `renderer/components/SupabasePanel.tsx`, `main/supabase.ts`.

**Lo que ya tiene:** varias cuentas; lista de proyectos con salud de servicios; pausar/reanudar; tablas (filas en solo lectura, 100 por página; columnas; activar/desactivar RLS); editor SQL simple con historial de lecturas y confirmación para escrituras (máx. 500 filas, copiar CSV); usuarios de Auth (últimos 200, borrar, enviar reseteo); ajustes de Auth y correo (SMTP, plantillas); Edge Functions (listar, copiar URL, borrar); secretos (solo nombres); Storage (buckets y objetos en solo lectura); migraciones y respaldos; claves de API. Varias acciones solo lanzan la CLI en la terminal o abren la web.

**Lo que falta:**

- **Alta prioridad:**
  - **Editor de tablas de verdad:** editar celdas, insertar y borrar filas, ordenar, filtros, ver JSON, crear/alterar tablas y columnas.
  - **Editor SQL con Monaco:** colores, autocompletar tablas y columnas, consultas guardadas con nombre, ejecutar solo la selección, varias pestañas de resultados, EXPLAIN, exportar todo.
  - **Políticas RLS:** ver, crear y editar políticas (`pg_policies`). Hoy solo se prende o apaga.
  - **Storage completo:** carpetas, subir, descargar, borrar, URL firmadas, crear buckets.
  - **Logs dentro de la app:** API, Postgres, Auth y Edge Functions.
- **Media:** paginación de usuarios y crear/banear usuarios; desplegar y probar Edge Functions desde la app; diagrama de la base de datos (relaciones); índices, vistas, funciones, triggers, enums, extensiones; generar tipos por API (no CLI fija a `public`); ramas de base de datos; ver el SQL de una migración y aplicarla; restaurar respaldos.
- **Baja:** cadena de conexión / pooler, ajustes JWT, uso y facturación, inspector de Realtime.

**Errores encontrados:**

- `main/supabase.ts:320`: la vista de filas por página **no tiene `ORDER BY`**, así que las páginas pueden repetir o saltarse filas.
- `main/supabase.ts:288-299`: trae el resultado completo y luego lo corta a 500; un `select *` grande puede tardar o pasar el límite de 60 s.
- `main/supabase.ts:60`: el número de filas es una estimación (`reltuples`); tablas nuevas muestran ~0.

---

## 16. Panel de Vercel muy básico

Archivos: `renderer/components/VercelPanel.tsx`, `main/vercel.ts`.

**Lo que ya tiene:** cuentas y equipos; proyectos; cabecera con dominios, producción actual y repo; botones de desplegar (lanzan la CLI en la terminal); aviso del último despliegue fallido con "Arreglar con IA"; últimos 30 despliegues con filtros, log de compilación, cancelar, redesplegar, promover, borrar; variables de entorno (agregar, editar, borrar, importar `.env`); dominios (agregar, quitar, verificar); ajustes de compilación.

**Lo que falta:**

- **Alta prioridad:**
  - **Logs en tiempo real** de peticiones y funciones (hoy solo hay log de compilación).
  - **Desplegar la carpeta local desde la app** con barra de progreso (API `/v13/deployments`), elegir rama, _deploy hooks_.
  - **Variables:** ver el valor, por rama de Git, elegir tipo (sensitive/plain/encrypted), comparar entornos.
  - **Ayuda DNS de dominios:** qué registros A/CNAME/TXT poner, estado de mala configuración, redirecciones.
- **Media:** Analytics y Speed Insights; conectar/desconectar repo, rama de producción; protección de despliegues; más de 30 despliegues y filtros por rama/estado/autor; resumen del despliegue; crear o importar proyectos.
- **Baja:** crons, Edge Config, Blob/KV/Postgres, firewall, uso y facturación, miembros del equipo, webhooks.

**Errores encontrados:**

- `main/vercel.ts:473-476`: al editar una variable siempre manda `type: 'encrypted'` y **nunca manda la rama**. Si editas una variable de una rama o de tipo _sensitive_, se convierte en "todas las ramas" y "encrypted" sin avisar.
- `main/vercel.ts:421`: el log se descarga **completo cada 4 s** en vez de seguir desde donde iba.
- `VercelPanel.tsx:330-336, 370-375`: si falla la carga mientras compila, sale un aviso de error **cada 5 s**.
- Límites fijos sin paginación: dominios 50, proyectos 100, despliegues 30 (`main/vercel.ts:355,332,397`).

---

## 17. Panel de Git muy básico

Archivos: `renderer/components/GitPanel.tsx`, `GitModals.tsx`, `main/git.ts`.

**Lo que ya tiene:** estado de archivos; sincronizar, pull, push, stash; rama con adelante/atrás; insignia del PR (vía `gh`) y crear PR (abre la web); publicar en GitHub; preparar/quitar/descartar por archivo; commit, commit + push, amend, mensaje con IA; diff lado a lado (solo lectura); historial de los últimos 80 commits con revertir y deshacer el último; ramas (crear, cambiar, fusionar, borrar); stash (aplicar, sacar, borrar); clonar desde GitHub.

**Lo que falta:**

- **Alta prioridad:**
  - **Preparar por partes** (bloques o líneas), no solo archivos completos.
  - **Marcas de cambios en el editor** (barra lateral verde/azul/roja), ver y revertir un bloque desde ahí.
  - **Conflictos de merge/rebase:** aviso de "merge en curso", abortar/continuar, editor de 3 vías, aceptar "mío/suyo". No hay rebase.
  - **Gráfico de ramas** en el historial, "cargar más", buscar por archivo/autor/fecha.
  - **Opciones de pull:** hoy solo `--ff-only` (`main/git.ts:292`), así que si las ramas divergieron **falla**. Falta rebase/merge, push con `--force-with-lease`, elegir remoto.
- **Media:** blame (en línea y vista completa); historial de un archivo y de una línea; comparar ramas/commits; cherry-pick, rebase interactivo, reset a un commit, rama desde commit; etiquetas (tags); administrar remotos; crear PR dentro de la app (título, cuerpo, base, borrador, revisores) y ver/descargar PRs; descripción de PR con IA.
- **Baja:** ver el diff de un stash antes de aplicarlo; renombrar ramas; ordenar ramas por fecha; worktrees; submódulos; `.gitignore` desde el menú; plantillas de commit; estado de firma GPG.

**Errores encontrados:**

- `main/git.ts:295`: el primer push sin upstream usa el primer remoto **por orden alfabético** (`remotes[0]`), mientras el estado prefiere `origin` (`:165`). Con remotos `fork` y `origin`, el push va a `fork`.
- `main/git.ts:200`: el diff preparado de un archivo **renombrado** lee la ruta nueva en `HEAD` (no existe), así que aparece como archivo nuevo completo.
- `GitPanel.tsx:571,702`: historial y ramas **comparten el mismo filtro**: lo que escribes en uno filtra el otro.
- El límite de 80 commits no se puede cambiar (`main.ts:1134`, `git.ts:224`).
- No se puede descartar un cambio que ya está preparado (`GitPanel.tsx:226-242`).
- Cambiar de rama con cambios sin guardar solo muestra el error crudo de git; falta "guardar en stash y cambiar".

---

## 18. Buscar en archivos está mal

Archivos: `renderer/components/Search.tsx`, `main/workspace.ts`, `Editor.tsx`.

**Cómo funciona:** usa **ripgrep** si `rg.exe` está en el PATH (**no viene incluido**, `main/bin.ts:13-24`); si no, una búsqueda lenta en JavaScript. Tiene mayúsculas, palabra completa, regex, incluir/excluir, resultados por archivo y reemplazar.

**Problemas, de más grave a menos:**

- **Alta:**
  - **Los errores de ripgrep se tragan** (`workspace.ts:314`): un regex que ripgrep no acepta (lookbehind, referencias) sale como "Sin resultados" en vez de error.
  - **Dos tipos de regex distintos:** se valida y resalta con regex de JavaScript, pero se busca con regex de Rust.
  - **Incluir/excluir se aplica después del límite:** los filtros se aplican en la interfaz (`Search.tsx:213`), no se le pasan a ripgrep. Con más de 2000 resultados, faltan archivos que sí incluiste.
  - **No se cancelan búsquedas viejas:** cada tecla lanza un `rg` nuevo y los anteriores siguen corriendo.
  - **Reemplazar todo no se puede deshacer** (escribe directo al disco, `Search.tsx:293-294`). No hay reemplazar uno solo ni descartar un resultado.
  - **Conteo incorrecto:** ripgrep guarda solo la primera coincidencia por línea y máximo 200 por archivo, pero reemplazar cambia **todas**; el número del aviso de confirmación es menor que lo que realmente se cambia.
- **Media:**
  - **No busca en archivos ocultos** (`.github/`, `.env.example`…) porque falta `--hidden` (`workspace.ts:272-279`).
  - **Columna equivocada** con acentos o emojis (ripgrep da bytes, no caracteres, `workspace.ts:304`): abre el archivo en otra posición.
  - Sin ripgrep: lee hasta 20 000 archivos uno por uno e ignora `.gitignore`.
  - Líneas largas: se cortan a 300 caracteres; coincidencias después no se ven.
  - No hay F4 / Shift+F4 para ir al siguiente resultado; al abrir un resultado las flechas dejan de funcionar en la lista.
  - Ctrl+Shift+F no toma la selección del editor; la búsqueda se pierde al cambiar de panel.
- **Baja:** líneas de contexto, búsqueda multilínea, historial, "solo archivos abiertos", vista de árbol, exportar resultados.
- **Buscar dentro del archivo (Ctrl+F):** el buscador del editor sí está, pero **no hay "Buscar/Reemplazar" en el menú Editar** (`main.ts` ~2220-2235), así que no se descubre. Archivos de más de 10 MB solo buscan en la página actual de 1 MB (`FileViewers.tsx:322-327`).

**Cómo arreglarlo (orden):**

1. **Incluir `rg.exe` en el instalador** (resuelve velocidad y `.gitignore`).
2. Mostrar errores de ripgrep; pasar incluir/excluir como `--glob`; cancelar la búsqueda anterior; añadir `--hidden`; corregir la columna (bytes → caracteres).
3. Reemplazar con deshacer (pasarlo por los modelos del editor), reemplazar uno, conteo correcto.
4. F4 / Shift+F4, tomar la selección, recordar la búsqueda en el store.
5. "Buscar" y "Reemplazar" en el menú Editar.

---

## 19. Revisión general: lo que le falta o está roto en la app

**Buenas noticias:**

- El chequeo de tipos (`tsc --noEmit`) pasa **sin errores**.
- Los 278 canales del puente (`preload.ts`) tienen su manejador en `main`.
- No hay comentarios TODO/FIXME en el código.
- Los 43 `catch` vacíos del proceso principal tienen comentario y parecen intencionales.

### Crítico (a confirmar)

- `main/workspace.ts:176`: el vigilante de archivos (`fs.watch`) **no tiene manejador de `error`**. En Windows, si se borra la carpeta abierta o se desconecta la unidad, el error puede **tumbar el proceso principal**. El `try/catch` de la línea 181 solo atrapa errores al crearlo. Arreglo: `watcher.on('error', ...)`.

### Alta

1. **El Vigía gasta tokens por defecto sin pedir permiso** (ver punto 13).
2. **"Detectar y ejecutar" y otros paneles recargan sin parar** con cada cambio de archivo (ver punto 9).
3. **Depurador construido pero sin interfaz:** `main/debug/*`, handlers `debug:*` (`main.ts:~1063`) y `preload.ts:234-246` existen, pero **nada en la interfaz los usa**.
4. **Servidor de lenguaje (LSP) construido pero sin interfaz:** `main/lsp.ts`, `lspProtocol.ts`, handlers `lsp:*` (`main.ts:836+`), `preload.ts:309-318`. En la interfaz existen `lspConvert.ts` e `i18nLsp.ts` pero **nadie los importa**. Sin esto no hay autocompletado inteligente, "ir a definición" ni errores en vivo para la mayoría de lenguajes.
5. **Predicción de la siguiente edición** (`ai:nextEdit`, `main.ts:820-832`) solo existe en el backend; la opción `nextEdit` viene activa por defecto pero no tiene interruptor en Ajustes ni nadie la llama.

### Media

6. **Extensiones:** se pueden listar, pero **no instalar/desinstalar** desde la interfaz (`preload.ts:250-251` sin uso).
7. **Recuperar ejecuciones del agente interrumpidas** (`app.interruptedRuns`, `main.ts:415, 1856, 2534-2536`) nunca se llama desde la interfaz (puede que ya lo reemplace `c.resume`, a confirmar).
8. **WhatsApp:** no hay botón para desvincular la sesión (`whatsapp.forget` sin uso).
9. Textos del Vigía fijos en español.
10. Revisiones del Vigía no se pueden cancelar y los fallos gastan el cupo.
11. Errores de detección en Ejecutar se tragan (`RunPanel.tsx:302-304, 323`).
12. Modal `SecurityCenter` sin uso (código muerto).
13. CSS duplicado y contradictorio en barra de actividades y lista de chats (puntos 4 y 6); `styles.css` tiene ~8000 líneas: conviene dividirlo por componente.

### Baja

14. Editor visual: reemplazar/recortar imágenes dice "próximamente" (`design/Properties.tsx:158`).
15. Ejecutar sugiere `python3 -m http.server` para `index.html` (`RunPanel.tsx:200-203`); en Windows suele ser `python` o `py`.
16. El intervalo del Vigía es compartido entre todos los proyectos (`watch.ts:332`).
17. Botón "Revisar ahora" duplicado en el Vigía (`WatchPanel.tsx:73-75, 140-142`).
18. El navegador interno bloquea todas las descargas y permisos (`browser.ts:226-228`): conviene permitir descargas con confirmación.

---

## 20. Orden recomendado de trabajo

**Fase 1 — Lo que más molesta (rápido):**

1. Google 403 → agregar usuarios de prueba en Google Cloud Console (5 minutos, sin código).
2. Arreglar el redimensionado del chat (punto 1).
3. "Detectar y ejecutar" que no reanalice (punto 9).
4. WhatsApp: detección de sesión + mostrar errores (punto 8).
5. Manejador de `error` en `fs.watch` (punto 19, crítico).
6. Vigía apagado por defecto y renombrado (punto 13).

**Fase 2 — Se ve mejor:**

7. Barra de actividades agrupada (punto 6) y nuevo icono de chat (punto 5).
8. Panel de seguridad adaptable (punto 7).
9. Chats: modelo visible, botón + con historial por carpeta, cabecera ordenada (puntos 2, 3 y 4).
10. Colores de la terminal (punto 12).

**Fase 3 — Funciones nuevas:**

11. Links al navegador interno (punto 11) e importar cookies (punto 10).
12. Búsqueda: incluir ripgrep + arreglos (punto 18).
13. Git: preparar por partes, marcas en el editor, conflictos, gráfico (punto 17).
14. Supabase: editor de tablas, SQL con Monaco, RLS, Storage (punto 15).
15. Vercel: logs en vivo, arreglo de variables, ayuda DNS, desplegar desde la app (punto 16).
16. Conectar el LSP, el depurador y la siguiente edición que ya están hechos en el backend (punto 19).
17. Separar permisos de Google y mostrar "usar mi propio cliente OAuth" (punto 14).

---

## 21. Cambio hecho: carpeta `.md`

Se juntaron los documentos en la carpeta **`.md/`** de la raíz:

```
.md/
├── revision-completa-2026-11-14.md   ← este documento
├── release-signing.md                 (antes docs/release-signing.md)
├── en/                                (antes docs/en/)
├── es/                                (antes docs/es/)
└── notas/                             (antes en la raíz)
    ├── api.md
    ├── cambios.md
    ├── camviosui.md
    ├── panel edicion.md
    ├── revision.md
    └── video.md
```

- Se actualizaron los enlaces en `README.md`, `.github/workflows/release.yml` y `apps/desktop/scripts/build-editions.mjs`.
- **No se movieron**, a propósito:
  - `README.md`: GitHub lo necesita en la raíz.
  - `AGENTS.md`: Turborepo lo vuelve a crear en la raíz.
  - Los `README.md` de `packages/server` y `packages/ui`: pertenecen a cada paquete.
  - Los `.md` de `vendor/` y `node_modules/`: son código de terceros.
- `api.md` sigue ignorado por `.gitignore` (estaba vacío).
