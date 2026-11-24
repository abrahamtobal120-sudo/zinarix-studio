import { useEffect, useRef, useState } from 'react';
import type { DesignApp, DesignSessionView } from '../../../shared/design';
import { t } from '../../i18n';
import { api, setState } from '../../store';
import { askInChat } from '../Chat';
import { Icon } from '../Icon';
import { detectRunTasks, runTask, type RunTask } from '../RunPanel';

const errText = (e: unknown) =>
  String((e as Error)?.message ?? e).replace(
    /^Error invoking remote method '[^']*': (Error: )?/,
    '',
  );

/** Seconds the panel waits for a started project to answer. */
const WAIT_S = 120;

/** How the app's dev server is started: its "dev" (or "start"…) script, in its own folder. */
async function startTask(app: DesignApp): Promise<RunTask | null> {
  const pkg = app.dir ? `${app.dir}/package.json` : 'package.json';
  const { tasks } = await detectRunTasks();
  const task = tasks
    .filter((x) => x.file === pkg && / run (dev|start|serve|develop)$/.test(x.label))
    .sort((a, b) => a.priority - b.priority)[0];
  if (!task) return null;
  // Dependencies never installed (a project just downloaded): install them first.
  const entries = await api()
    .workspace.readDir(app.dir || '.')
    .catch(() => []);
  const rootEntries = app.dir
    ? await api()
        .workspace.readDir('.')
        .catch(() => [])
    : entries;
  const installed = [...entries, ...rootEntries].some((e) => e.dir && e.name === 'node_modules');
  if (installed) return task;
  const command = task.command.replace(
    /\b(npm|pnpm|yarn|bun) run (\S+)$/,
    '$1 install && $1 run $2',
  );
  return { ...task, command };
}

/**
 * A framework project (Vite, Next, Astro…) before it is shown: start it, connect to it if it
 * is already running, or show its built files. Every problem is said in plain words with
 * what to do next.
 */
export function LiveSetup(props: {
  view: DesignSessionView;
  onView: (v: DesignSessionView) => void;
  onExit: () => void;
}) {
  const { view } = props;
  const [dir, setDir] = useState(view.app?.dir ?? '');
  const app = view.apps.find((a) => a.dir === dir) ?? view.app;
  const [task, setTask] = useState<RunTask | null | undefined>(undefined);
  const [found, setFound] = useState<string | null>(null);
  const [url, setUrl] = useState(app?.devUrl ?? 'http://localhost:5173');
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const cancel = useRef(false);

  useEffect(() => {
    if (!app) return;
    let gone = false;
    setTask(undefined);
    setFound(null);
    setUrl(app.devUrl ?? 'http://localhost:5173');
    void startTask(app)
      .then((x) => !gone && setTask(x))
      .catch(() => !gone && setTask(null));
    // Already running (started earlier, or by hand): offer it at once.
    void api()
      .design.detect(app.dir)
      .then((u) => !gone && setFound(u))
      .catch(() => undefined);
    return () => {
      gone = true;
      cancel.current = true;
    };
  }, [app?.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!app) return null;

  const connect = async (address: string) => {
    setBusy(true);
    setProblem(null);
    try {
      props.onView(await api().design.show({ mode: 'live', dir: app.dir, url: address }));
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const built = async () => {
    setBusy(true);
    setProblem(null);
    try {
      props.onView(await api().design.show({ mode: 'built', dir: app.dir }));
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!task) return;
    setProblem(null);
    cancel.current = false;
    runTask(task);
    const t0 = Date.now();
    setWaited(0);
    while (!cancel.current) {
      await new Promise((r) => setTimeout(r, 2000));
      if (cancel.current) break;
      const s = Math.round((Date.now() - t0) / 1000);
      setWaited(s);
      const u = await api()
        .design.detect(app.dir)
        .catch(() => null);
      if (u) {
        setWaited(null);
        await connect(u);
        return;
      }
      if (s >= WAIT_S) {
        setWaited(null);
        setProblem(t('dzLiveTimeout', { s: WAIT_S }));
        return;
      }
    }
    setWaited(null);
  };

  return (
    <div className="dz dz-empty">
      <div className="dz-empty-card dz-live-card">
        <Icon name="palette" size={34} />
        <h2>{t('dzLiveTitle', { kind: app.label })}</h2>
        <p>{t('dzLiveText')}</p>

        {view.apps.length > 1 && (
          <label className="dz-live-row">
            <span>{t('dzLiveApp')}</span>
            <select
              value={app.dir}
              onChange={(e) => setDir(e.target.value)}
              disabled={busy || waited !== null}
            >
              {view.apps.map((a) => (
                <option key={a.dir} value={a.dir}>
                  {(a.dir || '.') + ' — ' + a.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {found && waited === null && (
          <div className="dz-live-found">
            <Icon name="check" size={14} /> {t('dzLiveFound', { url: found })}
            <button className="primary" disabled={busy} onClick={() => void connect(found)}>
              {t('dzLiveShowFound')}
            </button>
          </div>
        )}

        <div className="dz-empty-actions">
          {waited === null ? (
            <button
              className={found ? '' : 'primary'}
              disabled={!task || busy}
              onClick={() => void start()}
            >
              <Icon name="play" size={14} /> {t('dzLiveStart')}
            </button>
          ) : (
            <button
              onClick={() => {
                cancel.current = true;
                setWaited(null);
              }}
            >
              {t('dzLiveCancel')}
            </button>
          )}
          {app.built && (
            <button
              disabled={busy || waited !== null}
              onClick={() => void built()}
              title={t('dzLiveBuiltTitle')}
            >
              {t('dzLiveBuilt', { dir: app.built })}
            </button>
          )}
          <button onClick={() => askInChat(t('dzAiNotYet', { kind: app.label }))}>
            <Icon name="sparkle" size={14} /> {t('dzAskAi')}
          </button>
          <button onClick={props.onExit}>{t('dzExit')}</button>
        </div>
        {task && waited === null && (
          <p className="dz-live-note">{t('dzLiveStartCmd', { cmd: task.command })}</p>
        )}
        {task === null && <p className="dz-live-note">{t('dzLiveNoTask')}</p>}
        {waited !== null && (
          <p className="dz-live-note" role="status">
            {t('dzLiveWaiting', { s: waited })}
          </p>
        )}

        <form
          className="dz-live-row"
          onSubmit={(e) => {
            e.preventDefault();
            void connect(url);
          }}
        >
          <span>{t('dzLiveManual')}</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            aria-label={t('dzLiveManual')}
          />
          <button type="submit" disabled={busy}>
            {t('dzLiveConnect')}
          </button>
        </form>

        {problem && (
          <div className="dz-live-problem" role="alert">
            <Icon name="warning" size={14} /> <span>{problem}</span>
            <button
              className="link"
              onClick={() => {
                setState({ panelOpen: true });
                askInChat(t('dzLiveFixAi', { kind: app.label, problem }));
              }}
            >
              {t('dzAskAiDo')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
