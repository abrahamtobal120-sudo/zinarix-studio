import type { Command } from 'commander';
import { filterModels } from '@omni/core';
import type { ModelInfo } from '@omni/shared';
import { t } from '@omni/shared';
import { omni } from '../context.js';
import { c, errln, fmtPrice, fmtTokens, outln, printJson, table } from '../io.js';

interface ModelsOpts {
  provider?: string;
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  minContext?: string;
  maxPrice?: string;
  search?: string;
  all?: boolean;
  refresh?: boolean;
  json?: boolean;
}

export function badges(m: ModelInfo): string {
  const b: string[] = [];
  if (m.capabilities.tools) b.push('🛠');
  if (m.capabilities.vision) b.push('👁');
  if (m.capabilities.reasoning) b.push('🧠');
  if (m.capabilities.fim) b.push('⇥');
  return b.join(' ');
}

export function registerModels(program: Command): void {
  program
    .command('models')
    .description('Lista modelos en vivo de los proveedores conectados / list live models')
    .option('-p, --provider <id>', 'solo este proveedor')
    .option('--tools', 'con soporte de herramientas')
    .option('--vision', 'con visión')
    .option('--reasoning', 'con razonamiento')
    .option('--min-context <n>', 'contexto mínimo en tokens')
    .option('--max-price <usd>', 'precio de entrada máximo por 1M tokens')
    .option('-s, --search <text>', 'búsqueda por nombre')
    .option('--all', 'incluir embeddings, audio, imagen, etc.')
    .option('--refresh', 'ignorar la caché de 24 h')
    .option('--json', 'salida JSON')
    .action(async (opts: ModelsOpts) => {
      const core = omni();
      const ids = opts.provider
        ? [opts.provider]
        : (await core.connectedProviders()).map((p) => p.id);
      if (!ids.length) return errln(t('auth.none'));
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            return await core.models.list(await core.providerConfig(id), { refresh: opts.refresh });
          } catch (e) {
            return {
              provider: id,
              models: [] as ModelInfo[],
              cached: false,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }),
      );
      const all: ModelInfo[] = [];
      for (const r of results) {
        if (r.error)
          errln(c.yellow(t('models.fetch_failed', { provider: r.provider, detail: r.error })));
        all.push(
          ...filterModels(r.models, {
            tools: opts.tools,
            vision: opts.vision,
            reasoning: opts.reasoning,
            minContext: opts.minContext ? Number(opts.minContext) : undefined,
            maxInputPrice: opts.maxPrice ? Number(opts.maxPrice) : undefined,
            search: opts.search,
            includeNonChat: opts.all,
          }),
        );
      }
      if (opts.json) return printJson(all);
      if (!all.length) return outln(t('models.none'));
      const def = core.config.defaultModel;
      outln(
        table(
          all.map((m) => {
            const ref = `${m.provider}/${m.id}`;
            return [
              ref === def ? c.green(`★ ${ref}`) : `  ${ref}`,
              fmtTokens(m.context),
              fmtPrice(m.inputPrice),
              fmtPrice(m.outputPrice),
              badges(m),
              m.kind === 'chat' ? '' : c.dim(m.kind),
            ];
          }),
          ['  MODELO', 'CONTEXTO', '$ENT/1M', '$SAL/1M', 'CAPAC.', ''],
        ),
      );
      outln(
        c.dim(
          `\n${all.length} modelos · 🛠 herramientas 👁 visión 🧠 razonamiento ⇥ FIM · ★ por defecto`,
        ),
      );
    });

  program
    .command('use <model>')
    .description('Fija el modelo por defecto (proveedor/modelo) / set default model')
    .option(
      '-r, --role <role>',
      'asignar a un rol: chat, inline, autocomplete, agent, commit, security, embeddings',
    )
    .action((spec: string, opts: { role?: string }) => {
      const core = omni();
      core.resolveModel(spec);
      core.provider(spec.split('/')[0]!);
      if (opts.role) {
        core.saveConfig({ ...core.config, roles: { ...core.config.roles, [opts.role]: spec } });
        errln(`${opts.role}: ${spec}`);
      } else {
        core.saveConfig({ ...core.config, defaultModel: spec });
        errln(t('use.set', { model: spec }));
      }
    });
}
