# Entrega de la Fase 1 — Núcleo de IA y CLI

Fecha: 2026-10-06

## Qué se construyó

| Área              | Entregado                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo          | pnpm workspaces + Turborepo, TypeScript 6 `strict` + `noUncheckedIndexedAccess`, ESLint 9, Prettier, Vitest 4, CI en Linux/macOS/Windows                                                                                                                                                                                                                                                                                                 |
| `@omni/shared`    | Esquemas Zod (catálogo, modelos), tipos de chat normalizados (`ChatChunk` según la especificación), `OmniError` + códigos de salida, i18n es/en tipado                                                                                                                                                                                                                                                                                   |
| `@omni/security`  | `Secret` opaco, redactor (15 reglas tipo Gitleaks + valores exactos), logger JSON que redacta todo                                                                                                                                                                                                                                                                                                                                       |
| `@omni/providers` | Cliente HTTP: auth por catálogo, timeout, cancelación, backoff exponencial con jitter, `Retry-After`, errores normalizados y redactados. Parser SSE/NDJSON con timeout de inactividad. Adaptadores **openai-compatible** (+ FIM, embeddings), **openai-responses**, **anthropic** (adaptive thinking, caché de prompts, paginación de `/models`), **google-gemini**. Azure OpenAI v1, Cohere y Hugging Face reutilizan el wire de OpenAI |
| Catálogo          | 50 proveedores verificados contra documentación oficial el 2026-10-06 (40 activos, 7 sin verificar, 3 obsoletos), con firma Ed25519 y actualización en caliente                                                                                                                                                                                                                                                                          |
| `@omni/core`      | `OmniCore`: config validada, catálogo + proveedores personalizados, bóveda (keychain del SO → archivo cifrado AES-256-GCM/Argon2id → variables de entorno), descubrimiento de modelos con caché SQLite de 24 h, router `proveedor/modelo` con roles y cadena de fallback, presupuestos, cálculo de costo, modo 100 % local, redacción saliente, historial y auditoría                                                                    |
| CLI `omni`        | `auth add/list/remove/test`, `providers [show/add-custom]`, `models` (filtros), `use [--role]`, `ask` (stdin, `-f`, `--json`, streaming, razonamiento), `chat` (TUI Ink), `compare`, `usage`, `history list/search/export/delete`, `catalog info/update`, `config get/set/path`, `completion bash/zsh/fish/powershell`, `wipe`                                                                                                           |

## Criterios de aceptación

| Criterio                                                            | Estado                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `omni ask` responde en streaming con llaves reales de 3 proveedores | ⏳ **Requiere tus llaves.** El streaming está probado contra servidores simulados que reproducen el formato de cada familia. Para validarlo con llaves reales: `OMNI_LIVE_TESTS=1 ANTHROPIC_API_KEY=… OPENAI_API_KEY=… GROQ_API_KEY=… pnpm vitest run tests/live` |
| `omni models` lista modelos reales                                  | ⏳ Igual que arriba (la prueba en vivo también lo comprueba). Verificado con un servidor local compatible con OpenAI                                                                                                                                              |
| Ninguna llave aparece en los logs (prueba automatizada)             | ✅ `tests/leak/leak.test.ts`: la CLI real corre contra un servidor hostil que devuelve la llave; se revisan stdout, stderr, logs, SQLite y config                                                                                                                 |
| Cobertura ≥ 80 % en core, providers y security                      | ✅ core 86 % · providers 92 % · security 94 % (líneas)                                                                                                                                                                                                            |

## Cómo probar

```bash
pnpm install && pnpm build && pnpm test    # 78 pruebas
node apps/cli/dist/index.js providers
node apps/cli/dist/index.js auth add groq  # luego: models, use, ask, chat
```

## Proveedores que necesitan revisión

| Proveedor          | Estado        | Motivo                                                                                                      |
| ------------------ | ------------- | ----------------------------------------------------------------------------------------------------------- |
| `perplexity`       | obsoleto      | Sonar Chat Completions terminó el 2026-09-27; la nueva Agent API necesita adaptador propio                  |
| `github-models`    | obsoleto      | Retirado el 2026-07-30                                                                                      |
| `lambda-inference` | obsoleto      | La API de inferencia se está cerrando (anuncio de 2026-05-29)                                               |
| `replicate`        | sin verificar | Solo tiene API nativa `/v1/predictions` → necesita adaptador propio                                         |
| `ibm-watsonx-ai`   | sin verificar | `/ml/v1/text/chat` + `?version=` + token IAM → necesita adaptador propio                                    |
| `writer`           | sin verificar | `POST /v1/chat`, no `/chat/completions` → necesita adaptador propio                                         |
| `google-vertex`    | sin verificar | La URL OpenAI-compatible viene de fuentes de terceros; la autenticación es un token OAuth de corta duración |
| `hyperbolic`       | sin verificar | Las páginas de documentación no dieron detalles de la API                                                   |
| `moonshot`         | sin verificar | Los IDs de modelo se dedujeron de los nombres visibles                                                      |
| `01-ai`            | sin verificar | La API pública podría estar cerrada                                                                         |

Algunos datos de los proveedores activos vienen de conocimiento previo y no de la documentación consultada (rutas de `/models`, URLs de llaves, banderas de capacidades). En esos casos el campo `notes` de cada entrada lo indica.

## Deuda técnica / pendientes

1. **Adaptador `aws-bedrock`** (SigV4 + Converse) — Fase 3. Bedrock está en el catálogo, pero `providerConfig` lo rechaza con un mensaje claro.
2. **Gemini 3 + herramientas en varios turnos**: los `thoughtSignature` deben reenviarse. Hoy `ToolCall` no conserva metadatos del proveedor. Se necesita antes del modo agente (Fase 4).
3. **Redacción en streaming**: la salida se redacta por fragmento. Un secreto partido entre dos deltas del modelo no se detecta en la terminal. Lo que se envía al modelo, el historial y los logs sí se redactan completos.
4. **Google Vertex AI** necesita refrescar tokens OAuth (ADC). Hoy solo acepta un token estático.
5. **Formatos nuevos**: Writer, watsonx, Replicate y la Agent API de Perplexity necesitan adaptador.
6. **Precios**: solo se conocen cuando el proveedor los publica en `/models` (p. ej. OpenRouter) o el usuario los define (`omni config set prices.<p/m> '{"input":…,"output":…}'`). Falta una tabla de precios mantenida en el catálogo.
7. **Migraciones**: SQL versionado propio. Conviene evaluar Drizzle si el esquema crece en la Fase 3.
8. **Distribución de la CLI**: falta empaquetar como binario independiente (bun/pkg) y publicar en npm (Fase 7).
9. **Llave de firma del catálogo**: la privada se generó en `~/.omni-signing/catalog.key`. Para producción, muévela a un HSM o a un secreto de CI y rota la pública.
