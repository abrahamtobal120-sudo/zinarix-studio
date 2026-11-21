import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { confirmDialog } from '../../confirm';
import { openLink } from '../../links';
import { api, toast, useStore } from '../../store';
import { Icon } from '../Icon';
import { runInTerminal } from '../Terminal';
import { AnsiText } from '../notebook/Ansi';
import type {
  DockerContainer,
  DockerDetails,
  DockerDiskRow,
  DockerImage,
  DockerJob,
  DockerNetwork,
  DockerPrune,
  DockerRunSpec,
  DockerStats,
  DockerStatus,
  DockerVolume,
} from '../../../shared/docker';
import { hostMounts, secretKey } from '../../../shared/docker';
import { tk, type KeyDk } from './dockerStrings';
import './docker.css';

/**
 * Docker panel (Fase 2B del plan de funciones): containers grouped by compose project with
 * start / stop / restart / delete, CPU and memory, details, live logs and a terminal inside;
 * images (pull, build from the project's Dockerfiles, create a container), volumes, networks,
 * the compose files of the open folder and the disk Docker uses (with clean-up). Everything
 * goes through the docker CLI in main.
 */

type Tab = 'containers' | 'images' | 'volumes' | 'networks' | 'compose' | 'disk';

type View =
  | { kind: 'list' }
  | { kind: 'logs'; name: string }
  | { kind: 'details'; name: string }
  | { kind: 'run'; image: string }
  | { kind: 'job'; title: string; job: DockerJob };

type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;

const errText = (e: unknown) =>
  String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function DockerPanel() {
  const [status, setStatus] = useState<DockerStatus | null>(null);
  const [tab, setTab] = useState<Tab>('containers');
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [stats, setStats] = useState<Map<string, DockerStats>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [starting, setStarting] = useState(false);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    const st = await api().docker.status().catch((): DockerStatus => ({ state: 'missing' }));
    setStatus(st);
    if (st.state !== 'running') return;
    setStarting(false);
    const [c, i, v, n] = await Promise.all([
      api().docker.containers().catch(() => []),
      api().docker.images().catch(() => []),
      api().docker.volumes().catch(() => []),
      api().docker.networks().catch(() => []),
    ]);
    setContainers(c);
    setImages(i);
    setVolumes(v);
    setNetworks(n);
  }, []);

  // Every 5 s while running (state changes from outside: compose, the terminal, the AI);
  // every 3 s while waiting for Docker Desktop to start.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, starting ? 3000 : 5000);
    return () => clearInterval(timer);
  }, [refresh, starting]);

  // CPU / memory of the running containers while their list is in view (docker stats takes
  // ~2 s, so one at a time, never piling up).
  const anyRunning = containers.some((c) => c.state === 'running');
  const showingList = view.kind === 'list' && tab === 'containers';
  useEffect(() => {
    if (status?.state !== 'running' || !anyRunning || !showingList) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        const list = await api().docker.stats().catch(() => null);
        if (!alive) return;
        if (list) setStats(new Map(list.map((s) => [s.name, s])));
      }
      if (alive) timer = setTimeout(() => void tick(), 4000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [status?.state, anyRunning, showingList]);

  const act: Act = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
      toast(tk('done', { what: label }));
    } catch (e) {
      toast(tk('failed', { err: errText(e) }));
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const back = () => {
    setView({ kind: 'list' });
    void refresh();
  };
  if (view.kind === 'logs') return <LogsView container={view.name} onBack={back} />;
  if (view.kind === 'details')
    return <DetailsView name={view.name} onBack={back} onLogs={() => setView({ kind: 'logs', name: view.name })} />;
  if (view.kind === 'run') return <RunView image={view.image} onBack={back} />;
  if (view.kind === 'job') return <JobView title={view.title} job={view.job} onBack={back} />;

  const q = query.trim().toLowerCase();
  const has = (...xs: string[]) => !q || xs.some((x) => x.toLowerCase().includes(q));
  const searchable = tab === 'containers' || tab === 'images' || tab === 'volumes';
  const cs = containers.filter((c) => has(c.name, c.image, c.project ?? '', c.ports));
  const is = images.filter((i) => has(i.repository, i.tag, i.id));
  const vs = volumes.filter((v) => has(v.name));

  return (
    <div className="explorer docker-panel">
      <div className="sidebar-title">
        <span className="panel-title">
          DOCKER
          {status?.state === 'running' && <span className="dk-version">{tk('version', { v: status.server })}</span>}
        </span>
        <span className="sidebar-actions">
          <button title={tk('refresh')} aria-label={tk('refresh')} onClick={() => void refresh()}>
            <Icon name="refresh" size={15} />
          </button>
        </span>
      </div>
      {!status ? (
        <div className="dk-empty">{tk('loading')}</div>
      ) : status.state === 'missing' ? (
        <div className="dk-empty">
          <p>{tk('missing')}</p>
          <button className="btn" onClick={() => openLink('https://www.docker.com/products/docker-desktop/')}>
            {tk('getDocker')}
          </button>
        </div>
      ) : status.state === 'stopped' ? (
        <div className="dk-empty">
          <p>{tk(starting ? 'starting' : 'stopped')}</p>
          {status.canStart && !starting && (
            <button
              className="btn"
              onClick={() =>
                void api()
                  .docker.startDesktop()
                  .then(() => setStarting(true))
                  .catch((e) => toast(errText(e)))
              }
            >
              {tk('startDesktop')}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="dk-tabs" role="tablist">
            {(['containers', 'images', 'volumes', 'networks', 'compose', 'disk'] as Tab[]).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                className={`dk-tab ${tab === k ? 'on' : ''}`}
                onClick={() => setTab(k)}
              >
                {tk(k)}
                {k === 'containers' && containers.length ? (
                  <span className="dk-count">
                    {containers.filter((c) => c.state === 'running').length}/{containers.length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {searchable && (
            <div className="dk-search">
              <Icon name="search" size={13} />
              <input
                value={query}
                placeholder={tk('search')}
                aria-label={tk('search')}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              />
            </div>
          )}
          {busy && <div className="dk-busy">{tk('working')} {busy}</div>}
          <div className="dk-body">
            {tab === 'containers' &&
              (containers.length && !cs.length ? (
                <div className="dk-empty">{tk('noMatch')}</div>
              ) : (
                <Containers
                  list={cs}
                  stats={stats}
                  act={act}
                  onLogs={(name) => setView({ kind: 'logs', name })}
                  onDetails={(name) => setView({ kind: 'details', name })}
                  disabled={!!busy}
                />
              ))}
            {tab === 'images' && (
              <Images
                list={is}
                total={images.length}
                act={act}
                disabled={!!busy}
                onRun={(image) => setView({ kind: 'run', image })}
                onJob={(title, job) => setView({ kind: 'job', title, job })}
              />
            )}
            {tab === 'volumes' &&
              (vs.length ? (
                vs.map((v) => (
                  <div className="dk-row" key={v.name}>
                    <Icon name="database" size={14} />
                    <div className="dk-main">
                      <div className="dk-name" title={v.name}>{v.name}</div>
                      <div className="dk-sub">{v.driver}</div>
                    </div>
                    <RowBtn
                      icon="trash"
                      label={tk('remove')}
                      disabled={!!busy}
                      onClick={async () => {
                        if (await confirmDialog(tk('confirmVolume', { name: v.name }), { danger: true }))
                          await act(`${tk('remove')} ${v.name}`, () => api().docker.action('volume-rm', v.name));
                      }}
                    />
                  </div>
                ))
              ) : (
                <div className="dk-empty">{tk(volumes.length ? 'noMatch' : 'noVolumes')}</div>
              ))}
            {tab === 'networks' &&
              networks.map((n) => (
                <div className="dk-row" key={n.id}>
                  <Icon name="link" size={14} />
                  <div className="dk-main">
                    <div className="dk-name">{n.name}</div>
                    <div className="dk-sub">
                      {n.driver} · {n.scope}
                    </div>
                  </div>
                </div>
              ))}
            {tab === 'compose' && <Compose act={act} disabled={!!busy} />}
            {tab === 'disk' && <Disk act={act} disabled={!!busy} />}
          </div>
        </>
      )}
    </div>
  );
}

function RowBtn({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="icon-btn dk-btn" title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={14} />
    </button>
  );
}

/** "0.0.0.0:8080->80/tcp, [::]:8080->80/tcp" → [8080]. */
function hostPorts(ports: string): number[] {
  const out = new Set<number>();
  for (const m of ports.matchAll(/:(\d+)->\d+\/tcp/g)) out.add(Number(m[1]));
  return [...out];
}

/** "24.5MiB / 7.6GiB" → "24.5MiB". */
const memUsed = (mem: string) => mem.split('/')[0]?.trim() ?? mem;

function Containers({
  list,
  stats,
  act,
  onLogs,
  onDetails,
  disabled,
}: {
  list: DockerContainer[];
  stats: Map<string, DockerStats>;
  act: Act;
  onLogs: (name: string) => void;
  onDetails: (name: string) => void;
  disabled: boolean;
}) {
  if (!list.length) return <div className="dk-empty">{tk('noContainers')}</div>;
  const groups = new Map<string, DockerContainer[]>();
  for (const c of list) {
    const k = c.project ?? '';
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const keys = [...groups.keys()].sort((a, b) => (a ? (b ? a.localeCompare(b) : -1) : 1));
  const action = (c: DockerContainer, a: 'start' | 'stop' | 'restart' | 'pause' | 'unpause', key: KeyDk) =>
    act(`${tk(key)} ${c.name}`, () => api().docker.action(a, c.name));
  return (
    <>
      {keys.map((k) => (
        <div key={k || '-'} className="dk-group">
          {(keys.length > 1 || k) && (
            <div className="dk-group-title">
              <Icon name="layers" size={12} /> {k || tk('noProject')}
            </div>
          )}
          {groups.get(k)!.map((c) => {
            const running = c.state === 'running';
            const paused = c.state === 'paused';
            const st = running ? stats.get(c.name) : undefined;
            const cpu = st ? Number.parseFloat(st.cpu) : NaN;
            return (
              <div className="dk-row" key={c.id}>
                <span className={`dk-dot dk-${c.state}`} title={c.state} />
                <div className="dk-main">
                  <button className="dk-name dk-link" title={`${tk('details')}: ${c.name} (${c.id})`} onClick={() => onDetails(c.name)}>
                    {c.name}
                  </button>
                  <div className="dk-sub" title={c.command}>
                    {c.image} · {c.status}
                  </div>
                  {st && (
                    <div className="dk-stats" title={`${st.mem} · net ${st.net} · disk ${st.block}`}>
                      <span className="dk-meter" aria-hidden>
                        <span style={{ width: `${Math.min(100, Number.isFinite(cpu) ? cpu : 0)}%` }} />
                      </span>
                      {tk('cpu')} {st.cpu} · {tk('mem')} {memUsed(st.mem)}
                    </div>
                  )}
                  {hostPorts(c.ports).length > 0 && (
                    <div className="dk-ports">
                      {hostPorts(c.ports).map((p) => (
                        <button
                          key={p}
                          className="dk-port"
                          title={tk('openPort')}
                          onClick={() => openLink(`http://localhost:${p}`)}
                        >
                          :{p}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="dk-actions">
                  {running ? (
                    <RowBtn icon="stop" label={tk('stop')} disabled={disabled} onClick={() => void action(c, 'stop', 'stop')} />
                  ) : paused ? (
                    <RowBtn icon="play" label={tk('unpause')} disabled={disabled} onClick={() => void action(c, 'unpause', 'unpause')} />
                  ) : (
                    <RowBtn icon="play" label={tk('start')} disabled={disabled} onClick={() => void action(c, 'start', 'start')} />
                  )}
                  <RowBtn icon="refresh" label={tk('restart')} disabled={disabled} onClick={() => void action(c, 'restart', 'restart')} />
                  <RowBtn icon="scroll" label={tk('logs')} onClick={() => onLogs(c.name)} />
                  {running && (
                    <RowBtn
                      icon="terminal"
                      label={tk('terminal')}
                      onClick={() => void runInTerminal(`docker exec -it ${c.name} sh`)}
                    />
                  )}
                  <RowBtn
                    icon="trash"
                    label={tk('remove')}
                    disabled={disabled}
                    onClick={async () => {
                      if (await confirmDialog(tk('confirmRm', { name: c.name }), { danger: true }))
                        await act(`${tk('remove')} ${c.name}`, () => api().docker.action('rm', c.name));
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ images

function Images({
  list,
  total,
  act,
  disabled,
  onRun,
  onJob,
}: {
  list: DockerImage[];
  total: number;
  act: Act;
  disabled: boolean;
  onRun: (image: string) => void;
  onJob: (title: string, job: DockerJob) => void;
}) {
  const [pull, setPull] = useState('');
  const root = useStore((s) => s.workspace?.root);
  const fsVersion = useStore((s) => s.fsVersion);
  const [files, setFiles] = useState<string[]>([]);
  const [file, setFile] = useState('');
  const [tag, setTag] = useState('');
  useEffect(() => {
    if (!root) return setFiles([]);
    void api()
      .docker.dockerfiles()
      .then((f) => {
        setFiles(f);
        setFile((cur) => (f.includes(cur) ? cur : (f[0] ?? '')));
      })
      .catch(() => setFiles([]));
  }, [root, fsVersion]);
  // A sensible default tag: the folder's name.
  useEffect(() => {
    if (tag || !root) return;
    const base = root.split(/[\\/]/).pop() ?? 'app';
    setTag(`${base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '') || 'app'}:dev`);
  }, [root, tag]);
  const doPull = () => {
    const image = pull.trim();
    if (!image) return;
    onJob(`${tk('pull1')} ${image}`, { kind: 'pull', image });
  };
  return (
    <>
      <div className="dk-form-row">
        <input
          value={pull}
          placeholder={tk('pullPlaceholder')}
          aria-label={tk('pullImage')}
          onChange={(e) => setPull(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doPull()}
        />
        <button className="btn" disabled={!pull.trim()} onClick={doPull}>
          <Icon name="download" size={12} /> {tk('pull1')}
        </button>
      </div>
      {root && files.length > 0 && (
        <details className="dk-build">
          <summary>{tk('build')}</summary>
          <div className="dk-build-body">
            <select value={file} aria-label="Dockerfile" onChange={(e) => setFile(e.target.value)}>
              {files.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <input value={tag} aria-label={tk('buildTag')} title={tk('buildTag')} onChange={(e) => setTag(e.target.value)} />
            <button
              className="btn"
              disabled={!file || !tag.trim()}
              onClick={() => onJob(`${tk('build1')} ${tag.trim()}`, { kind: 'build', dockerfile: file, tag: tag.trim() })}
            >
              <Icon name="package" size={12} /> {tk('build1')}
            </button>
          </div>
        </details>
      )}
      {!list.length ? (
        <div className="dk-empty">{tk(total ? 'noMatch' : 'noImages')}</div>
      ) : (
        list.map((i) => {
          const ref = i.repository === '<none>' ? i.id : `${i.repository}:${i.tag}`;
          return (
            <div className="dk-row" key={i.id + ref}>
              <Icon name="package" size={14} />
              <div className="dk-main">
                <div className="dk-name">{ref}</div>
                <div className="dk-sub">
                  {i.size} · {i.created}
                </div>
              </div>
              <div className="dk-actions">
                {i.repository !== '<none>' && (
                  <RowBtn icon="play" label={tk('runImage')} onClick={() => onRun(ref)} />
                )}
                <RowBtn
                  icon="trash"
                  label={tk('remove')}
                  disabled={disabled}
                  onClick={async () => {
                    if (await confirmDialog(tk('confirmRmi', { name: ref }), { danger: true }))
                      await act(`${tk('remove')} ${ref}`, () => api().docker.action('rmi', ref));
                  }}
                />
              </div>
            </div>
          );
        })
      )}
    </>
  );
}

/** Form of `docker run -d` for an image; main checks every value again. */
function RunView({ image, onBack }: { image: string; onBack: () => void }) {
  const [name, setName] = useState('');
  const [ports, setPorts] = useState('');
  const [env, setEnv] = useState('');
  const [vols, setVols] = useState('');
  const [restart, setRestart] = useState<NonNullable<DockerRunSpec['restart']>>('no');
  const [rm, setRm] = useState(false);
  const [command, setCommand] = useState('');
  const [working, setWorking] = useState(false);
  const split = (s: string, by: RegExp) =>
    s
      .split(by)
      .map((x) => x.trim())
      .filter(Boolean);
  const volumes = split(vols, /\r?\n/);
  const mounts = hostMounts(volumes);
  const start = async () => {
    const spec: DockerRunSpec = {
      image,
      ...(name.trim() ? { name: name.trim() } : {}),
      ports: split(ports, /[,\s]+/),
      env: split(env, /\r?\n/),
      volumes,
      ...(restart !== 'no' ? { restart } : {}),
      ...(rm ? { rm: true } : {}),
      ...(command.trim() ? { command: split(command, /\s+/) } : {}),
    };
    setWorking(true);
    try {
      const id = await api().docker.run(spec);
      toast(tk('rStarted', { id: id.slice(0, 12) }));
      onBack();
    } catch (e) {
      toast(tk('failed', { err: errText(e) }));
    } finally {
      setWorking(false);
    }
  };
  return (
    <SubView title={tk('runTitle', { image })} onBack={onBack}>
      <div className="dk-form">
        <label>
          {tk('rName')}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="mi-servicio" />
        </label>
        <label>
          {tk('rPorts')}
          <input value={ports} onChange={(e) => setPorts(e.target.value)} placeholder={tk('rPortsPh')} />
        </label>
        <label>
          {tk('rEnv')}
          <textarea rows={3} value={env} onChange={(e) => setEnv(e.target.value)} placeholder="POSTGRES_PASSWORD=dev" spellCheck={false} />
        </label>
        <label>
          {tk('rVolumes')}
          <textarea rows={2} value={vols} onChange={(e) => setVols(e.target.value)} placeholder="datos:/var/lib/data" spellCheck={false} />
        </label>
        {mounts.length > 0 && <div className="dk-warn">{tk('rHostWarn', { list: mounts.join(', ') })}</div>}
        <label>
          {tk('rCommand')}
          <input value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} />
        </label>
        <label className="dk-inline">
          {tk('rRestart')}
          <select value={restart} onChange={(e) => setRestart(e.target.value as typeof restart)}>
            {(['no', 'always', 'unless-stopped', 'on-failure'] as const).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="dk-inline">
          <input type="checkbox" checked={rm} onChange={(e) => setRm(e.target.checked)} /> {tk('rRm')}
        </label>
        <div className="dk-form-btns">
          <button className="btn" disabled={working} onClick={() => void start()}>
            <Icon name="play" size={12} /> {working ? tk('working') : tk('rStart')}
          </button>
          <button className="btn ghost" onClick={onBack}>
            {tk('rCancel')}
          </button>
        </div>
      </div>
    </SubView>
  );
}

// ------------------------------------------------------------------ details

function DetailsView({ name, onBack, onLogs }: { name: string; onBack: () => void; onLogs: () => void }) {
  const [d, setD] = useState<DockerDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void api()
        .docker.inspect(name)
        .then((x) => alive && (setD(x), setError(null)))
        .catch((e) => alive && setError(errText(e)));
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [name]);
  const row = (label: string, value: ReactNode) => (
    <div className="dk-kv">
      <span className="dk-k">{label}</span>
      <span className="dk-v">{value}</span>
    </div>
  );
  const none = <span className="dk-dim">{tk('dNone')}</span>;
  return (
    <SubView
      title={tk('detailsOf', { name })}
      onBack={onBack}
      extra={
        <>
          <button className="icon-btn" title={tk('logs')} aria-label={tk('logs')} onClick={onLogs}>
            <Icon name="scroll" size={15} />
          </button>
          {d?.state === 'running' && (
            <button
              className="icon-btn"
              title={tk('terminal')}
              aria-label={tk('terminal')}
              onClick={() => void runInTerminal(`docker exec -it ${name} sh`)}
            >
              <Icon name="terminal" size={15} />
            </button>
          )}
        </>
      }
    >
      {error && !d ? (
        <div className="dk-empty">{tk('failed', { err: error })}</div>
      ) : !d ? (
        <div className="dk-empty">{tk('loading')}</div>
      ) : (
        <div className="dk-details">
          {row(tk('dImage'), d.image)}
          {row(
            tk('dState'),
            <>
              <span className={`dk-dot dk-${d.state}`} /> {d.state}
              {d.state !== 'running' && d.exitCode != null ? ` · ${tk('dExit')} ${d.exitCode}` : ''}
            </>,
          )}
          {d.health && row(tk('dHealth'), <span className={`dk-health dk-h-${d.health}`}>{d.health}</span>)}
          {d.startedAt && !d.startedAt.startsWith('0001') && row(tk('dStarted'), new Date(d.startedAt).toLocaleString())}
          {row(tk('dCommand'), d.command ? <code>{d.command}</code> : none)}
          {d.workdir && row(tk('dWorkdir'), <code>{d.workdir}</code>)}
          {row(tk('dRestart'), d.restart)}
          {d.project && row(tk('dCompose'), `${d.project}${d.service ? ` / ${d.service}` : ''}`)}
          <h4>{tk('dPorts')}</h4>
          {d.ports.length
            ? d.ports.map((p) => {
                const host = /(\d+)$/.exec(p.host)?.[1];
                return (
                  <div className="dk-kv" key={p.container + p.host}>
                    <span className="dk-v">
                      {p.host ? (
                        <button className="dk-port" title={tk('openPort')} onClick={() => openLink(`http://localhost:${host}`)}>
                          {p.host}
                        </button>
                      ) : (
                        <span className="dk-dim">—</span>
                      )}{' '}
                      → {p.container}
                    </span>
                  </div>
                );
              })
            : none}
          <h4>{tk('dMounts')}</h4>
          {d.mounts.length
            ? d.mounts.map((m) => (
                <div className="dk-kv" key={m.destination}>
                  <span className="dk-v">
                    <span className="dk-dim">{m.type}</span> <code title={m.source}>{m.source}</code> → <code>{m.destination}</code>
                    {!m.rw && <span className="dk-dim"> ({tk('readOnly')})</span>}
                  </span>
                </div>
              ))
            : none}
          <h4>{tk('dNetworks')}</h4>
          {d.networks.length
            ? d.networks.map((n) => row(n.name, n.ip ? <code>{n.ip}</code> : none))
            : none}
          <h4>
            {tk('dEnv')}
            {d.env.some((e) => secretKey(e.key)) && (
              <button className="dk-mini-btn" onClick={() => setReveal((r) => !r)}>
                {reveal ? tk('hideValues') : tk('showValues')}
              </button>
            )}
          </h4>
          {d.env.length
            ? d.env.map((e) => (
                <div className="dk-kv dk-env" key={e.key}>
                  <span className="dk-k" title={e.key}>{e.key}</span>
                  <span className="dk-v">
                    <code>{reveal || !secretKey(e.key) ? e.value : '••••••'}</code>
                  </span>
                </div>
              ))
            : none}
        </div>
      )}
    </SubView>
  );
}

// ------------------------------------------------------------------ disk

const DISK_KEY: Record<string, KeyDk> = {
  Images: 'diskTypeImages',
  Containers: 'diskTypeContainers',
  'Local Volumes': 'diskTypeVolumes',
  'Build Cache': 'diskTypeBuild',
};

function Disk({ act, disabled }: { act: Act; disabled: boolean }) {
  const [rows, setRows] = useState<DockerDiskRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    void api()
      .docker.diskUsage()
      .then((r) => (setRows(r), setError(null)))
      .catch((e) => setError(errText(e)));
  }, []);
  useEffect(load, [load]);
  const prune = async (kind: DockerPrune, key: KeyDk) => {
    const what = tk(key).toLowerCase();
    const ok = await confirmDialog(kind === 'volumes' ? tk('pruneAskVolumes') : tk('pruneAsk', { what }), {
      danger: true,
    });
    if (!ok) return;
    await act(`${tk('pruneTitle')}: ${what}`, async () => {
      const out = await api().docker.prune(kind);
      const freed = /reclaimed space:\s*(.+)$/im.exec(out)?.[1];
      if (freed) toast(`${tk('pruned')} · ${freed}`);
    });
    load();
  };
  return (
    <div className="dk-disk">
      <div className="dk-section-title">{tk('diskTitle')}</div>
      {error ? (
        <div className="dk-empty">{tk('failed', { err: error })}</div>
      ) : !rows ? (
        <div className="dk-empty">{tk('loading')}</div>
      ) : (
        <table className="dk-table">
          <thead>
            <tr>
              <th>{tk('dType')}</th>
              <th>{tk('dTotal')}</th>
              <th>{tk('dSize')}</th>
              <th>{tk('dReclaim')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.type}>
                <td>{DISK_KEY[r.type] ? tk(DISK_KEY[r.type]!) : r.type}</td>
                <td title={`${tk('dActive')}: ${r.active}`}>
                  {r.total} <span className="dk-dim">({r.active})</span>
                </td>
                <td>{r.size}</td>
                <td>{r.reclaimable}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="dk-section-title">{tk('pruneTitle')}</div>
      <div className="dk-prune">
        {(
          [
            ['containers', 'pruneContainers'],
            ['images', 'pruneImages'],
            ['build', 'pruneBuild'],
            ['volumes', 'pruneVolumes'],
          ] as [DockerPrune, KeyDk][]
        ).map(([kind, key]) => (
          <button key={kind} className={`btn ${kind === 'volumes' ? 'danger' : 'ghost'}`} disabled={disabled} onClick={() => void prune(kind, key)}>
            <Icon name="trash" size={12} /> {tk(key)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ compose

function Compose({ act, disabled }: { act: Act; disabled: boolean }) {
  const root = useStore((s) => s.workspace?.root);
  const fsVersion = useStore((s) => s.fsVersion);
  const [files, setFiles] = useState<string[] | null>(null);
  const [output, setOutput] = useState('');
  useEffect(() => {
    if (!root) return setFiles(null);
    void api().docker.composeFiles().then(setFiles).catch(() => setFiles([]));
  }, [root, fsVersion]);
  if (!root) return <div className="dk-empty">{tk('noFolder')}</div>;
  if (!files) return <div className="dk-empty">{tk('loading')}</div>;
  if (!files.length) return <div className="dk-empty">{tk('noCompose')}</div>;
  const run = (file: string, action: 'up' | 'down' | 'restart' | 'pull' | 'ps', key: KeyDk) =>
    act(`${tk(key)} ${file}`, async () => {
      setOutput('');
      const out = await api().docker.compose(file, action).catch((e) => {
        setOutput(errText(e));
        throw e;
      });
      setOutput(out);
    });
  return (
    <>
      {files.map((f) => (
        <div className="dk-compose" key={f}>
          <div className="dk-name">
            <Icon name="file" size={13} /> {f}
          </div>
          <div className="dk-compose-btns">
            <button className="btn" disabled={disabled} onClick={() => void run(f, 'up', 'up')}>
              <Icon name="play" size={12} /> {tk('up')}
            </button>
            <button
              className="btn ghost"
              disabled={disabled}
              onClick={async () => {
                if (await confirmDialog(tk('confirmDown', { file: f }), { danger: true })) await run(f, 'down', 'down');
              }}
            >
              <Icon name="stop" size={12} /> {tk('down')}
            </button>
            <button className="btn ghost" disabled={disabled} onClick={() => void run(f, 'restart', 'restart')}>
              {tk('restart')}
            </button>
            <button className="btn ghost" disabled={disabled} onClick={() => void run(f, 'pull', 'pull')}>
              {tk('pull')}
            </button>
          </div>
        </div>
      ))}
      {output && (
        <pre className="dk-output">
          <AnsiText text={output} />
        </pre>
      )}
    </>
  );
}

// ------------------------------------------------------------------ streamed views

function SubView({
  title,
  onBack,
  extra,
  children,
}: {
  title: string;
  onBack: () => void;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="explorer docker-panel">
      <div className="sidebar-title">
        <button className="icon-btn" title={tk('back')} aria-label={tk('back')} onClick={onBack}>
          <Icon name="back" size={15} />
        </button>
        <span className="panel-title dk-logs-title" title={title}>
          {title}
        </span>
        <div className="spacer" />
        {extra}
      </div>
      <div className="dk-body">{children}</div>
    </div>
  );
}

const MAX_LOG = 400_000;
let logSeq = 0;

/** Text streamed from main under a key ("logs" chunks), kept to the last 400 KB. */
function useStream(start: (key: string) => Promise<void>, deps: unknown[]) {
  const [text, setText] = useState('');
  const [end, setEnd] = useState<null | { ok: boolean | null }>(null);
  const keyRef = useRef('');
  useEffect(() => {
    const key = `logs-${++logSeq}`;
    keyRef.current = key;
    setText('');
    setEnd(null);
    const off = api().on((ev) => {
      if (ev.type !== 'docker' || ev.event.key !== key) return;
      const e = ev.event;
      if (e.kind === 'logs') {
        const chunk = e.chunk;
        setText((t) => {
          const next = t + chunk;
          return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
        });
      } else setEnd({ ok: e.kind === 'job-end' ? e.ok : null });
    });
    void start(key).catch((e) => {
      setText((t) => `${t}${errText(e)}\n`);
      setEnd({ ok: false });
    });
    return () => {
      off();
      void api().docker.stopLogs(key).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { text, setText, end, key: keyRef };
}

function StreamPre({ text, follow, setFollow, tail }: { text: string; follow: boolean; setFollow: (f: boolean) => void; tail?: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (follow && pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [text, follow]);
  return (
    <pre
      className="dk-logs"
      ref={pre}
      onWheel={(e) => {
        if (e.deltaY < 0) setFollow(false);
      }}
    >
      <AnsiText text={text} />
      {tail}
    </pre>
  );
}

/** Live log of a container (docker logs -f), with "follow the end". */
function LogsView({ container, onBack }: { container: string; onBack: () => void }) {
  const [follow, setFollow] = useState(true);
  const { text, setText, end } = useStream((key) => api().docker.followLogs(key, container), [container]);
  return (
    <div className="explorer docker-panel">
      <div className="sidebar-title">
        <button className="icon-btn" title={tk('back')} aria-label={tk('back')} onClick={onBack}>
          <Icon name="back" size={15} />
        </button>
        <span className="panel-title dk-logs-title" title={container}>
          {tk('logs')} · {container}
        </span>
        <div className="spacer" />
        <button
          className="icon-btn"
          title={tk('logsTerminal')}
          aria-label={tk('logsTerminal')}
          onClick={() => void runInTerminal(`docker logs -f --tail 200 ${container}`)}
        >
          <Icon name="terminal" size={15} />
        </button>
        <button className="icon-btn" title={tk('clear')} aria-label={tk('clear')} onClick={() => setText('')}>
          <Icon name="trash" size={15} />
        </button>
      </div>
      <label className="dk-follow">
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> {tk('follow')}
      </label>
      <StreamPre text={text} follow={follow} setFollow={setFollow} tail={end && `\n${tk('logsEnded')}`} />
    </div>
  );
}

/** A pull or build streamed live, with how it ended. */
function JobView({ title, job, onBack }: { title: string; job: DockerJob; onBack: () => void }) {
  const [follow, setFollow] = useState(true);
  const { text, end, key } = useStream((k) => api().docker.startJob(k, job), [JSON.stringify(job)]);
  return (
    <SubView
      title={title}
      onBack={onBack}
      extra={
        !end && (
          <button className="btn ghost dk-stop" onClick={() => void api().docker.stopLogs(key.current)}>
            <Icon name="stop" size={12} /> {tk('stopJob')}
          </button>
        )
      }
    >
      <div className={`dk-job-state ${end ? (end.ok ? 'ok' : 'bad') : ''}`} role="status">
        {!end ? tk('jobRunning') : end.ok ? tk('jobOk') : tk('jobFailed')}
      </div>
      <StreamPre text={text} follow={follow} setFollow={setFollow} />
    </SubView>
  );
}
