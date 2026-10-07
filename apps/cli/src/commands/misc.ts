import { writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import { getPath, periodStart, setPath, updateCatalogFromUrl, usageSummary } from '@omni/core';
import type { Period } from '@omni/core';
import { OmniError, t } from '@omni/shared';
import { omni } from '../context.js';
import { c, errln, fmtTokens, fmtUsd, outln, printJson, table } from '../io.js';

export function registerMisc(program: Command): void {
  program
    .command('usage')
    .description('Tokens y costo por proveedor y modelo / usage and cost')
    .option('--day', 'hoy')
    .option('--month', 'este mes (por defecto)')
    .option('--all', 'todo el historial')
    .option('-p, --provider <id>', 'filtrar por proveedor')
    .option('--json', 'salida JSON')
    .action(
      (opts: {
        day?: boolean;
        month?: boolean;
        all?: boolean;
        provider?: string;
        json?: boolean;
      }) => {
        const core = omni();
        const period: Period = opts.day ? 'day' : opts.all ? 'all' : 'month';
        const rows = usageSummary(core.db, periodStart(period), opts.provider);
        if (opts.json) return printJson({ period, rows });
        if (!rows.length) return outln(t('usage.none'));
        const total = rows.reduce((s, r) => s + r.costUsd, 0);
        outln(
          table(
            rows.map((r) => [
              `${r.provider}/${r.model}`,
              String(r.requests),
              fmtTokens(r.inputTokens),
              fmtTokens(r.outputTokens),
              fmtUsd(r.costUsd) +
                (r.unpricedRequests ? c.dim(` (+${r.unpricedRequests} sin precio)`) : ''),
            ]),
            ['MODELO', 'PETICIONES', 'ENTRADA', 'SALIDA', 'COSTO'],
          ),
        );
        outln(c.bold(`\nTotal (${t(`usage.period.${period}`)}): ${fmtUsd(total)}`));
      },
    );

  const history = program
    .command('history')
    .description('Historial de conversaciones / conversation history');
  history
    .command('list')
    .option('-n, --limit <n>', 'cantidad', '20')
    .option('--json', 'salida JSON')
    .action((opts: { limit: string; json?: boolean }) => {
      const list = omni().history.list(Number(opts.limit));
      if (opts.json) return printJson(list);
      if (!list.length) return outln(t('history.none'));
      outln(
        table(
          list.map((h) => [
            h.id.slice(0, 8),
            new Date(h.updatedAt).toLocaleString(),
            h.model ?? '',
            h.title,
          ]),
          ['ID', 'FECHA', 'MODELO', 'TÍTULO'],
        ),
      );
    });
  history
    .command('search <query>')
    .option('--json', 'salida JSON')
    .action((query: string, opts: { json?: boolean }) => {
      const list = omni().history.search(query);
      if (opts.json) return printJson(list);
      if (!list.length) return outln(t('history.none'));
      outln(
        table(
          list.map((h) => [h.id.slice(0, 8), new Date(h.updatedAt).toLocaleString(), h.title]),
          ['ID', 'FECHA', 'TÍTULO'],
        ),
      );
    });
  history
    .command('export <id>')
    .option('--format <fmt>', 'md | json', 'md')
    .option('-o, --output <file>', 'archivo de salida')
    .action((id: string, opts: { format: string; output?: string }) => {
      const core = omni();
      const data =
        opts.format === 'json'
          ? JSON.stringify(core.history.get(id), null, 2)
          : core.history.exportMarkdown(id);
      if (!data || data === 'undefined') throw new OmniError('not_found', id);
      if (opts.output) writeFileSync(opts.output, data);
      else outln(data);
    });
  history.command('delete <id>').action((id: string) => {
    const core = omni();
    const conv = core.history.get(id);
    if (!conv) throw new OmniError('not_found', id);
    core.history.delete(conv.conversation.id);
  });

  const catalog = program
    .command('catalog')
    .description('Catálogo de proveedores / provider catalog');
  catalog.command('info').action(() => {
    const core = omni();
    const cat = core.catalog;
    const by = (s: string) => cat.catalog.providers.filter((p) => p.status === s).length;
    outln(
      `Origen: ${cat.source} · generado ${cat.catalog.generatedAt} · ${cat.catalog.providers.length} proveedores`,
    );
    outln(
      `Activos ${by('active')} · sin verificar ${by('unverified')} · obsoletos ${by('deprecated')} · personalizados ${core.config.customProviders.length}`,
    );
  });
  catalog
    .command('update <url>')
    .description('Descarga un catálogo firmado (Ed25519) sin reinstalar')
    .action(async (url: string) => {
      const core = omni();
      try {
        const cat = await updateCatalogFromUrl(url, core.paths);
        core.saveConfig();
        errln(c.green(t('catalog.updated', { count: cat.providers.length })));
      } catch (e) {
        if (e instanceof OmniError && /signature/.test(e.message))
          throw new OmniError('config', t('catalog.bad_signature'));
        throw e;
      }
    });

  const config = program
    .command('config')
    .description('Lee o cambia la configuración (sin llaves) / config');
  config.command('get [path]').action((path?: string) => {
    const cfg = omni().config;
    printJson(path ? getPath(cfg, path) : cfg);
  });
  config
    .command('set <path> <value>')
    .description(
      'ej. privacy.localOnly true · budgets.anthropic \'{"daily":5}\' · fallbacks \'["groq/x"]\'',
    )
    .action((path: string, value: string) => {
      const core = omni();
      core.saveConfig(setPath(core.config, path, value));
      if (path === 'privacy.localOnly')
        errln(
          t(core.config.privacy.localOnly ? 'privacy.local_only_on' : 'privacy.local_only_off'),
        );
    });
  config.command('path').action(() => outln(omni().paths.config));

  program
    .command('wipe')
    .description('Borra todas las llaves, historial, uso y caché / delete all keys and history')
    .option('--yes', 'confirmar')
    .action(async (opts: { yes?: boolean }) => {
      if (!opts.yes) {
        errln(t('wipe.confirm'));
        process.exitCode = 2;
        return;
      }
      const core = omni();
      await core.wipe();
      core.saveConfig({ ...core.config, providers: {} });
      errln(t('wipe.done'));
    });
}
