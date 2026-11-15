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
import { claudeKnobs, claudeModel, claudeSchema } from '@omni/providers';
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
import type { ClaudeThinking, CodeLang } from '../shared/playgroundCode.js';
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

/** Adapters that enforce a JSON Schema natively (packages/providers: keep in step). */
const NATIVE_SCHEMA = new Set([
  'anthropic',
  'openai-compatible',
  'openai-responses',
  'google-gemini',
  'google-vertex',
]);

export function supportsSchema(adapter: string | null): boolean {
  return adapter === null || NATIVE_SCHEMA.has(adapter);
}

/**
 * For a provider that drops jsonSchema, the schema goes into the system prompt instead,
 * so the model still knows the shape (the reply is checked against it afterwards anyway).
 */
export function withSchemaInstructions(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
): ChatMessage[] {
  const note =
    'Responde SOLO con un objeto JSON válido (sin texto alrededor ni bloques de código) que cumpla este JSON Schema:\n' +
    JSON.stringify(schema, null, 2);
  const [first, ...rest] = messages;
  if (first?.role === 'system' && typeof first.content === 'string')
    return [{ role: 'system', content: `${first.content}\n\n${note}` }, ...rest];
  return [{ role: 'system', content: note }, ...messages];
}

/** Default max_tokens of the Anthropic adapter (packages/providers: keep in step). */
const ANTHROPIC_MAX_TOKENS = 32_000;

/**
 * What the Anthropic adapter will change for this Claude model (sampling knobs it rejects,
 * thinking style, schema keywords), as readable notices, plus the request as it is really
 * sent, which is what "Get code" writes. Other adapters and non-Claude models: unchanged.
 */
export function claudeAdjust(
  adapter: string | null,
  req: PlaygroundRunRequest,
  defaultMaxTokens = ANTHROPIC_MAX_TOKENS,
): { req: PlaygroundRunRequest; notices: string[]; claude?: ClaudeThinking } {
  const model = req.model.slice(req.model.indexOf('/') + 1);
  if (adapter !== 'anthropic' || !claudeModel(model)) return { req, notices: [] };
  const knobs = claudeKnobs(model, req, req.maxTokens ?? defaultMaxTokens);
  const notices = knobs.dropped.map((d) => `No se envió ${d}.`);
  const out: PlaygroundRunRequest = { ...req };
  if (knobs.temperature === undefined) delete out.temperature;
  if (knobs.topP === undefined) delete out.topP;
  if (!knobs.thinking) delete out.reasoning;
  const parsed = parseSchema(req.schema);
  if (parsed.schema) {
    const fixed = claudeSchema(parsed.schema);
    if (fixed.changed.length) {
      out.schema = JSON.stringify(fixed.schema, null, 2);
      const removed = fixed.changed.filter((k) => k !== 'additionalProperties');
      const parts = [
        ...(removed.length ? [`se quitó ${removed.join(', ')}`] : []),
        ...(fixed.changed.includes('additionalProperties')
          ? ['los objetos van con additionalProperties: false']
          : []),
      ];
      notices.push(
        `Esquema ajustado para Claude (${parts.join('; ')}). La respuesta se comprueba con tu esquema completo.`,
      );
    }
  }
  return {
    req: out,
    notices,
    claude: { thinking: knobs.thinking ?? null, effort: knobs.effort !== undefined },
  };
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
    let messages = buildMessages(req);
    const adapter = await this.adapterOf(req.model);
    for (const msg of claudeAdjust(adapter, req).notices) {
      result.notices.push(msg);
      emit({ type: 'notice', message: msg });
    }
    if (parsed.schema && !supportsSchema(adapter)) {
      messages = withSchemaInstructions(messages, parsed.schema);
      const msg =
        'Este proveedor no impone el JSON Schema: se le pidió en las instrucciones y la respuesta se comprueba al final.';
      result.notices.push(msg);
      emit({ type: 'notice', message: msg });
    }
    try {
      for await (const ev of this.core.stream(
        {
          model: req.model,
          role: 'chat',
          // Compare must hit the exact model asked for, never a fallback.
          noFallback: true,
          messages,
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
    // The snippet writes max_tokens 16000 when none is set (playgroundCode.ts).
    const { req: sent, notices, claude } = claudeAdjust(cfg.entry.adapter, req, 16000);
    const code = generateCode(
      lang,
      {
        adapter: cfg.entry.adapter,
        baseUrl: cfg.baseUrl.replace(/\/+$/, ''),
        envVar: cfg.entry.envVars[0] ?? `${ref.provider.toUpperCase().replace(/-/g, '_')}_API_KEY`,
        model: ref.model,
        ...(claude ? { claude } : {}),
      },
      sent,
    );
    if (!notices.length) return code;
    const mark = lang === 'ts' ? '//' : '#';
    return [...notices.map((n) => `${mark} ${n}`), code].join(String.fromCharCode(10));
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
