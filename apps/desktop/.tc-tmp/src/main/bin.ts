import { findExecutable } from './lspProtocol.js';

/**
 * Absolute path of a tool started by bare name (git, rg, gh).
 *
 * On Windows, starting `git` with the open folder as working directory looks in that folder
 * before PATH: a repo with a planted `git.exe` would run as soon as it is opened. Resolving
 * the path from PATH only (findExecutable never looks in the working directory) closes that.
 * Elsewhere the working directory is not searched, so the bare name is fine.
 */
const cache = new Map<string, string>();

export function bin(name: 'git' | 'rg' | 'gh'): string {
  if (process.platform !== 'win32') return name;
  let hit = cache.get(name);
  if (!hit) {
    // Real .exe only: an extensionless file or a .cmd on PATH is not what execFile can start.
    hit = findExecutable(`${name}.exe`) ?? name;
    if (hit !== name) cache.set(name, hit);
  }
  return hit;
}

/** For spawns that need a shell (npm .cmd shims): cmd.exe must not search the working directory. */
export const NO_CWD_EXE_SEARCH = { NoDefaultCurrentDirectoryInExePath: '1' } as const;
