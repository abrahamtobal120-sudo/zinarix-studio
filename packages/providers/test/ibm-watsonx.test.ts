import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogEntry, ChatChunk, ChatRequest } from '@omni/shared';
import { Secret, redact } from '@omni/security';
import type { ProviderConfig } from '../src/types.js';
import {
  IBM_SAAS_IAM_URL,
  WATSONX_API_VERSION,
  clearWatsonxTokenCache,
  ibmWatsonx,
  lifecycleState,
  watsonxAccessToken,
  watsonxRoot,
} from '../src/adapters/ibm-watsonx.js';
import { json, mockServer, sse } from '../../../tests/helpers/mock-server.js';
import type { RecordedRequest } from '../../../tests/helpers/mock-server.js';

const closers: (() => Promise<void>)[] = [];
beforeEach(() => clearWatsonxTokenCache());
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

const CATALOG_BASE = 'https://{region}.ml.cloud.ibm.com';
// Fake credentials are assembled at runtime so no secret-looking literal lives in the repo.
const FAKE_KEY = ['ibm', 'fake', 'apikey', '0'.repeat(24)].join('-');
const fakeToken = (n: number) => ['iam', 'tok', String(n), '0'.repeat(16)].join('-');

function entry(): CatalogEntry {
  return {
    id: 'ibm-watsonx-ai',
    name: 'IBM watsonx.ai',
    adapter: 'ibm-watsonx',
    baseUrl: CATALOG_BASE,
    baseUrlParams: [
      { name: 'region', label: 'Region', default: 'us-south' },
      { name: 'project_id', label: 'Project ID', optional: true },
      { name: 'space_id', label: 'Space ID', optional: true },
    ],
    auth: { type: 'bearer', header: 'Authorization' },
    envVars: [],
    region: 'global',
    category: 'enterprise',
    modelsEndpoint: '/ml/v1/foundation_model_specs',
    supports: {
      listModels: true,
      streaming: true,
      tools: true,
      vision: true,
      jsonMode: true,
      embeddings: false,
      fim: false,
    },
    fallbackModels: [{ id: 'ibm/granite-4-h-small', label: 'Granite 4 H Small', context: 131072 }],
    status: 'active',
    verifiedAt: null,
  };
}

async function iamServer(opts: { status?: number; body?: unknown; expiresIn?: number } = {}) {
  let minted = 0;
  const srv = await mockServer((_req, res) => {
    minted++;
    if (opts.status) return json(res, opts.status, opts.body ?? {});
    const now = Math.floor(Date.now() / 1000);
    const ttl = opts.expiresIn ?? 3600;
    json(res, 200, {
      access_token: fakeToken(minted),
      refresh_token: 'not_supported',
      token_type: 'Bearer',
      expires_in: ttl,
      expiration: now + ttl,
    });
  });
  closers.push(srv.close);
  return { ...srv, minted: () => minted };
}

async function apiServer(handler: Parameters<typeof mockServer>[0]) {
  const srv = await mockServer(handler);
  closers.push(srv.close);
  return srv;
}

function cfgFor(
  apiUrl: string,
  iamUrl: string,
  params: Record<string, string> = { project_id: 'proj-1' },
): ProviderConfig {
  return {
    entry: entry(),
    baseUrl: `${apiUrl}/ml/v1`,
    apiKey: new Secret(FAKE_KEY),
    params: { iam_url: `${iamUrl}/identity/token`, ...params },
    maxRetries: 0,
  };
}

async function collect(cfg: ProviderConfig, req: Partial<ChatRequest> = {}): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of ibmWatsonx.chat(
    cfg,
    {
      model: 'ibm/granite-4-h-small',
      messages: [
        { role: 'system', content: 'sé breve' },
        { role: 'user', content: 'hola' },
      ],
      ...req,
    },
    new AbortController().signal,
  ))
    out.push(c);
  return out;
}

const textOf = (chunks: ChatChunk[]) =>
  chunks
    .filter((c): c is Extract<ChatChunk, { type: 'text' }> => c.type === 'text')
    .map((c) => c.delta)
    .join('');

const textStream = [
  {
    event: 'message',
    data: {
      id: 'chat-1',
      model_id: 'ibm/granite-4-h-small',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'Hola ' } }],
    },
  },
  {
    event: 'message',
    data: {
      id: 'chat-1',
      model_id: 'ibm/granite-4-h-small',
      choices: [{ index: 0, delta: { content: 'mundo' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
    },
  },
];

describe('ibm-watsonx URLs', () => {
  it('builds IBM Cloud and AWS hosts from the region param', () => {
    const base = { entry: entry(), apiKey: new Secret(FAKE_KEY) };
    expect(
      watsonxRoot({
        ...base,
        baseUrl: 'https://eu-de.ml.cloud.ibm.com',
        params: { region: 'eu-de' },
      }),
    ).toBe('https://eu-de.ml.cloud.ibm.com');
    expect(
      watsonxRoot({
        ...base,
        baseUrl: 'https://ap-south-1.ml.cloud.ibm.com',
        params: { region: 'ap-south-1' },
      }),
    ).toBe('https://ap-south-1.aws.wxai.ibm.com');
    // Unset region → us-south.
    expect(watsonxRoot({ ...base, baseUrl: 'https://.ml.cloud.ibm.com', params: {} })).toBe(
      'https://us-south.ml.cloud.ibm.com',
    );
    // Custom base URLs (CPD, proxies) are kept, minus a trailing /ml/v1.
    expect(watsonxRoot({ ...base, baseUrl: 'https://cpd.example.com/ml/v1', params: {} })).toBe(
      'https://cpd.example.com',
    );
  });

  it('rejects regions that would change the host', () => {
    expect(() =>
      watsonxRoot({
        entry: entry(),
        baseUrl: 'https://evil.example/x.ml.cloud.ibm.com',
        params: { region: 'evil.example/x' },
      }),
    ).toThrow(/invalid watsonx.ai region/);
  });

  it('reads the current lifecycle state', () => {
    expect(
      lifecycleState(
        {
          lifecycle: [
            { id: 'available', start_date: '2024-01-01' },
            { id: 'deprecated', start_date: '2025-01-01' },
            { id: 'withdrawn', start_date: '2099-01-01' },
          ],
        },
        Date.parse('2026-01-01'),
      ),
    ).toBe('deprecated');
  });
});

describe('ibm-watsonx IAM tokens', () => {
  it('exchanges the API key once and caches the token', async () => {
    const iam = await iamServer();
    const cfg = cfgFor('http://127.0.0.1:1', iam.url);
    const a = await watsonxAccessToken(cfg);
    const b = await watsonxAccessToken(cfg);
    expect(a).toBe(fakeToken(1));
    expect(b).toBe(a);
    expect(iam.minted()).toBe(1);

    const req = iam.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/identity/token');
    expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(req.body);
    expect(form.get('grant_type')).toBe('urn:ibm:params:oauth:grant-type:apikey');
    expect(form.get('apikey')).toBe(FAKE_KEY);
    // The minted token is registered with the redactor.
    expect(redact(`x ${a} y`)).not.toContain(fakeToken(1));
  });

  it('refreshes a token that is within 5 minutes of expiring', async () => {
    const iam = await iamServer({ expiresIn: 120 });
    const cfg = cfgFor('http://127.0.0.1:1', iam.url);
    expect(await watsonxAccessToken(cfg)).toBe(fakeToken(1));
    expect(await watsonxAccessToken(cfg)).toBe(fakeToken(2));
  });

  it('reports IAM failures as auth errors without leaking the key', async () => {
    const iam = await iamServer({
      status: 400,
      body: {
        errorCode: 'BXNIM0415E',
        errorMessage: `Provided API key could not be found. ${FAKE_KEY}`,
      },
    });
    const err = (await watsonxAccessToken(cfgFor('http://127.0.0.1:1', iam.url)).catch(
      (e: unknown) => e,
    )) as { code: string; status: number; message: string };
    expect(err.code).toBe('auth');
    expect(err.status).toBe(400);
    expect(err.message).toMatch(
      /^IBM IAM token exchange failed \(HTTP 400\): BXNIM0415E: Provided API key/,
    );
    expect(err.message).not.toContain(FAKE_KEY);
  });

  it('refuses iam_url hosts outside IBM or loopback', async () => {
    const cfg = cfgFor('http://127.0.0.1:1', 'https://attacker.example');
    await expect(watsonxAccessToken(cfg)).rejects.toThrow(/iam_url/);
  });

  it('uses the IBM SaaS account IAM (JSON body) for watsonx on AWS', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const claims = Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url');
    const awsToken = `eyJhbGciOiJub25lIn0.${claims}.sig`;
    const fakeFetch = (async (url: URL | string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ token: awsToken }), { status: 200 });
    }) as typeof fetch;
    const token = await watsonxAccessToken({
      entry: entry(),
      baseUrl: 'https://ap-south-1.ml.cloud.ibm.com',
      apiKey: new Secret(FAKE_KEY),
      params: { region: 'ap-south-1', project_id: 'p' },
      fetch: fakeFetch,
    });
    expect(token).toBe(awsToken);
    expect(calls[0]!.url).toBe(IBM_SAAS_IAM_URL);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ apikey: FAKE_KEY });
  });
});

describe('ibm-watsonx chat', () => {
  it('streams text and usage with the IAM token and project_id', async () => {
    const iam = await iamServer();
    const api = await apiServer((_req, res) => sse(res, textStream));
    const cfg = cfgFor(api.url, iam.url);
    const chunks = await collect(cfg, { maxTokens: 64, temperature: 0.2 });
    expect(textOf(chunks)).toBe('Hola mundo');
    expect(chunks).toContainEqual({ type: 'usage', inputTokens: 11, outputTokens: 3 });
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });

    const req = api.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`/ml/v1/text/chat_stream?version=${WATSONX_API_VERSION}`);
    expect(req.headers.authorization).toBe(`Bearer ${fakeToken(1)}`);
    expect(JSON.stringify(req.headers)).not.toContain(FAKE_KEY);
    expect(JSON.parse(req.body)).toEqual({
      model_id: 'ibm/granite-4-h-small',
      project_id: 'proj-1',
      messages: [
        { role: 'system', content: 'sé breve' },
        { role: 'user', content: 'hola' },
      ],
      max_tokens: 64,
      temperature: 0.2,
    });

    // A second request reuses the cached token.
    await collect(cfg);
    expect(iam.minted()).toBe(1);
  });

  it('streams tool calls and sends tools / tool history in OpenAI shape', async () => {
    const iam = await iamServer();
    const api = await apiServer((_req, res) =>
      sse(res, [
        {
          data: {
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'chatcmpl-tool-1',
                      type: 'function',
                      function: { name: 'read_file', arguments: '{"path":' },
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          data: {
            choices: [
              {
                index: 0,
                delta: { tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 40, completion_tokens: 9 },
          },
        },
      ]),
    );
    const chunks = await collect(cfgFor(api.url, iam.url, { space_id: 'space-9' }), {
      messages: [
        { role: 'user', content: 'lee a.ts' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c0', name: 'read_file', arguments: '{"path":"b.ts"}' }],
        },
        { role: 'tool', toolCallId: 'c0', content: 'contenido' },
      ],
      tools: [
        {
          name: 'read_file',
          description: 'Lee un archivo',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
    });
    const calls = chunks.filter((c) => c.type === 'tool_call');
    expect(calls).toEqual([
      { type: 'tool_call', id: 'chatcmpl-tool-1', name: 'read_file', argsDelta: '{"path":' },
      { type: 'tool_call', id: 'chatcmpl-tool-1', name: 'read_file', argsDelta: '"a.ts"}' },
    ]);
    expect(chunks).toContainEqual({ type: 'usage', inputTokens: 40, outputTokens: 9 });
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });

    const body = JSON.parse(api.requests[0]!.body);
    expect(body.space_id).toBe('space-9');
    expect(body.project_id).toBeUndefined();
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Lee un archivo',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
    ]);
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      tool_calls: [
        {
          id: 'c0',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"b.ts"}' },
        },
      ],
    });
    expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: 'c0', content: 'contenido' });
  });

  it('requires a project_id or space_id before calling the network', async () => {
    const iam = await iamServer();
    const cfg = cfgFor('http://127.0.0.1:1', iam.url, {});
    await expect(collect(cfg)).rejects.toMatchObject({
      code: 'config',
      message: expect.stringMatching(/project_id/),
    });
    expect(iam.minted()).toBe(0);
  });

  it('maps watsonx error bodies to normalized errors', async () => {
    const iam = await iamServer();
    const api = await apiServer((_req, res) =>
      json(res, 404, {
        errors: [
          {
            code: 'model_not_supported',
            message: "Model 'x/y' is not supported",
          },
        ],
        trace: 'abc',
        status_code: 404,
      }),
    );
    const err = (await collect(cfgFor(api.url, iam.url), { model: 'x/y' }).catch(
      (e: unknown) => e,
    )) as { code: string; status: number; message: string };
    expect(err.code).toBe('not_found');
    expect(err.status).toBe(404);
    expect(err.message).toBe("HTTP 404: model_not_supported: Model 'x/y' is not supported");
  });

  it('re-mints the token once on a 401', async () => {
    const iam = await iamServer();
    let n = 0;
    const api = await apiServer((_req: RecordedRequest, res) => {
      n++;
      if (n === 1)
        return json(res, 401, {
          errors: [{ code: 'authentication_token_expired', message: 'expired' }],
        });
      sse(res, textStream);
    });
    const chunks = await collect(cfgFor(api.url, iam.url));
    expect(textOf(chunks)).toBe('Hola mundo');
    expect(iam.minted()).toBe(2);
    expect(api.requests[1]!.headers.authorization).toBe(`Bearer ${fakeToken(2)}`);
  });

  it('surfaces mid-stream error events', async () => {
    const iam = await iamServer();
    const api = await apiServer((_req, res) =>
      sse(res, [
        textStream[0]!,
        { event: 'error', data: { errors: [{ code: 'internal', message: 'boom' }] } },
      ]),
    );
    await expect(collect(cfgFor(api.url, iam.url))).rejects.toThrow('internal: boom');
  });
});

describe('ibm-watsonx models', () => {
  const specs = {
    total_count: 4,
    resources: [
      {
        model_id: 'ibm/granite-4-h-small',
        label: 'granite-4-h-small',
        functions: [{ id: 'text_chat' }, { id: 'text_generation' }],
        task_ids: ['question_answering', 'function_calling'],
        model_limits: { max_sequence_length: 131072, max_output_tokens: 16384 },
        lifecycle: [{ id: 'available', start_date: '2025-10-02' }],
      },
      {
        model_id: 'meta-llama/llama-4-maverick-17b-128e-instruct-fp8',
        label: 'llama-4-maverick',
        functions: [{ id: 'text_chat' }, { id: 'image_chat' }],
        model_limits: { max_sequence_length: 131072 },
        lifecycle: [{ id: 'available', start_date: '2025-04-06' }],
      },
      {
        model_id: 'mistralai/mistral-medium-2505',
        functions: [{ id: 'text_chat' }],
        lifecycle: [
          { id: 'available', start_date: '2025-05-01' },
          { id: 'deprecated', start_date: '2025-12-01' },
        ],
      },
      {
        model_id: 'ibm/granite-8b-code-instruct',
        lifecycle: [
          { id: 'available', start_date: '2024-05-01' },
          { id: 'withdrawn', start_date: '2025-06-01' },
        ],
      },
    ],
  };

  it('lists chat models from foundation_model_specs, skipping deprecated and withdrawn', async () => {
    const iam = await iamServer();
    const api = await apiServer((_req, res) => json(res, 200, specs));
    const models = await ibmWatsonx.listModels(cfgFor(api.url, iam.url));
    expect(models.map((m) => m.id)).toEqual([
      'ibm/granite-4-h-small',
      'meta-llama/llama-4-maverick-17b-128e-instruct-fp8',
    ]);
    expect(models[0]).toMatchObject({
      provider: 'ibm-watsonx-ai',
      label: 'granite-4-h-small',
      kind: 'chat',
      context: 131072,
      maxOutput: 16384,
      source: 'live',
      capabilities: { tools: true },
    });
    expect(models[1]!.capabilities.vision).toBe(true);

    const url = new URL(api.requests[0]!.url, 'http://x');
    expect(url.pathname).toBe('/ml/v1/foundation_model_specs');
    expect(url.searchParams.get('version')).toBe(WATSONX_API_VERSION);
    expect(url.searchParams.get('filters')).toBe('function_text_chat,!lifecycle_withdrawn:and');
    expect(api.requests[0]!.headers.authorization).toBe(`Bearer ${fakeToken(1)}`);
  });

  it('testConnection exchanges the key and counts models', async () => {
    const iam = await iamServer();
    const api = await apiServer((_req, res) => json(res, 200, specs));
    expect(await ibmWatsonx.testConnection(cfgFor(api.url, iam.url))).toEqual({
      ok: true,
      models: 2,
    });
  });

  it('testConnection reports a bad key as an auth failure', async () => {
    const iam = await iamServer({
      status: 400,
      body: { errorCode: 'BXNIM0415E', errorMessage: 'Provided API key could not be found.' },
    });
    const r = await ibmWatsonx.testConnection(cfgFor('http://127.0.0.1:1', iam.url));
    expect(r).toMatchObject({ ok: false, code: 'auth', status: 400 });
  });
});
