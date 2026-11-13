# Prompt: Panel de Edición visual (estilo PowerPoint) para Zinarix Studio — versión completa

> Copia este archivo completo como instrucción para la IA que va a programar la función.
> Es largo a propósito: describe **todo** lo que el panel debe poder hacer. Trabaja por fases
> (ver el final) y entrega cada fase funcionando antes de pasar a la siguiente.

---

## 1. Objetivo

Agrega a Zinarix Studio un **Panel de Edición visual** que permita editar el proyecto que esté abierto
(página web, app React/Vue/Svelte/HTML, landing, tienda, blog, etc.) **como si fuera una presentación de
PowerPoint**: hacer clic sobre lo que se ve, cambiarlo, moverlo, cambiar colores, textos, imágenes,
agregar secciones y publicar. Lo debe poder usar **una persona que no sabe programar**: nunca ve código
a menos que lo pida, y todo se hace con clics, arrastrar y soltar, menús y botones con iconos y nombres
claros en español.

**Reglas de oro**

1. **Todo lo que se pueda editar visualmente, se edita visualmente.**
2. Por detrás, el panel escribe los cambios en los **archivos reales** del proyecto (HTML, JSX/TSX, Vue,
   CSS, Tailwind, JSON/Markdown de contenido) y el código queda limpio, como si lo hubiera escrito un
   programador. El proyecto sigue funcionando igual **sin** el panel.
3. **Nada se pierde nunca**: guardado automático, Deshacer ilimitado e historial de versiones.
4. **Cero jerga técnica** en la interfaz normal. Las palabras "CSS", "div", "commit", "padding", "props",
   "componente" o "deploy" no aparecen salvo en modo Avanzado.
5. Si algo no se puede hacer de forma segura, se explica en lenguaje sencillo y se ofrece
   **"Pedir a la IA que lo haga"**.

---

## 2. Contexto del proyecto (léelo antes de empezar)

- Monorepo pnpm + Turborepo. La app de escritorio está en `apps/desktop` (Electron + React + TypeScript).
  Antes de tocar configuración de Turborepo lee `AGENTS.md`.
- Paneles laterales: `apps/desktop/src/renderer/App.tsx` (switch por `sidebar`) y el tipo `sidebar` en
  `apps/desktop/src/renderer/store.ts`. Agrega el valor `'design'` (Panel de Edición) con su icono en la
  barra de actividad (`components/Icon.tsx` / `components/icons.tsx`). Como el panel necesita mucho
  espacio, al abrirlo debe poder **ocupar el área del editor completa** (modo pantalla de edición), con
  un botón para volver al modo normal.
- Archivos del proyecto: usa la API existente `api.workspace.readFile / writeFile / listFiles /
  createFile / rename / trash` (en `src/preload/preload.ts`, implementada en `src/main/workspace.ts`).
  No crees otro canal de acceso a disco si este alcanza; si hace falta uno nuevo (p. ej. escribir
  binarios de imágenes), agrégalo en `workspace.ts` con las mismas protecciones.
- Arranque del proyecto: reutiliza la detección de `components/RunPanel.tsx` (`RunTask`, "Detectar y
  ejecutar") y la terminal (`main/terminal.ts`, `runInTerminal`).
- Navegador integrado: `src/main/browser.ts` (WebContentsView en sesión aislada) y
  `components/Browser.tsx`. La vista previa editable puede vivir ahí o en una vista propia con un script
  de edición inyectado (preload dedicado).
- IA: usa el modelo activo de Zinarix (`main/ai.ts`, `main/agent.ts`, `components/ModelPicker.tsx`).
- Git / versiones: `main/git.ts` (incluye `git:undoCommit`), `components/GitPanel.tsx`.
- Publicar: `main/vercel.ts` + `components/VercelPanel.tsx`; código QR con `renderer/qr.ts`.
- Datos: `main/supabase.ts` + `components/SupabasePanel.tsx` (para contenido dinámico y formularios).
- Seguridad: respeta `main/guard.ts` y `main/security.ts`. Confirmaciones con `renderer/confirm.ts` y
  `components/ConfirmDialog.tsx`.
- Textos de interfaz: todos en `src/renderer/i18n.ts` (español e inglés). Temas de Zinarix:
  `themes.ts`. Accesibilidad: `a11y.ts` (`pressable`, foco, lectores de pantalla). Atajos: `keys.ts`.
  Comandos: `commands.ts`.

---

## 3. Diseño de la pantalla (como PowerPoint)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ARCHIVO | Inicio | Insertar | Diseño | Transiciones/Animaciones | Páginas |    │
│         | Contenido | Revisar | Vista | Publicar          [? Ayuda] [Avanzado] │
│ ┌ grupos de botones grandes con icono + texto (como la cinta de Office) ─────┐ │
├──────────┬──────────────────────────────────────────────────┬──────────────────┤
│ PÁGINAS  │  [Escritorio][Tablet][Celular][Personalizado] 100%│ PROPIEDADES      │
│ ▢ Inicio │ ┌──────────────────────────────────────────────┐ │ (cambia según lo │
│ ▢ Precios│ │                                              │ │  seleccionado)   │
│ ▢ Blog   │ │   LIENZO = vista previa en vivo, editable    │ │  Pestañas:       │
│  ⌄ Posts │ │   con clic, doble clic y arrastrar           │ │  Estilo · Diseño │
│ + Nueva  │ │                                              │ │  · Animación ·   │
│──────────│ └──────────────────────────────────────────────┘ │  Enlace · Datos  │
│ CAPAS    │  Notas de la página (como las notas del orador)  │                  │
├──────────┴──────────────────────────────────────────────────┴──────────────────┤
│ ↶ Deshacer ↷ Rehacer · Guardado ✓ · 3 avisos · Página 2 de 6 · ━━●━━ Zoom 100% │
└────────────────────────────────────────────────────────────────────────────────┘
```

1. **Columna izquierda "Páginas"** (como las diapositivas): miniatura real de cada página/ruta
   (detectadas de `index.html`, `pages/`, `app/`, `src/routes`, React Router, Vue Router, etc.).
   - Clic para abrir; arrastrar para reordenar el menú del sitio; sangría para subpáginas.
   - Clic derecho: Duplicar, Renombrar, Cambiar dirección (URL), Ocultar del menú, Hacer página de
     inicio, Configuración (título, SEO), Eliminar (con confirmación y recuperable).
   - **+ Nueva página** con plantillas (En blanco, Inicio, Acerca de, Contacto, Precios, Galería, Blog,
     Artículo, Tienda, Producto, 404, Aviso de privacidad).
   - Debajo, el panel **Capas** (árbol de elementos de la página) con iconos, nombres amigables
     ("Título", "Botón Comprar", "Imagen del equipo"), ojo para ocultar, candado para bloquear,
     arrastrar para reordenar y doble clic para renombrar.
2. **Lienzo central**: la página real corriendo.
   - Al pasar el ratón: borde fino + etiqueta con el nombre del elemento.
   - Clic: selección con agarraderas (como un cuadro de texto de PowerPoint) y **mini barra flotante**
     junto al elemento con las acciones más usadas (negrita, color, enlace, IA, más…).
   - Doble clic: editar el texto o reemplazar la imagen.
   - Clic en el espacio vacío de una sección: selecciona la sección.
   - Reglas en los bordes (opcionales), cuadrícula y guías arrastrables desde las reglas.
   - Barra para "Agregar sección aquí" (**+**) que aparece entre secciones al pasar el ratón.
3. **Panel derecho "Propiedades"**, con pestañas: **Estilo**, **Diseño** (tamaño, posición, espacio),
   **Animación**, **Enlace/Acción**, **Datos** (si el elemento viene de una lista o base de datos),
   **Visibilidad** (en qué dispositivos se ve). Cada grupo plegable y con botón "Restablecer".
4. **Cinta superior** con pestañas y grupos (detalle en la sección 4).
5. **Notas de la página** (opcional, abajo del lienzo): notas internas que no se publican.
6. **Barra inferior**: Deshacer/Rehacer, estado de guardado, avisos (accesibilidad, enlaces rotos,
   SEO), número de página, zoom con deslizador, "Ajustar a la ventana".
7. Todo el diseño es redimensionable (columnas arrastrables) y recuerda su tamaño.

---

## 4. La cinta (pestaña por pestaña)

| Pestaña | Grupos y botones |
|---|---|
| **Archivo** | Guardar versión con nombre, Historial de versiones, Abrir otro proyecto, Nuevo sitio desde plantilla, Exportar (ZIP, PDF de las páginas, imágenes PNG), Configuración del sitio, Salir del modo edición |
| **Inicio** | Portapapeles (Cortar, Copiar, Pegar, Brocha copiar formato), Fuente (tipo, tamaño, B/I/U/S, color, resaltado, borrar formato), Párrafo (alineación, viñetas, numeración, interlineado, sangría), Estilos rápidos (Título 1/2/3, Texto, Cita, Destacado), Organizar (traer al frente, alinear, agrupar), Buscar y reemplazar, Seleccionar todo / Panel de selección |
| **Insertar** | Sección (biblioteca de bloques), Texto, Título, Botón, Imagen, Galería, Video, Audio, Icono, Forma (rectángulo, círculo, línea, flecha), Separador, Espacio, Tabla, Gráfica, Mapa, Formulario, Ventana emergente, Menú, Redes sociales, Código incrustado (solo Avanzado), Emoji, Fecha/año automático |
| **Diseño** | Temas del sitio, Colores, Fuentes, Estilo de botones, Esquinas/sombras globales, Fondo del sitio, Modo claro/oscuro, Ancho del contenido, Logo y favicon, Encabezado y pie globales ("patrón" como el Patrón de diapositivas) |
| **Animaciones** | Entrada, Énfasis, Al pasar el ratón, Al desplazarse (parallax, aparecer al bajar), Transición entre páginas, Duración, Retraso, Repetir, Panel de animaciones (orden y línea de tiempo), ▶ Vista previa |
| **Páginas** | Nueva página, Duplicar, Plantillas, Menú de navegación, Redirecciones, Página 404, Idiomas del sitio |
| **Contenido** | Listas/colecciones (productos, blog, equipo, testimonios), Formularios y respuestas, Archivos e imágenes del proyecto, Textos de todo el sitio en una tabla, Traducciones |
| **Revisar** | Ortografía, Accesibilidad, SEO, Enlaces rotos, Velocidad (imágenes pesadas), Comentarios, Comparar versiones |
| **Vista** | Escritorio/Tablet/Celular/Personalizado, Zoom, Reglas, Cuadrícula, Guías, Contornos de elementos, Ver como visitante, Modo presentación, Pantalla completa, Modo oscuro de la vista previa |
| **Publicar** | Ver como visitante, Vista previa compartible, Publicar, Dominio, Historial de publicaciones, Volver a una publicación anterior, Código QR |

La cinta se puede **contraer** (doble clic en una pestaña, como en Office) y tiene **"Dime qué deseas
hacer"** (búsqueda de cualquier comando por nombre, p. ej. "sombra", "cambiar logo").

---

## 5. Qué se debe poder editar (lo más posible)

### 5.1 Texto
- Doble clic sobre cualquier texto para escribir directo encima (edición en el lugar). Enter/Esc para
  terminar; pegar texto de Word/Google Docs limpiando formato basura.
- Negrita, cursiva, subrayado, tachado, superíndice/subíndice, tamaño, fuente (lista de Google Fonts con
  vista previa y búsqueda + subir fuente propia), color, resaltado, degradado en texto, sombra de texto.
- Alineación, interlineado, espaciado de letras, sangría, mayúsculas/minúsculas, listas con viñetas o
  números (con viñetas personalizadas), cita, columnas de texto.
- **Estilos de texto reutilizables** (Título 1, Título 2, Texto, Pequeño…) que al cambiarlos cambian en
  todo el sitio.
- Enlaces: pegar dirección, elegir otra página del proyecto, una sección de la misma página (ancla),
  correo, teléfono, WhatsApp, descargar archivo; abrir en pestaña nueva.
- Buscar y reemplazar en todo el sitio (con vista previa de cada coincidencia).
- Corrector ortográfico en español e inglés; contador de palabras.
- Textos dinámicos: año actual, nombre del sitio, datos de contacto globales (se cambian en un solo lugar).

### 5.2 Imágenes y medios
- Reemplazar imagen: subir desde la computadora, arrastrar archivo, pegar del portapapeles, elegir de la
  **Galería del proyecto**, o banco de imágenes libres (Unsplash/Pexels, si hay internet), o **generar
  con IA**. Se copian a la carpeta de recursos del proyecto (`public/`, `assets/`, `static/`…).
- Optimización automática al subir: redimensionar, convertir a WebP/AVIF, generar tamaños para celular
  (`srcset`), carga diferida. Avisar si una imagen pesa demasiado.
- Recortar (libre, 1:1, 4:3, 16:9, círculo), punto de enfoque, girar, voltear, redondear esquinas,
  borde, sombra, opacidad, filtros (brillo, contraste, saturación, blanco y negro, sepia, desenfoque),
  ajuste (rellenar / ajustar / estirar), máscara con forma, texto alternativo (con sugerencia de IA).
- Quitar fondo de una imagen (con IA, si está disponible).
- Video: archivo propio, YouTube, Vimeo; reproducción automática, silencio, repetir, portada, controles.
  Video de fondo para secciones.
- Audio, PDF incrustado, iconos (biblioteca buscable con color y tamaño), emojis, SVG (cambiar color).
- Galerías: cuadrícula, carrusel, mosaico; reordenar arrastrando; vista ampliada al hacer clic.

### 5.3 Formas, posición y diseño
- Mover arrastrando, cambiar tamaño con agarraderas (Shift = mantener proporción, Alt = desde el
  centro), girar con la agarradera circular.
- **Guías inteligentes** como PowerPoint (líneas rosas al alinear con otros elementos y mostrar
  distancias iguales), ajuste a cuadrícula, ajuste a guías.
- Alinear (izquierda, centro, derecha, arriba, medio, abajo) y distribuir horizontal/vertical.
- Traer al frente / enviar atrás, agrupar / desagrupar, bloquear, ocultar.
- **El panel decide cómo traducir el movimiento a código responsive**: dentro de una columna o fila
  (flex/grid) mover = reordenar; en un lienzo libre = posición. Nunca generar posiciones absolutas que
  se rompan en celular sin avisar.
- Espacio por fuera y por dentro (márgenes y relleno) arrastrando los bordes en el lienzo, con valores
  numéricos opcionales y botón para enlazar los 4 lados.
- Tamaño: automático, porcentaje, fijo, mínimo/máximo; "ocupar todo el ancho".
- Fondo de cualquier sección o elemento: color, degradado (editor visual con paradas), imagen, video,
  patrón, superposición de color con transparencia, efecto vidrio (desenfoque).
- Bordes (grosor, estilo, color, por lado), esquinas redondeadas (por esquina), sombras (preajustes +
  personalizada), transparencia, modo de mezcla.
- **Columnas y filas**: dividir una sección en 1–6 columnas con un clic, cambiar proporciones
  arrastrando el divisor (50/50, 33/66…), espacio entre columnas, apilar en celular sí/no, invertir
  orden en celular.
- Alinear contenido dentro de un contenedor (arriba/centro/abajo, izquierda/centro/derecha, repartir).
- **Selector de color completo**: paleta del tema, colores recientes, cuentagotas para tomar un color de
  la pantalla, hex/RGB, transparencia, aviso de contraste insuficiente.

### 5.4 Diseño por dispositivo (responsive)
- Vista Escritorio / Tablet / Celular / tamaño personalizado (arrastrando el borde del lienzo).
- Cada cambio se puede aplicar **a todos los dispositivos** o **solo a este dispositivo** (selector
  visible y claro, con icono del dispositivo). Los cambios solo-celular se marcan con un punto.
- Mostrar/ocultar elementos por dispositivo; tamaño de letra por dispositivo; menú hamburguesa
  automático en celular.
- Vista lado a lado de los 3 dispositivos a la vez (opcional).

### 5.5 Estados e interacciones
- Estados: normal, al pasar el ratón, al presionar, enfocado, desactivado (para botones, enlaces,
  campos). Se editan eligiendo el estado en Propiedades y cambiando el estilo.
- Acciones al hacer clic: ir a página, ir a sección (desplazamiento suave), abrir enlace, abrir ventana
  emergente, cerrar ventana emergente, mostrar/ocultar elemento, descargar archivo, llamar, enviar
  WhatsApp, copiar texto, cambiar idioma, cambiar modo claro/oscuro.
- **Ventanas emergentes (pop-ups)**: crear, diseñar igual que una página, y elegir cuándo aparecen
  (al hacer clic, al cargar, después de X segundos, al intentar salir, al bajar X%).
- Menús desplegables, pestañas, acordeones (preguntas frecuentes), carruseles, contadores, barras de
  progreso, cuenta regresiva: insertables y editables sin código.

### 5.6 Secciones y bloques (Insertar)
- Biblioteca de bloques con miniaturas, por categorías y con buscador: Encabezado/menú, Portada (hero)
  en varias variantes, Texto e imagen, Características, Tarjetas, Galería, Logos de clientes,
  Testimonios, Equipo, Precios, Comparativa, Preguntas frecuentes, Estadísticas/números, Línea de
  tiempo, Llamado a la acción, Boletín (suscripción), Contacto, Mapa, Blog/últimas entradas, Productos,
  Pie de página, Botón, Separador, Espacio.
- Cada bloque se genera respetando la tecnología y el estilo del proyecto (HTML puro, React, Vue,
  Tailwind, CSS Modules, styled-components…) y **adopta automáticamente los colores y fuentes del tema**.
- Arrastrar del panel al lienzo con indicador de dónde caerá (línea azul).
- Clic derecho en un bloque: Duplicar, Copiar, Pegar, Copiar estilo / Pegar estilo (brocha), Mover
  arriba/abajo, Guardar como bloque propio, Convertir en **bloque reutilizable** (si se edita en un
  lugar, se actualiza en todas las páginas donde se usa, como un componente maestro), Desvincular,
  Ocultar, Eliminar.
- **Mis bloques**: bloques guardados por el usuario, reutilizables en otros proyectos.

### 5.7 Diseño global (pestaña Diseño)
- **Temas**: paletas listas (10+) y personalizada: primario, secundario, acento, fondo, superficie,
  texto, bordes, éxito/aviso/error. Botón "Generar paleta desde mi logo" (extraer colores).
- Fuentes de títulos y de texto (pares recomendados), escala de tamaños.
- Estilo de botones (relleno, contorno, texto; redondeo; sombra), campos de formulario, tarjetas.
- Modo claro/oscuro, con opción de seguir el sistema del visitante.
- Ancho máximo del contenido, espaciado general (compacto/normal/amplio).
- **Patrón del sitio** (como el Patrón de diapositivas): encabezado, menú y pie de página comunes; al
  editarlos se cambian en todas las páginas.
- Logo, favicon, nombre del sitio, datos de contacto y redes sociales globales.
- Todos estos valores se escriben como **variables CSS / `tailwind.config` / archivo de tema** del
  proyecto, no repartidos elemento por elemento.

### 5.8 Animaciones (pestaña Animaciones)
- Entrada al aparecer en pantalla: aparecer, deslizar (4 direcciones), zoom, rebote, girar, escribir
  letra por letra; duración, retraso, suavizado, repetir.
- Énfasis (pulso, sacudir, brillo) y efecto al pasar el ratón (crecer, levantar, cambio de color,
  sombra).
- Al desplazarse: parallax, revelar, barra de progreso de lectura, encabezado que se encoge.
- Transiciones entre páginas.
- **Panel de animaciones** con la lista en orden (como PowerPoint) y línea de tiempo simple; ▶
  Reproducir para ver la vista previa.
- Respetar "reducir movimiento" del visitante (`prefers-reduced-motion`).

### 5.9 Contenido y datos
- Textos que vienen de archivos JSON, Markdown, YAML o de traducción (i18n): se editan igual con doble
  clic y se guardan en su archivo de origen.
- **Colecciones** (productos, entradas de blog, equipo, testimonios, preguntas): se ven como una tabla
  sencilla tipo Excel; agregar, duplicar, ordenar y quitar filas; campos de imagen, fecha, precio,
  etiqueta, texto largo. Editar una tarjeta en el lienzo cambia su fila.
- Blog: editor de artículos tipo documento (títulos, imágenes, citas), borrador/publicado, fecha,
  autor, categoría, imagen destacada.
- Tablas: insertar, agregar filas/columnas, combinar celdas, estilo de tabla, pegar desde Excel.
- Gráficas simples (barras, líneas, pastel) con datos editables en una mini hoja.
- **Formularios**: agregar/quitar/reordenar campos (texto, correo, teléfono, número, lista,
  casillas, opción, fecha, archivo), marcar obligatorio, mensaje de gracias, a dónde llega el mensaje
  (correo, Supabase, WhatsApp, Google Sheets), protección contra spam. Ver respuestas recibidas.
- Si el proyecto usa Supabase (`main/supabase.ts`), permitir conectar una lista del lienzo a una tabla
  y editar filas, sin escribir SQL.

### 5.10 Varios idiomas
- Agregar idiomas al sitio; selector de idioma insertable.
- Vista "Traducciones": tabla con el texto original y cada idioma lado a lado; botón "Traducir con IA".
- Al editar en el lienzo, se edita el idioma que esté activo.

### 5.11 SEO y compartir
- Por página: título de la pestaña, descripción para Google, dirección (URL), imagen para redes, no
  indexar. Vista previa de cómo se ve en Google, WhatsApp, Facebook y X.
- Generar `sitemap.xml`, `robots.txt`, datos estructurados básicos (negocio local, artículo, producto).
- Integraciones sin código: Google Analytics, Meta Pixel, Google Search Console (pegando solo el ID).

---

## 6. Ayuda con IA (sin escribir código)

- Caja **"Dime qué quieres cambiar"** siempre visible (y Ctrl+K): "haz el botón más grande y verde",
  "agrega una sección de precios con 3 planes", "tradúcelo al inglés", "que se vea más elegante".
  Usa el modelo activo de Zinarix con el elemento seleccionado (o la página) como contexto, y muestra el
  cambio en el lienzo **antes** de aceptarlo (**Aceptar / Descartar / Intentar otra vez**), con resumen
  en lenguaje sencillo de lo que cambió.
- Sobre lo seleccionado: "Mejorar este texto", "Hacerlo más corto/largo", "Cambiar tono" (formal,
  amigable, vendedor), "Corregir ortografía", "Traducir", "Sugerir imagen", "Generar imagen", "Escribir
  texto alternativo", "Proponer 3 variantes de diseño".
- **Crear página o sitio completo con IA**: describir el negocio y elegir estilo → genera páginas,
  textos e imágenes de muestra, editables después.
- **Revisor con IA**: "¿Qué puedo mejorar?" → lista de sugerencias (contraste, textos confusos,
  botones poco visibles, SEO) con botón "Aplicar".
- Todo cambio de la IA entra al Deshacer y al historial como un solo paso con nombre ("IA: sección de
  precios").

---

## 7. Menú contextual (clic derecho) por tipo de elemento

- **Texto**: Cortar, Copiar, Pegar, Pegar sin formato, Editar texto, Copiar/Pegar estilo, Enlace, IA,
  Duplicar, Ocultar, Eliminar, Ver código (Avanzado).
- **Imagen**: Cambiar imagen, Recortar, Filtros, Quitar fondo, Texto alternativo, Restablecer tamaño,
  Usar como fondo de la sección, Descargar, Eliminar.
- **Sección**: Agregar sección arriba/abajo, Duplicar, Mover arriba/abajo, Fondo, Guardar como bloque,
  Hacer reutilizable, Ocultar en celular, Eliminar.
- **Varios seleccionados**: Alinear, Distribuir, Agrupar, Igualar tamaño, Eliminar.
- **Lienzo vacío**: Pegar, Agregar sección, Seleccionar todo, Propiedades de la página.

---

## 8. Guardado, seguridad y deshacer

- Guardado automático (indicador "Guardado ✓ / Guardando… / Sin conexión con el proyecto"), y Ctrl+S.
- Deshacer/Rehacer ilimitado en la sesión (Ctrl+Z / Ctrl+Y), incluyendo cambios de la IA, inserción
  de imágenes y cambios de tema. Lista desplegable del historial de Deshacer ("Cambió color del
  botón", "Escribió en el título"…) para volver varios pasos.
- **Historial de versiones** con nombre y fecha ("Versión de las 3:40 pm", "Antes de cambiar colores")
  usando git por detrás (`main/git.ts`). Guardar versión automática cada X minutos y antes de cada
  cambio grande de IA. Botones "Ver esta versión", "Comparar con la actual" (lado a lado, resaltando lo
  distinto en la vista previa, no en código) y "Volver a esta versión". La persona nunca ve "commit".
  Si el proyecto no tiene git, inicializarlo de forma transparente (preguntando una vez).
- Papelera: páginas, bloques e imágenes eliminados se pueden recuperar.
- Nunca borrar archivos sin confirmar. Nunca escribir fuera de la carpeta del proyecto.
- Si una edición no se puede mapear de forma segura al código, avisar en lenguaje sencillo y ofrecer
  "Pedir a la IA que lo haga".
- Si alguien edita el mismo archivo en el editor de código o lo cambia el agente mientras el panel está
  abierto, recargar y avisar; si hay conflicto, preguntar qué conservar con vista previa de ambos.
- **No romper el proyecto**: tras cada guardado comprobar que la vista previa carga y que el archivo
  sigue siendo válido (parseo); si falla, revertir automáticamente ese paso y mostrar "Algo salió mal,
  regresé al estado anterior" con opción "Pedir a la IA que lo arregle".

---

## 9. Revisar (calidad del sitio)

- **Accesibilidad**: contraste de colores, imágenes sin texto alternativo, orden de títulos, botones sin
  nombre, tamaño de toque en celular. Cada aviso con "Ir al elemento" y "Arreglar" automático.
- **Enlaces rotos** y páginas sin enlazar.
- **SEO**: páginas sin título/descripción, títulos duplicados, imágenes pesadas.
- **Velocidad**: imágenes sin optimizar, fuentes de más, videos pesados; botón "Optimizar todo".
- **Ortografía** en todo el sitio.
- **Comentarios**: dejar notas sobre un elemento (con chincheta en el lienzo), responder y marcar
  resueltas; se guardan en un archivo del proyecto que no se publica (p. ej. `.zinarix/comments.json`).

---

## 10. Vista y modo presentación

- **Ver como visitante**: sin herramientas de edición, con todos los enlaces y animaciones funcionando.
- **Modo presentación** (F5, como PowerPoint): recorre las páginas en pantalla completa, flechas para
  avanzar; útil para mostrar el sitio a un cliente. Shift+F5 empieza en la página actual.
- **Vista previa compartible**: enlace temporal (usando el túnel existente `main/tunnel.ts`) y código
  QR para abrirla en el celular real; los cambios se ven en vivo.
- Contornos de todos los elementos, reglas, cuadrícula, guías, zoom (25%–400%), pantalla completa.

---

## 11. Publicar

- Asistente de 3 pasos: revisar avisos → elegir dónde (Vercel, usando `main/vercel.ts` /
  `VercelPanel.tsx`; o exportar ZIP para subir a otro hosting) → publicar.
- Si el proyecto usa git, guardar versión y subir automáticamente.
- Mostrar progreso en lenguaje sencillo ("Preparando tu sitio… 60%"), el enlace final y un código QR
  (`qr.ts`). Si falla, explicar el error en palabras simples (leyendo el log de Vercel) y ofrecer "Pedir
  a la IA que lo arregle".
- Conectar dominio propio con instrucciones paso a paso.
- Historial de publicaciones con "Volver a esta publicación" (rollback de Vercel).

---

## 12. Experiencia para quien no sabe programar

- Lenguaje sencillo siempre: "Color de fondo", no "background-color"; "Espacio por dentro", no
  "padding"; "Parte reutilizable", no "componente"; "Publicar", no "deploy".
- Tooltips con explicación corta y un pequeño dibujo/animación en cada botón; atajo de teclado visible.
- **Recorrido de bienvenida** la primera vez (seleccionar, editar texto, cambiar imagen, agregar
  bloque, deshacer, publicar), que se puede repetir desde Ayuda.
- **Centro de ayuda** integrado con guías cortas ("¿Cómo cambio el logo?") y botón "Pregúntale a la IA".
- Estados vacíos amigables ("Esta página está vacía. Agrega tu primera sección").
- Mensajes de error sin jerga, siempre con una acción para resolverlo.
- Atajos iguales a Office (ver sección 13) y lista de atajos con Ctrl+/.
- Modo **"Avanzado"** opcional (apagado por defecto): muestra valores CSS exactos, clases de Tailwind,
  nombre del componente y botón "Ver código de este elemento" que abre el archivo en el editor de
  Zinarix en la línea exacta. También "Insertar código" y "Editar atributos".
- Funciona completo con teclado y lector de pantalla (`a11y.ts`): Tab recorre elementos del lienzo,
  Enter edita, flechas mueven, anuncios de lo seleccionado.
- Rendimiento: seleccionar < 50 ms, ver un cambio de estilo < 200 ms, guardar sin bloquear la interfaz.
- Respeta el tema claro/oscuro de Zinarix e idioma español/inglés.

---

## 13. Atajos de teclado

| Atajo | Acción |
|---|---|
| Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) | Deshacer / Rehacer |
| Ctrl+C / Ctrl+X / Ctrl+V | Copiar / Cortar / Pegar |
| Ctrl+Shift+V | Pegar sin formato |
| Ctrl+Shift+C / Ctrl+Shift+V (sobre elemento) | Copiar estilo / Pegar estilo |
| Ctrl+D | Duplicar |
| Supr / Retroceso | Eliminar |
| Flechas / Shift+Flechas | Mover 1 px / 10 px |
| Ctrl+G / Ctrl+Shift+G | Agrupar / Desagrupar |
| Ctrl+B / I / U | Negrita / Cursiva / Subrayado |
| Ctrl+K | Insertar enlace (dentro de texto) / "Dime qué quieres cambiar" (fuera) |
| Ctrl+F / Ctrl+H | Buscar / Buscar y reemplazar |
| Ctrl+S | Guardar versión |
| Ctrl+A | Seleccionar todo en la sección |
| Esc | Salir de edición / seleccionar el contenedor padre |
| Ctrl+clic / Shift+clic | Selección múltiple |
| Ctrl + rueda / Ctrl+0 | Zoom / Ajustar a la ventana |
| F5 / Shift+F5 | Modo presentación desde el inicio / desde la página actual |
| Ctrl+/ | Lista de atajos |

Regístralos en `keys.ts` / `commands.ts` y que solo apliquen cuando el panel tiene el foco.

---

## 14. Cómo funciona por dentro (guía técnica)

1. **Detectar el tipo de proyecto** (HTML estático, Vite/React, Next.js, Remix, Vue/Nuxt, Svelte/
   SvelteKit, Astro, Angular; Tailwind, CSS Modules, Sass, styled-components; i18n) leyendo
   `package.json` y archivos de configuración, igual que `RunPanel`. Guardar el resultado en un
   "perfil del proyecto" para que cada edición sepa cómo escribir código.
2. **Arrancar la vista previa**: servidor de desarrollo del proyecto (o servidor estático para HTML),
   mostrarlo en el lienzo y reiniciarlo solo si se cae.
3. **Mapear lo visual al código**: en la vista previa, agregar atributos de origen a los elementos
   (plugin de Vite/Babel/SWC que añada `data-zx-src="archivo:línea:columna"`; para Vue/Svelte su
   compilador; para HTML puro, parsear y numerar nodos). Así cada clic sabe qué archivo y qué nodo
   cambiar. Esos atributos **solo existen en la vista previa**; nunca se escriben en el código final.
   Si un elemento se genera en un bucle (`.map`), detectarlo y editar el dato de origen (colección) o
   la plantilla, preguntando "¿Cambiar solo esta tarjeta o todas?".
4. **Script de edición inyectado** (preload aislado) en la vista previa: resalta, selecciona, dibuja
   agarraderas y guías, edición de texto en el lugar, arrastrar y soltar, y se comunica con el panel
   por IPC. Define un **contrato de mensajes tipado** (TypeScript) p. ej.:
   `select{src, rect, computedStyle}`, `hover{src}`, `textChanged{src, text}`,
   `move{src, targetSrc, position}`, `resize{src, w, h}`, `contextMenu{src, x, y}`; y del panel a la
   vista: `applyPreview{ops}`, `highlight{src}`, `setDevice{w}`, `setMode{edit|visitor}`.
5. **Operaciones de edición como datos**: cada cambio es una operación serializable
   (`setText`, `setStyle`, `setAttr`, `insertBlock`, `moveNode`, `removeNode`, `setTheme`,
   `addAsset`…) con su inversa. Esto alimenta Deshacer/Rehacer, la vista previa inmediata (aplicar al
   DOM antes de escribir en disco) y el historial.
6. **Aplicar cambios con AST**, no con reemplazos de texto a ciegas: Babel/TypeScript (o `recast` para
   conservar formato) para JSX/TSX, parse5 para HTML, compilador de Vue/Svelte para sus plantillas,
   PostCSS para CSS. Modificar el nodo y reimprimir conservando el formato del resto del archivo; luego
   pasar Prettier solo si el proyecto lo usa. Estrategia de estilos:
   - Tailwind → cambiar clases (respetando prefijos responsive `md:` y de estado `hover:`).
   - CSS/Sass/Modules → editar la regla existente o crear una clase nueva con nombre legible.
   - Valores del tema → variables CSS / `tailwind.config`.
   - `style=""` en línea solo como último recurso, y avisarlo en modo Avanzado.
7. **Recarga en caliente** (HMR) tras guardar; mientras tanto, la vista previa ya muestra el cambio
   aplicado al DOM para que se sienta instantáneo.
8. Imágenes: procesar en el proceso principal (p. ej. `sharp` si se puede empaquetar) y guardar en la
   carpeta de recursos con nombres limpios.
9. Toda escritura pasa por `api.workspace` dentro del proyecto abierto; nada fuera de la carpeta del
   proyecto. Respeta `main/guard.ts` y `main/security.ts`. El script inyectado no debe tener acceso a
   Node ni a las APIs de Zinarix más allá del canal de mensajes.
10. Datos del panel que no son del sitio (comentarios, notas, bloques propios, preferencias) en
    `.zinarix/` dentro del proyecto (agregado a `.gitignore` si el usuario lo prefiere) o en los ajustes
    de Zinarix.

### Estructura de archivos sugerida

```
apps/desktop/src/
  main/design/
    projectProfile.ts     detectar framework y estilos
    previewServer.ts      arrancar/vigilar la vista previa
    sourceMap.ts          plugin/inyección de data-zx-src
    ops.ts                tipos de operaciones + inversas
    apply/jsx.ts html.ts vue.ts css.ts tailwind.ts theme.ts
    assets.ts             subir/optimizar imágenes
    versions.ts           historial sobre git
  preload/designPreview.ts  script inyectado en la vista previa
  renderer/components/DesignPanel.tsx
  renderer/components/design/
    Ribbon.tsx PagesPanel.tsx LayersPanel.tsx Canvas.tsx Properties.tsx
    ColorPicker.tsx FontPicker.tsx BlockLibrary.tsx ThemeEditor.tsx
    AnimationPane.tsx CollectionsTable.tsx FormBuilder.tsx Versions.tsx
    ReviewPanel.tsx PublishWizard.tsx Tour.tsx AiBox.tsx ContextMenu.tsx
  renderer/design/blocks/   plantillas de bloques por tecnología
```

---

## 15. Entregables y criterios de aceptación

- Panel `components/DesignPanel.tsx` (y subcomponentes en `components/design/`), valor `'design'` en el
  `sidebar` del store, icono en la barra de actividad y comandos en `commands.ts` ("Abrir Panel de
  Edición", "Modo presentación", "Ver como visitante").
- Lógica de mapeo y escritura separada de la interfaz y **con pruebas en Vitest** (`tests/`) sobre
  proyectos de ejemplo **HTML puro, React+CSS, React+Tailwind y Vue**: editar texto, cambiar color,
  cambiar tema global, mover bloque, insertar bloque, reemplazar imagen, editar elemento de lista,
  cambio solo-celular, deshacer/rehacer, y que el código resultante pase el parseo y no contenga
  `data-zx-src`.
- Todos los textos nuevos en `i18n.ts` en español e inglés.
- `pnpm typecheck`, `pnpm lint` y `pnpm test` pasan.
- **Prueba manual con una persona que no programa** (o simulándola): sin ayuda, debe poder cambiar el
  título, el color de un botón, reemplazar una imagen, agregar una sección de precios, verlo en
  celular, deshacer, volver a una versión anterior y publicar. Verificar que el código resultante es
  limpio y que el proyecto corre sin el panel.

---

## 16. Orden de trabajo (fases)

1. **Base**: panel a pantalla completa + vista previa del proyecto + selección con clic + Capas.
2. **Texto y estilo**: edición en el lugar, Propiedades básicas (texto, color, tamaño, fondo, espacio),
   guardado automático y Deshacer/Rehacer.
3. **Imágenes y diseño**: reemplazar/recortar imágenes, mover/redimensionar, guías, alinear, columnas,
   bordes y sombras, menú contextual.
4. **Responsive y estados**: dispositivos, cambios por dispositivo, hover, acciones al hacer clic.
5. **Bloques y Páginas**: biblioteca de bloques, mis bloques, bloques reutilizables, páginas y menú.
6. **Diseño global**: temas, fuentes, patrón del sitio (encabezado/pie), logo, SEO.
7. **Contenido**: colecciones, formularios, tablas, idiomas, Supabase.
8. **Animaciones** y ventanas emergentes.
9. **IA**: "Dime qué quieres cambiar", acciones sobre la selección, crear página/sitio, revisor.
10. **Seguridad y versiones**: historial con comparar, papelera, recuperación automática, conflictos.
11. **Revisar, Vista y Publicar**: accesibilidad, enlaces, velocidad, comentarios, modo presentación,
    vista compartible, asistente de publicación.
12. **Pulido**: recorrido de bienvenida, centro de ayuda, modo Avanzado, atajos, accesibilidad,
    rendimiento.

Entrega cada fase funcionando y probada antes de pasar a la siguiente. Si algo de la lista no es
posible para cierta tecnología de proyecto, implementa lo que sí se pueda y muestra el resto como
"No disponible para este tipo de proyecto" con la opción de pedírselo a la IA.
