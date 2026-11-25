import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openLink } from '../../links';
import { api, openBrowserTab, openFile, toast, useStore } from '../../store';
import { askAgent } from '../Chat';
import { Icon } from '../Icon';
import {
  GAME_TEMPLATES,
  parseGodotOutput,
  resToRel,
  type GamesScan,
  type GameTemplate,
  type GodotProblem,
  type GodotProject,
  type GodotStatus,
} from '../../../shared/games';
import { tgm, type KeyGames } from './gamesStrings';
import './games.css';

/**
 * Games panel (Fase 6 del plan de funciones): Godot 4 projects of the open folder (run the
 * game or one scene with its console, errors that open the script at the line, check the
 * scripts, see a frame, export, open the editor), web games played in the built-in browser,
 * Unity / Unreal projects opened in their editors, and new games from templates.
 */

const RUN = 'games-run';
const MAX_OUT = 400_000;

type Problem = GodotProblem & { count: number };

const errText = (e: unknown) =>
  String((e as Error)?.message ?? e).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );

/**
 * The running game's console lives outside React: the scene viewer can start a scene and the
 * panel (opened now or later) shows the same output.
 */
interface RunState {
  out: string;
  running: boolean;
  code: number | null | undefined;
  dir: string;
}
let run: RunState = { out: '', running: false, code: undefined, dir: '' };
const runListeners = new Set<() => void>();
let runSub: (() => void) | null = null;
function setRun(patch: Partial<RunState>): void {
  run = { ...run, ...patch };
  for (const f of runListeners) f();
}
function listenRun(): void {
  runSub ??= api().on((ev) => {
    if (ev.type !== 'games' || ev.event.key !== RUN) return;
    const e = ev.event;
    if (e.kind === 'run-data') {
      const next = run.out + e.chunk;
      setRun({ out: next.length > MAX_OUT ? next.slice(next.length - MAX_OUT) : next });
    } else setRun({ running: false, code: e.code });
  });
}
function useRun(): RunState {
  const [, bump] = useState(0);
  useEffect(() => {
    listenRun();
    const f = () => bump((n) => n + 1);
    runListeners.add(f);
    return () => void runListeners.delete(f);
  }, []);
  return run;
}

/** Runs a Godot project (or one of its scenes) in its window; output goes to the Games panel. */
export async function runGame(
  dir: string,
  scene: string | null,
  opts: { debugCollisions?: boolean } = {},
): Promise<void> {
  listenRun();
  setRun({ out: '', code: undefined, running: true, dir });
  try {
    await api().games.run(RUN, dir, { scene, ...opts });
  } catch (e) {
    setRun({ running: false, out: `${errText(e)}\n` });
  }
}

export function GamesPanel() {
  const root = useStore((s) => s.workspace?.root ?? null);
  const [status, setStatus] = useState<GodotStatus | null>(null);
  const [scan, setScan] = useState<GamesScan | null>(null);
  const [dir, setDir] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (force = false) => {
    const [st, sc] = await Promise.all([
      api()
        .games.status(force)
        .catch((): GodotStatus => ({ state: 'missing' })),
      api()
        .games.scan()
        .catch((): GamesScan => ({ godot: [], others: [], web: [] })),
    ]);
    setStatus(st);
    setScan(sc);
  }, []);
  useEffect(() => {
    void load();
  }, [load, root]);

  const pick = async () => {
    try {
      const st = await api().games.pickExecutable();
      if (st) {
        setStatus(st);
        if (st.exe) toast(tgm('picked', { exe: st.exe }));
      }
    } catch (e) {
      toast(tgm('error', { err: errText(e) }));
    }
  };

  const project = scan?.godot.find((p) => p.dir === dir) ?? scan?.godot[0] ?? null;
  const empty = scan && !scan.godot.length && !scan.web.length && !scan.others.length;

  return (
    <div className="explorer gm-panel">
      <div className="sidebar-title">
        <span className="panel-title">
          {tgm('title')}
          {status?.state === 'ready' && (
            <button className="gm-version" title={status.exe} onClick={() => void pick()}>
              {tgm('godotReady', { v: status.version ?? '' })}
            </button>
          )}
        </span>
        <span className="sidebar-actions">
          {root && (
            <button
              title={tgm('newGame')}
              aria-label={tgm('newGame')}
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" size={15} />
            </button>
          )}
          <button
            title={tgm('refresh')}
            aria-label={tgm('refresh')}
            onClick={() => void load(true)}
          >
            <Icon name="refresh" size={15} />
          </button>
        </span>
      </div>
      {!status || !scan ? (
        <div className="gm-empty">{tgm('loading')}</div>
      ) : !root ? (
        <div className="gm-empty">{tgm('noFolder')}</div>
      ) : creating ? (
        <NewGame
          onCancel={() => setCreating(false)}
          onCreated={(folder) => {
            setCreating(false);
            setDir(folder);
            void load();
          }}
        />
      ) : (
        <div className="gm-body">
          {status.state !== 'ready' && (scan.godot.length > 0 || empty) && (
            <div className="gm-card">
              <p>{tgm('godotMissing')}</p>
              <div className="gm-btns">
                <button
                  className="btn"
                  onClick={() => openLink('https://godotengine.org/download')}
                >
                  {tgm('download')}
                </button>
                <button className="btn ghost" onClick={() => void pick()}>
                  {tgm('pick')}
                </button>
                <button className="btn ghost" onClick={() => void load(true)}>
                  {tgm('recheck')}
                </button>
              </div>
            </div>
          )}
          {empty && (
            <div className="gm-empty">
              <p>{tgm('noProjects')}</p>
              <button className="btn" onClick={() => setCreating(true)}>
                {tgm('newGame')}
              </button>
            </div>
          )}
          {project && (
            <GodotBox
              key={project.dir}
              project={project}
              projects={scan.godot}
              ready={status.state === 'ready'}
              onPick={setDir}
            />
          )}
          {scan.web.length > 0 && (
            <div className="gm-section">
              <div className="gm-subtitle">{tgm('web')}</div>
              {scan.web.map((w) => (
                <div className="gm-row" key={w.entry}>
                  <button
                    className="gm-link"
                    title={w.entry}
                    onClick={() => void openFile(w.entry)}
                  >
                    {w.dir || '.'}
                  </button>
                  <span className="gm-tag">{w.lib}</span>
                  <div className="spacer" />
                  <button
                    className="btn gm-small"
                    title={tgm('playHint')}
                    onClick={() => void playWeb(w.dir)}
                  >
                    <Icon name="play" size={13} /> {tgm('play')}
                  </button>
                </div>
              ))}
            </div>
          )}
          {scan.others.length > 0 && (
            <div className="gm-section">
              <div className="gm-subtitle">{tgm('others')}</div>
              {scan.others.map((o) => {
                const app = o.kind === 'unity' ? 'Unity' : 'Unreal';
                return (
                  <div className="gm-row" key={`${o.kind}:${o.dir}`}>
                    <span className="gm-tag">{app}</span>
                    <span className="gm-name" title={o.dir}>
                      {o.name}
                    </span>
                    {o.version && (
                      <span className="gm-dim">{tgm('version', { v: o.version })}</span>
                    )}
                    <div className="spacer" />
                    <button
                      className="btn ghost gm-small"
                      onClick={() =>
                        void api()
                          .games.openOther(o.kind, o.dir, o.file)
                          .then(() => toast(tgm('opened', { app })))
                          .catch((e) => toast(tgm('error', { err: errText(e) })))
                      }
                    >
                      {tgm('openIn', { app })}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

async function playWeb(dir: string): Promise<void> {
  try {
    const url = await api().games.webUrl(dir ? `${dir}/` : '');
    openBrowserTab();
    await api().browser.navigate(url, null);
  } catch (e) {
    toast(tgm('error', { err: errText(e) }));
  }
}

/** One Godot project: run / stop, scenes, console with problems, check, screenshot, export. */
function GodotBox({
  project,
  projects,
  ready,
  onPick,
}: {
  project: GodotProject;
  projects: GodotProject[];
  ready: boolean;
  onPick: (dir: string) => void;
}) {
  const rs = useRun();
  const mine = rs.dir === project.dir;
  const out = mine ? rs.out : '';
  const running = mine && rs.running;
  const code = mine ? rs.code : undefined;
  const setOut = (text: string) => setRun({ out: text, dir: project.dir });
  const [collisions, setCollisions] = useState(false);
  const [busy, setBusy] = useState<'check' | 'shot' | 'export' | null>(null);
  const [checkMsg, setCheckMsg] = useState('');
  const [checkProblems, setCheckProblems] = useState<Problem[]>([]);
  const [shot, setShot] = useState<string | null>(null);
  const [preset, setPreset] = useState(project.presets[0]?.name ?? '');
  const [showScenes, setShowScenes] = useState(true);
  const pre = useRef<HTMLPreElement>(null);
  const info = project.info;

  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [out]);

  const problems = useMemo(() => {
    const all = [...parseGodotOutput(out), ...checkProblems];
    return all.filter(
      (p, i) =>
        all.findIndex((q) => q.file === p.file && q.line === p.line && q.message === p.message) ===
        i,
    );
  }, [out, checkProblems]);

  const start = (scene: string | null) =>
    void runGame(project.dir, scene, { debugCollisions: collisions });
  const stop = () => void api().games.stop(RUN);

  const check = async () => {
    setBusy('check');
    setCheckMsg('');
    try {
      const r = await api().games.check(project.dir);
      setCheckProblems(r.problems);
      const files = new Set(r.problems.map((p) => p.file)).size;
      setCheckMsg(
        r.problems.length
          ? tgm('checkBad', { n: r.checked, e: files })
          : tgm('checkOk', { n: r.checked }),
      );
    } catch (e) {
      setCheckMsg(tgm('error', { err: errText(e) }));
    } finally {
      setBusy(null);
    }
  };

  const capture = async () => {
    setBusy('shot');
    try {
      const r = await api().games.frame(project.dir, null, 2);
      setShot(r.image);
      if (r.problems.length) setCheckProblems((p) => [...p, ...r.problems]);
      if (!r.image) setOut(r.output);
    } catch (e) {
      toast(tgm('error', { err: errText(e) }));
    } finally {
      setBusy(null);
    }
  };

  const doExport = async () => {
    if (!preset) return;
    setBusy('export');
    try {
      const r = await api().games.export(project.dir, preset, false);
      setOut(r.output);
      toast(r.ok ? tgm('exported', { path: r.path }) : tgm('exportFail'));
    } catch (e) {
      toast(tgm('error', { err: errText(e) }));
    } finally {
      setBusy(null);
    }
  };

  const openProblem = (p: Problem) => {
    const rel = resToRel(p.file, project.dir);
    if (rel) void openFile(rel, p.line ? { line: p.line, column: 1 } : undefined);
  };
  const fix = () => {
    const list = problems
      .slice(0, 40)
      .map(
        (p) =>
          `${p.severity}: ${resToRel(p.file, project.dir) ?? (p.file || '?')}${p.line ? `:${p.line}` : ''}: ${p.message}`,
      )
      .join('\n');
    askAgent(tgm('fixPrompt', { dir: project.dir || '.', errors: list }));
  };
  const errors = problems.filter((p) => p.severity === 'error').length;

  return (
    <div className="gm-section gm-godot">
      <div className="gm-subtitle">
        <span className="gm-tag godot">{tgm('godot')}</span>
        {projects.length > 1 ? (
          <select
            value={project.dir}
            onChange={(e) => onPick(e.target.value)}
            aria-label={tgm('project')}
          >
            {projects.map((p) => (
              <option key={p.dir} value={p.dir}>
                {p.info.name} ({p.dir || '.'})
              </option>
            ))}
          </select>
        ) : (
          <span className="gm-name">{info.name}</span>
        )}
      </div>
      <div className="gm-dim">
        {[
          info.version && `Godot ${info.version}`,
          info.renderer,
          project.scripts === 1 ? tgm('scriptsOne') : tgm('scriptsCount', { n: project.scripts }),
          project.dir && `${project.dir}/`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
      <div className="gm-btns">
        {running ? (
          <button className="btn gm-stop" onClick={stop}>
            <Icon name="stop" size={13} /> {tgm('stop')}
          </button>
        ) : (
          <button
            className="btn primary"
            disabled={!ready}
            title={tgm('runHint')}
            onClick={() => start(null)}
          >
            <Icon name="play" size={13} /> {tgm('run')}
          </button>
        )}
        <button
          className="btn ghost"
          disabled={!ready}
          onClick={() =>
            void api()
              .games.openEditor(project.dir)
              .catch((e) => toast(tgm('error', { err: errText(e) })))
          }
        >
          {tgm('editor')}
        </button>
        <button
          className="btn ghost"
          disabled={!ready || busy !== null}
          onClick={() => void check()}
        >
          {busy === 'check' ? tgm('checking') : tgm('check')}
        </button>
        <button
          className="btn ghost"
          disabled={!ready || busy !== null}
          title={tgm('shotHint')}
          onClick={() => void capture()}
        >
          {busy === 'shot' ? (
            tgm('shooting')
          ) : (
            <>
              <Icon name="image" size={13} /> {tgm('shot')}
            </>
          )}
        </button>
      </div>
      <label className="gm-check">
        <input
          type="checkbox"
          checked={collisions}
          onChange={(e) => setCollisions(e.target.checked)}
        />
        {tgm('collisions')}
      </label>
      {checkMsg && (
        <div className={`gm-status ${checkProblems.length ? 'bad' : 'ok'}`}>{checkMsg}</div>
      )}
      {shot && (
        <button className="gm-shot" onClick={() => setShot(null)} title={tgm('clear')}>
          <img src={shot} alt={tgm('shot')} />
        </button>
      )}

      <button
        className="gm-toggle gm-subtitle"
        onClick={() => setShowScenes((v) => !v)}
        aria-expanded={showScenes}
      >
        <Icon name={showScenes ? 'chevronDown' : 'chevron'} size={12} />
        {tgm('scenes', { n: project.scenes.length })}
      </button>
      {showScenes && (
        <div className="gm-scenes">
          {project.scenes.map((s, i) => (
            <div className="gm-row gm-scene" key={s}>
              <button className="gm-link" title={s} onClick={() => void openFile(s)}>
                {s.slice(project.dir ? project.dir.length + 1 : 0)}
              </button>
              {i === 0 && info.mainScene && s.endsWith(info.mainScene.slice(6)) && (
                <span className="gm-tag">{tgm('mainScene')}</span>
              )}
              <div className="spacer" />
              <button
                className="icon-btn"
                disabled={!ready}
                title={tgm('runScene')}
                aria-label={tgm('runScene')}
                onClick={() => start(s)}
              >
                <Icon name="play" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="gm-subtitle">
        {tgm('output')}
        <span
          className={`gm-status ${running ? 'busy' : code === 0 ? 'ok' : code != null ? 'bad' : ''}`}
        >
          {running
            ? tgm('running')
            : code === null
              ? tgm('stoppedRun')
              : code !== undefined
                ? tgm('ended', { code })
                : ''}
        </span>
        <div className="spacer" />
        {(out || checkProblems.length > 0) && (
          <button
            className="btn ghost gm-small"
            onClick={() => {
              setRun({ out: '', code: undefined, dir: project.dir });
              setCheckProblems([]);
              setCheckMsg('');
            }}
          >
            {tgm('clear')}
          </button>
        )}
      </div>
      {problems.length > 0 && (
        <div className="gm-problems">
          <div className="gm-row">
            <span className="gm-dim">{tgm('problems', { n: problems.length })}</span>
            <div className="spacer" />
            {errors > 0 && (
              <button className="btn gm-small" onClick={fix}>
                <Icon name="message" size={13} /> {tgm('fix')}
              </button>
            )}
          </div>
          {problems.slice(0, 100).map((p, i) => {
            const rel = resToRel(p.file, project.dir);
            return (
              <button
                key={i}
                className={`gm-problem ${p.severity}`}
                disabled={!rel}
                onClick={() => openProblem(p)}
              >
                <Icon name={p.severity === 'error' ? 'x' : 'warning'} size={12} />
                <span className="gm-pmsg">
                  {p.message}
                  {p.count > 1 && <span className="gm-dim"> ×{p.count}</span>}
                </span>
                {rel && (
                  <span className="gm-ploc">
                    {rel.split('/').pop()}
                    {p.line ? `:${p.line}` : ''}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <pre className="gm-out" ref={pre}>
        {out || <span className="gm-dim">{tgm('noOutput')}</span>}
      </pre>

      <div className="gm-row gm-export">
        {project.presets.length ? (
          <>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              aria-label={tgm('export')}
            >
              {project.presets.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="btn ghost gm-small"
              disabled={!ready || busy !== null}
              title={tgm('exportHint')}
              onClick={() => void doExport()}
            >
              {busy === 'export' ? tgm('exporting') : tgm('export')}
            </button>
          </>
        ) : (
          <span className="gm-dim">{tgm('noPresets')}</span>
        )}
      </div>
      <div className="gm-dim">{tgm('debugHint')}</div>
    </div>
  );
}

/** New game from a template, in a new folder of the open folder. */
function NewGame({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (folder: string) => void;
}) {
  const [template, setTemplate] = useState<GameTemplate>('godot-platformer');
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const autoFolder =
    (name || 'mi-juego')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'mi-juego';
  const target = folder || autoFolder;

  const create = async () => {
    setBusy(true);
    try {
      const files = await api().games.create(target, template, name || target);
      toast(tgm('created', { dir: target }));
      const entry = files.find((f) => /\.(gd|js)$/.test(f) && !f.includes('/lib/')) ?? files[0];
      if (entry) void openFile(entry);
      onCreated(target);
    } catch (e) {
      toast(tgm('error', { err: errText(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gm-body">
      <div className="gm-subtitle">{tgm('newTitle')}</div>
      <div className="gm-templates" role="radiogroup" aria-label={tgm('template')}>
        {GAME_TEMPLATES.map((tp) => (
          <label key={tp.id} className={`gm-template ${template === tp.id ? 'on' : ''}`}>
            <input
              type="radio"
              name="gm-template"
              checked={template === tp.id}
              onChange={() => setTemplate(tp.id)}
            />
            <span className="gm-tname">{tgm(`tpl.${tp.id}` as KeyGames)}</span>
            <span className="gm-dim">{tgm(`tpl.${tp.id}.d` as KeyGames)}</span>
          </label>
        ))}
      </div>
      <label className="gm-field">
        <span>{tgm('gameName')}</span>
        <input
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="Mi juego"
        />
      </label>
      <label className="gm-field">
        <span>{tgm('folder')}</span>
        <input
          value={folder}
          maxLength={60}
          onChange={(e) => setFolder(e.target.value)}
          placeholder={autoFolder}
        />
      </label>
      <div className="gm-btns">
        <button className="btn" disabled={busy} onClick={() => void create()}>
          {busy ? tgm('creating') : tgm('create')}
        </button>
        <button className="btn ghost" disabled={busy} onClick={onCancel}>
          {tgm('cancel')}
        </button>
      </div>
    </div>
  );
}
