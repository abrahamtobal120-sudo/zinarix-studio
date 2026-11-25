import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { exitCodeFor, isOmniError } from '@omni/shared';
import type { ChatMessage, ToolCall } from '@omni/shared';
import type { ApproveLevel } from './agentPolicy.js';
import { decide, toolsFor } from './agentPolicy.js';
import type { HookEvent, ProjectContext, ProjectHook } from './agentProject.js';
import { hookMatches, loadProject, projectPrompt, runHook } from './agentProject.js';
import { TOOL_DEFS, cleanEnv, projectCommands, projectTree, runTool } from './agentTools.js';
import type { OmniEvent, StreamRequest } from './omni.js';
import {
  ToolTagFilter,
  leakedToolCalls,
  parseToolCalls,
  protocolBlock,
  resultsMessage,
  toolsUnsupported,
  withProtocol,
} from './textTools.js';

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

/** Identical calls in a row before the run stops as stuck (the 3rd already warns). */
const MAX_REPEATS = 5;

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
  // The file map goes with the task, not in the system prompt: that one stays identical
  // between runs, so providers can cache it.
  const tree = projectTree(cwd);
  const commands = opts.approve === 'full' ? projectCommands(cwd) : '';
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        opts.prompt,
        prompt.context.length
          ? `<hook-context>\n${prompt.context.join('\n')}\n</hook-context>`
          : '',
        tree ? `<project-files>\n${tree}\n</project-files>` : '',
        commands ? `<project-commands>\n${commands}\n</project-commands>` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
  const changed = new Set<string>();
  const seen = new Set<string>();
  let stopHookRan = false;
  let nudged = false;
  let lastCall = '';
  let repeats = 0;
  // Native function calling first; the text protocol (textTools.ts) once the provider
  // refuses the tools or the model writes its calls as plain JSON instead of calling them.
  let mode = 'native' as 'native' | 'text';
  let retries = 0;
  let cutRounds = 0;
  /** The parts of a cut-off answer already received. */
  let carried = '';
  const toolNames = new Set(toolDefs.map((t) => t.name));
  const protocol = protocolBlock(toolDefs, false);
  const toText = (why: string): void => {
    mode = 'text';
    emit({ type: 'notice', message: `${why}: tools go as text from now on` });
  };

  try {
    for (let step = 1; ; step++) {
      if (signal.aborted) return finish('aborted');
      if (step > maxSteps) return finish('max_steps', `stopped after ${maxSteps} steps`);
      result.steps = step;

      let text = '';
      let cut = false;
      const calls = new Map<string, ToolCall>();
      let raw: { adapter: string; content: unknown } | undefined;
      let stepUsd: number | null = null;
      let stepIn = 0;
      let stepOut = 0;
      const filter = mode === 'text' ? new ToolTagFilter() : undefined;
      const request: StreamRequest =
        mode === 'text'
          ? {
              model: opts.model,
              role: 'agent',
              messages: withProtocol(messages, protocol, 'system'),
              cwd,
            }
          : { model: opts.model, role: 'agent', messages, tools: toolDefs, cwd };
      try {
        for await (const ev of stream(request, signal)) {
          switch (ev.type) {
            case 'start':
              result.model = `${ev.provider}/${ev.model}`;
              break;
            case 'text': {
              text += ev.delta;
              const shown = filter ? filter.push(ev.delta) : ev.delta;
              if (shown) emit({ type: 'text', delta: shown });
              break;
            }
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
            case 'done':
              cut = ev.stopReason === 'max_tokens';
              break;
            default:
              break;
          }
        }
      } catch (e) {
        if (mode === 'native' && !text && !calls.size && retries < 1 && toolsUnsupported(e)) {
          retries++;
          toText('the model has no function calling');
          step--;
          continue;
        }
        throw e;
      }
      const rest = filter?.flush();
      if (rest) emit({ type: 'text', delta: rest });
      result.usage.inputTokens += stepIn;
      result.usage.outputTokens += stepOut;
      result.usage.usd =
        result.usage.usd === null || stepUsd === null ? null : result.usage.usd + stepUsd;
      emit({ type: 'step', step, usd: stepUsd, inputTokens: stepIn, outputTokens: stepOut });
      let toolCalls: ToolCall[] = [...calls.values()].map((c, i) => ({
        ...c,
        id: c.id || `call_${step}_${i}`,
      }));
      let badCalls: string[] = [];
      if (mode === 'native' && !toolCalls.length) {
        // The calls came as JSON in the answer: nothing ran. They are run now, and the
        // rest of the conversation uses the text protocol, which such a model follows.
        const leaked = leakedToolCalls(text, toolNames, `t${step}c`);
        if (leaked.calls.length || leaked.errors.length) {
          toText('the model wrote its tool calls as text');
          toolCalls = leaked.calls;
          badCalls = leaked.errors;
          text = leaked.visible;
          messages.push({ role: 'assistant', content: leaked.kept });
        }
      } else if (mode === 'text') {
        let parsed = parseToolCalls(text, `t${step}c`);
        if (!parsed.calls.length && !parsed.errors.length)
          parsed = leakedToolCalls(text, toolNames, `t${step}c`);
        toolCalls = parsed.calls;
        badCalls = parsed.errors;
        if (toolCalls.length || badCalls.length) text = parsed.visible;
        messages.push({ role: 'assistant', content: parsed.kept || text });
      }
      if (text.trim()) result.text = (carried + text).trim();
      if (mode === 'native')
        messages.push({
          role: 'assistant',
          content: text,
          ...(toolCalls.length ? { toolCalls } : {}),
          ...(raw ? { raw } : {}),
        });
      // Text protocol: every result of the step goes back in one user message.
      const textResults: { name: string; ok: boolean; content: string }[] = [];
      const reply = (call: ToolCall, content: string, isError: boolean): void => {
        if (mode === 'text') textResults.push({ name: call.name, ok: !isError, content });
        else
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content,
            isError,
          });
      };

      if (!toolCalls.length && !badCalls.length) {
        // The answer hit the output limit: it is not finished, the model goes on from there.
        if (cut && text.trim() && cutRounds < 3) {
          cutRounds++;
          carried += text;
          emit({ type: 'notice', message: 'the answer hit the output limit: continuing' });
          messages.push({
            role: 'user',
            content:
              'Your answer was cut off by the output limit. Continue exactly where you stopped, without repeating what you already wrote. If you were about to use a tool, call it now.',
          });
          continue;
        }
        carried = '';
        // Small models often show the new code in the answer and stop, without saving it.
        if (!nudged && opts.approve !== 'read-only' && !changed.size && text.includes('```')) {
          nudged = true;
          emit({ type: 'notice', message: 'the answer shows code but no file changed: asking' });
          messages.push({
            role: 'user',
            content:
              'You wrote code in your answer but did not change any file: nothing was saved. If the task needs a change, make it now with edit_file or write_file. If no change is needed, say so in one line.',
          });
          continue;
        }
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
          reply(
            call,
            'The arguments were not valid JSON. Call the tool again with a JSON object.',
            true,
          );
          result.tools.push({ name: call.name, args: {}, ok: false });
          continue;
        }
        emit({ type: 'tool_call', id: call.id, name: call.name, args });
        // The same call over and over gets a warning, then the run stops: it would only
        // spend steps (and money) until the limit.
        const signature = `${call.name} ${JSON.stringify(args)}`;
        repeats = signature === lastCall ? repeats + 1 : 0;
        lastCall = signature;
        if (repeats >= MAX_REPEATS) {
          result.filesChanged = [...changed];
          return finish(
            'error',
            `stuck: the model made the same ${call.name} call ${repeats + 1} times in a row`,
          );
        }

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
          reply(call, denied, true);
          continue;
        }

        const out = await runTool(call.name, args, { root: cwd, signal, env, seen });
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
        if (repeats >= 2)
          content += `\n\nYou have made this exact call ${repeats + 1} times in a row and the result is the same. Repeating it will not help: do something different.`;

        result.tools.push({ name: call.name, args, ok: out.ok });
        emit({ type: 'tool_result', id: call.id, name: call.name, ok: out.ok, content });
        reply(call, content, !out.ok);
      }
      if (mode === 'text')
        messages.push({ role: 'user', content: resultsMessage(textResults, badCalls) });
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
