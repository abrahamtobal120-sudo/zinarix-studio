import { resolve } from 'node:path';
import type { Command } from 'commander';
import { APPROVE_LEVELS, isApproveLevel, runHeadlessAgent } from '@omni/core';
import type { ApproveLevel, HeadlessEvent, HeadlessResult } from '@omni/core';
import { ExitCode, OmniError } from '@omni/shared';
import { interruptSignal, omni } from '../context.js';
import { c, errln, fmtTokens, fmtUsd, out, outln, printJson, readStdin } from '../io.js';

/**
 * Fase 15 — `omni agent -p "…"`: the Zinarix agent without a UI, for CI and scripts.
 *
 *   omni agent -p "fix the failing test" --approve=full --json
 *   git diff | omni agent --approve=read-only "review this diff"
 *
 * --approve: read-only (default) · auto-edit (edit files, no commands) · full (also commands;
 * publishing commands such as git push are always refused).
 */

export interface AgentCliOpts {
  prompt?: string;
  model?: string;
  approve: string;
  cwd?: string;
  maxSteps?: string;
  system?: string;
  json?: boolean;
  streamJson?: boolean;
  hooks?: boolean;
  quiet?: boolean;
}

/** Exit code of a finished run. */
export function agentExitCode(r: Pick<HeadlessResult, 'stop' | 'errorExit'>): number {
  switch (r.stop) {
    case 'done':
      return ExitCode.ok;
    case 'aborted':
      return ExitCode.aborted;
    case 'error':
      return r.errorExit ?? ExitCode.error;
    default:
      return ExitCode.error;
  }
}

const short = (v: unknown): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  const line = (s ?? '').replace(/\s+/g, ' ');
  return line.length > 100 ? `${line.slice(0, 97)}…` : line;
};

/** One-line description of a tool call for the progress output. */
export function describeCall(name: string, args: Record<string, unknown>): string {
  const main = args.command ?? args.path ?? args.pattern ?? '';
  return `${name}${main ? ` ${short(main)}` : ''}`;
}

export async function runAgentCli(words: string[], opts: AgentCliOpts): Promise<void> {
  if (!isApproveLevel(opts.approve))
    throw new OmniError('config', `--approve must be one of: ${APPROVE_LEVELS.join(', ')}`);
  const approve: ApproveLevel = opts.approve;
  const given = (opts.prompt ?? words.join(' ')).trim();
  const stdin = await readStdin(!given);
  const prompt = [given, stdin.trim() ? `<stdin>\n${stdin.trim()}\n</stdin>` : '']
    .filter(Boolean)
    .join('\n\n');
  if (!prompt) throw new OmniError('config', 'omni agent needs a prompt: -p "…" or stdin');
  const maxSteps = opts.maxSteps ? Number(opts.maxSteps) : undefined;
  if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 1))
    throw new OmniError('config', '--max-steps must be a positive integer');

  const core = omni();
  const progress = !opts.quiet && !opts.json && !opts.streamJson;
  let lastWasText = false;
  const onEvent = (ev: HeadlessEvent) => {
    if (opts.streamJson) {
      outln(JSON.stringify(ev));
      return;
    }
    if (opts.json) return;
    switch (ev.type) {
      case 'start':
        if (progress)
          errln(
            c.dim(
              `· ${ev.model || 'default model'} · ${ev.approve} · ${ev.cwd}${ev.rules.length ? ` · rules: ${ev.rules.join(', ')}` : ''}`,
            ),
          );
        break;
      case 'text':
        out(ev.delta);
        lastWasText = true;
        break;
      case 'tool_call':
        if (lastWasText) outln();
        lastWasText = false;
        if (progress) errln(c.cyan(`▸ ${describeCall(ev.name, ev.args)}`));
        break;
      case 'tool_result':
        if (!progress) break;
        if (ev.denied) errln(c.yellow(`  ✗ ${ev.denied}`));
        else if (!ev.ok) errln(c.red(`  ✗ ${short(ev.content)}`));
        break;
      case 'notice':
        errln(c.yellow(`⚠ ${ev.message}`));
        break;
      default:
        break;
    }
  };

  const result = await runHeadlessAgent((req, signal) => core.stream(req, signal), {
    prompt,
    approve,
    cwd: opts.cwd ? resolve(opts.cwd) : process.cwd(),
    model: opts.model,
    maxSteps,
    system: opts.system,
    hooks: opts.hooks,
    signal: interruptSignal(),
    onEvent,
  });

  if (opts.json) printJson(result);
  else if (opts.streamJson) outln(JSON.stringify({ type: 'result', ...result }));
  else {
    if (lastWasText) outln();
    if (progress) {
      const files = result.filesChanged.length
        ? ` · ${result.filesChanged.length} file(s) changed`
        : '';
      errln(
        c.dim(
          `· ${result.stop} · ${result.steps} step(s) · ${fmtTokens(result.usage.inputTokens)}→${fmtTokens(result.usage.outputTokens)} tok · ${fmtUsd(result.usage.usd)}${files} · ${(result.durationMs / 1000).toFixed(1)}s`,
        ),
      );
    }
    if (result.error) errln(c.red(`✗ ${result.error}`));
  }
  process.exitCode = agentExitCode(result);
}

export function registerAgent(program: Command): void {
  program
    .command('agent [prompt...]')
    .description(
      'Agente sin interfaz para CI y scripts (reglas, skills y hooks del proyecto) / headless agent',
    )
    .option('-p, --prompt <text>', 'la tarea del agente (o como argumento, o por stdin)')
    .option('-m, --model <provider/model>', 'modelo a usar (por omisión el del rol "agent")')
    .option(
      '--approve <level>',
      'read-only (solo leer) | auto-edit (editar archivos) | full (también comandos)',
      'read-only',
    )
    .option('-C, --cwd <dir>', 'carpeta del proyecto (por omisión la actual)')
    .option('--max-steps <n>', 'turnos del modelo antes de parar (por omisión 40)')
    .option('--system <text>', 'instrucción de sistema extra')
    .option('--json', 'al terminar, imprime el resultado completo en JSON')
    .option('--stream-json', 'imprime cada evento como una línea JSON (NDJSON)')
    .option('--hooks', 'ejecuta los hooks del proyecto también en read-only')
    .option('--no-hooks', 'no ejecuta los hooks de .zinarix/settings.json')
    .option('-q, --quiet', 'sin progreso en stderr')
    .action(async (words: string[], opts: AgentCliOpts) => runAgentCli(words, opts));
}
