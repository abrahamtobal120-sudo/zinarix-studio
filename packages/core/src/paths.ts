import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

/**
 * Default locations, in order: OMNI_HOME (tests, portable installs); an existing ~/.omni
 * (every install before XDG support keeps working where its keys and history already are);
 * %APPDATA%\omni on Windows; $XDG_CONFIG_HOME/omni for config.json plus $XDG_DATA_HOME/omni
 * for everything else on Linux and other Unix; ~/.omni on macOS unless XDG is set.
 */
export function defaultDirs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): { config: string; data: string } {
  const same = (dir: string) => ({ config: dir, data: dir });
  if (env.OMNI_HOME) return same(env.OMNI_HOME);
  const fromEnv = platform === 'win32' ? env.USERPROFILE : env.HOME;
  const home = fromEnv && isAbsolute(fromEnv) ? fromEnv : homedir();
  const legacy = join(home, '.omni');
  if (existsSync(legacy)) return same(legacy);
  if (platform === 'win32')
    return same(join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'omni'));
  // The XDG spec says relative values are invalid and must be ignored.
  const xdg = (name: 'XDG_CONFIG_HOME' | 'XDG_DATA_HOME') => {
    const v = env[name];
    return v && isAbsolute(v) ? v : undefined;
  };
  if (platform === 'darwin' && !xdg('XDG_CONFIG_HOME') && !xdg('XDG_DATA_HOME'))
    return same(legacy);
  return {
    config: join(xdg('XDG_CONFIG_HOME') ?? join(home, '.config'), 'omni'),
    data: join(xdg('XDG_DATA_HOME') ?? join(home, '.local', 'share'), 'omni'),
  };
}

/** Root of all Zinarix Studio user data (database, vault, logs, catalog updates). */
export function omniHome(env: NodeJS.ProcessEnv = process.env): string {
  return defaultDirs(env).data;
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

/** An explicit `home` holds everything; the default data dir pairs with the config dir. */
export function omniPaths(home?: string, env: NodeJS.ProcessEnv = process.env): OmniPaths {
  const dirs = defaultDirs(env);
  const root = home ?? dirs.data;
  const configDir = root === dirs.data ? dirs.config : root;
  return {
    home: root,
    config: join(configDir, 'config.json'),
    db: join(root, 'omni.db'),
    vault: join(root, 'vault.enc'),
    logs: join(root, 'logs'),
    logFile: join(root, 'logs', 'omni.log'),
    catalogOverride: join(root, 'catalog', 'providers.json'),
    catalogOverrideSig: join(root, 'catalog', 'providers.json.sig'),
  };
}

export function ensureHome(paths: OmniPaths): void {
  // mode is ignored on Windows, where %APPDATA% is already private to the user.
  mkdirSync(paths.home, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(paths.config), { recursive: true, mode: 0o700 });
}
