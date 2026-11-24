import { existsSync, openSync, readSync, closeSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger, redact, type Logger } from '@omni/security';

/**
 * The app's log file (`<userData>/logs/main.log`, JSON lines): crashes of the main process,
 * of a window or of a helper process, update failures and errors a panel of the interface
 * caught. Every line goes through the redactor (createLogger), so no key reaches the disk.
 * Nothing is sent anywhere: the user exports it with "Exportar diagnóstico".
 */

/** A log file is rotated when it passes this size… */
const MAX_BYTES = 1024 * 1024;
/** …and this many old files are kept (main.1.log is the newest of them). */
const KEEP = 3;

let dir: string | undefined;
let logger: Logger | undefined;
let lines = 0;

const file = (n = 0) => join(dir ?? '', n ? `main.${n}.log` : 'main.log');

/** main.log → main.1.log → … when it is too big. Never throws. */
function rotate(): void {
  try {
    if (!dir || !existsSync(file()) || statSync(file()).size < MAX_BYTES) return;
    rmSync(file(KEEP), { force: true });
    for (let n = KEEP - 1; n >= 1; n--) if (existsSync(file(n))) renameSync(file(n), file(n + 1));
    renameSync(file(), file(1));
  } catch {
    // logging must never crash the app
  }
}

/** Starts logging into `logDir`. Until it is called, log calls do nothing. */
export function initLog(logDir: string): void {
  dir = logDir;
  rotate();
  logger = createLogger({ file: file(), level: 'info', stderr: Boolean(process.env.OMNI_DEBUG) });
}

function text(err: unknown): string {
  if (err instanceof Error) return err.stack || `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function write(
  level: 'info' | 'warn' | 'error',
  scope: string,
  msg: string,
  data?: Record<string, unknown>,
): void {
  if (!logger) return;
  // The size is only looked at now and then: a stat per line would be wasteful.
  if (++lines % 200 === 0) rotate();
  logger[level](`[${scope}] ${msg}`.slice(0, 16_000), data);
}

export const logInfo = (scope: string, msg: string, data?: Record<string, unknown>) =>
  write('info', scope, msg, data);
export const logWarn = (scope: string, msg: string, data?: Record<string, unknown>) =>
  write('warn', scope, msg, data);
/** Logs an error (with its stack when it has one). */
export const logError = (scope: string, err: unknown, data?: Record<string, unknown>) =>
  write('error', scope, text(err), data);

/** The end of the logs, oldest first, at most `maxBytes` (already redacted when written). */
export function logTail(maxBytes = 400_000): string {
  if (!dir) return '';
  const parts: string[] = [];
  let left = maxBytes;
  for (let n = 0; n <= KEEP && left > 0; n++) {
    try {
      const f = file(n);
      if (!existsSync(f)) continue;
      const size = statSync(f).size;
      const len = Math.min(size, left);
      const buf = Buffer.alloc(len);
      const fd = openSync(f, 'r');
      try {
        readSync(fd, buf, 0, len, size - len);
      } finally {
        closeSync(fd);
      }
      parts.unshift(buf.toString('utf8'));
      left -= len;
    } catch {
      // an unreadable file is skipped
    }
  }
  // Redacted again: a key registered after a line was written is hidden too.
  return redact(parts.join(''));
}

/** The text of a diagnostic report: what the app runs on, plus the end of the logs. */
export function diagnosticReport(info: Record<string, string>): string {
  const head = Object.entries(info)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return `${head}\n\n--- log ---\n${logTail()}`;
}
