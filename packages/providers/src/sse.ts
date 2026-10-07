import { OmniError } from '@omni/shared';
import { abortError } from './http.js';

export interface SseEvent {
  event?: string;
  data: string;
}

/**
 * Parses a text/event-stream body. Also tolerates NDJSON (one JSON object per line),
 * which some OpenAI-compatible servers emit. An idle timeout aborts streams that stall.
 */
export async function* parseSse(
  body: ReadableStream<Uint8Array> | null,
  opts: { signal?: AbortSignal; idleTimeoutMs?: number; provider?: string } = {},
): AsyncGenerator<SseEvent> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | undefined;
  let data: string[] = [];
  const idle = opts.idleTimeoutMs ?? 120_000;

  const readChunk = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new OmniError('timeout', `stream idle for ${idle} ms`, { provider: opts.provider }),
              ),
            idle,
          );
          onAbort = () => reject(abortError());
          if (opts.signal?.aborted) onAbort();
          opts.signal?.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
    }
  };

  try {
    for (;;) {
      const { value, done } = await readChunk();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.search(/\r?\n/)) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(buffer[nl] === '\r' ? nl + 2 : nl + 1);
        if (line === '') {
          if (data.length) yield { event, data: data.join('\n') };
          event = undefined;
          data = [];
        } else if (line.startsWith(':')) {
          // comment / keep-alive
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('{')) {
          yield { data: line };
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.startsWith('data:')) data.push(buffer.slice(5).trim());
    else if (buffer.trim().startsWith('{')) yield { data: buffer.trim() };
    if (data.length) yield { event, data: data.join('\n') };
  } finally {
    reader.cancel().catch(() => {});
  }
}

export function safeJson<T = Record<string, unknown>>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
