/**
 * Playground (Phase 9): runs one prompt on one exact model with every knob (system,
 * temperature, top-p, max tokens, reasoning, tools, JSON Schema, attachments), streams it,
 * and reports cost, tokens, latency and whether the reply follows the schema. Compare is
 * the renderer running several of these at once. Also "Get code" and versioned templates.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ChatMessage, ContentPart, ToolDefinition } from '@omni/shared';
import type { OmniCore } from '@omni/core';
import { parseModelRef } from '@omni/core';
import type {
  PlaygroundEvent,
  PlaygroundParams,
  PlaygroundResult,
  PlaygroundRunRequest,
  PromptTemplate,
} from '../shared/playground.js';
import {
  addVersion,
  checkReply,
  isStrictCompatible,
  normalizeParams,
  parseSchema,
} from '../shared/playground.js';
import type { CodeLang } from '../shared/playgroundCode.js';
import { generateCode } from '../shared/playgroundCode.js';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const MAX_TEMPLATES = 200;

/** The ChatRequest pieces of a Playground run (exported for tests). */
export function buildMessages(req: PlaygroundRunRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (req.system.trim()) messages.push({ role: 'system', content: req.system });
  const parts: ContentPart[] = req.attachments.map((a) =>
    a.mediaType.startsWith('image/')
      ? { type: 'image', mediaType: a.mediaType, data: a.data }
      : { type: 'file', mediaType: a.mediaType, data: a.data, name: a.name },
  );
  messages.push({
    role: 'user',
    content: parts.length ? [...parts, { type: 'text', text: req.prompt }] : req.prompt,
  });
  return messages;
}

export function buildTools(req: PlaygroundRunRequest): ToolDefinition[] | undefined {
  return req.tools.length
    ? req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))
    : undefined;
}

export class PlaygroundService {
  private readonly running = new Map<string, AbortController>();
  private readonly file: string;

  constructor(
    private readonly core: OmniCore,
    dir: string,
  ) {
    this.file = join(dir, 'playground-templates.json');
  }

  async run(
    requestId: string,
    req: PlaygroundRunRequest,
    emit: (ev: PlaygroundEvent) => void,
  ): Promise<PlaygroundResult> {
    const parsed = parseSchema(req.schema);
    const result: PlaygroundResult = {
      model: req.model,
      text: '',
      reasoning: '',
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      usd: null,
      latencyMs: 0,
      notices: [],
    };
    const finish = () => {
      emit({ type: 'done', result });
      return result;
    };
    if (parsed.error) {
      result.error = parsed.error;
      return finish();
    }
    const ctrl = new AbortController();
    this.running.set(requestId, ctrl);
    const started = Date.now();
    const calls = new Map<string, { name: string; arguments: string }>();
    try {
      for await (const ev of this.core.stream(
        {
          model: req.model,
          role: 'chat',
          // Compare must hit the exact model asked for, never a fallback.
          noFallback: true,
          messages: buildMessages(req),
          tools: buildTools(req),
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          topP: req.topP,
          reasoning: req.reasoning,
          ...(parsed.schema
            ? {
                jsonMode: true,
                jsonSchema: {
                  name: 'response',
                  schema: parsed.schema,
                  strict: req.strict === true && isStrictCompatible(parsed.schema),
                },
              }
            : {}),
        },
        ctrl.signal,
      )) {
        switch (ev.type) {
          case 'start':
            result.provider = ev.provider;
            emit(ev);
            break;
          case 'text':
          case 'reasoning':
            result.firstTokenMs ??= Date.now() - started;
            if (ev.type === 'text') result.text += ev.delta;
            else result.reasoning += ev.delta;
            emit({ type: ev.type, delta: ev.delta });
            break;
          case 'tool_call': {
            result.firstTokenMs ??= Date.now() - started;
            const c = calls.get(ev.id) ?? { name: ev.name, arguments: '' };
            if (ev.name) c.name = ev.name;
            c.arguments += ev.argsDelta;
            calls.set(ev.id, c);
            break;
          }
          case 'notice':
            result.notices.push(ev.message);
            emit({ type: 'notice', message: ev.message });
            break;
          case 'cost':
            result.usd = ev.usd;
            result.inputTokens = ev.inputTokens;
            result.outputTokens = ev.outputTokens;
            result.latencyMs = ev.latencyMs;
            break;
          case 'done':
            result.stopReason = ev.stopReason;
            break;
          case 'error':
            result.error = ev.message;
            break;
        }
      }
    } catch (e) {
      result.error = ctrl.signal.aborted ? 'Cancelado.' : errorText(e);
    } finally {
      this.running.delete(requestId);
    }
    result.latencyMs ||= Date.now() - started;
    result.toolCalls = [...calls.values()];
    if (parsed.schema && !result.error && result.text.trim())
      result.json = checkReply(result.text, parsed.schema);
    return finish();
  }

  abort(requestId: string): void {
    this.running.get(requestId)?.abort();
  }

  /** "Get code" for the provider of `req.model`. Never includes a key. */
  async code(lang: CodeLang, req: PlaygroundRunRequest): Promise<string> {
    const ref = parseModelRef(req.model);
    const cfg = await this.core.providerConfig(ref.provider);
    return generateCode(
      lang,
      {
        adapter: cfg.entry.adapter,
        baseUrl: cfg.baseUrl.replace(/\/+$/, ''),
        envVar: cfg.entry.envVars[0] ?? `${ref.provider.toUpperCase().replace(/-/g, '_')}_API_KEY`,
        model: ref.model,
      },
      req,
    );
  }

  /** Catalog adapter of a model's provider (the panel warns about attachments it can't take). */
  async adapterOf(model: string): Promise<string | null> {
    try {
      return this.core.catalog.providers.get(parseModelRef(model).provider)?.adapter ?? null;
    } catch {
      return null;
    }
  }

  // ---------- templates ----------

  templates(): PromptTemplate[] {
    if (!existsSync(this.file)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(
          (t): t is PromptTemplate =>
            !!t &&
            typeof (t as PromptTemplate).id === 'string' &&
            typeof (t as PromptTemplate).name === 'string' &&
            Array.isArray((t as PromptTemplate).versions),
        )
        .map((t) => ({
          ...t,
          versions: t.versions
            .filter((v) => v && typeof v.v === 'number' && v.params)
            .map((v) => ({ ...v, params: normalizeParams(v.params) })),
        }));
    } catch {
      return [];
    }
  }

  private write(list: PromptTemplate[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 1));
    renameSync(tmp, this.file);
  }

  /**
   * Saves params as a new version of the template `id`, or as a new template named `name`
   * when id is absent. Returns the saved template.
   */
  saveTemplate(
    params: PlaygroundParams,
    opts: { id?: string; name?: string; model?: string; note?: string },
  ): PromptTemplate {
    const list = this.templates();
    let tpl = opts.id ? list.find((t) => t.id === opts.id) : undefined;
    if (opts.id && !tpl) throw new Error('Esa plantilla ya no existe.');
    if (!tpl) {
      if (list.length >= MAX_TEMPLATES) throw new Error(`Máximo ${MAX_TEMPLATES} plantillas.`);
      const name = (opts.name ?? '').trim().slice(0, 80) || 'Sin nombre';
      tpl = { id: `t${randomBytes(6).toString('hex')}`, name, versions: [] };
      list.push(tpl);
    } else if (opts.name?.trim()) tpl.name = opts.name.trim().slice(0, 80);
    const next = addVersion(tpl, params, Date.now(), { model: opts.model, note: opts.note });
    const i = list.findIndex((t) => t.id === tpl.id);
    list[i] = next;
    this.write(list);
    return next;
  }

  deleteTemplate(id: string): void {
    this.write(this.templates().filter((t) => t.id !== id));
  }
}
