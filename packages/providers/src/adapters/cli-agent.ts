import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, extname, isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import { OmniError } from '@omni/shared';
import type { ChatChunk, ChatMessage, ChatRequest, CliProfile } from '@omni/shared';
import { redact } from '@omni/security';
import { catalogModels } from '../models.js';
import type { ConnectionTest, ProviderAdapter, ProviderConfig } from '../types.js';

/**
 * Coding-agent CLIs (Claude Code, Codex, Gemini CLI, Qwen Code, Cursor Agent, Copilot CLI,
 * OpenCode, Amp) driven in their non-interactive mode. They sign in with the user's own
 * account or subscription, run their own tools inside the project folder and stream their
 * answer back; Zinarix only shows it. Their tool activity is surfaced as reasoning lines,
 * never as tool calls, so Zinarix's agent never executes anything on their behalf.
 */

/** What the CLI may do: answer only, edit files in the project, or anything (no prompts). */
export type CliMode = 'read' | 'edit' | 'full';

interface Profile {
  /** Output format: one JSON event per line, or plain text. */
  output: 'json' | 'text';
  /** How the prompt reaches the CLI. */
  prompt: 'stdin' | 'arg';
  args(o: { model?: string; mode: CliMode; reasoning?: string }): string[];
  install: string;
  login: string;
}

const PROFILES: Record<CliProfile, Profile> = {
  claude: {
    output: 'json',
    prompt: 'stdin',
    args: ({ model, mode }) => [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      mode === 'read' ? 'default' : mode === 'edit' ? 'acceptEdits' : 'bypassPermissions',
      ...(model ? ['--model', model] : []),
    ],
    install: 'npm install -g @anthropic-ai/claude-code',
    login: 'ejecuta `claude` en una terminal e inicia sesión con /login',
  },
  codex: {
    output: 'json',
    prompt: 'stdin',
    args: ({ model, mode, reasoning }) => [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      mode === 'read' ? 'read-only' : mode === 'edit' ? 'workspace-write' : 'danger-full-access',
      ...(model ? ['-m', model] : []),
      ...(reasoning ? ['-c', `model_reasoning_effort=${reasoning}`] : []),
      '-',
    ],
    install: 'npm install -g @openai/codex',
    login: 'ejecuta `codex login` en una terminal',
  },
  gemini: {
    output: 'json',
    prompt: 'stdin',
    args: ({ model, mode }) => [
      '--output-format',
      'stream-json',
      '--approval-mode',
      mode === 'read' ? 'default' : mode === 'edit' ? 'auto_edit' : 'yolo',
      ...(model ? ['-m', model] : []),
    ],
    install: 'npm install -g @google/gemini-cli',
    login: 'ejecuta `gemini` en una terminal e inicia sesión con tu cuenta de Google',
  },
  qwen: {
    output: 'json',
    prompt: 'stdin',
    args: ({ model, mode }) => [
      '--output-format',
      'stream-json',
      '--approval-mode',
      mode === 'read' ? 'default' : mode === 'edit' ? 'auto_edit' : 'yolo',
      ...(model ? ['-m', model] : []),
    ],
    install: 'npm install -g @qwen-code/qwen-code',
    login: 'ejecuta `qwen` en una terminal e inicia sesión',
  },
  cursor: {
    output: 'json',
    prompt: 'arg',
    args: ({ model, mode }) => [
      '-p',
      '--output-format',
      'stream-json',
      ...(mode === 'read' ? ['--mode', 'ask'] : mode === 'full' ? ['--force'] : []),
      ...(model ? ['--model', model] : []),
    ],
    install: 'curl https://cursor.com/install -fsS | bash',
    login: 'ejecuta `cursor-agent login` en una terminal',
  },
  copilot: {
    output: 'text',
    prompt: 'arg',
    args: ({ model, mode }) => [
      ...(mode === 'edit'
        ? ['--allow-tool', 'write']
        : mode === 'full'
          ? ['--allow-all-tools']
          : []),
      ...(model ? ['--model', model] : []),
      '-p',
    ],
    install: 'npm install -g @github/copilot',
    login: 'ejecuta `copilot` en una terminal e inicia sesión con /login',
  },
  opencode: {
    output: 'text',
    prompt: 'stdin',
    args: ({ model }) => ['run', ...(model ? ['-m', model] : [])],
    install: 'npm install -g opencode-ai',
    login: 'ejecuta `opencode auth login` en una terminal',
  },
  amp: {
    output: 'json',
    prompt: 'stdin',
    args: ({ mode }) => [
      '--execute',
      '--stream-json',
      ...(mode === 'full' ? ['--dangerously-allow-all'] : []),
    ],
    install: 'npm install -g @sourcegraph/amp',
    login: 'ejecuta `amp login` en una terminal',
  },
};

/** "default" (or nothing) lets the CLI use the model the user picked in it. */
const SAFE_ARG = /^[A-Za-z0-9._:/@[\]=-]+$/;
const MAX_ARG_PROMPT = 100_000;
const MAX_HISTORY = 60_000;

function cli(cfg: ProviderConfig): { profile: CliProfile; spec: Profile; command: string } {
  const c = cfg.entry.cli;
  if (!c)
    throw new OmniError('config', `${cfg.entry.name}: catalog entry has no "cli" section`, {
      provider: cfg.entry.id,
      retryable: false,
    });
  return {
    profile: c.profile,
    spec: PROFILES[c.profile],
    command: cfg.params?.command || c.command,
  };
}

function contentText(m: ChatMessage): string {
  if (m.role !== 'user') return m.content;
  return typeof m.content === 'string'
    ? m.content
    : m.content.map((p) => (p.type === 'text' ? p.text : '[imagen omitida]')).join('\n');
}

/**
 * One prompt for a stateless CLI run: the last user message, preceded by the earlier turns
 * of the conversation. System prompts are dropped: they describe Zinarix's own tools, and
 * the CLIs bring their own (plus AGENTS.md / CLAUDE.md from the project).
 */
export function cliPrompt(messages: ChatMessage[]): string {
  const turns = messages.filter(
    (m) => m.role === 'user' || (m.role === 'assistant' && m.content.trim()),
  );
  let last = -1;
  for (let i = turns.length - 1; i >= 0; i--)
    if (turns[i]!.role === 'user') {
      last = i;
      break;
    }
  if (last < 0) return '';
  const current = contentText(turns[last]!);
  let history = turns
    .slice(0, last)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}:\n${contentText(m)}`)
    .join('\n\n');
  if (!history) return current;
  if (history.length > MAX_HISTORY) history = '…' + history.slice(-MAX_HISTORY);
  return `<conversation-history>\n${history}\n</conversation-history>\n\n${current}`;
}

/**
 * Chat mode only answers; agent mode (Zinarix sends its tools) lets the CLI act on the
 * open project with the permission level chosen in the provider settings.
 */
export function cliMode(cfg: ProviderConfig, req: ChatRequest): CliMode {
  if (!req.tools?.length || !req.cwd) return 'read';
  const m = cfg.params?.mode;
  return m === 'read' || m === 'full' ? m : 'edit';
}

function isExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (process.platform !== 'win32') accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the CLI on PATH, plus the usual per-user install folders (a desktop app launched
 * from the menu often has a shorter PATH than the user's shell).
 */
export function findExecutable(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (isAbsolute(command)) return isExecutable(command) ? command : undefined;
  const home = homedir();
  const dirs = [
    ...(env.PATH ?? env.Path ?? '').split(delimiter),
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.opencode', 'bin'),
    join(home, '.amp', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    ...(process.platform === 'win32' && env.APPDATA ? [join(env.APPDATA, 'npm')] : []),
  ].filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : [''];
  for (const dir of dirs)
    for (const ext of exts) {
      const file = join(dir, command + ext.toLowerCase());
      if (isExecutable(file)) return file;
    }
  return undefined;
}

function notInstalled(cfg: ProviderConfig, command: string, spec: Profile): OmniError {
  return new OmniError(
    'config',
    `no se encontró \`${command}\` en este equipo. Instálalo con: ${spec.install} ` +
      '(o indica la ruta del programa en el campo "command")',
    { provider: cfg.entry.id, retryable: false },
  );
}

/** Environment for the CLI: the user's own (its login may live there), minus Zinarix's secrets. */
function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  for (const k of Object.keys(env)) if (/^OMNI_/i.test(k)) delete env[k];
  return env;
}

/** npm installs CLIs on Windows as .cmd shims, which only run through cmd.exe. */
function launch(file: string, args: string[]): { file: string; args: string[]; verbatim: boolean } {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(extname(file))) {
    // Every argument is checked against SAFE_ARG first, so nothing here is interpreted by cmd.
    const line = [file, ...args].map((a) => `"${a}"`).join(' ');
    return {
      file: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `"${line}"`],
      verbatim: true,
    };
  }
  return { file, args, verbatim: false };
}

function classify(cfg: ProviderConfig, spec: Profile, message: string): OmniError {
  const msg = redact(message.trim().slice(0, 2000)) || 'el programa terminó con error';
  const opts = { provider: cfg.entry.id, retryable: false };
  if (
    /log ?in|sign ?in|auth|unauthori[sz]ed|api key|credential|oauth|not logged|expired/i.test(msg)
  )
    return new OmniError('auth', `${msg} — ${spec.login}`, { ...opts, status: 401 });
  if (/rate.?limit|quota|usage limit|too many requests|\b429\b/i.test(msg))
    return new OmniError('rate_limit', msg, { ...opts, status: 429 });
  return new OmniError('server', msg, opts);
}

function summarize(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  for (const k of ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'description']) {
    const v = o[k];
    if (typeof v === 'string' && v) return v.length > 120 ? v.slice(0, 117) + '…' : v;
    if (Array.isArray(v) && v.length) return v.join(' ').slice(0, 120);
  }
  return '';
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Turns the CLIs' line-delimited JSON into chat chunks. Their event shapes do not overlap,
 * so one parser understands all of them: Claude Code / Amp / Cursor ("system", "assistant",
 * "stream_event", "result"), Gemini / Qwen ("init", "message", "tool_use", "result" with
 * "stats") and Codex ("thread.*", "turn.*", "item.*", or the older "msg" envelope).
 */
export class CliStreamParser {
  private partial = false;
  private hasText = false;
  private endsWithNewline = true;
  private toolSince = false;
  private plain: string[] = [];
  private usage?: Extract<ChatChunk, { type: 'usage' }>;
  /** Fatal error reported by the CLI itself (failed turn, error result). */
  error?: string;
  /** Last non-fatal error event: shown if the process then fails without saying why. */
  lastWarning?: string;

  constructor(private readonly output: 'json' | 'text' = 'json') {}

  private text(s: unknown): ChatChunk[] {
    if (typeof s !== 'string' || !s) return [];
    const out: ChatChunk[] = [];
    if (this.toolSince && this.hasText && !this.endsWithNewline)
      out.push({ type: 'text', delta: '\n\n' });
    this.toolSince = false;
    this.hasText = true;
    this.endsWithNewline = s.endsWith('\n');
    out.push({ type: 'text', delta: s });
    return out;
  }

  private tool(name: unknown, detail = ''): ChatChunk[] {
    this.toolSince = true;
    const label = typeof name === 'string' && name ? name : 'herramienta';
    return [{ type: 'reasoning', delta: `▸ ${label}${detail ? ` ${detail}` : ''}\n` }];
  }

  push(line: string): ChatChunk[] {
    if (this.output === 'text') {
      const clean = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
      return this.text(clean + '\n');
    }
    const trimmed = line.trim();
    if (!trimmed) return [];
    let ev: Json;
    try {
      ev = JSON.parse(trimmed) as Json;
    } catch {
      this.plain.push(line);
      return [];
    }
    if (!ev || typeof ev !== 'object') return [];
    if (ev.msg && typeof ev.msg === 'object' && !ev.type) return this.codexLegacy(ev.msg as Json);
    switch (ev.type) {
      // ---- Claude Code / Amp / Cursor ----
      case 'stream_event': {
        const e = ev.event as Json | undefined;
        if (e?.type !== 'content_block_delta') return [];
        this.partial = true;
        if (e.delta?.type === 'text_delta') return this.text(e.delta.text);
        if (e.delta?.type === 'thinking_delta' && e.delta.thinking)
          return [{ type: 'reasoning', delta: String(e.delta.thinking) }];
        return [];
      }
      case 'assistant': {
        const msg = ev.message as Json | undefined;
        // Claude Code reports its own failures (expired login…) as a synthetic message too;
        // the error result that follows carries them.
        if (!msg || msg.model === '<synthetic>') return [];
        const out: ChatChunk[] = [];
        for (const b of Array.isArray(msg.content) ? (msg.content as Json[]) : []) {
          if (b.type === 'text' && !this.partial) out.push(...this.text(b.text));
          else if (b.type === 'thinking' && !this.partial && b.thinking)
            out.push({ type: 'reasoning', delta: String(b.thinking) });
          else if (b.type === 'tool_use') out.push(...this.tool(b.name, summarize(b.input)));
        }
        return out;
      }
      case 'tool_call': {
        // Cursor: { subtype: "started", tool_call: { readToolCall: { args } } }
        if (ev.subtype !== 'started' || !ev.tool_call) return [];
        const [name, body] = Object.entries(ev.tool_call as Json)[0] ?? [];
        return this.tool(
          String(name ?? '').replace(/ToolCall$/, ''),
          summarize((body as Json)?.args),
        );
      }
      case 'result': {
        if (ev.stats || typeof ev.status === 'string') {
          // Gemini / Qwen
          if (ev.status === 'error') this.error = String(ev.error?.message ?? ev.error ?? 'error');
          const s = (ev.stats ?? {}) as Json;
          if (s.input_tokens != null || s.output_tokens != null)
            this.usage = {
              type: 'usage',
              inputTokens: Number(s.input_tokens ?? 0),
              outputTokens: Number(s.output_tokens ?? 0),
              ...(s.cached ? { cachedTokens: Number(s.cached) } : {}),
            };
          return [];
        }
        if (ev.is_error || (typeof ev.subtype === 'string' && ev.subtype.startsWith('error')))
          this.error = String(
            ev.result || (Array.isArray(ev.errors) ? ev.errors.join('; ') : '') || ev.subtype,
          );
        else if (!this.hasText && typeof ev.result === 'string') return this.text(ev.result);
        const u = ev.usage as Json | undefined;
        if (u) {
          const cached = Number(u.cache_read_input_tokens ?? 0);
          const written = Number(u.cache_creation_input_tokens ?? 0);
          this.usage = {
            type: 'usage',
            inputTokens: Number(u.input_tokens ?? 0) + cached + written,
            outputTokens: Number(u.output_tokens ?? 0),
            ...(cached ? { cachedTokens: cached } : {}),
            ...(written ? { cacheWriteTokens: written } : {}),
          };
        }
        return [];
      }
      // ---- Gemini CLI / Qwen Code ----
      case 'message':
        return ev.role === 'assistant' ? this.text(ev.content) : [];
      case 'tool_use':
        return this.tool(ev.tool_name ?? ev.name, summarize(ev.parameters ?? ev.input));
      case 'error':
        // Gemini warnings and Codex reconnects both arrive here and are not fatal by themselves.
        this.lastWarning = String(ev.message ?? ev.error ?? '');
        return this.lastWarning ? [{ type: 'reasoning', delta: `⚠ ${this.lastWarning}\n` }] : [];
      // ---- Codex (`codex exec --json`) ----
      case 'item.started': {
        const it = ev.item as Json | undefined;
        if (it?.type === 'command_execution') return this.tool('$', String(it.command ?? ''));
        return [];
      }
      case 'item.completed': {
        const it = (ev.item ?? {}) as Json;
        switch (it.type) {
          case 'agent_message':
            return this.text(it.text);
          case 'reasoning':
            return it.text ? [{ type: 'reasoning', delta: `${String(it.text)}\n` }] : [];
          case 'file_change':
            return this.tool(
              'editar',
              (Array.isArray(it.changes) ? (it.changes as Json[]) : [])
                .map((c) => c.path)
                .join(', '),
            );
          case 'mcp_tool_call':
            return this.tool(`${it.server ?? 'mcp'}.${it.tool ?? ''}`);
          case 'web_search':
            return this.tool('buscar', String(it.query ?? ''));
          case 'error':
            this.lastWarning = String(it.message ?? '');
            return [{ type: 'reasoning', delta: `⚠ ${this.lastWarning}\n` }];
          default:
            return [];
        }
      }
      case 'turn.completed': {
        const u = (ev.usage ?? {}) as Json;
        this.usage = {
          type: 'usage',
          inputTokens: Number(u.input_tokens ?? 0),
          outputTokens: Number(u.output_tokens ?? 0),
          ...(u.cached_input_tokens ? { cachedTokens: Number(u.cached_input_tokens) } : {}),
        };
        return [];
      }
      case 'turn.failed':
        this.error = String(ev.error?.message ?? 'turn failed');
        return [];
      default:
        return [];
    }
  }

  private codexLegacy(m: Json): ChatChunk[] {
    switch (m.type) {
      case 'agent_message':
        return this.text(m.message);
      case 'agent_reasoning':
        return m.text ? [{ type: 'reasoning', delta: `${String(m.text)}\n` }] : [];
      case 'exec_command_begin':
        return this.tool(
          '$',
          Array.isArray(m.command) ? m.command.join(' ') : String(m.command ?? ''),
        );
      case 'error':
        this.error = String(m.message ?? 'error');
        return [];
      default:
        return [];
    }
  }

  /** Chunks left once the process has exited successfully (plain-text fallback, usage, done). */
  finish(): ChatChunk[] {
    const out: ChatChunk[] = [];
    if (!this.hasText && this.plain.length) out.push(...this.text(this.plain.join('\n')));
    if (this.usage) out.push(this.usage);
    out.push({ type: 'done', stopReason: 'stop' });
    return out;
  }
}

async function* run(
  cfg: ProviderConfig,
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatChunk> {
  const { spec, command } = cli(cfg);
  const file = findExecutable(command);
  if (!file) throw notInstalled(cfg, command, spec);
  const model = req.model && req.model !== 'default' ? req.model : undefined;
  if (model && !SAFE_ARG.test(model))
    throw new OmniError('bad_request', `invalid model name "${model}"`, {
      provider: cfg.entry.id,
      retryable: false,
    });
  const prompt = cliPrompt(req.messages);
  if (!prompt.trim())
    throw new OmniError('bad_request', 'empty prompt', {
      provider: cfg.entry.id,
      retryable: false,
    });
  const mode = cliMode(cfg, req);
  const args = spec.args({ model, mode, reasoning: req.reasoning });
  let target = launch(file, args);
  if (spec.prompt === 'arg') {
    if (target.verbatim)
      throw new OmniError(
        'unsupported',
        `${cfg.entry.name} no se puede usar desde Zinarix en Windows (recibe el mensaje como argumento)`,
        { provider: cfg.entry.id, retryable: false },
      );
    if (prompt.length > MAX_ARG_PROMPT)
      throw new OmniError('bad_request', 'mensaje demasiado largo para este CLI', {
        provider: cfg.entry.id,
        retryable: false,
      });
    target = { ...target, args: [...target.args, prompt] };
  }
  cfg.logger?.debug('cli-agent run', { provider: cfg.entry.id, mode, model: model ?? 'default' });

  const child = spawn(target.file, target.args, {
    cwd: req.cwd ?? homedir(),
    env: cliEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: target.verbatim,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => {
    stderr = (stderr + d).slice(-4000);
  });
  const exited = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.once('error', (error) => resolve({ code: null, error }));
    child.once('close', (code) => resolve({ code }));
  });
  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 3000).unref();
  };
  signal.addEventListener('abort', kill, { once: true });
  child.stdin.on('error', () => undefined);
  child.stdin.end(spec.prompt === 'stdin' ? prompt : '');

  const parser = new CliStreamParser(spec.output);
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (signal.aborted) break;
      yield* parser.push(line);
    }
    const res = await exited;
    if (signal.aborted) throw new OmniError('aborted', 'cancelled', { provider: cfg.entry.id });
    if (res.error) {
      if ((res.error as NodeJS.ErrnoException).code === 'ENOENT')
        throw notInstalled(cfg, command, spec);
      throw classify(cfg, spec, res.error.message);
    }
    if (parser.error) throw classify(cfg, spec, parser.error);
    if (res.code !== 0)
      throw classify(
        cfg,
        spec,
        stderr.trim() || parser.lastWarning || `${command} terminó con código ${res.code}`,
      );
    yield* parser.finish();
  } finally {
    signal.removeEventListener('abort', kill);
    lines.close();
    kill();
  }
}

/** Runs `<cli> --version`: proves the program is installed and starts. */
function version(file: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const t = launch(file, ['--version']);
    const child = spawn(t.file, t.args, {
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: t.verbatim,
      timeout: 15_000,
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.once('error', (e) => resolve({ ok: false, out: e.message }));
    child.once('close', (code) => resolve({ ok: code === 0, out: out.trim().slice(0, 300) }));
  });
}

export const cliAgent: ProviderAdapter = {
  id: 'cli-agent',

  async listModels(cfg) {
    const { spec, command } = cli(cfg);
    if (!findExecutable(command)) throw notInstalled(cfg, command, spec);
    return catalogModels(cfg.entry);
  },

  chat(cfg, req, signal) {
    return run(cfg, req, signal);
  },

  async testConnection(cfg): Promise<ConnectionTest> {
    const { spec, command } = cli(cfg);
    const file = findExecutable(command);
    if (!file)
      return { ok: false, code: 'config', error: notInstalled(cfg, command, spec).message };
    const v = await version(file);
    return v.ok
      ? { ok: true, models: cfg.entry.fallbackModels.length }
      : { ok: false, code: 'config', error: redact(v.out || `${command} --version falló`) };
  },
};
