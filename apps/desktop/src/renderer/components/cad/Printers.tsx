import { useCallback, useEffect, useState } from 'react';
import { api, toast } from '../../store';
import { errText } from '../../errText';
import { confirmDialog } from '../../confirm';
import { lang } from '../../i18n';
import { Icon } from '../Icon';
import { formatDuration } from '../../../shared/gcode';
import type { PrinterConfig, PrinterKind, PrinterStatus } from '../../../shared/slicer';
import { tc } from './cadStrings';

type Saved = PrinterConfig & { hasKey: boolean };
const POLL_MS = 5000;
const LAST_KEY = 'zs.printer.last';

/** Saved printers, refreshed when one is added or removed anywhere in the window. */
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

function usePrinters(): [Saved[], () => Promise<void>] {
  const [list, setList] = useState<Saved[]>([]);
  const load = useCallback(async () => setList(await api().printers.list().catch(() => [])), []);
  useEffect(() => {
    void load();
    const l = () => void load();
    listeners.add(l);
    return () => void listeners.delete(l);
  }, [load]);
  return [list, load];
}

/** Live status of one printer while it is on screen. */
function useStatus(id: string | null): [PrinterStatus | null, () => void] {
  const [st, setSt] = useState<PrinterStatus | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!id) return setSt(null);
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const s = await api().printers.status(id).catch((e: unknown) => ({ online: false, state: 'offline', printing: false, paused: false, error: errText(e) }) as PrinterStatus);
      if (!alive) return;
      setSt(s);
      // Only while the window is visible: no traffic to the printer from a hidden app.
      const next = () => {
        if (!alive) return;
        if (document.hidden) timer = setTimeout(next, POLL_MS);
        else void poll();
      };
      timer = setTimeout(next, POLL_MS);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, tick]);
  return [st, () => setTick((n) => n + 1)];
}

function statusText(st: PrinterStatus | null): { text: string; kind: 'ok' | 'warn' | 'bad' | 'busy' } {
  if (!st) return { text: '…', kind: 'warn' };
  if (!st.online) return { text: st.error ? `${tc('offline')}: ${st.error}` : tc('offline'), kind: 'bad' };
  if (st.paused) return { text: tc('paused'), kind: 'warn' };
  if (st.printing) {
    const pct = st.progress !== undefined ? Math.round(st.progress * 100) : 0;
    const left = st.timeLeftS !== undefined ? ` · ${tc('timeLeft', { t: formatDuration(st.timeLeftS, lang === 'en' ? 'en' : 'es') })}` : '';
    return { text: `${tc('printingPct', { p: pct })}${left}`, kind: 'busy' };
  }
  return { text: `${tc('idle')} (${st.state})`, kind: 'ok' };
}

const temps = (st: PrinterStatus | null) =>
  st?.nozzle || st?.bed
    ? tc('tempsVal', { n: st.nozzle ? `${st.nozzle.actual.toFixed(0)}/${st.nozzle.target.toFixed(0)}` : '?', b: st.bed ? `${st.bed.actual.toFixed(0)}/${st.bed.target.toFixed(0)}` : '?' })
    : '';

function PrinterRow({ p, onEdit }: { p: Saved; onEdit: () => void }) {
  const [st, refresh] = useStatus(p.id);
  const s = statusText(st);
  const act = async (a: 'pause' | 'resume' | 'cancel') => {
    if (a === 'cancel' && !(await confirmDialog(tc('cancelConfirm', { name: p.name }), { danger: true }))) return;
    try {
      await api().printers.control(p.id, a);
      refresh();
    } catch (e) {
      toast(errText(e));
    }
  };
  return (
    <li className="cad-printer">
      <div className="cad-printer-head">
        <span className={`cad-dot ${s.kind}`} aria-hidden />
        <strong>{p.name}</strong>
        <span className="cad-hint">{p.kind === 'octoprint' ? 'OctoPrint' : 'Klipper'}</span>
        <span className="cad-grow" />
        <button className="icon-btn" title={tc('editPrinter')} aria-label={tc('editPrinter')} onClick={onEdit}>
          <Icon name="edit" />
        </button>
      </div>
      <div className="cad-printer-state" aria-live="polite">
        {s.text}
        {st?.file && (st.printing || st.paused) ? ` · ${st.file}` : ''}
      </div>
      {st?.printing && st.progress !== undefined && (
        <div className="cad-bar" role="progressbar" aria-valuenow={Math.round(st.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${Math.round(st.progress * 100)}%` }} />
        </div>
      )}
      {temps(st) && <div className="cad-hint">{temps(st)}</div>}
      {(st?.printing || st?.paused) && (
        <div className="cad-row-btns">
          {st.paused ? (
            <button className="btn ghost cad-small" onClick={() => void act('resume')}>
              <Icon name="play" /> {tc('resume')}
            </button>
          ) : (
            <button className="btn ghost cad-small" onClick={() => void act('pause')}>
              <Icon name="pause" /> {tc('pause')}
            </button>
          )}
          <button className="btn ghost cad-small danger" onClick={() => void act('cancel')}>
            <Icon name="stop" /> {tc('cancelPrint')}
          </button>
        </div>
      )}
    </li>
  );
}

function PrinterForm({ p, onDone }: { p: Saved | null; onDone: () => void }) {
  const [name, setName] = useState(p?.name ?? '');
  const [kind, setKind] = useState<PrinterKind>(p?.kind ?? 'octoprint');
  const [url, setUrl] = useState(p?.url ?? '');
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = () => ({ ...(p ? { id: p.id } : {}), name, kind, url, ...(key.trim() ? { key } : {}) });

  const test = async () => {
    setBusy(true);
    setMsg({ ok: true, text: tc('testing') });
    try {
      setMsg({ ok: true, text: tc('testOk', { v: await api().printers.test(input()) }) });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      await api().printers.save(input());
      changed();
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!p || !(await confirmDialog(tc('removeConfirm', { name: p.name }), { danger: true }))) return;
    await api().printers.remove(p.id).catch((e: unknown) => toast(errText(e)));
    changed();
    onDone();
  };
  return (
    <form
      className="cad-printer-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="cad-field">
        <span>{tc('pKind')}</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as PrinterKind)}>
          <option value="octoprint">OctoPrint</option>
          <option value="moonraker">Klipper (Moonraker: Mainsail / Fluidd)</option>
        </select>
      </label>
      <label className="cad-field">
        <span>{tc('pName')}</span>
        <input value={name} maxLength={60} placeholder="Ender 3" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="cad-field">
        <span>{tc('pUrl')}</span>
        <input value={url} required placeholder={kind === 'octoprint' ? 'http://octopi.local' : 'http://192.168.1.50:7125'} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="cad-field">
        <span>{tc('pKey')}</span>
        <input type="password" autoComplete="off" value={key} placeholder={p?.hasKey ? tc('pKeySaved') : ''} onChange={(e) => setKey(e.target.value)} />
      </label>
      <p className="cad-hint">{kind === 'octoprint' ? tc('pKeyHintOcto') : tc('pKeyHintMoon')}</p>
      {msg && (
        <p className={`cad-print-line ${msg.ok ? 'note' : 'bad'}`} role="status">
          {msg.text}
        </p>
      )}
      <div className="cad-row-btns">
        <button type="button" className="btn ghost cad-small" disabled={busy || !url.trim()} onClick={() => void test()}>
          {tc('test')}
        </button>
        <button type="submit" className="btn cad-small" disabled={busy || !url.trim()}>
          {tc('save')}
        </button>
        <button type="button" className="btn ghost cad-small" onClick={onDone}>
          {tc('cancelForm')}
        </button>
        {p && (
          <button type="button" className="btn ghost cad-small danger" onClick={() => void remove()}>
            <Icon name="trash" /> {tc('removePrinter')}
          </button>
        )}
      </div>
    </form>
  );
}

/** Fase 7 (mejora): the printers card of the CAD panel. */
export function PrintersBox() {
  const [list] = usePrinters();
  const [editing, setEditing] = useState<Saved | 'new' | null>(null);
  return (
    <section className="cad-card">
      <h3 className="cad-h">{tc('printers')}</h3>
      {list.length === 0 && !editing && <p className="cad-hint">{tc('noPrinters')}</p>}
      {list.length > 0 && (
        <ul className="cad-printers">
          {list.map((p) =>
            editing !== 'new' && editing?.id === p.id ? (
              <li key={p.id}>
                <PrinterForm p={p} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <PrinterRow key={p.id} p={p} onEdit={() => setEditing(p)} />
            ),
          )}
        </ul>
      )}
      {editing === 'new' ? (
        <PrinterForm p={null} onDone={() => setEditing(null)} />
      ) : (
        <button className="btn ghost cad-small" onClick={() => setEditing('new')}>
          <Icon name="plus" /> {tc('addPrinter')}
        </button>
      )}
    </section>
  );
}

/** Send a G-code of the project to one of the printers (in the G-code viewer). */
export function SendBox({ path }: { path: string }) {
  const [list] = usePrinters();
  const [id, setId] = useState<string>(() => localStorage.getItem(LAST_KEY) ?? '');
  const [start, setStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosen = list.find((p) => p.id === id) ?? list[0] ?? null;
  const [st, refresh] = useStatus(chosen?.id ?? null);
  if (!list.length) return <p className="cad-hint">{tc('sendNone')}</p>;
  const s = statusText(st);
  const send = async () => {
    if (!chosen) return;
    const file = path.split(/[\\/]/).pop() ?? path;
    if (start && !(await confirmDialog(tc('sendConfirm', { file, name: chosen.name }), { okLabel: tc('sendBtn') }))) return;
    setBusy(true);
    try {
      await api().printers.send(chosen.id, path, start);
      toast(start ? tc('sentStart', { name: chosen.name }) : tc('sent', { name: chosen.name }));
      refresh();
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cad-send">
      <label className="cad-field">
        <span>{tc('slicePrinter')}</span>
        <select
          value={chosen?.id ?? ''}
          onChange={(e) => {
            setId(e.target.value);
            localStorage.setItem(LAST_KEY, e.target.value);
          }}
        >
          {list.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className={`cad-printer-state ${s.kind}`} aria-live="polite">
        <span className={`cad-dot ${s.kind}`} aria-hidden /> {s.text}
      </div>
      <label className="cad-check">
        <input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} />
        {tc('sendStart')}
      </label>
      <button className="btn cad-small" disabled={busy || !st?.online || (start && (st.printing || st.paused))} onClick={() => void send()}>
        <Icon name="send" /> {tc('sendBtn')}
      </button>
    </div>
  );
}
