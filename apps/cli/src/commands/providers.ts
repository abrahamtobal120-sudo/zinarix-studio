import type { Command } from 'commander';
import { CatalogEntry, OmniError, t } from '@omni/shared';
import type { AuthSpec } from '@omni/shared';
import { omni } from '../context.js';
import {
  c,
  collect,
  collectKv,
  errln,
  outln,
  printJson,
  readHidden,
  readStdin,
  table,
} from '../io.js';

/** Header names that usually carry credentials. */
export function isSensitiveHeader(name: string): boolean {
  return (
    /^(authorization|proxy-authorization|cookie)$/i.test(name) ||
    /(api[-_]?key|token|secret|passw(or)?d|auth|session|signature)/i.test(name) ||
    /(^|[-_])key$/i.test(name)
  );
}

/** Parses `Name: value` or `Name=value` lines (blank lines and `#` comments ignored). */
export function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([^:=\s]+)\s*[:=]\s*(.*)$/.exec(line);
    if (!m) throw new OmniError('config', `--header-stdin: expected "Name: value", got "${line}"`);
    out[m[1]!] = m[2]!;
  }
  return out;
}

/**
 * Picks the header that carries the API key so it can live in the keychain/vault instead
 * of config.json: the one named by --auth-header, or the only sensitive header given.
 * `Authorization: Bearer x` becomes bearer auth; anything else is sent as-is.
 */
export function splitKeyHeader(
  headers: Record<string, string>,
  authHeader?: string,
): { auth: AuthSpec; key?: string; rest: Record<string, string> } {
  const sensitive = Object.keys(headers).filter(isSensitiveHeader);
  const name = authHeader
    ? Object.keys(headers).find((h) => h.toLowerCase() === authHeader.toLowerCase())
    : sensitive.length === 1
      ? sensitive[0]
      : undefined;
  if (!name) {
    return {
      auth: authHeader
        ? { type: 'header', header: authHeader }
        : { type: 'bearer', header: 'Authorization' },
      rest: headers,
    };
  }
  const { [name]: value = '', ...rest } = headers;
  const bearer = /^bearer\s+(.+)$/i.exec(value);
  return bearer && name.toLowerCase() === 'authorization'
    ? { auth: { type: 'bearer', header: name }, key: bearer[1]!.trim(), rest }
    : { auth: { type: 'header', header: name }, key: value, rest };
}

export function registerProviders(program: Command): void {
  const providers = program
    .command('providers')
    .description('Lista el catálogo de proveedores / list the provider catalog')
    .option('--json', 'salida JSON')
    .option('--category <cat>', 'lab | aggregator | enterprise | asia | local | custom')
    .action(async (opts: { json?: boolean; category?: string }) => {
      const core = omni();
      const connected = new Set((await core.connectedProviders()).map((p) => p.id));
      const list = core.providers().filter((p) => !opts.category || p.category === opts.category);
      if (opts.json) return printJson(list.map((p) => ({ ...p, connected: connected.has(p.id) })));
      const status = (s: string) =>
        s === 'active' ? c.green(s) : s === 'deprecated' ? c.red(s) : c.yellow(s);
      outln(
        table(
          list.map((p) => [
            connected.has(p.id) ? c.green('●') : c.dim('○'),
            p.id,
            p.name,
            p.category,
            p.adapter,
            status(p.status),
            p.verifiedAt ?? '–',
          ]),
          ['', 'ID', 'NOMBRE', 'CATEGORÍA', 'ADAPTADOR', 'ESTADO', 'VERIFICADO'],
        ),
      );
      outln(
        c.dim(
          `\n${list.length} proveedores · catálogo ${core.catalog.source} (${core.catalog.catalog.generatedAt})`,
        ),
      );
    });

  providers
    .command('show <provider>')
    .description('Detalles de un proveedor')
    .action((id: string) => {
      const p = omni().catalog.providers.get(id);
      if (!p) throw new OmniError('config', t('provider.unknown', { provider: id }));
      printJson(p);
    });

  providers
    .command('add-custom')
    .description('Agrega un endpoint personalizado compatible con OpenAI')
    .requiredOption('--id <id>', 'identificador kebab-case')
    .requiredOption('--base-url <url>', 'URL base, ej. https://mi-servidor/v1')
    .option('--name <name>', 'nombre visible')
    .option(
      '--header <k=v>',
      'header adicional no secreto (repetible; queda en el historial del shell)',
      collectKv,
      {},
    )
    .option('--header-stdin', 'lee headers "Nombre: valor" desde stdin (uno por línea)')
    .option(
      '--header-prompt <name>',
      'pide el valor de ese header sin mostrarlo (repetible)',
      collect,
      [],
    )
    .option(
      '--auth-header <name>',
      'header donde va la llave (ej. x-api-key) en vez de Authorization: Bearer',
    )
    .option('--file-vault', 'guardar la llave en ~/.omni/vault.enc en lugar del keychain')
    .option('--models-endpoint <path>', 'ruta para listar modelos', '/models')
    .option('--no-auth', 'el endpoint no requiere llave')
    .option('--local', 'el endpoint corre en esta máquina o red privada')
    .action(
      async (opts: {
        id: string;
        baseUrl: string;
        name?: string;
        header: Record<string, string>;
        headerStdin?: boolean;
        headerPrompt: string[];
        authHeader?: string;
        fileVault?: boolean;
        modelsEndpoint: string;
        auth: boolean;
        local?: boolean;
      }) => {
        const core = omni();
        // Never let a custom endpoint take over a catalog provider's id (and its key).
        const isCustom = core.config.customProviders.some((p) => p.id === opts.id);
        if (core.catalog.providers.has(opts.id) && !isCustom)
          throw new OmniError(
            'config',
            `"${opts.id}" ya existe en el catálogo; usa otro --id para el endpoint personalizado`,
          );

        const argvSecrets = Object.keys(opts.header).filter(isSensitiveHeader);
        if (argvSecrets.length)
          errln(
            c.yellow(
              `! ${argvSecrets.join(', ')}: los valores pasados con --header quedan en el historial del shell y en la lista de procesos. Usa --header-prompt, --header-stdin o --auth-header + omni auth add.`,
            ),
          );
        let headers = { ...opts.header };
        if (opts.headerStdin) headers = { ...headers, ...parseHeaderLines(await readStdin()) };
        for (const name of opts.headerPrompt) {
          const value = (
            await readHidden(
              `Valor del header ${name} (no se mostrará): `,
              'stdin is not a TTY: use --header-stdin to pipe header values',
            )
          ).trim();
          if (!value) throw new OmniError('config', `el header ${name} está vacío`);
          headers[name] = value;
        }

        // The key header (if any) goes to the keychain/vault, never to config.json.
        const split = opts.auth
          ? splitKeyHeader(headers, opts.authHeader)
          : { auth: { type: 'none', optional: true } as AuthSpec, rest: headers };
        const plain = Object.keys(split.rest).filter(isSensitiveHeader);
        if (plain.length)
          errln(
            c.yellow(
              `! ${plain.join(', ')}: se guarda sin cifrar en ~/.omni/config.json (solo la llave del proveedor va al keychain).`,
            ),
          );

        const entry = CatalogEntry.parse({
          id: opts.id,
          name: opts.name ?? opts.id,
          adapter: 'openai-compatible',
          baseUrl: opts.baseUrl.replace(/\/+$/, ''),
          auth: split.auth,
          extraHeaders: Object.keys(split.rest).length ? split.rest : undefined,
          region: opts.local ? 'local' : 'global',
          category: opts.local ? 'local' : 'custom',
          modelsEndpoint: opts.modelsEndpoint,
          supports: {
            listModels: true,
            streaming: true,
            tools: true,
            vision: false,
            jsonMode: true,
            embeddings: false,
            fim: false,
          },
          status: 'active',
          verifiedAt: null,
          notes: 'user-defined endpoint',
        });
        let keyStore: 'file' | 'keychain' | undefined;
        if ('key' in split && split.key) {
          const store = await core.vault.set(
            entry.id,
            split.key,
            opts.fileVault ? 'file' : undefined,
          );
          if (store === 'file' && !opts.fileVault) errln(c.yellow(t('vault.keychain_unavailable')));
          keyStore = store === 'file' ? 'file' : 'keychain';
        }
        const others = core.config.customProviders.filter((p) => p.id !== entry.id);
        const prev = core.config.providers[entry.id];
        core.saveConfig({
          ...core.config,
          customProviders: [...others, entry],
          providers: keyStore
            ? {
                ...core.config.providers,
                [entry.id]: { params: {}, headers: {}, ...prev, keyStore },
              }
            : core.config.providers,
        });
        errln(c.green(t('provider.custom_added', { provider: entry.id })));
        if (keyStore)
          errln(
            c.green(
              t('auth.saved', {
                provider: entry.name,
                store: keyStore === 'keychain' ? 'keychain' : '~/.omni/vault.enc',
              }),
            ),
          );
        else
          errln(
            c.dim(
              opts.auth
                ? `omni auth add ${entry.id}`
                : `omni auth add ${entry.id}  (registra el endpoint sin llave)`,
            ),
          );
      },
    );
}
