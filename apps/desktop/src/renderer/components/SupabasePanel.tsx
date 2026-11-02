import { Icon } from './Icon';
import { useCallback, useEffect, useState } from 'react';
import type {
  SupabaseApiInfo,
  SupabaseAuthConfig,
  SupabaseBackupsView,
  SupabaseBucketView,
  SupabaseColumnView,
  SupabaseFunctionView,
  SupabaseMigrationView,
  SupabaseHealthView,
  SupabaseProjectView,
  SupabaseQueryResult,
  SupabaseStatus,
  SupabaseTableView,
  SupabaseUserView,
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

/** Last queries run from the SQL tab (shared by every project). */
const HISTORY_KEY = 'zinarix.supabaseSqlHistory';
const HISTORY_MAX = 20;

function loadHistory(): string[] {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown;
    return Array.isArray(h) ? h.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Ready-made queries for the SQL tab. */
const SNIPPETS: { label: string; sql: string }[] = [
  {
    label: 'sbSnipSize',
    sql: `select relname as tabla, pg_size_pretty(pg_total_relation_size(c.oid)) as tamano, n_live_tup as filas
from pg_class c join pg_stat_user_tables s on s.relid = c.oid
order by pg_total_relation_size(c.oid) desc;`,
  },
  {
    label: 'sbSnipPolicies',
    sql: `select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies order by schemaname, tablename;`,
  },
  {
    label: 'sbSnipNoRls',
    sql: `select n.nspname as schema, c.relname as tabla
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname = 'public' and not c.relrowsecurity;`,
  },
  {
    label: 'sbSnipConnections',
    sql: `select usename, application_name, state, count(*)
from pg_stat_activity group by 1, 2, 3 order by 4 desc;`,
  },
  {
    label: 'sbSnipSlow',
    sql: `select round(mean_exec_time::numeric, 1) as ms_media, calls, left(query, 120) as consulta
from extensions.pg_stat_statements order by mean_exec_time desc limit 20;`,
  },
  {
    label: 'sbSnipExtensions',
    sql: `select name, installed_version, default_version from pg_available_extensions
order by installed_version is null, name;`,
  },
  {
    label: 'sbSnipCron',
    sql: `select jobid, schedule, command, active from cron.job order by jobid;`,
  },
];

const csvCell = (v: string | null) =>
  v === null ? '' : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

function toCsv(r: SupabaseQueryResult): string {
  return [r.columns, ...r.rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

function copy(text: string, msg = t('vcCopied')) {
  void navigator.clipboard.writeText(text);
  toast(msg);
}

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
        {r.rows.length > 0 && (
          <button className="link" onClick={() => copy(toCsv(r), t('sbCsvCopied'))}>
            {t('sbCopyCsv')}
          </button>
        )}
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
  const [view, setView] = useState<
    'tables' | 'sql' | 'auth' | 'functions' | 'secrets' | 'storage' | 'migrations' | 'api'
  >('tables');
  const [tables, setTables] = useState<SupabaseTableView[] | null>(null);
  const [tableFilter, setTableFilter] = useState('');
  const [preview, setPreview] = useState<{
    key: string;
    mode: 'rows' | 'columns';
    page: number;
    r?: SupabaseQueryResult;
    cols?: SupabaseColumnView[];
  } | null>(null);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [users, setUsers] = useState<{ n: number; list: SupabaseUserView[] } | null>(null);
  const [migrations, setMigrations] = useState<SupabaseMigrationView[] | null>(null);
  const [apiInfo, setApiInfo] = useState<SupabaseApiInfo | null>(null);
  const [files, setFiles] = useState<{ bucket: string; r: SupabaseQueryResult } | null>(null);
  const [sql, setSql] = useState('select now();');
  const [result, setResult] = useState<SupabaseQueryResult | null>(null);
  const [fns, setFns] = useState<SupabaseFunctionView[] | null>(null);
  const [buckets, setBuckets] = useState<SupabaseBucketView[] | null>(null);
  const [secrets, setSecrets] = useState<string[] | null>(null);
  const [secretForm, setSecretForm] = useState<{ name: string; value: string } | null>(null);
  const [userFilter, setUserFilter] = useState('');
  const [authCfg, setAuthCfg] = useState<SupabaseAuthConfig | null>(null);
  const [authDraft, setAuthDraft] = useState<SupabaseAuthConfig | null>(null);
  const [backups, setBackups] = useState<SupabaseBackupsView | null>(null);

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
      else if (view === 'auth') {
        const [n, list] = await Promise.all([
          api().supabase.userCount(ref),
          api().supabase.users(ref),
        ]);
        setUsers({ n, list });
      } else if (view === 'secrets') setSecrets(await api().supabase.secrets(ref));
      else if (view === 'migrations') {
        setMigrations(await api().supabase.migrations(ref));
        setBackups(
          await api()
            .supabase.backups(ref)
            .catch(() => null),
        );
      } else if (view === 'api') setApiInfo(await api().supabase.apiInfo(ref));
    } catch (e) {
      toast(errText(e));
    }
  }, [ref, view]);

  useEffect(() => {
    setTables(null);
    setFns(null);
    setBuckets(null);
    setUsers(null);
    setMigrations(null);
    setBackups(null);
    setSecrets(null);
    setAuthCfg(null);
    setAuthDraft(null);
    setApiInfo(null);
    setFiles(null);
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
    const q = sql.trim();
    void act('sql', async () => {
      setResult(await api().supabase.query(ref, q));
      const next = [q, ...history.filter((h) => h !== q)].slice(0, HISTORY_MAX);
      setHistory(next);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    });
  };

  /** Opens a table's rows or structure under its row (clicking the open one closes it). */
  const showTable = (tb: SupabaseTableView, mode: 'rows' | 'columns', page = 0) => {
    if (!ref) return;
    const key = `${tb.schema}.${tb.name}`;
    void act(mode === 'rows' ? 'preview' : 'columns', async () =>
      setPreview(
        mode === 'rows'
          ? { key, mode, page, r: await api().supabase.preview(ref, tb.schema, tb.name, page) }
          : {
              key,
              mode,
              page: 0,
              cols: await api().supabase.columns(ref, tb.schema, tb.name),
            },
      ),
    );
  };

  /** Opens the SQL tab with an INSERT for the table's columns (defaults left out). */
  const insertTemplate = (tb: SupabaseTableView) => {
    if (!ref) return;
    void act('columns', async () => {
      const cols = (await api().supabase.columns(ref, tb.schema, tb.name)).filter(
        (c) => !c.default,
      );
      const names = cols.map((c) => `"${c.name}"`).join(', ');
      const values = cols.map((c) => (c.nullable ? 'null' : `/* ${c.type} */ ''`)).join(', ');
      toSql(
        cols.length
          ? `insert into "${tb.schema}"."${tb.name}" (${names})\nvalues (${values})\nreturning *;`
          : `insert into "${tb.schema}"."${tb.name}" default values returning *;`,
      );
    });
  };

  const loadAuthConfig = () => {
    if (!ref) return;
    if (authDraft) {
      setAuthDraft(null);
      return;
    }
    void act('auth', async () => {
      const c = await api().supabase.authConfig(ref);
      setAuthCfg(c);
      setAuthDraft(c);
    });
  };

  const saveAuthConfig = () => {
    if (!ref || !authDraft) return;
    const c = authDraft;
    if (c.disableSignup && !authCfg?.disableSignup && !confirm(t('sbAuthSignupConfirm'))) return;
    void act('auth', async () => {
      await api().supabase.setAuthConfig(ref, c);
      const fresh = await api().supabase.authConfig(ref);
      setAuthCfg(fresh);
      setAuthDraft(fresh);
      toast(t('vcSettingsSaved'));
    });
  };

  const saveSecret = () => {
    if (!ref || !secretForm?.name.trim()) return;
    const f = secretForm;
    void act('secret', async () => {
      await api().supabase.setSecret(ref, f.name.trim(), f.value);
      setSecretForm(null);
      toast(t('vcEnvSaved', { key: f.name.trim() }));
      setSecrets(await api().supabase.secrets(ref));
    });
  };

  const toggleRls = (tb: SupabaseTableView) => {
    if (!ref) return;
    const key = `${tb.schema}.${tb.name}`;
    if (!confirm(tb.rls ? t('sbRlsOffConfirm', { key }) : t('sbRlsOnConfirm', { key }))) return;
    void act('rls', async () => {
      await api().supabase.setRls(ref, tb.schema, tb.name, !tb.rls);
      setTables(await api().supabase.tables(ref));
    });
  };

  const toSql = (text: string) => {
    setSql(text);
    setResult(null);
    setView('sql');
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
            {workspace && <button onClick={() => inTerminal(st.cli, 'link')}>{t('sbLink')}</button>}
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
  const shownTables = (tables ?? []).filter((x) =>
    `${x.schema}.${x.name}`.toLowerCase().includes(tableFilter.toLowerCase()),
  );
  const schemas = [...new Set(shownTables.map((x) => x.schema))];

  const newMigration = () => {
    const name = prompt(t('sbNewMigrationPrompt'), '');
    if (!name?.trim()) return;
    inTerminal(st.cli, `migration new ${name.trim().replace(/[^\w-]+/g, '_')}`);
  };

  const tab = (id: typeof view, label: string) => (
    <button className={view === id ? 'on' : ''} onClick={() => setView(id)}>
      {label}
    </button>
  );

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
          {workspace && project?.status === 'ACTIVE_HEALTHY' && (
            <button title={t('sbNewMigrationTitle')} onClick={newMigration}>
              <Icon name="filePlus" size={14} />
            </button>
          )}
          {project?.status === 'ACTIVE_HEALTHY' && (
            <button
              title={t('sbPause')}
              onClick={() => {
                if (!confirm(t('sbPauseConfirm'))) return;
                void act('pause', async () => {
                  await api().supabase.pause(ref);
                  toast(t('sbPausingToast'));
                  loadProjects();
                });
              }}
            >
              <Icon name="pause" size={14} />
            </button>
          )}
          {!linked && workspace && (
            <button
              title={t('sbLinkTitle')}
              onClick={() => inTerminal(st.cli, `link --project-ref ${ref}`)}
            >
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
            <div className="git-tabs sb-tabs">
              {tab('tables', `${t('sbTables')}${tables ? ` (${tables.length})` : ''}`)}
              {tab('sql', 'SQL')}
              {tab('auth', `Auth${users ? ` (${users.n})` : ''}`)}
              {tab('functions', t('sbFunctions'))}
              {tab('secrets', `${t('sbSecrets')}${secrets ? ` (${secrets.length})` : ''}`)}
              {tab('storage', 'Storage')}
              {tab('migrations', t('sbMigrations'))}
              {tab('api', 'API')}
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
              {tables && tables.length > 8 && (
                <div className="vc-toolbar">
                  <input
                    value={tableFilter}
                    placeholder={t('sbFilterTables')}
                    onChange={(e) => setTableFilter(e.target.value)}
                  />
                </div>
              )}
              {schemas.map((schema) => (
                <div key={schema}>
                  <div className="git-group">
                    <span>{schema}</span>
                  </div>
                  {shownTables
                    .filter((x) => x.schema === schema)
                    .map((tb) => {
                      const key = `${tb.schema}.${tb.name}`;
                      return (
                        <div key={key}>
                          <div
                            className={`git-row ${preview?.key === key ? 'on' : ''}`}
                            title={tb.rls ? key : `${key}\n${t('sbNoRlsTitle')}`}
                            onClick={() =>
                              preview?.key === key ? setPreview(null) : showTable(tb, 'rows')
                            }
                          >
                            <span className="git-icon">
                              <Icon name="hash" size={12} />
                            </span>
                            <span className="git-name">{tb.name}</span>
                            {!tb.rls && <span className="git-ref deleted">{t('sbNoRls')}</span>}
                            <span className="git-dir vc-right">~{tb.rows.toLocaleString()}</span>
                          </div>
                          {preview?.key === key && (
                            <>
                              <div className="git-tabs sb-subtabs">
                                <button
                                  className={preview.mode === 'rows' ? 'on' : ''}
                                  onClick={() => showTable(tb, 'rows')}
                                >
                                  {t('sbRowsTab')}
                                </button>
                                <button
                                  className={preview.mode === 'columns' ? 'on' : ''}
                                  onClick={() => showTable(tb, 'columns')}
                                >
                                  {t('sbColumnsTab')}
                                </button>
                                <button
                                  title={t('sbInsertTitle')}
                                  onClick={() => insertTemplate(tb)}
                                >
                                  <Icon name="plus" size={11} />
                                </button>
                                <button
                                  title={t('sbQueryTitle')}
                                  onClick={() =>
                                    toSql(
                                      `select * from "${tb.schema}"."${tb.name}"\nwhere true\norder by 1 desc\nlimit 100;`,
                                    )
                                  }
                                >
                                  SQL
                                </button>
                                <button
                                  className={tb.rls ? '' : 'sb-warn'}
                                  title={tb.rls ? t('sbRlsOff') : t('sbRlsOn')}
                                  onClick={() => toggleRls(tb)}
                                >
                                  <Icon name={tb.rls ? 'lock' : 'shield'} size={11} />{' '}
                                  {tb.rls ? 'RLS ✓' : t('sbRlsOn')}
                                </button>
                                <button
                                  title={t('sbOpenEditor')}
                                  onClick={() => open(`${dash}/editor`)}
                                >
                                  <Icon name="external" size={11} />
                                </button>
                              </div>
                              {preview.r && <Grid r={preview.r} />}
                              {preview.r && (preview.page > 0 || preview.r.total >= 100) && (
                                <div className="git-commit-meta sb-pager">
                                  <button
                                    className="link"
                                    disabled={preview.page === 0 || busy !== null}
                                    onClick={() => showTable(tb, 'rows', preview.page - 1)}
                                  >
                                    ‹ {t('sbPrev')}
                                  </button>
                                  <span>{t('sbPage', { n: preview.page + 1 })}</span>
                                  <button
                                    className="link"
                                    disabled={preview.r.total < 100 || busy !== null}
                                    onClick={() => showTable(tb, 'rows', preview.page + 1)}
                                  >
                                    {t('sbNext')} ›
                                  </button>
                                </div>
                              )}
                              {preview.cols && (
                                <div className="sb-grid">
                                  <table>
                                    <thead>
                                      <tr>
                                        <th>{t('sbColName')}</th>
                                        <th>{t('sbColType')}</th>
                                        <th>null</th>
                                        <th>default</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {preview.cols.map((c) => (
                                        <tr key={c.name}>
                                          <td title={c.name}>
                                            {c.pk ? '🔑 ' : ''}
                                            {c.name}
                                          </td>
                                          <td>{c.type}</td>
                                          <td>{c.nullable ? '✓' : ''}</td>
                                          <td
                                            className={c.default ? '' : 'null'}
                                            title={c.default ?? ''}
                                          >
                                            {c.default ?? '—'}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </>
                          )}
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
              <div className="vc-toolbar sb-sql-tools">
                <select
                  value=""
                  title={t('sbSnippets')}
                  onChange={(e) => {
                    if (e.target.value) toSql(e.target.value);
                  }}
                >
                  <option value="">{t('sbSnippets')}…</option>
                  {SNIPPETS.map((x) => (
                    <option key={x.label} value={x.sql}>
                      {t(x.label as 'sbSnipSize')}
                    </option>
                  ))}
                </select>
                <select
                  value=""
                  title={t('sbHistory')}
                  disabled={!history.length}
                  onChange={(e) => {
                    if (e.target.value) toSql(e.target.value);
                  }}
                >
                  <option value="">
                    {t('sbHistory')} ({history.length})
                  </option>
                  {history.map((h) => (
                    <option key={h} value={h}>
                      {h.replace(/\s+/g, ' ').slice(0, 70)}
                    </option>
                  ))}
                </select>
              </div>
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
                <button
                  className="primary"
                  disabled={!sql.trim() || busy !== null}
                  onClick={runSql}
                >
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
                  <span className="git-row-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      title={t('sbFnLogs')}
                      onClick={() => open(`${dash}/functions/${f.slug}/logs`)}
                    >
                      <Icon name="scroll" size={13} />
                    </button>
                    <button
                      title={t('sbFnUrl')}
                      onClick={() => copy(`https://${ref}.supabase.co/functions/v1/${f.slug}`)}
                    >
                      <Icon name="copy" size={13} />
                    </button>
                    {workspace && (
                      <button
                        title={t('sbFnDeploy')}
                        onClick={() => inTerminal(st.cli, `functions deploy ${f.slug}`)}
                      >
                        <Icon name="push" size={13} />
                      </button>
                    )}
                    <button
                      title={t('sbFnDelete')}
                      onClick={() => {
                        if (!confirm(t('sbFnDeleteConfirm', { name: f.name }))) return;
                        void act('delete', async () => {
                          await api().supabase.deleteFunction(ref, f.slug);
                          setFns(await api().supabase.functions(ref));
                        });
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                </div>
              ))}
              {workspace && (
                <>
                  <button
                    className="link git-fetch"
                    onClick={() => inTerminal(st.cli, 'functions deploy')}
                  >
                    {t('sbDeployFunctions')}
                  </button>
                  <button
                    className="link git-fetch"
                    onClick={() => {
                      const name = prompt(t('sbFnNewPrompt'), '');
                      if (name?.trim())
                        inTerminal(
                          st.cli,
                          `functions new ${name
                            .trim()
                            .toLowerCase()
                            .replace(/[^a-z0-9-]+/g, '-')}`,
                        );
                    }}
                  >
                    {t('sbFnNew')}
                  </button>
                </>
              )}
            </div>
          )}

          {view === 'secrets' && (
            <div className="tree git-list">
              <div className="git-gh-hint">{t('sbSecretsHint')}</div>
              <div className="git-connect-actions vc-env-actions">
                <button
                  className="primary"
                  onClick={() => setSecretForm(secretForm ? null : { name: '', value: '' })}
                >
                  <Icon name="plus" size={14} /> {t('sbSecretAdd')}
                </button>
                {workspace && (
                  <button
                    title={t('sbSecretsFileTitle')}
                    onClick={() => {
                      if (confirm(t('sbSecretsFileConfirm')))
                        inTerminal(st.cli, 'secrets set --env-file supabase/functions/.env');
                    }}
                  >
                    <Icon name="insert" size={14} /> .env
                  </button>
                )}
              </div>
              {secretForm && (
                <div className="vc-form">
                  <input
                    value={secretForm.name}
                    placeholder="NOMBRE_SECRETO"
                    spellCheck={false}
                    autoFocus
                    onChange={(e) =>
                      setSecretForm({ ...secretForm, name: e.target.value.replace(/[^\w]/g, '_') })
                    }
                  />
                  <textarea
                    value={secretForm.value}
                    placeholder={t('vcEnvValue')}
                    spellCheck={false}
                    rows={2}
                    onChange={(e) => setSecretForm({ ...secretForm, value: e.target.value })}
                  />
                  <div className="git-connect-actions">
                    <button
                      className="primary"
                      disabled={!secretForm.name.trim() || busy !== null}
                      onClick={saveSecret}
                    >
                      {t('vcEnvSave')}
                    </button>
                    <button onClick={() => setSecretForm(null)}>{t('vcEnvCancel')}</button>
                  </div>
                </div>
              )}
              {secrets?.length === 0 && <div className="git-clean">{t('sbNoSecrets')}</div>}
              {secrets?.map((name) => {
                const builtIn = /^SUPABASE_/.test(name);
                return (
                  <div key={name} className="git-row" title={builtIn ? t('sbSecretBuiltIn') : name}>
                    <span className="git-icon">
                      <Icon name={builtIn ? 'lock' : 'key'} size={13} />
                    </span>
                    <span className="git-name">{name}</span>
                    {!builtIn && (
                      <span className="git-row-actions">
                        <button
                          title={t('vcEnvEdit')}
                          onClick={() => setSecretForm({ name, value: '' })}
                        >
                          <Icon name="edit" size={13} />
                        </button>
                        <button
                          title={t('vcEnvDelete')}
                          onClick={() => {
                            if (!confirm(t('vcEnvDeleteConfirm', { key: name }))) return;
                            void act('secret', async () => {
                              await api().supabase.deleteSecret(ref, name);
                              setSecrets(await api().supabase.secrets(ref));
                            });
                          }}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
              <button className="link git-fetch" onClick={() => open(`${dash}/functions/secrets`)}>
                {t('sbSecretsDash')}
              </button>
            </div>
          )}

          {view === 'storage' && (
            <div className="tree git-list">
              {buckets?.length === 0 && <div className="git-clean">{t('sbNoBuckets')}</div>}
              {buckets?.map((b) => (
                <div key={b.id}>
                  <div
                    className={`git-row ${files?.bucket === b.id ? 'on' : ''}`}
                    onClick={() =>
                      files?.bucket === b.id
                        ? setFiles(null)
                        : void act('files', async () =>
                            setFiles({ bucket: b.id, r: await api().supabase.files(ref, b.id) }),
                          )
                    }
                  >
                    <span className="git-icon">
                      <Icon name="folder" size={13} />
                    </span>
                    <span className="git-name">{b.name}</span>
                    <span className="git-dir vc-right">
                      {b.public ? t('sbPublic') : t('sbPrivate')}
                    </span>
                    <span className="git-row-actions" onClick={(e) => e.stopPropagation()}>
                      {b.public && (
                        <button
                          title={t('sbBucketUrl')}
                          onClick={() =>
                            copy(
                              `https://${ref}.supabase.co/storage/v1/object/public/${encodeURIComponent(b.name)}/`,
                            )
                          }
                        >
                          <Icon name="copy" size={13} />
                        </button>
                      )}
                      <button
                        title={t('sbDashboard')}
                        onClick={() =>
                          open(`${dash}/storage/buckets/${encodeURIComponent(b.name)}`)
                        }
                      >
                        <Icon name="external" size={13} />
                      </button>
                    </span>
                  </div>
                  {files?.bucket === b.id && <Grid r={files.r} />}
                </div>
              ))}
            </div>
          )}

          {view === 'auth' && (
            <div className="tree git-list">
              {users === null && (
                <div className="git-clean">
                  <Icon name="clock" size={13} className="spin-slow" /> {t('sbLoading')}
                </div>
              )}
              {users?.list.length === 0 && <div className="git-clean">{t('sbNoUsers')}</div>}
              <div className="git-connect-actions vc-env-actions">
                <button className={authDraft ? 'primary' : ''} onClick={loadAuthConfig}>
                  <Icon name="settings" size={14} /> {t('sbAuthSettings')}
                </button>
              </div>
              {authDraft && (
                <div className="vc-form vc-settings">
                  <label>
                    <span>Site URL</span>
                    <input
                      value={authDraft.siteUrl}
                      placeholder="https://miapp.com"
                      spellCheck={false}
                      onChange={(e) => setAuthDraft({ ...authDraft, siteUrl: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>{t('sbRedirectUrls')}</span>
                    <textarea
                      value={authDraft.redirectUrls.join('\n')}
                      placeholder={'http://localhost:3000/**\nhttps://miapp.com/auth/callback'}
                      spellCheck={false}
                      rows={3}
                      onChange={(e) =>
                        setAuthDraft({ ...authDraft, redirectUrls: e.target.value.split('\n') })
                      }
                    />
                  </label>
                  <label className="vc-check">
                    <input
                      type="checkbox"
                      checked={!authDraft.disableSignup}
                      onChange={(e) =>
                        setAuthDraft({ ...authDraft, disableSignup: !e.target.checked })
                      }
                    />
                    {t('sbAllowSignup')}
                  </label>
                  <label className="vc-check">
                    <input
                      type="checkbox"
                      checked={!authDraft.autoconfirm}
                      onChange={(e) =>
                        setAuthDraft({ ...authDraft, autoconfirm: !e.target.checked })
                      }
                    />
                    {t('sbConfirmEmail')}
                  </label>
                  <div className="git-connect-actions">
                    <button
                      className="primary"
                      disabled={
                        busy !== null || JSON.stringify(authDraft) === JSON.stringify(authCfg)
                      }
                      onClick={saveAuthConfig}
                    >
                      {t('vcEnvSave')}
                    </button>
                    <button onClick={() => setAuthDraft(null)}>{t('vcEnvCancel')}</button>
                  </div>
                </div>
              )}
              {users && users.list.length > 8 && (
                <div className="vc-toolbar">
                  <input
                    value={userFilter}
                    placeholder={t('sbFilterUsers')}
                    onChange={(e) => setUserFilter(e.target.value)}
                  />
                </div>
              )}
              {users && users.list.length > 0 && (
                <div className="git-group">
                  <span>
                    {t('sbUsers')} <span className="git-count">{users.n}</span>
                  </span>
                  {users.n > users.list.length && (
                    <span className="git-dir">{t('sbLatest', { n: users.list.length })}</span>
                  )}
                </div>
              )}
              {users?.list
                .filter((u) =>
                  `${u.email ?? ''} ${u.id} ${u.provider}`
                    .toLowerCase()
                    .includes(userFilter.toLowerCase()),
                )
                .map((u) => (
                  <div
                    key={u.id}
                    className="git-row"
                    title={`${u.id}\n${t('sbUserCreated')}: ${new Date(u.created).toLocaleString()}${
                      u.lastSignIn
                        ? `\n${t('sbUserLastSignIn')}: ${new Date(u.lastSignIn).toLocaleString()}`
                        : ''
                    }`}
                    onClick={() => copy(u.id, t('sbIdCopied'))}
                  >
                    <span className={`git-icon ${u.confirmed ? 'added' : 'modified'}`}>●</span>
                    <span className="git-name">{u.email ?? u.id}</span>
                    <span className="git-dir">{u.provider}</span>
                    <span className="git-dir vc-right">
                      {u.lastSignIn ? ago(u.lastSignIn) : t('sbNever')}
                    </span>
                    <span className="git-row-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        title={t('sbUserDelete')}
                        onClick={() => {
                          if (!confirm(t('sbUserDeleteConfirm', { name: u.email ?? u.id }))) return;
                          void act('delete', async () => {
                            await api().supabase.deleteUser(ref, u.id);
                            setUsers(
                              (prev) =>
                                prev && {
                                  n: prev.n - 1,
                                  list: prev.list.filter((x) => x.id !== u.id),
                                },
                            );
                          });
                        }}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </span>
                  </div>
                ))}
              <button className="link git-fetch" onClick={() => open(`${dash}/auth/users`)}>
                {t('sbManageUsers')}
              </button>
              <button className="link git-fetch" onClick={() => open(`${dash}/auth/providers`)}>
                {t('sbProviders')}
              </button>
            </div>
          )}

          {view === 'migrations' && (
            <div className="tree git-list">
              {workspace && (
                <div className="git-connect-actions vc-env-actions">
                  <button className="primary" onClick={newMigration}>
                    <Icon name="filePlus" size={14} /> {t('sbNewMigration')}
                  </button>
                  <button title={t('sbDiffTitle')} onClick={() => inTerminal(st.cli, 'db diff')}>
                    diff
                  </button>
                  <button
                    title={t('sbPullTitle')}
                    onClick={() => {
                      if (confirm(t('sbPullConfirm'))) inTerminal(st.cli, 'db pull');
                    }}
                  >
                    <Icon name="pull" size={14} /> pull
                  </button>
                  <button
                    title={t('sbListTitle')}
                    onClick={() => inTerminal(st.cli, 'migration list')}
                  >
                    <Icon name="terminal" size={14} />
                  </button>
                </div>
              )}
              {migrations?.length === 0 && <div className="git-clean">{t('sbNoMigrations')}</div>}
              {migrations && migrations.length > 0 && (
                <div className="git-group">
                  <span>
                    {t('sbApplied')} <span className="git-count">{migrations.length}</span>
                  </span>
                </div>
              )}
              {migrations?.map((m) => (
                <div key={m.version} className="git-row" title={m.version}>
                  <span className="git-icon added">✓</span>
                  <span className="git-name">{m.name ?? m.version}</span>
                  <span className="git-dir vc-right">{m.version}</span>
                </div>
              ))}
              {backups && (
                <>
                  <div className="git-group">
                    <span>
                      {t('sbBackups')} <span className="git-count">{backups.list.length}</span>
                    </span>
                    {backups.pitr && <span className="git-ref added">PITR</span>}
                  </div>
                  {backups.list.length === 0 && <div className="git-clean">{t('sbNoBackups')}</div>}
                  {backups.list.slice(0, 14).map((b) => (
                    <div key={b.at} className="git-row" title={b.status}>
                      <span
                        className={`git-icon ${b.status === 'COMPLETED' ? 'added' : 'modified'}`}
                      >
                        ●
                      </span>
                      <span className="git-name">{new Date(b.at).toLocaleString()}</span>
                      <span className="git-dir vc-right">{ago(b.at)}</span>
                    </div>
                  ))}
                  {workspace && (
                    <button
                      className="link git-fetch"
                      title={t('sbDumpTitle')}
                      onClick={() =>
                        inTerminal(
                          st.cli,
                          `db dump --linked -f backup-${new Date().toISOString().slice(0, 10)}.sql`,
                        )
                      }
                    >
                      {t('sbDump')}
                    </button>
                  )}
                  <button
                    className="link git-fetch"
                    onClick={() => open(`${dash}/database/backups/scheduled`)}
                  >
                    {t('sbBackupsDash')}
                  </button>
                </>
              )}
            </div>
          )}

          {view === 'api' && (
            <div className="tree git-list">
              {apiInfo && (
                <>
                  <div className="git-row" onClick={() => copy(apiInfo.url)} title={t('vcCopyUrl')}>
                    <span className="git-icon">
                      <Icon name="globe" size={13} />
                    </span>
                    <span className="git-name">{apiInfo.url}</span>
                    <span className="git-dir vc-right">
                      <Icon name="copy" size={12} />
                    </span>
                  </div>
                  {apiInfo.keys.map((k) => (
                    <div
                      key={k.name}
                      className="git-row"
                      title={t('sbCopyKey')}
                      onClick={() => copy(k.key, t('sbKeyCopied'))}
                    >
                      <span className="git-icon">
                        <Icon name="key" size={13} />
                      </span>
                      <span className="git-name">{k.name}</span>
                      <span className="git-dir">{`${k.key.slice(0, 14)}…`}</span>
                      <span className="git-dir vc-right">
                        <Icon name="copy" size={12} />
                      </span>
                    </div>
                  ))}
                  <div className="git-gh-hint">{t('sbApiHint')}</div>
                  <div className="git-connect-actions vc-env-actions">
                    {(['NEXT_PUBLIC', 'VITE'] as const).map((prefix) => (
                      <button
                        key={prefix}
                        onClick={() =>
                          copy(
                            `${prefix}_SUPABASE_URL=${apiInfo.url}\n${prefix}_SUPABASE_ANON_KEY=${
                              apiInfo.keys.find((k) => k.name === 'anon')?.key ??
                              apiInfo.keys[0]?.key ??
                              ''
                            }\n`,
                            t('sbEnvCopied'),
                          )
                        }
                      >
                        <Icon name="copy" size={14} /> .env {prefix}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <button className="link git-fetch" onClick={() => open(`${dash}/settings/api-keys`)}>
                {t('sbSecretKeys')}
              </button>
              <button className="link git-fetch" onClick={() => open(`${dash}/settings/database`)}>
                {t('sbConnString')}
              </button>
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
