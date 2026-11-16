# Zinarix Video: OpenReel y Motion Canvas como base

**Fecha:** 2026-11-15 · Copias en `vendor/openreel` y `vendor/motion-canvas`. `vendor/` está en `.gitignore`, así que no se suben al repositorio.

## Licencias (comprobadas en los archivos)

| Proyecto | Commit | Licencia |
|---|---|---|
| OpenReel (`Augani/openreel-video`) | `367d7e9` (2026-10-17) | MIT, © 2024-2026 Augustus Otu and Contributors |
| Motion Canvas | `7b91435` (2026-07-02) | MIT, © 2022 motion-canvas |

Dependencias de OpenReel que hay que vigilar (licencias consultadas con `npm view`):

| Dependencia | Licencia | Dónde la usa | Qué hacer |
|---|---|---|---|
| `@ffmpeg/core` (ffmpeg.wasm) | **GPL-2.0-or-later** | `core/media/ffmpeg-fallback.ts`, `core/video/stabilization/vidstab-engine.ts` | **No traerla.** Zinarix ya usa FFmpeg como programa aparte |
| `gsap` | Licencia propia "Standard no-charge", no es OSI | `core/animation/gsap-engine.ts` | No traerla. Usar las curvas de Motion Canvas (MIT) |
| `@imgly/background-removal` | "SEE LICENSE" (AGPL o comercial) | solo `apps/image` | No traerla |
| `mediabunny` | MPL-2.0 | `core` | Se puede usar como dependencia |
| `posthog-js` | (telemetría) | `apps/web` | No traerla |
| `@mediapipe/tasks-vision`, `onnxruntime-web`, `@paper-design/shaders`, `three`, Radix, `lucide-react` | Apache-2.0 / MIT / ISC | `core` / `ui` | Sin problema |

Además, el FFmpeg del escritorio de OpenReel también es GPL. Su carpeta `apps/desktop/LICENSES/FFMPEG.md` sirve de **modelo** para el aviso que le falta a Zinarix (plan, sección 5.4).

## Conclusión: no reemplazar, tomar piezas

Zinarix Video ya tiene, en `shared/video.ts` (1,247 líneas), keyframes, transiciones, títulos, color, ducking, paneo por pista y transcripciones. `packages/core` de OpenReel tiene unas **126 mil líneas** y depende de ffmpeg.wasm (GPL) y GSAP. Cambiar el motor completo costaría mucho y traería esos dos problemas. Conviene **sacar piezas puras**, una por una, con sus pruebas.

Piezas de OpenReel que vale la pena revisar después: `timeline/nested-sequence-engine.ts` (clips compuestos), `timeline/auto-edit-service.ts`, `multicam/`, `audio/` (EQ, compresor) y `types/transitions.ts` (catálogo de transiciones).

## Prueba hecha: curvas de animación de Motion Canvas

Los keyframes tenían 3 curvas: lineal, suave y mantener. Se agregaron 3 más: **Acelerar** (`easeInCubic`), **Frenar** (`easeOutCubic`) y **Rebote** (`easeOutBack`), tomadas de `motion-canvas/packages/core/src/tweening/timingFunctions.ts`.

- `shared/video.ts`: `easeCurve()` (la vista previa) con la atribución MIT. La opacidad y la escala se limitan para que el rebote no se pase, igual que en el export.
- `shared/videoRender.ts`: `easeExpr()`, la misma curva escrita como expresión de FFmpeg.
- `Inspector.tsx` y `strings.ts`: las 3 opciones nuevas en el selector, en español e inglés.
- `test/videoEase.test.ts`: comprueba que la vista previa y el export dibujan la misma curva.

Al crear `THIRD_PARTY_NOTICES.md` (fase 20) hay que incluir el aviso MIT de Motion Canvas.
