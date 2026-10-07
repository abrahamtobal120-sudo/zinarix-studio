import type { Command } from 'commander';
import { CatalogEntry, OmniError, t } from '@omni/shared';
import { omni } from '../context.js';
import { c, collectKv, errln, outln, printJson, table } from '../io.js';

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
    .option('--header <k=v>', 'header adicional (repetible)', collectKv, {})
    .option('--models-endpoint <path>', 'ruta para listar modelos', '/models')
    .option('--no-auth', 'el endpoint no requiere llave')
    .option('--local', 'el endpoint corre en esta máquina o red privada')
    .action(
      (opts: {
        id: string;
        baseUrl: string;
        name?: string;
        header: Record<string, string>;
        modelsEndpoint: string;
        auth: boolean;
        local?: boolean;
      }) => {
        const core = omni();
        const entry = CatalogEntry.parse({
          id: opts.id,
          name: opts.name ?? opts.id,
          adapter: 'openai-compatible',
          baseUrl: opts.baseUrl.replace(/\/+$/, ''),
          auth: opts.auth
            ? { type: 'bearer', header: 'Authorization' }
            : { type: 'none', optional: true },
          extraHeaders: Object.keys(opts.header).length ? opts.header : undefined,
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
        const others = core.config.customProviders.filter((p) => p.id !== entry.id);
        core.saveConfig({ ...core.config, customProviders: [...others, entry] });
        errln(c.green(t('provider.custom_added', { provider: entry.id })));
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
