# Guía de Zinarix Studio

Zinarix Studio es un editor de código que funciona con cualquier inteligencia artificial (IA): más de 60 proveedores (OpenAI, Anthropic, Google, OpenRouter…) y modelos locales y gratis en tu computadora (Ollama, LM Studio). Tiene chat con IA, un modo agente que trabaja en tu proyecto con tu permiso, terminal, navegador, Git, editor visual de páginas, editor de video y más.

## Cómo se ve la ventana

- A la izquierda está la **barra de actividad**: una columna de iconos que abre los paneles (Explorador, Buscar, Control de código (Git), Ejecutar, Chat de IA, Vigía, Panel de Edición, Video Studio, Terminal…). El botón **Más** abre las demás integraciones y herramientas (Vercel, Supabase, Google Cloud, Correo, WhatsApp, Navegador, Consumo de créditos, Paleta de comandos). Abajo en esa columna están Centro de seguridad, Proveedores de IA y Ajustes. Si pasas el mouse sobre un icono ves su nombre.
- En el centro está el **editor**, con pestañas para cada archivo abierto.
- A la derecha está el **Chat de IA**.
- Abajo está la **barra de estado**: muestra la carpeta abierta, la rama de Git, archivos sin guardar y el modelo de IA elegido. Si haces clic en el modelo puedes cambiarlo.
- En la esquina de abajo a la derecha está el botón redondo de **Ayuda de Zinarix** (este asistente).

## Abrir un proyecto (carpeta)

1. Ve al menú **Archivo > Abrir carpeta…** (o presiona Ctrl+O).
2. Elige la carpeta de tu proyecto.
También puedes arrastrar una carpeta a la ventana, o hacer clic en el nombre de la carpeta en la barra de estado. Para cerrarla: **Archivo > Cerrar carpeta**. Para abrir un archivo rápido por nombre: **Archivo > Apertura rápida…** (Ctrl+P).

## Crear y guardar archivos

- Archivo nuevo: **Archivo > Nuevo archivo** (Ctrl+N). Primero debes tener una carpeta abierta.
- Guardar: **Archivo > Guardar** (Ctrl+S). Guardar todo: Ctrl+Alt+S.
- Cerrar pestaña: Ctrl+W.
- Guardado automático: **Ajustes > Editor > Guardado automático**.

## Conectar una IA (primer paso)

Para usar el chat necesitas al menos un modelo de IA. Hay tres formas:
1. **En tu computadora (gratis y privado)**: instala Ollama o LM Studio. Zinarix los detecta solo cuando están abiertos.
2. **Agente de terminal**: Claude Code, Codex o Gemini CLI con tu propia cuenta.
3. **Llave de API**: ve al menú **IA > Proveedores y llaves…** (o el icono de llave "Proveedores de IA" en la barra de actividad), elige el proveedor (OpenAI, Anthropic, Google, OpenRouter…) y pega tu llave de API.
Las llaves se guardan en el llavero seguro del sistema, no en texto plano.

## Elegir el modelo de IA

- Menú **IA > Seleccionar modelo…** (Ctrl+Alt+M), o haz clic en el nombre del modelo en la barra de estado.
- El selector muestra cada modelo con su precio, contexto y capacidades.
- Puedes usar un modelo distinto para chat, para el agente y para la edición (Ctrl+K). Cada pestaña de chat puede tener su propio modelo.

## El Chat de IA

- Abrir o cerrar el chat: **Ver > Chat de IA** (Ctrl+Alt+I) o el icono del chat en la barra de actividad.
- Escribe tu pregunta abajo y presiona Enter para enviar.
- Nuevo chat en paralelo: **IA > Nuevo chat (en paralelo)** (Ctrl+Alt+N). Varios chats pueden trabajar al mismo tiempo; cambiar de pestaña no pausa al que está trabajando.
- Ver dos chats a la par: **IA > Ver dos chats a la par** (Ctrl+Alt+D).
- Preguntar sobre código: selecciona el código en el editor y usa **IA > Preguntar sobre la selección** (Ctrl+L).
- Editar código con IA: selecciona el código y usa **IA > Editar selección con IA…** (Ctrl+K).
- Puedes adjuntar imágenes al chat.
- El historial de chats guarda tus conversaciones (Hoy, Ayer, Últimos 7 días…). Puedes renombrarlas, exportarlas o borrarlas.

## Modo agente

El modo agente deja que la IA trabaje en tu proyecto: lee y busca archivos, edita archivos y ejecuta comandos en la terminal.
- Actívalo con el botón **Agente** del chat.
- Cada escritura de archivo y cada comando **pide tu aprobación**. Puedes aprobar, rechazar o elegir "Siempre" (aprueba solo ese mismo comando).
- Las ediciones de archivos se pueden revertir durante la sesión; lo que hace un comando no se puede deshacer.
- Una IA puede pedirle a otra que haga una tarea (delegar), siempre con tu permiso.
- Sin modo agente, el chat es simple: la IA solo ve lo que adjuntas.

## Controlar la compu (que la IA use tu computadora entera)

Con el modo agente activo, el botón **Compu** (ícono de monitor, junto a "Razonar") le da a la IA el control de toda tu computadora: ve tu pantalla y usa el mouse y el teclado en cualquier programa (Excel, ajustes de Windows, otras apps).
- Al encenderlo te pide confirmar. Luego el botón dice **"Controla la compu"** en color ámbar.
- Mientras está encendido, la IA no pide permiso en cada clic. Los atajos delicados (cerrar programas con Alt+F4, borrar sin papelera, bloquear la sesión) sí se preguntan.
- Cuando la IA empieza a mover el mouse, Zinarix se minimiza y arriba aparece una barra: **"Zinarix está controlando tu compu"**, con el paso en que va y los botones **Pausar**, **Ver chat** y **Detener**.
- Para pausarla: botón **Pausar**, o simplemente mueve el mouse: la IA se detiene hasta que pulses **Continuar**, y después vuelve a mirar la pantalla antes de seguir. **Ver chat** también la pausa.
- Para pararla: botón **Detener** de la barra, el atajo **Ctrl+Alt+Esc** (desde cualquier programa), el botón de parar del chat, o mover el mouse a la esquina de arriba a la izquierda de la pantalla.
- La IA puede abrir programas por su nombre, páginas web y páginas de Configuración de Windows directamente, cambiar a una ventana abierta y ver de cerca una parte de la pantalla para leer texto pequeño. No abre programas ni scripts por su ruta.
- Si la IA necesita tu permiso o te hace una pregunta, la ventana de Zinarix vuelve sola.
- Se enciende por chat y se apaga al cerrar Zinarix. Necesita un modelo que vea imágenes.
- Sin el botón, la IA también puede usar la compu, pero pide permiso para ver la pantalla y para controlarla.

## Reglas del proyecto

Puedes escribir instrucciones fijas para la IA en tu proyecto (estilo, convenciones). Ve a **IA > Editar reglas del proyecto**: se crea el archivo .zinarix/rules.md. También se usan AGENTS.md o CLAUDE.md. Se activa o desactiva en **Ajustes > Inteligencia artificial > Reglas del proyecto**.

## Modo 100 % local

Para que nada salga de tu computadora, usa solo modelos locales: **IA > Alternar modo 100 % local**, o **Ajustes > Inteligencia artificial > Modo 100 % local**. En la barra de estado aparece "100 % local" con un candado.

## Autocompletado con IA (texto fantasma)

Mientras escribes, la IA sugiere código en gris; presiona Tab para aceptar. Se activa en **IA > Alternar autocompletado con IA** o en **Ajustes > Inteligencia artificial**. Consume tokens del modelo de edición.

## Consumo de créditos (cuánto gastas)

Abre **Consumo de créditos** desde el botón **Más** de la barra de actividad (o en la Paleta de comandos, Ctrl+Shift+P, escribe "Consumo"). Muestra el gasto de hoy y del mes por proveedor, una gráfica de 30 días y presupuestos con aviso al 80 %.

## Ajustes

Abre los ajustes con **Archivo > Ajustes…** (Ctrl+,) o el icono de engranaje abajo en la barra de actividad. Secciones:
- **Apariencia**: tema de color (claro u oscuro y otros), tamaño de la interfaz, idioma.
- **Editor**: tamaño y tipo de letra, tabulación, ajuste de línea, minimapa, números de línea, formatear al guardar, guardado automático.
- **Inteligencia artificial**: autocompletado con IA, reglas del proyecto, modo 100 % local, y la Ayuda de Zinarix (mostrar el botón redondo y su modelo).
- **MCP**: servidores MCP que dan herramientas extra a la IA.
- **Memorias**: cosas que la IA recuerda de ti y de tus proyectos.
- **Docs**: documentación externa (@Docs) que la IA puede consultar, y búsqueda por significado.
- **Celular**: controlar Zinarix desde tu teléfono, y bots de Telegram y Discord.
- **Atajos de teclado**: ver y cambiar los atajos.

## Cambiar el tema (claro u oscuro)

- Rápido: **Ver > Alternar tema claro/oscuro**.
- Con más opciones: **Archivo > Ajustes… > Apariencia > Tema de color**.

## Agrandar o achicar todo

**Ver > Agrandar todo** (Ctrl+=), **Ver > Achicar todo** (Ctrl+-) y **Ver > Tamaño real** (Ctrl+0). También en **Ajustes > Apariencia > Tamaño de la interfaz**.

## Cambiar el idioma

**Ajustes > Apariencia > Idioma**, o en la Paleta de comandos (Ctrl+Shift+P) busca "Idioma". La ventana se recarga. Hay español e inglés.

## Atajos de teclado

Los más usados: guardar **Ctrl+S**, abrir carpeta **Ctrl+O**, abrir archivo rápido **Ctrl+P**, buscar en el proyecto **Ctrl+Shift+F**, paleta de comandos **Ctrl+Shift+P**, editar con IA **Ctrl+K**, nueva ventana **Ctrl+Shift+N**, depurar **F5**.

Ver todos: **Ayuda > Atajos de teclado**. Para cambiarlos: **Ajustes > Atajos de teclado**, haz clic en un atajo y presiona la nueva combinación (Esc cancela).

## Paleta de comandos

Presiona **Ctrl+Shift+P** (o **Ver > Paleta de comandos…**) y escribe lo que quieres hacer. Ahí están todas las acciones de la app.

## Terminal

Abrir o cerrar: **Ver > Terminal** (Ctrl+` o Ctrl+J). Puedes enviar lo que muestra la terminal al chat con **Ver > Enviar terminal al chat** (Ctrl+Shift+L).

## Buscar en archivos

**Editar > Buscar en archivos** (Ctrl+Shift+F) o el icono de lupa. También hay búsqueda por significado.

## Git y GitHub

Abre **Ver > Control de código (Git)** (Ctrl+Shift+G). Ahí ves los cambios con diferencias, preparas cambios (stage), haces commit (la IA puede escribir el mensaje), ves el historial, ramas y stash, y haces pull/push. Con tu cuenta de GitHub puedes clonar repositorios (**Archivo > Clonar repositorio…**) y publicar una carpeta como repositorio nuevo.

## Navegador integrado

Abre el **Navegador** desde el botón **Más** de la barra de actividad (o en la Paleta de comandos escribe "Abrir navegador"). La IA puede abrir páginas, leerlas, hacer clic y escribir (con permiso por sitio). No inicies sesión con cuentas sensibles en ese navegador.

## Panel de Edición (editor visual)

El icono de paleta abre el **Panel de Edición**: editas páginas web de tu proyecto de forma visual (textos y estilos) y se guarda en el código.

## Zinarix Video Studio

Editor de video integrado: **Ver > Zinarix Video Studio** (Ctrl+Shift+V) o el icono de película. Importas videos, imágenes y audio, editas en la línea de tiempo y exportas.

## Ejecutar, Vercel, Supabase y Google Cloud

- **Ejecutar**: corre los comandos de tu proyecto.
- **Vercel**: despliega tu sitio web.
- **Supabase**: base de datos, usuarios, funciones y almacenamiento.
- **Google Cloud**: BigQuery, Storage, Cloud SQL y más.
Ejecutar tiene su icono en la barra de actividad; Vercel, Supabase y Google Cloud están en el botón **Más**.

## Correo

El panel **Correo** (en el botón **Más**) lee, responde y envía correos de tu cuenta.

## Vigía

**Vigía** (icono de ojo) revisa tus proyectos abiertos solo: cada 5 minutos mira si cambiaron y, cuando hubo cambios, la IA te dice qué arreglar o mejorar.

## Celular, WhatsApp, Telegram y Discord

- **Ajustes > Celular**: activa "Permitir control desde el celular", conecta el celular a la misma red Wi-Fi, escanea el código QR y escribe el PIN. También hay acceso desde cualquier lugar.
- **WhatsApp**: en el botón **Más** abre WhatsApp Web y puedes controlar Zinarix por WhatsApp.
- Bots de **Telegram y Discord**: en Ajustes > Celular, después de activar "Permitir control desde el celular" aparece la sección Telegram y Discord; pega el token del bot y pulsa Conectar.

## Centro de seguridad

El icono del escudo abre el **Centro de seguridad**: revisa tu proyecto (secretos filtrados, código inseguro), dependencias vulnerables, tu equipo, sitios web y archivos por hash. También hay un **Escáner de puertos**. Úsalo solo en sistemas tuyos o con autorización.

## Varias ventanas

**Archivo > Nueva ventana** (Ctrl+Shift+N): cada ventana tiene su carpeta, navegador, terminales y chats.

## Plan, licencia y actualizaciones

- **Ayuda > Plan y licencia…**: ver tu plan o activar Zinarix Pro.
- **Ayuda > Novedades de esta versión**.
- **Ayuda > Buscar actualizaciones**. La app se actualiza sola.

## Ayuda de Zinarix (este asistente)

Es el botón redondo de la esquina de abajo a la derecha. Responde preguntas sobre cómo usar Zinarix Studio con un modelo pequeño que corre en tu computadora con Ollama (no gasta créditos y es privado).
- Instalar: descarga Ollama desde https://ollama.com/download, instálalo y ábrelo. Luego, en la Ayuda, pulsa **Descargar modelo** (unos 1 GB).
- Ocultar el botón o cambiar el modelo: **Ajustes > Inteligencia artificial > Ayuda de Zinarix**.
- Puedes arrastrar el botón para moverlo.

## Problemas comunes

- **"No hay modelo" o el chat no responde**: conecta una IA en **IA > Proveedores y llaves…** o abre Ollama/LM Studio, y elige un modelo con Ctrl+Alt+M.
- **"Abre una carpeta"**: muchas funciones necesitan un proyecto abierto: **Archivo > Abrir carpeta…**.
- **No encuentro una función**: presiona Ctrl+Shift+P y escribe su nombre.
- **La letra es muy chica**: Ctrl+= agranda todo.
