/**
 * Fase 7 (mejora): sending G-code to a 3D printer on the network and watching it. OctoPrint
 * (REST API with an API key) and Klipper through Moonraker (API key optional). The printers
 * are saved in a JSON file; their keys go to the system keychain (TokenStore), never there.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import {
  PRINTER_KINDS,
  type PrinterAction,
  type PrinterConfig,
  type PrinterKind,
  type PrinterStatus,
  type Temp,
} from '../shared/slicer.js';

export {
  PRINTER_KINDS,
  type PrinterAction,
  type PrinterConfig,
  type PrinterKind,
  type PrinterStatus,
};

export interface Secret {
  get(): string | null;
  set(v: string): void;
  delete(): void;
}

type Fetch = typeof fetch;

/** http(s) only, no credentials in the URL, without the trailing slash. */
export function normalizePrinterUrl(raw: string): string {
  let v = raw.trim();
  if (!/^[a-z]+:\/\//i.test(v)) v = `http://${v}`;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error(
      'La dirección no es válida (ejemplo: http://octopi.local o http://192.168.1.50).',
    );
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw new Error('La dirección debe empezar con http:// o https://.');
  if (u.username || u.password)
    throw new Error('No pongas usuario ni contraseña en la dirección; usa la clave de API.');
  u.hash = '';
  u.search = '';
  return u.toString().replace(/\/+$/, '');
}

/** File name the printer will show: safe characters, ends in .gcode. */
export function printerFileName(p: string): string {
  const b =
    basename(p)
      .replace(/[^\w.\- ]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 120) || 'zinarix';
  return /\.(gcode|gco|g|bgcode)$/i.test(b) ? b : `${b}.gcode`;
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const temp = (o: unknown): Temp | undefined => {
  const t = o as { actual?: unknown; target?: unknown; temperature?: unknown } | undefined;
  const a = num(t?.actual) ?? num(t?.temperature);
  return a === undefined ? undefined : { actual: a, target: num(t?.target) ?? 0 };
};

export class PrinterClient {
  constructor(
    private readonly cfg: PrinterConfig,
    private readonly key: string | null,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async call(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.key) headers.set('X-Api-Key', this.key);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await this.fetchImpl(`${this.cfg.url}${path}`, {
        ...init,
        headers,
        signal: ctl.signal,
        redirect: 'manual',
      });
    } catch (e) {
      throw new Error(
        ctl.signal.aborted
          ? `${this.cfg.name} no respondió (${this.cfg.url}).`
          : `No se pudo conectar con ${this.cfg.name} (${this.cfg.url}): ${(e as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async json(path: string, init?: RequestInit, timeoutMs?: number): Promise<unknown> {
    const r = await this.call(path, init, timeoutMs);
    if (r.status === 401 || r.status === 403)
      throw new Error(`${this.cfg.name} rechazó la clave de API (${r.status}).`);
    if (!r.ok) {
      const t = (await r.text().catch(() => '')).slice(0, 300);
      const e = new Error(`${this.cfg.name} respondió ${r.status}${t ? `: ${t}` : ''}`) as Error & {
        status?: number;
      };
      e.status = r.status;
      throw e;
    }
    const t = await r.text();
    return t ? JSON.parse(t) : {};
  }

  async status(): Promise<PrinterStatus> {
    try {
      return this.cfg.kind === 'octoprint' ? await this.octoStatus() : await this.moonStatus();
    } catch (e) {
      return {
        online: false,
        state: 'offline',
        printing: false,
        paused: false,
        error: (e as Error).message,
      };
    }
  }

  private async octoStatus(): Promise<PrinterStatus> {
    const job = (await this.json('/api/job')) as {
      state?: string;
      job?: { file?: { name?: string } };
      progress?: { completion?: number; printTimeLeft?: number };
    };
    let printer: {
      temperature?: Record<string, unknown>;
      state?: { text?: string; flags?: Record<string, boolean> };
    } = {};
    let disconnected = false;
    try {
      printer = (await this.json('/api/printer')) as typeof printer;
    } catch (e) {
      // 409: OctoPrint is up but not connected to the printer.
      if ((e as { status?: number }).status === 409) disconnected = true;
      else throw e;
    }
    const flags = printer.state?.flags ?? {};
    const state = disconnected
      ? 'Desconectada de OctoPrint'
      : (printer.state?.text ?? job.state ?? '?');
    const c = num(job.progress?.completion);
    return {
      online: !disconnected,
      state,
      printing: !!flags.printing || /printing/i.test(job.state ?? ''),
      paused: !!flags.paused || /paus/i.test(job.state ?? ''),
      ...(job.job?.file?.name ? { file: job.job.file.name } : {}),
      ...(c !== undefined ? { progress: c / 100 } : {}),
      ...(num(job.progress?.printTimeLeft) !== undefined
        ? { timeLeftS: job.progress!.printTimeLeft! }
        : {}),
      ...(temp(printer.temperature?.tool0) ? { nozzle: temp(printer.temperature?.tool0)! } : {}),
      ...(temp(printer.temperature?.bed) ? { bed: temp(printer.temperature?.bed)! } : {}),
    };
  }

  private async moonStatus(): Promise<PrinterStatus> {
    const r = (await this.json(
      '/printer/objects/query?print_stats&virtual_sdcard&extruder&heater_bed&webhooks',
    )) as {
      result?: { status?: Record<string, Record<string, unknown>> };
    };
    const st = r.result?.status ?? {};
    const ps = st.print_stats ?? {};
    const state = String(ps.state ?? st.webhooks?.state ?? '?');
    const progress = num(st.virtual_sdcard?.progress);
    const dur = num(ps.print_duration);
    const printing = state === 'printing';
    const paused = state === 'paused';
    const ready = st.webhooks?.state;
    return {
      online: ready === undefined || ready === 'ready',
      state: ready && ready !== 'ready' ? `Klipper: ${String(ready)}` : state,
      printing,
      paused,
      ...(ps.filename ? { file: String(ps.filename) } : {}),
      ...(progress !== undefined && (printing || paused) ? { progress } : {}),
      ...(progress && dur && (printing || paused) && progress > 0.01
        ? { timeLeftS: Math.round(dur / progress - dur) }
        : {}),
      ...(temp(st.extruder) ? { nozzle: temp(st.extruder)! } : {}),
      ...(temp(st.heater_bed) ? { bed: temp(st.heater_bed)! } : {}),
      ...(ps.message ? { error: String(ps.message) } : {}),
    };
  }

  /** Checks the address and the key: the version the printer software reports. */
  async test(): Promise<string> {
    if (this.cfg.kind === 'octoprint') {
      const v = (await this.json('/api/version')) as { server?: string; text?: string };
      if (!v.server && !v.text) throw new Error('Esa dirección no parece OctoPrint.');
      // /api/version answers without a valid key on some setups: /api/job needs one.
      await this.json('/api/job');
      return v.text ?? `OctoPrint ${v.server}`;
    }
    const v = (await this.json('/server/info')) as {
      result?: { moonraker_version?: string; klippy_state?: string };
    };
    if (!v.result) throw new Error('Esa dirección no parece Moonraker (Klipper).');
    return `Moonraker ${v.result.moonraker_version ?? ''} · Klipper ${v.result.klippy_state ?? '?'}`.trim();
  }

  /** Uploads the G-code; `start` prints it right away. */
  async upload(name: string, data: Uint8Array, start: boolean): Promise<void> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }),
      name,
    );
    if (this.cfg.kind === 'octoprint') {
      form.append('select', start ? 'true' : 'false');
      form.append('print', start ? 'true' : 'false');
      await this.json('/api/files/local', { method: 'POST', body: form }, 10 * 60_000);
    } else {
      form.append('root', 'gcodes');
      if (start) form.append('print', 'true');
      await this.json('/server/files/upload', { method: 'POST', body: form }, 10 * 60_000);
    }
  }

  async control(action: PrinterAction): Promise<void> {
    if (this.cfg.kind === 'octoprint') {
      const body = action === 'cancel' ? { command: 'cancel' } : { command: 'pause', action };
      await this.json('/api/job', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });
    } else await this.json(`/printer/print/${action}`, { method: 'POST' });
  }
}

/** The saved printers; their API keys live in the keychain. */
export class PrinterStore {
  constructor(
    private readonly file: string,
    private readonly secretFor: (id: string) => Secret,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  list(): (PrinterConfig & { hasKey: boolean })[] {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      return [];
    }
    const arr = Array.isArray(raw) ? raw : [];
    return arr
      .filter(
        (p): p is PrinterConfig =>
          !!p &&
          typeof p === 'object' &&
          typeof p.id === 'string' &&
          PRINTER_KINDS.includes(p.kind) &&
          typeof p.url === 'string',
      )
      .map((p) => ({
        id: p.id,
        name: String(p.name || p.url),
        kind: p.kind,
        url: p.url,
        hasKey: !!this.secretFor(p.id).get(),
      }));
  }

  private async write(list: PrinterConfig[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(
      this.file,
      JSON.stringify(
        list.map(({ id, name, kind, url }) => ({ id, name, kind, url })),
        null,
        2,
      ),
    );
  }

  get(idOrName: string): PrinterConfig {
    const all = this.list();
    const p =
      all.find((x) => x.id === idOrName) ??
      all.find((x) => x.name.toLowerCase() === idOrName.trim().toLowerCase());
    if (!p)
      throw new Error(
        all.length
          ? `No hay una impresora "${idOrName}". Están: ${all.map((x) => x.name).join(', ')}.`
          : 'No hay impresoras. Agrega una en el panel CAD 3D → Impresoras.',
      );
    return p;
  }

  /** Adds or edits one. key: undefined = keep the saved one, '' = remove it. */
  async save(input: {
    id?: string;
    name: string;
    kind: PrinterKind;
    url: string;
    key?: string;
  }): Promise<PrinterConfig> {
    if (!PRINTER_KINDS.includes(input.kind)) throw new Error('Tipo de impresora desconocido.');
    const url = normalizePrinterUrl(input.url);
    const name = input.name.trim().slice(0, 60) || new URL(url).host;
    const list = this.list().map(({ hasKey: _h, ...p }) => p);
    const id = input.id && list.some((p) => p.id === input.id) ? input.id : randomUUID();
    const cfg: PrinterConfig = { id, name, kind: input.kind, url };
    const i = list.findIndex((p) => p.id === id);
    if (i >= 0) list[i] = cfg;
    else list.push(cfg);
    await this.write(list);
    if (input.key !== undefined) {
      if (input.key.trim()) this.secretFor(id).set(input.key.trim());
      else this.secretFor(id).delete();
    }
    return cfg;
  }

  async remove(id: string): Promise<void> {
    await this.write(this.list().filter((p) => p.id !== id));
    this.secretFor(id).delete();
  }

  client(idOrName: string): PrinterClient {
    const p = this.get(idOrName);
    return new PrinterClient(p, this.secretFor(p.id).get(), this.fetchImpl);
  }
}

/** One line of status, in the user's language. */
export function describeStatus(name: string, s: PrinterStatus, lang: 'es' | 'en' = 'es'): string {
  if (!s.online && s.error)
    return `${name}: ${lang === 'en' ? 'not reachable' : 'sin conexión'} (${s.error})`;
  const parts = [`${name}: ${s.state}`];
  if (s.file) parts.push(s.file);
  if (s.progress !== undefined) parts.push(`${Math.round(s.progress * 100)} %`);
  if (s.timeLeftS !== undefined)
    parts.push(`${lang === 'en' ? 'left' : 'faltan'} ${Math.round(s.timeLeftS / 60)} min`);
  if (s.nozzle)
    parts.push(
      `${lang === 'en' ? 'nozzle' : 'boquilla'} ${s.nozzle.actual.toFixed(0)}/${s.nozzle.target.toFixed(0)} °C`,
    );
  if (s.bed)
    parts.push(
      `${lang === 'en' ? 'bed' : 'cama'} ${s.bed.actual.toFixed(0)}/${s.bed.target.toFixed(0)} °C`,
    );
  return parts.join(' · ');
}
