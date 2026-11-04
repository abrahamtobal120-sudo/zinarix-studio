import { AccountSwitch } from './AccountSwitch';
import { Icon } from './Icon';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  VercelDeploymentView,
  VercelProjectInfo,
  VercelProjectView,
  VercelSettings,
  VercelStatus,
} from '../../shared/api';
import { t } from '../i18n';
import { api, setState, toast, useStore } from '../store';
import { askAgent } from './Chat';
import { runInTerminal } from './Terminal';

const errText = (e: unknown) =>
  String((e as Error).message ?? e).replace(/^Error invoking[^:]*: (Error: )?/, '');

/** Project chosen by hand for a folder that has no .vercel/project.json. */
const PICK_KEY = 'zinarix.vercelProject:';
interface Pick {
  projectId: string;
  teamId: string | null;
}

const LIVE = new Set(['QUEUED', 'INITIALIZING', 'BUILDING']);

function stateClass(s: string): string {
  if (s === 'READY') return 'added';
  if (s === 'ERROR') return 'deleted';
  if (s === 'CANCELED') return 'git-dir';
  return 'modified';
}

function stateLabel(s: string): string {
  const map: Record<string, string> = {
    READY: t('vcReady'),
    ERROR: t('vcError'),
    CANCELED: t('vcCanceled'),
    BUILDING: t('vcBuildingState'),
    QUEUED: t('vcQueued'),
    INITIALIZING: t('vcQueued'),
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

const open = (url: string) => void api().app.openExternal(url);

function inTerminal(cli: boolean, args: string) {
  setState({ panelOpen: true });
  setTimeout(() => void runInTerminal(`${cli ? 'vercel' : 'npx vercel'} ${args}`), 300);
}

function deploy(prod: boolean, cli: boolean) {
  if (prod && !confirm(t('vcProdConfirm'))) return;
  inTerminal(cli, `deploy${prod ? ' --prod' : ''}`);
}

/** Build log lines that point at the failure (shown in red) or at a warning (yellow). */
const ERR_LINE = /\b(error|err!|failed|fatal|cannot find|not found|exited with)\b/i;
const WARN_LINE = /\b(warn(ing)?|deprecated)\b/i;
/** End of the log handed to the AI: the failure is almost always at the bottom. */
const AI_LOG_TAIL = 8000;

/** Hands a failed build to the agent: the end of its log and what to do with it. */
async function fixWithAi(d: VercelDeploymentView, teamId: string | null, project: string) {
  const log = (await api().vercel.logs(d.id, teamId)) || t('vcNoLogs');
  askAgent(
    t('vcFixPrompt', {
      url: d.url,
      project,
      branch: [d.branch, d.sha?.slice(0, 7)].filter(Boolean).join(' · ') || d.target,
      log: log.length > AI_LOG_TAIL ? `…\n${log.slice(-AI_LOG_TAIL)}` : log,
    }),
  );
}

/** Build log of one deployment; follows the build while it runs. */
function DeployLog({
  dep,
  teamId,
  onClose,
  onFix,
}: {
  dep: VercelDeploymentView;
  teamId: string | null;
  onClose: () => void;
  onFix: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const box = useRef<HTMLPreElement>(null);
  const live = LIVE.has(dep.state);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api()
        .vercel.logs(dep.id, teamId)
        .then((x) => alive && setText(x || t('vcNoLogs')))
        .catch((e: unknown) => alive && setText(errText(e)));
    void load();
    // One more read when the build ends, so the last lines show up.
    if (!live) return () => void (alive = false);
    const h = setInterval(() => void load(), 4000);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [dep.id, teamId, live]);

  // Stay at the bottom while it grows (where the news and the errors are).
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <div className="vc-logbox">
      <div className="vc-log-bar">
        {live && (
          <span className="git-track">
            <Icon name="clock" size={11} className="spin-slow" /> {t('vcLiveLog')}
          </span>
        )}
        <span className="spacer" />
        {dep.state === 'ERROR' && (
          <button className="primary" title={t('vcFixAiTitle')} onClick={onFix}>
            <Icon name="wrench" size={12} /> {t('vcFixAi')}
          </button>
        )}
        <button
          title={t('vcCopyLog')}
          disabled={!text}
          onClick={() => {
            void navigator.clipboard.writeText(text ?? '');
            toast(t('vcLogCopied'));
          }}
        >
          <Icon name="copy" size={12} />
        </button>
        <button title={t('vcCloseLog')} onClick={onClose}>
          <Icon name="x" size={12} />
        </button>
      </div>
      <pre className="vc-logs" ref={box}>
        {text === null
          ? '…'
          : text.split('\n').map((line, i) => (
              <div
                key={i}
                className={
                  ERR_LINE.test(line) ? 'vc-log-err' : WARN_LINE.test(line) ? 'vc-log-warn' : ''
                }
              >
                {line || ' '}
              </div>
            ))}
      </pre>
    </div>
  );
}

const ENV_TARGETS = ['production', 'preview', 'development'] as const;

/** KEY=value lines of a .env file (comments, blanks and `export` are skipped). */
function parseDotenv(text: string): { key: string; value: string }[] {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    let v = m[2]!.trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.endsWith(q) && v.length > 1) {
      v = v.slice(1, -1);
      if (q === '"') v = v.replace(/\\n/g, '\n');
    } else {
      v = v.replace(/\s+#.*$/, '');
    }
    out.set(m[1]!, v);
  }
  return [...out].map(([key, value]) => ({ key, value }));
}

const SETTING_FIELDS: { key: keyof VercelSettings; label: string; ph: string }[] = [
  { key: 'framework', label: 'Framework', ph: 'nextjs, vite, astro…' },
  { key: 'rootDirectory', label: 'Root directory', ph: 'apps/web' },
  { key: 'installCommand', label: 'Install command', ph: 'npm install' },
  { key: 'buildCommand', label: 'Build command', ph: 'npm run build' },
  { key: 'devCommand', label: 'Dev command', ph: 'npm run dev' },
  { key: 'outputDirectory', label: 'Output directory', ph: 'dist' },
];
const NODE_VERSIONS = ['24.x', '22.x', '20.x'];

export function VercelPanel() {
  // A new body per account: switching leaves nothing of the previous one on screen.
  const [gen, setGen] = useState(0);
  return <VercelBody key={gen} reset={() => setGen((g) => g + 1)} />;
}

function VercelBody({ reset }: { reset: () => void }) {
  const workspace = useStore((s) => s.workspace);
  const root = workspace?.root;
  const [st, setSt] = useState<VercelStatus | null>(null);
  const [token, setToken] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [linked, setLinked] = useState(false);
  const [scope, setScope] = useState<string | null>(null);
  const [projects, setProjects] = useState<VercelProjectView[] | null>(null);
  const [filter, setFilter] = useState('');
  const [deps, setDeps] = useState<VercelDeploymentView[]>([]);
  const [info, setInfo] = useState<VercelProjectInfo | null>(null);
  const [view, setView] = useState<'deploys' | 'env' | 'domains' | 'settings'>('deploys');
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [target, setTarget] = useState<'' | 'production' | 'preview'>('');
  const [envForm, setEnvForm] = useState<{ key: string; value: string; targets: string[] } | null>(
    null,
  );
  const [newDomain, setNewDomain] = useState('');
  const [envImport, setEnvImport] = useState<{ text: string; targets: string[] } | null>(null);
  const [envFilter, setEnvFilter] = useState('');
  const [depFilter, setDepFilter] = useState('');
  const [settings, setSettings] = useState<VercelSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<VercelSettings | null>(null);

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
    void api().vercel.status().then(setSt);
  }, []);

  // Saved login but no answer (offline, startup): keep retrying instead of asking for a token.
  useEffect(() => {
    if (!st?.offline) return;
    const id = setInterval(() => void api().vercel.status().then(setSt), 20_000);
    return () => clearInterval(id);
  }, [st?.offline]);

  // Project of the open folder: the `vercel link` file first, then a project picked here.
  useEffect(() => {
    setPick(null);
    setLinked(false);
    setDeps([]);
    setInfo(null);
    setSettings(null);
    if (!st?.connected) return;
    void api()
      .vercel.linked()
      .then((l) => {
        if (l) {
          setLinked(true);
          setPick(l);
          return;
        }
        const saved = root && localStorage.getItem(PICK_KEY + root);
        if (saved) setPick(JSON.parse(saved) as Pick);
      });
  }, [st?.connected, root]);

  const project = useMemo(
    () => projects?.find((p) => p.id === pick?.projectId) ?? null,
    [projects, pick],
  );

  const loadDeps = useCallback(async () => {
    if (!pick) return;
    try {
      setDeps(await api().vercel.deployments(pick.projectId, pick.teamId));
    } catch (e) {
      toast(errText(e));
    }
  }, [pick]);

  const loadInfo = useCallback(() => {
    if (!pick) return;
    void api()
      .vercel.project(pick.projectId, pick.teamId)
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [pick]);

  useEffect(() => {
    if (!pick || view !== 'settings' || settings) return;
    api()
      .vercel.settings(pick.projectId, pick.teamId)
      .then((x) => {
        setSettings(x);
        setSettingsDraft(x);
      })
      .catch((e: unknown) => toast(errText(e)));
  }, [pick, view, settings]);

  useEffect(() => {
    if (!pick) return;
    void loadDeps();
    loadInfo();
    // Name and repo of the project come from the list of its scope.
    void api()
      .vercel.projects(pick.teamId)
      .then(setProjects)
      .catch(() => {});
  }, [pick, loadDeps, loadInfo]);

  // Live builds refresh by themselves.
  const building = deps.some((d) => LIVE.has(d.state));
  useEffect(() => {
    if (!building) return;
    const h = setInterval(() => void loadDeps(), 5000);
    return () => clearInterval(h);
  }, [building, loadDeps]);

  const loadProjects = (team: string | null) => {
    setScope(team);
    setProjects(null);
  };

  // Without a project for this folder, list the projects of the chosen scope to pick from.
  useEffect(() => {
    if (!st?.connected || pick || projects !== null) return;
    api()
      .vercel.projects(scope)
      .then(setProjects)
      .catch((e: unknown) => {
        toast(errText(e));
        setProjects([]);
      });
  }, [st?.connected, pick, projects, scope]);

  const choose = (p: VercelProjectView) => {
    const next = { projectId: p.id, teamId: p.teamId };
    if (workspace) localStorage.setItem(PICK_KEY + workspace.root, JSON.stringify(next));
    setPick(next);
  };

  const unpick = () => {
    if (workspace) localStorage.removeItem(PICK_KEY + workspace.root);
    setScope(pick?.teamId ?? scope);
    setProjects(null);
    setPick(null);
  };

  const title = (
    <div className="sidebar-title">
      <span className="panel-title">VERCEL</span>
      <span className="sidebar-actions">
        {pick && (
          <button
            title={t('gitRefresh')}
            onClick={() => {
              void loadDeps();
              loadInfo();
            }}
          >
            <Icon name="refresh" size={15} />
          </button>
        )}
        {st?.connected && (
          <button title="vercel.com" onClick={() => open('https://vercel.com/dashboard')}>
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
          <Icon name="clock" size={13} className="spin-slow" /> {t('vcLoading')}
        </div>
      </div>
    );
  }

  const account = (
    <AccountSwitch
      icon={<Icon name="vercel" size={12} />}
      label={st.user ?? st.accounts.find((a) => a.id === st.active)?.label ?? 'Vercel'}
      title={st.source === 'cli' ? t('vcFromCli') : t('vcFromApp')}
      accounts={st.accounts}
      active={st.active}
      busy={busy !== null}
      onUse={(id) =>
        void act('use', async () => {
          await api().vercel.useAccount(id);
          reset();
        })
      }
      onAdd={() => setAdding(true)}
      onLogout={
        st.source === 'app'
          ? () => {
              if (confirm(t('vcLogoutConfirm')))
                void act('logout', async () => {
                  await api().vercel.logout();
                  reset();
                });
            }
          : undefined
      }
    />
  );

  if (!adding && !st.connected && st.offline) {
    return (
      <div className="explorer">
        {title}
        {st.accounts.length > 1 && account}
        <div className="sidebar-empty vc-connect">
          <p>{t('svcOffline', { name: 'Vercel' })}</p>
          <p className="vc-hint">{st.offline}</p>
          <button
            className="primary"
            disabled={busy !== null}
            onClick={() => void act('recheck', async () => setSt(await api().vercel.status()))}
          >
            {busy === 'recheck' ? '…' : t('svcRetry')}
          </button>
        </div>
      </div>
    );
  }

  if (!st.connected || adding) {
    const connect = () =>
      void act('token', async () => {
        await api().vercel.setToken(token);
        setToken('');
        reset();
      });
    return (
      <div className="explorer">
        {title}
        {!adding && st.accounts.length > 1 && account}
        <div className="sidebar-empty vc-connect">
          <p>{adding ? t('acctAddIntro') : st.source ? t('vcTokenRejected') : t('vcIntro')}</p>
          <input
            type="password"
            value={token}
            placeholder={t('vcTokenPh')}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && token.trim()) connect();
            }}
          />
          <button className="primary" disabled={!token.trim() || busy !== null} onClick={connect}>
            {busy === 'token' ? '…' : t('vcConnect')}
          </button>
          {adding && (
            <button className="link" onClick={() => setAdding(false)}>
              {t('acctCancel')}
            </button>
          )}
          <button className="link" onClick={() => open('https://vercel.com/account/tokens')}>
            {t('vcCreateToken')}
          </button>
          {!adding && (
            <>
              <p className="vc-hint">{st.cli ? t('vcCliHint') : t('vcCliMissing')}</p>
              <button onClick={() => inTerminal(st.cli, 'login')}>{t('vcCliLogin')}</button>
              <button className="link" onClick={() => void api().vercel.status().then(setSt)}>
                {t('vcRecheck')}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // No project for this folder yet: pick one (or link it with the CLI).
  if (!pick) {
    const shown = (projects ?? []).filter((p) =>
      p.name.toLowerCase().includes(filter.toLowerCase()),
    );
    return (
      <div className="explorer">
        {title}
        {account}
        <div className="git-connect">
          <div className="git-connect-title">
            <Icon name="cloud" size={15} /> {workspace ? t('vcNotLinked') : t('vcNoFolder')}
          </div>
          <div className="git-connect-actions">
            {workspace && (
              <>
                <button className="primary" onClick={() => deploy(false, st.cli)}>
                  {t('vcDeployNew')}
                </button>
                <button onClick={() => inTerminal(st.cli, 'link')}>{t('vcLink')}</button>
              </>
            )}
          </div>
        </div>
        <div className="vc-toolbar">
          {st.teams.length > 0 && (
            <select
              value={scope ?? ''}
              onChange={(e) => loadProjects(e.target.value || null)}
              title={t('vcScope')}
            >
              <option value="">{st.user}</option>
              {st.teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
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
          {projects?.length === 0 && <div className="git-clean">{t('vcNoProjects')}</div>}
          {shown.map((p) => (
            <div key={p.id} className="git-row" title={p.repo ?? p.name} onClick={() => choose(p)}>
              <span className="git-icon">▲</span>
              <span className="git-name">{p.name}</span>
              <span className="git-dir">{p.framework ?? ''}</span>
              <span className="git-dir vc-right">{ago(p.updatedAt)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const prod = deps.find((d) => d.target === 'production' && d.state === 'READY');
  const latest = deps[0];
  const failed = latest?.state === 'ERROR' ? latest : null;
  const depQuery = depFilter.trim().toLowerCase();
  const shownDeps = deps.filter(
    (d) =>
      (!target || d.target === target) &&
      (!depQuery ||
        [d.commit, d.branch, d.sha, d.url, d.creator].some((x) =>
          x?.toLowerCase().includes(depQuery),
        )),
  );
  const shownEnvs = (info?.envs ?? []).filter((e) =>
    e.key.toLowerCase().includes(envFilter.toLowerCase()),
  );
  const { projectId, teamId } = pick;

  const saveEnv = () => {
    if (!envForm || !envForm.key.trim() || !envForm.targets.length) return;
    const f = envForm;
    void act('env', async () => {
      await api().vercel.setEnv(projectId, teamId, f.key.trim(), f.value, f.targets);
      setEnvForm(null);
      toast(t('vcEnvSaved', { key: f.key.trim() }));
      loadInfo();
    });
  };

  const importEnv = () => {
    if (!envImport) return;
    const vars = parseDotenv(envImport.text);
    if (!vars.length) return toast(t('vcImportEmpty'));
    const { targets } = envImport;
    const existing = new Set(info?.envs.map((e) => e.key));
    const replaced = vars.filter((v) => existing.has(v.key)).length;
    if (!confirm(t('vcImportConfirm', { n: vars.length, replaced, targets: targets.join(', ') })))
      return;
    void act('env', async () => {
      const failed: string[] = [];
      for (const v of vars) {
        try {
          await api().vercel.setEnv(projectId, teamId, v.key, v.value, targets);
        } catch {
          failed.push(v.key);
        }
      }
      setEnvImport(null);
      toast(
        failed.length
          ? t('vcImportPartial', { n: vars.length - failed.length, failed: failed.join(', ') })
          : t('vcImported', { n: vars.length }),
      );
      loadInfo();
    });
  };

  const readLocalEnv = async () => {
    if (!root || !envImport) return;
    for (const name of ['.env.local', '.env', '.env.production']) {
      try {
        const f = await api().workspace.readFile(`${root}/${name}`);
        if (f.binary || f.tooLarge) continue;
        setEnvImport({ ...envImport, text: f.content });
        toast(t('vcImportRead', { name }));
        return;
      } catch {
        /* next */
      }
    }
    toast(t('vcImportNoFile'));
  };

  const settingsChanged =
    !!settings &&
    !!settingsDraft &&
    (Object.keys(settings) as (keyof VercelSettings)[]).some(
      (k) => (settings[k] ?? '') !== (settingsDraft[k] ?? ''),
    );

  const saveSettings = () => {
    if (!settings || !settingsDraft) return;
    const patch: Partial<VercelSettings> = {};
    for (const k of Object.keys(settings) as (keyof VercelSettings)[])
      if ((settings[k] ?? '') !== (settingsDraft[k] ?? '')) patch[k] = settingsDraft[k] ?? '';
    void act('settings', async () => {
      await api().vercel.updateSettings(projectId, teamId, patch);
      const fresh = await api().vercel.settings(projectId, teamId);
      setSettings(fresh);
      setSettingsDraft(fresh);
      toast(t('vcSettingsSaved'));
    });
  };

  const addDomain = () => {
    const name = newDomain.trim();
    if (!name) return;
    void act('domain', async () => {
      await api().vercel.addDomain(projectId, teamId, name);
      setNewDomain('');
      toast(t('vcDomainAdded', { name }));
      loadInfo();
    });
  };
  const dashboard = project
    ? `https://vercel.com/${st.teams.find((x) => x.id === project.teamId)?.slug ?? st.user}/${project.name}`
    : null;

  const fix = (d: VercelDeploymentView) =>
    void act('ai', () => fixWithAi(d, teamId, project?.name ?? projectId));
  const showLog = (d: VercelDeploymentView) => {
    setView('deploys');
    setLogsFor(d.id);
  };

  return (
    <div className="explorer git-panel">
      {title}
      {account}
      <div className="vc-project">
        <div className="vc-project-name">
          <strong>▲ {project?.name ?? pick.projectId}</strong>
          {project?.framework && <span className="git-ref">{project.framework}</span>}
          <span className="spacer" />
          {!linked && (
            <button className="link" title={t('vcChangeTitle')} onClick={unpick}>
              {t('vcChange')}
            </button>
          )}
        </div>
        {info && info.domains.length > 0 && (
          <div className="vc-domains">
            {info.domains.slice(0, 4).map((d) => (
              <button
                key={d.name}
                className="link"
                title={d.verified ? d.name : t('vcUnverified')}
                onClick={() => open(`https://${d.name}`)}
              >
                {!d.verified && (
                  <>
                    <Icon name="warning" size={12} />{' '}
                  </>
                )}
                {d.name}
              </button>
            ))}
          </div>
        )}
        {prod && (
          <div className="git-commit-meta" title={prod.url}>
            <span className="added">●</span> {t('vcProdNow')} · {ago(prod.created)}
            {prod.commit ? ` · ${prod.commit.split('\n')[0]}` : ''}
          </div>
        )}
        {project?.repo && (
          <div className="git-commit-meta">
            <Icon name="github" size={12} /> {project.repo}
          </div>
        )}
        <div className="git-connect-actions vc-actions">
          <button
            className="primary"
            disabled={!workspace}
            onClick={() => deploy(false, st.cli)}
            title={t('vcPreviewTitle')}
          >
            <Icon name="push" size={14} /> {t('vcPreview')}
          </button>
          <button disabled={!workspace} onClick={() => deploy(true, st.cli)}>
            <Icon name="bolt" size={14} /> {t('vcProduction')}
          </button>
          {prod && (
            <button onClick={() => open(`https://${prod.url}`)} title={prod.url}>
              <Icon name="globe" size={14} /> {t('vcVisit')}
            </button>
          )}
          {dashboard && (
            <button onClick={() => open(dashboard)} title={t('vcDashboard')}>
              <Icon name="external" size={14} />
            </button>
          )}
        </div>
      </div>

      {failed && (
        <div className="vc-alert">
          <div>
            <Icon name="warning" size={13} /> <strong>{t('vcLastFailed')}</strong> ·{' '}
            {ago(failed.created)}
          </div>
          {failed.commit && <div className="vc-alert-sub">{failed.commit.split('\n')[0]}</div>}
          <div className="git-connect-actions">
            <button className="primary" disabled={busy !== null} onClick={() => fix(failed)}>
              <Icon name="wrench" size={13} /> {busy === 'ai' ? '…' : t('vcFixAi')}
            </button>
            <button onClick={() => showLog(failed)}>
              <Icon name="scroll" size={13} /> {t('vcLogs')}
            </button>
          </div>
        </div>
      )}

      <div className="git-branchbar">
        <div className="git-tabs">
          <button className={view === 'deploys' ? 'on' : ''} onClick={() => setView('deploys')}>
            {t('vcDeploys')}
          </button>
          <button className={view === 'env' ? 'on' : ''} onClick={() => setView('env')}>
            {t('vcEnv')} {info ? `(${info.envs.length})` : ''}
          </button>
          <button className={view === 'domains' ? 'on' : ''} onClick={() => setView('domains')}>
            {t('vcDomains')} {info ? `(${info.domains.length})` : ''}
          </button>
          <button className={view === 'settings' ? 'on' : ''} onClick={() => setView('settings')}>
            {t('vcSettings')}
          </button>
        </div>
        <span className="spacer" />
        {view === 'deploys' && (
          <select
            className="vc-filter"
            value={target}
            title={t('vcFilterTarget')}
            onChange={(e) => setTarget(e.target.value as typeof target)}
          >
            <option value="">{t('vcAll')}</option>
            <option value="production">{t('vcProd')}</option>
            <option value="preview">{t('vcPrev')}</option>
          </select>
        )}
        {building && (
          <span className="git-track">
            <Icon name="clock" size={12} className="spin-slow" /> {t('vcBuilding')}
          </span>
        )}
      </div>

      {view === 'deploys' && (
        <div className="tree git-list">
          {deps.length > 8 && (
            <div className="vc-toolbar">
              <input
                value={depFilter}
                placeholder={t('vcDepFilter')}
                onChange={(e) => setDepFilter(e.target.value)}
              />
            </div>
          )}
          {shownDeps.length === 0 && <div className="git-clean">{t('vcNoDeploys')}</div>}
          {shownDeps.map((d) => (
            <div key={d.id}>
              <div
                className="git-commit-row vc-deploy"
                title={`${d.url}\n${d.state}`}
                onClick={() => open(`https://${d.url}`)}
              >
                <div className="git-commit-subject">
                  <span className={`vc-dot ${stateClass(d.state)}`}>●</span>{' '}
                  {d.commit?.split('\n')[0] ?? d.url}
                  <span className="git-refs">
                    <span className={`git-ref ${d.target === 'production' ? 'vc-prod' : ''}`}>
                      {d.target === 'production' ? t('vcProd') : t('vcPrev')}
                    </span>
                    {d.id === prod?.id && <span className="git-ref vc-prod">{t('vcCurrent')}</span>}
                  </span>
                </div>
                <div className="git-commit-meta">
                  <span className={stateClass(d.state)}>{stateLabel(d.state)}</span>
                  {d.branch && (
                    <>
                      {' · '}
                      <Icon name="branch" size={11} /> {d.branch}
                    </>
                  )}
                  {d.sha && <code> {d.sha.slice(0, 7)}</code>} · {ago(d.created)}
                  {d.creator ? ` · ${d.creator}` : ''}
                </div>
                <span
                  className="git-row-actions vc-row-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    title={t('vcLogs')}
                    onClick={() => setLogsFor(logsFor === d.id ? null : d.id)}
                  >
                    <Icon name="scroll" size={14} />
                  </button>
                  {d.inspectorUrl && (
                    <button title={t('vcInspect')} onClick={() => open(d.inspectorUrl!)}>
                      <Icon name="external" size={14} />
                    </button>
                  )}
                  <button
                    title={t('vcCopyUrl')}
                    onClick={() => {
                      void navigator.clipboard.writeText(`https://${d.url}`);
                      toast(t('vcCopied'));
                    }}
                  >
                    <Icon name="copy" size={14} />
                  </button>
                  {LIVE.has(d.state) ? (
                    <button
                      title={t('vcCancel')}
                      onClick={() => {
                        if (!confirm(t('vcCancelConfirm'))) return;
                        void act('cancel', async () => {
                          await api().vercel.cancel(d.id, pick.teamId);
                          await loadDeps();
                        });
                      }}
                    >
                      <Icon name="stop" size={14} />
                    </button>
                  ) : (
                    <button
                      title={t('vcRedeploy')}
                      onClick={() => {
                        const toProd = d.target === 'production';
                        if (!confirm(toProd ? t('vcRedeployProdConfirm') : t('vcRedeployConfirm')))
                          return;
                        void act('redeploy', async () => {
                          await api().vercel.redeploy(d.id, pick.teamId, toProd);
                          toast(t('vcRedeployed'));
                          await loadDeps();
                        });
                      }}
                    >
                      <Icon name="sync" size={14} />
                    </button>
                  )}
                  {d.state === 'READY' && d.id !== prod?.id && (
                    <button
                      title={d.target === 'production' ? t('vcRollback') : t('vcPromote')}
                      onClick={() => {
                        const msg =
                          d.target === 'production'
                            ? t('vcRollbackConfirm')
                            : t('vcPromoteConfirm');
                        if (!confirm(msg)) return;
                        void act('promote', async () => {
                          await api().vercel.promote(projectId, d.id, teamId);
                          toast(t('vcPromoted'));
                          await loadDeps();
                        });
                      }}
                    >
                      <Icon name={d.target === 'production' ? 'undo' : 'bolt'} size={14} />
                    </button>
                  )}
                  {d.id !== prod?.id && !LIVE.has(d.state) && (
                    <button
                      title={t('vcDeleteDeploy')}
                      onClick={() => {
                        if (!confirm(t('vcDeleteDeployConfirm', { url: d.url }))) return;
                        void act('delete', async () => {
                          await api().vercel.removeDeployment(d.id, teamId);
                          await loadDeps();
                        });
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </span>
              </div>
              {logsFor === d.id && (
                <DeployLog
                  dep={d}
                  teamId={teamId}
                  onClose={() => setLogsFor(null)}
                  onFix={() => fix(d)}
                />
              )}
            </div>
          ))}
          {busy && (
            <div className="git-busy">
              <Icon name="clock" size={13} className="spin-slow" /> {busy}…
            </div>
          )}
        </div>
      )}

      {view === 'env' && (
        <div className="tree git-list">
          <div className="git-gh-hint">{t('vcEnvHint')}</div>
          <div className="git-connect-actions vc-env-actions">
            <button
              className="primary"
              onClick={() =>
                setEnvForm(envForm ? null : { key: '', value: '', targets: [...ENV_TARGETS] })
              }
            >
              <Icon name="plus" size={14} /> {t('vcEnvAdd')}
            </button>
            <button
              title={t('vcImportTitle')}
              onClick={() =>
                setEnvImport(envImport ? null : { text: '', targets: [...ENV_TARGETS] })
              }
            >
              <Icon name="insert" size={14} /> {t('vcImport')}
            </button>
            {workspace && (
              <button
                title={t('vcEnvPullTitle')}
                onClick={() => {
                  if (confirm(t('vcEnvPullConfirm'))) inTerminal(st.cli, 'env pull .env.local');
                }}
              >
                <Icon name="download" size={14} /> .env.local
              </button>
            )}
          </div>
          {envForm && (
            <div className="vc-form">
              <input
                value={envForm.key}
                placeholder="NOMBRE_VARIABLE"
                spellCheck={false}
                autoFocus
                onChange={(e) =>
                  setEnvForm({ ...envForm, key: e.target.value.replace(/[^\w]/g, '_') })
                }
              />
              <textarea
                value={envForm.value}
                placeholder={t('vcEnvValue')}
                spellCheck={false}
                rows={2}
                onChange={(e) => setEnvForm({ ...envForm, value: e.target.value })}
              />
              <div className="vc-targets">
                {ENV_TARGETS.map((tg) => (
                  <label key={tg}>
                    <input
                      type="checkbox"
                      checked={envForm.targets.includes(tg)}
                      onChange={(e) =>
                        setEnvForm({
                          ...envForm,
                          targets: e.target.checked
                            ? [...envForm.targets, tg]
                            : envForm.targets.filter((x) => x !== tg),
                        })
                      }
                    />
                    {tg}
                  </label>
                ))}
              </div>
              <div className="git-connect-actions">
                <button
                  className="primary"
                  disabled={!envForm.key.trim() || !envForm.targets.length || busy !== null}
                  onClick={saveEnv}
                >
                  {t('vcEnvSave')}
                </button>
                <button onClick={() => setEnvForm(null)}>{t('vcEnvCancel')}</button>
              </div>
            </div>
          )}
          {envImport && (
            <div className="vc-form">
              <textarea
                value={envImport.text}
                placeholder={'API_URL=https://…\nSECRET_KEY=…'}
                spellCheck={false}
                autoFocus
                rows={6}
                onChange={(e) => setEnvImport({ ...envImport, text: e.target.value })}
              />
              <div className="vc-targets">
                {ENV_TARGETS.map((tg) => (
                  <label key={tg}>
                    <input
                      type="checkbox"
                      checked={envImport.targets.includes(tg)}
                      onChange={(e) =>
                        setEnvImport({
                          ...envImport,
                          targets: e.target.checked
                            ? [...envImport.targets, tg]
                            : envImport.targets.filter((x) => x !== tg),
                        })
                      }
                    />
                    {tg}
                  </label>
                ))}
              </div>
              <div className="git-connect-actions">
                <button
                  className="primary"
                  disabled={!envImport.text.trim() || !envImport.targets.length || busy !== null}
                  onClick={importEnv}
                >
                  {t('vcImportRun', { n: parseDotenv(envImport.text).length })}
                </button>
                {workspace && (
                  <button title={t('vcImportReadTitle')} onClick={() => void readLocalEnv()}>
                    <Icon name="file" size={14} /> .env
                  </button>
                )}
                <button onClick={() => setEnvImport(null)}>{t('vcEnvCancel')}</button>
              </div>
            </div>
          )}
          {info && info.envs.length > 8 && (
            <div className="vc-toolbar">
              <input
                value={envFilter}
                placeholder={t('vcFilter')}
                onChange={(e) => setEnvFilter(e.target.value)}
              />
            </div>
          )}
          {info?.envs.length === 0 && <div className="git-clean">{t('vcNoEnv')}</div>}
          {shownEnvs.map((e) => (
            <div
              key={e.id}
              className="git-row"
              title={`${e.type}${e.branch ? ` · ${e.branch}` : ''}`}
            >
              <span className="git-icon">
                <Icon name="key" size={13} />
              </span>
              <span className="git-name">{e.key}</span>
              <span className="git-dir vc-right">{e.targets.join(' · ')}</span>
              <span className="git-row-actions">
                <button
                  title={t('vcEnvEdit')}
                  onClick={() => setEnvForm({ key: e.key, value: '', targets: e.targets })}
                >
                  <Icon name="edit" size={13} />
                </button>
                <button
                  title={t('vcEnvDelete')}
                  onClick={() => {
                    if (!confirm(t('vcEnvDeleteConfirm', { key: e.key }))) return;
                    void act('env', async () => {
                      await api().vercel.deleteEnv(projectId, teamId, e.id);
                      loadInfo();
                    });
                  }}
                >
                  <Icon name="trash" size={13} />
                </button>
              </span>
            </div>
          ))}
          {dashboard && (
            <button
              className="link git-fetch"
              onClick={() => open(`${dashboard}/settings/environment-variables`)}
            >
              {t('vcEditEnv')}
            </button>
          )}
        </div>
      )}

      {view === 'domains' && (
        <div className="tree git-list">
          <div className="vc-toolbar vc-domain-add">
            <input
              value={newDomain}
              placeholder={t('vcDomainPh')}
              spellCheck={false}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addDomain();
              }}
            />
            <button
              className="primary"
              disabled={!newDomain.trim() || busy !== null}
              onClick={addDomain}
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
          {info?.domains.length === 0 && <div className="git-clean">{t('vcNoDomains')}</div>}
          {info?.domains.map((d) => (
            <div
              key={d.name}
              className="git-row"
              title={d.verified ? d.name : t('vcUnverified')}
              onClick={() => open(`https://${d.name}`)}
            >
              <span className={`git-icon ${d.verified ? 'added' : 'modified'}`}>●</span>
              <span className="git-name">{d.name}</span>
              <span className="git-dir">
                {d.redirect ? `→ ${d.redirect}` : d.branch ? d.branch : ''}
              </span>
              <span className="git-dir vc-right">
                {d.verified ? t('vcVerified') : t('vcPending')}
              </span>
              <span className="git-row-actions" onClick={(e) => e.stopPropagation()}>
                {!d.verified && (
                  <button
                    title={t('vcVerify')}
                    onClick={() =>
                      void act('verify', async () => {
                        const ok = await api().vercel.verifyDomain(projectId, teamId, d.name);
                        toast(ok ? t('vcVerifiedNow') : t('vcStillPending'));
                        loadInfo();
                      })
                    }
                  >
                    <Icon name="refresh" size={13} />
                  </button>
                )}
                <button
                  title={t('vcCopyUrl')}
                  onClick={() => {
                    void navigator.clipboard.writeText(`https://${d.name}`);
                    toast(t('vcCopied'));
                  }}
                >
                  <Icon name="copy" size={13} />
                </button>
                <button
                  title={t('vcDomainRemove')}
                  onClick={() => {
                    if (!confirm(t('vcDomainRemoveConfirm', { name: d.name }))) return;
                    void act('domain', async () => {
                      await api().vercel.removeDomain(projectId, teamId, d.name);
                      loadInfo();
                    });
                  }}
                >
                  <Icon name="trash" size={13} />
                </button>
              </span>
            </div>
          ))}
          {dashboard && (
            <button
              className="link git-fetch"
              onClick={() => open(`${dashboard}/settings/domains`)}
            >
              {t('vcDomainsDns')}
            </button>
          )}
        </div>
      )}

      {view === 'settings' && (
        <div className="tree git-list">
          {!settingsDraft && (
            <div className="git-clean">
              <Icon name="clock" size={13} className="spin-slow" /> {t('vcLoading')}
            </div>
          )}
          {settingsDraft && (
            <div className="vc-form vc-settings">
              <div className="git-gh-hint">{t('vcSettingsHint')}</div>
              {SETTING_FIELDS.map((f) => (
                <label key={f.key}>
                  <span>{f.label}</span>
                  <input
                    value={settingsDraft[f.key] ?? ''}
                    placeholder={f.ph}
                    spellCheck={false}
                    onChange={(e) =>
                      setSettingsDraft({ ...settingsDraft, [f.key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label>
                <span>Node.js</span>
                <select
                  value={settingsDraft.nodeVersion ?? ''}
                  onChange={(e) =>
                    setSettingsDraft({ ...settingsDraft, nodeVersion: e.target.value || null })
                  }
                >
                  {!settingsDraft.nodeVersion && <option value="">—</option>}
                  {[
                    ...new Set([
                      ...NODE_VERSIONS,
                      ...(settingsDraft.nodeVersion ? [settingsDraft.nodeVersion] : []),
                    ]),
                  ].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <div className="git-connect-actions">
                <button
                  className="primary"
                  disabled={!settingsChanged || busy !== null}
                  onClick={saveSettings}
                >
                  {t('vcEnvSave')}
                </button>
                {settingsChanged && (
                  <button onClick={() => setSettingsDraft(settings)}>{t('vcEnvCancel')}</button>
                )}
              </div>
              <div className="git-gh-hint">{t('vcSettingsRedeploy')}</div>
            </div>
          )}
          {dashboard && (
            <button className="link git-fetch" onClick={() => open(`${dashboard}/settings`)}>
              {t('vcAllSettings')}
            </button>
          )}
        </div>
      )}

      {busy && view !== 'deploys' && (
        <div className="git-busy">
          <Icon name="clock" size={13} className="spin-slow" /> {busy}…
        </div>
      )}
    </div>
  );
}
