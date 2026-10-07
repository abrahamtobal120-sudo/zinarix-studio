# Architecture (Phase 1)

The Spanish document [docs/es/arquitectura.md](../es/arquitectura.md) is the reference; summary:

- `@omni/core` (`OmniCore`) is editor-independent and shared by the CLI now, and by Electron (Phase 2) and the web server (Phase 6) later. It owns config, the signed catalog, the key vault (OS keychain → AES-256-GCM/Argon2id file → env vars), live model discovery with a 24 h SQLite cache, `provider/model` routing with per-role assignment and a fallback chain, budgets, cost accounting, 100 % local mode, outgoing secret redaction, history and an audit log.
- `@omni/providers` holds one adapter per API family: `openai-compatible`, `openai-responses`, `anthropic`, `google-gemini`. Azure OpenAI v1, Cohere and Hugging Face reuse the OpenAI wire format; `aws-bedrock` lands in Phase 3. All HTTP goes through one client with auth from the catalog, timeouts, cancellation, exponential backoff, `Retry-After`, and redacted, normalized errors.
- `@omni/security` holds the opaque `Secret` type, which masks itself in every implicit conversion, a Gitleaks-style redactor, and a logger that redacts everything.
- Keys never reach logs, errors, history or terminal output. This is enforced by `tests/leak`, which drives the real CLI against a hostile server that echoes the key back.
