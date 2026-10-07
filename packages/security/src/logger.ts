import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { redact, redactDeep } from './redact.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  /** JSON-lines file. Omit to disable file logging. */
  file?: string;
  level?: Level;
  /** Mirror to stderr (OMNI_DEBUG=1). */
  stderr?: boolean;
}

/**
 * Every line written by this logger goes through the redactor, both message and data,
 * so a credential cannot reach disk or the terminal through logging.
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const min = ORDER[opts.level ?? 'info'];
  let dirReady = false;

  const write = (level: Level, msg: string, data?: Record<string, unknown>) => {
    if (ORDER[level] < min) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: redact(msg),
      ...(data ? { data: redactDeep(data) } : {}),
    });
    if (opts.file) {
      try {
        if (!dirReady) {
          mkdirSync(dirname(opts.file), { recursive: true, mode: 0o700 });
          dirReady = true;
        }
        appendFileSync(opts.file, line + '\n', { mode: 0o600 });
      } catch {
        // logging must never crash the app
      }
    }
    if (opts.stderr) process.stderr.write(line + '\n');
  };

  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  };
}

export const nullLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
