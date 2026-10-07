import { fstatSync } from 'node:fs';
import { redact } from '@omni/security';

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  dim: wrap('2'),
  bold: wrap('1'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  cyan: wrap('36'),
  magenta: wrap('35'),
};

/** All CLI output goes through these, so nothing reaches the terminal unredacted. */
export const out = (s: string): void => {
  process.stdout.write(redact(s));
};
export const outln = (s = ''): void => out(s + '\n');
export const err = (s: string): void => {
  process.stderr.write(redact(s));
};
export const errln = (s = ''): void => err(s + '\n');

export function printJson(v: unknown): void {
  outln(JSON.stringify(v, null, 2));
}

/**
 * Reads piped stdin. With `waitForData` false (a prompt was given) an inherited pipe that
 * never sends anything is ignored after a short grace period instead of blocking forever.
 */
export async function readStdin(waitForData = true): Promise<string> {
  const stdin = process.stdin;
  if (stdin.isTTY) return '';
  let isFile = false;
  try {
    isFile = fstatSync(0).isFile();
  } catch {
    return '';
  }
  if (isFile || waitForData) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let ended = false;
    const finish = () => {
      clearTimeout(timer);
      stdin.removeAllListeners('data');
      stdin.removeAllListeners('end');
      stdin.pause();
      if (!ended) stdin.unref?.();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    let timer = setTimeout(finish, 300);
    stdin.on('data', (c: Buffer) => {
      clearTimeout(timer);
      chunks.push(c);
      timer = setTimeout(finish, 5000);
    });
    stdin.on('end', () => {
      ended = true;
      finish();
    });
    stdin.resume();
  });
}

/** Reads a line without echoing it (API keys, vault password). */
export function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('stdin is not a TTY: use --key-stdin to pipe the key'));
      return;
    }
    process.stderr.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const done = (result?: string) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stderr.write('\n');
      if (result === undefined) reject(new Error('cancelled'));
      else resolve(result);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(value);
        if (ch === '\u0003' || ch === '\u001b') return done(undefined);
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows;
  const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
  const widths: number[] = [];
  for (const r of all)
    r.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, visible(cell))));
  const fmt = (r: string[]) =>
    r
      .map((cell, i) => (i === r.length - 1 ? cell : cell + ' '.repeat(widths[i]! - visible(cell))))
      .join('  ');
  const lines = all.map(fmt);
  if (header) lines.splice(1, 0, c.dim(widths.map((w) => '─'.repeat(w)).join('  ')));
  if (header) lines[0] = c.bold(lines[0]!);
  return lines.join('\n');
}

export function fmtTokens(n: number | null | undefined): string {
  if (!n) return '–';
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return '–';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function fmtPrice(n: number | null | undefined): string {
  return n === null || n === undefined ? '–' : `$${+n.toFixed(3)}`;
}

/** Parses repeated `--param k=v` / `--header k=v`. */
export function collectKv(
  value: string,
  prev: Record<string, string> = {},
): Record<string, string> {
  const i = value.indexOf('=');
  if (i <= 0) throw new Error(`expected key=value, got "${value}"`);
  return { ...prev, [value.slice(0, i)]: value.slice(i + 1) };
}

export function collect(value: string, prev: string[] = []): string[] {
  return [...prev, value];
}
