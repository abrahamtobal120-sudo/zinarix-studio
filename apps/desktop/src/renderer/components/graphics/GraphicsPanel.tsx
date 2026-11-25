import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, openFile, toast, useStore } from '../../store';
import { askAgent } from '../Chat';
import { PALETTES, TEMPLATES, buildTemplate, slugify, uniqueName } from '../../../shared/graphics';
import { newPaintFile } from '../paint/PaintView';
import { isEn, tg } from './graphicsStrings';
import { Icon } from '../Icon';
import './graphics.css';

/**
 * Fase 3C (plan de funciones): the graphics studio side panel — Canva-style templates
 * (posts, stories, thumbnails, cards, logos, posters, slides), a new paint canvas, "create
 * with AI" and the designs already in the project.
 */

const DIR = 'disenos';
const PAINT_SIZES: [number, number][] = [
  [1920, 1080],
  [1080, 1080],
  [1080, 1920],
  [2480, 3508],
];

async function freePath(base: string, ext: string): Promise<string> {
  const files = new Set(
    await api()
      .workspace.listFiles()
      .catch(() => [] as string[]),
  );
  return `${DIR}/${uniqueName(base, ext, (n) => files.has(`${DIR}/${n}`))}`;
}

async function ensureDir(): Promise<void> {
  await api()
    .workspace.createDir(DIR)
    .catch(() => undefined);
}

export function GraphicsPanel() {
  const workspace = useStore((s) => s.workspace);
  const en = isEn();
  const [tpl, setTpl] = useState(TEMPLATES[0]!.id);
  const [pal, setPal] = useState(PALETTES[0]!.id);
  const t = TEMPLATES.find((x) => x.id === tpl)!;
  const [title, setTitle] = useState('');
  const [sub, setSub] = useState('');
  const [w, setW] = useState(t.width);
  const [h, setH] = useState(t.height);
  const [paintSize, setPaintSize] = useState(0);
  const [aiText, setAiText] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<string[]>([]);

  useEffect(() => {
    setW(t.width);
    setH(t.height);
    setTitle('');
    setSub('');
  }, [t]);

  const refresh = useCallback(() => {
    if (!workspace) return setMine([]);
    void api()
      .workspace.listFiles()
      .then((fs) =>
        setMine(
          fs
            .filter(
              (f) =>
                /\.(svg|zdraw)$/i.test(f) && !/(^|\/)(node_modules|dist|build|\.git)\//.test(f),
            )
            .slice(0, 300),
        ),
      )
      .catch(() => setMine([]));
  }, [workspace]);
  useEffect(refresh, [refresh]);

  const thumbs = useMemo(
    () =>
      Object.fromEntries(
        TEMPLATES.map((x) => [
          x.id,
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildTemplate({ template: x.id, palette: pal, lang: en ? 'en' : 'es' }))}`,
        ]),
      ),
    [pal, en],
  );

  const create = async () => {
    if (!workspace) return toast(tg('noFolder'));
    setBusy(true);
    try {
      const svg = buildTemplate({
        template: tpl,
        palette: pal,
        lang: en ? 'en' : 'es',
        title: title.trim() ? title.replace(/\\n/g, '\n') : undefined,
        subtitle: sub.trim() ? sub : undefined,
        width: w,
        height: h,
      });
      await ensureDir();
      const p = await freePath(slugify(title.trim() || (en ? t.name.en : t.name.es)), 'svg');
      await api().workspace.writeFile(p, svg);
      await openFile(p);
      toast(tg('created', { name: p }));
      refresh();
    } catch (e) {
      toast(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const createPaint = async () => {
    if (!workspace) return toast(tg('noFolder'));
    setBusy(true);
    try {
      const [pw, ph] = PAINT_SIZES[paintSize]!;
      const text = await newPaintFile(pw, ph, {
        base: tg('baseLayer'),
        layer: tg('layerName', { n: 1 }),
      });
      await ensureDir();
      const p = await freePath(en ? 'drawing' : 'dibujo', 'zdraw');
      await api().workspace.writeFile(p, text);
      await openFile(p);
      refresh();
    } catch (e) {
      toast(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const createAi = async () => {
    const want = aiText.trim();
    if (!want) return toast(tg('aiNeedText'));
    if (!workspace) return toast(tg('noFolder'));
    setBusy(true);
    try {
      // A blank page of the chosen size, open in the editor; the agent draws into it.
      await ensureDir();
      const p = await freePath(slugify(want.split(/\s+/).slice(0, 5).join(' ')), 'svg');
      await api().workspace.writeFile(
        p,
        buildTemplate({ template: 'blank', width: w, height: h }).replace(/<rect[^>]*\/>\n?/, ''),
      );
      await openFile(p);
      askAgent(
        `Diseña esto como un SVG editable en el archivo ${p} (ya existe, ${w} × ${h} px, abierto en el editor de diseño; reemplaza su contenido): ${want}\n\n` +
          'Hazlo editable: width, height y viewBox de ese tamaño; texto como <text> con fuentes del sistema; cada parte en <g data-name="…"> con un nombre claro; degradados en <defs>; sin scripts ni imágenes de internet. ' +
          'Después míralo con svg_render y corrige lo que se vea mal (textos cortados, colores sin contraste, cosas fuera de la página). Al final dime qué hiciste.',
      );
      setAiText('');
      refresh();
    } catch (e) {
      toast(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gp">
      <div className="sidebar-title">
        <span className="panel-title">{tg('title')}</span>
      </div>
      <div className="gp-body">
        <p className="gp-hint">{tg('desc')}</p>
        {!workspace && <p className="gp-warn">{tg('noFolder')}</p>}

        <h4>{tg('newDesign')}</h4>
        <div className="gp-palettes">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              className={`gp-pal ${pal === p.id ? 'on' : ''}`}
              title={en ? p.name.en : p.name.es}
              aria-label={en ? p.name.en : p.name.es}
              aria-pressed={pal === p.id}
              onClick={() => setPal(p.id)}
              style={{ background: `linear-gradient(135deg, ${p.bg1}, ${p.bg2})` }}
            >
              <span style={{ background: p.accent }} />
            </button>
          ))}
        </div>
        <div className="gp-grid">
          {TEMPLATES.map((x) => (
            <button
              key={x.id}
              className={`gp-tpl ${tpl === x.id ? 'on' : ''}`}
              onClick={() => setTpl(x.id)}
              title={`${x.width} × ${x.height} px`}
            >
              <span className="gp-thumb">
                <img src={thumbs[x.id]} alt="" draggable={false} />
              </span>
              <span className="gp-tpl-name">{en ? x.name.en : x.name.es}</span>
            </button>
          ))}
        </div>
        {tpl !== 'blank' && (
          <>
            <label className="gp-field">
              <span>{tg('textTitle')}</span>
              <input
                value={title}
                placeholder={(en ? t.text.en : t.text.es).title.replace(/\n/g, ' ')}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="gp-field">
              <span>{tg('textSub')}</span>
              <input
                value={sub}
                placeholder={(en ? t.text.en : t.text.es).subtitle.replace(/\n/g, ' ')}
                onChange={(e) => setSub(e.target.value)}
              />
            </label>
          </>
        )}
        <div className="gp-row">
          <span className="gp-dim">{tg('customSize')}</span>
          <input
            className="gp-num"
            type="number"
            min={16}
            max={10000}
            value={w}
            aria-label={en ? 'Width (px)' : 'Ancho (px)'}
            onChange={(e) => setW(Number(e.target.value) || t.width)}
          />
          ×
          <input
            className="gp-num"
            type="number"
            min={16}
            max={10000}
            value={h}
            aria-label={en ? 'Height (px)' : 'Alto (px)'}
            onChange={(e) => setH(Number(e.target.value) || t.height)}
          />
        </div>
        <button className="gp-go" disabled={busy || !workspace} onClick={() => void create()}>
          {tg('create')}
        </button>

        <h4>{tg('aiTitle')}</h4>
        <p className="gp-hint">{tg('aiHint')}</p>
        <textarea
          className="gp-ai"
          rows={3}
          value={aiText}
          placeholder={tg('aiPlaceholder')}
          onChange={(e) => setAiText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void createAi();
          }}
        />
        <p className="gp-hint">
          {en ? t.name.en : t.name.es} · {w} × {h} px
        </p>
        <button className="gp-go" disabled={busy || !workspace} onClick={() => void createAi()}>
          <Icon name="message" size={14} /> {tg('aiGo')}
        </button>

        <h4>{tg('newPaint')}</h4>
        <p className="gp-hint">{tg('paintHint')}</p>
        <div className="gp-row gp-wrap">
          {PAINT_SIZES.map(([pw, ph], i) => (
            <button key={i} className={paintSize === i ? 'on' : ''} onClick={() => setPaintSize(i)}>
              {pw} × {ph}
            </button>
          ))}
        </div>
        <button className="gp-go" disabled={busy || !workspace} onClick={() => void createPaint()}>
          <Icon name="brush" size={14} /> {tg('paintCreate')}
        </button>

        <h4 className="gp-h-row">
          {tg('mine')}
          <button className="gp-mini" title={tg('refresh')} onClick={refresh}>
            ↻
          </button>
        </h4>
        {mine.length === 0 ? (
          <p className="gp-hint">{tg('none')}</p>
        ) : (
          <div className="gp-list">
            {mine.map((f) => (
              <button key={f} className="gp-file" title={f} onClick={() => void openFile(f)}>
                <span>{/\.zdraw$/i.test(f) ? <Icon name="brush" size={14} /> : '◆'}</span>
                <span className="gp-file-name">{f}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
