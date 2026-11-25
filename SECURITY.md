# Seguridad

## Cómo reportar una vulnerabilidad

No abras un issue público. Usa el reporte privado de GitHub:
**Security → Report a vulnerability** en
<https://github.com/abrahamtobal120-sudo/zinarix-studio/security/advisories/new>.

Incluye la versión de la app, el sistema operativo, los pasos para reproducirlo y
qué puede hacer un atacante con el fallo. Si tienes una prueba de concepto, adjúntala.

Respondemos en un máximo de 7 días y avisamos cuando la corrección esté publicada. Si quieres
aparecer en las notas de la versión, dínoslo.

## Versiones con soporte

Solo la última versión publicada recibe correcciones de seguridad. La app se actualiza sola;
si la desactivaste, descarga la última desde la página de versiones.

## Qué entra

- La app de escritorio (`apps/desktop`), el CLI `omni` (`apps/cli`) y los paquetes de `packages/`.
- La app de control remoto del celular y su servidor en la PC.
- El sitio y sus funciones (`website/`): licencias y configuración remota.

No entran los proveedores de IA, los servidores MCP de terceros ni los programas externos que
la app abre (Blender, Godot, Docker…), salvo que el fallo esté en cómo Zinarix los usa.

## Qué ya está pensado

El modelo de amenazas y las protecciones actuales (aislamiento de ventanas, validación del IPC,
aprobación de acciones, llavero del sistema, contenido no confiable marcado) están descritos en
`README-ESTUDIO.md`, sección 4. Un reporte que muestre cómo saltarse cualquiera de ellas es
especialmente útil.
