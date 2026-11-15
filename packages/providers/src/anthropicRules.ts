/**
 * What the Anthropic Messages API accepts per Claude model, so a request with a knob the
 * model rejects is adjusted instead of failing with a 400. Pure: the adapter uses it to build
 * the body, and the Playground uses it to tell the user what was changed (and for "Get code").
 *
 * Rules (Anthropic docs, 2026-11):
 * - Opus 4.7+ and every Claude 5 / Fable / Mythos model: temperature, top_p and top_k are
 *   rejected (Sonnet 5.5 / Haiku 5.5 reject non-default values) → never sent.
 * - Other Claude 4.x models: temperature OR top_p, not both. With thinking on, temperature
 *   must be 1 and top_p 0.95–1.
 * - Adaptive thinking exists from Opus/Sonnet 4.6; Claude 3.7 and 4.0–4.5 use
 *   `{type: "enabled", budget_tokens}`; older models have no thinking. `effort` exists from
 *   Opus 4.5 (not Sonnet / Haiku 4.5).
 * - Structured outputs: every object needs additionalProperties:false; numeric
 *   (minimum, maximum, multipleOf…), string length and complex array constraints are
 *   rejected (the reply is still validated against the full schema by the caller).
 * Models that are not Claude (Anthropic-compatible endpoints of other vendors) are untouched.
 */

export interface ClaudeModel {
  family: 'opus' | 'sonnet' | 'haiku' | 'fable' | 'mythos' | 'other';
  major: number;
  minor: number;
}

/** Parses "claude-opus-4-7", "claude-3-5-haiku-latest", "anthropic.claude-sonnet-4-5-2025…". */
export function claudeModel(id: string): ClaudeModel | null {
  const m = id.toLowerCase();
  if (!m.includes('claude')) return null;
  // New style: claude-<family>-<major>[-<minor>]; a date suffix (8 digits) is not a minor.
  const n = /claude-(opus|sonnet|haiku|fable|mythos)-(\d)(?:[-.](\d{1,2})(?!\d))?/.exec(m);
  if (n)
    return {
      family: n[1] as ClaudeModel['family'],
      major: Number(n[2]),
      minor: n[3] ? Number(n[3]) : 0,
    };
  // Old style: claude-3-5-sonnet, claude-3-opus, claude-2.1.
  const o = /claude-(\d)(?:[-.](\d))?(?:-(opus|sonnet|haiku))?/.exec(m);
  if (o)
    return {
      family: (o[3] as ClaudeModel['family'] | undefined) ?? 'other',
      major: Number(o[1]),
      minor: o[2] ? Number(o[2]) : 0,
    };
  // "claude" with no version we recognize: assume a current model.
  return { family: 'other', major: 9, minor: 0 };
}

const atLeast = (c: ClaudeModel, major: number, minor: number) =>
  c.major > major || (c.major === major && c.minor >= minor);

/** True when the model rejects temperature / top_p / top_k entirely. */
export function noSampling(c: ClaudeModel): boolean {
  if (c.family === 'fable' || c.family === 'mythos') return true;
  if (c.major >= 5) return true;
  return c.family === 'opus' && atLeast(c, 4, 7);
}

export type ThinkingStyle = 'adaptive' | 'budget' | 'none';

export function thinkingStyle(c: ClaudeModel): ThinkingStyle {
  if (c.family === 'fable' || c.family === 'mythos' || c.major >= 5) return 'adaptive';
  if (c.major === 4) return c.minor >= 6 ? 'adaptive' : 'budget';
  if (c.major === 3 && c.minor >= 7) return 'budget';
  return 'none';
}

/** Whether output_config.effort is accepted. */
export function acceptsEffort(c: ClaudeModel): boolean {
  if (thinkingStyle(c) === 'adaptive') return true;
  return c.family === 'opus' && atLeast(c, 4, 5);
}

const BUDGET = { low: 2048, medium: 8192, high: 16384 } as const;

export interface ClaudeKnobs {
  temperature?: number;
  topP?: number;
  thinking?: Record<string, unknown>;
  effort?: 'low' | 'medium' | 'high';
  /** What was changed, for the user ("temperature: este modelo no la acepta"). */
  dropped: string[];
}

/**
 * The sampling / thinking fields to send for a Claude model. For non-Claude models
 * (claudeModel() === null) everything passes through as adaptive thinking.
 */
export function claudeKnobs(
  model: string,
  req: { temperature?: number; topP?: number; reasoning?: 'low' | 'medium' | 'high' },
  maxTokens: number,
): ClaudeKnobs {
  const c = claudeModel(model);
  const out: ClaudeKnobs = { dropped: [] };
  const adaptive = { type: 'adaptive', display: 'summarized' };
  if (!c) {
    if (req.temperature !== undefined) out.temperature = req.temperature;
    if (req.topP !== undefined) out.topP = req.topP;
    if (req.reasoning) {
      out.thinking = adaptive;
      out.effort = req.reasoning;
    }
    return out;
  }
  const style = thinkingStyle(c);
  let thinking = false;
  if (req.reasoning) {
    if (style === 'adaptive') out.thinking = adaptive;
    else if (style === 'budget') {
      // budget_tokens: ≥ 1024 and below max_tokens.
      const budget = Math.min(BUDGET[req.reasoning], maxTokens - 1024);
      if (budget >= 1024) out.thinking = { type: 'enabled', budget_tokens: budget };
      else out.dropped.push('thinking: max_tokens es muy bajo para razonar (mínimo 2048)');
    } else out.dropped.push('thinking: este modelo no razona');
    thinking = out.thinking !== undefined;
    if (acceptsEffort(c)) out.effort = req.reasoning;
  }
  if (noSampling(c)) {
    if (req.temperature !== undefined)
      out.dropped.push('temperature: este modelo no acepta parámetros de muestreo');
    if (req.topP !== undefined)
      out.dropped.push('top_p: este modelo no acepta parámetros de muestreo');
    return out;
  }
  let temperature = req.temperature;
  let topP = req.topP;
  if (thinking && temperature !== undefined && temperature !== 1) {
    out.dropped.push('temperature: con razonamiento activo debe ser 1');
    temperature = undefined;
  }
  if (thinking && topP !== undefined && (topP < 0.95 || topP > 1)) {
    out.dropped.push('top_p: con razonamiento activo debe estar entre 0.95 y 1');
    topP = undefined;
  }
  if (c.major >= 4 && temperature !== undefined && topP !== undefined) {
    out.dropped.push('top_p: Claude 4 no acepta temperature y top_p a la vez (se usa temperature)');
    topP = undefined;
  }
  if (temperature !== undefined) out.temperature = temperature;
  if (topP !== undefined) out.topP = topP;
  return out;
}

const UNSUPPORTED = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
];

/** Keywords whose value is data, not a sub-schema. */
const LITERAL = new Set(['enum', 'const', 'default', 'examples', 'required']);

/**
 * A JSON Schema Claude's structured outputs accept: objects get additionalProperties:false
 * and the constraints it rejects are removed (minItems above 1 too). Returns the copy and
 * what changed. The input is not modified.
 */
export function claudeSchema(schema: Record<string, unknown>): {
  schema: Record<string, unknown>;
  changed: string[];
} {
  const changed = new Set<string>();
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 64 || typeof v !== 'object' || v === null) return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const s: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (UNSUPPORTED.includes(k)) {
        changed.add(k);
        continue;
      }
      if (k === 'minItems' && typeof x === 'number' && x > 1) {
        changed.add('minItems');
        continue;
      }
      if (LITERAL.has(k)) s[k] = x;
      else if (k === 'properties' || k === '$defs' || k === 'definitions') {
        const inner: Record<string, unknown> = {};
        for (const [name, sub] of Object.entries((x ?? {}) as Record<string, unknown>))
          inner[name] = walk(sub, depth + 1);
        s[k] = inner;
      } else s[k] = walk(x, depth + 1);
    }
    const isObject =
      s.type === 'object' ||
      (Array.isArray(s.type) && s.type.includes('object')) ||
      'properties' in s;
    if (isObject && s.additionalProperties !== false) {
      changed.add('additionalProperties');
      s.additionalProperties = false;
    }
    return s;
  };
  return { schema: walk(schema, 0) as Record<string, unknown>, changed: [...changed] };
}
