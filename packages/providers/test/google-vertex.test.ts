import { createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogEntry, ChatChunk } from '@omni/shared';
import { Secret, redact } from '@omni/security';
import {
  clearVertexTokenCache,
  getAdapter,
  googleVertex,
  parseVertexCredential,
  resolveVertexAuth,
  vertexUrl,
} from '@omni/providers';
import type { ProviderConfig } from '@omni/providers';
import { json, mockServer, sse } from '../../../tests/helpers/mock-server.js';

const closers: (() => Promise<void>)[] = [];
beforeEach(() => clearVertexTokenCache());
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

const CATALOG_BASE = 'https://aiplatform.googleapis.com/v1';

function entry(): CatalogEntry {
  return {
    id: 'google-vertex',
    name: 'Google Cloud Vertex AI',
    adapter: 'google-vertex',
    baseUrl: CATALOG_BASE,
    baseUrlParams: [
      { name: 'location', label: 'Location', default: 'global' },
      { name: 'project_id', label: 'Project', optional: true },
    ],
    auth: { type: 'header', header: 'x-goog-api-key' },
    envVars: [],
    region: 'global',
    category: 'enterprise',
    modelsEndpoint: null,
    supports: {
      listModels: false,
      streaming: true,
      tools: true,
      vision: true,
      jsonMode: true,
      embeddings: false,
      fim: false,
    },
    fallbackModels: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', inputPrice: 0.3, outputPrice: 2.5 },
    ],
    status: 'active',
    verifiedAt: null,
  };
}

// Fake credentials are assembled at runtime so no secret-looking literal lives in the repo.
const FAKE_API_KEY = ['vertex', 'test', 'key', '0'.repeat(16)].join('-');
const FAKE_ACCESS_TOKEN = ['ya29', 'fake', 'access', 'token', '0'.repeat(12)].join('.');

function serviceAccountJson(tokenUri: string, over: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const text = JSON.stringify(
    {
      type: 'service_account',
      project_id: 'sa-project',
      private_key_id: 'kid-1',
      private_key: pem,
      client_email: 'bot@sa-project.iam.gserviceaccount.com',
      token_uri: tokenUri,
      ...over,
    },
    null,
    2,
  );
  return { text, pem, publicKey };
}

const decode = (part: string) =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

async function collect(cfg: ProviderConfig): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of googleVertex.chat(
    cfg,
    {
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'sé breve' },
        { role: 'user', content: 'hola' },
      ],
    },
    new AbortController().signal,
  ))
    out.push(c);
  return out;
}

const geminiEvents = [
  { data: { candidates: [{ content: { parts: [{ text: 'Hola ', thoughtSignature: 'sig' }] } }] } },
  {
    data: {
      candidates: [{ content: { parts: [{ text: 'mundo' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    },
  },
];

describe('google-vertex URLs', () => {
  it('uses the regional host for regional locations', () => {
    expect(
      vertexUrl({
        location: 'us-central1',
        projectId: 'my-proj',
        model: 'gemini-2.5-pro',
        method: 'streamGenerateContent',
      }),
    ).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/my-proj/locations/us-central1/publishers/google/models/gemini-2.5-pro:streamGenerateContent',
    );
  });

  it('uses aiplatform.googleapis.com (no prefix) for the global location', () => {
    expect(
      vertexUrl({
        location: 'global',
        projectId: 'my-proj',
        model: 'google/gemini-3.5-flash',
        method: 'generateContent',
      }),
    ).toBe(
      'https://aiplatform.googleapis.com/v1/projects/my-proj/locations/global/publishers/google/models/gemini-3.5-flash:generateContent',
    );
  });

  it('uses the project-less express-mode path when no project is given', () => {
    expect(vertexUrl({ model: 'gemini-2.5-flash', method: 'generateContent' })).toBe(
      'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent',
    );
  });

  it('rejects locations that would change the host', () => {
    expect(() =>
      vertexUrl({
        location: 'evil.example.com/x',
        projectId: 'p',
        model: 'm',
        method: 'generateContent',
      }),
    ).toThrow(/invalid Vertex AI location/);
  });
});

describe('google-vertex credentials', () => {
  it('classifies API keys, access tokens and service-account JSON', () => {
    expect(parseVertexCredential(FAKE_API_KEY).kind).toBe('api-key');
    expect(parseVertexCredential(FAKE_ACCESS_TOKEN).kind).toBe('access-token');
    const sa = serviceAccountJson('https://oauth2.googleapis.com/token');
    // A pasted JSON flattened by a single-line <input> (newlines stripped) still parses.
    const flattened = sa.text.replace(/[\r\n]/g, '');
    expect(parseVertexCredential(flattened)).toMatchObject({
      kind: 'service-account',
      projectId: 'sa-project',
      clientEmail: 'bot@sa-project.iam.gserviceaccount.com',
    });
  });

  it('never echoes the secret in parse errors and registers the private key', () => {
    const broken = '{"private_key": "' + 'x'.repeat(40) + '", ';
    expect(() => parseVertexCredential(broken)).toThrow(/could not be parsed/);
    try {
      parseVertexCredential(broken);
    } catch (e) {
      expect(String(e)).not.toContain('x'.repeat(40));
    }
    const sa = serviceAccountJson('https://oauth2.googleapis.com/token');
    parseVertexCredential(sa.text);
    const keyBody = sa.pem.split('\n')[1]!;
    expect(redact(`oops ${sa.pem}`)).not.toContain(keyBody);
  });

  it('refuses token_uri hosts other than Google or loopback', () => {
    const sa = serviceAccountJson('https://attacker.example/token');
    expect(() => parseVertexCredential(sa.text)).toThrow(/token_uri/);
  });

  it('sends an API key as x-goog-api-key and allows express mode without a project', async () => {
    const auth = await resolveVertexAuth({
      entry: entry(),
      baseUrl: CATALOG_BASE,
      apiKey: new Secret(FAKE_API_KEY),
      params: { location: 'global' },
    });
    expect(auth).toEqual({
      headers: { 'x-goog-api-key': FAKE_API_KEY },
      projectId: undefined,
      projectOptional: true,
    });
  });

  it('sends a raw access token as bearer', async () => {
    const auth = await resolveVertexAuth({
      entry: entry(),
      baseUrl: CATALOG_BASE,
      apiKey: new Secret(FAKE_ACCESS_TOKEN),
      params: { project_id: 'p1' },
    });
    expect(auth.headers).toEqual({ authorization: `Bearer ${FAKE_ACCESS_TOKEN}` });
    expect(auth.projectId).toBe('p1');
  });

  it('mints a token with a signed JWT and caches it until shortly before expiry', async () => {
    let minted = 0;
    const tokenSrv = await mockServer((_req, res) => {
      minted++;
      json(res, 200, {
        access_token: ['fake', 'minted', String(minted), '0'.repeat(10)].join('-'),
        expires_in: 3600,
        token_type: 'Bearer',
      });
    });
    closers.push(tokenSrv.close);
    const sa = serviceAccountJson(`${tokenSrv.url}/token`);
    const cfg: ProviderConfig = {
      entry: entry(),
      baseUrl: CATALOG_BASE,
      apiKey: new Secret(sa.text),
      params: { location: 'global' },
    };

    const a = await resolveVertexAuth(cfg);
    const b = await resolveVertexAuth(cfg);
    expect(minted).toBe(1);
    expect(a.headers.authorization).toBe(`Bearer fake-minted-1-${'0'.repeat(10)}`);
    expect(b.headers).toEqual(a.headers);
    expect(a.projectId).toBe('sa-project');

    const req = tokenSrv.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/token');
    expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(req.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [h, p, s] = form.get('assertion')!.split('.');
    expect(decode(h!)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'kid-1' });
    const claims = decode(p!);
    expect(claims).toMatchObject({
      iss: 'bot@sa-project.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: `${tokenSrv.url}/token`,
    });
    expect((claims.exp as number) - (claims.iat as number)).toBe(3600);
    const ok = createVerify('RSA-SHA256')
      .update(`${h}.${p}`)
      .verify(sa.publicKey, Buffer.from(s!, 'base64url'));
    expect(ok).toBe(true);
    // The minted token is registered with the redactor.
    expect(redact(`x ${a.headers.authorization!.slice(7)} y`)).not.toContain('fake-minted-1');
  });

  it('refreshes a token that is within a minute of expiring', async () => {
    let minted = 0;
    const tokenSrv = await mockServer((_req, res) => {
      minted++;
      json(res, 200, { access_token: `short-lived-${minted}-${'0'.repeat(8)}`, expires_in: 30 });
    });
    closers.push(tokenSrv.close);
    const sa = serviceAccountJson(`${tokenSrv.url}/token`);
    const cfg: ProviderConfig = {
      entry: entry(),
      baseUrl: CATALOG_BASE,
      apiKey: new Secret(sa.text),
    };
    await resolveVertexAuth(cfg);
    await resolveVertexAuth(cfg);
    expect(minted).toBe(2);
  });

  it('reports token exchange failures without leaking the key', async () => {
    const tokenSrv = await mockServer((_req, res) =>
      json(res, 400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }),
    );
    closers.push(tokenSrv.close);
    const sa = serviceAccountJson(`${tokenSrv.url}/token`);
    const cfg: ProviderConfig = {
      entry: entry(),
      baseUrl: CATALOG_BASE,
      apiKey: new Secret(sa.text),
    };
    const err = await resolveVertexAuth(cfg).catch((e: unknown) => e as Error);
    expect(err.message).toBe(
      'Google OAuth token exchange failed (HTTP 400): invalid_grant: Invalid JWT Signature.',
    );
    expect(err.message).not.toContain('PRIVATE KEY');
  });
});

describe('google-vertex adapter', () => {
  it('is registered', () => {
    expect(getAdapter('google-vertex')).toBe(googleVertex);
  });

  it('streams with a service account against regional project URLs', async () => {
    const tokenSrv = await mockServer((_req, res) =>
      json(res, 200, { access_token: `tok-${'0'.repeat(12)}`, expires_in: 3600 }),
    );
    closers.push(tokenSrv.close);
    const api = await mockServer((_req, res) => sse(res, geminiEvents));
    closers.push(api.close);
    const sa = serviceAccountJson(`${tokenSrv.url}/token`);
    const cfg: ProviderConfig = {
      entry: entry(),
      baseUrl: `${api.url}/v1`,
      apiKey: new Secret(sa.text),
      params: { location: 'europe-west4', project_id: 'override-proj' },
    };
    const chunks = await collect(cfg);
    expect(
      chunks
        .filter((c) => c.type === 'text')
        .map((c) => (c as { delta: string }).delta)
        .join(''),
    ).toBe('Hola mundo');
    expect(chunks).toContainEqual({
      type: 'usage',
      inputTokens: 5,
      outputTokens: 2,
      cachedTokens: undefined,
    });
    expect(chunks).toContainEqual({
      type: 'raw',
      adapter: 'google-vertex',
      content: [{ text: 'Hola ', thoughtSignature: 'sig' }, { text: 'mundo' }],
    });
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });

    const req = api.requests[0]!;
    expect(req.url).toBe(
      '/v1/projects/override-proj/locations/europe-west4/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    );
    expect(req.headers.authorization).toBe(`Bearer tok-${'0'.repeat(12)}`);
    expect(req.headers['x-goog-api-key']).toBeUndefined();
    const body = JSON.parse(req.body);
    expect(body.systemInstruction.parts[0].text).toBe('sé breve');
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hola' }] }]);
  });

  it('streams in express mode with an API key and replays its own raw parts', async () => {
    const api = await mockServer((_req, res) => sse(res, geminiEvents));
    closers.push(api.close);
    const cfg: ProviderConfig = {
      entry: entry(),
      baseUrl: api.url,
      apiKey: new Secret(FAKE_API_KEY),
      params: { location: 'global' },
    };
    const out: ChatChunk[] = [];
    for await (const c of googleVertex.chat(
      cfg,
      {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'user', content: 'hola' },
          {
            role: 'assistant',
            content: 'x',
            raw: { adapter: 'google-vertex', content: [{ text: 'x', thoughtSignature: 's1' }] },
          },
          { role: 'user', content: 'otra' },
        ],
      },
      new AbortController().signal,
    ))
      out.push(c);
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
    const req = api.requests[0]!;
    expect(req.url).toBe(
      '/v1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    );
    expect(req.headers['x-goog-api-key']).toBe(FAKE_API_KEY);
    expect(req.headers.authorization).toBeUndefined();
    expect(JSON.parse(req.body).contents[1]).toEqual({
      role: 'model',
      parts: [{ text: 'x', thoughtSignature: 's1' }],
    });
  });

  it('requires a project for OAuth credentials', async () => {
    const cfg: ProviderConfig = {
      entry: entry(),
      baseUrl: CATALOG_BASE,
      apiKey: new Secret(FAKE_ACCESS_TOKEN),
      params: { location: 'global' },
    };
    await expect(collect(cfg)).rejects.toThrow(/project_id/);
  });

  it('lists the catalog models (no listing endpoint for publisher models)', async () => {
    const models = await googleVertex.listModels({
      entry: entry(),
      baseUrl: CATALOG_BASE,
      apiKey: new Secret(FAKE_API_KEY),
    });
    expect(models.map((m) => [m.id, m.source, m.inputPrice])).toEqual([
      ['gemini-2.5-flash', 'catalog', 0.3],
    ]);
  });
});
