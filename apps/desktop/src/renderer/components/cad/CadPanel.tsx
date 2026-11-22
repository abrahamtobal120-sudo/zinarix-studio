import { useCallback, useEffect, useState } from 'react';
import { openLink } from '../../links';
import { api, openFile, toast, useStore } from '../../store';
import { errText } from '../../errText';
import { lang } from '../../i18n';
import { askInChat } from '../Chat';
import { Icon } from '../Icon';
import { CAD_TEMPLATES, isMeshPath, type CadEnginesView } from '../../../shared/cad';
import { tc } from './cadStrings';
import { PrintersBox } from './Printers';
import './cad.css';

/** Fase 7 (plan de funciones): the CAD side panel (Más → CAD 3D). */
export function CadPanel() {
  const workspace = useStore((s) => s.workspace);
  const [engines, setEngines] = useState<CadEnginesView | null>(null);
  const [files, setFiles] = useState<{ scad: string[]; mesh: string[] }>({ scad: [], mesh: [] });
  const [tpl, setTpl] = useState(CAD_TEMPLATES[0]!.id);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setEngines(await api().cad.engines(refresh).catch(() => ({ native: null, builtin: false, blender: null })));
  }, []);

  const loadFiles = useCallback(async () => {
    if (!workspace) return setFiles({ scad: [], mesh: [] });
    const all = await api().workspace.listFiles().catch(() => [] as string[]);
    setFiles({ scad: all.filter((f) => /\.scad$/i.test(f)).slice(0, 200), mesh: all.filter((f) => isMeshPath(f) || /\.(gcode|gco)$/i.test(f)).slice(0, 200) });
  }, [workspace]);

  useEffect(() => void load(), [load]);
  useEffect(() => void loadFiles(), [loadFiles]);

  const template = CAD_TEMPLATES.find((t) => t.id === tpl)!;
  const label = (t: (typeof CAD_TEMPLATES)[number]) => (lang === 'en' ? t.en : t.es);

  const create = async () => {
    setBusy(true);
    try {
      const fileName = (name.trim() || `modelos/${tpl}`).replace(/\.scad$/i, '');
      const p = await api().cad.create(tpl, fileName);
      setName('');
      await loadFiles();
      await openFile(p);
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    const r = await api().cad.pickNative().catch(() => null);
    if (r) setEngines(r);
    else toast(tc('notScad'));
  };

  return (
    <div className="explorer cad-panel">
      <div className="sidebar-title">
        <span className="panel-title">{tc('title')}</span>
        <span className="sidebar-actions">
          <button title={tc('recheck')} aria-label={tc('recheck')} onClick={() => (void load(true), void loadFiles())}>
            <Icon name="refresh" size={15} />
          </button>
        </span>
      </div>
      <div className="cad-panel-body">
        {!engines ? (
          <p className="cad-hint">{tc('loading')}</p>
        ) : (
          <section className="cad-card">
            <div className={`cad-engine ${engines.native || engines.builtin ? 'ok' : 'bad'}`}>
              <Icon name="compass" />
              <span>
                {engines.native
                  ? tc(engines.native.manifold ? 'engineNativeFast' : 'engineNative', { v: engines.native.version })
                  : engines.builtin
                    ? tc('engineBuiltin')
                    : tc('engineNone')}
              </span>
            </div>
            {!engines.native && <p className="cad-hint">{tc('engineBuiltinHint')}</p>}
            <div className="cad-row-btns">
              {!engines.native && (
                <button className="btn ghost cad-small" onClick={() => openLink('https://openscad.org/downloads.html')}>
                  {tc('download')}
                </button>
              )}
              <button className="btn ghost cad-small" onClick={() => void pick()}>
                {tc('pick')}
              </button>
            </div>
            <p className="cad-hint">{engines.blender ? tc('blender', { v: engines.blender }) : tc('noBlender')}</p>
          </section>
        )}
        {!workspace ? (
          <p className="cad-hint">{tc('noFolder')}</p>
        ) : (
          <>
            <section className="cad-card">
              <h3 className="cad-h">{tc('newModel')}</h3>
              <label className="cad-field">
                <span>{tc('template')}</span>
                <select value={tpl} onChange={(e) => setTpl(e.target.value)}>
                  {CAD_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {label(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cad-field">
                <span>{tc('fileName')}</span>
                <input value={name} placeholder={`modelos/${template.id}.scad`} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
              </label>
              <div className="cad-row-btns">
                <button className="btn cad-small" disabled={busy} onClick={() => void create()}>
                  {tc('create')}
                </button>
                <button className="btn ghost cad-small" onClick={() => askInChat(tc('askAiPrompt'))}>
                  <Icon name="sparkle" size={13} /> {tc('askAi')}
                </button>
              </div>
              <p className="cad-hint">{tc('howTo')}</p>
            </section>
            <section className="cad-card">
              <h3 className="cad-h">{tc('models')}</h3>
              {files.scad.length ? (
                <ul className="cad-files">
                  {files.scad.map((f) => (
                    <li key={f}>
                      <button className="cad-file" title={f} onClick={() => void openFile(f)}>
                        <Icon name="compass" /> {f}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cad-hint">{tc('noModels')}</p>
              )}
            </section>
            {files.mesh.length > 0 && (
              <section className="cad-card">
                <h3 className="cad-h">{tc('meshes')}</h3>
                <ul className="cad-files">
                  {files.mesh.map((f) => (
                    <li key={f}>
                      <button className="cad-file" title={f} onClick={() => void openFile(f)}>
                        <Icon name={/\.(gcode|gco)$/i.test(f) ? 'layers' : 'cube'} /> {f}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        <PrintersBox />
      </div>
    </div>
  );
}
