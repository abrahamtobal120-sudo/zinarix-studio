/**
 * Free voice-over with the voices the operating system already has (no key, no internet):
 * Windows SAPI (System.Speech), macOS `say`, Linux espeak-ng / espeak. The Generate panel and
 * the generate_speech tool see it as one more speech model ("system"), so the editor's voice
 * generation works even when no paid provider is connected.
 *
 * The text and the voice name reach the program through a file and environment variables,
 * never through a command line, so nothing the user types is ever parsed by a shell.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

export const LOCAL_VOICE_PROVIDER = 'system';
export const LOCAL_VOICE_MODEL = 'voz-del-sistema';
/** Longest text read in one go (SAPI and `say` handle more, but it keeps a run bounded). */
const MAX_CHARS = 20_000;

const PS_LIST = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$d = $s.Voice.Name
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Write-Output $d
$s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name } | Where-Object { $_ -ne $d }
$s.Dispose()
`;

const PS_SPEAK = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($env:ZX_VOICE) { $s.SelectVoice($env:ZX_VOICE) }
if ($env:ZX_RATE) { $s.Rate = [int]$env:ZX_RATE }
$s.SetOutputToWaveFile($env:ZX_OUT)
$s.Speak([IO.File]::ReadAllText($env:ZX_TEXT, [Text.Encoding]::UTF8))
$s.Dispose()
`;

function which(names: string[]): string | null {
  const exe = process.platform === 'win32' ? '.exe' : '';
  for (const d of (process.env.PATH ?? '').split(delimiter).filter(Boolean))
    for (const n of names) if (existsSync(join(d, n + exe))) return join(d, n + exe);
  return null;
}

const powershell = () =>
  join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );

function run(
  bin: string,
  args: string[],
  env: Record<string, string>,
  signal?: AbortSignal,
  timeoutMs = 300_000,
): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, env: { ...process.env, ...env } });
    let err = '';
    p.stderr.on('data', (d: Buffer) => (err = (err + d.toString('utf8')).slice(-4000)));
    p.stdout.resume();
    const kill = () => p.kill('SIGKILL');
    const timer = setTimeout(kill, timeoutMs);
    signal?.addEventListener('abort', kill, { once: true });
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      if (signal?.aborted) return reject(new Error('Cancelado.'));
      resolve({ code, err });
    });
  });
}

let voiceCache: Promise<string[]> | null = null;

function listOut(bin: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, args, { windowsHide: true, encoding: 'utf8', timeout: 20_000 }, (e, out) =>
      resolve(e ? null : out),
    );
  });
}

/** Whether this machine can speak, and its voices (the system default first). */
export async function localVoices(): Promise<{ available: boolean; voices: string[] }> {
  if (process.platform === 'win32') {
    voiceCache ??= listOut(powershell(), [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      PS_LIST,
    ]).then((out) =>
      (out ?? '')
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean),
    );
    const voices = await voiceCache;
    if (!voices.length) voiceCache = null;
    return { available: voices.length > 0, voices };
  }
  if (process.platform === 'darwin') {
    voiceCache ??= listOut('/usr/bin/say', ['-v', '?']).then((out) =>
      (out ?? '')
        .split('\n')
        .map((l) => /^(.+?)\s{2,}[a-z]{2,3}[_-]/i.exec(l)?.[1]?.trim())
        .filter((x): x is string => !!x),
    );
    return { available: existsSync('/usr/bin/say'), voices: await voiceCache };
  }
  return { available: !!which(['espeak-ng', 'espeak']), voices: [] };
}

/** Reads `text` aloud into a WAV file and returns its bytes. */
export async function speakLocally(
  text: string,
  voice: string | undefined,
  signal?: AbortSignal,
): Promise<Buffer> {
  const body = text.trim().slice(0, MAX_CHARS);
  if (!body) throw new Error('Escribe el texto que se va a leer.');
  const dir = await mkdtemp(join(tmpdir(), 'zinarix-voice-'));
  try {
    const txt = join(dir, 'text.txt');
    const out = join(dir, 'voice.wav');
    await writeFile(txt, body, 'utf8');
    const known = (await localVoices()).voices;
    const v = voice && known.includes(voice) ? voice : '';
    let r: { code: number | null; err: string };
    if (process.platform === 'win32')
      r = await run(
        powershell(),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SPEAK],
        { ZX_TEXT: txt, ZX_OUT: out, ZX_VOICE: v },
        signal,
      );
    else if (process.platform === 'darwin')
      r = await run(
        '/usr/bin/say',
        [...(v ? ['-v', v] : []), '-o', out, '--data-format=LEI16@22050', '-f', txt],
        {},
        signal,
      );
    else {
      const bin = which(['espeak-ng', 'espeak']);
      if (!bin) throw new Error('Instala espeak-ng para usar la voz del sistema.');
      r = await run(bin, ['-w', out, '-f', txt], {}, signal);
    }
    if (r.code !== 0 || !existsSync(out))
      throw new Error(
        `La voz del sistema falló: ${r.err.trim().split(/\r?\n/).slice(-2).join(' ') || `código ${r.code}`}`,
      );
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
