import { useEffect, useState } from 'react';
import type { LicenseStatus, ProFeature } from '../../shared/plans';
import { TRIAL_DAYS } from '../../shared/plans';
import { runCommand } from '../commands';
import { t } from '../i18n';
import type { Key } from '../i18n';
import { api, getState, refreshLicense, refreshModels, setState, toast, useStore } from '../store';
import { Icon } from './Icon';
import type { IconName } from './Icon';

const close = () => setState({ modal: null });
const buy = () => void api().app.openExternal(getState().license.buyUrl);
const errText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );

export function planLabel(l: LicenseStatus): string {
  switch (l.plan) {
    case 'owner':
      return t('planOwner');
    case 'pro':
      return 'Pro';
    case 'trial':
      return t('planTrialDays', { n: l.trialDaysLeft ?? TRIAL_DAYS });
    case 'open':
      return t('planOpen');
    default:
      return t('planFree');
  }
}

/** Status bar: the plan, one click from the license panel. */
export function PlanBadge() {
  const l = useStore((s) => s.license);
  // While charging is off there is nothing to say (the owner still sees "Pro (dueño)").
  if (l.plan === 'open') return null;
  return (
    <span
      className={`status-item plan-badge plan-${l.plan}`}
      title={t('planTitle')}
      onClick={() => setState({ modal: { kind: 'license' } })}
    >
      <Icon name={l.plan === 'free' ? 'star' : 'sparkles'} size={12} /> {planLabel(l)}
    </span>
  );
}

/** What Pro adds, in the order people notice it. */
const PRO_ROWS: { icon: IconName; key: Key; free: (l: LicenseStatus) => string }[] = [
  { icon: 'message', key: 'proChats', free: (l) => String(l.free.maxChats) },
  { icon: 'columns', key: 'proSplit', free: (l) => (l.free.split ? '✓' : '—') },
  { icon: 'window', key: 'proWindows', free: (l) => (l.free.windows ? '✓' : '1') },
];

function ProTable() {
  const l = useStore((s) => s.license);
  if (l.plan === 'open') return null;
  return (
    <table className="plan-table">
      <thead>
        <tr>
          <th />
          <th>{t('planFree')}</th>
          <th className="pro">Pro</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <Icon name="sparkles" size={13} /> {t('proBase')}
          </td>
          <td>✓</td>
          <td className="pro">✓</td>
        </tr>
        {PRO_ROWS.map((r) => (
          <tr key={r.key}>
            <td>
              <Icon name={r.icon} size={13} /> {t(r.key)}
            </td>
            <td className="dim">{r.free(l)}</td>
            <td className="pro">✓</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** While everything is free: what "everything" means. */
const INCLUDED: { icon: IconName; key: Key }[] = [
  { icon: 'sparkles', key: 'proBase' },
  { icon: 'message', key: 'newChats' },
  { icon: 'columns', key: 'proSplit' },
  { icon: 'window', key: 'newWindows' },
  { icon: 'globe', key: 'newBrowser' },
  { icon: 'users', key: 'newDelegate' },
];

function Included() {
  return (
    <div className="plan-included">
      {INCLUDED.map((r) => (
        <div key={r.key}>
          <Icon name={r.icon} size={15} />
          <span>{t(r.key)}</span>
          <Icon name="check" size={13} />
        </div>
      ))}
    </div>
  );
}

function ActivateForm({ onDone }: { onDone?: (l: LicenseStatus) => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activate = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const l = await api().license.activate(key);
      setState({ license: l });
      setKey('');
      toast(t('planActivated', { plan: planLabel(l) }));
      onDone?.(l);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="plan-activate">
      <label htmlFor="plan-key">{t('planKeyLabel')}</label>
      <div className="plan-activate-row">
        <input
          id="plan-key"
          value={key}
          spellCheck={false}
          placeholder="ZX1.…"
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void activate()}
        />
        <button className="primary" disabled={!key.trim() || busy} onClick={() => void activate()}>
          {busy ? '…' : t('planActivate')}
        </button>
      </div>
      {error && <div className="plan-error">{error}</div>}
    </div>
  );
}

/** Plan and license: what you have, what Pro adds, activate or remove a key. */
export function LicensePanel() {
  const l = useStore((s) => s.license);
  useEffect(() => {
    void refreshLicense();
  }, []);
  const remove = async () => {
    if (!confirm(t('planRemoveConfirm'))) return;
    setState({ license: await api().license.remove() });
  };
  const until =
    l.plan === 'pro' && l.expires
      ? t('planUntil', { date: new Date(l.expires).toLocaleDateString() })
      : l.plan === 'pro' || l.plan === 'owner'
        ? t('planForever')
        : l.plan === 'trial' && l.trialEndsAt
          ? t('planTrialUntil', { date: new Date(l.trialEndsAt).toLocaleDateString() })
          : t('planFreeHint');
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="plan-panel" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={close} aria-label={t('close')}>
          ×
        </button>
        <div className={`plan-hero plan-${l.plan}`}>
          <img src="./logo.svg" alt="" />
          <div>
            <div className="plan-name">Zinarix Studio {planLabel(l)}</div>
            <div className="plan-sub">
              {l.email ? `${l.name ? `${l.name} · ` : ''}${l.email} · ` : ''}
              {until}
            </div>
          </div>
        </div>
        {l.problem && (
          <div className="plan-error">
            <Icon name="warning" size={13} /> {l.problem}
          </div>
        )}
        {l.plan === 'open' && (
          <>
            <div className="plan-open">
              <Icon name="sparkles" size={14} /> {t('planOpenBody')}
            </div>
            <Included />
          </>
        )}
        <ProTable />
        {l.billing && l.plan !== 'owner' && l.plan !== 'pro' && (
          <div className="plan-buy">
            <button className="primary big" onClick={buy}>
              <Icon name="sparkles" size={15} /> {t('planBuy')}
            </button>
            <span className="dim">{t('planBuyHint')}</span>
          </div>
        )}
        {l.plan === 'pro' || l.plan === 'owner' ? (
          <div className="plan-footer">
            <button onClick={() => void remove()}>{t('planRemove')}</button>
          </div>
        ) : (
          <ActivateForm />
        )}
      </div>
    </div>
  );
}

const FEATURE_TITLE: Record<ProFeature, Key> = {
  chats: 'upChats',
  split: 'upSplit',
  windows: 'upWindows',
};

/** A Pro feature on the free plan: say what it is and how to get it, without nagging. */
export function UpgradeModal({ feature }: { feature: ProFeature }) {
  const [activating, setActivating] = useState(false);
  const free = useStore((s) => s.license.free);
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="plan-panel upgrade" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={close} aria-label={t('close')}>
          ×
        </button>
        <div className="upgrade-icon">
          <Icon name="sparkles" size={26} />
        </div>
        <h2>{t(FEATURE_TITLE[feature], { n: free.maxChats })}</h2>
        <p className="dim">{t('upBody')}</p>
        <ProTable />
        {activating ? (
          <ActivateForm onDone={close} />
        ) : (
          <div className="upgrade-actions">
            <button className="primary big" onClick={buy}>
              {t('planBuy')}
            </button>
            <button onClick={() => setActivating(true)}>{t('planHaveKey')}</button>
            <button className="link" onClick={close}>
              {t('notNow')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const ONBOARDED_KEY = 'zs.onboarded';
const SEEN_VERSION_KEY = 'zs.seenVersion';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the guide may show again next time
  }
}

/** Chats saved by an earlier session: this person used Zinarix before this version. */
const USED_BEFORE = ['zs.chats', 'zs.lastConversation'].some((k) => stored(k) !== null);

/**
 * On start: the guided setup for someone who has never connected an AI; "what's new" for
 * someone who already used Zinarix and just got a new version. Never both, never twice.
 */
export function introOnStart(version: string, hasModels: boolean): void {
  const seen = stored(SEEN_VERSION_KEY);
  store(SEEN_VERSION_KEY, version);
  if (!stored(ONBOARDED_KEY)) {
    store(ONBOARDED_KEY, '1');
    if (!hasModels) return setState({ modal: { kind: 'welcome' } });
    // A brand-new install that already found an AI (local models): nothing is "new" yet.
    if (!USED_BEFORE) return;
  }
  if (seen !== version && hasModels) setState({ modal: { kind: 'whatsNew' } });
}

/** First launch: four short steps to a working AI. */
export function Onboarding() {
  const [step, setStep] = useState(0);
  const models = useStore((s) => s.models);
  const l = useStore((s) => s.license);
  const [searching, setSearching] = useState(false);
  const steps = 4;
  const findLocal = async () => {
    setSearching(true);
    try {
      await refreshModels(true);
    } finally {
      setSearching(false);
    }
  };
  const providers = () => setState({ modal: { kind: 'providers' } });
  return (
    <div className="modal-backdrop onboarding-backdrop">
      <div className="onboarding" onMouseDown={(e) => e.stopPropagation()}>
        <div className="onb-dots" aria-hidden="true">
          {Array.from({ length: steps }, (_, i) => (
            <span key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />
          ))}
        </div>
        {step === 0 && (
          <div className="onb-step center">
            <img className="onb-logo" src="./logo.svg" alt="" />
            <h1>{t('onbWelcome')}</h1>
            <p className="onb-lead">{t('onbLead')}</p>
            <div className="onb-pills">
              <span>
                <Icon name="message" size={13} /> {t('onbPill1')}
              </span>
              <span>
                <Icon name="globe" size={13} /> {t('onbPill2')}
              </span>
              <span>
                <Icon name="users" size={13} /> {t('onbPill3')}
              </span>
            </div>
          </div>
        )}
        {step === 1 && (
          <div className="onb-step">
            <h2>{t('onbConnect')}</h2>
            <p className="dim">{t('onbConnectLead')}</p>
            {models.length > 0 && (
              <div className="onb-ok">
                <Icon name="check" size={14} /> {t('onbReady', { n: models.length })}
              </div>
            )}
            <div className="onb-cards">
              <button className="onb-card" onClick={() => void findLocal()}>
                <Icon name="cpu" size={22} />
                <b>{t('onbLocal')}</b>
                <span>{searching ? t('onbSearching') : t('onbLocalHint')}</span>
              </button>
              <button className="onb-card" onClick={providers}>
                <Icon name="terminal" size={22} />
                <b>{t('onbCli')}</b>
                <span>{t('onbCliHint')}</span>
              </button>
              <button className="onb-card" onClick={providers}>
                <Icon name="key" size={22} />
                <b>{t('onbKey')}</b>
                <span>{t('onbKeyHint')}</span>
              </button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="onb-step">
            <h2>
              {l.plan === 'open'
                ? t('onbFreeAll')
                : l.plan === 'trial'
                  ? t('onbTrial', { n: l.trialDaysLeft ?? TRIAL_DAYS })
                  : `Zinarix Studio ${planLabel(l)}`}
            </h2>
            <p className="dim">{l.plan === 'open' ? t('planOpenBody') : t('onbTrialLead')}</p>
            {l.plan === 'open' ? <Included /> : <ProTable />}
            {l.billing && l.plan !== 'pro' && l.plan !== 'owner' && <ActivateForm />}
          </div>
        )}
        {step === 3 && (
          <div className="onb-step">
            <h2>{t('onbDone')}</h2>
            <div className="onb-tips">
              <div>
                <kbd>Ctrl+Alt+N</kbd> {t('chatNewTab')}
              </div>
              <div>
                <kbd>Ctrl+Alt+D</kbd> {t('chatSplit')}
              </div>
              <div>
                <kbd>Ctrl+Shift+N</kbd> {t('newWindow')}
              </div>
              <div>
                <kbd>Ctrl+K</kbd> {t('aiEdit')}
              </div>
              <div>
                <kbd>Ctrl+Shift+P</kbd> {t('cmdPalette')}
              </div>
            </div>
          </div>
        )}
        <div className="onb-nav">
          {step > 0 ? (
            <button onClick={() => setStep(step - 1)}>{t('back')}</button>
          ) : (
            <button className="link" onClick={close}>
              {t('onbSkip')}
            </button>
          )}
          {step < steps - 1 ? (
            <button className="primary" onClick={() => setStep(step + 1)}>
              {step === 0 ? t('onbStart') : t('next')}
            </button>
          ) : (
            <span className="onb-final">
              <button onClick={() => (close(), void runCommand('workspace.open'))}>
                <Icon name="folder" size={14} /> {t('openFolder')}
              </button>
              <button className="primary" onClick={() => (close(), setState({ chatOpen: true }))}>
                <Icon name="sparkles" size={14} /> {t('onbGo')}
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const NEWS: { icon: IconName; title: Key; body: Key; keys?: string }[] = [
  { icon: 'message', title: 'newChats', body: 'newChatsBody', keys: 'Ctrl+Alt+N' },
  { icon: 'columns', title: 'newSplit', body: 'newSplitBody', keys: 'Ctrl+Alt+D' },
  { icon: 'window', title: 'newWindows', body: 'newWindowsBody', keys: 'Ctrl+Shift+N' },
  { icon: 'globe', title: 'newBrowser', body: 'newBrowserBody' },
  { icon: 'users', title: 'newDelegate', body: 'newDelegateBody' },
  { icon: 'handoff', title: 'newHandoff', body: 'newHandoffBody' },
];

/** First launch of a new version: what changed, with the shortcuts to try it. */
export function WhatsNew() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    void api()
      .ai.settings()
      .then((s) => setVersion(s.version));
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="plan-panel news" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={close} aria-label={t('close')}>
          ×
        </button>
        <h2>
          <Icon name="sparkles" size={18} /> {t('newsTitle', { v: version })}
        </h2>
        <div className="news-grid">
          {NEWS.map((n) => (
            <div key={n.title} className="news-card">
              <span className="news-icon">
                <Icon name={n.icon} size={18} />
              </span>
              <div>
                <b>{t(n.title)}</b>
                <p>{t(n.body)}</p>
                {n.keys && <kbd>{n.keys}</kbd>}
              </div>
            </div>
          ))}
        </div>
        <div className="upgrade-actions">
          <button className="primary" onClick={close}>
            {t('newsOk')}
          </button>
          <button onClick={() => setState({ modal: { kind: 'license' } })}>{t('planTitle')}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * A new version: ready (restart into it), downloading by itself, or available to download
 * (installs that cannot update themselves).
 */
export function UpdateBanner() {
  const u = useStore((s) => s.update);
  const [hidden, setHidden] = useState<string | null>(null);
  if (!u || hidden === `${u.state}:${u.version}`) return null;
  return (
    <div className="update-banner" role="status">
      <Icon name="download" size={14} />
      <span>
        {u.state === 'ready'
          ? t('updReady', { v: u.version })
          : u.url
            ? t('updAvailable', { v: u.version })
            : t('updDownloading', { v: u.version })}
      </span>
      {u.state === 'ready' && (
        <button className="primary" onClick={() => void api().app.installUpdate()}>
          {t('updRestart')}
        </button>
      )}
      {u.state === 'available' && u.url && (
        <button className="primary" onClick={() => void api().app.openExternal(u.url!)}>
          {t('updDownload')}
        </button>
      )}
      <button
        className="link"
        onClick={() => setHidden(`${u.state}:${u.version}`)}
        aria-label={t('close')}
      >
        ×
      </button>
    </div>
  );
}

const NOTICES_KEY = 'zs.notices';

/** A message from the owner (app-config.json): shown once, until closed. */
export function NoticeBanner() {
  const n = useStore((s) => s.notice);
  if (!n) return null;
  const dismiss = () => {
    try {
      const seen = JSON.parse(localStorage.getItem(NOTICES_KEY) ?? '[]') as string[];
      localStorage.setItem(NOTICES_KEY, JSON.stringify([...seen, n.id].slice(-50)));
    } catch {
      // storage unavailable: it shows again next start
    }
    setState({ notice: null });
  };
  return (
    <div className="notice-banner" role="status">
      <img src="./logo.svg" alt="" />
      <span>{n.text}</span>
      {n.url && (
        <button className="primary" onClick={() => void api().app.openExternal(n.url!)}>
          {t('noticeMore')}
        </button>
      )}
      <button className="link" onClick={dismiss} aria-label={t('close')}>
        ×
      </button>
    </div>
  );
}

/** A notice already closed on this computer is not shown again. */
export function noticeSeen(id: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(NOTICES_KEY) ?? '[]') as string[]).includes(id);
  } catch {
    return false;
  }
}
