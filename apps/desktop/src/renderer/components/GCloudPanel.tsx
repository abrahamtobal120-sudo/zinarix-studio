import { AccountSwitch } from './AccountSwitch';
import { Icon } from './Icon';
import { useCallback, useEffect, useState } from 'react';
import type {
  GCloudBucket,
  GCloudDataset,
  GCloudLogEntry,
  GCloudObject,
  GCloudProject,
  GCloudQueryResult,
  GCloudService,
  GCloudSqlInstance,
  GCloudStatus,
  GCloudTable,
} from '../../shared/api';
import { confirmDialog } from '../confirm';
import { pressable } from '../a11y';
import { t } from '../i18n';
import { api, toast } from '../store';

const errText = (e: unknown) =>
  String((e as Error).message ?? e).replace(/^Error invoking[^:]*: (Error: )?/, '');

const open = (url: string) => void api().app.openExternal(url);
const CONSOLE = 'https://console.cloud.google.com';
const PROJECT_KEY = 'zinarix.gcloudProject';

type View = 'apis' | 'bigquery' | 'storage' | 'sql' | 'logs';

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function when(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : '';
}

/** A Google error, with a button for the link it brings (usually "enable this API here"). */
function ErrorBox({ msg }: { msg: string }) {
  const url = /https:\/\/[^\s"')]+/.exec(msg)?.[0];
  return (
    <div className="vc-alert">
      <div>
        <Icon name="warning" size={13} /> {msg}
      </div>
      {url && (
        <div className="git-connect-actions">
          <button onClick={() => open(url)}>
            <Icon name="external" size={13} /> {t('gcOpenLink')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Loads something for the panel and keeps its error apart. */
function useLoad<T>(load: (() => Promise<T>) | null, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    if (!load) return;
    load()
      .then((x) => alive && setData(x))
      .catch((e: unknown) => alive && setError(errText(e)));
    return () => void (alive = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}

function Grid({ r }: { r: GCloudQueryResult }) {
  if (!r.columns.length) return <div className="git-clean">{t('gcDone', { ms: r.ms })}</div>;
  return (
    <>
      <div className="sb-grid">
        <table>
          <thead>
            <tr>
              {r.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row, i) => (
              <tr key={i}>
                {row.map((v, j) => (
                  <td key={j} className={v === null ? 'null' : ''} title={v ?? 'NULL'}>
                    {v ?? 'NULL'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="git-commit-meta sb-grid-meta">
        {t('gcRows', {
          n: r.rows.length,
          total: r.total,
          ms: r.ms,
          mb: (r.bytes / 1e6).toFixed(1),
        })}
      </div>
    </>
  );
}

function ApisView({ project }: { project: string }) {
  const [all, setAll] = useState(false);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error, reload } = useLoad<GCloudService[]>(
    () => api().gcloud.services(project, all),
    [project, all],
  );
  const toggle = async (s: GCloudService) => {
    if (
      s.enabled &&
      !(await confirmDialog(t('gcDisableConfirm', { name: s.title }), { danger: true }))
    )
      return;
    setBusy(s.name);
    try {
      await api().gcloud.setService(project, s.name, !s.enabled);
      toast(s.enabled ? t('gcDisabling', { name: s.title }) : t('gcEnabling', { name: s.title }));
      setTimeout(reload, 4000);
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const f = filter.toLowerCase();
  const shown = (data ?? []).filter((s) => s.title.toLowerCase().includes(f) || s.name.includes(f));
  return (
    <div className="tree git-list">
      <div className="vc-toolbar">
        <input
          value={filter}
          placeholder={t('gcFilterApis')}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="gc-check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{' '}
          {t('gcAllApis')}
        </label>
      </div>
      {error && <ErrorBox msg={error} />}
      {!data && !error && <div className="git-clean">…</div>}
      <div className="git-group">
        <span>
          {all ? t('gcApisAll') : t('gcApisOn')} <span className="git-count">{shown.length}</span>
        </span>
      </div>
      {shown.slice(0, 400).map((s) => (
        <div key={s.name} className="git-row" title={s.name}>
          <span className={`git-icon ${s.enabled ? 'added' : 'git-dir'}`}>●</span>
          <span className="git-name">{s.title}</span>
          <span className="spacer" />
          <button className="link" disabled={busy !== null} onClick={() => void toggle(s)}>
            {busy === s.name ? '…' : s.enabled ? t('gcDisable') : t('gcEnable')}
          </button>
        </div>
      ))}
    </div>
  );
}

function BigQueryView({ project }: { project: string }) {
  const ds = useLoad<GCloudDataset[]>(() => api().gcloud.datasets(project), [project]);
  const [openDs, setOpenDs] = useState<string | null>(null);
  const [tables, setTables] = useState<GCloudTable[] | null>(null);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<GCloudQueryResult | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setTables(null);
    if (openDs)
      void api()
        .gcloud.tables(project, openDs)
        .then(setTables)
        .catch((e: unknown) => toast(errText(e)));
  }, [project, openDs]);

  const run = async () => {
    if (!sql.trim()) return;
    setRunning(true);
    setQErr(null);
    try {
      setResult(await api().gcloud.query(project, sql));
    } catch (e) {
      setResult(null);
      setQErr(errText(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="tree git-list sb-sql">
      {ds.error && <ErrorBox msg={ds.error} />}
      <div className="git-group">
        <span>
          {t('gcDatasets')} <span className="git-count">{ds.data?.length ?? '…'}</span>
        </span>
      </div>
      {ds.data?.length === 0 && <div className="git-clean">{t('gcNoDatasets')}</div>}
      {ds.data?.map((d) => (
        <div key={d.id}>
          <div
            className="git-row"
            title={d.location}
            {...pressable(() => setOpenDs(openDs === d.id ? null : d.id))}
          >
            <span className="git-icon">{openDs === d.id ? '▾' : '▸'}</span>
            <span className="git-name">{d.id}</span>
            <span className="git-dir vc-right">{d.location}</span>
          </div>
          {openDs === d.id &&
            (tables ?? []).map((tb) => (
              <div
                key={tb.id}
                className="git-row gc-indent"
                title={t('gcTableHint')}
                {...pressable(() =>
                  setSql(`SELECT *\nFROM \`${project}.${d.id}.${tb.id}\`\nLIMIT 100`),
                )}
              >
                <span className="git-icon">
                  <Icon name="database" size={12} />
                </span>
                <span className="git-name">{tb.id}</span>
                <span className="git-dir vc-right">{tb.type}</span>
              </div>
            ))}
        </div>
      ))}
      <textarea
        value={sql}
        spellCheck={false}
        rows={6}
        placeholder={`SELECT * FROM \`${project}.dataset.tabla\` LIMIT 100`}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void run();
          }
        }}
      />
      <div className="git-connect-actions">
        <button className="primary" disabled={!sql.trim() || running} onClick={() => void run()}>
          <Icon name="play" size={14} /> {running ? '…' : `${t('sbRun')} (Ctrl+Enter)`}
        </button>
        {result && (
          <button onClick={() => setResult(null)} title={t('sbClear')}>
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      <p className="vc-hint">{t('gcBillHint')}</p>
      {qErr && <ErrorBox msg={qErr} />}
      {result && <Grid r={result} />}
    </div>
  );
}

function StorageView({ project }: { project: string }) {
  const bs = useLoad<GCloudBucket[]>(() => api().gcloud.buckets(project), [project]);
  const [bucket, setBucket] = useState<string | null>(null);
  const [prefix, setPrefix] = useState('');
  const objs = useLoad<GCloudObject[]>(bucket ? () => api().gcloud.objects(bucket, prefix) : null, [
    bucket,
    prefix,
  ]);

  if (bucket) {
    const up = () => {
      if (!prefix) return setBucket(null);
      const parts = prefix.split('/').filter(Boolean);
      parts.pop();
      setPrefix(parts.length ? `${parts.join('/')}/` : '');
    };
    return (
      <div className="tree git-list">
        <div className="git-row" {...pressable(up)}>
          <span className="git-icon">←</span>
          <span className="git-name">
            {bucket}/{prefix}
          </span>
        </div>
        {objs.error && <ErrorBox msg={objs.error} />}
        {objs.data?.length === 0 && <div className="git-clean">{t('gcEmpty')}</div>}
        {objs.data?.map((o) => (
          <div
            key={o.name}
            className="git-row"
            title={o.name}
            {...pressable(() =>
              o.folder
                ? setPrefix(o.name)
                : open(
                    `${CONSOLE}/storage/browser/_details/${bucket}/${o.name.split('/').map(encodeURIComponent).join('/')}?project=${project}`,
                  ),
            )}
          >
            <span className="git-icon">
              <Icon name={o.folder ? 'folder' : 'file'} size={12} />
            </span>
            <span className="git-name">{o.name.slice(prefix.length) || o.name}</span>
            {!o.folder && <span className="git-dir vc-right">{size(o.size)}</span>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="tree git-list">
      {bs.error && <ErrorBox msg={bs.error} />}
      <div className="git-group">
        <span>
          {t('gcBuckets')} <span className="git-count">{bs.data?.length ?? '…'}</span>
        </span>
      </div>
      {bs.data?.length === 0 && <div className="git-clean">{t('gcNoBuckets')}</div>}
      {bs.data?.map((b) => (
        <div
          key={b.name}
          className="git-row"
          title={`${b.location} · ${b.storageClass}`}
          {...pressable(() => {
            setPrefix('');
            setBucket(b.name);
          })}
        >
          <span className="git-icon">
            <Icon name="folder" size={12} />
          </span>
          <span className="git-name">{b.name}</span>
          <span className="git-dir vc-right">{b.location}</span>
        </div>
      ))}
    </div>
  );
}

function SqlView({ project }: { project: string }) {
  const is = useLoad<GCloudSqlInstance[]>(() => api().gcloud.sqlInstances(project), [project]);
  const [busy, setBusy] = useState<string | null>(null);
  const power = async (i: GCloudSqlInstance) => {
    const on = i.state === 'STOPPED';
    if (!on && !(await confirmDialog(t('gcStopConfirm', { name: i.name }), { danger: true })))
      return;
    setBusy(i.name);
    try {
      await api().gcloud.sqlPower(project, i.name, on);
      toast(on ? t('gcStarting', { name: i.name }) : t('gcStopping', { name: i.name }));
      setTimeout(is.reload, 5000);
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="tree git-list">
      {is.error && <ErrorBox msg={is.error} />}
      <div className="git-group">
        <span>
          {t('gcInstances')} <span className="git-count">{is.data?.length ?? '…'}</span>
        </span>
      </div>
      {is.data?.length === 0 && <div className="git-clean">{t('gcNoInstances')}</div>}
      {is.data?.map((i) => (
        <div key={i.name} className="git-commit-row">
          <div className="git-commit-subject">
            <span className={`vc-dot ${i.state === 'RUNNABLE' ? 'added' : 'git-dir'}`}>●</span>{' '}
            {i.name}
            <span className="git-refs">
              <span className="git-ref">{i.version}</span>
            </span>
          </div>
          <div className="git-commit-meta">
            {i.state} · {i.region} · {i.tier}
            {i.ip ? ` · ${i.ip}` : ''}
          </div>
          <div className="git-connect-actions">
            <button disabled={busy !== null} onClick={() => void power(i)}>
              {busy === i.name ? '…' : i.state === 'STOPPED' ? t('gcStart') : t('gcStop')}
            </button>
            <button
              onClick={() => open(`${CONSOLE}/sql/instances/${i.name}/overview?project=${project}`)}
            >
              <Icon name="external" size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function LogsView({ project }: { project: string }) {
  const [draft, setDraft] = useState('severity>=WARNING');
  const [filter, setFilter] = useState('severity>=WARNING');
  const logs = useLoad<GCloudLogEntry[]>(
    () => api().gcloud.logs(project, filter),
    [project, filter],
  );
  const sevClass = (s: string) =>
    /ERROR|CRITICAL|ALERT|EMERGENCY/.test(s) ? 'deleted' : s === 'WARNING' ? 'modified' : 'git-dir';
  return (
    <div className="tree git-list">
      <div className="vc-toolbar">
        <input
          value={draft}
          placeholder={t('gcLogFilter')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setFilter(draft);
          }}
        />
        <button onClick={() => (draft === filter ? logs.reload() : setFilter(draft))}>
          <Icon name="refresh" size={13} />
        </button>
      </div>
      {logs.error && <ErrorBox msg={logs.error} />}
      {!logs.data && !logs.error && <div className="git-clean">…</div>}
      {logs.data?.length === 0 && <div className="git-clean">{t('gcNoLogs')}</div>}
      {logs.data?.map((e, i) => (
        <div key={i} className="git-commit-row" title={e.text}>
          <div className="git-commit-meta">
            <span className={sevClass(e.severity)}>{e.severity}</span> · {when(e.time)} ·{' '}
            {e.resource}
          </div>
          <div className="git-commit-subject gc-log">{e.text}</div>
        </div>
      ))}
    </div>
  );
}

/** Google Cloud panel: "Sign in with Google" once, then every API of the user's projects. */
export function GCloudPanel() {
  const [st, setSt] = useState<GCloudStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [client, setClient] = useState({ id: '', secret: '' });
  const [projects, setProjects] = useState<GCloudProject[] | null>(null);
  const [projErr, setProjErr] = useState<string | null>(null);
  const [project, setProject] = useState<string>(() => localStorage.getItem(PROJECT_KEY) ?? '');
  const [view, setView] = useState<View>('apis');

  const act = async (name: string, f: () => Promise<void>) => {
    setBusy(name);
    try {
      await f();
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const refresh = useCallback(() => void api().gcloud.status().then(setSt), []);
  useEffect(refresh, [refresh]);

  const loadProjects = useCallback(() => {
    setProjects(null);
    setProjErr(null);
    api()
      .gcloud.projects()
      .then((ps) => {
        setProjects(ps);
        setProject((cur) => (ps.some((p) => p.id === cur) ? cur : (ps[0]?.id ?? '')));
      })
      .catch((e: unknown) => setProjErr(errText(e)));
  }, []);

  useEffect(() => {
    if (st?.connected && !adding) loadProjects();
  }, [st?.connected, st?.active, adding, loadProjects]);

  useEffect(() => {
    if (project) localStorage.setItem(PROJECT_KEY, project);
  }, [project]);

  // The APIs Zinarix uses switch on by themselves in the chosen project.
  const [preparing, setPreparing] = useState(false);
  useEffect(() => {
    if (!st?.connected || !projects || !project) return;
    let live = true;
    setPreparing(true);
    api()
      .gcloud.prepare(project)
      .then((on) => {
        if (live && on.length) toast(t('gcAutoOn', { n: on.length }));
      })
      // No permission to turn APIs on (a viewer role): the views still try with what is on.
      .catch((e: unknown) => live && toast(t('gcAutoFail', { msg: errText(e) })))
      .finally(() => live && setPreparing(false));
    return () => {
      live = false;
    };
  }, [st?.connected, st?.active, projects, project]);

  const title = (
    <div className="sidebar-title">
      <span className="panel-title">GOOGLE CLOUD</span>
      <span className="sidebar-actions">
        {st?.connected && (
          <button title={t('gitRefresh')} onClick={loadProjects}>
            <Icon name="refresh" size={15} />
          </button>
        )}
        <button
          title="console.cloud.google.com"
          onClick={() => open(project ? `${CONSOLE}/home/dashboard?project=${project}` : CONSOLE)}
        >
          <Icon name="external" size={15} />
        </button>
      </span>
    </div>
  );

  if (!st) {
    return (
      <div className="explorer">
        {title}
        <div className="git-clean">
          <Icon name="clock" size={13} className="spin-slow" /> {t('vcLoading')}
        </div>
      </div>
    );
  }

  // No OAuth client yet: the same one the Mail panel uses.
  if (!st.ready) {
    const save = () =>
      void act('client', async () => {
        await api().mail.setGoogleClient(client.id.trim(), client.secret.trim());
        setClient({ id: '', secret: '' });
        setSt(await api().gcloud.status());
      });
    return (
      <div className="explorer">
        {title}
        <div className="sidebar-empty vc-connect">
          <p>{t('gcIntro')}</p>
          <p className="vc-hint">{t('gcSetupHint')}</p>
          <button className="link" onClick={() => open(`${CONSOLE}/apis/credentials`)}>
            {t('mlGoogleConsole')}
          </button>
          <input
            value={client.id}
            placeholder="Client ID (…apps.googleusercontent.com)"
            onChange={(e) => setClient({ ...client, id: e.target.value })}
          />
          <input
            type="password"
            value={client.secret}
            placeholder="Client secret (GOCSPX-…)"
            onChange={(e) => setClient({ ...client, secret: e.target.value })}
          />
          <button
            className="primary"
            disabled={client.id.trim().length < 10 || busy !== null}
            onClick={save}
          >
            {busy === 'client' ? '…' : t('mlGoogleSave')}
          </button>
        </div>
      </div>
    );
  }

  const account = (
    <AccountSwitch
      icon={<Icon name="cloud" size={12} />}
      label={st.user ?? 'Google Cloud'}
      accounts={st.accounts}
      active={st.active}
      busy={busy !== null}
      onUse={(id) =>
        void act('use', async () => {
          setProjects(null);
          setSt(await api().gcloud.useAccount(id));
        })
      }
      onAdd={() => setAdding(true)}
      onLogout={async () => {
        if (await confirmDialog(t('gcLogoutConfirm'), { danger: true }))
          void act('logout', async () => {
            setProjects(null);
            setSt(await api().gcloud.logout());
          });
      }}
    />
  );

  if (!adding && !st.connected && st.offline) {
    return (
      <div className="explorer">
        {title}
        {account}
        <div className="sidebar-empty vc-connect">
          <p>{t('svcOffline', { name: 'Google Cloud' })}</p>
          <p className="vc-hint">{st.offline}</p>
          <button className="primary" disabled={busy !== null} onClick={refresh}>
            {t('svcRetry')}
          </button>
        </div>
      </div>
    );
  }

  if (!st.connected || adding) {
    const login = () =>
      void act('login', async () => {
        setSt(await api().gcloud.login());
        setAdding(false);
      });
    return (
      <div className="explorer">
        {title}
        <div className="sidebar-empty vc-connect">
          <p>{adding ? t('acctAddIntro') : st.accounts.length ? t('gcExpired') : t('gcIntro')}</p>
          <button className="primary" disabled={busy !== null} onClick={login}>
            {busy === 'login' ? t('mlGoogleWaiting') : t('gcLogin')}
          </button>
          <p className="vc-hint">{t('gcLoginHint')}</p>
          {adding && (
            <button className="link" onClick={() => setAdding(false)}>
              {t('acctCancel')}
            </button>
          )}
        </div>
      </div>
    );
  }

  const tabs: [View, string][] = [
    ['apis', 'APIs'],
    ['bigquery', 'BigQuery'],
    ['storage', 'Storage'],
    ['sql', 'Cloud SQL'],
    ['logs', t('gcLogs')],
  ];

  return (
    <div className="explorer git-panel">
      {title}
      {account}
      <div className="vc-toolbar">
        <select
          value={project}
          disabled={!projects?.length}
          title={t('gcProject')}
          onChange={(e) => setProject(e.target.value)}
        >
          {!projects && <option value={project}>…</option>}
          {projects?.length === 0 && <option value="">{t('gcNoProjects')}</option>}
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name === p.id ? p.id : `${p.name} (${p.id})`}
            </option>
          ))}
        </select>
      </div>
      {projErr && <ErrorBox msg={projErr} />}
      {preparing && (
        <div className="git-clean">
          <Icon name="clock" size={13} className="spin-slow" /> {t('gcPreparing')}
        </div>
      )}
      {projects && project && !preparing && (
        <>
          <div className="git-branchbar">
            <div className="git-tabs">
              {tabs.map(([id, label]) => (
                <button key={id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {view === 'apis' && <ApisView key={project} project={project} />}
          {view === 'bigquery' && <BigQueryView key={project} project={project} />}
          {view === 'storage' && <StorageView key={project} project={project} />}
          {view === 'sql' && <SqlView key={project} project={project} />}
          {view === 'logs' && <LogsView key={project} project={project} />}
        </>
      )}
    </div>
  );
}
