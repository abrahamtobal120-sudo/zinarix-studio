import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { childEnv } from './env.js';

/** Refresh Windows PATH for every new terminal, including installs made while the app runs. */
export function terminalEnv(): Record<string, string> {
  const env = childEnv(process.env);
  if (process.platform !== 'win32') return env;

  const inherited = Object.keys(env).filter((key) => key.toLowerCase() === 'path');
  const paths = inherited.map((key) => env[key]!);
  try {
    const powershell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
    );
    const current = execFileSync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User')) | ConvertTo-Json -Compress",
    ], { encoding: 'utf8', windowsHide: true, timeout: 5000, env });
    const values: unknown = JSON.parse(current.replace(/^\uFEFF/, ''));
    if (Array.isArray(values)) {
      paths.unshift(...values.filter((value): value is string => typeof value === 'string'));
    }
  } catch {
    // Keep inherited paths usable if Windows environment lookup is unavailable.
  }
  // npm's default Windows global bin can be absent from an older user PATH.
  if (env.APPDATA) paths.push(join(env.APPDATA, 'npm'));
  const seen = new Set<string>();
  const expand = (value: string): string => value.replace(/%([^%]+)%/g, (match, name: string) => {
    const key = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase());
    return key ? env[key]! : match;
  });
  for (const key of inherited) delete env[key];
  env.Path = paths.flatMap((path) => expand(path).split(';')).filter((path) => {
    const key = path.toLowerCase();
    if (!path || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(';');
  return env;
}
