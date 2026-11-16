/**
 * Fase 14: the "3D" tab of Video Studio. One click: a turning logo or object rendered with a
 * transparent background and laid over the video at the playhead. "Edit in 3D" opens the editor
 * with that scene.
 */
import { useState } from 'react';
import { fromTemplate, sanitizeScene, TEMPLATES, type TemplateId } from '../../../shared/scene3d';
import { getV } from '../video/videoStore';
import { render3d } from './actions3d';
import { loadScene, open3d, use3 } from './store3d';
import { t3, type Key3D } from './strings3d';
import './studio3d.css';

export function Panel3D() {
  const [template, setTemplate] = useState<TemplateId>('logo');
  const [text, setText] = useState('Zinarix');
  const [color, setColor] = useState('#38a8ff');
  const [metal, setMetal] = useState(0.85);
  const [duration, setDuration] = useState(4);
  const busy = use3((s) => !!s.render);
  const progress = use3((s) => s.render?.label);
  const cancel = use3((s) => s.render?.cancel);
  const scene = () => {
    const p = getV().project;
    // The project size may be odd or above 4K: sanitize makes it even and within limits.
    return sanitizeScene(
      fromTemplate(template, {
        text,
        color,
        metal,
        duration,
        transparent: true,
        width: p.width,
        height: p.height,
        fps: Math.min(60, Math.max(12, Math.round(p.fps))),
      }),
    );
  };
  return (
    <div className="s3-panel">
      <h3>{t3('quickTitle')}</h3>
      <p className="s3-hint">{t3('quickHint')}</p>
      <label className="s3-field">
        <span>{t3('templates')}</span>
        <select value={template} onChange={(e) => setTemplate(e.target.value as TemplateId)}>
          {TEMPLATES.map((id) => (
            <option key={id} value={id}>
              {t3(`t_${id}` as Key3D)}
            </option>
          ))}
        </select>
      </label>
      {template === 'logo' && (
        <label className="s3-field">
          <span>{t3('quickText')}</span>
          <input value={text} maxLength={60} onChange={(e) => setText(e.target.value)} />
        </label>
      )}
      <label className="s3-field">
        <span>{t3('quickColor')}</span>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      <label className="s3-field">
        <span>{t3('quickMetal')}</span>
        <span className="s3-slider">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={metal}
            onChange={(e) => setMetal(Number(e.target.value))}
          />
          <output>{metal.toFixed(2)}</output>
        </span>
      </label>
      <label className="s3-field">
        <span>{t3('duration')}</span>
        <input
          type="number"
          min={1}
          max={60}
          step={0.5}
          value={duration}
          onChange={(e) => setDuration(Math.min(60, Math.max(1, Number(e.target.value) || 4)))}
        />
      </label>
      <div className="s3-actions">
        <button
          type="button"
          className="s3-btn"
          onClick={() => {
            loadScene(scene(), t3('editTemplate'), null);
            open3d();
          }}
        >
          {t3('quickEdit')}
        </button>
        <button
          type="button"
          className="s3-btn s3-primary"
          disabled={busy}
          onClick={() =>
            void render3d(scene(), {
              engine: 'viewer',
              format: 'webm',
              name: template === 'logo' ? text || 'logo' : t3(`t_${template}` as Key3D),
              timeline: true,
            }).catch(() => {})
          }
        >
          {t3('quickRender')}
        </button>
      </div>
      {busy && (
        <p className="s3-hint" role="status">
          {progress}{' '}
          <button type="button" className="s3-link" onClick={cancel}>
            {t3('cancel')}
          </button>
        </p>
      )}
      <hr />
      <button type="button" className="s3-btn s3-wide" onClick={open3d}>
        {t3('open')}
      </button>
    </div>
  );
}
