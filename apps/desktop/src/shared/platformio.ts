/**
 * Arduino / PlatformIO (Fase 5A del plan de funciones): shared types and the pure parts
 * (platformio.ini, build output, ports, serial lines). No Node or DOM imports: tested in Node.
 */

export type PioStatus =
  { state: 'missing' } | { state: 'ready'; version: string; bin: string; python: string | null };

/** One [env:name] section of platformio.ini. */
export interface PioEnv {
  name: string;
  platform: string;
  board: string;
  framework: string;
  monitorSpeed: number | null;
  uploadPort: string | null;
  monitorPort: string | null;
  /** lib_deps entries (owner/name@version, a name, or a git / file URL). */
  libDeps: string[];
}

/** A PlatformIO project of the open folder (folder relative to it; "" = the folder itself). */
export interface PioProject {
  dir: string;
  envs: PioEnv[];
  defaultEnvs: string[];
  /** compile_commands.json exists (clangd uses it for completion). */
  compileDb: boolean;
}

export interface PioDevice {
  port: string;
  description: string;
  hwid: string;
  /** Looks like a development board (USB serial chip, Arduino, ESP…), not a modem or AMT. */
  board: boolean;
}

export interface PioBoard {
  id: string;
  name: string;
  platform: string;
  mcu: string;
  frameworks: string[];
  vendor: string;
}

export type PioTarget = 'build' | 'upload' | 'clean' | 'compiledb';

export interface PioJob {
  /** Project folder relative to the open folder ("" = the folder itself). */
  dir: string;
  env: string | null;
  target: PioTarget;
  port?: string | null;
}

export interface PioProblem {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface PioMemory {
  ramUsed: number;
  ramTotal: number;
  flashUsed: number;
  flashTotal: number;
}

export interface PioResult {
  ok: boolean;
  problems: PioProblem[];
  memory: PioMemory | null;
  seconds: number | null;
}

export type PioEvent =
  | { kind: 'job-data'; key: string; chunk: string }
  | { kind: 'job-end'; key: string; ok: boolean }
  | { kind: 'serial-data'; port: string; chunk: string }
  | { kind: 'serial-state'; port: string; open: boolean; error?: string };

export const BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 460800, 500000,
  921600, 1000000, 2000000,
] as const;

/** Values of an ini key, with ";" / "#" comments and continuation lines folded in. */
export function parseIni(text: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let sec: Map<string, string> | null = null;
  let lastKey: string | null = null;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (/^\s*[;#]/.test(raw) || !raw.trim()) {
      if (!raw.trim()) lastKey = null;
      continue;
    }
    const line = raw.replace(/\s+;.*$/, '');
    const head = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (head) {
      const name = head[1]!.trim();
      sec = out.get(name) ?? new Map();
      out.set(name, sec);
      lastKey = null;
      continue;
    }
    if (!sec) continue;
    // An indented line goes on with the previous value (lib_deps, build_flags…).
    if (/^\s+\S/.test(line) && lastKey) {
      sec.set(lastKey, `${sec.get(lastKey) ?? ''}\n${line.trim()}`.trim());
      continue;
    }
    const kv = /^\s*([\w.-]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    lastKey = kv[1]!;
    sec.set(lastKey, kv[2]!.trim());
  }
  return out;
}

/** The [env:…] sections of a platformio.ini, with [env] values inherited. */
export function parsePlatformioIni(text: string): { envs: PioEnv[]; defaultEnvs: string[] } {
  const ini = parseIni(text);
  const common = ini.get('env') ?? new Map<string, string>();
  const envs: PioEnv[] = [];
  for (const [sec, values] of ini) {
    const m = /^env:(.+)$/.exec(sec);
    if (!m) continue;
    // "extends = env:base" copies another section's values first.
    const base = values.get('extends');
    const ext = base ? (ini.get(base.trim()) ?? ini.get(`env:${base.trim()}`)) : undefined;
    const get = (k: string) => values.get(k) ?? ext?.get(k) ?? common.get(k) ?? '';
    const speed = Number.parseInt(get('monitor_speed'), 10);
    envs.push({
      name: m[1]!.trim(),
      platform: get('platform'),
      board: get('board'),
      framework: get('framework'),
      monitorSpeed: Number.isFinite(speed) ? speed : null,
      uploadPort: get('upload_port') || null,
      monitorPort: get('monitor_port') || null,
      libDeps: get('lib_deps')
        .split(/\r?\n|,\s+/)
        .map((x) => x.trim())
        .filter(Boolean),
    });
  }
  const def = ini.get('platformio')?.get('default_envs') ?? '';
  const defaultEnvs = def
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s && envs.some((e) => e.name === s));
  return { envs, defaultEnvs };
}

/** "src\main.cpp:5:24: error: …" lines of a gcc / clang build. */
export function parseProblems(output: string): PioProblem[] {
  const out: PioProblem[] = [];
  const seen = new Set<string>();
  const re = /^(.+?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning):\s*(.+)$/;
  for (const raw of output.split(/\r?\n/)) {
    const m = re.exec(raw.trim());
    if (!m) continue;
    const file = m[1]!.replace(/\\/g, '/');
    // The linker's "ld.exe: warning: …" has no line; skip paths that are not sources.
    if (!/\.(c|cc|cpp|cxx|h|hh|hpp|hxx|ino|s|S)$/i.test(file)) continue;
    const p: PioProblem = {
      file,
      line: Number(m[2]),
      column: m[3] ? Number(m[3]) : 1,
      severity: m[4] === 'warning' ? 'warning' : 'error',
      message: m[5]!.trim(),
    };
    const key = `${p.file}:${p.line}:${p.column}:${p.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** RAM / Flash use from "RAM:   [=   ]   5.2% (used 1072 bytes from 20480 bytes)". */
export function parseMemory(output: string): PioMemory | null {
  const take = (label: string) => {
    const m = new RegExp(`^${label}:.*used (\\d+) bytes from (\\d+) bytes`, 'mi').exec(output);
    return m ? { used: Number(m[1]), total: Number(m[2]) } : null;
  };
  const ram = take('RAM');
  const flash = take('Flash');
  if (!ram && !flash) return null;
  return {
    ramUsed: ram?.used ?? 0,
    ramTotal: ram?.total ?? 0,
    flashUsed: flash?.used ?? 0,
    flashTotal: flash?.total ?? 0,
  };
}

export function parseResult(output: string, ok: boolean): PioResult {
  const t = /\[(?:SUCCESS|FAILED|ERROR)\]\s+Took\s+([\d.]+)\s+seconds/i.exec(output);
  return {
    ok,
    problems: parseProblems(output),
    memory: parseMemory(output),
    seconds: t ? Number(t[1]) : null,
  };
}

/** Problem paths are relative to the PlatformIO project; this makes them relative to the folder. */
export function problemPath(projectDir: string, file: string): string | null {
  const f = file.replace(/\\/g, '/');
  if (/^([a-z]:)?\//i.test(f)) return null; // libraries / the framework: outside the project
  const rel = projectDir ? `${projectDir.replace(/\/+$/, '')}/${f}` : f;
  return rel.split('/').includes('..') ? null : rel;
}

/** COM3, /dev/ttyUSB0, /dev/cu.usbserial-…, or pyserial's loop:// (a test loopback). */
export function validPort(p: unknown): p is string {
  return (
    typeof p === 'string' &&
    p.length <= 200 &&
    (/^COM\d{1,3}$/i.test(p) || /^\/dev\/(tty|cu)[\w.-]+$/.test(p) || p === 'loop://')
  );
}

export function validEnvName(e: unknown): e is string {
  return typeof e === 'string' && /^[\w.-]{1,64}$/.test(e);
}

export function validBoardId(b: unknown): b is string {
  return typeof b === 'string' && /^[\w.+-]{1,80}$/.test(b);
}

/** Project folder relative to the open folder ("" or "sub/dir"), never leaving it. */
export function validProjectDir(d: unknown): d is string {
  if (typeof d !== 'string' || d.length > 500) return false;
  if (d === '') return true;
  if (/^([a-z]:)?[\\/]/i.test(d)) return false;
  return !d.split(/[\\/]/).some((s) => s === '..' || s === '');
}

export function validBaud(b: unknown): b is number {
  return typeof b === 'number' && Number.isInteger(b) && b >= 50 && b <= 4_000_000;
}

/** USB serial chips and boards (CH340, CP210x, FTDI, Arduino, ESP, STM, Pico…). */
export function looksLikeBoard(description: string, hwid: string): boolean {
  const s = `${description} ${hwid}`;
  if (/Active Management|Bluetooth|modem|SOL\b/i.test(s)) return false;
  return /CH34\d|CP21\d\d|FTDI|FT232|Arduino|ESP32|USB[- ]?Serial|USB-SERIAL|STM|STLink|Pico|RP2040|USB JTAG|VID:PID=(2341|1A86|10C4|0403|303A|0483|2E8A|239A)/i.test(
    s,
  );
}

/** pio device list --json-output → devices, boards first. */
export function parseDevices(json: string): PioDevice[] {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const list = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => {
      const description = String(r.description ?? '');
      const hwid = String(r.hwid ?? '');
      return {
        port: String(r.port ?? ''),
        description,
        hwid,
        board: looksLikeBoard(description, hwid),
      };
    })
    .filter((d) => d.port);
  return list.sort(
    (a, b) =>
      Number(b.board) - Number(a.board) ||
      a.port.localeCompare(b.port, undefined, { numeric: true }),
  );
}

/** pio boards --json-output → boards. */
export function parseBoards(json: string, limit = 200): PioBoard[] {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  // Two installed versions of a platform list the same boards twice.
  const seen = new Set<string>();
  return rows
    .filter(
      (r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof r.id === 'string',
    )
    .filter((r) => !seen.has(String(r.id)) && !!seen.add(String(r.id)))
    .slice(0, limit)
    .map((r) => ({
      id: String(r.id),
      name: String(r.name ?? r.id),
      platform: String(r.platform ?? ''),
      mcu: String(r.mcu ?? ''),
      frameworks: Array.isArray(r.frameworks) ? r.frameworks.map(String) : [],
      vendor: String(r.vendor ?? ''),
    }));
}

/** Arguments of `pio run` for a job (throws on anything not allowed). */
export function runArgs(absDir: string, job: PioJob): string[] {
  if (job.env !== null && !validEnvName(job.env)) throw new Error('Entorno no válido.');
  if (job.port != null && job.port !== '' && !validPort(job.port))
    throw new Error('Puerto no válido.');
  const args = ['run', '-d', absDir];
  if (job.env) args.push('-e', job.env);
  if (job.target === 'upload') {
    args.push('-t', 'upload');
    if (job.port) args.push('--upload-port', job.port);
  } else if (job.target === 'clean') args.push('-t', 'clean');
  else if (job.target === 'compiledb') args.push('-t', 'compiledb');
  else if (job.target !== 'build') throw new Error('Acción no válida.');
  return args;
}

/** A starter sketch for a new project (Arduino framework), or a plain main for others. */
export function starterSketch(framework: string): string {
  if (framework === 'arduino')
    return [
      '#include <Arduino.h>',
      '',
      'void setup() {',
      '  Serial.begin(115200);',
      '  pinMode(LED_BUILTIN, OUTPUT);',
      '}',
      '',
      'void loop() {',
      '  digitalWrite(LED_BUILTIN, HIGH);',
      '  delay(500);',
      '  digitalWrite(LED_BUILTIN, LOW);',
      '  delay(500);',
      '  Serial.println("hola");',
      '}',
      '',
    ].join('\n');
  return ['int main() {', '  while (1) {', '  }', '}', ''].join('\n');
}

/** Kept serial text: the last `max` characters, cut at a line start. */
export function keepTail(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  const nl = cut.indexOf('\n');
  return nl >= 0 && nl < 200 ? cut.slice(nl + 1) : cut;
}

/** Bytes of a "send" line: \n, \r\n, \r or nothing at the end. */
export function lineEnding(text: string, ending: 'none' | 'nl' | 'cr' | 'crlf'): string {
  return text + (ending === 'nl' ? '\n' : ending === 'cr' ? '\r' : ending === 'crlf' ? '\r\n' : '');
}

// ---------------- libraries (pio pkg) ----------------

export interface PioLibrary {
  /** owner/name, what lib_deps and `pio pkg install -l` take. */
  id: string;
  name: string;
  owner: string;
  version: string;
  description: string;
  /** "Published on …" as PlatformIO prints it. */
  published: string;
}

export interface PioInstalledLibs {
  env: string | null;
  /** lib_deps of platformio.ini for that env. */
  deps: string[];
  /** Folders in .pio/libdeps/<env> (dependencies of dependencies too). */
  installed: { name: string; version: string }[];
}

/** `pio pkg search` text → libraries (it has no JSON output). */
export function parseLibSearch(text: string): {
  libraries: PioLibrary[];
  total: number;
  pages: number;
} {
  const head = /Found\s+(\d+)\s+packages\s+\(page\s+\d+\s+of\s+(\d+)\)/i.exec(text);
  const libraries: PioLibrary[] = [];
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) continue;
    const id = /^([\w.-]+)\/(.+)$/.exec(lines[0]!);
    const meta = /^(Library|Platform|Tool)\s*\S\s*([\w.+-]+)\s*\S\s*(.*)$/u.exec(lines[1]!);
    if (!id || !meta || meta[1] !== 'Library') continue;
    libraries.push({
      id: lines[0]!,
      owner: id[1]!,
      name: id[2]!,
      version: meta[2]!,
      published: meta[3]!.replace(/^Published on\s+/i, ''),
      description: lines.slice(2).join(' '),
    });
  }
  return {
    libraries,
    total: head ? Number(head[1]) : libraries.length,
    pages: head ? Number(head[2]) : 1,
  };
}

/**
 * A library spec for `pio pkg install -l`: "owner/name", "owner/name@^1.2.3" or a plain
 * name. No URLs, paths or options (a spec starting with "-" would read as an option).
 */
export function validLibSpec(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    s.length <= 120 &&
    /^[A-Za-z0-9_][\w .+-]*(\/[\w .+-]+)?(\s*@\s*[\w.^~<>=*+ ,-]+)?$/.test(s) &&
    !/\.\.|:\/\/|\\/.test(s)
  );
}

/** The library name part of a lib_deps entry ("adafruit/DHT sensor library@^1.4" → "adafruit/DHT sensor library"). */
export function libName(spec: string): string {
  return spec.replace(/\s*@.*$/, '').trim();
}

/** Search words for `pio pkg search` (letters, numbers, spaces and a few signs). */
export function validLibQuery(q: unknown): q is string {
  return (
    typeof q === 'string' &&
    q.trim().length > 0 &&
    q.length <= 100 &&
    /^[\w .+/#-]+$/.test(q) &&
    !q.trim().startsWith('-')
  );
}
