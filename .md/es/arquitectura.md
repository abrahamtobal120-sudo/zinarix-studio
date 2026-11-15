# Arquitectura (Fase 1)

```
        CLI `omni`            (Fase 2) Electron · (Fase 6) Web
            │ in-process                 │ IPC / HTTPS
            ▼                            ▼
┌──────────────────────────── @omni/core ────────────────────────────┐
│ OmniCore: config · catálogo firmado · bóveda · ModelService (caché) │
│ router proveedor/modelo + roles + fallback · presupuestos · costos  │
│ redacción de secretos saliente · historial · uso · auditoría        │
└──────────────┬──────────────────────────────────────────────────────┘
               ▼
       @omni/providers  — adaptadores por familia de API
       openai-compatible · openai-responses · anthropic · google-gemini
       (azure-openai, cohere, huggingface = wire OpenAI; aws-bedrock: Fase 3)
               ▼
       APIs de proveedores (nube) / runtimes locales (Ollama, vLLM, …)
```

## Decisiones

| Tema          | Decisión                                                                                           | Por qué                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Base del IDE  | Opción A: fork de Code-OSS (Fase 2)                                                                | Paridad real con VS Code desde el día 1; el núcleo de IA es independiente del editor |
| Clientes HTTP | `fetch` nativo, sin SDKs oficiales                                                                 | Normalización, redacción, reintentos y errores en un solo lugar; menos dependencias  |
| SQLite        | `node:sqlite` (Node ≥ 22.13)                                                                       | Sin compilación nativa (better-sqlite3 falla con rutas con espacios y en Node nuevo) |
| Migraciones   | SQL versionado, solo agregar (`packages/core/src/db.ts`)                                           | Simple y suficiente; Drizzle/Kysely se puede adoptar en Fase 3 si crece el esquema   |
| Llaves        | `@napi-rs/keyring` (keytar está archivado) → archivo AES-256-GCM + Argon2id → variables de entorno | Funciona en escritorio, servidores y CI                                              |
| i18n          | Diccionario tipado propio es/en                                                                    | Una traducción faltante es error de compilación; cero dependencias                   |
| Logger        | Propio, JSON lines, todo pasa por el redactor                                                      | Imposible escribir una llave a disco/terminal por logging                            |

## Flujo de una petición (`OmniCore.stream`)

1. Resuelve el modelo: `-m` → rol (`roles.commit`, …) → `defaultModel`.
2. Redacta secretos en mensajes de usuario/sistema/herramienta (reglas tipo Gitleaks + valores exactos de llaves cargadas) y avisa.
3. Revisa presupuesto (aviso ≥ 80 %, bloqueo al 100 % si `hardStop`).
4. Construye `ProviderConfig`: URL base con `{placeholders}`, llave desde la bóveda, modo 100 % local.
5. El adaptador transmite `ChatChunk` normalizados (`text`, `reasoning`, `tool_call`, `usage`, `done`).
6. Si falla **antes del primer token** con error reintetable → siguiente modelo de `fallbacks`.
7. Calcula costo (precio del proveedor → catálogo → override del usuario), registra uso y auditoría (sin contenido).

## Seguridad de llaves (defensa en profundidad)

- `Secret`: `toString`/`toJSON`/`util.inspect` devuelven `sk-…a9F2`; solo `reveal()` da el valor, y solo `applyAuth` lo llama.
- Todo valor cargado se registra en el redactor; toda salida de la CLI, logs, errores e historial pasa por él.
- Errores del proveedor se resumen y redactan antes de crear `OmniError`.
- Prueba canario (`tests/leak`): servidor hostil que devuelve la llave en listas de modelos, texto y errores; se escanean stdout, stderr, logs, SQLite y config.
- Contenido externo (archivos, stdin) va en `<untrusted>` con instrucción de sistema para no obedecerlo (prompt injection).

## Catálogo

`catalog/providers.json` valida con Zod al cargar. Actualizaciones en caliente: `omni catalog update <url>` descarga `providers.json` + `.sig`, verifica Ed25519 contra `catalog/keys/catalog.pub` y lo guarda en `~/.omni/catalog/`. Si la firma deja de verificar (archivo alterado), se usa el catálogo empaquetado.
