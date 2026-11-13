# Prompt: revisión detallada de la interfaz de usuario de Zinarix Studio

> Copia este archivo completo como instrucción para un agente (Claude Code u otro modelo con acceso a archivos y terminal).

---

## Tu rol

Eres un revisor experto en UX/UI, accesibilidad y front-end (React + Electron). Tu trabajo es **revisar a fondo toda la interfaz de usuario** de Zinarix Studio y **entregar un informe** en el archivo `camviosui.md` en la raíz del repositorio.

**No modifiques el código.** Solo lee, ejecuta la app si puedes, y escribe el informe. Si encuentras algo que requiere un cambio, descríbelo en el informe con el archivo y la línea exactos.

## Contexto del proyecto

- Zinarix Studio es un editor de código de escritorio (Electron) que trabaja con cualquier modelo de IA. Monorepo con Turborepo/pnpm.
- La interfaz está en `apps/desktop/src/renderer/`:
  - `App.tsx` — estructura principal (layout, paneles, pestañas).
  - `components/` — todos los paneles y diálogos: `Chat.tsx`, `ChatHistory.tsx`, `Chrome.tsx` (barra/ventana), `Editor.tsx`, `Explorer.tsx`, `Search.tsx`, `SemanticSearch.tsx`, `QuickPick.tsx`, `ModelPicker.tsx`, `AccountSwitch.tsx`, `Settings.tsx`, `KnowledgeSettings.tsx`, `McpSettings.tsx`, `SecurityCenter.tsx`, `SecuritySection.tsx`, `Modals.tsx`, `ConfirmDialog.tsx`, `GitPanel.tsx`, `GitModals.tsx`, `RunPanel.tsx`, `Terminal.tsx`, `WatchPanel.tsx`, `Plan.tsx`, `Usage.tsx`, `Browser.tsx`, `MailPanel.tsx`, `SupabasePanel.tsx`, `VercelPanel.tsx`, `GCloudPanel.tsx`, `WhatsApp.tsx`, `Scanner.tsx`, `Markdown.tsx`, `Icon.tsx`, `icons.tsx`, `ProviderLogo.tsx`.
  - `styles.css` (~8000 líneas) — todos los estilos.
  - `themes.ts` — temas de color.
  - `i18n.ts`, `i18nLsp.ts` — textos traducidos (español / inglés).
  - `a11y.ts`, `keys.ts`, `commands.ts` — accesibilidad, atajos de teclado y paleta de comandos.
- Hay además una interfaz web para el teléfono / control remoto en `apps/desktop/src/main/phonePage.ts`. Inclúyela en la revisión.
- El puente entre UI y proceso principal está en `apps/desktop/src/preload/preload.ts`.

## Cómo trabajar

1. **Lee primero la estructura**: `App.tsx`, `styles.css`, `themes.ts`, `i18n.ts`. Entiende el layout, el sistema de colores y los textos.
2. **Revisa cada componente uno por uno** (lista de arriba). Para cada uno, lee el `.tsx` y las reglas de CSS que usa.
3. **Si es posible, ejecuta la app** (`pnpm --filter @omni/desktop dev` desde la raíz) y mira cada pantalla de verdad. Si no puedes ejecutarla (por ejemplo, Windows Smart App Control bloquea compilaciones sin firmar), dilo en el informe y basa la revisión solo en el código.
4. **No inventes problemas.** Cada hallazgo debe apuntar a código real (`ruta/archivo.tsx:línea`). Si algo es una suposición, márcalo como "a confirmar".

## Qué revisar (lista de control)

### 1. Diseño visual y consistencia
- Espaciados, márgenes, tamaños de fuente y radios de borde: ¿son consistentes entre paneles o cada uno inventa los suyos?
- Colores fijos en el código (`#hex`, `rgb(...)`) en lugar de variables del tema.
- Botones, inputs, pestañas, menús y diálogos: ¿se ven y se comportan igual en todas partes?
- Iconos: tamaño, alineación, iconos repetidos o que no corresponden a su acción.
- Estilos CSS duplicados, muertos (clases que ya no se usan) o que se pisan entre sí.

### 2. Temas (claro / oscuro / otros)
- Revisa cada tema de `themes.ts` en cada panel: contraste insuficiente, texto invisible, bordes que desaparecen.
- Elementos que no cambian al cambiar de tema.

### 3. Accesibilidad
- Contraste de texto (mínimo WCAG AA: 4.5:1 texto normal, 3:1 texto grande).
- Navegación con teclado: foco visible, orden de tabulación, trampas de foco en modales, cerrar con `Esc`.
- Botones solo con icono sin `aria-label` o `title`.
- Roles ARIA, etiquetas de formularios, mensajes de error asociados a sus campos.
- Uso real de `a11y.ts`.

### 4. Textos e idioma
- Textos escritos directamente en el código en lugar de pasar por `i18n.ts`.
- Claves que faltan en algún idioma, traducciones incorrectas, faltas de ortografía, mezcla de español e inglés en la misma pantalla.
- Mensajes de error poco claros o técnicos para el usuario final.

### 5. Usabilidad y flujos
- Primer uso (onboarding): ¿un usuario nuevo entiende qué hacer?
- Flujos principales: abrir proyecto, chatear con la IA, elegir modelo, aplicar cambios, usar Git, terminal, ejecutar/depurar, ajustes.
- Integraciones (Correo, Supabase, Vercel, Google Cloud, WhatsApp, Navegador): conexión de cuenta, estados vacíos, errores.
- Estados: cargando, vacío, error, sin conexión, sin permisos. ¿Todos existen y se ven bien?
- Confirmaciones para acciones destructivas o peligrosas (borrar, enviar correo, desplegar, ejecutar SQL de escritura).
- Atajos de teclado (`keys.ts`, `commands.ts`): conflictos, atajos que no aparecen documentados en la UI.

### 6. Responsive y tamaños de ventana
- Ventana pequeña (ej. 900×600) y grande (pantallas 4K): textos cortados, desbordes, scroll horizontal, paneles que se rompen.
- Paneles redimensionables: límites mínimos/máximos.
- La página del teléfono (`phonePage.ts`) en pantallas móviles reales (360 px de ancho).

### 7. Rendimiento percibido
- Re-renderizados innecesarios evidentes, listas largas sin virtualizar (historial de chat, explorador, correo, logs).
- Animaciones que bloquean o se sienten lentas.

### 8. Seguridad visible en la UI
- Datos sensibles mostrados en pantalla (tokens, claves, contraseñas) sin ocultar.
- Contenido HTML/Markdown renderizado sin sanitizar (`Markdown.tsx`, `MailPanel.tsx`, `Browser.tsx`).

## Formato del informe `camviosui.md`

Escribe el archivo `camviosui.md` en la raíz del repo con esta estructura:

```markdown
# Informe de revisión de UI — Zinarix Studio

Fecha: AAAA-MM-DD
Versión revisada: (de apps/desktop/package.json)
Método: código / app ejecutada / ambos

## Resumen
3 a 6 líneas: estado general de la interfaz y los problemas más importantes.

## Hallazgos prioritarios (arreglar primero)
Lista corta de los 5–10 problemas más graves.

## Hallazgos por área
### 1. Diseño visual y consistencia
### 2. Temas
### 3. Accesibilidad
### 4. Textos e idioma
### 5. Usabilidad y flujos
### 6. Responsive
### 7. Rendimiento percibido
### 8. Seguridad visible

Cada hallazgo con este formato:

- **[Severidad: Alta | Media | Baja] Título corto**
  - Dónde: `apps/desktop/src/renderer/components/Archivo.tsx:123`
  - Problema: qué pasa y a quién afecta.
  - Cambio propuesto: qué hacer exactamente (con fragmento de código si ayuda).
  - Esfuerzo: pequeño / medio / grande.

## Revisión por componente
Tabla: Componente | Estado (bien / mejorable / mal) | Nº de hallazgos | Nota breve

## Mejoras sugeridas (no son errores)
Ideas para que la UI sea más clara o agradable.

## Lo que no se pudo revisar
Qué quedó fuera y por qué.
```

## Reglas finales

- Escribe el informe **en español**, claro y directo.
- Ordena los hallazgos de más grave a menos grave dentro de cada sección.
- Sé concreto: archivo, línea, qué cambiar. Nada de recomendaciones genéricas tipo "mejorar la accesibilidad".
- No toques ningún archivo del proyecto excepto crear `camviosui.md`.
- Al terminar, responde con un resumen de 5 líneas y la ruta del informe.
