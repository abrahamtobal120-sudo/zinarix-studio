import { Icon } from './Icon';
import { useCallback, useEffect, useState } from 'react';
import type {
  SupabaseBucketView,
  SupabaseFunctionView,
  SupabaseHealthView,
  SupabaseProjectView,
  SupabaseQueryResult,
  SupabaseStatus,
  SupabaseTableView,
} from '../../shared/api';
import { t } from '../i18n';
import { api, setState, toast, useStore } from '../store';
import { runInTerminal } from './Terminal';

const errText = (e: unknown) =>
  String((e as Error).message ?? e).replace(/^Error invoking[^:]*: (Error: )?/, '');

/** Project chosen by hand for a folder that has no supabase/.temp/project-ref. */
const PICK_KEY = 'zinarix.supabaseProject:';
const DASH = 'https://supabase.com/dashboard';

const open = (url: string) => void api().app.openExternal(url);

/** Statements that only read (anything else asks first: it runs on the real database). */
const READ_ONLY = /^\s*(select|with|explain|show|table|values)\b/i;

function inTerminal(cli: boolean, args: string) {
  setState({ panelOpen: true });
  setTimeout(() => void runInTerminal(`${cli ? 'supabase' : 'npx supabase'} ${args}`), 300);
}

function statusClass(s: string): string {
  if (s === 'ACTIVE_HEALTHY') return 'added';
  if (s === 'INACTIVE' || s === 'PAUSED') return 'git-dir';
  if (s.includes('UNHEALTHY') || s.includes('FAILED')) return 'deleted';
  return 'modified';
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    ACTIVE_HEALTHY: t('sbActive'),
    INACTIVE: t('sbPaused'),
    PAUSED: t('sbPaused'),
    COMING_UP: t('sbStarting'),
    RESTORING: t('sbStarting'),
    PAUSING: t('sbPausing'),
  };
  return map[s] ?? s;
}

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return t('vcNow');
  if (s < 3600) return t('vcMinutes', { n: Math.floor(s / 60) });
  if (s < 86400) return t('vcHours', { n: Math.floor(s / 3600) });
  return t('vcDays', { n: Math.floor(s / 86400) });
}

/** Query result as a small scrollable grid. */
function Grid({ r }: { r: SupabaseQueryResult }) {
  if (!r.columns.length) return <div className="git-clean">{t('sbNoRows', { ms: r.ms })}</div>;
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
        {r.total > r.rows.length
          ? t('sbRowsOf', { n: r.rows.length, total: r.total, ms: r.ms })
          : t('sbRows', { n: r.total, ms: r.ms })}
      </div>
    </>
  );
}

export function SupabasePanel() {
  const workspace = useStore((s) => s.workspace);
  const root = workspace?.root;
  const [st, setSt] = useState<SupabaseStatus | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  const [projects, setProjects] = useState<SupabaseProjectView[] | null>(null);
  const [org, setOrg] = useState('');
  const [filter, setFilter] = useState('');
  const [health, setHealth] = useState<SupabaseHealthView[]>([]);
  const [view, setView] = useState<'tables' | 'sql' | 'functions' | 'storage'>('tables');
  const [tables, setTables] = useState<SupabaseTableView[] | null>(null);
  const [preview, setPreview] = useState<{ key: string; r: SupabaseQueryResult } | null>(null);
  const [sql, setSql] = useState('select now();');
  const [result, setResult] = useState<SupabaseQueryResult | null>(null);
  const [fns, setFns] = useState<SupabaseFunctionView[] | null>(null);
  const [buckets, setBuckets] = useState<SupabaseBucketView[] | null>(null);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void api().supabase.status().then(setSt);
  }, []);

  // Project of the open folder: the `supabase link` file first, then a project picked here.
  useEffect(() => {
    setRef(null);
    setLinked(false);
    if (!st?.connected) return;
    void api()
      .supabase.linked()
      .then((l) => {
        if (l) {
          setLinked(true);
          setRef(l);
          return;
        }
        const saved = root && localStorage.getItem(PICK_KEY + root);
        if (saved) setRef(saved);
      });
  }, [st?.connected, root]);

  // The projects list gives name, region and status (also of the chosen one).
  const loadProjects = useCallback(() => {
    if (!st?.connected) return;
    void api()
      .supabase.projects()
      .then(setProjects)
      .catch((e: unknown) => {
        toast(errText(e));
        setProjects([]);
      });
  }, [st?.connected]);
  useEffect(loadProjects, [loadProjects]);

  const project = projects?.find((p) => p.ref === ref) ?? null;
  const paused = project ? project.status !== 'ACTIVE_HEALTHY' : false;

  const loadTab = useCallback(async () => {
    if (!ref) return;
    try {
      if (view === 'tables') setTables(await api().supabase.tables(ref));
      else if (view === 'functions') setFns(await api().supabase.functions(ref));
      else if (view === 'storage') setBuckets(await api().supabase.buckets(ref));
    } catch (e) {
      toast(errText(e));
    }
  }, [ref, view]);

  useEffect(() => {
    setTables(null);
    setFns(null);
    setBuckets(null);
    setPreview(null);
    setResult(null);
    setHealth([]);
    if (!ref) return;
    void api()
      .supabase.health(ref)
      .then(setHealth)
      .catch(() => setHealth([]));
  }, [ref]);

  useEffect(() => {
    if (!paused) void loadTab();
  }, [loadTab, paused]);

  // While the project starts or pauses, its status refreshes by itself.
  const changing = project ? !['ACTIVE_HEALTHY', 'INACTIVE'].includes(project.status) : false;
  useEffect(() => {
    if (!changing) return;
    const h = setInterval(loadProjects, 8000);
    return () => clearInterval(h);
  }, [changing, loadProjects]);

  const choose = (p: SupabaseProjectView) => {
    if (root) localStorage.setItem(PICK_KEY + root, p.ref);
    setRef(p.ref);
  };

  const unpick = () => {
    if (root) localStorage.removeItem(PICK_KEY + root);
    setRef(null);
  };

  const runSql = () => {
    if (!ref || !sql.trim() || busy) return;
    if (!READ_ONLY.test(sql) && !confirm(t('sbWriteConfirm'))) return;
    void act('sql', async () => setResult(await api().supabase.query(ref, sql)));
  };

  const title = (
    <div className="sidebar-title">
      <span className="panel-title">SUPABASE</span>
      <span className="sidebar-actions">
        {ref && (
          <button
            title={t('gitRefresh')}
            onClick={() => {
              loadProjects();
              void loadTab();
            }}
          >
            <Icon name="refresh" size={15} />
          </button>
        )}
        {st?.connected && (
          <button
            title="supabase.com"
            onClick={() => open(ref ? `${DASH}/project/${ref}` : `${DASH}/projects`)}
          >
            <Icon name="external" size={15} />
          </button>
        )}
      </span>
    </div>
  );

  if (!st) {
    return (
      <div className="explorer">
        {title}
        <div className="git-clean">
          <Icon name="clock" size={13} className="spin-slow" /> {t('sbLoading')}
        </div>
      </div>
    );
  }

  if (!st.connected) {
    const connect = () =>
      void act('token', async () => {
        setSt(await api().supabase.setToken(token));
        setToken('');
      });
    return (
      <div className="explorer">
        {title}
        <div className="sidebar-empty vc-connect">
          <p>{st.source ? t('sbTokenRejected') : t('sbIntro')}</p>
          <input
            type="password"
            value={token}
            placeholder="sbp_…"
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && token.trim()) connect();
            }}
          />
          <button className="primary" disabled={!token.trim() || busy !== null} onClick={connect}>
            {busy === 'token' ? '…' : t('vcConnect')}
          </button>
          <button className="link" onClick={() => open(`${DASH}/account/tokens`)}>
            {t('vcCreateToken')}
          </button>
          <p className="vc-hint">{st.cli ? t('sbCliHint') : t('sbCliMissing')}</p>
          <button onClick={() => inTerminal(st.cli, 'login')}>{t('sbCliLogin')}</button>
          <button className="link" onClick={() => void api().supabase.status().then(setSt)}>
            {t('vcRecheck')}
          </button>
        </div>
      </div>
    );
  }

  const account = (
    <div className="git-branchbar">
      <span className="git-branch" title={st.source === 'cli' ? t('sbFromCli') : t('vcFromApp')}>
        <Icon name="supabase" size={12} /> {st.orgs.map((o) => o.name).join(', ') || 'Supabase'}
      </span>
      <span className="spacer" />
      {st.source === 'app' && (
        <button
          className="link"
          onClick={() => {
            if (confirm(t('sbLogoutConfirm')))
              void act('logout', async () => setSt(await api().supabase.logout()));
          }}
        >
          {t('vcLogout')}
        </button>
      )}
    </div>
  );

  // No project for this folder yet: pick one (or link it with the CLI).
  if (!ref) {
    const shown = (projects ?? []).filter(
      (p) => (!org || p.orgId === org) && p.name.toLowerCase().includes(filter.toLowerCase()),
    );
    return (
      <div className="explorer">
        {title}
        {account}
        <div className="git-connect">
          <div className="git-connect-title">
            <Icon name="supabase" size={15} /> {workspace ? t('sbNotLinked') : t('vcNoFolder')}
          </div>
          <div className="git-connect-actions">
            <button className="primary" onClick={() => open(`${DASH}/new`)}>
              {t('sbNewProject')}
            </button>
            {workspace && (
              <button onClick={() => inTerminal(st.cli, 'link')}>{t('sbLink')}</button>
            )}
          </div>
        </div>
        <div className="vc-toolbar">
          {st.orgs.length > 1 && (
            <select value={org} onChange={(e) => setOrg(e.target.value)} title={t('sbOrg')}>
              <option value="">{t('sbAllOrgs')}</option>
              {st.orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          <input
            value={filter}
            placeholder={t('vcFilter')}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="tree git-list">
          <div className="git-group">
            <span>
              {t('vcProjects')} <span className="git-count">{projects?.length ?? '…'}</span>
            </span>
          </div>
          {projects?.length === 0 && <div className="git-clean">{t('sbNoProjects')}</div>}
          {shown.map((p) => (
            <div
              key={p.ref}
              className="git-row"
              title={`${p.ref} · ${p.region}`}
              onClick={() => choose(p)}
            >
              <span className={`git-icon ${statusClass(p.status)}`}>●</span>
              <span className="git-name">{p.name}</span>
              <span className="git-dir">{p.region}</span>
              <span className="git-dir vc-right">{statusLabel(p.status)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const dash = `${DASH}/project/${ref}`;
  const schemas = [...new Set((tables ?? []).map((x) => x.schema))];

  return (
    <div className="explorer git-panel">
      {title}
      {account}
      <div className="vc-project">
        <div className="vc-project-name">
          <strong>
            <Icon name="supabase" size={13} /> {project?.name ?? ref}
          </strong>
          {project && (
            <span className={`git-ref ${statusClass(project.status)}`}>
              {statusLabel(project.status)}
            </span>
          )}
          <span className="spacer" />
          {!linked && (
            <button className="link" title={t('vcChangeTitle')} onClick={unpick}>
              {t('vcChange')}
            </button>
          )}
        </div>
        <div className="git-commit-meta">
          <code>{ref}</code>
          {project && ` · ${project.region}`}
          {project?.dbVersion && ` · Postgres ${project.dbVersion}`}
        </div>
        {health.length > 0 && (
          <div className="sb-health">
            {health.map((h) => (
              <span key={h.name} className={h.healthy ? 'added' : 'deleted'} title={h.status}>
                ● {h.name}
              </span>
            ))}
          </div>
        )}
        <div className="git-connect-actions vc-actions">
          {project?.status === 'INACTIVE' ? (
            <button
              className="primary"
              onClick={() =>
                void act('restore', async () => {
                  await api().supabase.restore(ref);
                  toast(t('sbRestoring'));
                  loadProjects();
                })
              }
            >
              <Icon name="play" size={14} /> {t('sbRestore')}
            </button>
          ) : (
            <>
              <button
                className="primary"
                disabled={!workspace}
                title={t('sbPushTitle')}
                onClick={() => {
                  if (confirm(t('sbPushConfirm'))) inTerminal(st.cli, 'db push');
                }}
              >
                <Icon name="push" size={14} /> {t('sbPush')}
              </button>
              <button
                disabled={!workspace}
                title={t('sbTypesTitle')}
                onClick={() =>
                  inTerminal(
                    st.cli,
                    `gen types typescript --project-id ${ref} --schema public > database.types.ts`,
                  )
                }
              >
                <Icon name="code" size={14} /> {t('sbTypes')}
              </button>
            </>
          )}
          {!linked && workspace && (
            <button title={t('sbLinkTitle')} onClick={() => inTerminal(st.cli, `link --project-ref ${ref}`)}>
              <Icon name="link" size={14} />
            </button>
          )}
          <button onClick={() => open(dash)} title={t('sbDashboard')}>
            <Icon name="external" size={14} />
          </button>
        </div>
      </div>

      {paused ? (
        <div className="git-clean">
          {project?.status === 'INACTIVE' ? t('sbPausedHint') : t('sbStartingHint')}
        </div>
      ) : (
        <>
          <div className="git-branchbar">
            <div className="git-tabs">
              <button className={view === 'tables' ? 'on' : ''} onClick={() => setView('tables')}>
                {t('sbTables')} {tables ? `(${tables.length})` : ''}
              </button>
              <button className={view === 'sql' ? 'on' : ''} onClick={() => setView('sql')}>
                SQL
              </button>
              <button
                className={view === 'functions' ? 'on' : ''}
                onClick={() => setView('functions')}
              >
                {t('sbFunctions')}
              </button>
              <button
                className={view === 'storage' ? 'on' : ''}
                onClick={() => setView('storage')}
              >
                Storage
              </button>
            </div>
          </div>

          {view === 'tables' && (
            <div className="tree git-list">
              {tables === null && (
                <div className="git-clean">
                  <Icon name="clock" size={13} className="spin-slow" /> {t('sbLoading')}
                </div>
              )}
              {tables?.length === 0 && <div className="git-clean">{t('sbNoTables')}</div>}
              {schemas.map((schema) => (
                <div key={schema}>
                  <div className="git-group">
                    <span>{schema}</span>
                  </div>
                  {tables!
                    .filter((x) => x.schema === schema)
                    .map((tb) => {
                      const key = `${tb.schema}.${tb.name}`;
                      return (
                        <div key={key}>
                          <div
                            className={`git-row ${preview?.key === key ? 'on' : ''}`}
                            title={tb.rls ? key : `${key}\n${t('sbNoRlsTitle')}`}
                            onClick={() =>
                              preview?.key === key
                                ? setPreview(null)
                                : void act('preview', async () =>
                                    setPreview({
                                      key,
                                      r: await api().supabase.preview(ref, tb.schema, tb.name),
                                    }),
                                  )
                            }
                          >
                            <span className="git-icon">
                              <Icon name="hash" size={12} />
                            </span>
                            <span className="git-name">{tb.name}</span>
                            {!tb.rls && <span className="git-ref deleted">{t('sbNoRls')}</span>}
                            <span className="git-dir vc-right">~{tb.rows.toLocaleString()}</span>
                          </div>
                          {preview?.key === key && <Grid r={preview.r} />}
                        </div>
                      );
                    })}
                </div>
              ))}
              {tables && tables.length > 0 && (
                <button className="link git-fetch" onClick={() => open(`${dash}/editor`)}>
                  {t('sbOpenEditor')}
                </button>
              )}
            </div>
          )}

          {view === 'sql' && (
            <div className="tree git-list sb-sql">
              <textarea
                value={sql}
                spellCheck={false}
                rows={6}
                placeholder="select * from …"
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    runSql();
                  }
                }}
              />
              <div className="git-connect-actions">
                <button className="primary" disabled={!sql.trim() || busy !== null} onClick={runSql}>
                  <Icon name="play" size={14} /> {t('sbRun')} (Ctrl+Enter)
                </button>
                {result && (
                  <button onClick={() => setResult(null)} title={t('sbClear')}>
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
              {result && <Grid r={result} />}
            </div>
          )}

          {view === 'functions' && (
            <div className="tree git-list">
              {fns?.length === 0 && <div className="git-clean">{t('sbNoFunctions')}</div>}
              {fns?.map((f) => (
                <div
                  key={f.slug}
                  className="git-row"
                  title={`${f.slug} · v${f.version}`}
                  onClick={() => open(`${dash}/functions/${f.slug}`)}
                >
                  <span className={`git-icon ${f.status === 'ACTIVE' ? 'added' : 'modified'}`}>
                    ●
                  </span>
                  <span className="git-name">{f.name}</span>
                  <span className="git-dir">v{f.version}</span>
                  <span className="git-dir vc-right">{ago(f.updated)}</span>
                </div>
              ))}
              {workspace && (
                <button className="link git-fetch" onClick={() => inTerminal(st.cli, 'functions deploy')}>
                  {t('sbDeployFunctions')}
                </button>
              )}
            </div>
          )}

          {view === 'storage' && (
            <div className="tree git-list">
              {buckets?.length === 0 && <div className="git-clean">{t('sbNoBuckets')}</div>}
              {buckets?.map((b) => (
                <div
                  key={b.id}
                  className="git-row"
                  onClick={() => open(`${dash}/storage/buckets/${encodeURIComponent(b.name)}`)}
                >
                  <span className="git-icon">
                    <Icon name="folder" size={13} />
                  </span>
                  <span className="git-name">{b.name}</span>
                  <span className="git-dir vc-right">
                    {b.public ? t('sbPublic') : t('sbPrivate')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {busy && (
            <div className="git-busy">
              <Icon name="clock" size={13} className="spin-slow" /> {busy}…
            </div>
          )}
        </>
      )}
    </div>
  );
}
