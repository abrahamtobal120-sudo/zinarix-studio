#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { OmniError, exitCodeFor, setLocale, t } from '@omni/shared';
import type { MessageKey } from '@omni/shared';
import { redact } from '@omni/security';
import { registerAsk } from './commands/ask.js';
import { registerAuth } from './commands/auth.js';
import { registerCompletion } from './commands/completion.js';
import { registerMisc } from './commands/misc.js';
import { registerModels } from './commands/models.js';
import { registerProviders } from './commands/providers.js';
import { closeOmni, omni } from './context.js';
import { c, errln } from './io.js';

// node:sqlite prints an ExperimentalWarning on some Node versions; keep stderr clean.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.error(w.message);
});

// `omni models | head` closes the pipe early; that is not an error.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EPIPE') process.exit(0);
    throw e;
  });
}

export function buildProgram(): Command {
  const program = new Command()
    .name('omni')
    .description('Zinarix Studio CLI — cualquier modelo de cualquier proveedor desde la terminal')
    .version('0.1.0')
    .option('--lang <es|en>', 'idioma de la interfaz')
    .hook('preAction', (cmd) => {
      const lang = cmd.opts<{ lang?: string }>().lang;
      if (lang === 'es' || lang === 'en') setLocale(lang);
    });

  registerAuth(program);
  registerProviders(program);
  registerModels(program);
  registerAsk(program);

  program
    .command('chat')
    .description('Chat interactivo en la terminal (TUI) / interactive chat')
    .option('-m, --model <provider/model>', 'modelo inicial')
    .option('--system <text>', 'instrucción de sistema')
    .action(async (opts: { model?: string; system?: string }) => {
      const core = omni();
      const ref = core.resolveModel(opts.model);
      const { runChat } = await import('./tui/chat.js');
      await runChat(core, `${ref.provider}/${ref.model}`, opts.system);
    });

  registerMisc(program);
  registerCompletion(program);
  return program;
}

function describe(e: unknown): string {
  if (e instanceof OmniError) {
    if (e.code === 'auth' && e.status === undefined && e.provider && /no API key/.test(e.message)) {
      return t('err.no_key', { provider: e.provider });
    }
    const key = `err.${e.code}` as MessageKey;
    const provider = e.provider ?? '';
    const base = t(key, { provider, detail: e.message });
    return e.code === 'auth' ||
      e.code === 'rate_limit' ||
      e.code === 'server' ||
      e.code === 'timeout' ||
      e.code === 'network'
      ? `${base}\n  ${c.dim(e.message)}`
      : base;
  }
  return t('err.unknown', { detail: e instanceof Error ? e.message : String(e) });
}

async function main(): Promise<void> {
  const program = buildProgram().exitOverride();
  try {
    await program.parseAsync(process.argv);
  } catch (e) {
    if (e instanceof CommanderError) {
      process.exitCode = e.exitCode === 0 ? 0 : 2;
      return;
    }
    errln(c.red(`✗ ${redact(describe(e))}`));
    process.exitCode = exitCodeFor(e);
  } finally {
    closeOmni();
  }
}

await main();
