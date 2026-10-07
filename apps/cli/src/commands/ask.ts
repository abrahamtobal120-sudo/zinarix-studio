import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { buildContextMessages } from '@omni/core';
import type { OmniCore, OmniEvent, StreamRequest } from '@omni/core';
import { OmniError, t } from '@omni/shared';
import type { ChatMessage } from '@omni/shared';
import { interruptSignal, omni } from '../context.js';
import {
  c,
  collect,
  err,
  errln,
  fmtTokens,
  fmtUsd,
  out,
  outln,
  printJson,
  readStdin,
} from '../io.js';

export interface AskOpts {
  model?: string;
  file: string[];
  system?: string;
  json?: boolean;
  temperature?: string;
  maxTokens?: string;
  reasoning?: 'low' | 'medium' | 'high';
  showReasoning?: boolean;
  history: boolean;
  fallback: boolean;
}

export function buildMessages(
  prompt: string,
  stdin: string,
  files: { path: string; content: string }[],
  system?: string,
): ChatMessage[] {
  return buildContextMessages(
    prompt,
    [
      ...files.map((f) => ({ source: `file:${f.path}`, content: f.content })),
      { source: 'stdin', content: stdin },
    ],
    system,
  );
}

export function summaryLine(ev: Extract<OmniEvent, { type: 'cost' }>, ref: string): string {
  return c.dim(
    `· ${ref} · ${fmtTokens(ev.inputTokens)}→${fmtTokens(ev.outputTokens)} tok · ${fmtUsd(ev.usd)} · ${(ev.latencyMs / 1000).toFixed(1)}s`,
  );
}

export function printNotice(ev: Extract<OmniEvent, { type: 'notice' }>): void {
  if (ev.kind === 'redaction') errln(c.yellow(`⚠ ${t('redaction.notice', { count: ev.message })}`));
  else errln(c.yellow(`⚠ ${ev.message}`));
}

export async function runAsk(core: OmniCore, prompt: string, opts: AskOpts): Promise<void> {
  const stdin = await readStdin(!prompt && opts.file.length === 0);
  const files = opts.file.map((path) => ({ path, content: readFileSync(path, 'utf8') }));
  if (!prompt && !stdin.trim() && !files.length) throw new OmniError('config', t('ask.no_prompt'));

  const messages = buildMessages(prompt, stdin, files, opts.system);
  const req: StreamRequest = {
    model: opts.model,
    messages,
    temperature: opts.temperature !== undefined ? Number(opts.temperature) : undefined,
    maxTokens: opts.maxTokens ? Number(opts.maxTokens) : undefined,
    reasoning: opts.reasoning,
    noFallback: !opts.fallback,
  };
  const signal = interruptSignal();

  if (opts.json) {
    const result = await core.complete(req, signal);
    printJson(result);
    if (opts.history)
      saveHistory(
        core,
        prompt || 'stdin',
        messages,
        result.text,
        `${result.provider}/${result.model}`,
      );
    return;
  }

  let ref = '';
  let text = '';
  let inReasoning = false;
  for await (const ev of core.stream(req, signal)) {
    switch (ev.type) {
      case 'start':
        ref = `${ev.provider}/${ev.model}`;
        break;
      case 'reasoning':
        if (opts.showReasoning) {
          if (!inReasoning) err(c.dim('💭 '));
          inReasoning = true;
          err(c.dim(ev.delta));
        }
        break;
      case 'text':
        if (inReasoning) {
          errln();
          inReasoning = false;
        }
        text += ev.delta;
        out(ev.delta);
        break;
      case 'notice':
        printNotice(ev);
        break;
      case 'cost':
        if (!text.endsWith('\n')) outln();
        if (process.stderr.isTTY) errln(summaryLine(ev, ref));
        break;
    }
  }
  if (opts.history) saveHistory(core, prompt || 'stdin', messages, text, ref);
}

function saveHistory(
  core: OmniCore,
  title: string,
  messages: ChatMessage[],
  answer: string,
  ref: string,
): void {
  const conv = core.history.create(title.split('\n')[0]!, ref);
  for (const m of messages) core.history.append(conv.id, m);
  core.history.append(conv.id, { role: 'assistant', content: answer }, ref);
}

export function registerAsk(program: Command): void {
  program
    .command('ask [prompt...]')
    .description('Pregunta única con streaming; lee stdin y archivos / one-shot question')
    .option('-m, --model <provider/model>', 'modelo a usar')
    .option('-f, --file <path>', 'adjunta un archivo como contexto (repetible)', collect, [])
    .option('--system <text>', 'instrucción de sistema')
    .option('--json', 'respuesta completa en JSON (para scripts)')
    .option('-t, --temperature <n>', 'temperatura')
    .option('--max-tokens <n>', 'máximo de tokens de salida')
    .option('--reasoning <level>', 'esfuerzo de razonamiento: low | medium | high')
    .option('--show-reasoning', 'muestra el razonamiento en stderr')
    .option('--no-history', 'no guardar en el historial')
    .option('--no-fallback', 'no usar la cadena de respaldo')
    .action(async (words: string[], opts: AskOpts) => runAsk(omni(), words.join(' '), opts));

  program
    .command('compare <prompt>')
    .description('Envía el mismo prompt a varios modelos en paralelo / compare models')
    .requiredOption('-m, --model <provider/model>', 'modelo (repetible, 2–4)', collect, [])
    .option('--json', 'salida JSON')
    .option('--max-tokens <n>', 'máximo de tokens de salida')
    .action(
      async (prompt: string, opts: { model: string[]; json?: boolean; maxTokens?: string }) => {
        const core = omni();
        if (opts.model.length < 2)
          throw new OmniError('config', 'compare needs at least two -m models');
        const signal = interruptSignal();
        const results = await Promise.all(
          opts.model.map(async (model) => {
            try {
              return {
                ...(await core.complete(
                  {
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    noFallback: true,
                    maxTokens: opts.maxTokens ? Number(opts.maxTokens) : undefined,
                  },
                  signal,
                )),
                model,
              };
            } catch (e) {
              return { model, error: e instanceof Error ? e.message : String(e) };
            }
          }),
        );
        if (opts.json) return printJson(results);
        for (const r of results) {
          outln(c.bold(c.cyan(`━━ ${r.model} ━━`)));
          if ('error' in r) outln(c.red(r.error ?? ''));
          else {
            outln(r.text.trimEnd());
            outln(
              c.dim(
                `${fmtTokens(r.inputTokens)}→${fmtTokens(r.outputTokens)} tok · ${fmtUsd(r.usd)} · ${(r.latencyMs / 1000).toFixed(1)}s`,
              ),
            );
          }
          outln();
        }
      },
    );
}
