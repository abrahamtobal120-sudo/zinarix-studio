import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, LOG_FILE } from '../constants.mjs';

export function recordEvent(kind, detail) {
  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(join(DATA_DIR, LOG_FILE), JSON.stringify({ kind, detail, at: Date.now() }) + '\n');
}
