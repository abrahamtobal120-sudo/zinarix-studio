# Plan por fases: lo que le falta a Zinarix Studio

Fecha: 2026-11-20. Revisé el código el mismo día, así que la lista de lo que falta ya no incluye lo que el código tiene.

---

## ✅ Lo que ya tiene (no hay que hacerlo, solo terminar o pulir)

| Área | Qué hay en el código | Dónde |
|---|---|---|
| Depurador visual | Panel de depuración con puntos de parada, por DAP (Python, C#, etc.) y CDP (Node/Chrome), con source maps | `src/main/debug/*`, `components/DebugPanel.tsx` |
| Autocompletado LSP | Cliente LSP para Python (pyright/basedpyright), Java (jdtls), Go (gopls), Rust (rust-analyzer), C/C++ (clangd), C# (csharp-ls/OmniSharp), con instrucciones de instalación | `src/main/lsp.ts`, `src/shared/lsp.ts`, `renderer/lsp.ts` |
| Notebooks Jupyter | Kernel de Jupyter en el proceso principal | `src/main/jupyter.ts` |
| Extensiones | Tienda de Open VSX e instalación de `.vsix` | `src/main/extensions/*` |
| Visor y estudio 3D | Visor three.js (glb, obj, stl, fbx…), escena con gizmos, herramientas rápidas | `components/three/*` |
| 3D con IA | Texto → modelo 3D (Replicate) | `src/main/gen3d.ts`, `Gen3DDialog.tsx` |
| Conexión con Blender | Puente con Blender (addon Python), render, la IA lo controla con herramientas | `blenderBridge.ts`, `scene3d.ts`, `scene3dTools.ts`, `blender/` |
| Imagen, video y voz con IA | `generate_image`, `generate_video` y `generate_speech` | `src/main/media.ts`, `mediaTools.ts` |
| Editor de video | Línea de tiempo, cortes, transiciones, subtítulos, silencios, muletillas, edición por texto, formato vertical, exportar | `components/video/*` |
| Video pro (parcial) | Velocidad de clip, fotogramas clave de transformación, panel de color con scopes | `Inspector.tsx`, `ColorPanel.tsx`, `colorGrade.ts`, `Scopes.tsx` |
| Control del equipo | Uso de la computadora (computer use) | `computer*.ts` (nuevo, sin commit) |

> Tarea de la Fase 0: **probar cada uno en la app real** y anotar qué funciona de verdad y qué está a medias.

---

## Fase 0: verificar y pulir lo que ya existe (1 semana)

- [~] Depurador: probar puntos de parada, variables, pila y "paso a paso" con Node, Python y C#. Agregar puntos de parada condicionales y logpoints si no están. **Hecho (2026-11-21):** los condicionales ya existían; se agregaron **logpoints** (clic derecho en el margen o el botón 💬 del panel; `x = {x}` imprime sin detenerse). En Node (CDP) se convierten en una condición que imprime; en DAP se mandan como `logMessage` si el adaptador los soporta (si no, no se envían, para que no se detenga). Probado con un programa de Node real (`test/logpoints.test.ts`). Falta probar Python y C# (no instalados aquí).
- [~] LSP: probar cada lenguaje. Detectar si falta el servidor y ofrecer instalarlo con un clic. **Hecho (2026-11-21):** indicador en la barra de estado con el servidor del archivo abierto ("pyright" o "Python: sin autocompletado"); al hacer clic muestra las opciones con **"Instalar en la terminal"** (el comando según el sistema: npm, pip, winget, brew, apt…) y "Volver a buscar". Código: `LspStatusItem.tsx`, `installCommand` en `shared/lsp.ts`. Falta probar cada lenguaje con su servidor instalado.
- [x] Jupyter: solo estaba el kernel, sin vista. Se hizo en la Fase 2A.
- [ ] Extensiones: confirmar qué tipos de extensión funcionan (temas, snippets, gramáticas, LSP). Documentar que las extensiones que usan la API completa de VS Code no van a funcionar.
- [ ] 3D: abrir glb, obj, stl y fbx; generar un modelo con IA; controlar Blender desde el chat.
- [ ] Video: probar velocidad, fotogramas clave y color con un video pesado (4K).

---

## Fase 1: imágenes (3–4 semanas) — la parte más vacía

**1A. Editor de imágenes sencillo** — ✅ hecho (2026-11-20)
- [x] Abrir png, jpg, webp y bmp: botón **✎ Editar** en el visor de imágenes (`components/image/ImageEditor.tsx`).
- [x] Recortar (libre, 1:1, 4:3, 3:2, 16:9, 9:16, 4:5), rotar, voltear y cambiar tamaño (con proporción).
- [x] Brillo, contraste, saturación, temperatura y exposición. (No se reusó `colorGrade.ts`: ese trabaja con ruedas y curvas de video; las fórmulas nuevas están en `src/shared/imageEdit.ts`.)
- [x] Filtros: desenfoque, nitidez, blanco y negro, sepia, y 8 estilos rápidos.
- [x] Deshacer y rehacer (Ctrl+Z / Ctrl+Y), botón "Original" para comparar; guardar copia en png, jpg o webp (Ctrl+S) o reemplazar el original (pide confirmación).
- [x] Herramientas para la IA: `image_info` (libre) e `image_edit` (con permiso; reemplazar un archivo se pregunta siempre). Usan FFmpeg y las mismas funciones que el editor (`src/main/imageTools.ts`).
- [x] Pruebas: `test/imageEdit.test.ts`, `test/imageTools.test.ts` (con FFmpeg real) y prueba manual en la app con Playwright.
- [x] El cálculo pesado va en un worker (`components/image/image.worker.ts`): vista previa, histograma, Auto y guardar. Guardar una foto de 6000 × 4000 tarda ~0,7 s y la ventana no se congela (pausa máxima 23 ms).
- [x] Mejoras (2026-11-20): asas en las esquinas y lados del recorte, mover el recorte con las flechas, tecla C para recortar; **enderezar** (−45…45°, con zoom para no dejar esquinas vacías); **luces, sombras, intensidad (vibrance), tono y viñeta**; botón **✨ Auto** (contraste, brillo, dominante de color); **histograma**; botón "Restablecer" por sección; tamaños rápidos 25/50/75 %; 4 estilos nuevos (Película, Drama, Noir, Pastel). La IA tiene los mismos ajustes en `image_edit`, más `auto: true`.

**1B. Quitar el fondo y mejorar fotos** — quitar el fondo ✅ (2026-11-21)
- [x] Quitar el fondo **en la PC** con un modelo ONNX, sin pagar y sin subir la foto. Dos modelos (licencia Apache 2.0; RMBG no, porque no permite uso comercial): **Rápido** (U²-Net pequeño, 4,6 MB, va incluido, ~1 s) y **Preciso** (IS-Net, 179 MB, se descarga una vez desde el editor con su progreso y se verifica con SHA-256, ~3–6 s, bordes y pelo más finos). Corre con ONNX Runtime Web (WebAssembly, MIT) en un proceso aparte (`resources/bgremove`, como OpenSCAD), con 4 hilos. En el editor: sección **Fondo** (quitar / poner otra vez, fondo transparente, blanco, negro u otro color), con deshacer y rehacer porque es parte de la edición; cambia a PNG para conservar la transparencia. IA: `image_remove_bg` (con permiso; recibe una vista previa sobre cuadros para revisar el recorte; `trim` recorta al sujeto). Código: `shared/bgRemove.ts`, `main/bgRemove.ts`, `main/bgWorker.ts`. Pruebas: `test/bgRemove.test.ts` (con el modelo real y como proceso aparte) y en la app con Playwright (los dos modelos, la descarga real y guardar el PNG).
- [ ] Opción en la nube (Replicate) para quien quiera más calidad.
- [ ] Mejorar resolución ×2 o ×4 (Real-ESRGAN local o en la nube).

**1C. Editar con IA**
- [ ] Herramienta `edit_image(path, prompt, mask?)`: "cambia el cielo", "quita a la persona".
- [ ] Pincel para marcar la máscara en el lienzo.
- [ ] Panel de generación de imágenes dentro del editor (ya existe `generate_image`).

**1D. Capas**
- [ ] Capas con opacidad, orden, ocultar y modos de fusión básicos.
- [ ] Guardar el proyecto en un formato propio (json + imágenes) y exportar a png.

---

## Fase 2: notebooks y Docker (2–3 semanas)

**2A. Notebooks** — ✅ hecho (2026-11-20). El motor (`jupyter.ts`, `shared/notebook.ts`) existía pero no estaba conectado: no había vista ni IPC.
- [x] Abrir `.ipynb` como celdas de código y de texto (markdown): `components/notebook/NotebookView.tsx`. Editor Monaco por celda (se crea al verse en pantalla), texto con vista previa (doble clic para editar).
- [x] Ejecutar una celda, todas, desde aquí; interrumpir, reiniciar, reiniciar y ejecutar todo, borrar resultados. Teclas como Jupyter: Shift+Enter, Ctrl+Enter, Alt+Enter; fuera del editor A/B, D D, M/Y, flechas. Ctrl+S guarda.
- [x] Resultados: texto, errores, tablas HTML (pandas), imágenes (png/jpg/gif/svg), markdown y JSON. El HTML se convierte a elementos seguros: no corre scripts, estilos ni carga nada de internet (probado).
- [x] Elegir el Python (venv del proyecto, conda, PATH) y ver si tiene Jupyter; si falta, aviso con el comando `pip` y botón para instalar en la terminal.
- [x] IA: `notebook_read` (libre), `notebook_edit` y `notebook_run` (con permiso). La IA usa el mismo kernel que la ventana, guarda los resultados en el archivo y ve la última gráfica.
- [x] Pruebas: `test/notebookTools.test.ts` (con kernel real), y prueba en la app con Playwright.
- [x] Mejoras (2026-11-20): **autocompletado del kernel** en las celdas (complete_request; sabe las variables e imports de lo que ya corrió) y **ayuda al pasar el ratón** (firma y docstring, inspect_request); **panel de variables** (nombre, tipo, forma/tamaño, valor; se actualiza al terminar de ejecutar; oculta módulos y funciones); **tiempo de cada celda** (en vivo mientras corre); **colores ANSI** en errores y salidas (con los colores del tema); botón **✨ Arreglar con IA** en los errores (la IA lee, corrige y vuelve a ejecutar la celda, con permiso) y **Copiar error**; **Exportar como script** (`# %%`, lo leen VS Code, Spyder, PyCharm y jupytext); botón "Ejecutar las de arriba"; salidas enormes se recortan con "Mostrar todo". IA: `notebook_variables` (libre). Pruebas: `test/phase2-mejoras.test.ts` (con kernel real) y en la app con Playwright.
- [ ] Pendiente: widgets interactivos (ipywidgets) y gráficas con JavaScript (Plotly): se muestra su texto.

**2B. Panel de Docker** — ✅ hecho (2026-11-20). En "Más" → Docker (`components/docker/DockerPanel.tsx`, `src/main/docker.ts`).
- [x] Contenedores (agrupados por proyecto compose), imágenes, volúmenes y redes, con el CLI `docker`. Se actualiza cada 5 s.
- [x] Iniciar, detener, reiniciar, reanudar y borrar (borrar pide confirmación). Los puertos se abren en el navegador con un clic.
- [x] Registros en vivo (`docker logs -f`) y terminal dentro del contenedor (`docker exec -it … sh`).
- [x] `docker compose up/down/restart/pull` con los archivos compose del proyecto.
- [x] Si Docker está apagado: botón "Abrir Docker Desktop" que espera a que encienda.
- [x] IA: `docker_ps`, `docker_logs` (libres), `docker_action`, `docker_run`, `docker_compose` (con permiso; borrar nunca queda en "siempre"). `docker_run` solo acepta opciones seguras (sin `--privileged` ni comandos sueltos) y avisa si monta carpetas de la PC.
- [x] Pruebas: `test/docker.test.ts` (incluye prueba en vivo con Docker real) y prueba en la app.
- [x] Mejoras (2026-11-20): **CPU y RAM** de cada contenedor en marcha (docker stats); **detalles** al hacer clic en el nombre (imagen, comando, estado y código de salida, salud, reinicio, puertos, montajes, redes con IP, variables con los valores secretos ocultos hasta pedirlos); **buscador**; **descargar imagen** (pull) y **construir imagen** con los Dockerfile del proyecto, con la salida en vivo y botón Detener; **crear contenedor** desde una imagen con un formulario (nombre, puertos, variables, volúmenes, reinicio, comando; avisa si monta carpetas de la PC); pestaña **Espacio** (docker system df) con **limpieza** de contenedores detenidos, imágenes sin nombre, caché de construcción y volúmenes sin usar (siempre pregunta); colores ANSI en registros y salidas. IA: `docker_inspect` (libre; oculta valores secretos), `docker_ps` con `stats`, `disk` y `dockerfiles`, `docker_pull`, `docker_build` y `docker_prune` (con permiso; limpiar nunca queda en "siempre"). Pruebas: `test/phase2-mejoras.test.ts` (con Docker real) y en la app (pull de alpine, build, contenedor con `sleep`, CPU/RAM, detalles, espacio).

---

## Fase 3: diseño y vectores — ✅ hecha (2026-11-20)

Todo entra por **Más → Estudio gráfico** (`components/graphics/GraphicsPanel.tsx`) o abriendo un `.svg` / `.zdraw`.

**3A. Dibujo y pintura** — `components/paint/PaintView.tsx`, `src/shared/paint.ts`
- [x] Lienzo con pincel (presión de la pluma con Pointer Events y eventos "coalesced"; la presión cambia tamaño y/o opacidad), borrador, cubeta (tolerancia, "usar todas las capas", sin halo en los bordes) y gotero (I, o Alt mientras pintas; clic derecho = segundo color). Dureza, opacidad del trazo, Shift = línea recta desde el último trazo, [ ] cambian el tamaño, X intercambia colores, muestras y colores recientes.
- [x] Capas: nueva, duplicar, borrar, subir/bajar, combinar hacia abajo, vaciar, ocultar, renombrar, opacidad y 8 modos de fusión. Deshacer/rehacer de todo (Ctrl+Z / Ctrl+Y). Se guarda como `.zdraw` (JSON con un PNG por capa) y "Exportar PNG" aplana.
- [x] Botón **🖌 Pintar** en el visor de imágenes: la foto queda como capa "Fondo" y el dibujo se guarda junto a ella.
- Nota: las capas se hicieron en el lienzo de pintura; la Fase 1D (capas en el editor de fotos) sigue pendiente.

**3B. Vectores y logos** — `components/vector/VectorEditor.tsx`, `vectorSession.ts`, `src/shared/graphics.ts`
- [x] Los `.svg` se abren en el editor de diseño (botón **</> Código** para ver el texto y **🎨 Diseño** para volver). El SVG sigue siendo el archivo: cada cambio se escribe en su texto, así que Guardar, el punto de "sin guardar" y los cambios de la IA funcionan igual que con cualquier archivo.
- [x] Herramientas: seleccionar (clic, Shift, recuadro), rectángulo, elipse, línea, plumilla (Bézier: clic = esquina, arrastrar = curva, clic en el primer punto cierra), texto (varias líneas), formas listas (estrella, triángulo, hexágono, flecha, corazón, globo) e imágenes (botón o arrastrar; quedan dentro del SVG).
- [x] Mover (con guías "imán" a la página y a otros elementos; Shift fija el eje; Alt+arrastrar duplica), cambiar tamaño con asas (Shift = proporción, Alt = desde el centro), girar (Shift = de 15 en 15°), voltear, X/Y/W/H/giro exactos, flechas para mover.
- [x] Relleno, borde, grosor, opacidad, esquinas redondeadas, colores de degradados; texto: fuente, tamaño, negrita, cursiva, alineación y espaciado.
- [x] Alinear (a la página con uno, entre ellos con varios), repartir, orden (al frente/al fondo), agrupar/desagrupar (doble clic entra al grupo), duplicar, copiar/pegar, borrar. Panel de **capas** con nombres, ocultar, bloquear, arrastrar para reordenar y renombrar (se pliega si hay poco espacio).
- [x] Deshacer/rehacer, zoom (Ctrl+rueda, Ctrl+0 ajusta), mover la vista (Espacio o botón del medio). Exportar **PNG / JPG** a 0,5×–4× (fondo transparente opcional).
- [x] Seguridad: el SVG va en un shadow DOM (sus `<style>` e ids no tocan la app), se quitan scripts, eventos `on…` y enlaces `javascript:`.
- [x] Mover y escalar figuras simples se guarda en sus atributos (x, y, width…), no como matriz, para que el SVG quede limpio.
- [x] IA: `design_templates` y `svg_render` (libres; `svg_render` le **muestra la imagen** a la IA para que revise su logo), `design_new` y `svg_export` (con permiso; reemplazar un archivo se pregunta siempre). El SVG se dibuja en una ventana oculta aparte que no carga nada de internet ni corre scripts (`src/main/svgRaster.ts`). Botón **✨ IA** en el editor ("cambia los colores a tonos café") y **Crear con IA** en el panel ("hazme un logo de…").

**3C. Diseño tipo Canva**
- [x] 9 plantillas: post de Instagram, historia, miniatura de YouTube, tarjeta de presentación, logo, póster, diapositiva 16:9, portada (Facebook/X/LinkedIn) y en blanco; 5 paletas de colores; textos propios y tamaño a medida. Se crean en `disenos/` con nombre libre.
- [x] No se reusó el panel de Edición (`DesignPanel`): ese edita páginas web en vivo; los diseños usan el editor SVG nuevo.
- [x] Pruebas: `test/graphics.test.ts` y `test/paint.test.ts` (29), el dibujo de SVG en Electron real (PNG, JPG, SVG roto, SVG con script) y la app con Playwright (plantilla → mover, tamaño, color, figuras, plumilla, texto, recuadro, alinear, agrupar, girar, deshacer, guardar, código, exportar 2×; lienzo: pincel, capa, cubeta, fusión, guardar, exportar; pintar sobre una foto).
**Mejora (2026-11-20)**
- [x] **Editar puntos** de un trazo (`src/shared/pathEdit.ts`): A, Enter o doble clic en un trazo. Lee cualquier trazo SVG (relativo, H/V, S/T, Q y arcos) y lo vuelve a escribir como M/L/C/Z. Mover puntos y manijas (las suaves giran juntas; Alt las separa), doble clic en la línea agrega un punto sin cambiar la forma, Supr borra, esquina ↔ suave, abrir/cerrar, recuadro para elegir varios, flechas. Rectángulos, elipses, líneas y polígonos se convierten en trazo al editarlos. Deshacer mantiene el modo de puntos.
- [x] **Texto que se ajusta a un ancho** (`data-wrap-width`): las líneas se cortan con la medida real de la fuente; las asas de los lados cambian el ancho del cuadro sin cambiar la letra; al editar se ve el párrafo completo (las líneas cortadas llevan `data-soft`). Cambiar fuente, tamaño o espaciado vuelve a acomodar el texto.
- [x] 4 plantillas más (13): invitación, menú de restaurante, diploma y oferta.
- [x] Lienzo: **selección rectangular (M) y lazo (L)** con hormigas (Shift suma, Alt resta), pintar/cubeta solo dentro, Ctrl+A / Ctrl+D / Ctrl+Shift+I, borrar, rellenar, copiar a capa nueva (Ctrl+J), Ctrl+C / X / V.
- [x] Lienzo: **mover y transformar (V)**: levanta lo seleccionado (o la capa), arrastrar, esquinas para escalar (Shift sin proporción), voltear, flechas; Enter aplica (un paso de deshacer), Esc cancela; la selección se mueve con los píxeles.
- [x] Lienzo: **pinceles** redondo, lápiz, aerógrafo, marcador, spray y tiza; **simetría** espejo ↔, ↕ y 4 lados.
- [x] Pruebas: `test/pathEdit.test.ts` (17) y la app con Playwright (plantilla nueva, puntos, texto con ancho, selección, mover/escalar, lazo + Supr, spray con simetría, marcador, tiza, guardar).
- [ ] Pendiente: fuentes de internet, páginas múltiples, girar en la transformación del lienzo y operaciones entre figuras (unir / restar).

---

## Fase 4: video que falta (3–4 semanas)

Ya existían en Video Studio: velocidad fija por clip, fotogramas clave (transformación, volumen, panorama, efectos y mezcla de color A/B), ruedas de color con LUT `.cube` y scopes, mezclador con volumen/panorama/EQ/compresor por pista, y textos animados (paquete de animaciones y máquina de escribir).

- [x] **4A. Grabar la pantalla** (como OBS/Loom). Hecho: botón **⏺ Grabar** en Medios. Elegir pantalla o ventana (con miniaturas), sonido de la PC (Windows), micrófono y cámara; calidad (30/60 fps o ligera), cuenta regresiva, minimizar Zinarix. Barra flotante con tiempo, medidor del micrófono, pausa, detener (también con **Ctrl+Alt+R** desde cualquier lugar) y descartar. Se guarda en `media/recordings/` del proyecto (o en Videos), se reempaqueta con FFmpeg para que tenga duración, y va a la línea de tiempo; la cámara queda en su propia pista, chica en la esquina. Código: `src/main/recorder.ts`, `components/video/screenRecord.ts` y `RecordDialog.tsx`.
- [x] **4B. Rampas de velocidad.** Hecho: 6 curvas (Héroe, Bala, Montaje, Entrada rápida, Salida rápida, Frenar al final) y una curva propia que se dibuja arrastrando puntos. Se guardan como pasos cortos de velocidad fija (uno cada ~¼ s), así la vista previa, el audio y la exportación ya funcionan; al hacer clic se selecciona toda la rampa y se mueve como un clip. Quitar la rampa devuelve el clip original. IA: `video_speed_ramp`. Código: `src/shared/videoRamp.ts`, `RampSection.tsx`.
- [x] **4C. Archivos proxy.** Hecho: copias de 540p (H.264, un fotograma clave cada medio segundo) en la caché; se crean solas para videos de más de 1080p (opción), o con el botón ⚡ de cada video o "Crear proxies de los videos". La vista previa las usa y la exportación siempre usa el original. Interruptor "Usar proxies" en el panel del proyecto. IA: `video_proxies`. Código: `src/main/videoProxy.ts`, `components/video/proxies.ts`.
- [x] **Audio multipista** (ya existía): volumen, panorama y EQ por clip y por pista, compresor por pista, fundidos, solo y silencio. **Mejora:** medidores de nivel L/R por pista y general en el mezclador (estimados con la forma de onda, con retención de pico). Código: `src/shared/videoMeter.ts`, `MixerMeters.tsx`.
- [x] **Fotogramas clave para todo** (ya existía): transformación, opacidad, volumen, panorama, efectos y mezcla de color.
- [x] **Color nivel DaVinci** (ya existía en su mayoría): ruedas lift/gamma/gain, LUT `.cube`, grado A/B con mezcla y scopes. **Mejora:** curvas RGB (general, rojo, verde y azul) con 5 curvas listas; la vista previa y la exportación dan los mismos valores (probado con FFmpeg). IA: `video_color` (estilos, ruedas, balance y curvas). Código: `src/shared/videoColor.ts`, `CurvesBlock.tsx`. Falta: nodos.
- [x] **Zoom automático en grabaciones** (mejora, como Screen Studio): mientras se graba una pantalla se guarda el recorrido del cursor (`<grabación>.cursor.json`); donde el cursor se detiene, la imagen se acerca, lo sigue al siguiente punto y se aleja. Se aplica al terminar de grabar (opción del diálogo) o desde el inspector (acercamiento 1.1× a 3×, quitar). Se guarda como fotogramas clave de escala y posición, editables. IA: `video_auto_zoom`. Código: `src/shared/videoZoom.ts`, `autoZoom.ts`, `AutoZoomSection.tsx`.
- [x] **Animación de texto** (ya existía): animaciones de entrada/salida, paquete de animaciones y máquina de escribir.
- [ ] **4D. Avatares que hablan**: conectar un proveedor (HeyGen, D-ID o similar) como herramienta `generate_avatar`. Pendiente: necesita una cuenta con API key de pago para probarlo.

Arreglado en la mejora: el panel de Color y el mezclador se veían deformados por dos clases CSS repetidas (`.vs-color` de los selectores de color y `.vs-strip` de las miniaturas de la línea de tiempo).

Pendiente / ideas para mejorar la Fase 4:
- Zoom: usar los clics (Electron no los da fuera de la ventana; haría falta un módulo nativo) y resaltar el cursor. Hoy el zoom se basa en dónde se detiene el cursor, y solo en grabaciones de pantalla completa (no de ventanas).
- Medidores: son una estimación con la forma de onda (no incluyen EQ ni compresor).
- Rampas: editar la curva sobre la línea de tiempo; hoy cambian en pasos de ~¼ s (se nota poco).
- Grabación: Chromium solo manda un cuadro cuando algo cambia en la pantalla (si la pantalla está quieta, el archivo tiene pocos cuadros; se ve bien y exporta bien).
- Color: nodos de corrección.

---

## Fase 5: hardware y móviles (4–6 semanas)

**5A. Arduino / PlatformIO** ✅ (panel **Más → Hardware**; probado en la app real)
- [x] Detectar `platformio.ini` (en la carpeta y hasta 2 niveles abajo) y mostrar un panel: proyecto, entorno, placa, compilar, subir, limpiar y monitor serie.
- [x] `pio run`, `pio run -t upload`, `-t clean` con la salida en vivo; errores con archivo y línea (clic → abre el archivo en esa línea), uso de RAM y Flash, botón "✨ Arreglar con IA".
- [x] Puertos serie (`pio device list`), marcando cuáles parecen placas. Monitor serie propio (pyserial del Python de PlatformIO): velocidad, hora por línea, fin de línea, historial con ↑, y "abrir en la terminal" (`pio device monitor`). Al subir, el monitor suelta el puerto y vuelve a abrirlo.
- [x] Nuevo proyecto: buscar entre las placas que conoce PlatformIO, elegir framework y crear con un sketch de inicio.
- [x] Herramientas para la IA: `pio_info` (proyectos, puertos, placas), `pio_build` (con permiso), `pio_upload` (con permiso, riesgo alto) y `serial_monitor` (leer gratis; abrir y enviar con permiso).
- [x] `compile_commands.json` con un botón ("Autocompletado C++") para clangd. Falta instalar clangd en la PC (la app ya avisa cómo).

**Mejoras 5A** ✅ (probadas en la app real)
- [x] **Gráfica del monitor serie** (como el Serial Plotter de Arduino): botones Texto / Gráfica; lee "12 34", "12,34", "temp:23.5,hum:40", "temp=23.5"; leyenda con el último valor (y min/máx/promedio al pasar el mouse), ocultar series, últimas 100–2000 muestras, pausa, cursor con los valores de un punto, guardar como CSV en `serial/`.
- [x] **Librerías**: lib_deps del entorno, buscar en el registro de PlatformIO, instalar y quitar con `pio pkg` (guarda lib_deps en platformio.ini).
- [x] IA: `pio_library` (list y search libres; install y uninstall con permiso) y `serial_monitor` action `values` (resumen de los números que imprime la placa).

Pendiente / ideas 5A: probar subir a una placa de verdad (en esta PC no hay ninguna conectada; COM3 es de Intel AMT y el bluepill de prueba pide un ST-Link); depurar con `pio debug`; pruebas unitarias con `pio test` (necesitan g++ o una placa); ESP32 necesita internet la primera vez (instala paquetes de Python).

**5B. Apps de celular** ✅ parcial (panel **Más → Celular**; en esta PC no hay Android SDK)
- [x] Detectar Android SDK (ANDROID_HOME / lugar usual), `adb`, emulador, Flutter, scrcpy y Xcode (macOS); listar teléfonos (`adb devices -l`) y emuladores (`emulator -list-avds`); encender un emulador.
- [x] Detectar proyectos Flutter, Expo, React Native y Android (Gradle), y correrlos o compilarlos en la terminal integrada (`gradlew installDebug`, `flutter run -d`, `npx expo start`, `npx react-native run-android`).
- [x] Ver el teléfono con **scrcpy** (ventana aparte), y captura de pantalla dentro del panel (se puede guardar en `media/screenshots/`).
- [x] Logcat en vivo con filtros (nivel y texto), pausa y colores.
- [x] iPhone: en macOS `flutter run -d ios` / `npx expo run:ios`; en Windows, Expo EAS en la nube (el panel lo explica).
- [x] Herramientas para la IA: `mobile_info`, `mobile_logcat` (con filtro por app), `mobile_screenshot` (la IA ve la pantalla del celular; con permiso) y `mobile_emulator` (con permiso).

**Mejoras 5B** ✅ (la interfaz probada en la app real con un adb simulado; no hay teléfono en esta PC)
- [x] **Pantalla del celular dentro de Zinarix** (botón **Pantalla**): se actualiza sola (2–10 imágenes/s según el USB); clic = tocar, mantener = presión larga, arrastrar = deslizar, teclado = escribir (Enter, Borrar, flechas, Esc = atrás); botones Atrás, Inicio, Recientes, volumen y encendido; pausa y guardar captura en `media/screenshots/`. scrcpy queda como "Ventana" (más fluida).
- [x] **Apps del celular**: lista (propias o del sistema), buscar, abrir, cerrar a la fuerza, borrar datos y desinstalar (con confirmación); instalar los `.apk` que hay en el proyecto.
- [x] **Conectar por Wi-Fi**: `adb pair` con el código de 6 números (Android 11+) y `adb connect`.
- [x] IA: `mobile_input` (tocar, deslizar, escribir, teclas; devuelve una captura nueva para ver el resultado), `mobile_app` (list libre; abrir, cerrar, instalar con permiso; borrar datos y desinstalar con permiso cada vez) y `mobile_connect`.
- [x] Seguridad: `adb shell` junta las palabras en un solo comando del teléfono, así que el texto va entre comillas simples para el sh del teléfono y las coordenadas son números enteros; los paquetes y direcciones se validan.

Pendiente 5B: probar con un celular o emulador de verdad (falta instalar Android Studio o las Platform-Tools); el teclado de adb solo escribe ASCII (sin acentos ni emojis); la imagen en vivo es más lenta que scrcpy.

---

## Fase 6: videojuegos (6+ semanas, la más grande)

No vale la pena hacer un motor como Unity desde cero. Hay que **integrarse** con uno:

- [x] **Godot primero** (hecho 2026-11-20): panel **Más → Juegos**. Detecta `project.godot` (y Godot 4 instalado: PATH, winget, scoop, Steam, Descargas o el ejecutable que elija el usuario). Ejecutar el juego o una escena con la salida en vivo y errores clicables (`res://x.gd:12`), revisar scripts (`--check-only`), captura del juego (movie writer), exportar con los presets, abrir el editor. LSP de GDScript con un editor de Godot sin ventana (puente TCP) y resaltado de GDScript en Monaco. Depurador: tipo `godot` (DAP del editor sin ventana; F5 en un `.gd`).
- [x] Vista de escena `.tscn`: árbol de nodos, propiedades, scripts, señales; sigue al texto en vivo. (Los `.glb` ya los abre el estudio 3D.)
- [x] Juegos web: plantillas canvas 2D y three.js (incluido, sin internet) y vista previa en el navegador integrado con un servidor local (127.0.0.1 + clave en la ruta).
- [~] Unity y Unreal: se detectan y se abren en su editor (Unity Hub / `.uproject`). Falta compilar con su CLI.
- IA: `game_info`, `godot_scene` (sin permiso); `godot_run`, `godot_screenshot` (la IA ve el juego), `godot_check`, `godot_export`, `game_new`; `web_game_url` + `browser_open`.
- [x] Mejoras (2026-11-20): **editar la escena** desde la vista de árbol (propiedades con casilla / selector de color / texto, añadir y quitar propiedades, añadir hijo, renombrar con F2, subir/bajar, borrar con confirmación, script nuevo o existente; deshacer/rehacer y Ctrl+S sobre el mismo documento; se apila cuando el editor es angosto). Código en `shared/tscnEdit.ts` (toca solo las líneas necesarias, conserva CRLF). **Prueba automática** `godot_playtest`: la IA juega (acciones, teclas, clics, lecturas como `Player:position`, hasta 6 capturas) con un autoload temporal vía `override.cfg` que se restaura exacto (y se limpia si quedó de una ejecución interrumpida). IA: `godot_scene_edit` (operaciones set/add/remove/rename/move/connect/disconnect/script, todo o nada).
- [x] (2026-11-21) Plantilla **Web · Phaser 2D**: plataformas con física, monedas y marcador, con Phaser 4.2.1 (MIT) copiado en `lib/` para que funcione sin internet (`dist/vendor/phaser.min.js`). Probada en Chromium: el jugador camina, salta y junta una moneda sin errores (`test/phaserTemplate.test.ts`).
- [x] (2026-11-21) **Renombrar un nodo actualiza sus referencias**: los `NodePath("…")` de la escena y, en los scripts de los nodos de la escena, `$Nodo`, `$"…"`, `get_node("…")`, `get_node_or_null`, `has_node`, `^"…"` y `%Único`. Solo cambia el nombre dentro de la ruta (se respeta cómo estaba escrita) y no toca comentarios ni textos. En la vista de escena los scripts quedan como cambios sin guardar en sus pestañas (se pueden deshacer); `godot_scene_edit` los escribe y avisa cuáles cambió. Pruebas: `test/tscnRename.test.ts` y en la app.
- Pendiente: compilar Unity/Unreal; rutas armadas en tiempo de ejecución (textos unidos en el código) no se siguen al renombrar.

---

## Fase 7: modelado 3D avanzado (opcional)

La conexión con Blender ya cubre modelado, escultura y texturas: la IA controla Blender.
- [x] Herramientas de Blender para la IA (hecho 2026-11-21): `blender_model` aplica **operaciones** (sin escribir Python) a un `.blend` del proyecto: figuras, mover/girar/escalar, duplicar, **16 modificadores** (bisel, subdivisión, espejo, matriz, solidificar, booleano, diezmar, remallado…) con cada ajuste validado, aplicar modificadores, **materiales** (color, metal, rugosidad, transparencia, emisión, textura de imagen), **UV** (smart, cubo, cilindro, esfera, lightmap), sombreado suave, origen, unir, importar y **exportar** (GLB, glTF, FBX, OBJ, STL, PLY, USD). Un script fijo de Zinarix (`shared/blenderOps.ts`) las aplica en Blender sin ventana y con `--disable-autoexec`; si una falla no se guarda nada; devuelve un informe y una imagen (Workbench). `blender_inspect` lee un `.blend`/`.glb`/`.fbx`/`.obj`/`.stl`/`.ply` sin permiso. `blender_script` sigue para lo demás.
- [x] **CAD con OpenSCAD** (código → modelo): al abrir un `.scad`, la **vista 3D** sale junto al código (mismo texto: Ctrl+Z/Ctrl+S del editor); se actualiza sola al escribir (o con F6), **parámetros** del Customizer (`ancho = 60; // [20:1:200]`, listas, casillas, grupos) con deslizadores y "Guardar en el archivo", mensajes con su línea (clic → la línea, también en archivos incluidos) y "Arreglar con IA". Usa el OpenSCAD instalado (con Manifold) o el **incluido** (WebAssembly, en su propio proceso, como FFmpeg: programa aparte en `resources/openscad` con licencia GPL-2.0+, aviso y código fuente). Solo lee archivos dentro del proyecto. Panel **Más → CAD 3D** con 7 plantillas (caja con tapa, llavero con texto, soporte de celular, engranaje, maceta, placa con agujeros, en blanco). CadQuery no (necesita instalar Python y paquetes pesados).
- [x] **Impresión 3D**: exportar a STL, 3MF u OBJ; revisión para imprimir (hermético, bordes abiertos / no-manifold / caras volteadas, piezas, tamaño contra la cama, volumen y gramos de PLA, aviso de metros vs mm). **Visor de mallas** (`.stl`, `.3mf`, `.obj`, `.off`, `.ply`, `.glb`, `.gltf`, `.fbx`) con cama de impresión y caras al revés en rojo.
- IA: `cad_info`, `cad_render` (la IA **ve** el modelo: 4 vistas con un dibujante propio sin GPU), `mesh_check` y `blender_inspect` sin permiso; `cad_export`, `cad_new` y `blender_model` con permiso.
- [x] **Mejora (2026-11-21): rebanar e imprimir.**
  - **Rebanar a G-code** con PrusaSlicer / SuperSlicer instalado (Zinarix lo busca solo o se elige; es un programa aparte, no va incluido). Opciones sencillas: 6 impresoras de ejemplo (220×220, Prusa MK4, 256, Klipper 235, 300, Mini), material (PLA, PETG, ABS, ASA, TPU con sus temperaturas), altura de capa, relleno, paredes, soportes y borde (brim). Se escriben en un `.ini` temporal. También se puede usar **tu perfil de PrusaSlicer** (`.ini` exportado): entonces la cama y el G-code de inicio son los tuyos. Un `.scad` se rebana tal como está en el editor (con los parámetros sin guardar). Botones "Abrir en OrcaSlicer / Bambu Studio / Cura / PrusaSlicer" si están instalados.
  - **Visor de G-code** (`.gcode` se abre así; botón "Texto" para verlo como texto y "Ver capas" para volver): capas con deslizador, animación, "solo esta capa", movimientos en vacío, tiempo, filamento (m y g), temperaturas, tamaño de la pieza (sin la línea de purga) y aviso si se sale de la cama. Lee G0/G1, arcos G2/G3, modos relativos, G92, pulgadas y los comentarios de PrusaSlicer, Orca, Bambu y Cura.
  - **Impresoras en red** (panel CAD 3D → Impresoras): OctoPrint y Klipper (Moonraker: Mainsail / Fluidd). Probar conexión, estado en vivo (progreso, tiempo restante, temperaturas), enviar (y opcionalmente imprimir, con confirmación), pausar, reanudar y cancelar (con confirmación). La clave de API va al llavero del sistema, no al JSON.
  - **Visor 3D**: medir entre dos puntos (distancia y X/Y/Z) y corte por altura para ver adentro.
  - IA: `slice_model` (con permiso; devuelve tiempo, filamento y una **imagen de las trayectorias**), `gcode_info` (sin permiso) y `printer` (ver estado sin permiso; enviar, imprimir, pausar y cancelar piden permiso **cada vez**, y no imprime si la impresora está ocupada).
  - Arreglos: "Guardar en el archivo" de los parámetros ahora también guarda en disco; el estudio 3D no podía cargar modelos por `zmedia:` (la CSP bloqueaba `fetch`), ya se permite.
- Arreglos (2026-11-21): en una ventana angosta la barra de capas del G-code ya no tapa la vista (pasa abajo); las temperaturas que el G-code no trae ya no salen como "?".
- Pendiente: CadQuery, editar el `.blend` con una vista en vivo dentro de Zinarix, impresoras Bambu Lab (usan MQTT y su propia nube), subir `.3mf` con placa a la impresora.

---

## Orden recomendado y por qué

1. **Fase 0**: muchas cosas ya existen; primero hay que saber qué funciona de verdad.
2. **Fase 1 (imágenes)**: es lo más vacío y lo que más gente usa.
3. **Fase 2 (notebooks y Docker)**: rápido y muy útil para programadores.
4. **Fase 4 (video)**: ya hay una buena base; sube mucho de nivel con poco trabajo.
5. **Fase 5A (Arduino)**: fácil, porque PlatformIO hace casi todo.
6. **Fases 3, 5B, 6 y 7**: grandes; mejor hacerlas cuando todo lo demás esté estable.

## Reglas para todas las fases
- Cada función nueva tiene que tener **herramientas para la IA**, con permiso del usuario, igual que el resto de la app.
- Primero lo que funciona sin internet (local); la nube como opción.
- Textos en `i18n` (español e inglés) y pruebas en `apps/desktop/test/`.
- Lo que cuesta dinero (APIs de IA) muestra el costo antes de usarse.
