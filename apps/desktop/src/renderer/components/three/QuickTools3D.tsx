/**
 * Basic tools of the 3D editor: a floating card over the viewport with big, plain buttons
 * (add a shape, paint it, make it bigger, one-click animations). Every button is one undoable
 * commit, so nothing here needs the inspector.
 */
import { useState } from 'react';
import {
  LIMITS,
  ROW_PROPS,
  duplicateNode,
  makeLight,
  makeMesh,
  poseAt,
  removeNode,
  setNodeProp,
  withKey,
  type Material3D,
  type Node3D,
  type NodeProp,
  type Shape,
} from '../../../shared/scene3d';
import { lang } from '../../i18n';
import { toast } from '../../store';
import { commit, commitNode, get3, selectedNode, set3, use3 } from './store3d';
import './quick3d.css';

const es = {
  title: 'Herramientas básicas',
  hide: 'Ocultar',
  show: 'Herramientas',
  add: 'Agregar',
  box: 'Cubo',
  sphere: 'Esfera',
  cylinder: 'Cilindro',
  cone: 'Cono',
  torus: 'Dona',
  plane: 'Suelo',
  text: 'Texto',
  light: 'Luz',
  pick: 'Toca un objeto para cambiarlo.',
  color: 'Color',
  custom: 'Otro color',
  look: 'Acabado',
  matte: 'Mate',
  shiny: 'Brillante',
  metal: 'Metal',
  glass: 'Vidrio',
  glow: 'Brilla',
  size: 'Tamaño y lugar',
  bigger: 'Más grande',
  smaller: 'Más chico',
  up: 'Subir',
  down: 'Bajar',
  turn: 'Girar 45°',
  center: 'Al centro',
  animate: 'Animar',
  spin: 'Girar',
  float: 'Flotar',
  pulse: 'Latir',
  still: 'Quitar animación',
  copy: 'Duplicar',
  remove: 'Borrar',
  full: 'La escena ya tiene el máximo de objetos.',
};
const en: typeof es = {
  title: 'Basic tools',
  hide: 'Hide',
  show: 'Tools',
  add: 'Add',
  box: 'Cube',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  cone: 'Cone',
  torus: 'Donut',
  plane: 'Floor',
  text: 'Text',
  light: 'Light',
  pick: 'Click an object to change it.',
  color: 'Color',
  custom: 'Other color',
  look: 'Finish',
  matte: 'Matte',
  shiny: 'Shiny',
  metal: 'Metal',
  glass: 'Glass',
  glow: 'Glow',
  size: 'Size and place',
  bigger: 'Bigger',
  smaller: 'Smaller',
  up: 'Up',
  down: 'Down',
  turn: 'Turn 45°',
  center: 'To center',
  animate: 'Animate',
  spin: 'Spin',
  float: 'Float',
  pulse: 'Pulse',
  still: 'Remove animation',
  copy: 'Duplicate',
  remove: 'Delete',
  full: 'The scene already has the most objects allowed.',
};
type K = keyof typeof es;
const tq = (k: K): string => (lang === 'en' ? en : es)[k];

const SHAPE_BTNS: { shape: Shape; glyph: string; key: K }[] = [
  { shape: 'box', glyph: '■', key: 'box' },
  { shape: 'sphere', glyph: '●', key: 'sphere' },
  { shape: 'cylinder', glyph: '▮', key: 'cylinder' },
  { shape: 'cone', glyph: '▲', key: 'cone' },
  { shape: 'torus', glyph: '◯', key: 'torus' },
  { shape: 'plane', glyph: '▬', key: 'plane' },
  { shape: 'text', glyph: 'T', key: 'text' },
];

const SWATCHES = [
  '#ffffff',
  '#1c1c1e',
  '#e5484d',
  '#f76b15',
  '#ffc53d',
  '#46a758',
  '#38a8ff',
  '#8e4ec6',
  '#e93d82',
  '#a18072',
];

const FINISHES: { key: K; m: Partial<Material3D> }[] = [
  { key: 'matte', m: { metalness: 0, roughness: 0.9, opacity: 1, emissiveIntensity: 0 } },
  { key: 'shiny', m: { metalness: 0.1, roughness: 0.15, opacity: 1, emissiveIntensity: 0 } },
  { key: 'metal', m: { metalness: 1, roughness: 0.25, opacity: 1, emissiveIntensity: 0 } },
  { key: 'glass', m: { metalness: 0, roughness: 0.05, opacity: 0.35, emissiveIntensity: 0 } },
  { key: 'glow', m: { emissiveIntensity: 1.5 } },
];

const SHOW_KEY = 'zinarix.scene3d.quickTools';

function addNode(n: Node3D) {
  const s = get3().scene;
  if (s.nodes.length >= LIMITS.nodes) return alertFull();
  commit({ ...s, nodes: [...s.nodes, n] }, `${tq('add')}: ${n.name}`);
  set3({ selected: n.id });
}
const alertFull = (): void => toast(tq('full'));

/** Changes props of the selected node at the playhead (keyed props get a key, like the gizmo). */
function nudge(
  label: string,
  fn: (pose: ReturnType<typeof poseAt>) => Partial<Record<NodeProp, number>>,
) {
  const { scene, time } = get3();
  const n = selectedNode(get3());
  if (!n) return;
  const pose = poseAt(n, time);
  let next = n;
  for (const [p, v] of Object.entries(fn(pose)) as [NodeProp, number][])
    next = setNodeProp(next, p, v, time, scene.fps);
  commitNode(n.id, () => next, label);
}

const scaleBy = (f: number) => () =>
  nudge(tq(f > 1 ? 'bigger' : 'smaller'), (p) => {
    const [lo, hi] = LIMITS.scale;
    const c = (v: number) => Math.min(hi, Math.max(lo, v * f));
    return { sx: c(p.scale[0]), sy: c(p.scale[1]), sz: c(p.scale[2]) };
  });

/** One-click loops over the whole scene: they replace the keys of the props they use. */
function animate(kind: 'spin' | 'float' | 'pulse' | 'still') {
  const { scene } = get3();
  const n = selectedNode(get3());
  if (!n) return;
  const d = scene.duration;
  const fps = scene.fps;
  const base = poseAt(n, 0);
  if (kind === 'still') {
    // The object stays where it is at the start.
    const still: Node3D = {
      ...n,
      position: base.position,
      rotation: base.rotation,
      scale: base.scale,
      ...(n.light ? { light: { ...n.light, intensity: base.intensity } } : {}),
    };
    delete still.keys;
    return commitNode(n.id, () => still, tq('still'));
  }
  const keys = { ...n.keys };
  const set = (p: NodeProp, points: [number, number][], ease?: 'ease') => {
    delete keys[p];
    let k: typeof keys = keys;
    for (const [t, v] of points) k = withKey(k, p, t, v, fps, ease);
    keys[p] = k[p];
  };
  if (kind === 'spin') {
    set('ry', [
      [0, base.rotation[1]],
      [d, base.rotation[1] + 360],
    ]);
  } else if (kind === 'float') {
    const y = base.position[1];
    set(
      'py',
      [
        [0, y],
        [d / 2, y + 0.5],
        [d, y],
      ],
      'ease',
    );
  } else {
    ROW_PROPS.scale.forEach((p, i) => {
      const v = base.scale[i]!;
      set(
        p,
        [
          [0, v],
          [d / 2, Math.min(LIMITS.scale[1], v * 1.25)],
          [d, v],
        ],
        'ease',
      );
    });
  }
  commitNode(n.id, (x) => ({ ...x, keys }), tq(kind));
}

function paint(color: string) {
  const n = selectedNode(get3());
  if (!n) return;
  if (n.kind === 'light' && n.light)
    return commitNode(n.id, (x) => ({ ...x, light: { ...x.light!, color } }), tq('color'));
  if (n.kind === 'mesh' && n.material)
    commitNode(
      n.id,
      (x) => ({ ...x, material: { ...x.material!, color, emissive: color } }),
      tq('color'),
    );
}

function finish(m: Partial<Material3D>, label: string) {
  const n = selectedNode(get3());
  if (!n?.material) return;
  commitNode(
    n.id,
    (x) => ({
      ...x,
      material: {
        ...x.material!,
        ...m,
        emissive: m.emissiveIntensity ? x.material!.color : x.material!.emissive,
      },
    }),
    label,
  );
}

function Btn(p: {
  glyph?: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
  on?: boolean;
}) {
  return (
    <button
      type="button"
      className={`q3-btn${p.danger ? ' q3-danger' : ''}${p.on ? ' on' : ''}`}
      title={p.label}
      aria-pressed={p.on}
      onClick={p.onClick}
    >
      {p.glyph && (
        <span className="q3-glyph" aria-hidden>
          {p.glyph}
        </span>
      )}
      <span>{p.label}</span>
    </button>
  );
}

export function QuickTools3D() {
  const [show, setShow] = useState(() => localStorage.getItem(SHOW_KEY) !== '0');
  const n = use3(selectedNode);
  const toggle = (v: boolean) => {
    setShow(v);
    localStorage.setItem(SHOW_KEY, v ? '1' : '0');
  };
  if (!show)
    return (
      <button type="button" className="q3-open s3-btn" onClick={() => toggle(true)}>
        🧰 {tq('show')}
      </button>
    );
  const color = n?.kind === 'light' ? n.light?.color : n?.material?.color;
  const anim = n?.keys;
  return (
    <section className="q3-card" aria-label={tq('title')}>
      <header className="q3-head">
        <strong>🧰 {tq('title')}</strong>
        <button type="button" className="q3-x" title={tq('hide')} onClick={() => toggle(false)}>
          ×
        </button>
      </header>

      <h4>{tq('add')}</h4>
      <div className="q3-grid">
        {SHAPE_BTNS.map((b) => (
          <Btn
            key={b.shape}
            glyph={b.glyph}
            label={tq(b.key)}
            onClick={() => addNode(makeMesh(b.shape))}
          />
        ))}
        <Btn glyph="💡" label={tq('light')} onClick={() => addNode(makeLight('point'))} />
      </div>

      {!n ? (
        <p className="q3-hint">{tq('pick')}</p>
      ) : (
        <>
          <p className="q3-name" title={n.name}>
            {n.name}
          </p>
          {(n.kind === 'light' || n.material) && (
            <>
              <h4>{tq('color')}</h4>
              <div className="q3-swatches">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`q3-sw${color?.toLowerCase() === c ? ' on' : ''}`}
                    style={{ background: c }}
                    title={c}
                    aria-label={c}
                    onClick={() => paint(c)}
                  />
                ))}
                <label className="q3-sw q3-custom" title={tq('custom')}>
                  <input
                    type="color"
                    value={color ?? '#ffffff'}
                    aria-label={tq('custom')}
                    onChange={(e) => paint(e.target.value)}
                  />
                </label>
              </div>
            </>
          )}
          {n.material && (
            <>
              <h4>{tq('look')}</h4>
              <div className="q3-grid">
                {FINISHES.map((f) => (
                  <Btn key={f.key} label={tq(f.key)} onClick={() => finish(f.m, tq(f.key))} />
                ))}
              </div>
            </>
          )}
          <h4>{tq('size')}</h4>
          <div className="q3-grid">
            <Btn glyph="＋" label={tq('bigger')} onClick={scaleBy(1.25)} />
            <Btn glyph="－" label={tq('smaller')} onClick={scaleBy(0.8)} />
            <Btn
              glyph="↑"
              label={tq('up')}
              onClick={() => nudge(tq('up'), (p) => ({ py: p.position[1] + 0.5 }))}
            />
            <Btn
              glyph="↓"
              label={tq('down')}
              onClick={() => nudge(tq('down'), (p) => ({ py: p.position[1] - 0.5 }))}
            />
            <Btn
              glyph="↻"
              label={tq('turn')}
              onClick={() => nudge(tq('turn'), (p) => ({ ry: p.rotation[1] + 45 }))}
            />
            <Btn
              glyph="◎"
              label={tq('center')}
              onClick={() => nudge(tq('center'), () => ({ px: 0, pz: 0 }))}
            />
          </div>
          <h4>{tq('animate')}</h4>
          <div className="q3-grid">
            <Btn glyph="⟳" label={tq('spin')} on={!!anim?.ry} onClick={() => animate('spin')} />
            <Btn glyph="〰" label={tq('float')} on={!!anim?.py} onClick={() => animate('float')} />
            <Btn glyph="♥" label={tq('pulse')} on={!!anim?.sx} onClick={() => animate('pulse')} />
            {anim && <Btn glyph="■" label={tq('still')} onClick={() => animate('still')} />}
          </div>
          <div className="q3-grid q3-end">
            <Btn
              glyph="⧉"
              label={tq('copy')}
              onClick={() => {
                const s = get3();
                const r = duplicateNode(s.scene, n.id);
                if (r.id === n.id) return alertFull();
                commit(r.scene, tq('copy'));
                set3({ selected: r.id });
              }}
            />
            <Btn
              glyph="🗑"
              label={tq('remove')}
              danger
              onClick={() => commit(removeNode(get3().scene, n.id), `${tq('remove')}: ${n.name}`)}
            />
          </div>
        </>
      )}
    </section>
  );
}
