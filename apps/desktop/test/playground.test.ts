/** Phase 9: Playground (schema, compare, code, templates) and Build. */
import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OmniCore } from '@omni/core';
import {
  EMPTY_PARAMS,
  addVersion,
  checkReply,
  compareBadges,
  isStrictCompatible,
  parseJsonReply,
  parseSchema,
  validateJson,
} from '../src/shared/playground.js';
import type {
  PlaygroundResult,
  PlaygroundRunRequest,
  PromptTemplate,
} from '../src/shared/playground.js';
import { generateCode } from '../src/shared/playgroundCode.js';
import {
  PlaygroundService,
  supportsSchema,
  withSchemaInstructions,
} from '../src/main/playground.js';
import { BuildService, collectFiles } from '../src/main/build.js';
import { slugify, vercelName } from '../src/shared/build.js';
import type { Vercel } from '../src/main/vercel.js';

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1 },
    done: { type: 'boolean' },
    priority: { enum: ['low', 'high'] },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'done', 'priority', 'tags'],
  additionalProperties: false,
};

const req = (over: Partial<PlaygroundRunRequest> = {}): PlaygroundRunRequest => ({
  ...EMPTY_PARAMS,
  prompt: 'Dame una tarea',
  model: 'openai/gpt-x',
  attachments: [],
  ...over,
});

describe('schema and JSON check', () => {
  it('parses the schema box and requires an object root', () => {
    expect(parseSchema('')).toEqual({});
    expect(parseSchema('{').error).toMatch(/JSON inválido/);
    expect(parseSchema('{"type":"string"}').error).toMatch(/object/);
    expect(parseSchema(JSON.stringify(SCHEMA)).schema).toEqual(SCHEMA);
  });

  it('knows when OpenAI strict mode accepts a schema', () => {
    expect(isStrictCompatible(SCHEMA)).toBe(true);
    expect(isStrictCompatible({ ...SCHEMA, required: ['title'] })).toBe(false);
    expect(
      isStrictCompatible({
        type: 'object',
        properties: {
          a: { type: 'object', properties: { b: { type: 'string' } }, required: ['b'] },
        },
        required: ['a'],
        additionalProperties: false,
      }),
    ).toBe(false); // nested object lacks additionalProperties:false
  });

  it('accepts a fenced reply and reports schema errors with a path', () => {
    const good = { title: 'Pan', done: false, priority: 'low', tags: ['casa'] };
    expect(parseJsonReply('```json\n' + JSON.stringify(good) + '\n```').value).toEqual(good);
    expect(checkReply(JSON.stringify(good), SCHEMA)).toEqual({
      ok: true,
      parsed: true,
      errors: [],
    });
    const bad = checkReply(
      JSON.stringify({ title: '', done: 'no', priority: 'mid', tags: [1], x: 1 }),
      SCHEMA,
    );
    expect(bad.ok).toBe(false);
    expect(bad.errors.join('\n')).toMatch(/\$\.title: mínimo 1/);
    expect(bad.errors.join('\n')).toMatch(/\$\.done: se esperaba boolean/);
    expect(bad.errors.join('\n')).toMatch(/\$\.tags\[0\]/);
    expect(bad.errors.join('\n')).toMatch(/no permitida "x"/);
    expect(checkReply('Claro, aquí va: {', SCHEMA)).toMatchObject({ ok: false, parsed: false });
  });

  it('does not take inherited names (constructor, toString) as present or allowed', () => {
    const s = {
      type: 'object',
      properties: {},
      required: ['constructor'],
      additionalProperties: false,
    };
    expect(validateJson({}, s)).toEqual(['$: falta la propiedad "constructor"']);
    expect(
      validateJson(
        { toString: 1 },
        { type: 'object', properties: {}, additionalProperties: false },
      ),
    ).toEqual(['$: propiedad no permitida "toString"']);
  });

  it('follows $ref into $defs, also inside anyOf', () => {
    const s = {
      type: 'object',
      $defs: { item: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } },
      properties: { a: { anyOf: [{ $ref: '#/$defs/item' }, { type: 'null' }] } },
    };
    expect(validateJson({ a: { n: 2 } }, s)).toEqual([]);
    expect(validateJson({ a: null }, s)).toEqual([]);
    expect(validateJson({ a: { n: 1.5 } }, s)).toHaveLength(1);
  });
});

describe('compare and templates', () => {
  const r = (over: Partial<PlaygroundResult>): PlaygroundResult => ({
    model: 'm',
    text: '',
    reasoning: '',
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    usd: null,
    latencyMs: 100,
    notices: [],
    ...over,
  });

  it('marks the cheapest and fastest of the successful runs', () => {
    const b = compareBadges([
      r({ usd: 0.002, latencyMs: 900 }),
      r({ usd: 0.001, latencyMs: 400 }),
      r({ usd: 0.0001, latencyMs: 50, error: 'falló' }),
    ]);
    expect(b.get(1)).toEqual(['cheapest', 'fastest']);
    expect(b.has(0)).toBe(false);
    expect(b.has(2)).toBe(false);
  });

  it('versions templates and skips saving the same params twice', () => {
    let t: PromptTemplate = { id: 't1', name: 'x', versions: [] };
    t = addVersion(t, { ...EMPTY_PARAMS, prompt: 'hola' }, 1);
    const same = addVersion(t, { ...EMPTY_PARAMS, prompt: 'hola' }, 2);
    expect(same).toBe(t);
    t = addVersion(t, { ...EMPTY_PARAMS, prompt: 'hola {{nombre}}', temperature: 0.3 }, 3);
    expect(t.versions.map((v) => v.v)).toEqual([1, 2]);
    expect(t.versions[1]!.params.temperature).toBe(0.3);
  });

  it('persists templates on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    try {
      const svc = new PlaygroundService({} as OmniCore, dir);
      const a = svc.saveTemplate({ ...EMPTY_PARAMS, prompt: 'uno' }, { name: 'Mi plantilla' });
      svc.saveTemplate({ ...EMPTY_PARAMS, prompt: 'dos' }, { id: a.id });
      const again = new PlaygroundService({} as OmniCore, dir).templates();
      expect(again).toHaveLength(1);
      expect(again[0]!.versions.map((v) => v.params.prompt)).toEqual(['uno', 'dos']);
      expect(() => svc.saveTemplate(EMPTY_PARAMS, { id: 'nope' })).toThrow(/ya no existe/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Get code', () => {
  const r = req({ system: 'Eres útil', schema: JSON.stringify(SCHEMA), temperature: 0.2 });

  it('writes the schema in each provider format and never a key', () => {
    const openai = generateCode(
      'ts',
      {
        adapter: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        envVar: 'OPENAI_API_KEY',
        model: 'gpt-x',
      },
      r,
    );
    expect(openai).toMatch(/json_schema/);
    expect(openai).toMatch(/OPENAI_API_KEY/);
    const anth = generateCode(
      'python',
      {
        adapter: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        envVar: 'ANTHROPIC_API_KEY',
        model: 'claude-x',
      },
      r,
    );
    expect(anth).toMatch(/json_schema/);
    const gem = generateCode(
      'curl',
      {
        adapter: 'google-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        envVar: 'GEMINI_API_KEY',
        model: 'gemini-x',
      },
      r,
    );
    expect(gem).toMatch(/responseJsonSchema|responseSchema/);
    expect(gem).toMatch(/\$GEMINI_API_KEY/);
    for (const c of [openai, anth, gem]) expect(c).not.toMatch(/sk-|AIza/);
  });

  it('says so for a provider it does not cover', () => {
    expect(
      generateCode('ts', { adapter: 'replicate', baseUrl: '', envVar: 'X', model: 'm' }, r),
    ).toMatch(/todavía no cubre/);
  });
});

/** A core whose stream replays `chunks` and records the request. */
function fakeCore(adapter: string, reply: string) {
  const seen: Record<string, unknown>[] = [];
  const core = {
    catalog: { providers: new Map([['openai', { adapter }]]) },
    async *stream(r: Record<string, unknown>) {
      seen.push(r);
      yield { type: 'start', provider: 'openai', model: 'gpt-x' };
      for (const part of [reply.slice(0, 5), reply.slice(5)]) yield { type: 'text', delta: part };
      yield { type: 'cost', usd: 0.0012, inputTokens: 30, outputTokens: 12, latencyMs: 321 };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
  return { core: core as unknown as OmniCore, seen };
}

describe('PlaygroundService.run', () => {
  const good = JSON.stringify({ title: 'Pan', done: false, priority: 'high', tags: [] });

  it('sends the schema natively, streams and checks the reply', async () => {
    const { core, seen } = fakeCore('openai-compatible', good);
    const events: string[] = [];
    const res = await new PlaygroundService(core, tmpdir()).run(
      'r1',
      req({ schema: JSON.stringify(SCHEMA), strict: true, topP: 0.5 }),
      (e) => events.push(e.type),
    );
    expect(res).toMatchObject({
      text: good,
      usd: 0.0012,
      inputTokens: 30,
      outputTokens: 12,
      latencyMs: 321,
    });
    expect(res.json).toEqual({ ok: true, parsed: true, errors: [] });
    expect(seen[0]).toMatchObject({
      noFallback: true,
      topP: 0.5,
      jsonSchema: { name: 'response', schema: SCHEMA, strict: true },
    });
    expect(events.at(-1)).toBe('done');
  });

  it('puts the schema in the instructions when the provider cannot enforce it', async () => {
    const { core, seen } = fakeCore('aws-bedrock', good);
    const res = await new PlaygroundService(core, tmpdir()).run(
      'r2',
      req({ model: 'openai/x', system: 'Sé breve', schema: JSON.stringify(SCHEMA) }),
      () => undefined,
    );
    const msgs = seen[0]!.messages as { role: string; content: string }[];
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toMatch(/^Sé breve\n\n.*JSON Schema/s);
    expect(msgs[0]!.content).toContain('"priority"');
    expect(res.notices.join(' ')).toMatch(/no impone el JSON Schema/);
    expect(res.json?.ok).toBe(true);
  });

  it('refuses a broken schema without calling the model', async () => {
    const { core, seen } = fakeCore('openai-compatible', good);
    const res = await new PlaygroundService(core, tmpdir()).run(
      'r3',
      req({ schema: '{nope' }),
      () => undefined,
    );
    expect(res.error).toMatch(/JSON inválido/);
    expect(seen).toHaveLength(0);
  });

  it('helpers: native adapters and the system note', () => {
    expect(supportsSchema('google-vertex')).toBe(true);
    expect(supportsSchema('writer')).toBe(false);
    const m = withSchemaInstructions([{ role: 'user', content: 'hola' }], { type: 'object' });
    expect(m.map((x) => x.role)).toEqual(['system', 'user']);
  });
});

describe('Claude: the Playground says what the adapter adjusts', () => {
  const good = JSON.stringify({ title: 'Pan', done: false, priority: 'high', tags: [] });

  it('run: notices for dropped sampling knobs and the adjusted schema', async () => {
    const { core } = fakeCore('anthropic', good);
    const res = await new PlaygroundService(core, tmpdir()).run(
      'c1',
      req({
        model: 'openai/claude-opus-5-5',
        temperature: 0.3,
        topP: 0.9,
        schema: JSON.stringify(SCHEMA),
      }),
      () => undefined,
    );
    const all = res.notices.join(' ');
    expect(all).toMatch(/temperature/);
    expect(all).toMatch(/top_p/);
    expect(all).toMatch(/se quitó minLength/);
    // Still validated against the user's full schema.
    expect(res.json?.ok).toBe(true);
  });

  it('run: no notices for a model that takes everything', async () => {
    const { core } = fakeCore('anthropic', good);
    const res = await new PlaygroundService(core, tmpdir()).run(
      'c2',
      req({ model: 'openai/claude-sonnet-4-6', temperature: 0.3 }),
      () => undefined,
    );
    expect(res.notices).toEqual([]);
    const other = await new PlaygroundService(
      fakeCore('openai-compatible', good).core,
      tmpdir(),
    ).run('c3', req({ model: 'openai/claude-opus-5-5', temperature: 0.3 }), () => undefined);
    expect(other.notices).toEqual([]);
  });

  it('Get code writes the body the model accepts, with the reasons on top', async () => {
    const core = {
      async providerConfig() {
        return {
          entry: { adapter: 'anthropic', envVars: ['ANTHROPIC_API_KEY'] },
          baseUrl: 'https://api.anthropic.com/v1/',
        };
      },
    } as unknown as OmniCore;
    const svc = new PlaygroundService(core, tmpdir());
    const haiku = await svc.code(
      'curl',
      req({ model: 'anthropic/claude-haiku-4-5', reasoning: 'medium', temperature: 0.5 }),
    );
    expect(haiku).toMatch(/^# No se envió temperature/);
    expect(haiku).toMatch(/"budget_tokens": 8192/);
    expect(haiku).not.toMatch(/"effort"|"temperature"|adaptive/);
    const opus = await svc.code(
      'ts',
      req({
        model: 'anthropic/claude-opus-5-5',
        reasoning: 'high',
        schema: JSON.stringify(SCHEMA),
      }),
    );
    expect(opus).toMatch(/^\/\/ Esquema ajustado para Claude/);
    expect(opus).toMatch(/adaptive/);
    expect(opus).toMatch(/effort: "high"/);
    expect(opus).toMatch(/se quitó minLength/); // the reason, in the comment…
    expect(opus).not.toMatch(/minLength: 1/); // …and not in the schema sent
  });
});

describe('Build', () => {
  it('names the app from the description', () => {
    expect(slugify('Hazme una app de tareas con prioridades')).toBe('tareas-prioridades');
    expect(slugify('¡¡¡')).toBe('mi-app');
    expect(vercelName('Mi App___Ñ')).toMatch(/^[a-z0-9._-]+$/);
  });

  it('creates a to-do app folder and deploys only its public files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-'));
    try {
      const deployed: { name: string; files: string[]; production: boolean }[] = [];
      const vercel = {
        async deployFiles(
          name: string,
          files: { file: string }[],
          _t: string | null,
          production: boolean,
        ) {
          deployed.push({ name, files: files.map((f) => f.file).sort(), production });
          return { id: 'dpl_abc123', url: 'tareas.vercel.app', state: 'QUEUED' };
        },
        async deploymentState() {
          return 'READY';
        },
      } as unknown as Vercel;
      const svc = new BuildService(join(dir, 'data'), () => vercel);
      const b = svc.create(join(dir, 'apps'), 'Una app de tareas');
      expect(b.root).toBe(join(dir, 'apps', 'tareas'));
      expect(readFileSync(join(b.root, '.zinarix', 'rules.md'), 'utf8')).toMatch(/estática/);
      expect(existsSync(join(b.root, 'index.html'))).toBe(true);
      // Same description again → a free name, never overwriting.
      expect(svc.create(join(dir, 'apps'), 'Una app de tareas').root).toBe(
        join(dir, 'apps', 'tareas-2'),
      );

      // What the agent would write, plus things that must never be published.
      writeFileSync(join(b.root, 'app.js'), 'console.log(1)');
      writeFileSync(join(b.root, '.env'), 'SECRET=1');
      mkdirSync(join(b.root, 'node_modules', 'x'), { recursive: true });
      writeFileSync(join(b.root, 'node_modules', 'x', 'i.js'), '');
      try {
        symlinkSync(tmpdir(), join(b.root, 'link'), 'junction');
      } catch {
        /* no symlink rights: the rest still holds */
      }

      const d = await svc.deploy(b.root, null, false);
      expect(d).toEqual({ id: 'dpl_abc123', url: 'tareas.vercel.app', state: 'QUEUED' });
      expect(deployed[0]).toEqual({
        name: 'tareas',
        files: ['app.js', 'index.html'],
        production: false,
      });
      expect(svc.info(b.root)?.lastDeploy).toMatchObject({ id: 'dpl_abc123', production: false });
      expect(svc.recent().map((x) => x.root)).toEqual([join(dir, 'apps', 'tareas-2'), b.root]);
      expect(await svc.deployState('dpl_abc123', null)).toBe('READY');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses folders not made with Build or without index.html', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-'));
    try {
      const svc = new BuildService(dir, () => ({}) as Vercel);
      await expect(svc.deploy(dir, null, true)).rejects.toThrow(/no se creó con Build/);
      const b = svc.create(dir, 'calculadora simple');
      rmSync(join(b.root, 'index.html'));
      await expect(svc.deploy(b.root, null, true)).rejects.toThrow(/index\.html/);
      expect(collectFiles(b.root)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
