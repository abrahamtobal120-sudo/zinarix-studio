/**
 * Fase 14: "Generar con IA" — a 3D model from a description and/or a picture, made on
 * Replicate, added to the scene as an imported model when it arrives.
 */
import { useEffect, useRef, useState } from 'react';
import type { Gen3DModel } from '../../../shared/gen3d';
import { makeModel } from '../../../shared/scene3d';
import { api, toast } from '../../store';
import { commit, get3, set3 } from './store3d';
import { t3 } from './strings3d';

export function Gen3DDialog() {
  const [info, setInfo] = useState<{ connected: boolean; models: Gen3DModel[] } | null>(null);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reqId = useRef<string | null>(null);

  useEffect(() => {
    void api()
      .gen3d.info()
      .then((i) => {
        setInfo(i);
        setModel(i.models[0]?.id ?? '');
      })
      .catch(() => setInfo({ connected: false, models: [] }));
    // Closing the dialog stops a generation that is still running.
    return () => {
      if (reqId.current) void api().gen3d.abort(reqId.current);
    };
  }, []);

  const m = info?.models.find((x) => x.id === model);
  const needImage = !!m && !m.inputs.includes('text');
  const issue =
    !prompt.trim() && !image
      ? t3('genNeedPrompt')
      : needImage && !image
        ? t3('genNeedImage')
        : null;
  const close = () => set3({ genOpen: false });

  const run = async () => {
    const id = `g3d-${Date.now().toString(36)}`;
    reqId.current = id;
    setBusy(t3('genBusy'));
    const off = api().on((ev) => {
      if (ev.type !== 'gen3d' || ev.requestId !== id || ev.event.type !== 'progress') return;
      const pct = ev.event.percent;
      setBusy(`${t3('genBusy')}${pct !== undefined ? ` ${pct}%` : ''}`);
    });
    try {
      const r = await api().gen3d.generate(id, {
        model,
        ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
        ...(image ? { image } : {}),
      });
      const name = r.path.split(/[\\/]/).pop() ?? r.path;
      const node = makeModel(r.path, prompt.trim() ? { name: prompt.trim().slice(0, 60) } : {});
      const s = get3();
      commit({ ...s.scene, nodes: [...s.scene.nodes, node] }, t3('editAdd', { name: node.name }));
      set3({ selected: node.id, genOpen: false });
      toast(t3('genDone', { name }));
      for (const w of r.warnings) toast(w);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : String(e);
      setBusy(null);
      toast(t3('genFail', { msg }));
    } finally {
      reqId.current = null;
      off();
    }
  };

  return (
    <div className="s3-modal" role="dialog" aria-label={t3('genTitle')}>
      <div className="s3-card">
        <h3>{t3('genTitle')}</h3>
        {info && !info.connected ? (
          <p className="s3-hint">{t3('genNoModel')}</p>
        ) : (
          <>
            <label className="s3-field">
              <span>{t3('genModel')}</span>
              <select value={model} disabled={!!busy} onChange={(e) => setModel(e.target.value)}>
                {info?.models.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label} ({x.inputs.map((i) => t3(`in_${i}`)).join(' + ')})
                  </option>
                ))}
              </select>
            </label>
            <label className="s3-field">
              <span>{t3('genPrompt')}</span>
              <textarea
                rows={3}
                maxLength={1000}
                value={prompt}
                disabled={!!busy}
                placeholder={t3('genPromptPh')}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>
            <div className="s3-field">
              <span>{t3('genImage')}</span>
              <div className="s3-pickrow">
                <button
                  type="button"
                  className="s3-btn"
                  disabled={!!busy}
                  onClick={async () => setImage((await api().gen3d.pickImage()) ?? image)}
                >
                  {t3('genPickImage')}
                </button>
                <span className="s3-hint s3-ellipsis" title={image ?? ''}>
                  {image ? image.split(/[\\/]/).pop() : t3('genNoImage')}
                </span>
                {image && !busy && (
                  <button type="button" className="s3-link" onClick={() => setImage(null)}>
                    ×
                  </button>
                )}
              </div>
            </div>
            <p className="s3-hint">{t3('genCost')}</p>
            {busy && (
              <p className="s3-hint" role="status">
                {busy}
              </p>
            )}
          </>
        )}
        <div className="s3-actions">
          <button type="button" className="s3-btn" onClick={close}>
            {t3('cancel')}
          </button>
          {info?.connected && (
            <button
              type="button"
              className="s3-btn s3-primary"
              disabled={!!busy || !!issue || !model}
              title={issue ?? ''}
              onClick={() => void run()}
            >
              {t3('genRun')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
