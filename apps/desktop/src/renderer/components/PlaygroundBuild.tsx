/* Fase 9 — Build: "describe tu app" → carpeta nueva + chat del agente (auto-aprobar) + vista
   previa en vivo en el panel Diseño + despliegue en Vercel con un clic. */
import { useEffect, useRef, useState } from 'react';
import type { BuildDeployView, BuildView as BuildInfoView } from '../../shared/build';
import { buildPrompt } from '../../shared/build';
import type { VercelStatus } from '../../shared/api';
import { confirmDialog } from '../confirm';
import { errText } from '../errText';
import { tp } from '../i18nPlayground';
import { openLink } from '../links';
import { api, dirtyCount, newChat, setState, switchWorkspace, toast, useStore } from '../store';
import { Icon } from './Icon';

const DONE = new Set(['READY', 'ERROR', 'CANCELED']);

export function BuildView({ models }: { models: string[] }) {
  const root = useStore((s) => s.workspace?.root ?? null);
  const [desc, setDesc] = useState('');
  const [parent, setParent] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<BuildInfoView | null>(null);
  const [recent, setRecent] = useState<BuildInfoView[]>([]);
  const [vercel, setVercel] = useState<VercelStatus | null>(null);
  const [team, setTeam] = useState<string>('');
  const [deploy, setDeploy] = useState<(BuildDeployView & { busy?: boolean }) | null>(null);
  const poll = useRef<number | null>(null);

  useEffect(() => {
    void api()
      .build.defaultParent()
      .then((p) => setParent((x) => x || p));
    void api()
      .vercel.status()
      .then(setVercel)
      .catch(() => setVercel(null));
    return () => {
      if (poll.current) window.clearTimeout(poll.current);
    };
  }, []);

  useEffect(() => {
    setDeploy(null);
    void api()
      .build.info()
      .then(setCurrent)
      .catch(() => setCurrent(null));
    void api()
      .build.recent()
      .then(setRecent)
      .catch(() => undefined);
  }, [root]);

  const create = async () => {
    if (busy || desc.trim().length < 4) return;
    if (dirtyCount()) return toast(tp('bdUnsaved'));
    setBusy(true);
    try {
      const b = await api().build.create(parent, desc);
      const r = await api().workspace.openPath(b.root);
      if (r) switchWorkspace(r.workspace);
      newChat({
        folder: b.root,
        mode: 'auto',
        agent: true,
        model: model || null,
        initial: { prompt: buildPrompt(b.description), send: true },
      });
      setState({ sidebar: 'design', chatOpen: true });
      setDesc('');
      toast(tp('bdStarted', { path: b.root }));
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const openApp = async (path: string) => {
    if (dirtyCount()) return toast(tp('bdUnsaved'));
    const r = await api().workspace.openPath(path);
    if (r) switchWorkspace(r.workspace);
  };

  const watch = (d: BuildDeployView, teamId: string | null) => {
    if (DONE.has(d.state)) return;
    poll.current = window.setTimeout(() => {
      void api()
        .build.deployState(d.id, teamId)
        .then((state) => {
          const next = { ...d, state };
          setDeploy(next);
          watch(next, teamId);
        })
        .catch(() => undefined);
    }, 3000);
  };

  const publish = async (production: boolean) => {
    if (!current) return;
    const ok = await confirmDialog(
      tp('bdDeployAsk', {
        name: current.projectName,
        target: tp(production ? 'bdTargetProd' : 'bdTargetPreview'),
      }),
      { okLabel: tp(production ? 'bdDeployProd' : 'bdDeployPreview') },
    );
    if (!ok) return;
    const teamId = team || null;
    setDeploy({ id: '', url: '', state: 'UPLOADING', busy: true });
    try {
      const d = await api().build.deploy(teamId, production);
      setDeploy(d);
      watch(d, teamId);
      setCurrent(await api().build.info());
    } catch (e) {
      setDeploy(null);
      toast(errText(e));
    }
  };

  return (
    <div className="pg-build">
      <section className="pg-build-new">
        <h3>{tp('bdTitle')}</h3>
        <p className="pg-hint">{tp('bdHint')}</p>
        <textarea
          rows={5}
          value={desc}
          placeholder={tp('bdPh')}
          aria-label={tp('bdTitle')}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void create();
            }
          }}
        />
        <div className="pg-row">
          <span>{tp('bdFolder')}</span>
          <code className="pg-path" title={parent}>
            {parent}
          </code>
          <button
            onClick={() =>
              void api()
                .build.pickParent()
                .then((p) => p && setParent(p))
            }
          >
            {tp('bdChange')}
          </button>
        </div>
        <label className="pg-row">
          <span>{tp('bdModel')}</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">{tp('bdModelDefault')}</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <div className="pg-row end">
          <button
            className="primary"
            disabled={busy || desc.trim().length < 4 || !parent}
            onClick={() => void create()}
          >
            <Icon name="sparkle" size={13} /> {busy ? tp('bdCreating') : tp('bdCreate')}
          </button>
        </div>
      </section>

      <section className="pg-build-current">
        <h3>{tp('bdCurrent')}</h3>
        {!current ? (
          <p className="pg-muted">{tp('bdNotBuild')}</p>
        ) : (
          <>
            <p className="pg-desc">{current.description}</p>
            <code className="pg-path">{current.root}</code>
            <div className="pg-row">
              <button onClick={() => setState({ sidebar: 'design', maximized: null })}>
                <Icon name="eye" size={13} /> {tp('bdPreview')}
              </button>
            </div>
            <h4>
              <Icon name="vercel" size={13} /> {tp('bdDeploy')}
            </h4>
            {!vercel?.connected ? (
              <div className="pg-row">
                <span className="pg-muted">{tp('bdConnect')}</span>
                <button onClick={() => setState({ sidebar: 'vercel' })}>{tp('bdOpenVercel')}</button>
              </div>
            ) : (
              <>
                {vercel.teams.length > 0 && (
                  <label className="pg-row">
                    <span>{tp('bdTeam')}</span>
                    <select value={team} onChange={(e) => setTeam(e.target.value)}>
                      <option value="">{tp('bdPersonal')}</option>
                      {vercel.teams.map((tm) => (
                        <option key={tm.id} value={tm.id}>
                          {tm.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="pg-row">
                  <button
                    disabled={Boolean(deploy?.busy) || (deploy !== null && !DONE.has(deploy.state))}
                    onClick={() => void publish(false)}
                  >
                    {tp('bdDeployPreview')}
                  </button>
                  <button
                    className="primary"
                    disabled={Boolean(deploy?.busy) || (deploy !== null && !DONE.has(deploy.state))}
                    onClick={() => void publish(true)}
                  >
                    <Icon name="cloud" size={13} /> {tp('bdDeployProd')}
                  </button>
                </div>
              </>
            )}
            {deploy && (
              <p className={`pg-hint ${deploy.state === 'ERROR' ? 'err' : ''}`} aria-live="polite">
                {deploy.busy
                  ? tp('bdDeploying')
                  : deploy.state === 'READY'
                    ? tp('bdReady', { url: deploy.url })
                    : tp('bdState', { state: deploy.state })}{' '}
                {deploy.url && (
                  <button className="link" onClick={() => openLink(deploy.url)}>
                    <Icon name="external" size={12} /> {deploy.url}
                  </button>
                )}
              </p>
            )}
            {!deploy && current.lastDeploy && (
              <p className="pg-hint">
                {tp('bdLast')}: {new Date(current.lastDeploy.at).toLocaleString()} ·{' '}
                <button className="link" onClick={() => openLink(current.lastDeploy!.url)}>
                  {current.lastDeploy.url}
                </button>
              </p>
            )}
          </>
        )}
        {recent.filter((b) => b.root !== current?.root).length > 0 && (
          <>
            <h4>{tp('bdRecent')}</h4>
            <ul className="pg-recent">
              {recent
                .filter((b) => b.root !== current?.root)
                .map((b) => (
                  <li key={b.root}>
                    <span title={b.root}>{b.description.split('\n')[0]}</span>
                    <button onClick={() => void openApp(b.root)}>{tp('bdOpen')}</button>
                  </li>
                ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
