import { describe, expect, it } from 'vitest';
import type { CatalogEntry, ChatChunk, ChatRequest } from '@omni/shared';
import { OmniError } from '@omni/shared';
import { Secret, redact } from '@omni/security';
import type { ProviderConfig } from '../src/types.js';
import {
  awsBedrock,
  bedrockModelPath,
  buildConverseBody,
  canonicalUri,
  decodeEventStreamMessage,
  parseAwsCredential,
  sigV4Headers,
} from '../src/adapters/aws-bedrock.js';

// ---------------------------------------------------------------- helpers

/** Independent CRC32 (IEEE) so the test does not trust the adapter's implementation. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Encodes one event-stream frame with string headers (type 7). */
function frame(headers: Record<string, string>, payload: unknown): Buffer {
  const hdrs = Buffer.concat(
    Object.entries(headers).map(([k, v]) => {
      const name = Buffer.from(k);
      const val = Buffer.from(v);
      const len = Buffer.alloc(2);
      len.writeUInt16BE(val.length);
      return Buffer.concat([Buffer.from([name.length]), name, Buffer.from([7]), len, val]);
    }),
  );
  const body = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const total = 12 + hdrs.length + body.length + 4;
  const prelude = Buffer.alloc(8);
  prelude.writeUInt32BE(total, 0);
  prelude.writeUInt32BE(hdrs.length, 4);
  const preludeCrc = Buffer.alloc(4);
  preludeCrc.writeUInt32BE(crc(prelude));
  const msg = Buffer.concat([prelude, preludeCrc, hdrs, body]);
  const msgCrc = Buffer.alloc(4);
  msgCrc.writeUInt32BE(crc(msg));
  return Buffer.concat([msg, msgCrc]);
}

const event = (type: string, payload: unknown) =>
  frame(
    { ':event-type': type, ':content-type': 'application/json', ':message-type': 'event' },
    payload,
  );

/** Streams the frames in awkward chunk sizes so frame reassembly is exercised. */
function streamOf(frames: Buffer[], chunk = 7): ReadableStream<Uint8Array> {
  const all = Buffer.concat(frames);
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i >= all.length) return ctrl.close();
      ctrl.enqueue(new Uint8Array(all.subarray(i, i + chunk)));
      i += chunk;
    },
  });
}

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function mockFetch(handler: (r: Recorded) => Response) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const rec: Recorded = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      ),
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(rec);
    return handler(rec);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function entry(): CatalogEntry {
  return {
    id: 'amazon-bedrock',
    name: 'Amazon Bedrock',
    adapter: 'aws-bedrock',
    baseUrl: 'https://bedrock-runtime.{region}.amazonaws.com',
    baseUrlParams: [{ name: 'region', label: 'AWS Region', default: 'us-east-1' }],
    auth: { type: 'aws-sigv4' },
    envVars: [],
    region: 'global',
    category: 'enterprise',
    modelsEndpoint: '/foundation-models',
    supports: {
      listModels: true,
      streaming: true,
      tools: true,
      vision: true,
      jsonMode: false,
      embeddings: false,
      fim: false,
    },
    fallbackModels: [{ id: 'global.amazon.nova-2-lite-v1:0', label: 'Nova 2 Lite' }],
    status: 'active',
    verifiedAt: null,
  };
}

// Fake credentials assembled at runtime so no secret-looking literal lives in the repo.
const FAKE_ID = ['AKIA', 'TESTONLY', '0000', '0000'].join('');
const FAKE_SECRET = ['fake', 'secret', 'key', 'x'.repeat(24)].join('/');
const FAKE_TOKEN = ['FwoGZX', 'session', 'token', 'y'.repeat(20)].join('+');
const FAKE_API_KEY = ['ABSK', 'QmVkcm9jaw', 'z'.repeat(40)].join('');

function cfg(secret: string, fetchImpl: typeof fetch, region = 'us-west-2'): ProviderConfig {
  return {
    entry: entry(),
    baseUrl: `https://bedrock-runtime.${region}.amazonaws.com`,
    params: { region },
    apiKey: new Secret(secret),
    fetch: fetchImpl,
    maxRetries: 0,
  };
}

async function collect(c: ProviderConfig, req: Partial<ChatRequest> = {}): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const ch of awsBedrock.chat(
    c,
    {
      model: 'us.anthropic.claude-sonnet-5-5',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hola' },
      ],
      ...req,
    },
    new AbortController().signal,
  ))
    out.push(ch);
  return out;
}

const eventStream = (frames: Buffer[]) =>
  new Response(streamOf(frames), {
    status: 200,
    headers: { 'content-type': 'application/vnd.amazon.eventstream' },
  });

// ---------------------------------------------------------------- SigV4

describe('SigV4', () => {
  const exampleCreds = {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  };
  const date = new Date('2015-08-30T12:36:00Z');

  it('matches the AWS SigV4 test suite "get-vanilla" vector', () => {
    const h = sigV4Headers({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      region: 'us-east-1',
      service: 'service',
      credentials: exampleCreds,
      date,
    });
    expect(h['x-amz-date']).toBe('20150830T123600Z');
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('matches the IAM user guide example (query string + extra signed header)', () => {
    const h = sigV4Headers({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      region: 'us-east-1',
      service: 'iam',
      credentials: exampleCreds,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      date,
    });
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-date, ' +
        'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });

  it('double-encodes path segments (model ids with ":") and signs the session token', () => {
    const path = bedrockModelPath('amazon.nova-2-lite-v1:0');
    expect(path).toBe('/model/amazon.nova-2-lite-v1%3A0/converse-stream');
    expect(canonicalUri(path)).toBe('/model/amazon.nova-2-lite-v1%253A0/converse-stream');
    const h = sigV4Headers({
      method: 'POST',
      url: `https://bedrock-runtime.us-east-1.amazonaws.com${path}`,
      region: 'us-east-1',
      service: 'bedrock',
      credentials: { ...exampleCreds, sessionToken: 'tok' },
      body: '{}',
      date,
    });
    expect(h['x-amz-security-token']).toBe('tok');
    expect(h.authorization).toContain('SignedHeaders=host;x-amz-date;x-amz-security-token,');
  });
});

// ---------------------------------------------------------------- credentials

describe('parseAwsCredential', () => {
  it('detects bearer API keys vs IAM keys (colon, JSON, sts output)', () => {
    expect(parseAwsCredential(FAKE_API_KEY)).toEqual({ kind: 'bearer', token: FAKE_API_KEY });
    expect(parseAwsCredential(`${FAKE_ID}:${FAKE_SECRET}`)).toEqual({
      kind: 'iam',
      accessKeyId: FAKE_ID,
      secretAccessKey: FAKE_SECRET,
      sessionToken: undefined,
    });
    expect(parseAwsCredential(` ${FAKE_ID}:${FAKE_SECRET}:${FAKE_TOKEN} `)).toMatchObject({
      kind: 'iam',
      sessionToken: FAKE_TOKEN,
    });
    expect(
      parseAwsCredential(
        JSON.stringify({
          accessKeyId: FAKE_ID,
          secretAccessKey: FAKE_SECRET,
          sessionToken: FAKE_TOKEN,
        }),
      ),
    ).toMatchObject({ kind: 'iam', accessKeyId: FAKE_ID, sessionToken: FAKE_TOKEN });
    expect(
      parseAwsCredential(
        JSON.stringify({ Credentials: { AccessKeyId: FAKE_ID, SecretAccessKey: FAKE_SECRET } }),
      ),
    ).toMatchObject({ kind: 'iam', accessKeyId: FAKE_ID });
  });

  it('rejects malformed input without echoing it and registers the secret for redaction', () => {
    const bad = `not-an-id:${FAKE_SECRET}`;
    expect(() => parseAwsCredential(bad)).toThrow(OmniError);
    try {
      parseAwsCredential(bad);
    } catch (e) {
      expect(String(e)).not.toContain(FAKE_SECRET);
    }
    expect(() => parseAwsCredential('{"accessKeyId": ')).toThrow(/could not be parsed/);
    parseAwsCredential(`${FAKE_ID}:${FAKE_SECRET}`);
    expect(redact(`oops ${FAKE_SECRET}`)).not.toContain(FAKE_SECRET);
  });
});

// ---------------------------------------------------------------- event stream

describe('event stream decoding', () => {
  it('decodes headers and payload and rejects CRC corruption', () => {
    const f = event('messageStop', { stopReason: 'end_turn' });
    const msg = decodeEventStreamMessage(f);
    expect(msg.headers[':event-type']).toBe('messageStop');
    expect(JSON.parse(msg.payload.toString())).toEqual({ stopReason: 'end_turn' });
    const broken = Buffer.from(f);
    broken.writeUInt8(broken.readUInt8(broken.length - 6) ^ 0xff, broken.length - 6);
    expect(() => decodeEventStreamMessage(broken)).toThrow(/CRC/);
  });
});

// ---------------------------------------------------------------- chat

describe('aws-bedrock chat', () => {
  const textFrames = [
    event('messageStart', { role: 'assistant' }),
    event('contentBlockDelta', {
      contentBlockIndex: 0,
      delta: { reasoningContent: { text: 'pensando' } },
    }),
    event('contentBlockDelta', {
      contentBlockIndex: 0,
      delta: { reasoningContent: { signature: 'sig-1' } },
    }),
    event('contentBlockStop', { contentBlockIndex: 0 }),
    event('contentBlockDelta', { contentBlockIndex: 1, delta: { text: 'Hola ' } }),
    event('contentBlockDelta', { contentBlockIndex: 1, delta: { text: 'mundo' } }),
    event('contentBlockStop', { contentBlockIndex: 1 }),
    event('messageStop', { stopReason: 'end_turn' }),
    event('metadata', {
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        cacheReadInputTokens: 5,
        cacheWriteInputTokens: 2,
        totalTokens: 21,
      },
      metrics: { latencyMs: 12 },
    }),
  ];

  it('streams text, reasoning and usage with a bearer API key', async () => {
    const { fetchImpl, calls } = mockFetch(() => eventStream(textFrames));
    const chunks = await collect(cfg(FAKE_API_KEY, fetchImpl), {
      temperature: 0.3,
      maxTokens: 100,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://bedrock-runtime.us-west-2.amazonaws.com/model/us.anthropic.claude-sonnet-5-5/converse-stream',
    );
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${FAKE_API_KEY}`);
    expect(calls[0]!.headers['x-amz-date']).toBeUndefined();
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      messages: [{ role: 'user', content: [{ text: 'hola' }] }],
      system: [{ text: 'be brief' }],
      inferenceConfig: { maxTokens: 100, temperature: 0.3 },
    });
    expect(chunks.filter((c) => c.type === 'text').map((c) => c.delta)).toEqual(['Hola ', 'mundo']);
    expect(chunks).toContainEqual({ type: 'reasoning', delta: 'pensando' });
    expect(chunks).toContainEqual({
      type: 'usage',
      inputTokens: 17,
      outputTokens: 4,
      cachedTokens: 5,
      cacheWriteTokens: 2,
    });
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
    const raw = chunks.find((c) => c.type === 'raw');
    expect(raw).toMatchObject({
      adapter: 'aws-bedrock',
      content: {
        blocks: [
          { reasoningContent: { reasoningText: { text: 'pensando', signature: 'sig-1' } } },
          { text: 'Hola mundo' },
        ],
      },
    });
  });

  it('signs with SigV4 (encoded model id, session token) when given IAM keys', async () => {
    const { fetchImpl, calls } = mockFetch(() => eventStream(textFrames));
    await collect(cfg(`${FAKE_ID}:${FAKE_SECRET}:${FAKE_TOKEN}`, fetchImpl, 'eu-central-1'), {
      model: 'amazon.nova-2-lite-v1:0',
    });
    const c = calls[0]!;
    expect(c.url).toBe(
      'https://bedrock-runtime.eu-central-1.amazonaws.com/model/amazon.nova-2-lite-v1%3A0/converse-stream',
    );
    expect(c.headers.authorization).toMatch(
      new RegExp(
        `^AWS4-HMAC-SHA256 Credential=${FAKE_ID}/\\d{8}/eu-central-1/bedrock/aws4_request, SignedHeaders=host;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$`,
      ),
    );
    expect(c.headers['x-amz-security-token']).toBe(FAKE_TOKEN);
    // The signature recomputed independently over exactly what was sent must match.
    const stamp = c.headers['x-amz-date']!;
    const date = new Date(
      `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`,
    );
    const expected = sigV4Headers({
      method: 'POST',
      url: c.url,
      body: c.body,
      region: 'eu-central-1',
      service: 'bedrock',
      credentials: {
        accessKeyId: FAKE_ID,
        secretAccessKey: FAKE_SECRET,
        sessionToken: FAKE_TOKEN,
      },
      date,
    });
    expect(c.headers.authorization).toBe(expected.authorization);
    expect(JSON.stringify(c.headers)).not.toContain(FAKE_SECRET);
  });

  it('streams tool calls and maps tool history to Converse blocks', async () => {
    const frames = [
      event('messageStart', { role: 'assistant' }),
      event('contentBlockStart', {
        contentBlockIndex: 0,
        start: { toolUse: { toolUseId: 'tooluse_1', name: 'read_file' } },
      }),
      event('contentBlockDelta', {
        contentBlockIndex: 0,
        delta: { toolUse: { input: '{"path":' } },
      }),
      event('contentBlockDelta', {
        contentBlockIndex: 0,
        delta: { toolUse: { input: '"a.ts"}' } },
      }),
      event('contentBlockStop', { contentBlockIndex: 0 }),
      event('messageStop', { stopReason: 'tool_use' }),
      event('metadata', { usage: { inputTokens: 3, outputTokens: 2 } }),
    ];
    const { fetchImpl, calls } = mockFetch(() => eventStream(frames));
    const chunks = await collect(cfg(FAKE_API_KEY, fetchImpl), {
      messages: [
        { role: 'user', content: [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }] },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 't0', name: 'ls', arguments: '{"dir":"."}' }],
        },
        { role: 'tool', toolCallId: 't0', content: 'a.ts', isError: false },
      ],
      tools: [
        {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
    });
    const body = JSON.parse(calls[0]!.body!) as Record<string, unknown>;
    expect(body.messages).toEqual([
      { role: 'user', content: [{ image: { format: 'png', source: { bytes: 'AAAA' } } }] },
      {
        role: 'assistant',
        content: [{ toolUse: { toolUseId: 't0', name: 'ls', input: { dir: '.' } } }],
      },
      {
        role: 'user',
        content: [{ toolResult: { toolUseId: 't0', content: [{ text: 'a.ts' }] } }],
      },
    ]);
    expect(body.toolConfig).toEqual({
      tools: [
        {
          toolSpec: {
            name: 'read_file',
            description: 'Read a file',
            inputSchema: { json: { type: 'object', properties: { path: { type: 'string' } } } },
          },
        },
      ],
    });
    const calls2 = chunks.filter((c) => c.type === 'tool_call');
    expect(calls2).toEqual([
      { type: 'tool_call', id: 'tooluse_1', name: 'read_file', argsDelta: '' },
      { type: 'tool_call', id: 'tooluse_1', name: 'read_file', argsDelta: '{"path":' },
      { type: 'tool_call', id: 'tooluse_1', name: 'read_file', argsDelta: '"a.ts"}' },
    ]);
    expect(chunks).toContainEqual({
      type: 'usage',
      inputTokens: 3,
      outputTokens: 2,
      cachedTokens: 0,
    });
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('turns an exception frame into an OmniError', async () => {
    const frames = [
      event('messageStart', { role: 'assistant' }),
      event('contentBlockDelta', { contentBlockIndex: 0, delta: { text: 'Ho' } }),
      frame(
        {
          ':exception-type': 'throttlingException',
          ':content-type': 'application/json',
          ':message-type': 'exception',
        },
        { message: 'Too many tokens, please wait before trying again.' },
      ),
    ];
    const { fetchImpl } = mockFetch(() => eventStream(frames));
    const seen: ChatChunk[] = [];
    const err = await (async () => {
      try {
        for await (const c of awsBedrock.chat(
          cfg(FAKE_API_KEY, fetchImpl),
          { model: 'm.x', messages: [{ role: 'user', content: 'hi' }] },
          new AbortController().signal,
        ))
          seen.push(c);
      } catch (e) {
        return e;
      }
    })();
    expect(seen).toEqual([{ type: 'text', delta: 'Ho' }]);
    expect(err).toBeInstanceOf(OmniError);
    expect((err as OmniError).code).toBe('rate_limit');
    expect((err as OmniError).message).toMatch(/throttlingException: Too many tokens/);
  });

  it('retries a profile-only bare model id through its global inference profile', async () => {
    const { fetchImpl, calls } = mockFetch((r) =>
      r.url.includes('/model/anthropic.')
        ? new Response(
            JSON.stringify({
              message:
                "Invocation of model ID anthropic.claude-sonnet-5-5 with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile that contains this model.",
            }),
            { status: 400 },
          )
        : eventStream(textFrames),
    );
    const chunks = await collect(cfg(FAKE_API_KEY, fetchImpl), {
      model: 'anthropic.claude-sonnet-5-5',
    });
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/model/anthropic.claude-sonnet-5-5/converse-stream',
      '/model/global.anthropic.claude-sonnet-5-5/converse-stream',
    ]);
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('maps reasoning to the model family request fields', () => {
    const msgs = [{ role: 'user' as const, content: 'x' }];
    expect(
      buildConverseBody({
        model: 'global.anthropic.claude-opus-5-5',
        messages: msgs,
        reasoning: 'high',
        temperature: 0.2,
      }),
    ).toMatchObject({
      additionalModelRequestFields: {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
      },
    });
    const old = buildConverseBody({
      model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      messages: msgs,
      reasoning: 'low',
    });
    expect(old.additionalModelRequestFields).toEqual({
      thinking: { type: 'enabled', budget_tokens: 2048 },
    });
    expect((old.inferenceConfig as { maxTokens: number }).maxTokens).toBeGreaterThan(2048);
    expect(
      buildConverseBody({ model: 'amazon.nova-2-lite-v1:0', messages: msgs, reasoning: 'medium' })
        .additionalModelRequestFields,
    ).toEqual({ reasoningConfig: { type: 'enabled', maxReasoningEffort: 'medium' } });
  });
});

// ---------------------------------------------------------------- models

describe('aws-bedrock listModels / testConnection', () => {
  const foundation = {
    modelSummaries: [
      {
        modelId: 'amazon.nova-2-lite-v1:0',
        modelName: 'Nova 2 Lite',
        inputModalities: ['TEXT', 'IMAGE', 'VIDEO'],
        outputModalities: ['TEXT'],
        responseStreamingSupported: true,
        inferenceTypesSupported: ['INFERENCE_PROFILE'],
        modelLifecycle: { status: 'ACTIVE' },
      },
      {
        modelId: 'mistral.mistral-large-3',
        modelName: 'Mistral Large 3',
        inputModalities: ['TEXT'],
        outputModalities: ['TEXT'],
        responseStreamingSupported: true,
        inferenceTypesSupported: ['ON_DEMAND'],
        modelLifecycle: { status: 'ACTIVE' },
      },
      {
        modelId: 'old.model-v1',
        modelName: 'Old',
        inputModalities: ['TEXT'],
        outputModalities: ['TEXT'],
        responseStreamingSupported: true,
        inferenceTypesSupported: ['ON_DEMAND'],
        modelLifecycle: { status: 'LEGACY' },
      },
    ],
  };
  const profiles = {
    inferenceProfileSummaries: [
      {
        inferenceProfileId: 'us.amazon.nova-2-lite-v1:0',
        inferenceProfileName: 'US Nova 2 Lite',
        status: 'ACTIVE',
        models: [
          {
            modelArn: 'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-2-lite-v1:0',
          },
        ],
      },
    ],
  };

  it('lists foundation models plus inference profiles from the control plane', async () => {
    const { fetchImpl, calls } = mockFetch((r) =>
      r.url.includes('/inference-profiles') ? Response.json(profiles) : Response.json(foundation),
    );
    const models = await awsBedrock.listModels(cfg(`${FAKE_ID}:${FAKE_SECRET}`, fetchImpl));
    expect(calls[0]!.url).toBe(
      'https://bedrock.us-west-2.amazonaws.com/foundation-models?byOutputModality=TEXT',
    );
    expect(calls[0]!.headers.authorization).toMatch(/\/us-west-2\/bedrock\/aws4_request/);
    expect(models.map((m) => m.id)).toEqual([
      'us.amazon.nova-2-lite-v1:0',
      'mistral.mistral-large-3',
    ]);
    expect(models[0]).toMatchObject({
      provider: 'amazon-bedrock',
      label: 'US Nova 2 Lite',
      kind: 'chat',
      capabilities: { vision: true, reasoning: true },
    });
  });

  it('still lists models when the inference-profile call fails', async () => {
    const { fetchImpl } = mockFetch((r) =>
      r.url.includes('/inference-profiles')
        ? new Response('{"message":"denied"}', { status: 403 })
        : Response.json(foundation),
    );
    const models = await awsBedrock.listModels(cfg(FAKE_API_KEY, fetchImpl));
    expect(models.map((m) => m.id)).toEqual(['mistral.mistral-large-3']);
  });

  it('testConnection lists models, and falls back to a 1-token converse on 403', async () => {
    const ok = mockFetch((r) =>
      r.url.includes('/inference-profiles') ? Response.json(profiles) : Response.json(foundation),
    );
    expect(await awsBedrock.testConnection(cfg(FAKE_API_KEY, ok.fetchImpl))).toEqual({
      ok: true,
      models: 2,
    });

    const limited = mockFetch((r) =>
      r.url.includes('converse-stream')
        ? eventStream([event('contentBlockDelta', { contentBlockIndex: 0, delta: { text: 'p' } })])
        : new Response('{"message":"not authorized"}', { status: 403 }),
    );
    expect(await awsBedrock.testConnection(cfg(FAKE_API_KEY, limited.fetchImpl))).toEqual({
      ok: true,
    });
    const converse = limited.calls.find((c) => c.url.includes('converse-stream'))!;
    expect(converse.url).toContain('/model/global.amazon.nova-2-lite-v1%3A0/converse-stream');
    expect(JSON.parse(converse.body!)).toMatchObject({ inferenceConfig: { maxTokens: 1 } });

    const denied = mockFetch(() => new Response('{"message":"bad key"}', { status: 403 }));
    expect(await awsBedrock.testConnection(cfg(FAKE_API_KEY, denied.fetchImpl))).toMatchObject({
      ok: false,
      code: 'auth',
      status: 403,
    });
    expect(await awsBedrock.testConnection({ ...cfg('', denied.fetchImpl) })).toMatchObject({
      ok: false,
      code: 'auth',
    });
  });
});
