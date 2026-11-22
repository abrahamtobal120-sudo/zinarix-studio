import { useEffect, useState } from 'react';
import type { IssuedKey, IssuerStatus, PaidPlan } from '../../shared/plans';
import { lang } from '../i18n';
import { api, toast } from '../store';
import { Icon } from './Icon';
import './owner-keys.css';

/** Settings → "Claves (dueño)": the owner makes and hands out signed license keys. */

const es = {
  title: 'Claves de licencia (dueño)',
  lead: 'Solo tú ves esto. Las claves se firman con la llave privada de esta PC y se guardan en {path}.',
  noKey: 'No se pueden hacer claves aquí: {why}',
  gifts: '{n} claves de regalo Pro + AI',
  giftsLead: 'Gratis y sin vencimiento, para tus clientes de Pro AI. Marca cada una cuando la entregues.',
  left: '{n} sin entregar',
  copy: 'Copiar',
  copied: 'Clave copiada',
  copyFree: 'Copiar las que faltan',
  copiedMany: '{n} claves copiadas',
  given: 'Entregada',
  note: 'A quién (nota)',
  make: 'Hacer claves nuevas',
  plan: 'Plan',
  email: 'Correo del cliente',
  name: 'Nombre (opcional)',
  days: 'Días (0 = nunca vence)',
  count: 'Cuántas',
  create: 'Crear',
  made: '{n} claves nuevas listas',
  others: 'Otras claves hechas',
  none: 'Todavía no hiciste otras claves.',
  never: 'nunca vence',
  until: 'vence {d}',
  loading: 'Cargando…',
};
const en: typeof es = {
  title: 'License keys (owner)',
  lead: 'Only you see this. Keys are signed with this PC’s private key and saved in {path}.',
  noKey: 'Keys cannot be made here: {why}',
  gifts: '{n} free Pro + AI gift keys',
  giftsLead: 'Free and never expiring, for your Pro AI customers. Tick each one when you hand it out.',
  left: '{n} not handed out',
  copy: 'Copy',
  copied: 'Key copied',
  copyFree: 'Copy the ones left',
  copiedMany: '{n} keys copied',
  given: 'Handed out',
  note: 'Who got it (note)',
  make: 'Make new keys',
  plan: 'Plan',
  email: 'Customer email',
  name: 'Name (optional)',
  days: 'Days (0 = never expires)',
  count: 'How many',
  create: 'Create',
  made: '{n} new keys ready',
  others: 'Other keys made',
  none: 'You have not made other keys yet.',
  never: 'never expires',
  until: 'expires {d}',
  loading: 'Loading…',
};
function tk(key: keyof typeof es, vars: Record<string, string | number> = {}): string {
  return (lang === 'en' ? en : es)[key].replace(/\{(\w+)\}/g, (m, k: string) =>
    k in vars ? String(vars[k]) : m,
  );
}
const errText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );

const PLAN_NAME: Record<Exclude<PaidPlan, 'free'>, string> = {
  pro: 'Pro',
  ai: 'AI',
  proai: 'Pro + AI',
};

function copy(text: string, msg: string) {
  void navigator.clipboard.writeText(text).then(() => toast(msg));
}

function KeyRow({ k, onChange }: { k: IssuedKey; onChange: (s: IssuerStatus) => void }) {
  const [note, setNote] = useState(k.note ?? '');
  const save = (given: boolean, n = note) =>
    void api()
      .license.markIssued(k.id, given, n)
      .then(onChange)
      .catch((e: unknown) => toast(errText(e)));
  return (
    <div className={`owner-key${k.given ? ' given' : ''}`}>
      <div className="owner-key-head">
        <b>{k.name ?? k.email}</b>
        <span className="dim small">
          {PLAN_NAME[k.plan]} · {k.gift ? '' : `${k.email} · `}
          {k.exp ? tk('until', { d: new Date(k.exp).toLocaleDateString() }) : tk('never')}
        </span>
        <span className="spacer" />
        <label className="owner-given">
          <input type="checkbox" checked={k.given} onChange={(e) => save(e.target.checked)} />{' '}
          {tk('given')}
        </label>
        <button className="small" onClick={() => copy(k.key, tk('copied'))}>
          <Icon name="copy" size={13} /> {tk('copy')}
        </button>
      </div>
      <code className="owner-key-code">{k.key}</code>
      <input
        className="owner-key-note"
        placeholder={tk('note')}
        value={note}
        maxLength={200}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== (k.note ?? '') && save(k.given || note.trim() !== '', note)}
      />
    </div>
  );
}

export function OwnerKeysSection() {
  const [st, setSt] = useState<IssuerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Exclude<PaidPlan, 'free'>>('proai');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [days, setDays] = useState(0);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api()
      .license.issuer()
      .then(setSt)
      .catch((e: unknown) => setError(errText(e)));
  }, []);
  if (error) return <p className="plan-error">{error}</p>;
  if (!st) return <p className="dim">{tk('loading')}</p>;
  if (!st.available) return <p className="plan-error">{tk('noKey', { why: st.reason ?? '' })}</p>;
  const gifts = st.keys.filter((k) => k.gift).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  const others = st.keys.filter((k) => !k.gift);
  const left = gifts.filter((k) => !k.given);
  const create = async () => {
    setBusy(true);
    try {
      const before = st.keys.length;
      const next = await api().license.issue({ plan, email, name, days, count });
      setSt(next);
      toast(tk('made', { n: next.keys.length - before }));
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="owner-keys">
      <h3>{tk('title')}</h3>
      <p className="dim small">{tk('lead', { path: st.keyPath.replace(/[\\/][^\\/]+$/, '') })}</p>

      <h4>
        <Icon name="star" size={14} /> {tk('gifts', { n: gifts.length })}{' '}
        <span className="dim small">· {tk('left', { n: left.length })}</span>
      </h4>
      <p className="dim small">{tk('giftsLead')}</p>
      {left.length > 0 && (
        <button
          className="small"
          onClick={() =>
            copy(
              left.map((k) => `${k.name ?? ''}\n${k.key}`).join('\n\n'),
              tk('copiedMany', { n: left.length }),
            )
          }
        >
          <Icon name="copy" size={13} /> {tk('copyFree')}
        </button>
      )}
      <div className="owner-key-list">
        {gifts.map((k) => (
          <KeyRow key={k.id} k={k} onChange={setSt} />
        ))}
      </div>

      <h4>
        <Icon name="key" size={14} /> {tk('make')}
      </h4>
      <div className="owner-form">
        <label>
          {tk('plan')}
          <select value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)}>
            <option value="proai">Pro + AI</option>
            <option value="pro">Pro</option>
            <option value="ai">AI</option>
          </select>
        </label>
        <label>
          {tk('email')}
          <input value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {tk('name')}
          <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {tk('days')}
          <input
            type="number"
            min={0}
            max={36500}
            value={days}
            onChange={(e) => setDays(Math.max(0, Math.min(36500, Number(e.target.value) || 0)))}
          />
        </label>
        <label>
          {tk('count')}
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
          />
        </label>
        <button className="primary" disabled={busy} onClick={() => void create()}>
          {tk('create')}
        </button>
      </div>

      <h4>{tk('others')}</h4>
      {others.length === 0 ? (
        <p className="dim small">{tk('none')}</p>
      ) : (
        <div className="owner-key-list">
          {others.map((k) => (
            <KeyRow key={k.id} k={k} onChange={setSt} />
          ))}
        </div>
      )}
    </div>
  );
}
