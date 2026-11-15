/** Fase 10: media generation wire formats, response parsing and cost estimates. */
import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from '@omni/shared';
import { Secret } from '@omni/security';
import {
  MEDIA_MODELS,
  estimateMediaCost,
  fileId,
  findMediaModel,
  findOutputs,
  geminiMedia,
  geminiMediaBody,
  getMediaProvider,
  openAiImageBody,
  openAiMedia,
  openAiSpeechBody,
} from '@omni/providers';
import type { ProviderConfig } from '@omni/providers';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function fakeFetch(handler: (c: Call) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const c: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(c);
    return handler(c);
  }) as typeof fetch;
  return { fetch: f, calls };
}

function cfg(id: string, baseUrl: string, auth: CatalogEntry['auth'], f: typeof fetch): ProviderConfig {
  return {
    entry: { id, name: id, adapter: 'openai-compatible', baseUrl, auth } as CatalogEntry,
    baseUrl,
    apiKey: new Secret('sk-test'),
    fetch: f,
    maxRetries: 0,
  };
}

const json = (v: unknown) =>
  new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
const PNG = Buffer.from('fake-png').toString('base64');

describe('media catalog', () => {
  it('has unique ids and a source for every entry', () => {
    const keys = MEDIA_MODELS.map((m) => `${m.provider}/${m.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of MEDIA_MODELS) {
      expect(m.source).toMatch(/^https:\/\//);
      expect(m.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('estimates images by quality and shape', () => {
    const m = findMediaModel('openai', 'gpt-image-2');
    expect(estimateMediaCost(m, { prompt: 'x', count: 2, quality: 'medium', aspect: '1:1' }).usd).toBeCloseTo(0.106);
    expect(estimateMediaCost(m, { prompt: 'x', quality: 'high', aspect: '16:9' }).usd).toBeCloseTo(0.165);
  });

  it('estimates speech by characters or by audio tokens', () => {
    const text = 'a'.repeat(1000);
    expect(estimateMediaCost(findMediaModel('openai', 'tts-1'), { prompt: text }).usd).toBeCloseTo(0.015);
    const g = estimateMediaCost(findMediaModel('google-gemini', 'gemini-3.8-flash-tts'), { prompt: text });
    expect(g.approximate).toBe(true);
    expect(g.usd).toBeGreaterThan(0);
  });

  it('never guesses an unpublished price', () => {
    const e = estimateMediaCost(findMediaModel('google-gemini', 'gemini-omni-1.2-flash'), { prompt: 'x' });
    expect(e.usd).toBeNull();
    expect(estimateMediaCost(undefined, { prompt: 'x' }).usd).toBeNull();
  });

  it('clamps the image count to the model maximum', () => {
    const m = findMediaModel('google-gemini', 'gemini-nano-banana-2.1');
    expect(estimateMediaCost(m, { prompt: 'x', count: 9 }).usd).toBeCloseTo(0.034 * 4);
  });
});

describe('OpenAI media', () => {
  it('builds the image body and warns about what it changes', () => {
    const { body, warnings } = openAiImageBody({
      kind: 'image',
      model: 'gpt-image-2',
      prompt: 'Un faro',
      style: 'acuarela',
      aspect: '9:16',
      seed: 3,
      transparent: true,
    });
    expect(body).toMatchObject({ model: 'gpt-image-2', size: '1024x1536', n: 1, output_format: 'png' });
    expect(body.prompt).toContain('acuarela');
    expect(body.background).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/semilla/);
    expect(warnings.join(' ')).toMatch(/transparente/);
  });

  it('sends instructions only to gpt-*-tts models', () => {
    expect(openAiSpeechBody({ kind: 'speech', model: 'gpt-4o-mini-tts', prompt: 'Hola', style: 'alegre' }).body.instructions).toBe('alegre');
    const t = openAiSpeechBody({ kind: 'speech', model: 'tts-1', prompt: 'Hola', style: 'alegre', voice: 'marin' });
    expect(t.body.instructions).toBeUndefined();
    expect(t.body.voice).toBe('alloy');
    expect(t.warnings).toHaveLength(2);
  });

  it('decodes generated images', async () => {
    const { fetch, calls } = fakeFetch(() => json({ data: [{ b64_json: PNG }, { b64_json: PNG }] }));
    const c = cfg('openai', 'https://api.openai.com/v1', { type: 'bearer', header: 'Authorization' }, fetch);
    const r = await openAiMedia.generate(c, { kind: 'image', model: 'gpt-image-2', prompt: 'x', count: 2 }, new AbortController().signal);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/images/generations');
    expect(calls[0]!.headers.authorization).toBe('Bearer sk-test');
    expect(r.files).toHaveLength(2);
    expect(Buffer.from(r.files[0]!.data).toString()).toBe('fake-png');
  });

  it('returns speech audio as a file', async () => {
    const { fetch } = fakeFetch(
      () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
    );
    const c = cfg('openai', 'https://api.openai.com/v1', { type: 'bearer' }, fetch);
    const r = await openAiMedia.generate(c, { kind: 'speech', model: 'tts-1', prompt: 'Hola' }, new AbortController().signal);
    expect(r.files[0]).toMatchObject({ mediaType: 'audio/mpeg', ext: 'mp3' });
    expect(r.files[0]!.data).toHaveLength(3);
  });

  it('explains that OpenAI video is gone', async () => {
    const c = cfg('openai', 'https://api.openai.com/v1', { type: 'bearer' }, fakeFetch(() => json({})).fetch);
    await expect(
      openAiMedia.generate(c, { kind: 'video', model: 'sora-2', prompt: 'x' }, new AbortController().signal),
    ).rejects.toThrow(/Sora/);
  });
});

describe('Gemini media (Interactions API)', () => {
  const base = 'https://generativelanguage.googleapis.com/v1beta';
  const auth = { type: 'header', header: 'x-goog-api-key' } as const;

  it('clamps video duration and aspect', () => {
    const { body, warnings } = geminiMediaBody({
      kind: 'video',
      model: 'gemini-omni-1.2-flash',
      prompt: 'Un gato',
      durationSec: 40,
      aspect: '1:1',
    });
    expect(body.response_format).toMatchObject({ type: 'video', duration: '15s', aspect_ratio: '16:9', delivery: 'uri' });
    expect(warnings).toHaveLength(2);
  });

  it('puts the voice and style where TTS reads them', () => {
    const { body } = geminiMediaBody({ kind: 'speech', model: 'gemini-3.8-flash-tts', prompt: 'Hola', voice: 'Puck', style: 'susurrando' });
    expect(body.generation_config).toEqual({ speech_config: [{ voice: 'Puck' }] });
    expect(JSON.stringify(body.input)).toContain('susurrando');
  });

  it('finds outputs in model steps but not in the echoed input', () => {
    const resp = {
      input: [{ type: 'image', data: 'IN' }],
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'ok' }, { type: 'image', data: 'OUT', mime_type: 'image/jpeg' }] }],
    };
    expect(findOutputs(resp, 'image')).toEqual([{ type: 'image', data: 'OUT', uri: undefined, mimeType: 'image/jpeg' }]);
    expect(fileId('https://generativelanguage.googleapis.com/v1beta/files/abc-123')).toBe('abc-123');
  });

  it('makes one call per image', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({ id: 'i1', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'image', data: PNG }] }] }),
    );
    const r = await geminiMedia.generate(
      cfg('google-gemini', base, auth, fetch),
      { kind: 'image', model: 'gemini-nano-banana-2.1', prompt: 'x', count: 2, aspect: '16:9' },
      new AbortController().signal,
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(`${base}/interactions`);
    expect(calls[0]!.headers['x-goog-api-key']).toBe('sk-test');
    expect(calls[0]!.headers['api-revision']).toBeDefined();
    expect(r.files).toHaveLength(2);
  });

  it('polls an unfinished interaction, waits for the file and downloads the video', async () => {
    let polls = 0;
    const { fetch, calls } = fakeFetch((c) => {
      if (c.method === 'POST') return json({ id: 'v1', status: 'in_progress' });
      if (c.url.endsWith('/interactions/v1'))
        return json({ id: 'v1', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', uri: `${base}/files/f9`, mime_type: 'video/mp4' }] }] });
      if (c.url.endsWith('/files/f9')) return json({ state: polls++ ? 'ACTIVE' : 'PROCESSING' });
      if (c.url.includes('/files/f9:download')) return new Response(new Uint8Array([9, 9]), { status: 200 });
      return new Response('?', { status: 404 });
    });
    const c = cfg('google-gemini', base, auth, fetch);
    const realSetTimeout = globalThis.setTimeout;
    // Skip the 5 s poll waits.
    globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as typeof setTimeout;
    try {
      const r = await geminiMedia.generate(c, { kind: 'video', model: 'gemini-omni-1.2-flash', prompt: 'x' }, new AbortController().signal);
      expect(r.files[0]).toMatchObject({ mediaType: 'video/mp4', ext: 'mp4' });
      expect(r.files[0]!.data).toHaveLength(2);
      expect(calls.at(-1)!.url).toContain('alt=media');
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  it('reports a failed interaction', async () => {
    const { fetch } = fakeFetch(() => json({ id: 'x', status: 'failed', error: { message: 'contenido bloqueado' } }));
    await expect(
      geminiMedia.generate(cfg('google-gemini', base, auth, fetch), { kind: 'image', model: 'gemini-3-pro-image', prompt: 'x' }, new AbortController().signal),
    ).rejects.toThrow(/contenido bloqueado/);
  });
});

describe('registry', () => {
  it('knows openai and google-gemini only', () => {
    expect(getMediaProvider('openai').kinds).toContain('image');
    expect(() => getMediaProvider('mistral')).toThrow();
  });
});
