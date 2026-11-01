import { Icon } from './Icon';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  VercelDeploymentView,
  VercelProjectInfo,
  VercelProjectView,
  VercelStatus,
} from '../../shared/api';
import { t } from '../i18n';
import { api, setState, toast, useStore } from '../store';
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

function deploy(prod: boolean, cli: boolean) {
  if (prod && !confirm(t('vcProdConfirm'))) return;
  const bin = cli ? 'vercel' : 'npx vercel';
  setState({ panelOpen: true });
  setTimeout(() => void runInTerminal(`${bin} deploy${prod ? ' --prod' : ''}`), 300);
}

export function VercelPanel() {
  const workspace = useStore((s) => s.workspace);
  const root = workspace?.root;
  const [st, setSt] = useState<VercelStatus | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [linked, setLinked] = useState(false);
  const [scope, setScope] = useState<string | null>(null);
  const [projects, setProjects] = useState<VercelProjectView[] | null>(null);
  const [filter, setFilter] = useState('');
  const [deps, setDeps] = useState<VercelDeploymentView[]>([]);
  const [info, setInfo] = useState<VercelProjectInfo | null>(null);
  const [view, setView] = useState<'deploys' | 'env'>('deploys');
  const [logs, setLogs] = useState<{ id: string; text: string } | null>(null);

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

  // Project of the open folder: the `vercel link` file first, then a project picked here.
  useEffect(() => {
    setPick(null);
    setLinked(false);
    setDeps([]);
    setInfo(null);
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

  useEffect(() => {
    if (!pick) return;
    void loadDeps();
    void api()
      .vercel.project(pick.projectId, pick.teamId)
      .then(setInfo)
      .catch(() => setInfo(null));
    // Name and repo of the project come from the list of its scope.
    void api()
      .vercel.projects(pick.teamId)
      .then(setProjects)
      .catch(() => {});
  }, [pick, loadDeps]);

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
          <button title={t('gitRefresh')} onClick={() => void loadDeps()}>
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

  if (!st.connected) {
    return (
      <div className="explorer">
        {title}
        <div className="sidebar-empty vc-connect">
          <p>{st.source ? t('vcTokenRejected') : t('vcIntro')}</p>
          <input
            type="password"
            value={token}
            placeholder={t('vcTokenPh')}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && token.trim())
                void act('token', async () => setSt(await api().vercel.setToken(token)));
            }}
          />
          <button
            className="primary"
            disabled={!token.trim() || busy !== null}
            onClick={() =>
              void act('token', async () => {
                setSt(await api().vercel.setToken(token));
                setToken('');
              })
            }
          >
            {busy === 'token' ? '…' : t('vcConnect')}
          </button>
          <button className="link" onClick={() => open('https://vercel.com/account/tokens')}>
            {t('vcCreateToken')}
          </button>
          <p className="vc-hint">{st.cli ? t('vcCliHint') : t('vcCliMissing')}</p>
          <button
            onClick={() => {
              setState({ panelOpen: true });
              setTimeout(
                () => void runInTerminal(`${st.cli ? 'vercel' : 'npx vercel'} login`),
                300,
              );
            }}
          >
            {t('vcCliLogin')}
          </button>
          <button className="link" onClick={() => void api().vercel.status().then(setSt)}>
            {t('vcRecheck')}
          </button>
        </div>
      </div>
    );
  }

  const account = (
    <div className="git-branchbar">
      <span className="git-branch" title={st.source === 'cli' ? t('vcFromCli') : t('vcFromApp')}>
        ▲ {st.user}
      </span>
      <span className="spacer" />
      {st.source === 'app' && (
        <button
          className="link"
          onClick={() => {
            if (confirm(t('vcLogoutConfirm')))
              void act('logout', async () => setSt(await api().vercel.logout()));
          }}
        >
          {t('vcLogout')}
        </button>
      )}
    </div>
  );

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
                <button
                  onClick={() => {
                    setState({ panelOpen: true });
                    setTimeout(
                      () => void runInTerminal(`${st.cli ? 'vercel' : 'npx vercel'} link`),
                      300,
                    );
                  }}
                >
                  {t('vcLink')}
                </button>
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
  const dashboard = project
    ? `https://vercel.com/${st.teams.find((x) => x.id === project.teamId)?.slug ?? st.user}/${project.name}`
    : null;

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
                {d.verified ? '' : '⚠ '}
                {d.name}
              </button>
            ))}
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

      <div className="git-branchbar">
        <div className="git-tabs">
          <button className={view === 'deploys' ? 'on' : ''} onClick={() => setView('deploys')}>
            {t('vcDeploys')}
          </button>
          <button className={view === 'env' ? 'on' : ''} onClick={() => setView('env')}>
            {t('vcEnv')} {info ? `(${info.envs.length})` : ''}
          </button>
        </div>
        {building && (
          <span className="git-track">
            <Icon name="clock" size={12} className="spin-slow" /> {t('vcBuilding')}
          </span>
        )}
      </div>

      {view === 'deploys' && (
        <div className="tree git-list">
          {deps.length === 0 && <div className="git-clean">{t('vcNoDeploys')}</div>}
          {deps.map((d) => (
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
                    onClick={() =>
                      logs?.id === d.id
                        ? setLogs(null)
                        : void act('logs', async () =>
                            setLogs({
                              id: d.id,
                              text: (await api().vercel.logs(d.id, pick.teamId)) || t('vcNoLogs'),
                            }),
                          )
                    }
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
                </span>
              </div>
              {logs?.id === d.id && <pre className="vc-logs">{logs.text}</pre>}
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
          {info?.envs.length === 0 && <div className="git-clean">{t('vcNoEnv')}</div>}
          {info?.envs.map((e) => (
            <div key={`${e.key}:${e.targets.join(',')}`} className="git-row" title={e.type}>
              <span className="git-icon">
                <Icon name="key" size={13} />
              </span>
              <span className="git-name">{e.key}</span>
              <span className="git-dir vc-right">{e.targets.join(' · ')}</span>
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
    </div>
  );
}
