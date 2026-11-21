import { useCallback, useEffect, useState } from 'react';
import { confirmDialog } from '../../confirm';
import { api, toast } from '../../store';
import { Icon } from '../Icon';
import { libName, type PioInstalledLibs, type PioLibrary, type PioProject } from '../../../shared/platformio';
import { th } from './hardwareStrings';

/**
 * Libraries of the chosen env (Fase 5A del plan de funciones): lib_deps of platformio.ini,
 * search in the PlatformIO registry and install / remove with `pio pkg` (it saves lib_deps,
 * so the AI and other editors see the same list).
 */

const errText = (e: unknown) =>
  String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function LibrariesBox({ project, env, onChanged }: { project: PioProject; env: string; onChanged: () => void }) {
  const [open, setOpen] = useState(() => localStorage.getItem('zs.hw.libsOpen') !== '0');
  const [libs, setLibs] = useState<PioInstalledLibs | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PioLibrary[] | null>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLibs(await api().pio.libraries(project.dir, env || null).catch(() => null));
  }, [project.dir, env]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const search = async (p = 1) => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = await api().pio.searchLibraries(query.trim(), p);
      setResults(r.libraries);
      setPages(r.pages);
      setPage(p);
    } catch (e) {
      toast(th('libSearchFail', { err: errText(e) }));
    } finally {
      setSearching(false);
    }
  };

  const change = async (spec: string, remove: boolean) => {
    if (remove && !(await confirmDialog(th('libRemoveAsk', { lib: libName(spec) }), { okLabel: th('libRemove'), danger: true })))
      return;
    setBusy(spec);
    try {
      await api().pio.changeLibrary(project.dir, env || null, spec, remove);
      toast(remove ? th('libRemoved', { lib: libName(spec) }) : th('libInstalled', { lib: libName(spec) }));
      await load();
      onChanged();
    } catch (e) {
      toast(th('error', { err: errText(e) }));
    } finally {
      setBusy(null);
    }
  };

  const has = (id: string) => !!libs?.deps.some((d) => libName(d).toLowerCase() === id.toLowerCase());

  return (
    <div className="hw-section hw-libs">
      <button
        className="hw-subtitle hw-fold"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          localStorage.setItem('zs.hw.libsOpen', open ? '0' : '1');
        }}
      >
        <Icon name={open ? 'chevronDown' : 'chevron'} size={12} />
        <Icon name="package" size={13} /> {th('libs')}
        {libs && <span className="hw-dim"> ({libs.deps.length})</span>}
      </button>
      {open && (
        <>
          {!libs ? (
            <div className="hw-dim">{th('loading')}</div>
          ) : !libs.deps.length ? (
            <div className="hw-hint">{th('libsNone')}</div>
          ) : (
            <ul className="hw-liblist">
              {libs.deps.map((d) => {
                const name = libName(d);
                const got = libs.installed.find((x) => name.toLowerCase().endsWith(x.name.toLowerCase()));
                return (
                  <li key={d}>
                    <span className="hw-libname" title={d}>
                      {name}
                    </span>
                    <span className="hw-dim">{got?.version ? `v${got.version}` : d.includes('@') ? d.slice(d.indexOf('@') + 1).trim() : ''}</span>
                    <button
                      className="icon-btn"
                      title={th('libRemove')}
                      aria-label={`${th('libRemove')} ${name}`}
                      disabled={!!busy}
                      onClick={() => void change(d, true)}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {libs && libs.installed.length > libs.deps.length && (
            <div className="hw-dim">{th('libsDeps', { n: libs.installed.length - libs.deps.length })}</div>
          )}
          <form
            className="hw-libsearch"
            onSubmit={(e) => {
              e.preventDefault();
              void search(1);
            }}
          >
            <input value={query} placeholder={th('libSearchPh')} aria-label={th('libSearchPh')} onChange={(e) => setQuery(e.target.value)} />
            <button className="btn hw-small" type="submit" disabled={searching || !query.trim()}>
              <Icon name="search" size={12} /> {th('libSearch')}
            </button>
          </form>
          {searching && <div className="hw-dim">{th('libSearching')}</div>}
          {results && !searching && (
            <div className="hw-libresults" role="list">
              {!results.length && <div className="hw-dim">{th('libNoResults')}</div>}
              {results.map((l) => {
                const spec = `${l.id}@^${l.version}`;
                const installed = has(l.id);
                return (
                  <div className="hw-libres" role="listitem" key={l.id}>
                    <div className="hw-librow">
                      <span className="hw-libname" title={l.id}>
                        {l.name}
                      </span>
                      <span className="hw-dim">
                        {l.owner} · v{l.version}
                      </span>
                      <div className="spacer" />
                      {installed ? (
                        <span className="hw-libok">{th('libHave')}</span>
                      ) : (
                        <button className="btn hw-small" disabled={!!busy} onClick={() => void change(spec, false)}>
                          {busy === spec ? th('libInstalling') : th('libInstall')}
                        </button>
                      )}
                    </div>
                    {l.description && <div className="hw-libdesc">{l.description}</div>}
                  </div>
                );
              })}
              {pages > 1 && (
                <div className="hw-row-btns">
                  <button className="btn ghost hw-small" disabled={page <= 1} onClick={() => void search(page - 1)}>
                    ‹
                  </button>
                  <span className="hw-dim">{th('libPage', { page, pages })}</span>
                  <button className="btn ghost hw-small" disabled={page >= pages} onClick={() => void search(page + 1)}>
                    ›
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
