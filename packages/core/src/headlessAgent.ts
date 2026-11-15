import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { exitCodeFor, isOmniError } from '@omni/shared';
import type { ChatMessage, ToolCall } from '@omni/shared';
import type { ApproveLevel } from './agentPolicy.js';
import { decide, toolsFor } from './agentPolicy.js';
import type { HookEvent, ProjectContext, ProjectHook } from './agentProject.js';
import { hookMatches, loadProject, projectPrompt, runHook } from './agentProject.js';
import { TOOL_DEFS, cleanEnv, runTool } from './agentTools.js';
import type { OmniEvent, StreamRequest } from './omni.js';

/**
 * Fase 15 — the agent without a UI: `omni agent -p "…" --approve=read-only --json`, for CI
 * and scripts, and the entry point of the SDK (`runHeadlessAgent` from @omni/core).
 *
 * It follows the project's rules, lists its skills and runs its hooks (Fases 1 and 4), works
 * only inside one folder, and decides every action with the approval level given up front.
 */

export type StreamFn = (req: StreamRequest, signal: AbortSignal) => AsyncIterable<OmniEvent>;

export type AgentStop = 'done' | 'max_steps' | 'aborted' | 'error' | 'blocked';

export interface AgentToolRecord {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** Refused by the approval level or a hook (never run). */
  denied?: string;
}

export type HeadlessEvent =
  | { type: 'start'; model: string; cwd: string; approve: ApproveLevel; rules: string[] }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; content: string; denied?: string }
  | { type: 'file_changed'; path: string }
  | { type: 'notice'; message: string }
  | { type: 'step'; step: number; usd: number | null; inputTokens: number; outputTokens: number };

export interface HeadlessOptions {
  prompt: string;
  /** Folder the agent works in (default process.cwd()). */
  cwd?: string;
  approve: ApproveLevel;
  /** "provider/model"; default the configured agent/chat model. */
  model?: string;
  /** Model turns before stopping (default 40). */
  maxSteps?: number;
  /** Run the project's hooks (default: yes, except at read-only). */
  hooks?: boolean;
  /** Extra system instruction. */
  system?: string;
  signal?: AbortSignal;
  onEvent?: (ev: HeadlessEvent) => void;
  env?: NodeJS.ProcessEnv;
  /** Pre-loaded project context (tests). */
  project?: ProjectContext;
}

export interface HeadlessResult {
  ok: boolean;
  stop: AgentStop;
  /** The agent's final answer (its last text). */
  text: string;
  model: string;
  cwd: string;
  approve: ApproveLevel;
  steps: number;
  tools: AgentToolRecord[];
  filesChanged: string[];
  rules: string[];
  usage: { inputTokens: number; outputTokens: number; usd: number | null };
  durationMs: number;
  error?: string;
  /** Exit code a CLI should use for this error (auth 3, rate limit 4, budget 5…). */
  errorExit?: number;
}

export const DEFAULT_MAX_STEPS = 40;

const BASE_PROMPT = `You are Zinarix, a coding agent running without a user interface (for example in CI).
Nobody can answer questions during this run: decide on your own, do the task completely, and end with a short summary of what you did and what is left.
Work only inside the project folder. Read before you edit, keep changes small and in the style of the code, and when you can run commands, run the tests that cover your change.
Never try to publish (git push, opening pull requests, deploying): the job that started you does that.`;

function levelPrompt(level: ApproveLevel): string {
  if (level === 'read-only')
    return 'This run is read-only: you can list, read and search files, but not change anything or run commands. Answer from what you read.';
  if (level === 'auto-edit') return 'You can read and edit files, but you cannot run commands.';
  return 'You can read and edit files and run commands (tests, builds, linters).';
}

function parseArgs(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function runHeadlessAgent(
  stream: StreamFn,
  opts: HeadlessOptions,
): Promise<HeadlessResult> {
  const started = Date.now();
  const cwd = realpathSync(opts.cwd ?? process.cwd());
  const env = opts.env ?? process.env;
  const signal = opts.signal ?? new AbortController().signal;
  const emit = opts.onEvent ?? (() => {});
  const maxSteps = Math.max(1, opts.maxSteps ?? DEFAULT_MAX_STEPS);
  const project = opts.project ?? loadProject(cwd);
  const useHooks = opts.hooks ?? opts.approve !== 'read-only';
  const hooks: ProjectHook[] = useHooks ? project.hooks : [];
  const sessionId = randomUUID();
  const hookEnv = cleanEnv(env);

  const { text: projectText, used: rules } = projectPrompt(project);
  const system = [BASE_PROMPT, levelPrompt(opts.approve), opts.system ?? '', projectText]
    .filter(Boolean)
    .join('\n\n');
  const toolDefs = toolsFor(opts.approve).map((n) => TOOL_DEFS[n]);

  const result: HeadlessResult = {
    ok: false,
    stop: 'done',
    text: '',
    model: opts.model ?? '',
    cwd,
    approve: opts.approve,
    steps: 0,
    tools: [],
    filesChanged: [],
    rules,
    usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    durationMs: 0,
  };
  const finish = (stop: AgentStop, error?: string): HeadlessResult => {
    result.stop = stop;
    result.ok = stop === 'done';
    if (error) result.error = error;
    result.durationMs = Date.now() - started;
    return result;
  };

  /** Runs the hooks of an event; returns the block reason, or the extra context. */
  const fire = async (
    event: HookEvent,
    fields: Record<string, unknown>,
    tool?: string,
  ): Promise<{ block: string | null; context: string[] }> => {
    const context: string[] = [];
    for (const h of hooks.filter((x) => x.event === event && hookMatches(x.matcher, tool))) {
      const v = await runHook(
        h,
        { hook_event_name: event, session_id: sessionId, cwd, ...fields },
        cwd,
        hookEnv,
      );
      if (v.warning) emit({ type: 'notice', message: `hook ${h.source}: ${v.warning}` });
      if (v.block) return { block: v.message, context };
      if (v.message) context.push(v.message);
    }
    return { block: null, context };
  };

  emit({ type: 'start', model: result.model, cwd, approve: opts.approve, rules });

  const prompt = await fire('UserPromptSubmit', { prompt: opts.prompt });
  if (prompt.block) return finish('blocked', `UserPromptSubmit hook: ${prompt.block}`);
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: prompt.context.length
        ? `${opts.prompt}\n\n<hook-context>\n${prompt.context.join('\n')}\n</hook-context>`
        : opts.prompt,
    },
  ];
  const changed = new Set<string>();
  let stopHookRan = false;

  try {
    for (let step = 1; ; step++) {
      if (signal.aborted) return finish('aborted');
      if (step > maxSteps) return finish('max_steps', `stopped after ${maxSteps} steps`);
      result.steps = step;

      let text = '';
      const calls = new Map<string, ToolCall>();
      let raw: { adapter: string; content: unknown } | undefined;
      let stepUsd: number | null = null;
      let stepIn = 0;
      let stepOut = 0;
      for await (const ev of stream(
        { model: opts.model, role: 'agent', messages, tools: toolDefs, cwd },
        signal,
      )) {
        switch (ev.type) {
          case 'start':
            result.model = `${ev.provider}/${ev.model}`;
            break;
          case 'text':
            text += ev.delta;
            emit({ type: 'text', delta: ev.delta });
            break;
          case 'tool_call': {
            const c = calls.get(ev.id) ?? { id: ev.id, name: ev.name, arguments: '' };
            c.arguments += ev.argsDelta;
            if (ev.name) c.name = ev.name;
            calls.set(ev.id, c);
            break;
          }
          case 'raw':
            raw = { adapter: ev.adapter, content: ev.content };
            break;
          case 'notice':
            emit({ type: 'notice', message: ev.message });
            break;
          case 'error':
            throw new Error(ev.message);
          case 'cost':
            stepUsd = ev.usd;
            stepIn = ev.inputTokens;
            stepOut = ev.outputTokens;
            break;
          default:
            break;
        }
      }
      result.usage.inputTokens += stepIn;
      result.usage.outputTokens += stepOut;
      result.usage.usd =
        result.usage.usd === null || stepUsd === null ? null : result.usage.usd + stepUsd;
      emit({ type: 'step', step, usd: stepUsd, inputTokens: stepIn, outputTokens: stepOut });
      if (text.trim()) result.text = text.trim();

      const toolCalls = [...calls.values()].map((c, i) => ({
        ...c,
        id: c.id || `call_${step}_${i}`,
      }));
      messages.push({
        role: 'assistant',
        content: text,
        ...(toolCalls.length ? { toolCalls } : {}),
        ...(raw ? { raw } : {}),
      });

      if (!toolCalls.length) {
        // Stop hooks may send the agent back to work once (exit 2 = "not done yet").
        if (!stopHookRan) {
          stopHookRan = true;
          const stop = await fire('Stop', { stop_hook_active: false });
          if (stop.block) {
            messages.push({
              role: 'user',
              content: `A Stop hook says the task is not finished:\n${stop.block}`,
            });
            continue;
          }
        }
        result.filesChanged = [...changed];
        return finish('done');
      }

      for (const call of toolCalls) {
        if (signal.aborted) return finish('aborted');
        const args = parseArgs(call.arguments);
        if (!args) {
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: 'The arguments were not valid JSON. Call the tool again with a JSON object.',
            isError: true,
          });
          result.tools.push({ name: call.name, args: {}, ok: false });
          continue;
        }
        emit({ type: 'tool_call', id: call.id, name: call.name, args });

        let denied: string | undefined;
        const d = decide(opts.approve, call.name, args);
        if (!d.allow) denied = d.reason;
        if (!denied) {
          const pre = await fire(
            'PreToolUse',
            { tool_name: call.name, tool_input: args },
            call.name,
          );
          if (pre.block) denied = `Blocked by a PreToolUse hook: ${pre.block}`;
        }
        if (denied) {
          result.tools.push({ name: call.name, args, ok: false, denied });
          emit({
            type: 'tool_result',
            id: call.id,
            name: call.name,
            ok: false,
            content: denied,
            denied,
          });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: denied,
            isError: true,
          });
          continue;
        }

        const out = await runTool(call.name, args, { root: cwd, signal, env });
        let content = out.content;
        if (out.changed) {
          changed.add(out.changed);
          emit({ type: 'file_changed', path: out.changed });
        }
        const post = await fire(
          'PostToolUse',
          {
            tool_name: call.name,
            tool_input: args,
            tool_response: { success: out.ok, output: out.content.slice(0, 20_000) },
          },
          call.name,
        );
        if (post.block) content += `\n\nA PostToolUse hook reported a problem:\n${post.block}`;
        else if (post.context.length) content += `\n\n${post.context.join('\n')}`;

        result.tools.push({ name: call.name, args, ok: out.ok });
        emit({ type: 'tool_result', id: call.id, name: call.name, ok: out.ok, content });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content,
          isError: !out.ok,
        });
      }
    }
  } catch (e) {
    result.filesChanged = [...changed];
    if (signal.aborted) return finish('aborted');
    if (isOmniError(e)) result.errorExit = exitCodeFor(e);
    return finish('error', e instanceof Error ? e.message : String(e));
  } finally {
    result.filesChanged = [...changed];
  }
}
