# Cómo agregar un proveedor

## A) Compatible con OpenAI → solo catálogo, sin código

Agrega una entrada a `catalog/providers.json`:

```json
{
  "id": "mi-proveedor",
  "name": "Mi Proveedor",
  "adapter": "openai-compatible",
  "baseUrl": "https://api.mi-proveedor.com/v1",
  "baseUrlParams": [],
  "auth": { "type": "bearer", "header": "Authorization" },
  "envVars": ["MI_PROVEEDOR_API_KEY"],
  "docsUrl": "https://docs.mi-proveedor.com",
  "keyUrl": "https://mi-proveedor.com/keys",
  "region": "us",
  "category": "aggregator",
  "modelsEndpoint": "/models",
  "supports": {
    "listModels": true,
    "streaming": true,
    "tools": true,
    "vision": false,
    "jsonMode": true,
    "embeddings": false,
    "fim": false
  },
  "fallbackModels": [
    { "id": "<id-exacto-de-la-documentación>", "label": "Modelo", "context": 131072 }
  ],
  "status": "active",
  "verifiedAt": "AAAA-MM-DD",
  "notes": ""
}
```

- URL con datos del usuario: usa `{placeholder}` y decláralo en `baseUrlParams` (`omni auth add x --param account_id=…`).
- Autenticación: `bearer` · `header` (p. ej. `api-key`, `x-api-key`) · `query` (`queryParam`) · `none` (+ `"optional": true` si acepta llave opcional).
- **Nunca inventes IDs de modelos**: copia los de la documentación oficial; si no puedes verificar, `status: "unverified"`.

Luego:

```bash
pnpm build && pnpm catalog:check
node scripts/sign-catalog.mjs sign      # requiere la llave privada (~/.omni-signing/catalog.key)
pnpm test
```

Para distribuir sin reinstalar: publica `providers.json` y `providers.json.sig` en HTTPS y ejecuta `omni catalog update <url>`.

## B) Endpoint privado del usuario (sin tocar el repo)

```bash
omni providers add-custom --id mi-vllm --base-url http://gpu-01:8000/v1 --no-auth --local
omni auth add mi-vllm
```

## C) API con otro formato → adaptador nuevo

1. Crea `packages/providers/src/adapters/<familia>.ts` implementando `ProviderAdapter` (`listModels`, `chat` como `AsyncIterable<ChatChunk>`, `testConnection`; opcionales `complete`, `embed`).
2. Usa `request()`/`requestJson()` de `http.ts` (auth, reintentos, Retry-After, timeout, errores redactados) y `parseSse()`.
3. Regístralo en `ADAPTERS` (`packages/providers/src/index.ts`) y agrega el id a `AdapterId` (`packages/shared/src/schemas.ts`).
4. Pruebas con `tests/helpers/mock-server.ts`: streaming de texto, herramientas, uso, errores 401/429 y listado de modelos.
