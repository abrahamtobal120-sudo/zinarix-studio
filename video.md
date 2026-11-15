# Prompt: Zinarix Video Studio — editor de video profesional integrado

> Copia todo lo que está debajo de la línea y pégalo en el chat del agente.

---

Quiero que agregues a **Zinarix Studio** un **editor de video profesional completo** llamado **Zinarix Video Studio**. Debe estar al nivel de los mejores editores de escritorio (Movavi, CapCut, DaVinci Resolve, Premiere) en funciones, pero con **diseño propio de Zinarix**: mismo tema, colores, iconos (`Icon.tsx` / `icons.tsx`), tipografía y traducciones (`i18n.ts`) que el resto de la app. No copies la apariencia, logos ni nombres de otros programas.

## 1. Dónde y cómo se muestra

- Es una **capa de pantalla completa por ENCIMA de la app y de los chats** (overlay con `z-index` superior a todo, incluidos `Modals`). El chat y el editor de código siguen vivos debajo: no se desmontan ni pierden estado.
- Animación de entrada/salida suave (fade + scale, 180 ms). Respeta `prefers-reduced-motion`.
- Barra superior propia con: logo, nombre del proyecto (editable), deshacer/rehacer, indicador de guardado, botón **"Volver al chat"**, botón **Exportar** destacado y botón para **minimizar** a una píldora flotante ("🎬 Renderizando 42 %") que deja usar la app mientras exporta.
- Formas de abrirlo:
  - Botón **🎬 Video** en la barra lateral (`Chrome.tsx`) y en la barra del chat (`Chat.tsx`).
  - Comando en la paleta (`commands.ts`): "Video Studio: Abrir", "Nuevo proyecto de video", "Abrir proyecto de video…".
  - Atajo **Ctrl+Shift+V** (registrar en `keys.ts`, sin chocar con atajos existentes).
  - Doble clic en un `.mp4/.mov/.mkv/.webm/.avi/.mp3/.wav/.zvproj` en el `Explorer.tsx` → abre el editor con ese archivo.
  - Arrastrar archivos de video sobre la ventana (reutiliza `drop-overlay` de `App.tsx`).
- **Esc** cierra paneles flotantes; Esc con nada abierto pregunta "¿Volver al chat?" si hay cambios sin guardar.
- Diseño responsivo: desde 1280×720 hasta 4K; los paneles se pueden redimensionar, acoplar, ocultar y se recuerda la distribución.

## 2. Distribución de la pantalla

```
┌───────────────────────────── Barra superior ─────────────────────────────┐
│ Medios │ Audio │ Texto │ Stickers │ Efectos │ Transiciones │ Filtros │ IA │
├──────────────────┬───────────────────────────────┬───────────────────────┤
│  Biblioteca /    │                               │  Inspector del        │
│  panel de la     │        VISOR (preview)        │  elemento elegido     │
│  pestaña activa  │   ▶ ⏮ ⏭  00:01:23:12 / 05:00  │  (Video, Audio,       │
│                  │   16:9 ▾  Calidad ▾  ⛶         │   Color, Velocidad,   │
│                  │                               │   Animación, IA)      │
├──────────────────┴───────────────────────────────┴───────────────────────┤
│ Herramientas: ✂ dividir  🗑  ↶ ↷  🧲 imán  🔗 enlazar  ⚑ marcador  zoom ─○─ │
│ ── V3 ▓▓▓▓░░░░    texto / stickers                                        │
│ ── V2 ░░▓▓▓▓▓░    picture-in-picture                                      │
│ ── V1 ▓▓▓▓▓▓▓▓▓▓  pista principal (con miniaturas)                         │
│ ── A1 ∿∿∿∿∿∿∿∿∿∿  audio del video (forma de onda)                          │
│ ── A2 ∿∿∿∿∿       música                                                   │
│ ── A3 ∿∿          voz en off                                               │
└──────────────────────────────────────────────────────────────────────────┘
```

## 3. Funciones (todas obligatorias)

### 3.1 Proyecto y medios
- Proyecto nuevo con plantillas de formato: 16:9 (YouTube), 9:16 (TikTok/Reels/Shorts), 1:1, 4:5, 21:9 y personalizado; 24/25/30/50/60 fps; 720p, 1080p, 1440p, 4K.
- Importar video, audio, imágenes (PNG, JPG, WebP, GIF, SVG) y secuencias de imágenes. Carpetas, búsqueda, filtros por tipo, vista de cuadrícula/lista, miniaturas animadas al pasar el ratón.
- **Proxies automáticos** (versión ligera a 540p) para editar 4K sin lag; se usa el original al exportar.
- Detección de medios faltantes con botón "Volver a vincular".
- Grabar **pantalla**, **cámara** y **micrófono** directamente al proyecto (`desktopCapturer` + `MediaRecorder`).
- Guardado automático cada 30 s y recuperación tras cierre inesperado. Formato `.zvproj` (JSON con rutas relativas) + historial de versiones.

### 3.2 Línea de tiempo
- Pistas ilimitadas de video, audio, texto y efectos; renombrar, bloquear, silenciar, ocultar, solo, cambiar altura y color.
- Arrastrar y soltar, recortar bordes, **dividir (S)**, eliminar con cierre de huecos (ripple delete), **roll, slip y slide**, mover entre pistas.
- **Imán** (snap) a cabezal, clips y marcadores; zoom con Ctrl+rueda; navegación con mini-mapa.
- Selección múltiple, agrupar/desagrupar, copiar/pegar, duplicar, **copiar y pegar atributos** (efectos, color, animación).
- Marcadores con nombre y color, regiones de entrada/salida (I/O), **capítulos** que se exportan a YouTube.
- **Clips compuestos** (anidar), **multicámara** sincronizada por audio, **edición por ritmo** (detectar beats de la música y cortar en ellos).
- Deshacer/rehacer ilimitado con panel de historial.

### 3.3 Visor
- Reproducción fluida en tiempo real con caché de render; calidad completa / ½ / ¼.
- Manipular el clip directamente en el visor: mover, escalar, rotar, recortar con asas.
- Guías de zona segura, cuadrícula de tercios, regla, overlay de UI de TikTok/YouTube para ver dónde tapa.
- Visor en **pantalla completa** y en **segundo monitor**.
- Avance cuadro a cuadro (← →), J/K/L para velocidad, captura de fotograma a PNG.

### 3.4 Inspector de clip
- **Transformar:** posición, escala, rotación, opacidad, volteo, recorte, ancla, modos de fusión (multiplicar, pantalla, superponer…).
- **Fotogramas clave** en *cualquier* propiedad con curvas (lineal, ease in/out, bezier) y editor de curvas.
- **Velocidad:** constante 0.1×–100×, **rampas de velocidad** por curva, reversa, congelar fotograma, interpolación óptica (cámara lenta suave).
- **Estabilización**, corrección de lente, reducción de ruido de video.
- **Máscaras:** rectángulo, elipse, pluma/bezier, con difuminado, invertir y seguimiento.
- **Seguimiento de movimiento** (motion tracking): que texto/sticker/desenfoque siga a una persona u objeto.
- **Pantalla verde / chroma key** con selector de color, tolerancia, suavizado y supresión de derrame.
- **Picture-in-picture** con presets de esquina y bordes/sombra.

### 3.5 Color
- Básico: exposición, contraste, luces, sombras, blancos, negros, temperatura, tinte, saturación, vibrancia, nitidez, viñeta, grano.
- Avanzado: **ruedas de color** (sombras/medios/luces), **curvas RGB y HSL**, ajuste por color específico.
- **LUTs** `.cube` (importar y presets propios), comparar antes/después con divisor.
- **Scopes:** histograma, forma de onda, vectorscopio.
- Igualar color entre dos clips automáticamente.

### 3.6 Texto, títulos y gráficos
- Texto con cualquier fuente del sistema + fuentes de Google; contorno, sombra, fondo, degradado, espaciado, curvado.
- **Animaciones de entrada / salida / bucle** (máquina de escribir, rebote, desvanecer, deslizar, zoom, por letra/palabra).
- Plantillas de títulos, tercios inferiores, créditos con desplazamiento, call-to-action ("Suscríbete").
- Stickers, emojis, flechas, formas, contadores, barras de progreso.
- **Subtítulos** editables con estilos tipo "karaoke" (palabra resaltada), importar/exportar `.srt` y `.vtt`.

### 3.7 Transiciones y efectos
- Mínimo 60 transiciones (disolver, barrido, zoom, deslizar, glitch, desenfoque, giro, luz…) con duración ajustable arrastrando.
- Mínimo 80 efectos y filtros (VHS, glitch, desenfoque, pixelar caras, sacudida de cámara, brillo, blanco y negro, cine, retro…).
- Búsqueda, favoritos, vista previa al pasar el ratón, aplicar arrastrando a clip o a una **capa de ajuste** que afecta todo lo de abajo.

### 3.8 Audio
- Forma de onda en cada clip, volumen por clip y por pista con fotogramas clave, fundido de entrada/salida arrastrando las esquinas.
- **Mezclador** con vúmetros, paneo, silenciar/solo y bus maestro con limitador.
- Ecualizador, compresor, reverb, cambio de tono, voz robot/radio, **reducción de ruido**, **normalizar volumen a −14 LUFS**.
- **Ducking automático**: baja la música cuando alguien habla.
- Separar audio del video, grabar voz en off sobre la línea de tiempo.
- Biblioteca de música y efectos de sonido libres de derechos (con carpeta local para agregar los propios).

### 3.9 Inteligencia artificial (usando los modelos ya conectados en Zinarix — `ai.ts` / `agent.ts`)
- **Subtítulos automáticos** (Whisper local o en la nube) en el idioma del video, y **traducción** de subtítulos.
- **Cortar silencios y muletillas** ("eh", "este") con revisión antes de aplicar.
- **Editar por transcripción:** borrar palabras del texto borra ese trozo del video.
- **Quitar fondo** sin pantalla verde, **desenfocar caras/matrículas** automáticamente.
- **Reencuadre inteligente** de 16:9 a 9:16 siguiendo a la persona.
- **Detectar escenas** y dividir automáticamente; **highlights** para crear clips cortos de un video largo.
- **Texto a voz** con varias voces; **mejorar voz** (sonido de estudio).
- **Asistente de edición en el chat:** el agente de Zinarix puede controlar el editor con herramientas (`video_add_clip`, `video_split`, `video_add_text`, `video_apply_effect`, `video_export`…) — p. ej. "hazme un short de 30 s con lo mejor de este video y subtítulos amarillos". Cada acción se puede deshacer y requiere aprobación como el resto de herramientas.

### 3.10 Exportación
- Formatos: **MP4 (H.264 / H.265)**, **MOV (ProRes)**, **WebM (VP9 / AV1)**, **GIF**, **MP3/WAV/AAC** solo audio, secuencia PNG, fotograma actual.
- Presets: YouTube 1080p/4K, TikTok/Reels/Shorts, Instagram, WhatsApp (≤ 16 MB), Web ligero, Máxima calidad.
- Opciones: resolución, fps, bitrate (CBR/VBR/CRF), códec de audio, rango (todo / I-O / región), quemar o no subtítulos, exportar `.srt` aparte.
- **Aceleración por hardware** (NVENC, QuickSync, AMF) con respaldo a CPU.
- **Cola de renderizado** con varios trabajos, progreso, tiempo restante, pausar/cancelar, notificación al terminar y botón "Abrir carpeta".
- Estimación del tamaño final antes de exportar.

## 4. Atajos de teclado

| Acción | Atajo |
|---|---|
| Abrir/cerrar Video Studio | Ctrl+Shift+V |
| Reproducir / pausa | Espacio |
| Retroceder / pausa / avanzar | J / K / L |
| Fotograma anterior / siguiente | ← / → |
| Dividir en el cabezal | S o Ctrl+B |
| Marcar entrada / salida | I / O |
| Eliminar con cierre de hueco | Shift+Supr |
| Imán on/off | N |
| Agregar marcador | M |
| Deshacer / rehacer | Ctrl+Z / Ctrl+Shift+Z |
| Exportar | Ctrl+E |

Todos se muestran en un panel "Atajos" (tecla `?`) y se pueden personalizar.

## 5. Arquitectura técnica

- **Renderer (React):** carpeta nueva `apps/desktop/src/renderer/components/video/` con `VideoStudio.tsx`, `Timeline.tsx`, `Viewer.tsx`, `MediaLibrary.tsx`, `Inspector.tsx`, `ColorPanel.tsx`, `AudioMixer.tsx`, `TextPanel.tsx`, `EffectsPanel.tsx`, `ExportDialog.tsx`, `RenderQueue.tsx`. Estado en un store propio (`videoStore.ts`) siguiendo el patrón de `store.ts`; modelo de proyecto puro y serializable (pistas → clips → efectos → keyframes).
- **Preview en tiempo real:** WebGL2/WebGPU para composición, color y efectos (shaders), `WebCodecs` para decodificar; la línea de tiempo dibujada en `<canvas>` virtualizado para aguantar cientos de clips sin lag.
- **Main (Electron):** `apps/desktop/src/main/video.ts` con IPC para: probar medios (`ffprobe`), generar miniaturas/formas de onda/proxies, renderizar con **FFmpeg** (construir el `filter_complex` desde el proyecto), cola de trabajos y progreso. Exponer en `preload.ts` solo las funciones necesarias.
- **FFmpeg:** usar binario incluido (`ffmpeg-static`/`ffprobe-static`) añadido a `extraResources` en el `build` de `package.json`; detectar FFmpeg del sistema como alternativa.
- **Rendimiento:** trabajo pesado en workers / proceso aparte, nunca bloquear la UI; caché en disco en la carpeta de datos de la app con límite y botón "Limpiar caché".
- **Herramientas del agente:** registrar las herramientas `video_*` junto a las existentes (como `cloudTools.ts` / `mailTools.ts`), con validación `zod`.

## 6. Seguridad y calidad

- Nunca pasar rutas o textos del usuario a una shell: usar `spawn` con lista de argumentos; validar rutas contra los directorios permitidos (`guard.ts` / `workspace.ts`).
- Los medios se leen por un protocolo propio seguro (no `file://` abierto).
- Todas las cadenas nuevas en `i18n.ts` (español e inglés como mínimo).
- Accesible: navegación por teclado, `aria-label` en botones de iconos, contraste correcto (`a11y.ts`).
- `pnpm typecheck` sin errores y una prueba de humo que importe un video, lo corte, añada un texto y exporte un MP4 de 5 s.

## 7. Plan por fases (entrega y verifica cada una antes de seguir)

1. **Base:** overlay a pantalla completa, botón/atajo/comando para abrir, biblioteca de medios, visor, línea de tiempo multipista con cortar/recortar/mover/imán, deshacer, guardar `.zvproj` y exportar MP4 con FFmpeg.
2. **Edición pro:** inspector con transformar y fotogramas clave, velocidad y rampas, texto con animaciones, transiciones, efectos, mezclador de audio, proxies.
3. **Color y composición:** corrección de color, curvas, LUTs, scopes, chroma key, máscaras, seguimiento de movimiento, capas de ajuste, multicámara.
4. **IA y entrega:** subtítulos automáticos, cortar silencios, edición por transcripción, quitar fondo, reencuadre 9:16, herramientas `video_*` para el agente, cola de render con aceleración por hardware y todos los presets de exportación.

Al terminar cada fase, dime qué quedó hecho, cómo probarlo y qué falta.
