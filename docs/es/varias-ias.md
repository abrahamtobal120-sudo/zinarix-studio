# Varias IAs a la vez

Zinarix Studio 0.5 deja trabajar a varias IAs al mismo tiempo, en el mismo proyecto o en
proyectos distintos, y que una le pase trabajo a otra — siempre con tu permiso.

## Chats en paralelo

El panel de chat tiene pestañas. Cada pestaña es un chat independiente, con su propia
conversación, su modo (chat o agente) y su propio modelo.

- **Nuevo chat**: botón **+** del panel o **Ctrl+Alt+N**. El chat que estaba trabajando
  sigue trabajando: nada se pausa ni se cancela al abrir otro, al cambiar de pestaña o al
  abrir una conversación del historial.
- La pestaña muestra lo que hace cada chat: un círculo que gira mientras trabaja, ⏸ cuando
  espera tu aprobación y un punto verde cuando terminó mientras mirabas otro chat.
- **Modelo por chat**: el selector de modelo de la caja de texto cambia solo ese chat. Así
  puedes tener, por ejemplo, Claude en un chat y GPT o un modelo local en otro.
- Cerrar una pestaña que está trabajando pide confirmación y la detiene.
- Al cerrar la app, las pestañas abiertas (y sus conversaciones) se recuerdan.

## Dos chats a la par

Botón **⫿** del panel o **Ctrl+Alt+D**: dos chats lado a lado, cada uno con su barra de
modelo. La pestaña que elijas se abre en el lado que tiene el foco (el resaltado).

## Varias ventanas

**Archivo → Nueva ventana** (**Ctrl+Shift+N**). Cada ventana tiene su propia carpeta, sus
chats, su navegador y sus terminales; los proveedores, llaves, modelos e historial son los
mismos para todas. Al cerrar una ventana con chats trabajando, Zinarix avisa antes.

## El navegador para todas las IAs

- Cada conversación que usa el navegador tiene **su propia pestaña** (con el nombre del
  modelo), así dos agentes trabajando a la vez no se pelean la misma página. Todas las
  pestañas comparten cookies: si inicias sesión en un sitio, los agentes también la usan.
- **Modelos sin _function calling_** (algunos modelos locales, Reka, Replicate…) ahora también
  usan las herramientas: Zinarix les explica un formato de texto
  (`<tool_call>{"name": …, "arguments": …}</tool_call>`), ejecuta lo que piden (con las
  mismas aprobaciones) y les devuelve el resultado. Si un proveedor rechaza las herramientas
  nativas a media conversación, Zinarix cambia a este modo solo.
- **Agentes de terminal** (Claude Code, Codex, Gemini CLI, Qwen Code, Cursor, Copilot,
  OpenCode, Amp): siguen usando sus propias herramientas para archivos y comandos, y además
  reciben el navegador de Zinarix (abrir, leer, hacer clic, escribir) y la delegación.

## Una IA le pasa trabajo a otra (con tu permiso)

En modo agente, la IA tiene dos herramientas nuevas:

- `list_ai_models`: ve qué modelos tienes conectados.
- `delegate_to_ai`: le pide a otro modelo que haga una tarea. En modo `agent` el ayudante
  puede usar las mismas herramientas (archivos, terminal, navegador…); en modo `chat` solo
  responde.

Cada delegación muestra una tarjeta con el modelo que recibirá la tarea y el texto exacto
de la tarea; **no pasa nada hasta que la apruebas**. Después, **cada acción del ayudante
también te pide permiso** (sus tarjetas llevan una etiqueta con su modelo). Lo que el
ayudante escribe aparece dentro de la tarjeta de la delegación, y su respuesta vuelve a la
IA que se la pidió. Un ayudante no puede delegar a su vez. "Revertir" deshace también los
cambios de archivos que hizo el ayudante.

## Pasar una respuesta a otra IA

Debajo de cada respuesta está **Pasar a otra IA**: eliges el modelo y se abre un chat nuevo
con esa IA y la respuesta citada en la caja de texto, para que la revises antes de enviarla.

## Pruebas

- `pnpm test` — incluye `apps/desktop/test/multi-ai.test.ts` (protocolo por texto, delegación
  con aprobación, agentes de terminal, cambio automático cuando un modelo rechaza herramientas).
- `node apps/desktop/scripts/parallel-smoke.mjs <carpeta>` (con la app compilada) — prueba de
  punta a punta: dos chats en paralelo, vista a la par, delegación con el navegador y una
  segunda ventana.
