import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { CatalogEntry, OmniError } from '@omni/shared';

const ModelRef = z.string().regex(/^[a-z0-9][a-z0-9-]*\/.+$/, 'expected <provider>/<model>');

export const Budget = z.object({
  /** USD. */
  daily: z.number().positive().optional(),
  monthly: z.number().positive().optional(),
  /** Block requests at 100 %; otherwise only warn. */
  hardStop: z.boolean().default(true),
});
export type Budget = z.infer<typeof Budget>;

export const ROLES = [
  'chat',
  'inline',
  'autocomplete',
  'agent',
  'commit',
  'security',
  'embeddings',
] as const;
export type Role = (typeof ROLES)[number];

export const OmniConfig = z.object({
  version: z.literal(1).default(1),
  locale: z.enum(['es', 'en']).optional(),
  defaultModel: ModelRef.optional(),
  /** Model per IDE role (chat, inline edit, autocomplete...). Falls back to defaultModel. */
  roles: z.partialRecord(z.enum(ROLES), ModelRef).default({}),
  /** Tried in order when the primary model fails with a retryable error. */
  fallbacks: z.array(ModelRef).default([]),
  providers: z
    .record(
      z.string(),
      z.object({
        /** Values for {placeholders} in the catalog baseUrl. */
        params: z.record(z.string(), z.string()).default({}),
        baseUrl: z.string().url().optional(),
        headers: z.record(z.string(), z.string()).default({}),
        /** Where the key lives (never the key itself). */
        keyStore: z.enum(['keychain', 'file']).optional(),
      }),
    )
    .default({}),
  customProviders: z.array(CatalogEntry).default([]),
  /** User price overrides, USD per 1M tokens, keyed by provider/model. */
  prices: z
    .record(
      z.string(),
      z.object({ input: z.number().nonnegative(), output: z.number().nonnegative() }),
    )
    .default({}),
  budgets: z.record(z.string(), Budget).default({}),
  privacy: z
    .object({
      /** "100 % local" profile: cloud providers are blocked. */
      localOnly: z.boolean().default(false),
      /** Scrub secrets from outgoing prompts. */
      redactSecrets: z.boolean().default(true),
    })
    .default({ localOnly: false, redactSecrets: true }),
  telemetry: z.boolean().default(false),
  modelCacheTtlHours: z.number().positive().default(24),
});
export type OmniConfig = z.infer<typeof OmniConfig>;

export function loadConfig(file: string): OmniConfig {
  if (!existsSync(file)) return OmniConfig.parse({});
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new OmniError('config', `${file}: invalid JSON (${(e as Error).message})`);
  }
  const parsed = OmniConfig.safeParse(raw);
  if (!parsed.success) {
    throw new OmniError(
      'config',
      `${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}

/** Atomic write, mode 600. The config never holds keys, but it does hold account ids. */
export function saveConfig(file: string, cfg: OmniConfig): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(OmniConfig.parse(cfg), null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
}

/** Dotted-path get/set used by `omni config get|set`. */
export function getPath(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    );
}

export function setPath(cfg: OmniConfig, path: string, rawValue: string): OmniConfig {
  let value: unknown = rawValue;
  try {
    value = JSON.parse(rawValue);
  } catch {
    // plain string
  }
  const clone = structuredClone(cfg) as Record<string, unknown>;
  const keys = path.split('.');
  let cur = clone;
  for (const k of keys.slice(0, -1)) {
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
  const parsed = OmniConfig.safeParse(clone);
  if (!parsed.success)
    throw new OmniError(
      'config',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  return parsed.data;
}
