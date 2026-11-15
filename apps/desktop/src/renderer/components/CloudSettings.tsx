import { useEffect, useState } from 'react';
import type { CloudSyncStatus, SupabaseProjectView, SupabaseStatus } from '../../shared/api';
import { t } from '../i18n';
import { confirmDialog } from '../confirm';
import { api, toast } from '../store';
import { Icon } from './Icon';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Settings → Cloud: links one of the user's own Supabase projects and syncs chats, memories
 * and usage there, end-to-end encrypted with a passphrase only the user knows.
 */
export function CloudSection() {
  const [status, setStatus] = useState<CloudSyncStatus | null>(null);
  const [sb, setSb] = useState<SupabaseStatus | null>(null);
  const [projects, setProjects] = useState<SupabaseProjectView[]>([]);
  const [ref, setRef] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api().cloud.status().then(setStatus).catch(() => undefined);
    return api().on((ev) => {
      if (ev.type === 'cloud:status') setStatus(ev.status);
    });
  }, []);

  useEffect(() => {
    if (!status || status.connected) return;
    void api()
      .supabase.status()
      .then(async (s) => {
        setSb(s);
        if (!s.connected) return;
        const list = await api().supabase.projects();
        setProjects(list);
        setRef((r) => r || list[0]?.ref || '');
      })
      .catch((e) => toast(errText(e)));
  }, [status?.connected]);

  const run = async (fn: () => Promise<CloudSyncStatus>) => {
    setBusy(true);
    try {
      setStatus(await fn());
    } catch (e) {
      toast(errText(e));
      void api().cloud.status().then(setStatus).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const connect = () => {
    if (pass.length < 8) return toast(t('cloudPassShort'));
    if (pass !== pass2) return toast(t('cloudPassMismatch'));
    void run(async () => {
      const s = await api().cloud.connect(sb?.active ?? null, ref, pass);
      setPass('');
      setPass2('');
      toast(t('cloudConnected'));
      return s;
    });
  };

  const disconnect = async () => {
    if (!(await confirmDialog(t('cloudDisconnectConfirm')))) return;
    void run(() => api().cloud.disconnect());
  };

  if (!status) return null;

  return (
    <>
      <h3>{t('cloudTitle')}</h3>
      <p className="dim small">{t('cloudHint')}</p>

      {status.connected ? (
        <div className="phone-card">
          <p>
            <Icon name="cloud" size={14} />{' '}
            {t('cloudLinked', { name: status.projectName ?? status.ref ?? '' })}
          </p>
          <p className="dim small">
            {status.syncing
              ? t('cloudSyncing')
              : status.lastSync
                ? t('cloudLast', {
                    when: new Date(status.lastSync).toLocaleString(),
                    in: status.lastIn,
                    out: status.lastOut,
                  })
                : t('cloudNever')}
          </p>
          {status.lastError && <p className="small error-text">{status.lastError}</p>}
          <div className="knowledge-add">
            <button
              className="primary"
              disabled={busy || status.syncing}
              onClick={() => void run(() => api().cloud.syncNow())}
            >
              <Icon name="sync" size={13} /> {t('cloudSyncNow')}
            </button>
            <button disabled={busy} onClick={() => void disconnect()}>
              {t('cloudDisconnect')}
            </button>
          </div>
          <p className="settings-hint">{t('cloudWhat')}</p>
        </div>
      ) : !sb ? null : !sb.connected ? (
        <p className="dim small">{t('cloudNeedSupabase')}</p>
      ) : (
        <div className="phone-card">
          <label className="settings-label" htmlFor="cloud-project">
            {t('cloudProject')}
          </label>
          <select
            id="cloud-project"
            value={ref}
            disabled={busy}
            onChange={(e) => setRef(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.ref} value={p.ref}>
                {p.name} ({p.region})
              </option>
            ))}
          </select>
          {!projects.length && <p className="dim small">{t('cloudNoProjects')}</p>}
          <label className="settings-label" htmlFor="cloud-pass">
            {t('cloudPass')}
          </label>
          <input
            id="cloud-pass"
            type="password"
            autoComplete="new-password"
            value={pass}
            disabled={busy}
            onChange={(e) => setPass(e.target.value)}
          />
          <input
            type="password"
            aria-label={t('cloudPassAgain')}
            placeholder={t('cloudPassAgain')}
            autoComplete="new-password"
            value={pass2}
            disabled={busy}
            onChange={(e) => setPass2(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') connect();
            }}
          />
          <p className="settings-hint">{t('cloudPassHint')}</p>
          <button className="primary" disabled={busy || !ref || !pass} onClick={connect}>
            <Icon name="cloud" size={13} /> {busy ? t('cloudConnecting') : t('cloudConnect')}
          </button>
        </div>
      )}
    </>
  );
}
