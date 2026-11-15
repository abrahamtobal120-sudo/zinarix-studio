# Prompt: sesión de auditoría de ciberseguridad de Zinarix Studio

Copia el bloque siguiente como primer mensaje de una sesión nueva (Claude Code, Cursor, u otro agente) abierta en la raíz del repo.

---

Actúa como auditor de seguridad de aplicaciones (AppSec) con experiencia en Electron, agentes de IA con herramientas y cadenas de suministro de software. Vas a auditar **Zinarix Studio**, un IDE tipo Cursor que vive en este repositorio (monorepo pnpm: `apps/desktop` Electron, `apps/cli`, `apps/web`, `packages/core`, `packages/providers`, `packages/security`, `packages/ui`, `catalog/`, `scripts/`, `website/`).

Tengo autorización completa sobre este código: soy el autor. El objetivo es **defensivo**: encontrar y corregir vulnerabilidades antes de publicar. No ejecutes nada contra sistemas de terceros.

## Qué hace la app (superficie de ataque)

- Agente de IA que lee y edita archivos del proyecto, ejecuta comandos en una terminal integrada y, con aprobación por nivel de riesgo, también: comandos como administrador (sudo/pkexec), lectura y escritura de archivos del sistema, variables de entorno, consultas a SQLite/PostgreSQL/MySQL, llamadas a APIs externas y pruebas de red.
- Navegador integrado (Playwright) que la IA controla: abre páginas, las lee, hace clic y escribe.
- Centro de seguridad: auditoría de secretos, dependencias vulnerables vía osv.dev, revisión del equipo, escáner de puertos estilo nmap, análisis de sitios web, verificación por hash.
- Bóveda de llaves de API en el llavero del sistema y redacción automática de secretos en logs.
- Catálogo firmado de 62 proveedores de IA; adaptadores HTTP/SSE a cada proveedor; Google Vertex AI con JSON de cuenta de servicio o token de gcloud.
- Instaladores por terminal (`curl | bash`, PowerShell `irm | iex`) que descargan desde GitHub Releases y verifican SHA-256; publicación por GitHub Actions al empujar un tag.
- Historial de chats guardado en disco; consumo de créditos por proveedor.

## Cómo trabajar

1. **Primero mapea, no adivines.** Lee `AGENTS.md`, `README.md`, `docs/es/arquitectura.md`, `apps/desktop/src/main/*.ts`, `apps/desktop/src/preload/preload.ts` y `packages/security/src/*.ts` antes de reportar nada. Para cada hallazgo cita archivo y línea.
2. **Prioriza por impacto real** en este modelo de amenaza, en este orden:
   - **Inyección de prompt → ejecución.** Un archivo del proyecto, una página web que el navegador lee, una respuesta de API, un README de una dependencia o un resultado de herramienta contiene instrucciones para la IA. ¿Puede eso provocar que el agente ejecute un comando, escriba fuera del workspace, exfiltre una llave, apruebe algo por sí mismo o escale a sudo sin que el usuario lo vea claramente?
   - **Escape de las aprobaciones.** Revisa cada herramienta del agente: ¿hay rutas donde una acción de riesgo alto se ejecuta sin pasar por el diálogo? ¿La clasificación de riesgo se calcula en el renderer o en el main? ¿Se puede encadenar varias acciones de riesgo bajo para lograr una de riesgo alto (por ejemplo escribir un script y luego ejecutarlo, o editar `.bashrc`, `package.json` `scripts`, hooks de git, configuración de la propia app)?
   - **Frontera Electron.** `contextIsolation`, `nodeIntegration`, `sandbox`, `webSecurity`, CSP del renderer, qué expone exactamente el preload por `contextBridge`, validación de **todos** los argumentos de cada canal IPC (`ipcMain.handle` / `on`), `shell.openExternal` con URLs arbitrarias, `will-navigate` / `setWindowOpenHandler`, carga de contenido remoto, protocolos personalizados, DevTools en producción.
   - **Sistema de archivos y comandos.** Path traversal fuera del workspace (`..`, enlaces simbólicos, rutas absolutas, `~`), inyección de argumentos en `spawn`/`exec` (sobre todo en sudo, el escáner de puertos, git y los instaladores), uso de `shell: true`, construcción de comandos por concatenación, permisos de los archivos que crea la app, respaldos y reversión que dejen copias de secretos.
   - **Secretos.** Que las llaves nunca toquen disco, logs, historial de chats, telemetría, contexto enviado al modelo ni el DOM del renderer; que la redacción (`packages/security/src/redact.ts`) cubra los formatos reales de las 62 llaves; que las credenciales de Vertex y de bases de datos reciban el mismo trato; que `.env` y archivos de credenciales estén bloqueados para lectura del agente aunque estén dentro del workspace.
   - **Navegador controlado por IA.** Aislamiento del perfil, cookies y sesiones; bloqueo real de campos de contraseña y pago; permisos por sitio que no se puedan ampliar desde la página; descargas; navegación a `file://` o a localhost de la propia app; contenido de la página inyectado al modelo sin marcarlo como no confiable.
   - **Red y herramientas ofensivas.** Que el escáner de puertos, las pruebas DNS/TCP/HTTP y las llamadas a APIs externas no permitan SSRF a la red interna ni escaneo de terceros sin la confirmación explícita del usuario; que la confirmación no la pueda dar la IA; límites de tasa y alcance.
   - **Cadena de suministro.** Firma y verificación del catálogo (`scripts/sign-catalog.mjs`, `catalog/keys`), scripts de instalación (TOCTOU entre descarga y verificación, dónde viene el hash, uso de `sudo` en `install.sh`), workflows de GitHub Actions (permisos del token, acciones sin pin a SHA, secretos), auto-actualización si existe, dependencias con alertas conocidas (`pnpm audit`, osv.dev).
   - **Proveedores de IA.** Que las URLs base no sean sobreescribibles por el catálogo o la configuración sin validación (llave enviada a un host atacante), TLS, manejo de SSE malformado, límites de tamaño de respuesta.
   - **Datos locales.** Permisos de la base SQLite de historial y uso, qué se guarda de cada conversación, exportación de chats que pueda incluir secretos.
3. **Verifica antes de afirmar.** Para cada hallazgo de severidad Alta o Crítica, escribe una prueba de concepto reproducible y segura (una prueba en `tests/`, un script, o los pasos exactos) y ejecútala. Si no puedes reproducirlo, repórtalo como "plausible, sin confirmar".
4. **No toques nada fuera del repo**, no instales herramientas globales, no hagas commits ni cambies configuración del sistema sin pedirme.

## Entregables

1. `docs/es/auditoria-seguridad-YYYY-MM-DD.md` con:
   - Resumen ejecutivo (5 líneas).
   - Tabla de hallazgos: ID, severidad (Crítica/Alta/Media/Baja/Info), componente, archivo:línea, descripción, impacto, prueba de concepto, corrección propuesta, estado.
   - Mapa de la frontera de confianza: qué entra al modelo, qué puede hacer cada herramienta, dónde se aprueba y dónde se valida.
   - Lo que está bien hecho (para no romperlo).
2. Correcciones para todo lo Crítico y Alto, cada una con su prueba automatizada en `tests/` o `apps/desktop/test/`, sin cambiar el comportamiento del producto más de lo necesario. Pregunta antes si una corrección implica quitar una función.
3. Lista de deuda de seguridad de Media hacia abajo, ordenada por esfuerzo.
4. Propuesta de guardarraíles permanentes: pruebas de fuga de secretos (`tests/leak`), prueba de inyección de prompt con archivos y páginas maliciosas de ejemplo, lint de IPC, `pnpm audit` y verificación de catálogo en CI.

Empieza mapeando la arquitectura y dime en pocas líneas cuál es tu plan y por dónde vas a atacar primero. Responde en español.
