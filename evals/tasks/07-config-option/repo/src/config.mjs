import { readFileSync } from 'node:fs';

const DEFAULTS = { host: '127.0.0.1', port: 3000 };

export function loadConfig(path = new URL('../config.json', import.meta.url)) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const cfg = { ...DEFAULTS, ...raw };
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535)
    throw new Error('port must be an integer between 1 and 65535');
  return cfg;
}
