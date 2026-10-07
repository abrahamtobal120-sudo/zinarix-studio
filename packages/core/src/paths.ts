import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Root of all Zinarix Studio user data. Override with OMNI_HOME (tests, portable installs). */
export function omniHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.OMNI_HOME ?? join(homedir(), '.omni');
}

export interface OmniPaths {
  home: string;
  config: string;
  db: string;
  vault: string;
  logs: string;
  logFile: string;
  catalogOverride: string;
  catalogOverrideSig: string;
}

export function omniPaths(home = omniHome()): OmniPaths {
  return {
    home,
    config: join(home, 'config.json'),
    db: join(home, 'omni.db'),
    vault: join(home, 'vault.enc'),
    logs: join(home, 'logs'),
    logFile: join(home, 'logs', 'omni.log'),
    catalogOverride: join(home, 'catalog', 'providers.json'),
    catalogOverrideSig: join(home, 'catalog', 'providers.json.sig'),
  };
}

export function ensureHome(paths: OmniPaths): void {
  mkdirSync(paths.home, { recursive: true, mode: 0o700 });
}
