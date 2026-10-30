# Perplexity AI

El proveedor `perplexity` usa la API de agentes mediante el adaptador
`openai-responses`, con base `https://api.perplexity.ai/v1`. La ruta
`/responses` es un alias oficial de `/agent`.

Configura tu llave desde la aplicación o con:

```sh
omni auth add perplexity
omni models --provider perplexity
```

También puedes proporcionar la credencial con `PERPLEXITY_API_KEY`.
Las llaves se crean en <https://console.perplexity.ai>.

El listado se consulta en `/models`; el catálogo incluye como respaldo
`perplexity/sonar` y `perplexity/nemotron-3.5-super-120b-a12b`.
Las capacidades dependen del modelo. Los precios del catálogo cubren tokens;
los cargos adicionales por búsquedas y herramientas del servidor no se incluyen.
Esta integración no expone las APIs separadas de búsqueda ni embeddings.

La API Sonar Chat Completions dejó de tener soporte el 27 de septiembre de 2026.
Documentación oficial:

- [Compatibilidad Responses](https://docs.perplexity.ai/docs/agent-api/openai-compatibility)
- [Modelos y precios](https://docs.perplexity.ai/docs/agent-api/models)
- [Migración desde Sonar](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview)

Tras modificar el catálogo hay que volver a firmarlo con la clave privada existente:

```sh
node scripts/sign-catalog.mjs sign
node scripts/sign-catalog.mjs verify
```

La ruta predeterminada es `~/.omni-signing/catalog.key`, configurable mediante
`OMNI_CATALOG_SIGNING_KEY`. Sin esa clave, la firma anterior no corresponde al
catálogo actualizado y no se puede publicar como actualización firmada.

Para instalar y validar el proyecto, usa Node 24.7 o superior y pnpm 12.9.1
(la versión indicada en `package.json`):

```sh
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm catalog:check
pnpm catalog:sign
node scripts/sign-catalog.mjs verify
pnpm test
```

La instalación requiere acceso a los servidores de descarga.

En esta copia se generó una nueva clave Ed25519 y se volvió a firmar el catálogo.
La clave privada está fuera del repositorio, en `~/.omni-signing/catalog.key`;
guarda una copia segura para futuras firmas. No la incluyas en Git ni en el instalador.
Esta rotación cambia la clave pública incluida: las instalaciones anteriores
necesitan actualizar la aplicación para aceptar catálogos firmados con la nueva clave.

Para generar un instalador Debian/Ubuntu con los cambios:

```sh
pnpm build
pnpm --filter @omni/desktop exec electron-builder --linux deb --publish never
sudo apt install ./apps/desktop/release/zinarix-studio_0.4.7_amd64.deb
```

El paquete `.deb` instalado previamente es una copia independiente del código
fuente: compilar el repositorio no actualiza esa instalación. Reinstala el nuevo
paquete, cierra la aplicación anterior y vuelve a abrirla.

