# Informe de revisión de UI — Zinarix Studio

Fecha: 2026-11-14
Versión revisada: 0.6.1 (de `apps/desktop/package.json`)
Método: código (la app no se ejecutó; ver "Lo que no se pudo revisar")

> **Convención de rutas:** salvo que se indique otra cosa, las rutas son relativas a `apps/desktop/src/renderer/`. Las que empiezan por `main/` o `preload/` son relativas a `apps/desktop/src/`.
> **Aviso sobre líneas:** `Chat.tsx`, `styles.css` e `i18n.ts` tenían cambios sin commit y se estaban editando durante la revisión: `styles.css` pasó de 8055 a 8093 líneas, `i18n.ts` de 2865 a 2885 y `Chat.tsx` se desplazó unas 78 líneas. Las líneas de esos tres archivos pueden diferir unas decenas; el selector o el texto citado permite localizarlas.

## Resumen

La interfaz tiene una base sólida en seguridad:

- Markdown no usa `innerHTML` y solo enlaza https.
- El correo se muestra en un iframe sin scripts.
- El navegador está aislado.
- El preload expone canales tipados.
- La página del teléfono no tiene XSS.
- Las dos lenguas tienen exactamente las mismas claves (1313).

Los problemas se concentran en cuatro áreas:

1. **Accesibilidad de teclado.** Ningún modal propio tiene `role="dialog"`, Esc, foco atrapado ni devolución del foco. Muchas acciones solo aparecen con `:hover` y las pestañas no se pueden enfocar.
2. **Temas.** Los 6 temas personalizados no definen `--status-fg`, `--brand`, `--danger`, etc., así que la barra de estado queda a 1,7:1 de contraste. El anillo de foco no llega a 3:1 en ningún tema.
3. **Confirmaciones.** Hay acciones peligrosas sin confirmación o con detección débil: SQL multi-sentencia en Supabase, BigQuery DML, permitir el control desde WhatsApp a otra persona y borrar proveedores o memorias.
4. **Deuda en `styles.css`.** Una capa de "rediseño" al final redefine tokens y 97 selectores, con unos 75 hex fijos y 24 tamaños de fuente distintos.

## Hallazgos prioritarios (arreglar primero)

1. **El SQL de Supabase se salta la confirmación de escritura.** `select 1; drop table x` pasa como lectura. Ver `apps/desktop/src/renderer/components/SupabasePanel.tsx:103` y `:373`.
2. **Permitir un chat ajeno de WhatsApp da control del PC sin confirmar.** Esa persona puede ordenar y aprobar a la vez. Ver `apps/desktop/src/renderer/components/WhatsApp.tsx:98-112`.
3. **BigQuery ejecuta DML y DDL sin confirmar y sin estimar coste.** Ver `apps/desktop/src/renderer/components/GCloudPanel.tsx:195-207`.
4. **El arrastre de los separadores de la barra lateral y del chat no sigue al ratón.** El `move` guarda un `onDrag` antiguo con un ancho fijo. Ver `apps/desktop/src/renderer/App.tsx:46-52`, `:321-327` y `:365-371`.
5. **Los temas personalizados no definen `--status-fg` ni otras variables base.** La barra de estado queda ilegible (1,66:1 en Medianoche). Ver `apps/desktop/src/renderer/themes.ts:21-214`.
6. **Los modales no son diálogos accesibles y no se cierran con Esc.** Afecta a Settings, Proveedores, Centro de seguridad, Git, Plan, Usage, ModelPicker y Scanner. Solo `ConfirmDialog.tsx` lo hace bien.
7. **El anillo de foco no llega a 3:1 y los botones primarios lo pierden.** Ver `apps/desktop/src/renderer/styles.css:31`, `:64` y `:126-132`.
8. **Las acciones de las filas solo existen con `:hover`.** Afecta a Git, los mensajes del chat, el historial y las pestañas. No se llega a ellas con teclado. Ver `styles.css` en `.git-row-actions` (aprox. `:4225`) y `.ch-actions`.
9. **Borrar una rama ofrece forzar el borrado ante cualquier error.** Se puede perder trabajo. Ver `apps/desktop/src/renderer/components/GitPanel.tsx:710-716`.
10. **La barra de actividad se desborda por debajo de unos 800 px de alto.** Ajustes, Paleta y Proveedores quedan inalcanzables a 900×600. Ver `components/Chrome.tsx:52-121` y `styles.css:230-240`.

## Hallazgos por área

### 1. Diseño visual y consistencia

- **[Severidad: Media] Una capa de "rediseño" al final de la hoja redefine tokens y selectores**
  - Dónde: `styles.css:6650-6692` (segundo `:root` / `[data-theme]`) frente a `styles.css:1-68`.
  - Problema: hay 97 selectores repetidos, por ejemplo `.chat-scroll` ×5, `.turn` ×4, `.activity` ×4, `.turn-actions` ×3, `.toast` y `body` ×2. `@keyframes toast-in` está duplicado y el segundo anula al primero. `--focus` y `--sel` se declaran dos veces en el bloque claro.
    - El segundo bloque cambia `--accent` a morado sin tocar `--brand-*`, `--danger` ni `--ok`, así que la paleta queda mezclada.
    - Nadie sabe qué regla gana: `.activity` (aprox. `:241`) define `opacity:.6; filter:grayscale(.5)` y luego se anula.
  - Cambio propuesto: fusionar el bloque `6650-6692` en las líneas 1-68 y mover cada sobrescritura a la regla original, por bloques: tokens, activity, tabs, toast y chat.
  - Esfuerzo: grande.

- **[Severidad: Media] Unos 75 hex y 26 `rgba()` fijos fuera de los tokens**
  - Dónde:
    - WhatsApp (19 hex, `#25d366` ×12): `styles.css:7462-7669`.
    - Navegador: degradado `#8b3dff→#2f7bff` repetido 6 veces en lugar de `--brand-grad` (`styles.css:3195`, `:3224`, `:3231`, `:3246`, `:3329`) y `rgba(124,92,255,…)` en `:3118`, `:3227`, `:3255`, `:3279` y `:3373`.
    - `.status-item.local`: `#16825d` en `:1623`.
    - `mark` de la búsqueda: `#4daafc` en `:3439-3448`.
    - `color:#fff` aparece 19 veces.
    - Severidad de seguridad: `components/SecuritySection.tsx:12` y `:14`.
  - Problema: no siguen el tema. `#4daafc` sobre blanco da 2,48:1 y `#fff` sobre `#25d366` da 1,98:1.
  - Cambio propuesto: tokens `--wa`, `--wa-fg`, `--sev-high` y `--sev-low` por tema. Usar `mark{color:var(--focus)}` y `color-mix(in srgb, var(--brand) 25%, transparent)`.
  - Esfuerzo: medio.

- **[Severidad: Media] Tamaños de fuente y radios sin escala**
  - Dónde: todo `styles.css`; los tokens están en `:29-30` y `:6670-6671`.
  - Problema: hay 24 valores de `font-size` distintos (11px ×79, 12px ×67, 12.5px ×19, 11.5px ×16, 10px ×15, además de 9px y 9.5px) y 26 de `border-radius`. `var(--radius*)` solo se usa 12 veces frente a unos 200 valores fijos.
  - Cambio propuesto: definir `--fs-xs:11px; --fs-sm:12px; --fs-md:13px; --fs-lg:15px` y `--r-sm:4px; --r:7px; --r-lg:10px; --r-pill:999px`, y reemplazar por el valor más cercano.
  - Esfuerzo: grande.

- **[Severidad: Media] El mismo icono significa cosas distintas, y hay iconos duplicados**
  - Dónde:
    - `columns` sirve para "dividir vista" y también para "enviar en paralelo" (`components/Chat.tsx`, botones de la barra del chat y del compositor, aprox. `:2237` y `:2719`).
    - Dos botones primarios usan el icono `send` (aprox. `:2257` y `:2272`).
    - `components/Icon.tsx:49` (`run`) y `:237` (`play`) tienen el mismo trazado, igual que `:156` (`close`) y `:258` (`x`).
  - Cambio propuesto: dar un icono propio a "en paralelo" y a "enviar ya", y declarar alias (`run: ICONS.play`).
  - Esfuerzo: pequeño.

- **[Severidad: Baja] Glifos sueltos en lugar de `<Icon>`**
  - Dónde: `components/ChatHistory.tsx:160` (⤓), `components/ModelPicker.tsx:402` (⟳), `:497` (＋) y `:549` (★/☆), × en `components/Plan.tsx:229` y `components/ModelPicker.tsx:362`, `components/GitPanel.tsx:121`, `:146` y `:731`, `components/Scanner.tsx:162` y `:170`, `components/GitModals.tsx:177`, y emojis 🦖 🏄 en `components/OfflineGames.tsx:44-45`.
  - Problema: el grosor y el tamaño dependen de la fuente del sistema, y el lector de pantalla los anuncia por su nombre de carácter.
  - Cambio propuesto: usar `<Icon name="download|refresh|plus|star|x">`.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] El hover del botón oscurece en el tema oscuro**
  - Dónde: `styles.css:98-114`. El fondo es `--bg-4` `#2c2c31` y el hover `--hover` `#26262b`.
  - Problema: la señal está invertida y es casi invisible (1,07:1).
  - Cambio propuesto: `button:hover{background:color-mix(in srgb,var(--bg-4) 85%,var(--fg) 15%)}`.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] Colores de proveedor distintos en cada pantalla**
  - Dónde: `components/Usage.tsx:9-20` (color por índice) frente a `components/ProviderLogo.tsx:3-14` (color por hash).
  - Problema: un mismo proveedor cambia de color según la pantalla y según el orden de la lista.
  - Cambio propuesto: usar `providerColor(p)` también en Usage.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] CSS muerto confirmado**
  - Dónde: `styles.css:2266-2303` (`.mp-providers`, `.mp-prov*`, `.mp-count`), `:6853-6860` (`.btn-primary`), `:7493` (`.wa-help`) y `:1372` (`@keyframes pulse`).
  - Cambio propuesto: borrarlos. Se cruzaron 799 clases con los `.ts/.tsx`; las clases dinámicas (`sash-${dir}`, `md-h${n}`, `risk-${risk}`…) sí se usan.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] Variable inexistente `--muted`**
  - Dónde: `styles.css:6923` (`.vc-settings label { color: var(--muted, inherit) }`).
  - Cambio propuesto: `color: var(--fg-dim)`.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] `.tsx` y `.txt` tienen la misma insignia "TX"**
  - Dónde: `components/icons.tsx:7` y `:14`.
  - Cambio propuesto: usar "TSX" y "TXT".
  - Esfuerzo: pequeño.

- **[Severidad: Baja] El terminal ignora la fuente elegida por el usuario**
  - Dónde: `components/Terminal.tsx:177-178`, que fija `fontSize: 13`, frente a `components/Editor.tsx:28-29`, que sí usa `prefs`.
  - Cambio propuesto: aplicar `prefs.fontFamily/fontSize` en `xterm.options` cuando cambien.
  - Esfuerzo: pequeño.

### 2. Temas

- **[Severidad: Alta] Los temas personalizados no definen `--status-fg` y la barra de estado queda ilegible**
  - Dónde: `themes.ts:21-214`. La base está en `styles.css:6667` (`#9a9aa4`) y `:6687` (`#5b5b65`), y se usa en `styles.css:1603`.
  - Problema: todos los temas cambian `--status`, pero ninguno cambia `--status-fg`. Contrastes resultantes:

    | Tema         | Contraste |
    | ------------ | --------- |
    | Medianoche   | 1,66:1    |
    | Drácula      | 1,69:1    |
    | Monokai      | 1,76:1    |
    | Solarized    | 2,09:1    |
    | GitHub claro | 2,18:1    |
    | Nord         | 2,65:1    |

  - Cambio propuesto: añadir `'--status-fg': '#ffffff'` (o `#f8f8f2` en Monokai) en cada tema.
  - Esfuerzo: pequeño.

- **[Severidad: Alta] Los temas personalizados heredan `--brand`, `--danger`, `--ok`, `--warn`, `--accent-fg` y `--fg-strong`**
  - Dónde: `themes.ts:21-214` frente a `styles.css:1-34` y `:6650-6692`.
  - Problema:
    - El violeta `#7d6ff8` aparece en Monokai, Nord y Medianoche: en la pestaña activa, el indicador de actividad y el toast.
    - `--danger` sobre el fondo no llega a 4,5:1: Nord 3,76, Drácula 4,29 y Monokai 4,47.
    - El texto blanco sobre `--accent` tampoco llega: Nord 4,03 y Solarized 3,68.
  - Cambio propuesto: completar `vars` en cada tema y tiparlo como `Record<RequiredVar, string>` para que el compilador exija todas las variables.
  - Esfuerzo: medio.

- **[Severidad: Alta] Solarized claro no cumple WCAG**
  - Dónde: `themes.ts:164-165`.
  - Problema: `--fg-dim` `#93a1a1` da 2,48:1 sobre `--bg`, `--fg` da 4,39:1 sobre la barra lateral y `--focus` da 3,41:1.
  - Cambio propuesto: `--fg-dim:#657b83; --fg:#475b62; --focus:#1e6fa8`.
  - Esfuerzo: pequeño.

- **[Severidad: Media] OfflineGames lee el tema una sola vez y usa blancos fijos**
  - Dónde: `components/OfflineGames.tsx:162-165` y `:350-353`; colores fijos en `:215`, `:240`, `:427-429`, `:445`, `:449`, `:478` y `:489-493`.
  - Problema: al cambiar de tema no se actualiza. En tema claro las olas y la estela blancas casi no se verían (a confirmar visualmente).
  - Cambio propuesto: releer las variables CSS en cada fotograma o al cambiar de tema, y usar `--fg-dim` con alfa.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] El verde de WhatsApp no contrasta en tema claro**
  - Dónde: `styles.css:7536-7537` y `:7669`.
  - Problema: `#25d366` sobre blanco da aproximadamente 2:1.
  - Cambio propuesto: definir `--wa-green` por tema, con `#128c7e` en claro.
  - Esfuerzo: pequeño.

- **[Severidad: Media] Insignias de severidad con texto blanco sobre amarillo, naranja y azul**
  - Dónde: `styles.css:3886` y `components/SecuritySection.tsx:12` y `:14`.
  - Problema: contraste de 1,9 a 2,6:1.
  - Cambio propuesto: texto oscuro, o un fondo tenue con borde de color.
  - Esfuerzo: pequeño.

### 3. Accesibilidad

- **[Severidad: Alta] Ningún modal propio es un diálogo accesible y casi ninguno se cierra con Esc**
  - Dónde:
    - `components/Settings.tsx:364-365`.
    - `components/Modals.tsx:400-401`, `:762-772`, `:823-824` y `:846-847`.
    - `components/SecurityCenter.tsx:77-78`.
    - `components/GitModals.tsx:50-51`, `:82-83`, `:157-158` y `:266-267`.
    - `components/Scanner.tsx:95-96`.
    - `components/Plan.tsx:226-227`, `:287`, `:370` y `:505`.
    - `components/Usage.tsx:100` y `components/ModelPicker.tsx:332-333`.
  - Problema: les falta `role="dialog"`, `aria-modal` y `aria-labelledby`. Tab sale del modal hacia el editor de detrás y el foco no vuelve al elemento que lo abrió. En ModelPicker, Esc solo funciona si el foco está en el buscador. Solo `components/ConfirmDialog.tsx:16-58` lo hace bien.
  - Cambio propuesto: un componente común, partiendo de la lógica de ConfirmDialog, y usarlo en todos los modales:
    ```tsx
    function ModalShell({ labelledBy, onClose, children }) {
      // guarda document.activeElement al montar, foco al primer control,
      // Tab/Shift+Tab atrapados, Esc → onClose, restaura el foco al desmontar
      return (
        <div className="modal-backdrop">
          <div role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
            {children}
          </div>
        </div>
      );
    }
    ```
  - Esfuerzo: medio.

- **[Severidad: Alta] El anillo de foco no llega a 3:1 en ningún tema y desaparece en los botones primarios**
  - Dónde: `styles.css:31` y `:64` (`--ring` con un 30-38 % de alfa), usado en `:118-121`, `:165-168` y `:7863-7866`; se anula en `button.primary` (`:126-132`), `.sx-tabs button.on` (`:590`) y `.phone-tabs button.on`.
  - Problema:
    - Contraste del anillo: 1,70:1 en oscuro y 1,54:1 en claro.
    - Como es `box-shadow`, en el modo de alto contraste de Windows desaparece.
    - El `box-shadow` de `button.primary` gana al de `:focus-visible` porque tiene la misma especificidad y va después.
  - Cambio propuesto:
    ```css
    button:focus-visible,
    [role='button']:focus-visible,
    [role='tab']:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 1px;
    }
    ```
  - Esfuerzo: pequeño.

- **[Severidad: Alta] Acciones que solo se ven con el ratón encima**
  - Dónde:
    - `styles.css` `.git-row-actions{display:none}` (aprox. `:4225-4229`) y `.git-commit-actions` (aprox. `:6050`), que afectan a `components/GitPanel.tsx:188-216`, `:580-623`, `:680-724` y `:748-797`.
    - `.turn-actions` (aprox. `:4589`), `.chat-tab-x` (`:5033`), `.chat-list-folder button` (`:5095`) y `.ch-actions` (`:3033`).
  - Problema: con `display:none` no se llega con Tab. Sin `:focus-within`, Copiar, Regenerar, cerrar pestaña, borrar del historial, preparar, descartar o borrar rama quedan fuera del alcance del teclado.
  - Cambio propuesto:
    ```css
    .git-row:focus-within .git-row-actions,
    .ch-item:focus-within .ch-actions {
      display: flex;
    }
    .turn:focus-within .turn-actions,
    .chat-tab:focus-within .chat-tab-x,
    .chat-list-folder:focus-within button {
      opacity: 1;
    }
    ```
  - Esfuerzo: pequeño.

- **[Severidad: Alta] Las pestañas no se pueden enfocar con teclado**
  - Dónde: `components/Chat.tsx:2747`, `components/Browser.tsx:178`, `components/Editor.tsx:107` y `components/Terminal.tsx:307`. En el terminal solo se cierra con clic central (`:312`).
  - Problema: son `div` o `span` con `role="tab"` y `onClick`, sin `tabIndex` ni `onKeyDown`.
  - Cambio propuesto: tabindex itinerante (0 en la pestaña activa, -1 en las demás), ←/→ para moverse, Enter para activar, Supr o Ctrl+W para cerrar, y `aria-selected` y `aria-controls`.
  - Esfuerzo: medio.

- **[Severidad: Alta] El explorador no es un árbol accesible y cada fila es una parada de Tab**
  - Dónde: `components/Explorer.tsx:191` (`<div className="tree">` sin rol) y `:136` (`tabIndex={0}` en todas las filas).
  - Problema: el lector de pantalla no sabe qué es carpeta, si está abierta ni a qué nivel. Con 500 archivos hay 500 tabulaciones y no hay navegación con flechas.
  - Cambio propuesto: `role="tree"` en el contenedor; en cada fila, `role="treeitem"`, `aria-level`, `aria-expanded` y `aria-selected`; tabindex itinerante y ↑/↓/←/→/Inicio/Fin.
  - Esfuerzo: medio.

- **[Severidad: Alta] Los mensajes en streaming, los errores y los toast no se anuncian**
  - Dónde: el contenedor `.chat-scroll` de `components/Chat.tsx` (no hay ningún `aria-live` en el archivo), `.turn-error` y `.tool-actions` cuando piden aprobación, `App.tsx:391` (toast) y los errores de formulario en `components/Modals.tsx:321` y `:624`, `components/McpSettings.tsx:146-150` y `components/SecuritySection.tsx:278-282`.
  - Cambio propuesto: `role="log" aria-live="polite" aria-busy={busy}` en `.chat-scroll`, `role="alert"` en errores y aprobaciones, y `<div className="toast" role="status" aria-live="polite">` siempre montado.
  - Esfuerzo: pequeño.

- **[Severidad: Media] El menú contextual del explorador solo funciona con ratón**
  - Dónde: `components/Explorer.tsx:192-200`.
  - Problema: no tiene `role="menu"`, no se abre con Mayús+F10 ni con la tecla Menú, Esc no lo cierra y se coloca en `clientX/Y` sin ajustarse a los bordes de la ventana, así que se corta cerca de ellos. El terminal sí cierra su menú con Esc (`components/Terminal.tsx:164`).
  - Cambio propuesto: manejar Esc y `ContextMenu`/`Shift+F10`, enfocar el primer elemento y limitar la posición a `innerWidth/innerHeight`.
  - Esfuerzo: pequeño.

- **[Severidad: Media] QuickPick sin roles de combobox ni listbox**
  - Dónde: `components/QuickPick.tsx:79` (input), `:95` (`.pick-list`), `:102` (filas) y `:116` (sin resultados muestra solo "—").
  - Cambio propuesto: `role="combobox" aria-controls="pick-list" aria-activedescendant={`pick-${index}`}` en el input, `role="listbox"` en la lista y `role="option" aria-selected` en las filas; usar `t('noResults')` en lugar de "—".
  - Esfuerzo: pequeño.

- **[Severidad: Media] Botones cuyo nombre accesible es un símbolo**
  - Dónde:
    - `components/GitPanel.tsx:214`, `:471` y `:501` (+/−).
    - `components/GitModals.tsx:64` y `:88` (×).
    - `components/Search.tsx:286`, `:331`, `:370`, `:373` y `:376` (⊞, ›, Aa, ab, .*).
    - `components/Modals.tsx:477-479` (×) y `:802` (↺).
    - `components/Settings.tsx:274-276`.
    - `components/GCloudPanel.tsx:403-407` y `:433-435`.
    - `components/Usage.tsx:220` (✓).
  - Cambio propuesto: añadir un `aria-label` traducido con `t()`. El contenido de texto tiene prioridad sobre `title`, por eso `title` no basta.
  - Esfuerzo: pequeño.

- **[Severidad: Media] Campos con placeholder como única etiqueta**
  - Dónde:
    - `components/Settings.tsx:287-292` y `:539-544`.
    - `components/KnowledgeSettings.tsx:49`, `:151`, `:157` y `:201`.
    - `components/McpSettings.tsx:140`.
    - `components/SecurityCenter.tsx:114`.
    - `components/SecuritySection.tsx:244`, `:250`, `:662` y `:694`.
    - `components/Modals.tsx:403` y `:825-827` (InputBox: el texto de la pregunta es un `div` suelto).
    - `components/MailPanel.tsx:536-559` y `:605-631`.
    - `components/Usage.tsx:210`.
    - El textarea del chat en `components/Chat.tsx` (aprox. `:2136`).
    - `components/WhatsApp.tsx:225-237` (select).
    - `main/phonePage.ts:156` (PIN).
  - Cambio propuesto: un `aria-label={t(...)}` o un `<label htmlFor>`.
  - Esfuerzo: pequeño.

- **[Severidad: Media] ConfirmDialog enfoca "Aceptar" aunque la acción sea destructiva**
  - Dónde: `components/ConfirmDialog.tsx:19`, `:38-41` y `:81-82`.
  - Problema: con `danger:true`, un Enter reflejo confirma un borrado. Además el `alertdialog` no tiene nombre (`:66-68`).
  - Cambio propuesto: si `req.danger`, enfocar Cancelar e ignorar Enter fuera de los botones; añadir `aria-labelledby`.
  - Esfuerzo: pequeño.

- **[Severidad: Media] Los separadores de paneles no se pueden mover con teclado**
  - Dónde: `App.tsx:41-65` y `styles.css:93-97` y `:291-308`.
  - Problema: no tienen `role="separator"`, `aria-orientation` ni `tabIndex`. Miden 4 px de ancho y el separador vertical muestra el cursor `col-resize`.
  - Cambio propuesto: añadir `role="separator" tabIndex={0}`, flechas de ±16 px, una zona de agarre de 6-8 px con `::before` y `body.dragging-y *{cursor:row-resize!important}`.
  - Esfuerzo: medio.

- **[Severidad: Baja] Botones de alternar y filtros que no anuncian su estado**
  - Dónde:
    - `components/ModelPicker.tsx:325`, `:545-549` y `:568-576`.
    - Los botones de lista, dividir e historial de la barra de `components/Chat.tsx`.
    - `components/Chrome.tsx:40-49` (barra de actividad).
    - `components/Scanner.tsx:118-122` (chips) y `:174-182` (barra de progreso).
  - Cambio propuesto: `aria-pressed` en los botones de alternar; `role="progressbar"` con `aria-valuenow`, `aria-valuemin` y `aria-valuemax`; el número del badge dentro del `aria-label`.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] Elementos interactivos solo para ratón o anidados**
  - Dónde:
    - `components/Plan.tsx:54-58` (badge de plan con `<span onClick>`).
    - `components/SemanticSearch.tsx:89` y `:100` (filas `div` con `onClick`).
    - El menú de terminales del chat, que solo se cierra con `mouseleave` (`components/Chat.tsx`, aprox. `:2038`).
    - Un botón dentro de otro en `components/Chrome.tsx:225-231`, `components/ChatHistory.tsx:135-165` y la lista de proyectos de `components/Chat.tsx`.
  - Cambio propuesto: usar `<button>` o `pressable()` de `a11y.ts`, y separar la fila principal de su grupo de acciones.
  - Esfuerzo: pequeño o medio.

- **[Severidad: Baja] El interruptor de WhatsApp no tiene nombre ni foco visible**
  - Dónde: `components/WhatsApp.tsx:176-184` y `styles.css:7611-7616`.
  - Cambio propuesto: `aria-label={t('waTitle')}` y `.wa-switch input:focus-visible + span { box-shadow: var(--ring) }`.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] No se respeta `prefers-reduced-motion`**
  - Dónde: no existe la regla en `styles.css`. Hay 10 animaciones `infinite`: `:759`, `:1306`, `:1352`, `:2029`, `:3177`, `:3203`, `:3226`, `:5016`, `:5347` y `:7228`.
  - Cambio propuesto:
    ```css
    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
    ```
  - Esfuerzo: pequeño.

- **[Severidad: Baja] El canvas de los juegos sin nombre ni foco visible**
  - Dónde: `components/OfflineGames.tsx:80-85` y `styles.css:8040-8044` (`outline:none`).
  - Cambio propuesto: `role="img" aria-label={t('gameDino')}` y una regla `:focus-visible{box-shadow:var(--ring)}`.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] Textos de 9 a 10 px y un badge con poco contraste**
  - Dónde: `styles.css:4069-4082` (`.activity-badge`, 9,5 px, 3,82:1), `:2816` (`.usage-day`, 9 px) y 15 reglas más de 10 px.
  - Cambio propuesto: un mínimo de 10,5-11 px y el badge sobre `--danger`.
  - Esfuerzo: pequeño.

### 4. Textos e idioma

> Estado general: `es` y `en` tienen 1313 claves cada uno, sin claves que falten, sin duplicados y con los mismos placeholders. El tipado `Record<Key,string>` lo garantiza (`i18n.ts:1433`). No se encontraron faltas de ortografía.

- **[Severidad: Alta] SecuritySection tiene la navegación y las severidades en español fijo**
  - Dónde: `components/SecuritySection.tsx:68-75` (categorías), `:389` ("Otro"), `:587-588` ("nuevos" y "resueltos"), `:86-87`, `:144`, `:158`, `:431` y `:552` (severidades "crítico" y "alto", con el plural hecho pegando una "s").
  - Problema: con la interfaz en inglés se ve en español, y también sale así en el informe exportado (`:425`).
  - Cambio propuesto: convertir `CATS` en una función con `t()`, como en `components/SecurityCenter.tsx:18`, y añadir `sevLabel(sev, n)` con claves `_one` y `_other`.
  - Esfuerzo: pequeño.

- **[Severidad: Media] La página del teléfono está solo en español**
  - Dónde: `main/phonePage.ts:8` (`lang="es"`), `:141-168`, `:224`, `:325` y `:371-375`.
  - Cambio propuesto: pasar el idioma activo a `phonePage(nonce, lang)` e incluir un diccionario pequeño.
  - Esfuerzo: medio.

- **[Severidad: Media] Los comandos "/" del chat tienen nombres en español fijo**
  - Dónde: `components/Chat.tsx:134-146` (`explicar`, `revisar`, `arreglar`…).
  - Cambio propuesto: aceptar alias en los dos idiomas (`aliases: ['explain','explicar']`) o pasar el nombre por `t()`.
  - Esfuerzo: pequeño.

- **[Severidad: Media] Errores técnicos mostrados en crudo**
  - Dónde:
    - Chat: `components/Chat.tsx`, `toast(String(err.message))` en aprox. `:972`, `:1803` y `:2602`. La ayuda de `.turn-error` (aprox. `:790-799`) se decide con la regex `/key|llave|401/i`.
    - `components/SemanticSearch.tsx:54`.
    - `components/ModelPicker.tsx:604-607` (id técnico del proveedor; el error solo aparece en `title`).
    - `components/Modals.tsx:468` y `:505` (`status`, `adapter` y `category` en crudo).
    - `components/GCloudPanel.tsx:395` (`RUNNABLE` o `STOPPED`).
    - `main/whatsapp.ts:415`, `:432` y `:472` (errores en español fijo).
  - Cambio propuesto: mover `errText` (`components/Plan.tsx:23`) a un util común y hacer que main envíe un `code` (`auth`, `rate_limit`, `offline`, `tools_unsupported`) que el renderer traduce.
  - Esfuerzo: medio.

- **[Severidad: Media] Indicadores "ocupado" con identificadores internos en inglés**
  - Dónde: `components/GitPanel.tsx:458` (`discard…`, `checkout…`), `components/VercelPanel.tsx:966-968` y `:1305-1308` (`redeploy…`, `promote…`) y `components/SupabasePanel.tsx:1927-1930`.
  - Cambio propuesto: un mapa a claves de i18n, por ejemplo `t(\`busy_${busy}\`)` → "Descartando…".
  - Esfuerzo: pequeño.

- **[Severidad: Media] Textos fijos fuera de `t()`**
  - Dónde:
    - `components/VercelPanel.tsx:195-201` (Root directory, Build command…) y `:1025` y `:1065` (nombres de entorno).
    - `components/Modals.tsx:209` (`'Mi servidor' : 'Mi agente'`), `:388` y `:529` (`'error'`) y `:593` ("Docs").
    - `components/GCloudPanel.tsx:568` y `:574` (Client ID y Client secret).
    - `components/Scanner.tsx:8` y `:14`.
    - `components/Chat.tsx:111` ('imagen') y `:361` ('tok').
    - `components/WatchPanel.tsx:19` (min y h).
  - Cambio propuesto: crear las claves correspondientes en `i18n.ts`.
  - Esfuerzo: pequeño.

- **[Severidad: Media] Mensaje equivocado al insertar código sin editor abierto**
  - Dónde: `components/Markdown.tsx:317`, que muestra `t('noFolder')` → "No hay ninguna carpeta abierta.".
  - Cambio propuesto: una clave nueva `noEditor: 'Abre un archivo para insertar el código.'`.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] Atajos escritos a mano en la UI**
  - Dónde: `components/Chrome.tsx:269-274`, `components/Plan.tsx:442-454` y `components/Chat.tsx` (Ctrl+L y Ctrl+K en el estado vacío).
  - Problema: muestran "Ctrl" también en macOS y no reflejan los atajos personalizados.
  - Cambio propuesto: obtener el texto de `commands().find(c => c.id === id)?.keys`.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] Fechas, unidades y dinero sin el idioma de la app**
  - Dónde: `components/WatchPanel.tsx:11-17` (`toLocaleString(undefined…)`), dinero formateado en 3 sitios (`components/Chat.tsx:364`, `components/Usage.tsx:22` y `components/ModelPicker.tsx:58`) y `components/Usage.tsx:174-175` (`t('priceIn').split(' ')[0]`).
  - Cambio propuesto: un util `formatUsd()` y `Intl.*Format(lang)` con el idioma de i18n.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] Términos mezclados**
  - Dónde: "llave de API" (`i18n.ts:49`, `:291` y `:1323`) frente a "clave" (`:1102`), y comillas «» (`:123`) frente a "" (`:206`). Anglicismos que se podrían traducir: "Magic link" (`:1157` y `:1261`), "Backups" (`:1149`) y "Preview" (`:831`).
  - Cambio propuesto: unificar en "clave de API" y usar un solo tipo de comillas.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] `i18nLsp.ts` no se usa**
  - Dónde: `i18nLsp.ts:1-51`. `tl()` tiene 0 usos, aunque existen `main/lsp.ts` y `main/nextEdit.ts`.
  - Cambio propuesto: añadir una sección LSP en los ajustes del editor (`components/Settings.tsx:445`) o borrar el archivo. Si los errores de LSP llegan a la UI por otra vía está "a confirmar".
  - Esfuerzo: medio.

### 5. Usabilidad y flujos

- **[Severidad: Alta] El SQL de Supabase puede escribir sin confirmación**
  - Dónde: `components/SupabasePanel.tsx:103` (`READ_ONLY` solo mira la primera palabra) y `:373`.
  - Problema: `select 1; drop table x` y `with d as (delete … returning *) select …` se consideran lectura. El diálogo de escritura tampoco usa `danger:true`.
  - Cambio propuesto: tratar como escritura cualquier consulta con `;` intermedio o con `insert|update|delete|drop|alter|truncate|grant|create` en cualquier posición, confirmar con `{ danger: true }` y mostrar un extracto de la consulta.
  - Esfuerzo: pequeño.

- **[Severidad: Alta] BigQuery sin confirmación ni estimación de coste**
  - Dónde: `components/GCloudPanel.tsx:195-207` y `main/gcloud.ts:267-272`.
  - Cambio propuesto: reutilizar la detección de escritura con confirmación de peligro, hacer un `dryRun` que muestre "Procesará X GB (≈ $Y)" y fijar `maximumBytesBilled`.
  - Esfuerzo: medio.

- **[Severidad: Alta] El arrastre de los separadores de la barra lateral y del chat no sigue al ratón**
  - Dónde: `App.tsx:46-52` (el `move` se crea una vez en `mousedown` y guarda ese `onDrag`) junto con `App.tsx:321-327` y `:365-371` (`setSideW(() => sideShown + d)`, donde `d` es solo el delta del último movimiento).
  - Problema: cada movimiento calcula "ancho al empezar + unos pocos px", así que el panel tiembla cerca de su ancho inicial. El panel inferior (`:349`) sí usa la forma funcional `h - d` y funciona. A confirmar en ejecución, aunque la lógica es inequívoca.
  - Cambio propuesto:
    ```tsx
    onDrag={(d) => setSideW((w) => { const next = Math.min(900, Math.max(160, w + d)); localStorage.setItem(SIDE_W_KEY, String(Math.round(next))); return next; })}
    ```
    Lo mismo para el chat, con `w - d`.
  - Esfuerzo: pequeño.

- **[Severidad: Alta] Borrar una rama ofrece forzar el borrado por una causa falsa**
  - Dónde: `components/GitPanel.tsx:710-716` e `i18n.ts:661` (`gitForceDelete`).
  - Problema: cualquier error (rama abierta en otro worktree, bloqueo, permisos) muestra "La rama tiene commits sin fusionar…" y ofrece `-D`.
  - Cambio propuesto: ofrecer el forzado solo si el error contiene `not fully merged`; en los demás casos mostrar `errText(e)`.
  - Esfuerzo: pequeño.

- **[Severidad: Alta] Acciones destructivas sin confirmación**
  - Dónde:
    - `components/Modals.tsx:597-607` (desconectar proveedor) y `:610-621` (borrar proveedor).
    - `components/KnowledgeSettings.tsx:99-104` (borrar memoria) y `:191` (quitar docs).
    - `components/SecuritySection.tsx:725-730` (vaciar historial).
    - `components/Settings.tsx:279` (desconectar bot).
    - `components/Scanner.tsx:47` y `:95-97`: cerrar durante un escaneo no lo detiene, y basta un clic en el fondo para perder el resultado.
  - Cambio propuesto: `if (!(await confirmDialog(t('…Confirm'), { danger: true }))) return;`. En Scanner, llamar a `scanAbort` al cerrar e impedir que el clic en el fondo cierre mientras escanea.
  - Esfuerzo: pequeño.

- **[Severidad: Media] Ejecutar en el terminal el código propuesto por la IA no se marca como peligroso**
  - Dónde: `components/Markdown.tsx:362`.
  - Cambio propuesto: `confirmDialog(t('confirmRun', { cmd: code }), { danger: true })` y mostrar el comando en `<pre>`.
  - Esfuerzo: pequeño.

- **[Severidad: Media] "Detectar y ejecutar" lanza el script de un repo ajeno sin mostrarlo**
  - Dónde: `components/RunPanel.tsx:255-260` y `:206-210`.
  - Cambio propuesto: la primera vez en cada workspace, confirmar mostrando el comando real, por ejemplo "npm run dev → `vite --host`".
  - Esfuerzo: pequeño.

- **[Severidad: Media] Producción en Vercel sin estilo de peligro, y una variable editada puede quedar vacía**
  - Dónde:
    - Acciones de producción: `components/VercelPanel.tsx:65`, `:887-889` y `:910`.
    - Variables: `:1110`, que abre con `value: ''`, y `:580-589`, que guarda sin comprobar el valor.
  - Cambio propuesto: `{ danger: true }` cuando el destino es producción, y deshabilitar Guardar si el valor está vacío (o confirmar).
  - Esfuerzo: pequeño.

- **[Severidad: Media] Los errores se muestran como "vacío"**
  - Dónde:
    - `components/Explorer.tsx:28-29`: una carpeta ilegible aparece vacía.
    - `components/Search.tsx:166-167`: aparece "Sin resultados".
    - `components/MailPanel.tsx:187-191` y `:865`: aparece "No hay correos".
    - `components/GitPanel.tsx:73-75`: promesas sin `.catch` y "Sin commits".
    - `components/Plan.tsx:399-408`: la búsqueda de modelos locales no informa cuando no encuentra nada.
  - Cambio propuesto: un estado `error` con un mensaje traducido y un botón "Reintentar", como `ErrorBox` en GCloud.
  - Esfuerzo: pequeño.

- **[Severidad: Media] Los filtros de búsqueda se aplican después del tope de 2000 resultados**
  - Dónde: `components/Search.tsx:184` y `:271`.
  - Cambio propuesto: pasar `include` y `exclude` a ripgrep como `--glob`. Mientras tanto, avisar cuando `capped && grouped.length===0`.
  - Esfuerzo: medio.

- **[Severidad: Media] "Reemplazar" en un solo archivo escribe en disco sin confirmar ni poder deshacer**
  - Dónde: `components/Search.tsx:242-248`, `:260` y `:505-511`.
  - Cambio propuesto: confirmar siempre que haya más de una coincidencia, o aplicar el cambio con `pushEditOperations` de Monaco para que Ctrl+Z lo deshaga.
  - Esfuerzo: pequeño o medio.

- **[Severidad: Media] Sin conexión solo se avisa con el chat vacío**
  - Dónde: `components/Chat.tsx`, donde `useOnline()` solo se usa cuando `turns.length === 0` (aprox. `:1905-1907`).
  - Cambio propuesto: un banner fijo sobre `.chat-input` cuando `!online` y el modelo no sea local.
  - Esfuerzo: pequeño.

- **[Severidad: Media] Demasiados botones de envío mientras el chat está ocupado**
  - Dónde: `components/Chat.tsx` (aprox. `:2230-2274`). Aparecen a la vez Paralelo, Cola, Enviar ya y Detener.
  - Cambio propuesto: un solo botón "Enviar" con menú (Ahora / En cola / En paralelo).
  - Esfuerzo: medio.

- **[Severidad: Media] Los atajos de teclado chocan con Monaco y con el terminal**
  - Dónde: `commands.ts:211`, `:290` y `:300`; `main/main.ts:1842`, `:1890` y `:1893`.
  - Problema:
    - Ctrl+K anula los acordes de Monaco (Ctrl+K Ctrl+C, Ctrl+K Ctrl+F).
    - Ctrl+L anula "limpiar" en el terminal (`commands.ts:303`).
    - Ctrl+Shift+L anula "seleccionar todas las coincidencias".
    - Ctrl+\` no funciona bien en un teclado español (`commands.ts:205`), donde \` es tecla muerta.
  - Cambio propuesto: usar Ctrl+I y Ctrl+Shift+I para el chat, no capturar Ctrl+L dentro del terminal y añadir Ctrl+J como alternativa para abrir el terminal.
  - Esfuerzo: pequeño.

- **[Severidad: Media] Los atajos personalizados no sustituyen a los del menú y no se detectan conflictos**
  - Dónde: `App.tsx:201-216`, `main/main.ts:1783-1898`, `keys.ts:14-32` y `components/Settings.tsx:566-568`.
  - Cambio propuesto: reconstruir el menú con `prefs.keybindings` y avisar en el grabador si la combinación ya la usa otro comando ("Ya lo usa X, ¿reasignar?").
  - Esfuerzo: medio.

- **[Severidad: Media] Confiar en el `mcp.json` del proyecto con un solo clic**
  - Dónde: `components/McpSettings.tsx:81-83`.
  - Cambio propuesto: un `confirmDialog` que liste los comandos y URLs que se van a ejecutar.
  - Esfuerzo: pequeño.

- **[Severidad: Media] `prompt()` nativo no funciona en Electron**
  - Dónde: `components/SupabasePanel.tsx:751` y `:1184`. El propio código lo reconoce en `store.ts:220`.
  - Problema: "Nueva migración" y "Nueva función" no hacen nada.
  - Cambio propuesto: usar `askText()`.
  - Esfuerzo: pequeño.

- **[Severidad: Media] Un análisis fallido borra resultados de "ejecutar todo"**
  - Dónde: `components/SecuritySection.tsx:357-362`, que usa un `store` capturado y desactualizado.
  - Cambio propuesto: `setStore(cur => { const next = {...cur, [kind]: …}; save(LS,next); return next; })`.
  - Esfuerzo: pequeño.

- **[Severidad: Media] Al editar una memoria, el texto se pierde si el campo pierde el foco**
  - Dónde: `components/KnowledgeSettings.tsx:86` (`onBlur={() => setEditing(null)}`) y `:81` (sin `try/catch`).
  - Cambio propuesto: guardar al perder el foco y mostrar el error en un toast.
  - Esfuerzo: pequeño.

- **[Severidad: Media] Un presupuesto inválido borra el existente sin avisar**
  - Dónde: `components/Usage.tsx:92-93`.
  - Cambio propuesto: mostrar un error en línea y añadir un botón explícito "Quitar".
  - Esfuerzo: pequeño.

- **[Severidad: Baja] El onboarding manda dos tarjetas al mismo sitio**
  - Dónde: `components/Plan.tsx:368` y `:409-418`.
  - Problema: "Agente de terminal" y "Llave de API" abren Proveedores sin filtro.
  - Cambio propuesto: abrir Proveedores con `kind` `cli` o `api` (`components/Modals.tsx:330`) y volver al onboarding al terminar.
  - Esfuerzo: medio.

- **[Severidad: Baja] El idioma solo se cambia desde la paleta de comandos**
  - Dónde: `components/Settings.tsx:370-377` y `commands.ts:371-377`.
  - Cambio propuesto: un selector "Idioma" en Apariencia.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] Otros detalles de flujo**
  - Navegador: mientras carga, el botón muestra ✕ pero sigue recargando (`components/Browser.tsx:236-243`).
  - Correo:
    - Ctrl+Enter envía sin poder deshacer (`components/MailPanel.tsx:628-630`).
    - Los enlaces `http://` se descartan sin aviso (`main/main.ts:1988-1991`, a confirmar).
  - Terminal: los comandos enviados con `setTimeout(300)` se pierden si el panel aún no se ha montado (`components/RunPanel.tsx:208` y `components/GitPanel.tsx:330` y `:385`, a confirmar).
  - Juegos: el bucle no se pausa al perder el foco, aunque el comentario de `components/OfflineGames.tsx:89` dice que sí (`:98-104`).
  - "Cerrar sesión" (`components/AccountSwitch.tsx:59-62`): está "a confirmar" si quien lo llama pide confirmación.

### 6. Responsive

- **[Severidad: Alta] La barra de actividad se desborda por debajo de unos 800 px de alto**
  - Dónde: `components/Chrome.tsx:52-121` (hasta 19 botones de 38 px), `styles.css:230-240` y `:6715-6719` (sin `overflow`) y `main/main.ts:1955` (`minHeight: 500`).
  - Problema: a 900×600 quedan recortados Ajustes, Paleta y Proveedores, y `html` tiene `overflow:hidden`.
  - Cambio propuesto: `.activity-bar{overflow-y:auto;scrollbar-width:none}` y `@media (max-height:700px){.activity{width:32px;height:32px}}`, o un menú "Más" para Vercel, Supabase, GCloud, Mail y Watch.
  - Esfuerzo: medio.

- **[Severidad: Media] El modal de Settings se sale por abajo**
  - Dónde: `styles.css:4397-4399` (`height:min(1120px,96vh)`) más `:1635` (`padding-top:8vh`). Proveedores queda justo en el límite (`:1719`).
  - Problema: suma 104vh; a 600 px de alto se cortan 24 px.
  - Cambio propuesto: `max-height: calc(92vh - 16px)` o reducir el `padding-top` para estos dos modales.
  - Esfuerzo: pequeño.

- **[Severidad: Media] El editor queda aplastado con el chat dividido y la lista de chats abiertos**
  - Dónde: `App.tsx:114-121` (`chatMin` de 810 px) frente a `CENTER_MIN = 360` (`:70`).
  - Problema: a 900 px de ancho el centro queda en unos 160 px.
  - Cambio propuesto: si no cabe `CENTER_MIN`, cerrar la lista de chats o pasar a `chatWide`.
  - Esfuerzo: medio.

- **[Severidad: Media] La altura del panel inferior no se limita a la ventana y no se guarda**
  - Dónde: `App.tsx:97` y `:349` (100-800 px fijos).
  - Cambio propuesto: `Math.min(panelH, winH - 180)` y guardarla en `localStorage` como la barra lateral y el chat.
  - Esfuerzo: pequeño.

- **[Severidad: Media] La navegación de Settings ocupa demasiado a 900 px**
  - Dónde: `styles.css:4407-4409` (260 px) y `:4440` (40 px de padding).
  - Cambio propuesto: con `@media (max-width:1000px)`, dejar la navegación en 200 px (o solo iconos) y el padding en 20 px.
  - Esfuerzo: pequeño.

- **[Severidad: Media] La tabla de modelos tiene columnas fijas**
  - Dónde: `styles.css:2311` (`.mp-row`: 28/72/86/86/84/104 px).
  - Problema: a 800 px los nombres de modelo se cortan.
  - Cambio propuesto: `@container (max-width:760px)` que oculte el precio de salida y las capacidades.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] Media queries que nunca se aplican**
  - Dónde: `styles.css:3383` y `:5769` (`max-width:640px`) frente a `main/main.ts:1954` (`minWidth: 800`).
  - Cambio propuesto: quitarlas o convertirlas en `@container`, y añadir reglas para `max-height:700px`.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] Las pestañas que se desbordan no se pueden descubrir**
  - Dónde: `styles.css:4957-4969` (`.chat-tabs` con `scrollbar-width:none`), `.term-tabs` y `.tabs` (aprox. `:924`, barra de 3 px).
  - Cambio propuesto: desplazamiento con la rueda (`scrollLeft += deltaY`), sombras laterales o un menú "⋯".
  - Esfuerzo: medio.

- **Página del teléfono (360 px):** no se encontraron anchos fijos que rompan el diseño a 360 px. La verificación en un dispositivo real queda "a confirmar".

### 7. Rendimiento percibido

- **[Severidad: Media] App re-renderiza todo el árbol en cada `fs:changed`, toast o resize**
  - Dónde: `App.tsx:220` (`fsVersion`), `:93` (toast), `:122` (`dragging`) y `:176-180` (resize sin limitar).
  - Problema: mientras un agente escribe archivos, `fsVersion` sube muchas veces por segundo, y EditorArea, ChatPanel, Explorer y Terminal no están memoizados.
  - Cambio propuesto: extraer `<GitBadgeWatcher/>`, `<Toast/>` y `<DropOverlay/>`, limitar el resize con `requestAnimationFrame` y aplicar `memo` a ChatPanel y EditorArea.
  - Esfuerzo: pequeño.

- **[Severidad: Media] Listas largas sin virtualizar**
  - Dónde:
    - Árbol del explorador: `components/Explorer.tsx`, renderizado recursivo; además relee todas las carpetas abiertas en cada cambio.
    - Resultados de búsqueda: `components/Search.tsx:487-546`, con agrupación O(n²) en `:184`.
    - Diff de commit: `components/GitModals.tsx:90-106`, un `div` por línea y sin indicador de carga.
    - Log de build: `components/VercelPanel.tsx:155-167`.
  - Cambio propuesto:
    - Agrupar con `arr ? arr.push(h) : m.set(h.path,[h])`.
    - Virtualizar con `@tanstack/react-virtual`.
    - Mostrar el diff en un Monaco de solo lectura con lenguaje `diff`.
    - Limitar el log a N líneas con "ver todo".
  - Esfuerzo: medio.

- **[Severidad: Media] RunPanel vuelve a escanear el proyecto en cada guardado**
  - Dónde: `components/RunPanel.tsx:237-242` y `:282`.
  - Problema: el panel parpadea en "Detectando…".
  - Cambio propuesto: aplicar debounce, re-detectar solo si cambia un archivo de `CONFIG_NAMES` y no poner `detection` a `null` mientras refresca.
  - Esfuerzo: pequeño.

- **[Severidad: Media] La página del teléfono redibuja todo el chat en cada evento**
  - Dónde: `main/phonePage.ts:322-344` (`log.textContent = ''`).
  - Problema: se pierde la selección y los botones Aprobar/Rechazar se vuelven a crear mientras el usuario los toca.
  - Cambio propuesto: renderizar solo los turnos que cambian.
  - Esfuerzo: medio.

- **[Severidad: Baja] Animaciones costosas**
  - Dónde: `styles.css:3223-3233` (`.browser-frame.ai` anima `background-position` en bucle con un `box-shadow` de 22 px) y `backdrop-filter: blur()` en `:1637` y `:5624`.
  - Cambio propuesto: animar `opacity` o `transform` de un pseudo-elemento.
  - Esfuerzo: pequeño.

- **[Severidad: Baja] Otros**
  - Juegos: el `requestAnimationFrame` corre continuamente (`components/OfflineGames.tsx:98-104`).
  - Chat:
    - Los diff de Monaco de las tarjetas de herramienta se quedan montados (`components/Chat.tsx`, aprox. `:565-568` y `:645-647`, a confirmar el impacto).
    - Las listas de imágenes y de la cola usan el índice como `key`.
  - Lo que está bien: el streaming del chat ya agrupa por frame, `TurnView` está memoizado y `.turn` usa `content-visibility`, así que el chat largo funciona bien.

### 8. Seguridad visible

- **[Severidad: Alta] WhatsApp: un chat ajeno puede ordenar y aprobar**
  - Dónde: `components/WhatsApp.tsx:98-112`, `main/whatsapp.ts:435` y `:651`, `i18n.ts:225` (`waOthersHint`).
  - Problema: "+ Permitir {name}" y el interruptor activan el control de inmediato. Con `who: 'them'`, los mensajes de esa persona son órdenes para la IA y ella misma puede aprobarlas respondiendo "si".
  - Cambio propuesto: confirmación de peligro al permitir un chat ajeno o elegir "them" o "all", `'me'` por defecto, y que las órdenes ajenas solo se puedan aprobar desde la computadora o el celular emparejado.
  - Esfuerzo: medio.

- **[Severidad: Media] Valores de secretos visibles en texto plano**
  - Dónde: `components/VercelPanel.tsx:1003-1009` y `:1043-1048` (importar `.env`; el botón de `:1079` vuelca el archivo entero) y `components/SupabasePanel.tsx:1500-1505`.
  - Cambio propuesto: `input type="password"` con botón de ojo; en la importación, mostrar `KEY = ••••`.
  - Esfuerzo: pequeño.

- **[Severidad: Media] "Publicar en GitHub" prepara y sube todo sin mostrar qué se sube**
  - Dónde: `components/GitModals.tsx:250-254` (la opción "Público" está en `:307`).
  - Problema: sin `.gitignore` se suben `.env`, `*.pem` o `node_modules`. Si existe otro filtro en main está "a confirmar".
  - Cambio propuesto: listar los archivos antes de publicar, avisar de patrones sensibles y ofrecer crear un `.gitignore`.
  - Esfuerzo: medio.

- **[Severidad: Baja] La CSP del correo es implícita**
  - Dónde: `components/MailPanel.tsx:103-105`. El bloqueo de imágenes remotas depende de heredar `img-src` de `index.html:7`.
  - Cambio propuesto: declararla en el `srcDoc`:
    ```html
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'"
    />
    ```
    Y añadir un botón "Mostrar imágenes de este remitente".
  - Esfuerzo: pequeño.

- **[Severidad: Baja] El historial SQL de Supabase se guarda en claro en `localStorage`**
  - Dónde: `components/SupabasePanel.tsx:377-379`.
  - Cambio propuesto: no guardar las consultas de escritura y ofrecer "Borrar historial".
  - Esfuerzo: pequeño.

- **[Severidad: Baja] Los enlaces del Markdown no muestran su URL**
  - Dónde: `components/Markdown.tsx:272-279`.
  - Problema: el texto del enlace lo pone el modelo, así que puede ser engañoso.
  - Cambio propuesto: `title={url}` y confirmar si el dominio no coincide con el texto.
  - Esfuerzo: pequeño.

- **Lo que está bien:**
  - `Markdown.tsx` no usa `dangerouslySetInnerHTML`; solo enlaza https y main lo vuelve a validar (`main/main.ts:1565`).
  - El iframe del correo no tiene `allow-scripts` ni `allow-same-origin`.
  - El navegador va en un `WebContentsView` con sandbox y sin Node (`main/browser.ts:226-235`).
  - `phonePage.ts` construye todo con `textContent`, usa CSP con nonce y PIN con bloqueo.
  - `preload.ts` no expone un `invoke` genérico.
  - Las claves se piden con `type="password"` (`components/Modals.tsx:251-252` y `:567-568`, `components/Settings.tsx:288`).

## Revisión por componente

| Componente                              | Estado     | Nº de hallazgos | Nota breve                                                                        |
| --------------------------------------- | ---------- | --------------- | --------------------------------------------------------------------------------- |
| App.tsx                                 | mejorable  | 6               | Error de arrastre de los separadores, re-renders globales, límites de los paneles |
| Chrome.tsx                              | mejorable  | 5               | La barra de actividad se desborda; faltan `aria-pressed` y atajos visibles        |
| themes.ts                               | mal        | 3               | Faltan variables base; contraste por debajo de AA                                 |
| styles.css                              | mal        | 12              | Capa de rediseño duplicada, colores fijos, sin escala, foco débil                 |
| a11y.ts                                 | bien       | 0               | Correcto, pero poco usado (solo StatusBar, Welcome y Git)                         |
| keys.ts / commands.ts                   | mejorable  | 3               | Conflictos con Monaco y el terminal; Ctrl+\` en teclado ES                        |
| Chat.tsx                                | mejorable  | 10              | Pestañas sin teclado, sin `aria-live`, errores crudos, botones de envío           |
| ChatHistory.tsx                         | mejorable  | 2               | Acciones solo con hover; botón dentro de botón                                    |
| Markdown.tsx                            | bien       | 3               | Seguro; falta `danger` al ejecutar y un mensaje es incorrecto                     |
| ModelPicker.tsx                         | mejorable  | 4               | Esc parcial, columnas fijas, `aria-pressed`                                       |
| Plan.tsx                                | mejorable  | 4               | Modales sin Esc; onboarding mejorable                                             |
| Usage.tsx                               | mejorable  | 3               | El presupuesto se borra sin aviso; colores                                        |
| AccountSwitch.tsx                       | bien       | 1               | Confirmación de cierre de sesión a confirmar                                      |
| ProviderLogo.tsx / Icon.tsx / icons.tsx | bien       | 3               | Iconos duplicados; insignia TX repetida                                           |
| Editor.tsx                              | mejorable  | 2               | Pestañas sin teclado; "sin guardar" no se anuncia                                 |
| Explorer.tsx                            | mal        | 4               | Sin roles de árbol; menú sin teclado; errores silenciosos; sin virtualizar        |
| Search.tsx                              | mejorable  | 5               | Filtros tras el tope; reemplazar sin deshacer; O(n²)                              |
| SemanticSearch.tsx                      | mejorable  | 2               | Filas no enfocables; "archivos" cuenta fragmentos                                 |
| QuickPick.tsx                           | mejorable  | 1               | Sin combobox ni listbox                                                           |
| GitPanel.tsx                            | mal        | 5               | Acciones solo con hover; borrado forzado engañoso                                 |
| GitModals.tsx                           | mal        | 4               | Sin Esc; publica todo; diff sin límite                                            |
| RunPanel.tsx                            | mejorable  | 3               | Ejecuta scripts sin mostrarlos; reescaneo constante                               |
| Terminal.tsx                            | bien       | 2               | Sigue el tema; fuente fija; pestañas sin teclado                                  |
| WatchPanel.tsx                          | bien       | 1               | Unidades fuera de i18n                                                            |
| Scanner.tsx                             | mejorable  | 3               | Cerrar no detiene el escaneo; glifos                                              |
| OfflineGames.tsx                        | mejorable  | 3               | No se pausa; colores fijos; canvas sin nombre                                     |
| Settings.tsx                            | mejorable  | 6               | Sin Esc; se desborda a 600 px; idioma fuera de Ajustes                            |
| KnowledgeSettings.tsx                   | mejorable  | 3               | Borra sin confirmar; la edición se pierde al perder el foco                       |
| McpSettings.tsx                         | mejorable  | 3               | Confiar en `mcp.json` con un clic                                                 |
| SecurityCenter.tsx                      | mejorable  | 1               | Modal no accesible                                                                |
| SecuritySection.tsx                     | mal        | 5               | Español fijo; error de estado; colores                                            |
| Modals.tsx                              | mejorable  | 6               | Sin `role="dialog"`; borrar proveedor sin confirmación                            |
| ConfirmDialog.tsx                       | bien       | 2               | El mejor modal; falta foco en Cancelar cuando hay peligro                         |
| i18n.ts / i18nLsp.ts                    | bien / mal | 3               | Claves completas; `i18nLsp` sin uso                                               |
| Browser.tsx                             | bien       | 3               | Aislado; pestañas sin teclado; el botón de detener recarga                        |
| MailPanel.tsx                           | mejorable  | 4               | Error como "vacío"; CSP implícita; etiquetas                                      |
| SupabasePanel.tsx                       | mejorable  | 5               | SQL multi-sentencia; `prompt()` roto; secretos visibles                           |
| VercelPanel.tsx                         | mejorable  | 6               | Variable vacía; secretos visibles; textos en inglés                               |
| GCloudPanel.tsx                         | mejorable  | 4               | BigQuery sin confirmar; estados en crudo                                          |
| WhatsApp.tsx                            | mal        | 5               | Control ajeno sin confirmar; colores; etiquetas                                   |
| main/phonePage.ts                       | mejorable  | 3               | Segura; solo en español; redibujo completo                                        |
| preload/preload.ts                      | bien       | 0               | Canales tipados, sin `invoke` genérico                                            |

## Mejoras sugeridas (no son errores)

- **Un `<Modal>` y un `<Tabs>` comunes.** Con estos dos componentes se resuelve de una vez más de la mitad de los hallazgos de accesibilidad.
- **Prueba de temas.** Una prueba unitaria que recorra `themes.ts`, exija todas las variables base y calcule el contraste WCAG de los pares principales. Así se evita que vuelva a pasar lo de `--status-fg`.
- **Atajos visibles en los tooltips.** Mostrar el atajo en todos los tooltips de la barra de actividad y en las tarjetas del onboarding, tomándolo de `commands()`.
- **Menú "Más" en la barra de actividad.** Agrupar ahí las integraciones (Vercel, Supabase, GCloud, Correo, Watch) y dejar fijas solo las vistas principales.
- **Errores con acción.** Un componente común `ErrorState` con un mensaje claro y botones "Reintentar" y "Ver detalle", reutilizando `ErrorBox` de GCloud.
- **"Deshacer" en lugar de confirmar.** Para acciones reversibles (enviar correo, borrar memoria, cerrar pestaña de chat), un toast "Hecho · Deshacer" durante 5 s es menos intrusivo que un diálogo.
- **Selector "Idioma".** Añadirlo en Apariencia y ofrecer los comandos "/" en los dos idiomas.
- **Un único util de formato.** `formatUsd`, fechas y unidades con `Intl` y el idioma de la app.

## Lo que no se pudo revisar

- **La app no se ejecutó.** Windows Smart App Control bloquea en este equipo las compilaciones sin firmar, así que la revisión se basa solo en el código. Quedan "a confirmar" en ejecución:
  - el aspecto real de cada tema, pantalla por pantalla;
  - el comportamiento del arrastre de los separadores;
  - si los aceleradores del menú consumen las teclas antes que Monaco;
  - el comportamiento a 900×600 y en 4K;
  - la página del teléfono en un móvil real de 360 px.
- **Archivos en edición.** `Chat.tsx`, `styles.css` e `i18n.ts` tenían cambios sin commit y cambiaron durante la revisión. Algunas líneas de esos archivos pueden haberse desplazado; se indican como "aprox.".
- **Lectores de pantalla.** No se probaron con NVDA ni con Narrador; los hallazgos de ARIA se deducen del código.
- **Monaco y xterm.** No se revisó la accesibilidad interna de estas bibliotecas, solo cómo las integra la app.
- **Fuera del alcance.** No se revisaron `apps/desktop/release-google/` ni otros paquetes del monorepo.
