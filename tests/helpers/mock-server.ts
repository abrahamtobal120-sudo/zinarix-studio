import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

export type Handler = (req: RecordedRequest, res: ServerResponse) => void | Promise<void>;

/** Tiny local HTTP server that impersonates a provider API. */
export async function mockServer(
  handler: Handler,
): Promise<{ url: string; requests: RecordedRequest[]; close: () => Promise<void> }> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const rec: RecordedRequest = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(rec);
      Promise.resolve(handler(rec, res)).catch((e: unknown) => {
        res.statusCode = 500;
        res.end(String(e));
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

export function sse(
  res: ServerResponse,
  events: (string | { event?: string; data: unknown })[],
): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) {
    if (typeof e === 'string') res.write(`data: ${e}\n\n`);
    else res.write(`${e.event ? `event: ${e.event}\n` : ''}data: ${JSON.stringify(e.data)}\n\n`);
  }
  res.end();
}

export function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

// ---- canned provider streams ----

export const openAiStream = (text = 'Hola mundo') => [
  { data: { choices: [{ delta: { role: 'assistant', content: text.slice(0, 4) } }] } },
  { data: { choices: [{ delta: { content: text.slice(4) }, finish_reason: 'stop' }] } },
  {
    data: {
      choices: [],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 2 },
      },
    },
  },
  '[DONE]',
];

export const anthropicStream = (text = 'Hola mundo') => [
  {
    event: 'message_start',
    data: {
      type: 'message_start',
      message: { usage: { input_tokens: 10, cache_read_input_tokens: 4, output_tokens: 1 } },
    },
  },
  {
    event: 'content_block_start',
    data: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
  },
  {
    event: 'content_block_delta',
    data: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'pienso' },
    },
  },
  {
    event: 'content_block_start',
    data: { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
  },
  {
    event: 'content_block_delta',
    data: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } },
  },
  {
    event: 'content_block_start',
    data: {
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file' },
    },
  },
  {
    event: 'content_block_delta',
    data: {
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'input_json_delta', partial_json: '{"path":' },
    },
  },
  {
    event: 'content_block_delta',
    data: {
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'input_json_delta', partial_json: '"a.ts"}' },
    },
  },
  {
    event: 'message_delta',
    data: {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 20 },
    },
  },
  { event: 'message_stop', data: { type: 'message_stop' } },
];
