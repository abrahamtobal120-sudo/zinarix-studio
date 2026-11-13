import { EventEmitter } from 'node:events';

/** Largest DAP message accepted (a huge variables dump is still far below this). */
const MAX_MESSAGE = 32 * 1024 * 1024;

export interface DapMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  arguments?: unknown;
  body?: unknown;
}

/**
 * Splits a byte stream into Debug Adapter Protocol messages
 * ("Content-Length: N\r\n\r\n" + N bytes of JSON).
 */
export class DapParser {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): DapMessage[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: DapMessage[] = [];
    for (;;) {
      const sep = this.buf.indexOf('\r\n\r\n');
      if (sep < 0) {
        if (this.buf.length > 8192) throw new Error('DAP: header too long');
        break;
      }
      const header = this.buf.subarray(0, sep).toString('ascii');
      const m = /content-length:\s*(\d+)/i.exec(header);
      if (!m) throw new Error('DAP: missing Content-Length');
      const len = Number(m[1]);
      if (len > MAX_MESSAGE) throw new Error('DAP: message too large');
      const start = sep + 4;
      if (this.buf.length < start + len) break;
      const body = this.buf.subarray(start, start + len).toString('utf8');
      this.buf = this.buf.subarray(start + len);
      out.push(JSON.parse(body) as DapMessage);
    }
    return out;
  }
}

export function encodeDap(msg: object): Buffer {
  const json = Buffer.from(JSON.stringify(msg), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii'), json]);
}

interface Writable {
  write(data: Buffer): unknown;
}

/**
 * A DAP connection over any byte stream: requests with promised responses, events emitted
 * as 'event' (msg) and reverse requests from the adapter as 'request' (msg).
 */
export class DapConnection extends EventEmitter {
  private seq = 1;
  private readonly parser = new DapParser();
  private readonly pending = new Map<
    number,
    { resolve: (body: unknown) => void; reject: (e: Error) => void }
  >();
  private closed = false;

  constructor(private readonly out: Writable) {
    super();
  }

  /** Feed bytes received from the adapter. */
  receive(chunk: Buffer): void {
    let msgs: DapMessage[];
    try {
      msgs = this.parser.push(chunk);
    } catch (e) {
      this.close(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    for (const m of msgs) {
      if (m.type === 'response') {
        const p = this.pending.get(m.request_seq ?? -1);
        if (!p) continue;
        this.pending.delete(m.request_seq!);
        if (m.success) p.resolve(m.body);
        else p.reject(new Error(m.message || `${m.command} failed`));
      } else if (m.type === 'event') this.emit('event', m);
      else if (m.type === 'request') this.emit('request', m);
    }
  }

  request<T = unknown>(command: string, args?: unknown, timeoutMs = 0): Promise<T> {
    if (this.closed) return Promise.reject(new Error('debug adapter closed'));
    const seq = this.seq++;
    this.out.write(encodeDap({ seq, type: 'request', command, arguments: args }));
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs)
        timer = setTimeout(() => {
          this.pending.delete(seq);
          reject(new Error(`${command}: no answer from the debug adapter`));
        }, timeoutMs);
      this.pending.set(seq, {
        resolve: (b) => (clearTimeout(timer), resolve(b as T)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
    });
  }

  respond(req: DapMessage, success: boolean, body?: unknown, message?: string): void {
    if (this.closed) return;
    this.out.write(
      encodeDap({
        seq: this.seq++,
        type: 'response',
        request_seq: req.seq,
        command: req.command,
        success,
        ...(body !== undefined ? { body } : {}),
        ...(message ? { message } : {}),
      }),
    );
  }

  close(err?: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(err ?? new Error('debug adapter closed'));
    this.pending.clear();
    this.emit('close', err);
  }
}
