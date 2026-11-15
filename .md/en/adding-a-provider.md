# Adding a provider

- **OpenAI-compatible API**: add one entry to `catalog/providers.json` (see the schema in `packages/shared/src/schemas.ts`), then run `pnpm build && pnpm catalog:check && node scripts/sign-catalog.mjs sign`. No code needed. Never invent model IDs: copy them from the official docs, or set `status: "unverified"`.
- **User-private endpoint**: `omni providers add-custom --id my-vllm --base-url http://gpu:8000/v1 --no-auth --local`.
- **Different wire format**: implement `ProviderAdapter` in `packages/providers/src/adapters/`, register it in `ADAPTERS`, and test it with `tests/helpers/mock-server.ts`.

Full guide (Spanish): [docs/es/agregar-proveedor.md](../es/agregar-proveedor.md).
