import type { Command } from 'commander';
import { ExitCode, OmniError, errorCodeForStatus, t } from '@omni/shared';
import type { OmniErrorCode } from '@omni/shared';
import { maskKey } from '@omni/security';
import { omni } from '../context.js';
import { c, collectKv, errln, outln, printJson, readHidden, readStdin, table } from '../io.js';

/**
 * Exit code for a failed connection test: 3 only when the provider rejected the key
 * (401/403), 4 on rate limit, 1 for anything else (network, timeout, server error, key
 * that cannot be verified), so scripts can tell "bad key" from "provider unreachable".
 */
export function connectionFailureExitCode(r: {
  error?: string;
  code?: OmniErrorCode;
  unverified?: boolean;
}): number {
  if (r.unverified) return ExitCode.error;
  // `code` is used when the adapter reports it; otherwise it is read from the
  // "HTTP <status>: …" prefix every provider error message carries.
  const status = /^HTTP (\d{3})\b/.exec(r.error ?? '')?.[1];
  const code = r.code ?? (status ? errorCodeForStatus(Number(status)) : undefined);
  if (code === 'auth') return ExitCode.auth;
  if (code === 'rate_limit') return ExitCode.rateLimit;
  return ExitCode.error;
}

export function registerAuth(program: Command): void {
  const auth = program
    .command('auth')
    .description('Gestiona API keys de proveedores / manage provider API keys');

  auth
    .command('add <provider>')
    .description('Guarda la llave de un proveedor (entrada oculta) y prueba la conexión')
    .option('--key-stdin', 'lee la llave desde stdin (CI, scripts)')
    .option(
      '--param <k=v>',
      'valor para la URL base, ej. account_id=123 (repetible)',
      collectKv,
      {},
    )
    .option('--base-url <url>', 'sobrescribe la URL base del catálogo')
    .option('--file-vault', 'guardar en ~/.omni/vault.enc en lugar del keychain')
    .option('--no-test', 'no probar la conexión')
    .action(
      async (
        id: string,
        opts: {
          keyStdin?: boolean;
          param: Record<string, string>;
          baseUrl?: string;
          fileVault?: boolean;
          test: boolean;
        },
      ) => {
        const core = omni();
        const entry = core.catalog.providers.get(id);
        if (!entry) throw new OmniError('config', t('provider.unknown', { provider: id }));
        if (entry.status === 'deprecated')
          errln(
            c.yellow(t('provider.deprecated', { provider: entry.name, notes: entry.notes ?? '' })),
          );

        // Read and store the key first: the provider is only written to config.json once
        // there is a key (or it needs none), so cancelling leaves nothing behind.
        let keyStore: 'file' | 'keychain' | undefined;
        if (core.needsKey(entry) || opts.keyStdin) {
          if (entry.keyUrl && !opts.keyStdin)
            errln(c.dim(t('auth.get_key', { url: entry.keyUrl })));
          const key = (
            opts.keyStdin
              ? await readStdin()
              : await readHidden(t('auth.prompt', { provider: entry.name }))
          ).trim();
          if (!key) throw new OmniError('config', t('auth.empty'));
          const store = await core.vault.set(id, key, opts.fileVault ? 'file' : undefined);
          if (store === 'file' && !opts.fileVault) errln(c.yellow(t('vault.keychain_unavailable')));
          keyStore = store === 'file' ? 'file' : 'keychain';
        }

        const prev = core.config.providers[id];
        const nextKeyStore = keyStore ?? prev?.keyStore;
        core.saveConfig({
          ...core.config,
          providers: {
            ...core.config.providers,
            [id]: {
              params: { ...prev?.params, ...opts.param },
              headers: prev?.headers ?? {},
              ...(opts.baseUrl
                ? { baseUrl: opts.baseUrl }
                : prev?.baseUrl
                  ? { baseUrl: prev.baseUrl }
                  : {}),
              ...(nextKeyStore ? { keyStore: nextKeyStore } : {}),
            },
          },
        });

        if (keyStore) {
          errln(
            c.green(
              t('auth.saved', {
                provider: entry.name,
                store: keyStore === 'keychain' ? 'keychain' : '~/.omni/vault.enc',
              }),
            ),
          );
        } else {
          errln(t('auth.no_key_needed', { provider: entry.name }));
        }

        if (opts.test) {
          errln(c.dim(t('auth.testing', { provider: entry.name })));
          const r = await core.testConnection(id);
          if (r.ok) {
            errln(
              c.green(
                `✓ ${t('auth.test_ok', { provider: entry.name })}${r.models !== undefined ? ` (${r.models} modelos)` : ''}`,
              ),
            );
            core.models.invalidate(id);
          } else {
            errln(c.red(`✗ ${t('auth.test_fail', { detail: r.error ?? '' })}`));
            process.exitCode = connectionFailureExitCode(r);
          }
        }
      },
    );

  auth
    .command('list')
    .description('Proveedores conectados (llaves enmascaradas)')
    .option('--json', 'salida JSON')
    .action(async (opts: { json?: boolean }) => {
      const core = omni();
      const connected = await core.connectedProviders();
      const rows = await Promise.all(
        connected.map(async ({ id, store }) => {
          const k = await core.vault.get(id);
          return {
            id,
            name: core.catalog.providers.get(id)?.name ?? id,
            store,
            key: k ? maskKey(k.secret.reveal()) : '–',
          };
        }),
      );
      if (opts.json) return printJson(rows);
      if (!rows.length) return outln(t('auth.none'));
      outln(
        table(
          rows.map((r) => [r.id, r.name, r.store, r.key]),
          ['PROVEEDOR', 'NOMBRE', 'ORIGEN', 'LLAVE'],
        ),
      );
    });

  auth
    .command('remove <provider>')
    .alias('rm')
    .description('Elimina la llave de un proveedor')
    .action(async (id: string) => {
      const core = omni();
      await core.vault.delete(id);
      const { [id]: _removed, ...rest } = core.config.providers;
      core.saveConfig({ ...core.config, providers: rest });
      core.models.invalidate(id);
      errln(t('auth.removed', { provider: id }));
    });

  auth
    .command('test <provider>')
    .description(
      'Prueba la conexión con un proveedor (salida 3: llave rechazada; 1: red, servidor o no verificable)',
    )
    .action(async (id: string) => {
      const r = await omni().testConnection(id);
      if (r.ok) errln(c.green(`✓ ${t('auth.test_ok', { provider: id })}`));
      else {
        errln(c.red(`✗ ${t('auth.test_fail', { detail: r.error ?? '' })}`));
        process.exitCode = connectionFailureExitCode(r);
      }
    });
}
