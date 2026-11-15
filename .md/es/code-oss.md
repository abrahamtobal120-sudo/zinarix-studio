# Base Code - OSS

> Ahora se recomienda la base VSCodium: ver [vscodium.md](vscodium.md).

La base descargada vive en `vendor/vscode-main`. Es una base experimental separada del escritorio actual; los proveedores, agentes, navegador e integraciones de `apps/desktop` todavia no estan conectados al workbench de VS Code.

## Preparar en Windows

Desde la raiz del proyecto:

```powershell
pnpm code:prepare
pnpm code:status
```

La preparacion extrae `~/Downloads/vscode-main.zip` si falta la fuente y aplica `config/code-oss/product.json` conservando los demas campos originales, las licencias y los avisos de Microsoft. Para otro ZIP usa `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/code-oss.ps1 prepare -Archive C:\ruta\vscode-main.zip`. El ZIP debe contener la carpeta `vscode-main`.

La fuente descargada no se incluye en Git ni se agrega al workspace pnpm de Zinarix. Para reproducir exactamente esta base, conserva el ZIP original: una descarga futura de `main` puede contener otra version. La personalizacion y los comandos si quedan versionados.

## Compilar y abrir

Consulta `.nvmrc`, `package.json`, `AGENTS.md` y `.github/copilot-instructions.md` de la fuente para sus requisitos concretos. La descarga actual indica Node **24.22.1** (o posterior en la rama 24) y **pnpm 12.16.0**. En Windows tambien necesita las herramientas C++ de Visual Studio para compilar dependencias nativas. Node 26 no pasa la comprobacion del upstream.

Despues de seleccionar la version requerida de Node:

```powershell
pnpm code:install
pnpm code:build
pnpm code:start
```

Los comandos se ejecutan dentro de la fuente, usando su propio manifiesto, lockfile y dependencias. El lanzamiento usa `scripts/code.bat` del upstream. La preparacion no instala dependencias ni compila. El nombre, protocolo, identificadores de instalacion y carpeta de datos son independientes del escritorio actual. Los iconos originales todavia requieren sustitucion antes de distribuir esta variante.

## Continuar la migracion

El siguiente trabajo es conectar `packages/providers`, `packages/core` y `packages/security` mediante una extension o servicios del workbench, adaptar la interfaz de chat y sus aprobaciones, y verificar un flujo completo de agente. El escritorio actual sigue disponible con `pnpm desktop`. Agregar la fuente no completa esa migracion ni habilita por si solo el Marketplace de Microsoft.

## Plan de migracion por etapas

Objetivo: usar Code - OSS como base del IDE y conservar las funciones propias de Zinarix: proveedores de IA, agentes, navegador e integraciones. Este plan documenta trabajo pendiente; no implica que esas funciones ya esten conectadas.

1. **Base experimental.** Preparar, compilar y abrir la variante separada con la identidad de Zinarix. Registrar la revision exacta del upstream y los requisitos de compilacion para poder reproducirla.
2. **Nucleo reutilizable.** Adaptar `packages/providers`, `packages/core` y `packages/security`. Evaluar primero una extension para integrar modelos, chat y herramientas; reservar los cambios al workbench para funciones que realmente los necesiten.
3. **Flujo completo del agente.** Abrir un proyecto, elegir un modelo, conversar, proponer una edicion, mostrar diferencias, solicitar aprobacion, aplicar o revertir cambios y utilizar la terminal. Comprobar que se conservan los controles de permisos y el manejo seguro de credenciales.
4. **Funciones propias.** Incorporar navegador, integraciones, consumo de creditos y las demas funciones del escritorio. Registrar cuales estan listas y cuales siguen pendientes antes de ofrecer la nueva variante como reemplazo.
5. **Cambio de base.** Sustituir el escritorio actual cuando la variante complete los flujos necesarios y tenga instaladores, actualizaciones y una ruta de migracion de configuracion y credenciales verificados.

### Criterios para adoptar la nueva base

- El flujo de proyecto, chat, aprobacion, edicion y terminal funciona de principio a fin.
- Las funciones migradas mantienen las aprobaciones y protecciones de credenciales de Zinarix.
- Las extensiones necesarias se prueban con una fuente de distribucion y licencias compatibles; no se presupone acceso al Marketplace de Microsoft.
- La identidad visual, los iconos, las licencias y los avisos estan revisados antes de distribuir instaladores.
- Existe un procedimiento reproducible para incorporar actualizaciones de Code - OSS y comprobar que las funciones de Zinarix siguen funcionando.

Referencias del proyecto upstream: [codigo fuente de VS Code](https://github.com/microsoft/vscode) y [preguntas frecuentes de VS Code](https://code.visualstudio.com/docs/supporting/faq).
