import { useEffect, useRef, useState } from 'react';
import { Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { api } from '../../store';
import { errText } from '../../errText';
import { askAgent } from '../Chat';
import { Icon } from '../Icon';
import { analyzeMesh, parseObj, parseOff, parseStl, type MeshReport } from '../../../shared/mesh3d';
import { MeshViewer, type ViewName } from './meshViewer';
import { BEDS, PrintCheck } from './PrintCheck';
import { SliceBox } from './SliceBox';
import { ViewTools } from './ViewTools';
import { SLICEABLE } from '../../../shared/slicer';
import { tc } from './cadStrings';
import './cad.css';

const MAX_ANALYZE = 600_000;
const ext = (p: string) => p.toLowerCase().split('.').pop() ?? '';
/** Formats that are usually Y-up and in metres (glTF, FBX, Blender's OBJ). */
const Y_UP = new Set(['glb', 'gltf', 'fbx']);

const ab = (b: Uint8Array): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** A three.js object from the file's bytes (the loaders' parse: the window cannot fetch files). */
async function parseObject(bytes: Uint8Array, e: string): Promise<Object3D> {
  if (e === 'glb' || e === 'gltf')
    return (
      await new GLTFLoader().parseAsync(
        e === 'glb' ? ab(bytes) : new TextDecoder().decode(bytes),
        '',
      )
    ).scene;
  if (e === 'fbx') return new FBXLoader().parse(ab(bytes), '');
  if (e === 'obj') return new OBJLoader().parse(new TextDecoder().decode(bytes));
  if (e === '3mf') {
    const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
    return new ThreeMFLoader().parse(ab(bytes));
  }
  if (e === 'ply') {
    const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
    const g = new PLYLoader().parse(ab(bytes));
    g.computeVertexNormals();
    return new Mesh(
      g,
      new MeshStandardMaterial({ color: 0xcccccc, vertexColors: g.hasAttribute('color') }),
    );
  }
  throw new Error(`.${e}`);
}

/**
 * Fase 7: viewer of mesh files (STL, 3MF, OBJ, OFF, PLY, glTF, FBX) with the 3D printing check:
 * size, watertight, holes, flipped faces, whether it fits the bed, grams of PLA.
 */
export function ModelView({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<MeshViewer | null>(null);
  const e = ext(path);
  const [state, setState] = useState<{
    loading: boolean;
    error?: string;
    report?: MeshReport | null;
  }>({ loading: true });
  const [units, setUnits] = useState<'mm' | 'm'>(Y_UP.has(e) ? 'm' : 'mm');
  const [yUp, setYUp] = useState(Y_UP.has(e));
  const [bed, setBed] = useState(BEDS[0]!);
  const [wire, setWire] = useState(false);
  const [reload, setReload] = useState(0);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!host.current) return;
    const v = new MeshViewer(host.current);
    viewer.current = v;
    return () => {
      v.dispose();
      viewer.current = null;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    void (async () => {
      try {
        const bytes = await api().cad.readMesh(path);
        const v = viewer.current!;
        let tris: Float32Array;
        if (e === 'stl' || e === 'off' || (e === 'obj' && !yUp)) {
          const text = () => new TextDecoder().decode(bytes);
          tris = e === 'stl' ? parseStl(bytes) : e === 'off' ? parseOff(text()) : parseObj(text());
          if (!alive) return;
          v.setTris(tris, true);
        } else {
          const o = await parseObject(bytes, e);
          if (!alive) return;
          v.setObject(o, yUp);
          tris = v.modelTris();
        }
        const report =
          tris.length / 9 <= MAX_ANALYZE ? analyzeMesh(tris, units === 'm' ? 1e-7 : 1e-4) : null;
        if (alive) {
          setState({ loading: false, report });
          setShown((n) => n + 1);
        }
      } catch (err) {
        if (alive) setState({ loading: false, error: errText(err) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [path, e, yUp, reload, units]);

  useEffect(() => viewer.current?.setWire(wire), [wire]);
  // The bed in the model's units, so it shows at the right size under it.
  useEffect(
    () =>
      viewer.current?.setBed(
        units === 'm' ? [bed.size[0] / 1000, bed.size[1] / 1000] : [bed.size[0], bed.size[1]],
      ),
    [bed, units, state.report],
  );

  const views: [ViewName, string][] = [
    ['iso', tc('viewIso')],
    ['front', tc('viewFront')],
    ['right', tc('viewRight')],
    ['top', tc('viewTop')],
  ];
  const name = path.split(/[\\/]/).pop() ?? path;
  return (
    <div className="cad-model" aria-label={name}>
      <div className="cad-toolbar">
        <strong className="cad-title">{name}</strong>
        <span className="cad-grow" />
        {views.map(([v, label]) => (
          <button key={v} className="btn ghost cad-small" onClick={() => viewer.current?.view(v)}>
            {label}
          </button>
        ))}
        <label className="cad-check">
          <input type="checkbox" checked={wire} onChange={(ev) => setWire(ev.target.checked)} />
          {tc('wire')}
        </label>
        {e !== 'stl' && e !== 'off' && (
          <label className="cad-check" title="Y up / Z up">
            <input type="checkbox" checked={yUp} onChange={(ev) => setYUp(ev.target.checked)} />Y ↑
          </label>
        )}
        <button className="btn ghost cad-small" onClick={() => setReload((n) => n + 1)}>
          {tc('render')}
        </button>
      </div>
      <div className="cad-model-body">
        <div className="cad-view-wrap">
          <div className="cad-view" ref={host} />
          <div className="cad-view-btns">
            <ViewTools viewer={viewer} version={shown} units={units} />
          </div>
          {state.loading && <div className="cad-overlay">{tc('loadingModel')}</div>}
          {state.error && (
            <div className="cad-error" role="alert">
              {tc('loadFail', { err: state.error })}
            </div>
          )}
        </div>
        <div className="cad-side">
          <section className="cad-sec">
            <div className="cad-sec-head static">{tc('print')}</div>
            <PrintCheck report={state.report ?? null} units={units} bed={bed.size} />
            <label className="cad-field">
              <span>{tc('units')}</span>
              <select value={units} onChange={(ev) => setUnits(ev.target.value as 'mm' | 'm')}>
                <option value="mm">{tc('mm')}</option>
                <option value="m">{tc('m')}</option>
              </select>
            </label>
            <label className="cad-field">
              <span>{tc('bed')}</span>
              <select
                value={bed.id}
                onChange={(ev) => setBed(BEDS.find((b) => b.id === ev.target.value) ?? BEDS[0]!)}
              >
                {BEDS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label} mm
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn ghost cad-small"
              onClick={() =>
                askAgent(
                  tc('checkAiPrompt', { file: path, units: units === 'm' ? ' (units "m")' : '' }),
                )
              }
            >
              <Icon name="message" size={13} /> {tc('askAi')}
            </button>
          </section>
          {SLICEABLE.test(path) && (
            <section className="cad-sec">
              <div className="cad-sec-head static">{tc('slice')}</div>
              <SliceBox path={path} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
